using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Threading;
using Keyeal.Models;
using Keyeal.Services;

namespace Keyeal.Rendering;

public sealed class MouseEffectLayer : Control
{
    private readonly object _gate = new();
    private readonly List<Point> _pendingMoves = new(128);
    private readonly List<(Point P, int Btn, bool Down)> _pendingClicks = new(16);

    private sealed class TrailPoint { public Point P; public long T; }
    private sealed class Micro { public Point P; public Point V; public long T0; public double Life; public Color C; }
    private sealed class ClickFx { public Point P; public long T0; public long ReleaseAt = -1; public Color C; public double[] Angles = Array.Empty<double>(); public int Btn; }

    private readonly List<TrailPoint> _trail = new(180);
    private readonly List<Micro> _micros = new(120);
    private readonly List<ClickFx> _clicks = new(32);
    private DispatcherTimer? _timer;
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly Random _rnd = new();
    private double _lastTick = -1;

    public bool IsPreview { get; set; }
    private Settings S => App.Inst.S;
    private long Now() => _clock.ElapsedMilliseconds;
    public void PostMove(Point p) { lock (_gate) _pendingMoves.Add(p); EnsureRunning(); }
    public void PostClick(Point p, int btn, bool down) { lock (_gate) _pendingClicks.Add((p, btn, down)); EnsureRunning(); }
    private void EnsureRunning() { if (_timer?.IsEnabled == true) return; Dispatcher.UIThread.Post(StartTimer); }
    private void StartTimer()
    {
        _timer ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
        if (_timer.IsEnabled) return;
        if (_timer.Tag == null) { _timer.Tick += (_, _) => Tick(); _timer.Tag = 1; }
        _lastTick = Now(); _timer.Start();
    }

    private void Tick()
    {
        long now = Now();
        double dt = _lastTick < 0 ? 0.016 : Math.Min((now - _lastTick) / 1000.0, 0.05);
        _lastTick = now;
        List<Point> moves; List<(Point P, int Btn, bool Down)> clicks;
        lock (_gate)
        {
            moves = _pendingMoves.Count > 0 ? new List<Point>(_pendingMoves) : s_emptyMoves;
            clicks = _pendingClicks.Count > 0 ? new List<(Point P, int Btn, bool Down)>(_pendingClicks) : s_emptyClicks;
            _pendingMoves.Clear(); _pendingClicks.Clear();
        }
        var s = S;
        foreach (var m in moves) AppendMove(m, s, now);
        foreach (var c in clicks) HandleClick(c.P, c.Btn, c.Down, s, now);
        if (moves.Count > 0 && _clicks.Any(c => c.ReleaseAt < 0))
        {
            var last = moves[^1];
            foreach (var c in _clicks) if (c.ReleaseAt < 0) c.P = last;
        }
        double life = s.TrailLifetime;
        _trail.RemoveAll(t => now - t.T > life);
        if (_trail.Count > 140) _trail.RemoveRange(0, _trail.Count - 140);
        for (int i = _micros.Count - 1; i >= 0; i--) { var q = _micros[i]; if (now - q.T0 > q.Life) { _micros.RemoveAt(i); continue; } q.P = new Point(q.P.X + q.V.X * dt, q.P.Y + q.V.Y * dt); q.V = new Point(q.V.X * 0.97, q.V.Y * 0.97); }
        _clicks.RemoveAll(c => c.ReleaseAt >= 0 && now - c.ReleaseAt > s.ClickExitDuration);
        for (int i = _clicks.Count - 1; i >= 0; i--) if (_clicks[i].ReleaseAt < 0 && now - _clicks[i].T0 > 30000) _clicks[i].ReleaseAt = now;
        if (_trail.Count == 0 && _micros.Count == 0 && _clicks.Count == 0) { _timer?.Stop(); InvalidateVisual(); return; }
        InvalidateVisual();
    }
    private static readonly List<Point> s_emptyMoves = new(0);
    private static readonly List<(Point P, int Btn, bool Down)> s_emptyClicks = new(0);

