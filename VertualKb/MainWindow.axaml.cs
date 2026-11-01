using System;
using System.Collections.Generic;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Layout;
using Avalonia.Threading;

namespace VertualKb;

public partial class MainWindow : Window
{
    // 竖屏键盘的原始排版尺寸（旋转后：横向占 PortraitH，纵向占 PortraitW=整屏高）
    private const double PortraitW = 1024;
    private const double PortraitH = 650;

    private nint _hwnd;
    private nint _lastTarget; // 最近的真实目标窗口（焦点被抢时还给谁）

    private KLayer _layer = KLayer.Letters;
    private bool _shiftOnce;   // 单次 Shift
    private bool _ctrl, _alt, _win; // 粘滞修饰键，作用于下一个按键
    private bool _caps;
    private string _preview = "";
    private bool _collapsed;

    private DispatcherTimer? _repeatTimer;
    private KeyDef? _repeatKey;
    private int _repeatDelayTicks;

    private readonly List<(Button btn, KeyDef def)> _liveButtons = new();

    public MainWindow()
    {
        InitializeComponent();
        TransparencyLevelHint = new[]
        {
            WindowTransparencyLevel.AcrylicBlur, WindowTransparencyLevel.Transparent,
        };
        _caps = WinApi.IsCapsLockOn();

        OnPressed(ExpandHandle, (_, e) => { e.Handled = true; SetCollapsed(false); });
        OnPressed(ClearButton, (_, e) => { e.Handled = true; ClearPreviewText(); });
        OnPressed(ExitButton, (_, e) => { e.Handled = true; Close(); });
        // 双击顶栏（预览栏）折叠键盘
        TopBar.DoubleTapped += (_, _) => SetCollapsed(true);

        // 拖动顶栏可移动窗口（按钮点击已标记 Handled，不会走到这里）
        TopBar.PointerPressed += (_, e) =>
        {
            if (e.Source is Button || _collapsed) return;
            try { BeginMoveDrag(e); } catch { /* 某些状态下不可拖动，忽略 */ }
        };

        RebuildKeys();
        UpdatePreview();

        Opened += (_, _) =>
        {
            _hwnd = TryGetPlatformHandle()?.Handle ?? 0;
            WinApi.MakeNoActivate(_hwnd);
            LayoutWindow();

            // 高频看门狗：重申 NOACTIVATE/TOPMOST 压过输入法候选窗；
            // 焦点一旦被键盘抢走立刻还给目标窗口，避免按键被吞、输入法挂死
            new DispatcherTimer(TimeSpan.FromMilliseconds(100), DispatcherPriority.Background,
                (_, _) =>
                {
                    if (_hwnd == 0) return;
                    WinApi.MakeNoActivate(_hwnd);
                    WinApi.AssertTopMost(_hwnd);
                    WinApi.PushImeWindowsBelow(_hwnd);
                    WinApi.EnsureNotForeground(_hwnd, ref _lastTarget);
                }).Start();
        };
    }

    // ---------- 布局与窗口位置 ----------

    /// <summary>Button 会在类处理器里把 PointerPressed 标为 Handled，
    /// 必须用 handledEventsToo:true 订阅，否则按键永远没反应。</summary>
    private static void OnPressed(Control c, EventHandler<PointerEventArgs> h) =>
        c.AddHandler(PointerPressedEvent, h, RoutingStrategies.Bubble, handledEventsToo: true);

    private void LayoutWindow()
    {
        var scr = Screens.ScreenFromWindow(this) ?? Screens.Primary;
        if (scr is null) return;
        double deviceScale = RenderScaling;
        double scrHdip = scr.Bounds.Height / deviceScale;

        // 窗口高度 = 屏幕高度，键盘纵向铺满
        double fit = Math.Clamp(scrHdip / PortraitW, 0.5, 3.0);
        if (PortraitHost.LayoutTransform is TransformGroup tg
            && tg.Children[0] is ScaleTransform st)
        {
            st.ScaleX = st.ScaleY = fit;
        }

        double w = _collapsed ? 64 : PortraitH * fit;
        Width = w;
        Height = scrHdip;

        int px = scr.Bounds.Right - (int)Math.Ceiling(w * deviceScale);
        Position = new PixelPoint(px, scr.Bounds.Y);
    }

    private void SetCollapsed(bool collapsed)
    {
        if (_collapsed == collapsed) return;
        _collapsed = collapsed;
        KeyboardRoot.IsVisible = !collapsed;
        ExpandHandle.IsVisible = collapsed;
        LayoutWindow();
    }

