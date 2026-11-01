using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace VertualKb;

/// <summary>Win32 键盘注入与窗口样式，把按键发给当前前台窗口。</summary>
internal static class WinApi
{
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_SCANCODE = 0x0008;

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public nint dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk, wScan;
        public uint dwFlags, time;
        public nint dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUTUNION
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public INPUTUNION U;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(nint hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern uint MapVirtualKeyW(uint uCode, uint uMapType);

    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_NOACTIVATE = 0x08000000;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int WS_EX_TOPMOST = 0x00000008;

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern nint GetWindowLongPtrW(nint hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern nint SetWindowLongPtrW(nint hWnd, int nIndex, nint dwNewLong);

    private static void SendKey(ushort vk, uint extraFlags)
    {
        // 用扫描码模式（和真实键盘一致），微软拼音等 TSF 输入法才能稳定接管
        var scan = (ushort)MapVirtualKeyW(vk, 0 /* MAPVK_VK_TO_VSC */);
        var input = new INPUT
        {
            type = INPUT_KEYBOARD,
            U = new INPUTUNION
            {
                ki = new KEYBDINPUT
                {
                    wVk = 0,
                    wScan = scan,
                    dwFlags = extraFlags | KEYEVENTF_SCANCODE,
                },
            },
        };
        _ = SendInput(1, new[] { input }, System.Runtime.InteropServices.Marshal.SizeOf<INPUT>());
    }

    public static void KeyDown(ushort vk, bool extended = false) =>
        SendKey(vk, extended ? KEYEVENTF_EXTENDEDKEY : 0);

    public static void KeyUp(ushort vk, bool extended = false) =>
        SendKey(vk, KEYEVENTF_KEYUP | (extended ? KEYEVENTF_EXTENDEDKEY : 0));

    public static void KeyTap(ushort vk, bool extended = false)
    {
        KeyDown(vk, extended);
        KeyUp(vk, extended);
    }

    /// <summary>让窗口不抢焦点：点击键盘时，前台窗口（游戏/串流目标）保持焦点。</summary>
    public static void MakeNoActivate(nint hwnd)
    {
        if (hwnd == 0) return;
        var style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE).ToInt64();
        style |= WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new nint(style));
    }

    public static bool IsCapsLockOn() => (GetKeyState(0x14 /* VK_CAPITAL */) & 1) != 0;

    [DllImport("user32.dll")]
    private static extern short GetKeyState(int nVirtKey);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(nint hWnd, nint hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    private const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
    private const uint GW_HWNDPREV = 3;
    private static readonly nint HWND_TOPMOST = new(-1);

    [DllImport("user32.dll")]
    private static extern nint GetWindow(nint hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(nint hWnd);

    /// <summary>
    /// 把 TOPMOST 带中位于键盘之上的输入法候选窗（TextInputHost/ChsIME/ctfmon 等）
    /// 精确压到键盘正下方。候选窗每次刷新都会重新置顶，比拼 z 序快慢更可靠的是
    /// 直接按窗口归属处理。同时把压在键盘上面的窗口记录到日志，便于诊断。
    /// </summary>
    public static void PushImeWindowsBelow(nint me)
    {
        if (me == 0) return;
        var h = GetWindow(me, GW_HWNDPREV);
        StringBuilder? log = null;
        while (h != 0)
        {
            var next = GetWindow(h, GW_HWNDPREV);
            if (IsWindowVisible(h))
            {
                string proc = ProcNameOf(h);
                if (proc == "explorer") { h = next; continue; } // explorer 的隐形辅助窗口，忽略
                bool ime = proc != null && _imeProcessNames.Contains(proc);
                if (ime)
                {
                    bool ok = SetWindowPos(h, me, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
                    (log ??= new StringBuilder()).AppendLine($"  IME窗压下: {GetClassNameOf(h)} [{proc}] hwnd={h} ok={ok}");
                }
                else
                {
                    (log ??= new StringBuilder()).AppendLine($"  上方窗口: {GetClassNameOf(h)} [{proc}] hwnd={h}");
                }
            }
            h = next;
        }
        if (log != null)
            Log($"PushImeWindowsBelow:\n{log}");
    }

    private static string GetClassNameOf(nint h)
    {
        var sb = new StringBuilder(128);
        _ = GetClassNameW(h, sb, 128);
        return sb.ToString();
    }

    private static readonly Dictionary<nint, string> _procNameCache = new();
    private static readonly HashSet<string> _imeProcessNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "TextInputHost", "ChsIME", "ctfmon", "msimtf",
    };

    private static string? ProcNameOf(nint h)
    {
        GetWindowThreadProcessId(h, out uint pid);
        if (pid == 0) return null;
        lock (_procNameCache)
        {
            if (!_procNameCache.TryGetValue((nint)pid, out var name))
            {
                name = GetProcessName(pid);
                _procNameCache[(nint)pid] = name;
            }
            return name;
        }
    }

    private static readonly object _logLock = new();
    public static void Log(string msg)
    {
        try
        {
            lock (_logLock)
            {
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VertualKb");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "log.txt"),
                    $"[{DateTime.Now:HH:mm:ss.fff}] {msg}\n");
            }
        }
        catch { /* 日志失败不影响功能 */ }
    }


    private static string? GetProcessName(uint pid)
    {
        try
        {
            using var p = System.Diagnostics.Process.GetProcessById((int)pid);
            return p.ProcessName;
        }
        catch { return null; }
    }


    /// <summary>输入法候选窗也是置顶窗口，定时重申 TOPMOST 才能一直压在输入法上面。</summary>
    public static void AssertTopMost(nint hwnd) =>
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);

    [DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(nint hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(nint hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(nint hWnd);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    /// <summary>
    /// 焦点看门狗：NOACTIVATE 防不住所有抢焦点的路径。一旦发现前台是键盘自己，
    /// 就把焦点还给之前的目标窗口，否则注入的按键全被键盘吞掉、输入法组合也会挂死。
    /// </summary>
    public static void EnsureNotForeground(nint me, ref nint lastTarget)
    {
        var fg = GetForegroundWindow();
        if (fg == me)
        {
            if (lastTarget != 0 && IsWindow(lastTarget) && !IsIconic(lastTarget))
            {
                uint fgThread = GetWindowThreadProcessId(fg, out _);
                uint myThread = GetCurrentThreadId();
                AttachThreadInput(myThread, fgThread, true);
                SetForegroundWindow(lastTarget);
                AttachThreadInput(myThread, fgThread, false);
            }
        }
        else if (fg != 0 && IsWindow(fg) && !IsIconic(fg))
        {
            GetWindowThreadProcessId(fg, out uint pid);
            // 记录“真实目标窗口”（排除自己进程的窗口）
            if (pid != 0 && pid != _myPid)
                lastTarget = fg;
        }
    }

    private static readonly uint _myPid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
}
