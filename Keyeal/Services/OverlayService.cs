using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Threading;
using Keyeal.Interop;
using Keyeal.Models;
using Keyeal.Rendering;

namespace Keyeal.Services;

/// <summary>
/// 覆盖层总管：每个显示器一个鼠标特效窗口；轨道窗口在目标屏幕上。
/// 钩子线程按物理坐标查表路由到对应窗口（换算成该屏 DIP）。
/// </summary>
public sealed class OverlayService : IDisposable
{
    private readonly App _app;
    private Window? _probe;
    private TrackWindow? _track;
    private DispatcherTimer? _screenTimer;
    private string _screensSignature = "";

    private sealed record ScreenMap(ScreenEntry[] Entries, MouseWindow[] Windows);

    private volatile ScreenMap? _map;

    // 钩子线程读取的镜像开关（避免跨线程触碰 INPC 对象）
    private volatile bool _trackOn = true;
    private volatile bool _trailOn = true;
    private volatile int _clickButtons = 0b111;
    private NativeMethods.POINT _lastMousePt;

    private Settings S => _app.S;

    public OverlayService(App app) => _app = app;

    public void Initialize()
    {
        _probe = new Window
        {
            Width = 1,
            Height = 1,
            ShowInTaskbar = false,
            ShowActivated = false,
            SystemDecorations = SystemDecorations.None,
            TransparencyLevelHint = new[] { WindowTransparencyLevel.Transparent },
            Background = Brushes.Transparent,
            Title = "Keyeal Probe",
        };
        _probe.Opened += (_, _) =>
        {
            try
            {
                var h = _probe.TryGetPlatformHandle()?.Handle ?? IntPtr.Zero;
                if (h != IntPtr.Zero)
                {
                    int ex = (int)NativeMethods.GetWindowLongPtr(h, NativeMethods.GWL_EXSTYLE);
                    NativeMethods.SetWindowLongPtr(h, NativeMethods.GWL_EXSTYLE, new IntPtr(ex | NativeMethods.WS_EX_TOOLWINDOW | NativeMethods.WS_EX_NOACTIVATE | NativeMethods.WS_EX_TRANSPARENT));
                }
            }
            catch { }
            RebuildScreens();
            ApplyVisibility();
        };
        _probe.Show();

        RebuildScreens();

        _screenTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        _screenTimer.Tick += (_, _) =>
        {
            RebuildScreens();
            ReassertTopmost();
        };
        _screenTimer.Start();

        S.PropertyChanged += (_, _) =>
        {
            RefreshMirrors();
            ApplyVisibility();
        };

        RefreshMirrors();
        ApplyVisibility();
    }

    // ------------------------------------------------------------ 镜像与可见性

    public void RefreshMirrors()
    {
        _trackOn = S.Enabled && S.ShowKeyTrack;
        _trailOn = S.Enabled && S.MouseEnabled && S.Trail != TrailKind.None;
        _clickButtons =
            (S.Enabled && S.MouseEnabled && S.ClickLeft ? 1 : 0) |
            (S.Enabled && S.MouseEnabled && S.ClickRight ? 2 : 0) |
            (S.Enabled && S.MouseEnabled && S.ClickMiddle ? 4 : 0);
    }

    public void ApplyVisibility()
    {
        if (_trackOn) EnsureTrackWindow(force: true);
        else _track?.Hide();

        if (_map is { } map)
        {
            bool mouseVisible = _trailOn || _clickButtons != 0;
            foreach (var w in map.Windows)
            {
                if (!mouseVisible) w.Hide();
                else if (!w.IsVisible) w.Show();
            }
        }
    }

    // ------------------------------------------------------------ 屏幕管理

    private void RebuildScreens()
    {
        var all = _probe?.Screens?.All;
        ScreenEntry[] entries;

        if (all is { Count: > 0 })
        {
            var sig = string.Join(";", all.Select(s => $"{s.Bounds}:{s.Scaling:0.##}"));
            if (sig == _screensSignature && _map is { }) return;
            _screensSignature = sig;
            entries = all.Select(s => new ScreenEntry(s.Bounds, s.Scaling, s.IsPrimary)).ToArray();
        }
        else
        {
            if (_map is { }) return;
            // 兜底：主屏幕默认分辨率
            entries = new[] { new ScreenEntry(new PixelRect(0, 0, 1920, 1080), 1.0, true) };
        }

        foreach (var w in _map?.Windows ?? Array.Empty<MouseWindow>())
            w.Close();

        Log.Info($"重建鼠标特效窗口 x{entries.Length}");
        var windows = new MouseWindow[entries.Length];
        for (int i = 0; i < entries.Length; i++)
        {
            var w = new MouseWindow();
            w.FitTo(entries[i]);
            if (_trailOn || _clickButtons != 0) w.Show();
            windows[i] = w;
        }
        _map = new ScreenMap(entries, windows);

        if (_track is { } t && _trackOn)
        {
            var target = TargetScreenForTrack();
            if (t.CurrentBounds != target.Bounds) t.FitTo(target);
        }
    }