    private void AppendMove(Point p, Settings s, long now)
    {
        _trail.Add(new TrailPoint { P = p, T = now });
        if (s.Trail == TrailKind.Particles)
        {
            if (_rnd.NextDouble() < 0.42 * s.TrailDensity)
                _micros.Add(new Micro { P = new Point(p.X + (_rnd.NextDouble() - 0.5) * 6, p.Y + (_rnd.NextDouble() - 0.5) * 6), V = new Point((_rnd.NextDouble() - 0.5) * 18, (_rnd.NextDouble() - 0.5) * 18 - 4), T0 = now, Life = s.TrailLifetime * 0.85, C = s.TrailColor });
        }
    }
    private void HandleClick(Point p, int btn, bool down, Settings s, long now)
    {
        if (down)
        {
            bool enabled = btn switch { MouseHookService.BtnLeft => s.ClickLeft, MouseHookService.BtnRight => s.ClickRight, MouseHookService.BtnMiddle => s.ClickMiddle, _ => false };
            if (!enabled || s.ClickEffect == ClickFxKind.None) return;
            var col = btn switch { MouseHookService.BtnLeft => s.LeftColor, MouseHookService.BtnRight => s.RightColor, MouseHookService.BtnMiddle => s.MiddleColor, _ => s.LeftColor };
            var fx = new ClickFx { P = p, T0 = now, C = col, Btn = btn };
            if (s.ClickEffect == ClickFxKind.Burst) { fx.Angles = new double[8]; for (int i = 0; i < 8; i++) fx.Angles[i] = Math.PI * 2 * i / 8 + (_rnd.NextDouble() - 0.5) * 0.25; }
            _clicks.Add(fx);
        }
        else
        {
            for (int i = _clicks.Count - 1; i >= 0; i--) { var c = _clicks[i]; if (c.Btn == btn && c.ReleaseAt < 0) { c.ReleaseAt = now; break; } }
        }
    }

    public override void Render(DrawingContext ctx) { var s = S; long now = Now(); DrawTrail(ctx, s, now); DrawMicros(ctx, now); DrawClicks(ctx, s, now); }

    private void DrawTrail(DrawingContext ctx, Settings s, long now)
    {
        if (s.Trail == TrailKind.None || _trail.Count < 2) { if (s.Trail == TrailKind.Dots && _trail.Count >= 1) DrawDots(ctx, s, now); return; }
        switch (s.Trail)
        {
            case TrailKind.Brush: DrawBrush(ctx, s); break;
            case TrailKind.Ribbon: DrawRibbon(ctx, s); break;
            case TrailKind.Comet: DrawComet(ctx, s); break;
            case TrailKind.Dots: DrawDots(ctx, s, now); break;
            case TrailKind.Particles: DrawInk(ctx, s, now); break;
        }
    }

    private List<Point> Smooth()
    {
        if (_trail.Count < 3) return _trail.Select(t => t.P).ToList();
        var src = _trail.Select(t => t.P).ToList();
        var dst = new List<Point>((src.Count - 1) * 4 + 1);
        for (int i = 0; i < src.Count - 1; i++)
        {
            var p0 = i > 0 ? src[i - 1] : src[i];
            var p1 = src[i];
            var p2 = src[i + 1];
            var p3 = i + 2 < src.Count ? src[i + 2] : src[i + 1];
            for (int k = 0; k < 4; k++)
            {
                double t = k / 4.0;
                double tt = t * t, ttt = tt * t;
                double x = 0.5 * ((2 * p1.X) + (-p0.X + p2.X) * t + (2 * p0.X - 5 * p1.X + 4 * p2.X - p3.X) * tt + (-p0.X + 3 * p1.X - 3 * p2.X + p3.X) * ttt);
                double y = 0.5 * ((2 * p1.Y) + (-p0.Y + p2.Y) * t + (2 * p0.Y - 5 * p1.Y + 4 * p2.Y - p3.Y) * tt + (-p0.Y + 3 * p1.Y - 3 * p2.Y + p3.Y) * ttt);
                dst.Add(new Point(x, y));
            }
        }
        dst.Add(src[^1]);
        return dst;
    }

