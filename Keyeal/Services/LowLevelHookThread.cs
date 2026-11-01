using System.Runtime.InteropServices;
using Keyeal.Interop;

namespace Keyeal.Services;

/// <summary>
/// 低级钩子宿主线程：独立线程安装钩子并泵消息。
/// 钩子回调只做“解析+入队”，立刻 CallNextHookEx，绝不触碰 UI——
/// 这是“监听但不影响其它软件”的关键（回调超时会被系统摘除钩子并造成全局卡顿）。
/// </summary>
internal sealed class LowLevelHookThread : IDisposable
{
    private readonly NativeMethods.LowLevelHookProc _proc;
    private readonly Action<int, IntPtr> _onEvent;
    private Thread? _thread;
    private IntPtr _hook;
    private uint _threadId;
    private volatile bool _disposed;
    private readonly TaskCompletionSource<bool> _started = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// 安装是否成功（等待线程初始化完成）
    public bool Started
    {
        get
        {
            _started.Task.Wait(3000);
            return _started.Task.Result;
        }
    }

    /// <param name="hookType">WH_KEYBOARD_LL / WH_MOUSE_LL</param>
    /// <param name="onEvent">(wMsg, lParam)，在钩子线程回调内同步执行，必须快速返回</param>
    public LowLevelHookThread(int hookType, Action<int, IntPtr> onEvent)
    {
        _onEvent = onEvent;
        _proc = HookProc;
        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name = $"Keyeal.LLHook{hookType}",
            Priority = ThreadPriority.AboveNormal,
        };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start(hookType);
    }

    private void Run(object? state)
    {
        _threadId = NativeMethods.GetCurrentThreadId();
        _hook = NativeMethods.SetWindowsHookExW((int)state!, _proc, NativeMethods.GetModuleHandleW(null), 0);
        if (_hook == IntPtr.Zero)
            Log.Error($"install hook {(int)state!} failed, win32 err = {Marshal.GetLastWin32Error()}");
        _started.TrySetResult(_hook != IntPtr.Zero);

        while (NativeMethods.GetMessage(out _, IntPtr.Zero, 0, 0) > 0) { }
        // WM_QUIT 到达，线程退出
    }

    private IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && !_disposed)
        {
            try { _onEvent(wParam.ToInt32(), lParam); }
            catch { /* 回调内绝不抛出 */ }
        }
        return NativeMethods.CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public void Dispose()
    {
        _disposed = true;
        if (_hook != IntPtr.Zero)
            NativeMethods.UnhookWindowsHookEx(_hook);
        if (_threadId != 0)
            NativeMethods.PostThreadMessageW(_threadId, NativeMethods.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        _thread = null;
    }
}
