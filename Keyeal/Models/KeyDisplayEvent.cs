using Keyeal.Interop;

namespace Keyeal.Models;

/// 供渲染层消费的按键事件（已翻译成展示文本）
public sealed class KeyDisplayEvent
{
    public bool IsDown;
    public int Vk;
    public bool IsModifier;
    /// 主键标签（含修饰键单独按下时的自身标签）
    public string KeyLabel = "";
    /// 组合键修饰标签，如 ["Ctrl","Shift"]
    public string[] ModifierLabels = Array.Empty<string>();
    /// 修饰键位掩码（KeyLabelProvider.ModCtrl 等）
    public int ModFlags;

    public string DisplayText => ModifierLabels.Length == 0
        ? KeyLabel
        : string.Join(" + ", ModifierLabels.Append(KeyLabel));
}
