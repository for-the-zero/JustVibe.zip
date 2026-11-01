using System.Diagnostics;
using Avalonia;
using Keyeal.Interop;
using Keyeal.Services;

namespace Keyeal;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        Log.Init();

        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            Log.Error("Unhandled: " + e.ExceptionObject);
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            Log.Error("UnobservedTask: " + e.Exception);
            e.SetObserved();
        };

        // 管理员权限门槛：低级钩子只有提权后才能捕获其它提权程序的输入。
        // KEYEAL_SKIP_ADMIN=1 仅供开发调试（配合 dotnet exec 运行 dll）。
        bool skipAdmin = Environment.GetEnvironmentVariable("KEYEAL_SKIP_ADMIN") == "1";
        if (!ElevationService.IsElevated())
        {
            if (!skipAdmin)
            {
                if (!ElevationService.TryRelaunchElevated(args))
                {
                    NativeMethods.MessageBoxW(IntPtr.Zero,
                        "Keyeal 必须以管理员身份运行。\n\n" +
                        "只有提权后，键盘可视化才能监听到其它提权程序（如任务管理器、UAC 对话框）中的按键。",
                        "Keyeal", 0x40 /* MB_ICONINFORMATION */);
                    return 1;
                }
                return 0; // 已拉起提权实例
            }
            Log.Warn("DEV: running without admin; keystrokes of elevated apps will NOT be captured.");
        }

        using var mutex = new Mutex(true, @"Local\Keyeal.SingleInstance", out bool isNew);
        if (!isNew)
        {
            NativeMethods.MessageBoxW(IntPtr.Zero, "Keyeal 已经在运行了（请查看系统托盘）。", "Keyeal", 0x40);
            return 0;
        }

        try
        {
            BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        }
        catch (Exception ex)
        {
            Log.Error("Fatal: " + ex);
            throw;
        }
        return 0;
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>()
        .UsePlatformDetect()
        .With(new Avalonia.Win32PlatformOptions
        {
            // AngleEgl 在部分环境会静默停止提交帧（窗口黑屏/画面冻结），软件渲染对本应用的绘制量完全够用且稳定
            RenderingMode = new[] { Avalonia.Win32RenderingMode.Software },
        })
        .WithInterFont()
        .LogToTrace();
}