    /// 白色/纯色光滑曲线画笔流线（专为录屏演示打造，尾部自然收尖收细渐隐）
    private void DrawBrush(DrawingContext ctx, Settings s)
    {
        var pts = Smooth();
        if (pts.Count < 2) return;
        var col = s.TrailColor;
        double baseW = Math.Max(s.TrailSize, 1.5);
        int n = pts.Count;

        var left = new Point[n];
        var right = new Point[n];
        var widths = new double[n];
        var alphas = new double[n];

        for (int i = 0; i < n; i++)
        {
            double t = (double)i / (n - 1);
            // 尾部自然呈针尖般平滑渐细
            double w = baseW * Math.Pow(t, 1.35);
            widths[i] = w;
            alphas[i] = Math.Pow(t, 1.12);

            Point dir;
            if (i == 0) dir = new Point(pts[1].X - pts[0].X, pts[1].Y - pts[0].Y);
            else if (i == n - 1) dir = new Point(pts[n - 1].X - pts[n - 2].X, pts[n - 1].Y - pts[n - 2].Y);
            else dir = new Point(pts[i + 1].X - pts[i - 1].X, pts[i + 1].Y - pts[i - 1].Y);

            double len = Math.Sqrt(dir.X * dir.X + dir.Y * dir.Y);
            if (len < 0.001) { left[i] = pts[i]; right[i] = pts[i]; continue; }
            double nx = -dir.Y / len, ny = dir.X / len;
            left[i] = new Point(pts[i].X + nx * (w * 0.5), pts[i].Y + ny * (w * 0.5));
            right[i] = new Point(pts[i].X - nx * (w * 0.5), pts[i].Y - ny * (w * 0.5));
        }

        // 外层微晕轮廓（仅 1.5x 宽度，8% 透明度，提升浅色与深色录屏背景对比，克制不喧宾夺主）
        for (int i = 0; i < n - 1; i++)
        {
            double t = (double)i / (n - 1);
            if (t < 0.08) continue;
            double a = 0.09 * alphas[i];
            var seg = new StreamGeometry();
            using (var c = seg.Open())
            {
                double hw1 = widths[i] * 0.75, hw2 = widths[i + 1] * 0.75;
                Point dir = new Point(pts[i + 1].X - pts[i].X, pts[i + 1].Y - pts[i].Y);
                double len = Math.Max(0.001, Math.Sqrt(dir.X * dir.X + dir.Y * dir.Y));
                double nx = -dir.Y / len, ny = dir.X / len;
                c.BeginFigure(new Point(pts[i].X + nx * hw1, pts[i].Y + ny * hw1), true);
                c.LineTo(new Point(pts[i + 1].X + nx * hw2, pts[i + 1].Y + ny * hw2));
                c.LineTo(new Point(pts[i + 1].X - nx * hw2, pts[i + 1].Y - ny * hw2));
                c.LineTo(new Point(pts[i].X - nx * hw1, pts[i].Y - ny * hw1));
                c.EndFigure(true);
            }
            ctx.DrawGeometry(new SolidColorBrush(Easing.WithAlpha(col, a)), null, seg);
        }

        // 核心光滑画笔线段（沿曲线自然弯曲并平滑渐隐）
        for (int i = 0; i < n - 1; i++)
        {
            double a = 0.95 * alphas[i + 1];
            if (a < 0.015) continue;
            var seg = new StreamGeometry();
            using (var c = seg.Open())
            {
                c.BeginFigure(left[i], true);
                c.LineTo(left[i + 1]);
                c.LineTo(right[i + 1]);
                c.LineTo(right[i]);
                c.EndFigure(true);
            }
            ctx.DrawGeometry(new SolidColorBrush(Easing.WithAlpha(col, a)), null, seg);
        }

        // 头部圆润端点
        var head = pts[^1];
        double hr = baseW * 0.5;
        if (hr > 0.6)
        {
            ctx.DrawEllipse(new SolidColorBrush(Easing.WithAlpha(col, 0.98)), null,
                new Rect(head.X - hr, head.Y - hr, hr * 2, hr * 2));
        }
    }