    // ---------- 键盘层构建 ----------

    private void RebuildKeys()
    {
        _liveButtons.Clear();
        var rows = KeyDefs.GetLayer(_layer, _shiftOnce || _caps);

        var outer = new Grid();
        foreach (var _ in rows)
            outer.RowDefinitions.Add(new RowDefinition(GridLength.Star));

        for (int r = 0; r < rows.Count; r++)
        {
            var rowGrid = new Grid();
            foreach (var def in rows[r])
                rowGrid.ColumnDefinitions.Add(
                    new ColumnDefinition(new GridLength(def.Width, GridUnitType.Star)));

            for (int c = 0; c < rows[r].Length; c++)
            {
                var def = rows[r][c];
                if (def.Style == "spacer") continue;
                var btn = CreateKey(def);
                Grid.SetColumn(btn, c);
                rowGrid.Children.Add(btn);
            }

            Grid.SetRow(rowGrid, r);
            outer.Children.Add(rowGrid);
        }

        KeysHost.Content = outer;
        RefreshStates();
    }

    private Button CreateKey(KeyDef def)
    {
        var btn = new Button
        {
            Content = def.Label,
            Focusable = false,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch,
        };
        btn.Classes.Add("kb");
        if (!string.IsNullOrEmpty(def.Style))
            btn.Classes.Add(def.Style);
        if (def.Action == KeyAction.Space)
            btn.FontSize = 24;

        OnPressed(btn, (_, e) =>
        {
            e.Handled = true;
            StopRepeat();
            Press(def);
            if (def.Repeat)
            {
                _repeatKey = def;
                _repeatDelayTicks = 12; // 约 480ms 后开始连续重复
                _repeatTimer ??= new DispatcherTimer(
                    TimeSpan.FromMilliseconds(40), DispatcherPriority.Background,
                    (_, _) =>
                    {
                        if (_repeatDelayTicks > 0) { _repeatDelayTicks--; return; }
                        if (_repeatKey != null) Press(_repeatKey, repeat: true);
                    });
                _repeatTimer.Start();
            }
        });
        btn.AddHandler(PointerReleasedEvent, (_, _) => StopRepeat(),
            RoutingStrategies.Bubble, handledEventsToo: true);
        btn.PointerCaptureLost += (_, _) => StopRepeat();
        btn.DetachedFromVisualTree += (_, _) => StopRepeat();

        _liveButtons.Add((btn, def));
        return btn;
    }

    private void StopRepeat()
    {
        _repeatKey = null;
        _repeatTimer?.Stop();
    }

    // ---------- 按键处理 ----------

    private void Press(KeyDef def, bool repeat = false)
    {
        bool consume = false;
        switch (def.Action)
        {
            case KeyAction.Text:
                SendText(def.Text ?? "");
                AppendPreview(DisplayChar(def));
                consume = true;
                break;
            case KeyAction.Space:
                SendText(" ");
                AppendPreview(" ");
                consume = true;
                break;
            case KeyAction.Backspace:
                SendVk(KeyDefs.VK_BACK);
                BackspacePreview();
                consume = true;
                break;
            case KeyAction.Enter:
                SendVk(KeyDefs.VK_RETURN);
                ClearPreviewText();
                consume = true;
                break;
            case KeyAction.Tab:
                SendVk(KeyDefs.VK_TAB);
                consume = true;
                break;
            case KeyAction.Esc:
                SendVk(KeyDefs.VK_ESCAPE);
                consume = true;
                break;
            case KeyAction.Nav:
                SendVk(def.Vk, def.Extended);
                consume = true;
                break;
            case KeyAction.Combo:
                SendText(def.Text ?? "", forceCtrl: true);
                AppendPreview($"[{def.Label}]");
                consume = true;
                break;
            case KeyAction.CapsLock:
                WinApi.KeyTap(KeyDefs.VK_CAPITAL);
                _caps = WinApi.IsCapsLockOn();
                RebuildKeys();
                return;
            case KeyAction.Modifier:
                ToggleModifier(def);
                return;
            case KeyAction.SwitchLayer:
                _layer = def.Target;
                RebuildKeys();
                return;
            case KeyAction.Collapse:
                SetCollapsed(true);
                return;
            case KeyAction.ClearPreview:
                ClearPreviewText();
                return;
            case KeyAction.ExitApp:
                Close();
                return;
        }

        // 一个按键已发出：消费单次 Shift / 粘滞修饰键
        if (consume && !repeat && (_shiftOnce || _ctrl || _alt || _win))
        {
            bool shiftChanged = _shiftOnce;
            _shiftOnce = false;
            _ctrl = _alt = _win = false;
            if (shiftChanged) RebuildKeys(); else RefreshStates();
        }

        // 候选窗会随按键刷新并重新置顶，紧跟其后把自己压回去
        if (_hwnd != 0) WinApi.AssertTopMost(_hwnd);

        // 符号层输入一个字符后自动回到字母层（手机键盘习惯）
        if (consume && !repeat && _layer == KLayer.Symbols && def.Action == KeyAction.Text)
        {
            _layer = KLayer.Letters;
            RebuildKeys();
        }
    }

