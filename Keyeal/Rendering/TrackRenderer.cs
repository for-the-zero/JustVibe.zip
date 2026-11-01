using System.Globalization;
using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Threading;
using Keyeal.Models;
using Keyeal.Services;

namespace Keyeal.Rendering;

/// <summary>
/// 键盘轨道渲染器（Keyviz 级别高质感渲染器）：
/// · 纯正 FIFO 队列：普通按键依次追加，永不互相顶掉，队列满（超宽/超高）才平滑移除最旧项；
/// · 每个按键独立生命周期超时：松开后独立计时，达到停留时长后逐个优雅向上隐去；
/// · 组合键（含 Ctrl/Alt/Win 控制键）触发时精准错峰清空已有按键并单独突出显示；
/// · 轨道面板（Dock）半透明自适应：宽高严格包裹当前内容，无按键时平滑收起隐去；
/// · 9 种停靠位置全面适配（左下/中下/右下/左上/中上/右上/左中/右中/正中），设置预览完美居中；
/// · 修饰键与功能键采用纯正高清 SVG 矢量图标（⌃, ⇧, ⌥, ⊞, ↵, ⌫, ⇥, ⎋, ␣ 等）；
/// · 精致紧凑微阴影与中心缩放变换（0.94x 微凹反馈），消除快速输入时的左上角闪现。
/// </summary>
public sealed class TrackRenderer : Control
{
    private readonly List<KeyUnit> _units = new();
    private DispatcherTimer? _timer;
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private double _lastTick = -1;
    private int _heldModBits;

    public bool IsPreview { get; set; }

    private readonly Dictionary<string, (FormattedText Ft, double W, double H, SolidColorBrush Brush)> _badgeCache = new();

    private Settings S => App.Inst.S;

    private long Now() => _clock.ElapsedMilliseconds;

    /// 轨道窗口换屏后调用
    public void HandleBoundsChanged() => InvalidateVisual();

    // ------------------------------------------------------------ 输入分发

    public void HandleKey(KeyDisplayEvent e)
    {
        var s = S;
        long now = Now();

        if (e.IsModifier)
        {
            int bit = KeyLabelProvider.ModBitOf(e.Vk);
            if (e.IsDown)
            {
                _heldModBits |= bit;

                // 修饰键单独成帽（已存在同键的纯修饰帽则忽略）
                bool exists = _units.Any(u => u.IsModifierOnly && u.Vk == e.Vk && u.Exit < 0);
                if (!exists)
                {
                    var u = new KeyUnit(e.Vk, e.KeyLabel, modBits: 0, isModifierOnly: true, now);
                    BuildCells(u, s);
                    UpdateMetrics(u, s);
                    _units.Add(u);
                }
            }
            else
            {
                _heldModBits &= ~bit;
                // 纯修饰帽：松开后尽快淡出
                var u = _units.FirstOrDefault(x => x.IsModifierOnly && x.Vk == e.Vk && x.Exit < 0);
                if (u is { })
                {
                    u.Exit = now + 40;
                    u.OccupyDuringExit = false;
                    u.Freeze(Bounds.Width, Bounds.Height);
                }
            }
        }
        else if (e.IsDown)
        {
            // 连续重复（与最后一个存活单元同签名）→ 计数 + 按压动画重放
            if (_units.Count > 0)
            {
                var last = _units[^1];
                if (last.Signature == e.DisplayText && last.Exit < 0)
                {
                    last.Count++;
                    last.Press = now;
                    last.IsDown = true;
                    last.Release = -1;
                    last.Exit = -1;
                    last.BadgePulse = now;
                    UpdateMetrics(last, s);
                    InvalidateVisual();
                    EnsureRunning();
                    return;
                }
            }

            int modBits = e.ModFlags & (KeyLabelProvider.ModCtrl | KeyLabelProvider.ModShift |
                                        KeyLabelProvider.ModAlt | KeyLabelProvider.ModWin);

            // 已按下的修饰键帽原地并入组合组（避免键帽“消失又在别处重生”的瞬移）
            KeyUnit? baseUnit = null;
            if (modBits != 0)
            {
                foreach (var u in _units)
                {
                    if (u.IsModifierOnly && u.Exit < 0 &&
                        (KeyLabelProvider.ModBitOf(u.Vk) & modBits) != 0)
                    {
                        baseUnit = u;
                        break;
                    }
                }
            }

            // 含控制键的组合键 → 清空轨道（保留将并入的修饰帽）
            if (e.ModifierLabels.Length > 0 && s.ComboClearsTrack &&
                (s.ClearMods & modBits) != 0)
            {
                FlushAll(keepLast: false, staggerMs: 16, keep: baseUnit);
            }

            if (baseUnit is { })
            {
                for (int i = _units.Count - 1; i >= 0; i--)
                {
                    var u = _units[i];
                    if (u != baseUnit && u.IsModifierOnly && u.Exit < 0 &&
                        (KeyLabelProvider.ModBitOf(u.Vk) & modBits) != 0)
                    {
                        _units.RemoveAt(i);
                    }
                }
                baseUnit.MorphIntoCombo(e.Vk, e.KeyLabel, modBits, now);
                BuildCells(baseUnit, s);
                UpdateMetrics(baseUnit, s);
            }
            else
            {
                var unit = new KeyUnit(e.Vk, e.KeyLabel, modBits, isModifierOnly: false, now);
                BuildCells(unit, s);
                UpdateMetrics(unit, s);
                _units.Add(unit);
            }
        }
        else
        {
            // 普通键抬起：记录释放时刻，开始独立超时
            for (int i = _units.Count - 1; i >= 0; i--)
            {
                var u = _units[i];
                if (u.Vk == e.Vk && !u.IsModifierOnly && u.IsDown)
                {
                    u.IsDown = false;
                    u.Release = now;
                    break;
                }
            }
        }

        InvalidateVisual();
        EnsureRunning();
    }