    private void ReassertTopmost()
    {
        // 注意：不要频繁翻转 Topmost——反复 false→true 会重建交换链，
        // 在 Win32 组合场景下可能让窗口停止提交新帧（画面冻结为最后一帧）。
        // 仅当窗口被系统意外取消置顶时做一次低频校正。
        void Ensure(OverlayWindowBase w)
        {
            try
            {
                var hwnd = w.TryGetPlatformHandle()?.Handle ?? IntPtr.Zero;
                if (hwnd == IntPtr.Zero) return;
                int style = (int)NativeMethods.GetWindowLongPtr(hwnd, NativeMethods.GWL_EXSTYLE);
                const int WS_EX_TOPMOST = 0x00000008;
                bool topmost = (style & WS_EX_TOPMOST) != 0;
                if (!topmost) w.Topmost = true;
            }
            catch { }
        }

        if (_track is { IsVisible: true } t)
            Ensure(t);
        if (_map is { } map)
            foreach (var w in map.Windows)
                Ensure(w);
    }

    private ScreenEntry TargetScreenForTrack()
    {
        var map = _map;
        if (map is null || map.Entries.Length == 0)
            return new ScreenEntry(new PixelRect(0, 0, 1920, 1080), 1.0, true);
        if (S.TrackScreen == TrackScreenMode.FollowMouse)
        {
            var pt = new PixelPoint(_lastMousePt.X, _lastMousePt.Y);
            foreach (var e in map.Entries)
                if (e.Bounds.Contains(pt)) return e;
        }
        return map.Entries.FirstOrDefault(e => e.IsPrimary) ?? map.Entries[0];
    }

    private void EnsureTrackWindow(bool force = false)
    {
        var target = TargetScreenForTrack();
        if (_track is null)
        {
            _track = new TrackWindow();
            _track.FitTo(target);
            _track.Show();
            Log.Info($"轨道窗口已创建: bounds={target.Bounds} scale={target.Scale:0.##}");
        }
        else if (force || _track.CurrentBounds != target.Bounds)
        {
            if (_track.CurrentBounds != target.Bounds)
                _track.Renderer.HandleBoundsChanged();
            _track.FitTo(target);
            if (!_track.IsVisible) _track.Show();
        }
    }

    // ------------------------------------------------------------ 事件路由

    /// 键盘事件（UI 线程）
    private bool _loggedFirstKey;

    public void DispatchKey(KeyDisplayEvent e)
    {
        if (!_trackOn) return;
        if (!_loggedFirstKey)
        {
            _loggedFirstKey = true;
            Log.Info($"DispatchKey 首次: '{e.DisplayText}' down={e.IsDown}");
        }
        EnsureTrackWindow();
        _track!.Renderer.HandleKey(e);
    }

    public void DispatchMouseMove(NativeMethods.POINT pt)
    {
        _lastMousePt = pt;
        if (!_trailOn && _clickButtons == 0) return;
        bool doTrail = _trailOn;
        var map = _map;
        if (map is null || map.Windows.Length == 0) return;

        var ptPixel = new PixelPoint(pt.X, pt.Y);
        for (int i = 0; i < map.Entries.Length; i++)
        {
            var e = map.Entries[i];
            if (!e.Bounds.Contains(ptPixel)) continue;
            map.Windows[i].Layer.PostMove(new Point(
                (pt.X - e.Bounds.X) / e.Scale,
                (pt.Y - e.Bounds.Y) / e.Scale));
            return;
        }

        // 越界保护：回退到第 0 个窗口
        var e0 = map.Entries[0];
        map.Windows[0].Layer.PostMove(new Point(
            (pt.X - e0.Bounds.X) / e0.Scale,
            (pt.Y - e0.Bounds.Y) / e0.Scale));
    }

    public void DispatchMouseClick(NativeMethods.POINT pt, int button, bool down)
    {
        int bit = button switch { 0 => 1, 1 => 2, 2 => 4, _ => 0 };
        if (bit == 0) return;
        if (down && (_clickButtons & bit) == 0) return;
        var map = _map;
        if (map is null || map.Windows.Length == 0) return;

        var ptPixel = new PixelPoint(pt.X, pt.Y);
        for (int i = 0; i < map.Entries.Length; i++)
        {
            var e = map.Entries[i];
            if (!e.Bounds.Contains(ptPixel)) continue;
            map.Windows[i].Layer.PostClick(new Point(
                (pt.X - e.Bounds.X) / e.Scale,
                (pt.Y - e.Bounds.Y) / e.Scale), button, down);
            return;
        }

        var e02 = map.Entries[0];
        map.Windows[0].Layer.PostClick(new Point(
            (pt.X - e02.Bounds.X) / e02.Scale,
            (pt.Y - e02.Bounds.Y) / e02.Scale), button, down);
    }

    // ------------------------------------------------------------ 演示通道

    public void Dispose()
    {
        _screenTimer?.Stop();
        if (_map is { } map)
            foreach (var w in map.Windows)
                w.Close();
        _track?.Close();
        _probe?.Close();
    }
}
