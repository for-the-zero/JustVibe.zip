using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Keyeal.Interop;

namespace Keyeal.Services;

/// 透明、置顶、点击穿透、不抢焦点的覆盖窗口基类
public abstract class OverlayWindowBase : Window
{
    protected OverlayWindowBase()
    {
        SystemDecorations = SystemDecorations.None;
        TransparencyLevelHint = new[] { WindowTransparencyLevel.Transparent };
        Background = Brushes.Transparent;
        TransparencyBackgroundFallback = Brushes.Transparent;
        ShowInTaskbar = false;
        ShowActivated = false;
        CanResize = false;
        Topmost = true;
        Focusable = false;
        Title = "Keyeal Overlay";
    }

    protected override void OnOpened(EventArgs e)
    {
        base.OnOpened(e);
        var hwnd = TryGetPlatformHandle()?.Handle ?? IntPtr.Zero;
        if (hwnd == IntPtr.Zero) return;

        int ex = (int)NativeMethods.GetWindowLongPtr(hwnd, NativeMethods.GWL_EXSTYLE);
        NativeMethods.SetWindowLongPtr(hwnd, NativeMethods.GWL_EXSTYLE, new IntPtr(
            ex | NativeMethods.WS_EX_TRANSPARENT
               | NativeMethods.WS_EX_LAYERED
               | NativeMethods.WS_EX_NOACTIVATE
               | NativeMethods.WS_EX_TOOLWINDOW));

        int off = 1;
        NativeMethods.DwmSetWindowAttribute(hwnd, NativeMethods.DWMWA_TRANSITIONS_FORCEDISABLED, ref off, 4);
    }
}

public sealed record ScreenEntry(PixelRect Bounds, double Scale, bool IsPrimary);
