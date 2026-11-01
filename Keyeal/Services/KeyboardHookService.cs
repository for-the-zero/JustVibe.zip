using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using Avalonia.Threading;
using Keyeal.Interop;
using Keyeal.Models;

namespace Keyeal.Services;

/// <summary>
/// 全局键盘监听（WH_KEYBOARD_LL）。
/// 钩子线程 → 队列 → 语义线程（修饰键状态/重复过滤/组合键识别）→ UI 线程消费。
/// </summary>
public sealed class KeyboardHookService : IDisposable
{
    private LowLevelHookThread? _hookThread;
    private BlockingCollection<RawKey>? _queue;
    private Thread? _worker;

    private int _mods; // 当前按下的修饰键（KeyLabelProvider.Mod* 位掩码）
    private readonly HashSet<int> _down = new();

    private volatile bool _ignoreInjected = true;
    private volatile bool _uppercase = true;
    public bool IgnoreInjected { get => _ignoreInjected; set => _ignoreInjected = value; }
    public bool Uppercase { get => _uppercase; set => _uppercase = value; }

    /// 在语义线程上触发（订阅方自行切线程）
    public event Action<KeyDisplayEvent>? Key;

    private readonly record struct RawKey(int Msg, int Vk, bool Injected);

    public void Start()
    {
        _queue = new BlockingCollection<RawKey>(new ConcurrentQueue<RawKey>(), 4096);
        _hookThread = new LowLevelHookThread(NativeMethods.WH_KEYBOARD_LL, OnHookEvent);
        _worker = new Thread(Consume)
        {
            IsBackground = true,
            Name = "Keyeal.KeyWorker",
            Priority = ThreadPriority.Normal,
        };
        _worker.Start();
        if (!_hookThread.Started)
            Log.Error("keyboard hook NOT installed");
        else
            Log.Info("keyboard hook installed");
    }

    private void OnHookEvent(int msg, IntPtr lParam)
    {
        var s = Marshal.PtrToStructure<NativeMethods.KBDLLHOOKSTRUCT>(lParam);
        bool injected = (s.flags & NativeMethods.LLKHF_INJECTED_MASK) != 0;
        _queue?.TryAdd(new RawKey(msg, (int)s.vkCode, injected));
    }

    private void Consume()
    {
        foreach (var raw in _queue!.GetConsumingEnumerable())
            Process(raw);
    }

    private void Process(RawKey raw)
    {
        bool down = raw.Msg is NativeMethods.WM_KEYDOWN or NativeMethods.WM_SYSKEYDOWN;

        if (raw.Injected && _ignoreInjected) return;

        if (down)
        {
            if (!_down.Add(raw.Vk)) return; // 系统自动重复，忽略
        }
        else
        {
            if (!_down.Remove(raw.Vk)) return; // 启动前已按下的键，忽略
        }

        if (KeyLabelProvider.IsModifier(raw.Vk))
        {
            int bit = KeyLabelProvider.ModBitOf(raw.Vk);
            _mods = down ? (_mods | bit) : (_mods & ~bit);
            Key?.Invoke(new KeyDisplayEvent
            {
                IsDown = down,
                Vk = raw.Vk,
                IsModifier = true,
                KeyLabel = KeyLabelProvider.ModLabel(bit),
                ModFlags = _mods,
            });
            return;
        }

        Key?.Invoke(new KeyDisplayEvent
        {
            IsDown = down,
            Vk = raw.Vk,
            IsModifier = false,
            KeyLabel = KeyLabelProvider.GetLabel(raw.Vk, (_mods & KeyLabelProvider.ModShift) != 0, _uppercase),
            ModifierLabels = KeyLabelProvider.ModLabels(_mods),
            ModFlags = _mods,
        });
    }

    public void Dispose()
    {
        _hookThread?.Dispose();
        _queue?.CompleteAdding();
    }
}