    private static StreamGeometry BuildRibbon(List<Point> pts, Func<double, double> widthAt)
    {
        int n = pts.Count;
        if (n < 2) return new StreamGeometry();
        var left = new Point[n];
        var right = new Point[n];
        for (int i = 0; i < n; i++)
        {
            double t = n == 1 ? 1 : (double)i / (n - 1);
            double w = widthAt(t) * 0.5;
            Point dir;
            if (i == 0) dir = new Point(pts[1].X - pts[0].X, pts[1].Y - pts[0].Y);
            else if (i == n - 1) dir = new Point(pts[n - 1].X - pts[n - 2].X, pts[n - 1].Y - pts[n - 2].Y);
            else dir = new Point(pts[i + 1].X - pts[i - 1].X, pts[i + 1].Y - pts[i - 1].Y);
            double len = Math.Sqrt(dir.X * dir.X + dir.Y * dir.Y);
            if (len < 0.001) { left[i] = pts[i]; right[i] = pts[i]; continue; }
            double nx = -dir.Y / len, ny = dir.X / len;
            left[i] = new Point(pts[i].X + nx * w, pts[i].Y + ny * w);
            right[i] = new Point(pts[i].X - nx * w, pts[i].Y - ny * w);
        }
        var geo = new StreamGeometry();
        using (var c = geo.Open())
        {
            c.BeginFigure(left[0], true);
            for (int i = 1; i < n; i++) c.LineTo(left[i]);
            for (int i = n - 1; i >= 0; i--) c.LineTo(right[i]);
            c.EndFigure(true);
        }
        return geo;
    }

    private void DrawRibbon(DrawingContext ctx, Settings s)
    {
        var pts = Smooth(); if (pts.Count < 2) return;
        var col = s.TrailColor;
        double baseW = s.TrailSize * 0.65;
        var outer = BuildRibbon(pts, t => baseW * 1.5 * Math.Pow(t, 0.85) + 0.2);
        var inner = BuildRibbon(pts, t => baseW * Math.Pow(t, 0.9));
        ctx.DrawGeometry(new SolidColorBrush(Easing.WithAlpha(col, 0.12)), null, outer);
        ctx.DrawGeometry(new SolidColorBrush(Easing.WithAlpha(col, 0.92)), null, inner);
        var head = pts[^1];
        double r = baseW * 0.5 + 1.2;
        var g = new RadialGradientBrush { Center = new RelativePoint(0.5, 0.5, RelativeUnit.Relative), RadiusX = new RelativeScalar(0.5, RelativeUnit.Relative), RadiusY = new RelativeScalar(0.5, RelativeUnit.Relative), GradientStops = { new GradientStop(Easing.WithAlpha(Colors.White, 0.9), 0), new GradientStop(Easing.WithAlpha(col, 0.55), 0.5), new GradientStop(Easing.WithAlpha(col, 0), 1) } };
        ctx.DrawEllipse(g, null, new Rect(head.X - r, head.Y - r, r * 2, r * 2));
    }

    private void DrawComet(DrawingContext ctx, Settings s)
    {
        var pts = Smooth(); if (pts.Count < 2) return;
        var col = s.TrailColor;
        double baseW = s.TrailSize * 0.60;
        var tail = BuildRibbon(pts, t => baseW * Math.Pow(t, 3.2) * 1.0);
        ctx.DrawGeometry(new SolidColorBrush(Easing.WithAlpha(col, 0.08)), null, BuildRibbon(pts, t => baseW * Math.Pow(t, 3.2) * 2.0 + 0.3));
        ctx.DrawGeometry(new SolidColorBrush(Easing.WithAlpha(col, 0.95)), null, tail);
        var h = pts[^1];
        double r = s.TrailSize * 1.1 + 1.5;
        var g = new RadialGradientBrush { Center = new RelativePoint(0.5, 0.5, RelativeUnit.Relative), RadiusX = new RelativeScalar(0.5, RelativeUnit.Relative), RadiusY = new RelativeScalar(0.5, RelativeUnit.Relative), GradientStops = { new GradientStop(Colors.White, 0), new GradientStop(Easing.WithAlpha(col, 0.85), 0.28), new GradientStop(Easing.WithAlpha(col, 0.20), 0.62), new GradientStop(Easing.WithAlpha(col, 0), 1) } };
    }