    /// 清空整行（组合键触发 / 超宽触发）。keep：保留不退场的单元
    internal void FlushAll(bool keepLast, long staggerMs, KeyUnit? keep = null)
    {
        long now = Now();
        long d = 0;
        int alive = _units.Count(u => u.Exit < 0);
        int idx = 0;
        foreach (var u in _units)
        {
            if (u.Exit >= 0 || u == keep) continue;
            bool keepThis = keepLast && ++idx == alive;
            if (keepThis) continue;
            u.Exit = now + d;
            u.OccupyDuringExit = false;
            u.Freeze(Bounds.Width, Bounds.Height);
            d += staggerMs;
        }
    }

    // ------------------------------------------------------------ 主循环与帧推进

    private void EnsureRunning()
    {
        _timer ??= CreateTimer();
        if (!_timer.IsEnabled)
        {
            _lastTick = Now();
            _timer.Start();
        }
    }

    private DispatcherTimer CreateTimer()
    {
        var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(14) };
        t.Tick += (_, _) => Tick();
        return t;
    }

    private void Tick()
    {
        long now = Now();
        double dt = _lastTick < 0 ? 0.016 : Math.Min((now - _lastTick) / 1000.0, 0.05);
        _lastTick = now;

        var s = S;
        if (s.Version != _versionCache)
        {
            _versionCache = s.Version;
            RebuildAll(s);
        }

        Layout(s, now, dt);
        Advance(s, now);

        // 面板自适应平滑淡入 / 淡出
        double panelTarget = _units.Any(u => u.Exit < 0) ? 1.0 : 0.0;
        _panelOpacity += (panelTarget - _panelOpacity) * (1 - Math.Exp(-dt * 16));
        if (_panelOpacity < 0.003) _panelOpacity = 0;
        if (_panelOpacity > 0.997) _panelOpacity = 1;

        if (_units.Count == 0 && _panelOpacity <= 0)
        {
            _timer?.Stop();
            InvalidateVisual();
            return;
        }
        InvalidateVisual();
    }

    private double _panelOpacity;
    private double _panelSpan = 0;

    /// 计算面板几何：严格自适应内容宽度/高度并依据停靠策略计算绝对 Rect
    private (Rect Rect, double PadH, double PadV, bool Horizontal) PanelGeometry(Settings s)
    {
        double vw = Bounds.Width, vh = Bounds.Height;
        bool horizontal = s.Orientation == TrackOrientation.Horizontal;
        double padH = horizontal ? 10 : 8;
        double padV = horizontal ? 8 : 10;
        double maxSpan = s.MaxTrackFraction * (horizontal ? vw : vh);

        double panelW, panelH;
        if (horizontal)
        {
            panelW = Math.Min(Math.Max(_panelSpan, 0), maxSpan);
            panelH = s.BubbleHeight + padV * 2;
        }
        else
        {
            panelW = s.BubbleHeight + padH * 2;
            panelH = Math.Min(Math.Max(_panelSpan, 0), maxSpan);
        }

        Rect r = ComputePanelRect(s, vw, vh, panelW, panelH);
        return (r, padH, padV, horizontal);
    }

    private Rect ComputePanelRect(Settings s, double vw, double vh, double panelW, double panelH)
    {
        if (IsPreview)
        {
            // 预览窗口居中展示
            return new Rect((vw - panelW) / 2, (vh - panelH) / 2, panelW, panelH);
        }

        double x, y;
        switch (s.Position)
        {
            case TrackPosition.BottomLeft:
                x = s.EdgeMargin;
                y = vh - s.EdgeMargin - panelH;
                break;
            case TrackPosition.BottomRight:
                x = vw - s.EdgeMargin - panelW;
                y = vh - s.EdgeMargin - panelH;
                break;
            case TrackPosition.TopLeft:
                x = s.EdgeMargin;
                y = s.EdgeMargin;
                break;
            case TrackPosition.TopRight:
                x = vw - s.EdgeMargin - panelW;
                y = s.EdgeMargin;
                break;
            case TrackPosition.TopCenter:
                x = (vw - panelW) / 2;
                y = s.EdgeMargin;
                break;
            case TrackPosition.LeftCenter:
                x = s.EdgeMargin;
                y = (vh - panelH) / 2;
                break;
            case TrackPosition.RightCenter:
                x = vw - s.EdgeMargin - panelW;
                y = (vh - panelH) / 2;
                break;
            case TrackPosition.Center:
                x = (vw - panelW) / 2;
                y = (vh - panelH) / 2;
                break;
            case TrackPosition.BottomCenter:
            default:
                x = (vw - panelW) / 2;
                y = vh - s.EdgeMargin - panelH;
                break;
        }

        return new Rect(x, y, panelW, panelH);
    }

    private int _versionCache = -1;

    private void RebuildAll(Settings s)
    {
        _badgeCache.Clear();
        foreach (var u in _units)
        {
            BuildCells(u, s);
            UpdateMetrics(u, s);
        }
    }

    // ------------------------------------------------------------ 布局与生命周期

    private void Layout(Settings s, long now, double dt)
    {
        double vw = Bounds.Width, vh = Bounds.Height;
        if (vw <= 1 || vh <= 1) return;

        bool horizontal = s.Orientation == TrackOrientation.Horizontal;
        double SpanOf(KeyUnit u) => horizontal ? u.Width : u.Height;
        double padH = horizontal ? 10 : 8;
        double padV = horizontal ? 8 : 10;
        double maxSpan = s.MaxTrackFraction * (horizontal ? vw : vh);
        double maxContentCap = maxSpan - (horizontal ? padH * 2 : padV * 2);

        // 统计存活与排版单元的总长度
        double activeContentSpan = 0; int activeCount = 0;
        foreach (var u in _units)
        {
            if (u.Exit < 0)
            {
                activeContentSpan += SpanOf(u);
                activeCount++;
            }
        }
        if (activeCount > 0)
            activeContentSpan += s.Gap * (activeCount - 1);

        // 当且仅当总存活长度超过屏幕/设定最大宽度（maxContentCap）时，才执行超宽移除最旧项
        if (activeContentSpan > maxContentCap && activeCount > 1)
        {
            if (s.Overflow == OverflowBehavior.RemoveOldest)
            {
                while (true)
                {
                    double total = 0; int n = 0;
                    foreach (var u in _units)
                    {
                        if (u.Exit < 0) { total += SpanOf(u) + s.Gap; n++; }
                    }
                    total -= n > 0 ? s.Gap : 0;
                    if (total <= maxContentCap || n <= 1) break;

                    var oldest = _units.First(u => u.Exit < 0);
                    oldest.Exit = now;
                    oldest.OccupyDuringExit = false;
                    oldest.Freeze(vw, vh);
                }
            }
            else
            {
                FlushAll(keepLast: true, staggerMs: 24);
            }
        }

        // 重新计算排版所需总长度
        double totalLayoutSpan = 0; int layoutCount = 0;
        foreach (var u in _units)
        {
            if (u.Exit < 0 || u.OccupyDuringExit)
            {
                totalLayoutSpan += SpanOf(u);
                layoutCount++;
            }
        }
        if (layoutCount > 0)
            totalLayoutSpan += s.Gap * (layoutCount - 1);

        // 面板自适应平滑伸缩
        double targetPanelSpan = layoutCount > 0 ? (totalLayoutSpan + (horizontal ? padH * 2 : padV * 2)) : 0;
        _panelSpan += (Math.Clamp(targetPanelSpan, 0, maxSpan) - _panelSpan) * (1 - Math.Exp(-dt * 24));

        var (panel, _, _, _) = PanelGeometry(s);

        // 键帽在面板内排布
        double glide = 1 - Math.Exp(-dt * 26);
        double flow = horizontal
            ? panel.X + (panel.Width - totalLayoutSpan) / 2
            : panel.Y + (panel.Height - totalLayoutSpan) / 2;

        foreach (var u in _units)
        {
            bool exiting = u.Exit >= 0;
            if (exiting && !u.OccupyDuringExit) continue;

            if (exiting)
            {
                if (horizontal) flow += u.Width + s.Gap;
                else flow += u.Height + s.Gap;
                continue;
            }

            if (horizontal)
            {
                u.TargetX = flow;
                u.TargetY = panel.Y + padV;
                flow += u.Width + s.Gap;
            }
            else
            {
                u.TargetX = panel.X + padH;
                u.TargetY = flow;
                flow += u.Height + s.Gap;
            }

            if (!u.HasPos)
            {
                u.CurX = u.TargetX;
                u.CurY = u.TargetY;
                u.HasPos = true;
            }
            else
            {
                u.CurX += (u.TargetX - u.CurX) * glide;
                u.CurY += (u.TargetY - u.CurY) * glide;
            }
        }
    }

    private void Advance(Settings s, long now)
    {
        // ★ 核心特性：每个按键独立的停留时长超时（松开后独立计时，达到 dwellTime 后逐个向上隐去）
        for (int i = _units.Count - 1; i >= 0; i--)
        {
            var u = _units[i];

            if (u.Exit < 0 && !u.IsDown)
            {
                long refTime = u.Release >= 0 ? u.Release : u.Spawn;
                if (now - refTime >= s.DwellTime)
                {
                    u.Exit = now;
                    u.OccupyDuringExit = false;
                    u.Freeze(Bounds.Width, Bounds.Height);
                }
            }

            // 兜底超时
            if (u.Exit < 0 && now - u.Spawn > 30_000)
            {
                u.Exit = now;
                u.OccupyDuringExit = false;
                u.Freeze(Bounds.Width, Bounds.Height);
            }

            if (u.Exit >= 0 && now - u.Exit > s.ExitDuration + 60)
            {
                _units.RemoveAt(i);
            }
        }
    }

    // ------------------------------------------------------------ 测量与排版

    private Typeface TypefaceFor(Settings s, string? text = null)
    {
        if (KeyLabelProvider.IsGlyphLabel(text))
        {
            return new Typeface(new FontFamily("Segoe UI Symbol, Segoe Fluent Icons, Segoe MDL2 Assets, Arial Unicode MS, Segoe UI, Microsoft YaHei UI"), FontStyle.Normal, FontWeight.SemiBold);
        }
        return new Typeface(new FontFamily($"{s.FontFamily}, Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, sans-serif"), FontStyle.Normal, FontWeight.SemiBold);
    }

    private void BuildCells(KeyUnit u, Settings s)
    {
        double size = Math.Min(s.FontSize, s.BubbleHeight * 0.46);
        u.Cells.Clear();

        void Add(string label, bool isModifier)
        {
            var brush = new SolidColorBrush(isModifier ? s.ModifierColor : s.BgColor);
            var ft = new FormattedText(label, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
                TypefaceFor(s, label), size, brush);
            u.Cells.Add(new KeyUnit.Cell(label, isModifier, ft, brush, ft.Width));
        }

        foreach (var mod in u.ModifierLabels)
            Add(mod, isModifier: true);
        Add(u.Label, isModifier: false);

        u.TextH = u.Cells.Count > 0 ? u.Cells.Max(c => c.Ft.Height) : size;
    }

    private void UpdateMetrics(KeyUnit u, Settings s)
    {
        u.Height = s.BubbleHeight;
        double outerPad = u.IsCombo ? 4 : 0;
        double innerGap = u.IsCombo ? 4 : 0;

        double total = outerPad * 2;
        for (int i = 0; i < u.Cells.Count; i++)
        {
            var c = u.Cells[i];
            double w;
            if (c.IsModifier)
            {
                w = Math.Max(s.BubbleHeight * 0.85 * WideFactor(c.Label), c.TextW + s.PaddingX * 2);
            }
            else
            {
                if (c.Label == "␣")
                {
                    w = Math.Max(s.BubbleHeight * 2.0, c.TextW + s.PaddingX * 2);
                }
                else if (c.Label.Length <= 2)
                {
                    w = s.BubbleHeight * WideFactor(c.Label) + s.PaddingX * 0.35;
                }
                else
                {
                    w = Math.Max(s.BubbleHeight, c.TextW + s.PaddingX * 2);
                }

                // 重复计数徽标预留空间
                if (u.Count > 1 && s.ShowRepeatCount)
                {
                    var badge = MeasureBadge($"x{u.Count}", s);
                    w = Math.Max(w, c.TextW + badge.W + 16);
                }
            }
            c.CellW = w;
            u.Cells[i] = c;
            total += w;
            if (i < u.Cells.Count - 1) total += innerGap;
        }
        u.Width = total;
    }

    private (FormattedText Ft, double W, double H, SolidColorBrush Brush) MeasureBadge(string text, Settings s)
    {
        if (_badgeCache.TryGetValue(text, out var cached)) return cached;
        var tf = new Typeface(new FontFamily($"{s.FontFamily}, Segoe UI, Microsoft YaHei UI, sans-serif"), FontStyle.Normal, FontWeight.Bold);
        double size = Math.Max(10, Math.Min(s.FontSize * 0.44, 13));
        var brush = new SolidColorBrush(s.CountColor);
        var ft = new FormattedText(text, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
            tf, size, brush);
        var v = (ft, ft.Width, ft.Height, brush);
        _badgeCache[text] = v;
        return v;
    }

    // ------------------------------------------------------------ 绘制

    public override void Render(DrawingContext ctx)
    {
        var s = S;
        long now = Now();

        // 轨道半透明面板：把键帽装住的长条底板（自适应尺寸与优雅淡入淡出）
        if (s.ShowTrackPanel && _panelOpacity > 0.005)
        {
            var (panel, _, _, _) = PanelGeometry(s);
            if (panel.Width > 4 && panel.Height > 4)
            {
                double pr = Math.Min(12, Math.Min(panel.Width, panel.Height) / 2);
                double panelScale = 0.97 + 0.03 * _panelOpacity;
                double pcx = panel.X + panel.Width / 2, pcy = panel.Y + panel.Height / 2;

                using (ctx.PushTransform(
                           Matrix.CreateTranslation(-pcx, -pcy) *
                           Matrix.CreateScale(panelScale, panelScale) *
                           Matrix.CreateTranslation(pcx, pcy)))
                using (ctx.PushOpacity(_panelOpacity))
                {
                    // 柔和微小外阴影（去除了巨大的弥散投影）
                    DrawPanelShadow(ctx, panel, pr);

                    // 半透明磨砂底板
                    ctx.FillRectangle(new SolidColorBrush(s.PanelColor), panel, (float)pr);

                    // 1px 精致微光描边
                    ctx.DrawRectangle(null,
                        new Pen(new SolidColorBrush(Color.FromArgb(24, 255, 255, 255)), 1,
                            null, PenLineCap.Round, PenLineJoin.Round),
                        panel, (float)pr);
                }
            }
        }

        // 绘制键帽
        foreach (var u in _units)
        {
            DrawUnit(ctx, s, u, now);
        }
    }

    private void DrawUnit(DrawingContext ctx, Settings s, KeyUnit u, long now)
    {
        // ★ 核心修复：未完成初始布局定位前不绘制，彻底杜绝左上角闪现
        if (!u.HasPos) return;

        // ---- 进入动画：克制、干脆、弹性质感
        double et = (now - u.Spawn) / s.EnterDuration;
        double eLin = Math.Clamp(et, 0, 1);
        double eP = et >= 1 ? 1 : Easing.Evaluate(s.EnterEasing, eLin);
        double dx = 0, dy = 0, extraScale = 1, enterOp = Math.Min(1, eLin * 2.8);
        double dist = Math.Min(24, u.Height * 0.38);

        switch (s.Enter)
        {
            case EnterAnimation.FromBottom: dy = (1 - eP) * dist; extraScale = 0.95 + 0.05 * eP; break;
            case EnterAnimation.FromTop: dy = -(1 - eP) * dist; extraScale = 0.95 + 0.05 * eP; break;
            case EnterAnimation.FromLeft: dx = -(1 - eP) * dist; extraScale = 0.95 + 0.05 * eP; break;
            case EnterAnimation.FromRight: dx = (1 - eP) * dist; extraScale = 0.95 + 0.05 * eP; break;
            case EnterAnimation.ZoomIn: extraScale = 0.78 + 0.22 * eP; break;
            case EnterAnimation.ZoomOut: extraScale = 1.22 - 0.22 * eP; break;
            case EnterAnimation.Fade: extraScale = 0.98 + 0.02 * eP; break;
            case EnterAnimation.FlipX: extraScale = Math.Max(0.05, eP); enterOp = Math.Min(1, eLin * 1.8); break;
            case EnterAnimation.FlipY: extraScale = Math.Max(0.05, eP); enterOp = Math.Min(1, eLin * 1.8); break;
        }

        // ---- 退场动画：默认优雅向上隐去（FadeUp）
        double exitOp = 1;
        if (u.Exit >= 0)
        {
            double t = (now - u.Exit) / s.ExitDuration;
            if (t >= 1) return;
            if (t > 0)
            {
                double ep = Easing.Evaluate(s.ExitEasing, t);
                switch (s.Exit)
                {
                    case ExitAnimation.FadeUp:
                        dy -= 14 * ep;
                        extraScale *= 1.0 - 0.05 * ep;
                        exitOp = 1 - ep;
                        break;
                    case ExitAnimation.FadeShrink:
                        extraScale *= 1 - 0.12 * ep;
                        exitOp = 1 - ep;
                        break;
                    case ExitAnimation.Fade:
                        exitOp = 1 - ep;
                        break;
                    case ExitAnimation.FloatUp:
                        dy -= 36 * ep;
                        exitOp = 1 - ep;
                        break;
                    case ExitAnimation.FallDown:
                        dy += 36 * ep;
                        exitOp = 1 - ep;
                        break;
                    case ExitAnimation.SlideLeft:
                        dx -= (u.Width + 20) * ep;
                        exitOp = 1 - ep;
                        break;
                    case ExitAnimation.SlideRight:
                        dx += (u.Width + 20) * ep;
                        exitOp = 1 - ep;
                        break;
                    case ExitAnimation.ZoomOut:
                        extraScale *= Math.Max(0.01, 1 - 0.6 * ep);
                        exitOp = 1 - ep;
                        break;
                }
            }
        }

        // ---- 按压包络：按压时缩小（PressedScale，默认 0.94x），严格以键帽物理中心为缩放基点
        double env = PressEnv(u, now, s);
        double scale = (1 + (s.PressedScale - 1) * env) * extraScale;
        double opacity = Math.Clamp(enterOp * exitOp, 0, 1);

        double w = u.Width, h = u.Height;
        double cx = u.CurX + w / 2 + dx, cy = u.CurY + h / 2 + dy;

        // 正确的矩阵中心缩放变换（Origin -> Center -> Scale -> Back）
        using (ctx.PushTransform(
                   Matrix.CreateTranslation(-cx, -cy) *
                   Matrix.CreateScale(scale, scale) *
                   Matrix.CreateTranslation(cx, cy)))
        using (ctx.PushOpacity(opacity))
        {
            var rect = new Rect(u.CurX + dx, u.CurY + dy, w, h);
            double radius = Math.Min(s.CornerRadius, h / 2);

            // 按压柔光：径向辉光渐变
            if (s.BubbleGlow && env > 0.04)
            {
                var glow = new RadialGradientBrush
                {
                    Center = new RelativePoint(0.5, 0.5, RelativeUnit.Relative),
                    RadiusX = new RelativeScalar(0.5, RelativeUnit.Relative),
                    RadiusY = new RelativeScalar(0.5, RelativeUnit.Relative),
                    GradientStops =
                    {
                        new GradientStop(Easing.WithAlpha(s.PressedColor, 0.32 * env), 0.38),
                        new GradientStop(Easing.WithAlpha(s.PressedColor, 0.12 * env), 0.68),
                        new GradientStop(Easing.WithAlpha(s.PressedColor, 0), 1),
                    },
                };
                ctx.DrawEllipse(glow, null,
                    new Rect(cx - w * 0.85, cy - h * 0.85, w * 1.7, h * 1.7));
            }

            // 外容器：微阴影与底板
            var containerBg = Easing.WithAlpha(
                u.IsCombo ? Easing.Lerp(s.ModifierColor, Colors.Black, 0.26) : s.BgColor, s.BgOpacity);
            DrawSoftShadow(ctx, rect, radius);
            ctx.FillRectangle(new SolidColorBrush(containerBg), rect, (float)radius);

            var borderColor = Easing.Lerp(s.BorderColor, s.PressedColor, env * 0.85);
            if (s.BorderThickness > 0.01)
            {
                ctx.DrawRectangle(null,
                    new Pen(new SolidColorBrush(borderColor), s.BorderThickness, null, PenLineCap.Round, PenLineJoin.Round),
                    rect, (float)radius);
            }

            // 内部键帽单元渲染
            double outerPad = u.IsCombo ? 4 : 0;
            double innerGap = u.IsCombo ? 4 : 0;
            double x = u.CurX + dx + outerPad;
            double cellRadius = Math.Max(Math.Min(radius - outerPad, h / 2 - outerPad), 4);
            double cellH = h - outerPad * 2;
            double keyCellX = 0, keyCellW = 0;

            var keyTextColor = Easing.Lerp(s.TextColor, Colors.White, env * 0.5);

            for (int i = 0; i < u.Cells.Count; i++)
            {
                var c = u.Cells[i];
                var cellRect = new Rect(x, u.CurY + dy + outerPad, c.CellW, cellH);

                if (c.IsModifier)
                {
                    var modBg = Easing.WithAlpha(Easing.Lerp(s.ModifierColor, Colors.White, 0.04), s.BgOpacity);
                    ctx.FillRectangle(new SolidColorBrush(modBg), cellRect, (float)cellRadius);
                    if (s.BorderThickness > 0.01)
                    {
                        ctx.DrawRectangle(null,
                            new Pen(new SolidColorBrush(Easing.WithAlpha(s.BorderColor, 0.45)), s.BorderThickness, null, PenLineCap.Round, PenLineJoin.Round),
                            cellRect, (float)cellRadius);
                    }
                    c.Brush.Color = Easing.WithAlpha(s.TextColor, 0.88);
                }
                else
                {
                    var keyBg = Easing.WithAlpha(Easing.Lerp(s.BgColor, s.PressedColor, env * 0.90), s.BgOpacity);
                    ctx.FillRectangle(new SolidColorBrush(keyBg), cellRect, (float)cellRadius);
                    if (u.IsCombo && s.BorderThickness > 0.01)
                    {
                        var cellBorder = Easing.Lerp(s.BorderColor, s.PressedColor, env * 0.85);
                        ctx.DrawRectangle(null,
                            new Pen(new SolidColorBrush(cellBorder), s.BorderThickness, null, PenLineCap.Round, PenLineJoin.Round),
                            cellRect, (float)cellRadius);
                    }
                    c.Brush.Color = keyTextColor;
                    keyCellX = cellRect.X;
                    keyCellW = cellRect.Width;
                }

                // 优先使用高清 SVG 矢量渲染图标，无法匹配则回退到 FormattedText
                if (!KeyIconRenderer.TryDrawIcon(ctx, c.Label, cellRect, c.Brush, s.FontSize * 1.05))
                {
                    double tx = cellRect.X + (cellRect.Width - c.TextW) / 2;
                    double ty = cellRect.Y + (cellRect.Height - c.Ft.Height) / 2;
                    ctx.DrawText(c.Ft, new Point(tx, ty));
                }

                x += c.CellW + (i < u.Cells.Count - 1 ? innerGap : 0);
            }

            // 修饰键按住时，主键帽上方指示
            if (u.IsCombo && (_heldModBits & u.ModBits) != 0 && u.Exit < 0)
            {
                double mx = keyCellX + keyCellW / 2;
                double my = u.CurY + dy - 7;
                var caretPen = new Pen(new SolidColorBrush(Easing.WithAlpha(s.TextColor, 0.75)), 1.8,
                    null, PenLineCap.Round, PenLineJoin.Round);
                ctx.DrawLine(caretPen, new Point(mx - 4, my + 4), new Point(mx, my - 1));
                ctx.DrawLine(caretPen, new Point(mx, my - 1), new Point(mx + 4, my + 4));
            }

            // 重复计数徽标（主键帽右下角：低调灰色小字 + 半透明底衬）
            if (u.Count > 1 && s.ShowRepeatCount)
            {
                var badge = MeasureBadge($"x{u.Count}", s);
                double pulse = 1 + 0.28 * (1 - Math.Clamp((now - u.BadgePulse) / 160.0, 0, 1));
                double bx = keyCellX + keyCellW - badge.W - 6;
                double by = u.CurY + dy + h - badge.H - 4;
                double bcx = bx + badge.W / 2, bcy = by + badge.H / 2;

                using (ctx.PushTransform(
                           Matrix.CreateTranslation(-bcx, -bcy) *
                           Matrix.CreateScale(pulse, pulse) *
                           Matrix.CreateTranslation(bcx, bcy)))
                {
                    var pillRect = new Rect(bx - 3, by - 1, badge.W + 6, badge.H + 2);
                    ctx.FillRectangle(new SolidColorBrush(Color.FromArgb(130, 14, 16, 22)), pillRect, (float)(pillRect.Height / 2));
                    ctx.DrawRectangle(null, new Pen(new SolidColorBrush(Color.FromArgb(35, 255, 255, 255)), 0.8), pillRect, (float)(pillRect.Height / 2));

                    badge.Brush.Color = s.CountColor;
                    ctx.DrawText(badge.Ft, new Point(bx, by));
                }
            }
        }
    }

    private double PressEnv(KeyUnit u, long now, Settings s)
    {
        double at = (now - u.Press) / s.PressDuration;
        double attack = Easing.Evaluate(EasingKind.OutQuad, Math.Clamp(at, 0, 1));
        if (u.IsDown || u.Release < 0) return attack;
        double rt = Math.Clamp((now - u.Release) / (s.PressDuration * 2.0), 0, 1);
        return attack * (1 - Easing.Evaluate(EasingKind.OutQuad, rt));
    }

    /// 精致微阴影（替换掉了原先过大的阴影）
    private static void DrawSoftShadow(DrawingContext ctx, Rect rect, double radius)
    {
        (int Dy, int Inflate, byte Alpha)[] layers =
        [
            (3, 1, 24),
            (1, 0, 28),
        ];
        foreach (var (dy, inf, alpha) in layers)
        {
            var r = new Rect(rect.X - inf, rect.Y - inf + dy, rect.Width + inf * 2, rect.Height + inf * 2);
            ctx.FillRectangle(new SolidColorBrush(Color.FromArgb(alpha, 0, 0, 0)), r,
                (float)Math.Min(radius + inf, r.Height / 2));
        }
    }

    private static double WideFactor(string label) => label switch
    {
        "⌃" or "⌥" or "⊞" => 1.38,
        "⇧" => 1.95,
        "⇥" => 1.42,
        "⌫" => 1.58,
        "↵" => 1.72,
        "⎋" => 1.28,
        "⌦" => 1.45,
        "⇪" => 1.65,
        _ => 1.0,
    };

    private static void DrawPanelShadow(DrawingContext ctx, Rect rect, double radius)
    {
        (int Dy, int Inflate, byte Alpha)[] layers =
        [
            (4, 2, 20),
            (2, 0, 24),
        ];
        foreach (var (dy, inf, alpha) in layers)
        {
            var r = new Rect(rect.X - inf, rect.Y - inf + dy, rect.Width + inf * 2, rect.Height + inf * 2);
            ctx.FillRectangle(new SolidColorBrush(Color.FromArgb(alpha, 0, 0, 0)), r,
                (float)Math.Min(radius + inf, r.Height / 2));
        }
    }
}

