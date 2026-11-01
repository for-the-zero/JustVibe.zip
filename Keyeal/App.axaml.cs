using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using Keyeal.Models;
using Keyeal.Rendering;
using Keyeal.Services;
using Keyeal.Views;

namespace Keyeal;

public sealed class App : Application
{
    public static App Inst { get; private set; } = null!;

    public SettingsService SettingsService { get; private set; } = null!;
    public Settings S => SettingsService.Current;

    public KeyboardHookService KeyboardHook { get; private set; } = null!;
    public MouseHookService MouseHook { get; private set; } = null!;
    public OverlayService Overlays { get; private set; } = null!;

    private TrayIcon? _tray;
    private NativeMenuItem? _miTrack;
    private NativeMenuItem? _miMouse;
    private NativeMenuItem? _miAutoStart;
    private bool _realExit;

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
        Inst = this;
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            desktop.ShutdownMode = ShutdownMode.OnExplicitShutdown; // 关闭窗口≠退出，常驻托盘

        Dispatcher.UIThread.UnhandledException += (_, e) =>
        {
            Log.Error("UI线程异常: " + e.Exception);
            e.Handled = true;
        };

        SettingsService = new SettingsService();
        SettingsService.Load();

        KeyboardHook = new KeyboardHookService();
        MouseHook = new MouseHookService();

        // 键盘事件 → UI 线程（钩子线程只做转发，绝不阻塞）
        KeyboardHook.Key += e => Dispatcher.UIThread.Post(() => Overlays.DispatchKey(e));

        // 鼠标事件在钩子线程内直接路由（内部为无锁队列，UI 线程按帧消费）
        MouseHook.Move += pt => Overlays.DispatchMouseMove(pt);
        MouseHook.Click += (pt, btn, down) => Overlays.DispatchMouseClick(pt, btn, down);

        // 安装全局钩子（常驻；是否生效由开关在分发层决定）
        KeyboardHook.Start();
        MouseHook.Start();

        Overlays = new OverlayService(this);
        Overlays.Initialize();

        SetupTray();
        ApplyHookState();

        var args = Environment.GetCommandLineArgs();
        if (args.Any(a => a.Equals("--settings", StringComparison.OrdinalIgnoreCase)))
            Dispatcher.UIThread.Post(ShowSettings);

        base.OnFrameworkInitializationCompleted();
    }

    // ---------------------------------------------------------------- 托盘

    private void SetupTray()
    {
        WindowIcon icon;
        using (var stream = AssetLoader.Open(new Uri("avares://Keyeal/Assets/icon32.png")))
            icon = new WindowIcon(stream);

        var menu = new NativeMenu();

        _miTrack = new NativeMenuItem("键盘可视化") { ToggleType = NativeMenuItemToggleType.CheckBox, IsChecked = S.ShowKeyTrack };
        _miTrack.Click += (_, _) => { S.ShowKeyTrack = !S.ShowKeyTrack; ApplyHookState(); };
        menu.Add(_miTrack);

        _miMouse = new NativeMenuItem("鼠标特效") { ToggleType = NativeMenuItemToggleType.CheckBox, IsChecked = S.MouseEnabled };
        _miMouse.Click += (_, _) => { S.MouseEnabled = !S.MouseEnabled; ApplyHookState(); };
        menu.Add(_miMouse);

        menu.Add(new NativeMenuItemSeparator());

        var miSettings = new NativeMenuItem("设置…");
        miSettings.Click += (_, _) => ShowSettings();
        menu.Add(miSettings);

        menu.Add(new NativeMenuItemSeparator());

        _miAutoStart = new NativeMenuItem("开机自启") { ToggleType = NativeMenuItemToggleType.CheckBox, IsChecked = S.AutoStart };
        _miAutoStart.Click += (_, _) => { S.AutoStart = !S.AutoStart; AutoStartService.Apply(S.AutoStart); };
        menu.Add(_miAutoStart);

        menu.Add(new NativeMenuItemSeparator());

        var miExit = new NativeMenuItem("退出");
        miExit.Click += (_, _) => ExitApp();
        menu.Add(miExit);

        _tray = new TrayIcon
        {
            Icon = icon,
            ToolTipText = "Keyeal · 键盘可视化",
            Menu = menu,
            IsVisible = true,
        };
        var icons = new TrayIcons();
        icons.Add(_tray);
        TrayIcon.SetIcons(this, icons);
    }

    private void ApplyHookState()
    {
        KeyboardHook.IgnoreInjected = S.IgnoreInjected;
        Overlays.RefreshMirrors();
        Overlays.ApplyVisibility();
        if (_miTrack is { } mi) mi.IsChecked = S.ShowKeyTrack;
        if (_miMouse is { } mm) mm.IsChecked = S.MouseEnabled;
        if (_miAutoStart is { } ma) ma.IsChecked = S.AutoStart;
        SettingsService.RequestSave();
    }

    // ---------------------------------------------------------------- 设置窗口

    public void ShowSettings()
    {
        var desktop = (ApplicationLifetime as IClassicDesktopStyleApplicationLifetime);
        var existing = desktop?.Windows.OfType<SettingsWindow>().FirstOrDefault();
        if (existing is { })
        {
            existing.Show();
            existing.Activate();
            existing.WindowState = WindowState.Normal;
            return;
        }
        var win = new SettingsWindow();
        win.Show();
    }

    public void ExitApp()
    {
        _realExit = true;
        try
        {
            KeyboardHook.Dispose();
            MouseHook.Dispose();
            Overlays.Dispose();
            SettingsService.SaveNow();
        }
        catch (Exception ex) { Log.Error("exit: " + ex); }

        var desktop = ApplicationLifetime as IClassicDesktopStyleApplicationLifetime;
        _tray?.Dispose();
        TrayIcon.SetIcons(this, new TrayIcons());
        desktop?.Shutdown();
    }

    /// 设置窗口关闭时仅隐藏，真正退出走托盘“退出”
    public bool ShouldCancelClose(Window w)
    {
        if (_realExit) return false;
        w.Hide();
        return true;
    }
}