    private void DrawDots(DrawingContext ctx, Settings s, long now)
    {
        double life = s.TrailLifetime; var col = s.TrailColor;
        int step = Math.Max(1, _trail.Count > 80 ? 2 : 1);
        for (int i = 0; i < _trail.Count; i += step)
        {
            var t = _trail[i]; double age = Math.Clamp((now - t.T) / life, 0, 1); double f = Math.Pow(1 - age, 1.2); if (f < 0.05) continue;
            double r = s.TrailSize * 0.42 * f; if (r < 1) continue;
            var g = new RadialGradientBrush { Center = new RelativePoint(0.5, 0.5, RelativeUnit.Relative), RadiusX = new RelativeScalar(0.5, RelativeUnit.Relative), RadiusY = new RelativeScalar(0.5, RelativeUnit.Relative), GradientStops = { new GradientStop(Easing.WithAlpha(Colors.White, 0.88 * f), 0), new GradientStop(Easing.WithAlpha(col, 0.72 * f), 0.45), new GradientStop(Easing.WithAlpha(col, 0), 1) } };
            ctx.DrawEllipse(g, null, new Rect(t.P.X - r, t.P.Y - r, r * 2, r * 2));
        }
    }

    private void DrawInk(DrawingContext ctx, Settings s, long now)
    {
        double life = s.TrailLifetime; var col = s.TrailColor;
        var pts = Smooth();
        for (int i = 0; i < pts.Count; i += 3)
        {
            double t = (double)i / pts.Count; double f = Math.Pow(t, 1.4); if (f < 0.08) continue;
            double r = s.TrailSize * 0.55 * f + 0.8;
            var g = new RadialGradientBrush { Center = new RelativePoint(0.5, 0.5, RelativeUnit.Relative), RadiusX = new RelativeScalar(0.5, RelativeUnit.Relative), RadiusY = new RelativeScalar(0.5, RelativeUnit.Relative), GradientStops = { new GradientStop(Easing.WithAlpha(col, 0.32 * f), 0), new GradientStop(Easing.WithAlpha(col, 0.10 * f), 0.55), new GradientStop(Easing.WithAlpha(col, 0), 1) } };
            var p = pts[i];
            ctx.DrawEllipse(g, null, new Rect(p.X - r, p.Y - r, r * 2, r * 2));
        }
        foreach (var w in _trail.Skip(Math.Max(0, _trail.Count - 6)))
        {
            double age = Math.Clamp((now - w.T) / life, 0, 1); double f = 1 - age;
            if (f < 0.1) continue;
            double r = s.TrailSize * 0.18 * f;
            ctx.DrawEllipse(new SolidColorBrush(Easing.WithAlpha(col, 0.85 * f)), null, new Rect(w.P.X - r, w.P.Y - r, r * 2, r * 2));
        }
    }

    private void DrawMicros(DrawingContext ctx, long now)
    {
        foreach (var m in _micros)
        {
            double t = Math.Clamp((now - m.T0) / m.Life, 0, 1); double f = Math.Pow(1 - t, 1.4); if (f < 0.04) continue;
            double r = 1.8 * f;
            ctx.DrawEllipse(new SolidColorBrush(Easing.WithAlpha(m.C, 0.50 * f)), null, new Rect(m.P.X - r, m.P.Y - r, r * 2, r * 2));
        }
    }

