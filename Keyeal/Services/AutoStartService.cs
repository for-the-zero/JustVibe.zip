using System.Diagnostics;
using Microsoft.Win32;

namespace Keyeal.Services;

/// 开机自启：优先“任务计划程序”（保留最高权限、不弹 UAC），失败则回退 HKCU Run
internal static class AutoStartService
{
    private const string TaskName = "Keyeal";

    public static void Apply(bool enable)
    {
        try
        {
            if (enable) Create();
            else Remove();
        }
        catch (Exception ex)
        {
            Log.Error("autostart: " + ex);
        }
    }

    private static void Create()
    {
        var exe = Environment.ProcessPath;
        if (string.IsNullOrEmpty(exe)) return;

        Remove();

        // 计划任务方式：登录时以最高权限启动，避免每次开机弹 UAC
        var psi = new ProcessStartInfo
        {
            FileName = "schtasks",
            Arguments = $"/Create /TN \"{TaskName}\" /TR \"\\\"{exe}\\\"\" /SC ONLOGON /RL HIGHEST /F",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using (var p = Process.Start(psi))
            p?.WaitForExit(8000);

        if (Exists()) return;

        // 回退：HKCU Run
        using var run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
        run?.SetValue(TaskName, $"\"{exe}\"");
    }

    private static void Remove()
    {
        var psi = new ProcessStartInfo
        {
            FileName = "schtasks",
            Arguments = $"/Delete /TN \"{TaskName}\" /F",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using (var p = Process.Start(psi))
            p?.WaitForExit(5000);

        using var run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
        run?.DeleteValue(TaskName, false);
    }

    public static bool Exists()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "schtasks",
                Arguments = $"/Query /TN \"{TaskName}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
            };
            using var p = Process.Start(psi);
            return p is { } && p.WaitForExit(5000) && p.ExitCode == 0;
        }
        catch { return false; }
    }
}