    private void ToggleModifier(KeyDef def)
    {
        switch (def.StickyMod)
        {
            case Mods.Shift: _shiftOnce = !_shiftOnce; break;
            case Mods.Ctrl: _ctrl = !_ctrl; break;
            case Mods.Alt: _alt = !_alt; break;
            case Mods.Win: _win = !_win; break;
        }

        // 在「更多」层选了修饰键后自动回字母层，方便 Ctrl+C 这类组合
        bool backToLetters = _layer == KLayer.Fn && def.StickyMod != Mods.None;
        if (backToLetters) _layer = KLayer.Letters;

        if (def.StickyMod == Mods.Shift || backToLetters) RebuildKeys();
        else RefreshStates();
    }

    private void SendText(string text, bool forceCtrl = false)
    {
        foreach (var ch in text)
        {
            var (vk, needShift) = KeyDefs.MapChar(ch);
            if (vk == 0) continue;

            bool shift = needShift || _shiftOnce;
            bool ctrl = _ctrl || forceCtrl;
            bool alt = _alt;
            bool win = _win;

            if (shift) WinApi.KeyDown(KeyDefs.VK_SHIFT);
            if (ctrl) WinApi.KeyDown(KeyDefs.VK_CONTROL);
            if (alt) WinApi.KeyDown(KeyDefs.VK_MENU);
            if (win) WinApi.KeyDown(KeyDefs.VK_LWIN);
            WinApi.KeyTap(vk);
            if (win) WinApi.KeyUp(KeyDefs.VK_LWIN);
            if (alt) WinApi.KeyUp(KeyDefs.VK_MENU);
            if (ctrl) WinApi.KeyUp(KeyDefs.VK_CONTROL);
            if (shift) WinApi.KeyUp(KeyDefs.VK_SHIFT);
        }
    }

    private void SendVk(ushort vk, bool extended = false) => WinApi.KeyTap(vk, extended);

    private string DisplayChar(KeyDef def)
    {
        var t = def.Text ?? "";
        if (t.Length == 1 && char.IsAsciiLetter(t[0]))
            return ((_shiftOnce ^ _caps) ? char.ToUpperInvariant(t[0]) : t[0]).ToString();
        return t;
    }

    // ---------- 激活态显示 ----------

    private void RefreshStates()
    {
        foreach (var (btn, def) in _liveButtons)
        {
            bool active = def.Action switch
            {
                KeyAction.Modifier => def.StickyMod switch
                {
                    Mods.Shift => _shiftOnce,
                    Mods.Ctrl => _ctrl,
                    Mods.Alt => _alt,
                    Mods.Win => _win,
                    _ => false,
                },
                KeyAction.Nav when def.Vk == KeyDefs.VK_CAPITAL => _caps,
                KeyAction.SwitchLayer when def.Target == _layer => true,
                _ => false,
            };
            if (active) btn.Classes.Add("active");
            else btn.Classes.Remove("active");
        }
    }

    // ---------- 输入预览 ----------

    private void AppendPreview(string s)
    {
        _preview += s;
        UpdatePreview();
    }

    private void BackspacePreview()
    {
        if (_preview.Length > 0)
            _preview = _preview[..^1];
        UpdatePreview();
    }

    private void ClearPreviewText()
    {
        _preview = "";
        UpdatePreview();
    }

    private void UpdatePreview()
    {
        const int max = 28;
        var tail = _preview.Length > max ? "…" + _preview[^max..] : _preview;
        PreviewText.Text = tail + "▍";
        PreviewText.Foreground = _preview.Length == 0
            ? new SolidColorBrush(Color.Parse("#5A7396"))
            : new SolidColorBrush(Color.Parse("#9FD1FF"));
    }
}