    private void DrawClicks(DrawingContext ctx, Settings s, long now)
    {
        double enterMs = s.ClickEnterDuration;
        double exitMs = s.ClickExitDuration;
        foreach (var fx in _clicks)
        {
            bool held = fx.ReleaseAt < 0;
            double enterT = Math.Clamp((now - fx.T0) / enterMs, 0, 1);
            double enterE = Easing.Evaluate(EasingKind.OutCubic, enterT);
            if (held)
            {
                double a = 0.88 * enterE;
                bool isPulse = s.ClickEffect == ClickFxKind.Pulse;
                double ee = isPulse ? 1.35 - 0.35 * enterE : enterE;
                switch (s.ClickEffect)
                {
                    case ClickFxKind.Ripple:
                        Ring(ctx, fx.P, s.ClickSize * 0.52 * ee, s.RingThickness, Easing.WithAlpha(fx.C, a));
                        Dot(ctx, fx.P, s.ClickSize * 0.09 * ee, Easing.WithAlpha(fx.C, 0.35 * enterE)); break;
                    case ClickFxKind.DoubleRipple:
                        Ring(ctx, fx.P, s.ClickSize * 0.52 * ee, s.RingThickness, Easing.WithAlpha(fx.C, a)); break;
                    case ClickFxKind.Halo:
                        { double r = s.ClickSize * 0.62 * ee; var g = new RadialGradientBrush { Center = new RelativePoint(0.5, 0.5, RelativeUnit.Relative), RadiusX = new RelativeScalar(0.5, RelativeUnit.Relative), RadiusY = new RelativeScalar(0.5, RelativeUnit.Relative), GradientStops = { new GradientStop(Easing.WithAlpha(fx.C, 0), 0.35), new GradientStop(Easing.WithAlpha(fx.C, 0.22 * enterE), 0.62), new GradientStop(Easing.WithAlpha(fx.C, 0.08 * enterE), 0.82), new GradientStop(Easing.WithAlpha(fx.C, 0), 1) } }; ctx.DrawEllipse(g, null, new Rect(fx.P.X - r, fx.P.Y - r, r * 2, r * 2)); Ring(ctx, fx.P, s.ClickSize * 0.42 * ee, 1.0, Easing.WithAlpha(fx.C, 0.35 * enterE)); } break;
                    case ClickFxKind.Burst:
                        { for (int i = 0; i < fx.Angles.Length; i++) { double d = s.ClickSize * 0.22 * ee; var pos = new Point(fx.P.X + Math.Cos(fx.Angles[i]) * d, fx.P.Y + Math.Sin(fx.Angles[i]) * d); double rr = s.ClickSize * 0.07 * ee; ctx.DrawEllipse(new SolidColorBrush(Easing.WithAlpha(fx.C, 0.95 * enterE)), null, new Rect(pos.X - rr, pos.Y - rr, rr * 2, rr * 2)); } Dot(ctx, fx.P, s.ClickSize * 0.07 * ee, Easing.WithAlpha(fx.C, 0.5 * enterE)); } break;
                    case ClickFxKind.Pulse:
                        { double pr = s.ClickSize * 0.38 * ee; ctx.DrawEllipse(new SolidColorBrush(Easing.WithAlpha(fx.C, 0.28 * enterE)), null, new Rect(fx.P.X - pr, fx.P.Y - pr, pr * 2, pr * 2)); Ring(ctx, fx.P, s.ClickSize * 0.52 * ee, s.RingThickness * 0.9, Easing.WithAlpha(fx.C, 0.75 * enterE)); } break;
                }
                continue;
            }
            double t = Math.Clamp((now - fx.ReleaseAt) / exitMs, 0, 1); if (t >= 1) continue;
            double relE = Easing.Evaluate(EasingKind.OutCubic, t);
            double f = Math.Pow(1 - t, 1.15);
            bool isPulseRel = s.ClickEffect == ClickFxKind.Pulse;
            double startEraw = Easing.Evaluate(EasingKind.OutCubic, Math.Clamp((fx.ReleaseAt - fx.T0) / enterMs, 0, 1));
            double startE = isPulseRel ? 1.35 - 0.35 * startEraw : startEraw;
            double startA = 0.88 * startEraw;
            double ee2 = startE + (1.32 - startE) * relE;
            double thin = 1 - t * 0.55;
            switch (s.ClickEffect)
            {
                case ClickFxKind.Ripple:
                    Ring(ctx, fx.P, s.ClickSize * 0.52 * ee2, s.RingThickness * thin, Easing.WithAlpha(fx.C, startA * f));
                    Dot(ctx, fx.P, s.ClickSize * 0.09 * (1 - t * 0.7) * Math.Max(startEraw, 0.6), Easing.WithAlpha(fx.C, 0.35 * f * startEraw)); break;
                case ClickFxKind.DoubleRipple:
                    Ring(ctx, fx.P, s.ClickSize * 0.52 * ee2, s.RingThickness * thin, Easing.WithAlpha(fx.C, startA * f));
                    { double t2 = Math.Clamp((t - 0.18) / 0.82, 0, 1); if (t2 > 0) { double e2 = Easing.Evaluate(EasingKind.OutCubic, t2); Ring(ctx, fx.P, s.ClickSize * 0.36 * e2, s.RingThickness * 0.85 * (1 - t2 * 0.6), Easing.WithAlpha(fx.C, Math.Pow(1 - t2, 1.2) * 0.55 * f * startEraw)); } } break;
                case ClickFxKind.Halo:
                    { double r = s.ClickSize * 0.62 * ee2; var g = new RadialGradientBrush { Center = new RelativePoint(0.5, 0.5, RelativeUnit.Relative), RadiusX = new RelativeScalar(0.5, RelativeUnit.Relative), RadiusY = new RelativeScalar(0.5, RelativeUnit.Relative), GradientStops = { new GradientStop(Easing.WithAlpha(fx.C, 0), 0.35), new GradientStop(Easing.WithAlpha(fx.C, 0.22 * f * startEraw), 0.62), new GradientStop(Easing.WithAlpha(fx.C, 0.08 * f * startEraw), 0.82), new GradientStop(Easing.WithAlpha(fx.C, 0), 1) } }; ctx.DrawEllipse(g, null, new Rect(fx.P.X - r, fx.P.Y - r, r * 2, r * 2)); Ring(ctx, fx.P, s.ClickSize * 0.42 * ee2, 1.0 * thin, Easing.WithAlpha(fx.C, 0.35 * f * startEraw)); } break;
                case ClickFxKind.Burst:
                    { for (int i = 0; i < fx.Angles.Length; i++) { double d = s.ClickSize * (0.22 * startE + 0.26 * relE); var pos = new Point(fx.P.X + Math.Cos(fx.Angles[i]) * d, fx.P.Y + Math.Sin(fx.Angles[i]) * d); double rr = Math.Max(s.ClickSize * 0.07 * (1 - t * 0.5), 1.0) * Math.Max(startEraw, 0.7); ctx.DrawEllipse(new SolidColorBrush(Easing.WithAlpha(fx.C, f * startEraw)), null, new Rect(pos.X - rr, pos.Y - rr, rr * 2, rr * 2)); } Dot(ctx, fx.P, s.ClickSize * 0.07 * (1 - t) * Math.Max(startEraw, 0.7), Easing.WithAlpha(fx.C, f * 0.5 * startEraw)); } break;
                case ClickFxKind.Pulse:
                    { double pr = s.ClickSize * 0.38 * ee2; ctx.DrawEllipse(new SolidColorBrush(Easing.WithAlpha(fx.C, 0.28 * f * startEraw)), null, new Rect(fx.P.X - pr, fx.P.Y - pr, pr * 2, pr * 2)); Ring(ctx, fx.P, s.ClickSize * 0.52 * ee2, s.RingThickness * 0.9 * thin, Easing.WithAlpha(fx.C, 0.75 * f * startEraw)); } break;
            }
        }
    }
    private static void Ring(DrawingContext ctx, Point c, double r, double thick, Color col) { if (r < 0.5 || thick < 0.3) return; ctx.DrawEllipse(null, new Pen(new SolidColorBrush(col), thick, null, PenLineCap.Round, PenLineJoin.Round), new Rect(c.X - r, c.Y - r, r * 2, r * 2)); }
    private static void Dot(DrawingContext ctx, Point c, double r, Color col) { if (r < 0.6) return; ctx.DrawEllipse(new SolidColorBrush(col), null, new Rect(c.X - r, c.Y - r, r * 2, r * 2)); }
}
