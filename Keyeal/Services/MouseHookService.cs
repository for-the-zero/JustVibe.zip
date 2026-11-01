using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using Keyeal.Interop;

namespace Keyeal.Services;

/// <summary>
/// 全局鼠标监听（WH_MOUSE_LL）。事件在钩子线程直接回调；
/// 消费方（OverlayService）内部只做入队，不阻塞钩子。
/// </summary>
public sealed class MouseHookService : IDisposable
{
    public const int BtnLeft = 0, BtnRight = 1, BtnMiddle = 2, BtnX1 = 3, BtnX2 = 4;

    private LowLevelHookThread? _hookThread;
    private BlockingCollection<RawMouse>? _queue;
    private Thread? _worker;

    private volatile bool _ignoreInjected = true;
    public bool IgnoreInjected { get => _ignoreInjected; set => _ignoreInjected = value; }

    public event Action<NativeMethods.POINT>? Move;
    public event Action<NativeMethods.POINT, int, bool>? Click;

    private readonly record struct RawMouse(int Msg, NativeMethods.POINT Pt, bool Injected, int XButton);

    public void Start()
    {
        _queue = new BlockingCollection<RawMouse>(new ConcurrentQueue<RawMouse>(), 16384);
        _hookThread = new LowLevelHookThread(NativeMethods.WH_MOUSE_LL, OnHookEvent);
        _worker = new Thread(Consume)
        {
            IsBackground = true,
            Name = "Keyeal.MouseWorker",
            Priority = ThreadPriority.Normal,
        };
        _worker.Start();
        if (!_hookThread.Started)
            Log.Error("mouse hook NOT installed");
        else
            Log.Info("mouse hook installed");
    }

    private void OnHookEvent(int msg, IntPtr lParam)
    {
        var s = Marshal.PtrToStructure<NativeMethods.MSLLHOOKSTRUCT>(lParam);
        bool injected = (s.flags & NativeMethods.LLMHF_INJECTED_MASK) != 0;
        int xbtn = msg is NativeMethods.WM_XBUTTONDOWN or NativeMethods.WM_XBUTTONUP
            ? (int)((s.mouseData >> 16) & 0xFFFF) : 0;
        _queue?.TryAdd(new RawMouse(msg, s.pt, injected, xbtn));
    }

    private void Consume()
    {
        foreach (var raw in _queue!.GetConsumingEnumerable())
        {
            if (raw.Injected && _ignoreInjected) continue;
            switch (raw.Msg)
            {
                case NativeMethods.WM_MOUSEMOVE:
                    Move?.Invoke(raw.Pt);
                    break;
                case NativeMethods.WM_LBUTTONDOWN:
                    Click?.Invoke(raw.Pt, BtnLeft, true);
                    break;
                case NativeMethods.WM_LBUTTONUP:
                    Click?.Invoke(raw.Pt, BtnLeft, false);
                    break;
                case NativeMethods.WM_RBUTTONDOWN:
                    Click?.Invoke(raw.Pt, BtnRight, true);
                    break;
                case NativeMethods.WM_RBUTTONUP:
                    Click?.Invoke(raw.Pt, BtnRight, false);
                    break;
                case NativeMethods.WM_MBUTTONDOWN:
                    Click?.Invoke(raw.Pt, BtnMiddle, true);
                    break;
                case NativeMethods.WM_MBUTTONUP:
                    Click?.Invoke(raw.Pt, BtnMiddle, false);
                    break;
                case NativeMethods.WM_XBUTTONDOWN when raw.XButton == 1:
                    Click?.Invoke(raw.Pt, BtnX1, true);
                    break;
                case NativeMethods.WM_XBUTTONUP when raw.XButton == 1:
                    Click?.Invoke(raw.Pt, BtnX1, false);
                    break;
                case NativeMethods.WM_XBUTTONDOWN when raw.XButton == 2:
                    Click?.Invoke(raw.Pt, BtnX2, true);
                    break;
                case NativeMethods.WM_XBUTTONUP when raw.XButton == 2:
                    Click?.Invoke(raw.Pt, BtnX2, false);
                    break;
            }
        }
    }

    public void Dispose()
    {
        _hookThread?.Dispose();
        _queue?.CompleteAdding();
    }
}