/// 一个按键“单元”（组合键 = 修饰键帽 + 主键帽 同组）
internal sealed class KeyUnit
{
    public record struct Cell(string Label, bool IsModifier, FormattedText Ft, SolidColorBrush Brush, double TextW)
    {
        public double CellW { get; set; }
    }

    public int Vk;
    public string Label;
    public string[] ModifierLabels = Array.Empty<string>();
    public int ModBits;
    public bool IsModifierOnly;
    public string Signature = "";
    public bool IsDown;
    public int Count = 1;

    /// 退场期间是否继续占用队列空间
    public bool OccupyDuringExit;

    public List<Cell> Cells { get; } = new();
    public double TextH;
    public double Width, Height;

    public long Spawn, Press, Release = -1, Exit = -1, BadgePulse;

    public double CurX, CurY, TargetX, TargetY;
    public bool HasPos;

    public bool IsCombo => ModBits != 0;

    public KeyUnit(int vk, string label, int modBits, bool isModifierOnly, long now)
    {
        Vk = vk;
        Label = label;
        ModBits = modBits;
        IsModifierOnly = isModifierOnly;
        RefreshSignature();
        Spawn = now;
        Press = now;
        IsDown = true;
    }

    public void MorphIntoCombo(int vk, string label, int modBits, long now)
    {
        Vk = vk;
        Label = label;
        ModBits = modBits;
        IsModifierOnly = false;
        RefreshSignature();
        Press = now;
        Release = -1;
        Exit = -1;
        BadgePulse = now;
        IsDown = true;
        Count = 1;
    }

    private void RefreshSignature()
    {
        ModifierLabels = IsModifierOnly
            ? Array.Empty<string>()
            : KeyLabelProvider.ModLabels(ModBits);
        Signature = ModifierLabels.Length == 0
            ? Label
            : string.Join(" + ", ModifierLabels.Append(Label));
    }

    public void Freeze(double vw, double vh)
    {
        if (!HasPos)
        {
            CurX = Math.Max((vw - Width) / 2, 2);
            CurY = Math.Max(vh / 2, 2);
            HasPos = true;
        }
        TargetX = CurX;
        TargetY = CurY;
    }
}
