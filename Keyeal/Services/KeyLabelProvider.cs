namespace Keyeal.Services;

/// <summary>
/// 将虚拟键码映射为高质感、现代简约的符号与按键图标。
/// 修饰键（Ctrl/Shift/Alt/Win）与功能键均采用纯正符号图标呈现。
/// </summary>
public static class KeyLabelProvider
{
    // 修饰键位掩码
    public const int ModCtrl = 1, ModShift = 2, ModAlt = 4, ModWin = 8;

    public static bool IsModifier(int vk) => vk is 0xA0 or 0xA1 or 0xA2 or 0xA3 or 0xA4 or 0xA5 or 0x5B or 0x5C or 0x10 or 0x11 or 0x12;

    public static int ModBitOf(int vk) => vk switch
    {
        0xA2 or 0xA3 or 0x11 => ModCtrl,
        0xA0 or 0xA1 or 0x10 => ModShift,
        0xA4 or 0xA5 or 0x12 => ModAlt,
        0x5B or 0x5C => ModWin,
        _ => 0,
    };

    public static string ModLabel(int bit) => bit switch
    {
        ModCtrl => "⌃",
        ModShift => "⇧",
        ModAlt => "⌥",
        ModWin => "⊞",
        _ => "",
    };

    /// 按固定顺序返回当前按下的修饰键图标标签
    public static string[] ModLabels(int mods)
    {
        var list = new List<string>(4);
        if ((mods & ModCtrl) != 0) list.Add("⌃");
        if ((mods & ModShift) != 0) list.Add("⇧");
        if ((mods & ModAlt) != 0) list.Add("⌥");
        if ((mods & ModWin) != 0) list.Add("⊞");
        return list.ToArray();
    }

    public static string GetLabel(int vk, bool shift, bool uppercase)
    {
        // 字母 A-Z
        if (vk is >= 0x41 and <= 0x5A)
        {
            var c = (char)('A' + vk - 0x41);
            return uppercase || shift ? c.ToString() : char.ToLowerInvariant(c).ToString();
        }

        // 主键盘数字与上档符号
        if (vk is >= 0x30 and <= 0x39)
        {
            const string normal = "0123456789";
            const string shifted = ")!@#$%^&*(";
            return (shift ? shifted : normal)[vk - 0x30].ToString();
        }

        // 小键盘数字
        if (vk is >= 0x60 and <= 0x69) return (vk - 0x60).ToString();

        // 功能键 F1 - F24
        if (vk is >= 0x70 and <= 0x87) return "F" + (vk - 0x70 + 1);

        return vk switch
        {
            0x08 => "⌫",        // Backspace
            0x09 => "⇥",         // Tab
            0x0D => "↵",         // Enter
            0x13 => "⏸",        // Pause
            0x14 => "⇪",         // CapsLock
            0x1B => "⎋",         // Esc
            0x20 => "␣",        // Space
            0x21 => "⇞",         // Page Up
            0x22 => "⇟",         // Page Down
            0x23 => "↘",         // End
            0x24 => "↖",         // Home
            0x25 => "←",         // Left Arrow
            0x26 => "↑",         // Up Arrow
            0x27 => "→",         // Right Arrow
            0x28 => "↓",         // Down Arrow
            0x2C => "⎙",         // Print Screen
            0x2D => "⎀",         // Insert
            0x2E => "⌦",         // Delete
            0x5B or 0x5C => "⊞", // Win
            0x5D => "☰",         // Menu
            0x6A => "*",
            0x6B => "+",
            0x6D => "-",
            0x6E => ".",
            0x6F => "/",
            0x90 => "⇭",         // NumLock
            0x91 => "⇳",         // ScrollLock
            0xA0 or 0xA1 => "⇧", // Shift
            0xA2 or 0xA3 => "⌃", // Ctrl
            0xA4 or 0xA5 => "⌥", // Alt

            // 标点与符号键
            0xBA => shift ? ":" : ";",
            0xBB => shift ? "+" : "=",
            0xBC => shift ? "<" : ",",
            0xBD => shift ? "_" : "-",
            0xBE => shift ? ">" : ".",
            0xBF => shift ? "?" : "/",
            0xC0 => shift ? "~" : "`",
            0xDB => shift ? "{" : "[",
            0xDC => shift ? "|" : "\\",
            0xDD => shift ? "}" : "]",
            0xDE => shift ? "\"" : "'",

            // 多媒体键
            0xAD => "🔇",
            0xAE => "🔉",
            0xAF => "🔊",
            0xB0 => "⏭",
            0xB1 => "⏮",
            0xB2 => "⏹",
            0xB3 => "⏯",

            // 快捷按键
            0xA6 => "←",
            0xA7 => "→",
            0xA8 => "🔄",
            0xAB => "🔍",
            0xAC => "🏠",

            _ => $"0x{vk:X2}",
        };
    }

    /// 判断字符串中是否包含特殊符号/图标，以便选择适配字体
    public static bool IsGlyphLabel(string? text)
    {
        if (text is null) return false;
        foreach (var ch in text)
        {
            if (ch >= 0x2190 && ch <= 0x2BFF) return true;
        }
        return false;
    }
}
