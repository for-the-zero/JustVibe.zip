using System.Diagnostics;
using System.Security.Principal;

namespace Keyeal.Services;

internal static class ElevationService
{
    public static bool IsElevated()
    {
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch { return false; }
    }

    /// 通过 ShellExecute "runas" 拉起提权实例；用户拒绝 UAC 时返回 false
    public static bool TryRelaunchElevated(string[] args)
    {
        try
        {
            var exe = Environment.ProcessPath;
            if (string.IsNullOrEmpty(exe)) return false;
            var psi = new ProcessStartInfo
            {
                FileName = exe,
                UseShellExecute = true,
                Verb = "runas",
            };
            foreach (var a in args)
                psi.ArgumentList.Add(a);
            Process.Start(psi);
            return true;
        }
        catch (Exception ex)
        {
            Log.Error("relaunch elevated: " + ex);
            return false;
        }
    }
}
