using System;
using System.Collections.Generic;
using System.Linq;

namespace VertualKb;

public enum KLayer
{
    Letters,
    Symbols,
    Fn,
}

public enum KeyAction
{
    /// <summary>输入 Text 中的字符。</summary>
    Text,
    Space,
    Backspace,
    Enter,
    Tab,
    Esc,
    CapsLock,
    /// <summary>发送 Vk 指定的功能键（F1、方向键、Del 等）。</summary>
    Nav,
    /// <summary>粘滞修饰键（Shift/Ctrl/Alt/Win）。</summary>
    Modifier,
    /// <summary>组合键：Ctrl + Text。</summary>
    Combo,
    /// <summary>切换键盘层。</summary>
    SwitchLayer,
    Collapse,
    ClearPreview,
    ExitApp,
}

public enum Mods
{
    None = 0,
    Shift = 1,
    Ctrl = 2,
    Alt = 4,
    Win = 8,
}

public sealed record KeyDef
{
    public string Label { get; init; } = "";
    public KeyAction Action { get; init; }
    public string? Text { get; init; }
    public ushort Vk { get; init; }
    public bool Extended { get; init; }
    public double Width { get; init; } = 1;
    public string? Style { get; init; }
    public Mods StickyMod { get; init; } = Mods.None;
    public KLayer Target { get; init; }
    public bool Repeat { get; init; }
}

public static class KeyDefs
{
    public const ushort VK_BACK = 0x08, VK_TAB = 0x09, VK_RETURN = 0x0D, VK_SHIFT = 0x10,
        VK_CONTROL = 0x11, VK_MENU = 0x12, VK_CAPITAL = 0x14, VK_ESCAPE = 0x1B, VK_SPACE = 0x20,
        VK_LEFT = 0x25, VK_UP = 0x26, VK_RIGHT = 0x27, VK_DOWN = 0x28,
        VK_LWIN = 0x5B, VK_F1 = 0x70,
        VK_INSERT = 0x2D, VK_DELETE = 0x2E, VK_HOME = 0x24, VK_END = 0x23,
        VK_PRIOR = 0x21, VK_NEXT = 0x22, VK_VOLUME_MUTE = 0xAD, VK_VOLUME_DOWN = 0xAE, VK_VOLUME_UP = 0xAF;

    private static KeyDef K(string label, KeyAction action, double w = 1, string? style = null) =>
        new() { Label = label, Action = action, Width = w, Style = style };

    private static KeyDef Txt(string s) =>
        new() { Label = s, Action = KeyAction.Text, Text = s };

    private static KeyDef Ltr(char c, bool upper) =>
        new() { Label = (upper ? char.ToUpperInvariant(c) : c).ToString(), Action = KeyAction.Text, Text = c.ToString() };

    private static KeyDef Nav(string label, ushort vk, bool ext = false, bool repeat = false) =>
        new() { Label = label, Action = KeyAction.Nav, Vk = vk, Extended = ext, Repeat = repeat, Style = "special" };

    private static KeyDef ModKey(string label, Mods mod, double w = 1) =>
        new() { Label = label, Action = KeyAction.Modifier, StickyMod = mod, Width = w, Style = "special" };

    private static KeyDef Switch(string label, KLayer target, double w = 1) =>
        new() { Label = label, Action = KeyAction.SwitchLayer, Target = target, Width = w, Style = "special" };

    private static KeyDef Spacer(double w) =>
        new() { Label = "", Action = KeyAction.Text, Width = w, Style = "spacer" };

    private static KeyDef Combo(string label, string key) =>
        new() { Label = label, Action = KeyAction.Combo, Text = key, Style = "special" };

    private static readonly KeyDef Backspace = new()
    {
        Label = "⌫", Action = KeyAction.Backspace, Repeat = true, Style = "special",
    };

    private static readonly KeyDef Enter = new()
    {
        Label = "⏎", Action = KeyAction.Enter, Width = 1.5, Style = "accent",
    };

    private static readonly KeyDef Space = new()
    {
        Label = "空格", Action = KeyAction.Space, Width = 3.5, Style = "special",
    };

    private static readonly KeyDef FnSwitch = Switch("更多", KLayer.Fn, 1.5);

    public static IReadOnlyList<KeyDef[]> GetLayer(KLayer layer, bool upper) => layer switch
    {
        KLayer.Letters =>
        [
            [.."1234567890".Select(c => Ltr(c, upper))],
            [.."qwertyuiop".Select(c => Ltr(c, upper))],
            [Spacer(0.5), .."asdfghjkl".Select(c => Ltr(c, upper)), Spacer(0.5)],
            [ModKey("⇧", Mods.Shift, 1.5), .."zxcvbnm".Select(c => Ltr(c, upper)), Backspace with { Width = 1.5 }],
            [FnSwitch, Switch("?123", KLayer.Symbols, 1.5), Txt(","), Space, Txt("."), Enter],
        ],

        KLayer.Symbols =>
        [
            [.."1234567890".Select(c => Txt(c.ToString()))],
            [Txt("@"), Txt("#"), Txt("$"), Txt("_"), Txt("&"), Txt("-"), Txt("+"), Txt("("), Txt(")"), Txt("/")],
            [Txt("="), Txt("\\"), Txt("*"), Txt("\""), Txt("'"), Txt(":"), Txt(";"), Txt("!"), Txt("?"), Backspace],
            [FnSwitch, Switch("ABC", KLayer.Letters, 1.5), Txt(","), Space, Txt("."), Enter],
        ],

        _ =>
        [
            [
                Nav("Esc", VK_ESCAPE),
                Nav("Tab", VK_TAB),
                Nav("Caps", VK_CAPITAL),
                Nav("Ins", VK_INSERT, ext: true),
                Nav("Home", VK_HOME, ext: true),
                Nav("PgUp", VK_PRIOR, ext: true),
            ],
            [
                ModKey("Win", Mods.Win),
                ModKey("Ctrl", Mods.Ctrl),
                ModKey("Alt", Mods.Alt),
                ModKey("⇧", Mods.Shift),
                Nav("Del", VK_DELETE, ext: true, repeat: true),
                Nav("End", VK_END, ext: true),
            ],
            [
                Nav("F1", VK_F1), Nav("F2", (ushort)(VK_F1 + 1)),
                Nav("F3", (ushort)(VK_F1 + 2)), Nav("F4", (ushort)(VK_F1 + 3)),
                Nav("F5", (ushort)(VK_F1 + 4)), Nav("F6", (ushort)(VK_F1 + 5)),
            ],
            [
                Nav("F7", (ushort)(VK_F1 + 6)), Nav("F8", (ushort)(VK_F1 + 7)),
                Nav("F9", (ushort)(VK_F1 + 8)), Nav("F10", (ushort)(VK_F1 + 9)),
                Nav("F11", (ushort)(VK_F1 + 10)), Nav("F12", (ushort)(VK_F1 + 11)),
            ],
            [
                Nav("←", VK_LEFT, ext: true, repeat: true),
                Nav("↑", VK_UP, ext: true, repeat: true),
                Nav("↓", VK_DOWN, ext: true, repeat: true),
                Nav("→", VK_RIGHT, ext: true, repeat: true),
                Combo("复制", "c"),
                Combo("粘贴", "v"),
            ],
            [
                Switch("字母", KLayer.Letters, 1.5),
                Combo("剪切", "x"),
                Nav("🔇", VK_VOLUME_MUTE),
                Nav("🔉-", VK_VOLUME_DOWN, repeat: true),
                Nav("🔊+", VK_VOLUME_UP, repeat: true),
                Nav("PgDn", VK_NEXT, ext: true),
            ],
        ],
    };

    private static KeyDef[] Row(IEnumerable<KeyDef> defs) => defs.ToArray();

    /// <summary>字符 → (VK 码, 是否需要 Shift)，按美式键盘布局。</summary>
    public static (ushort vk, bool shift) MapChar(char c) => c switch
    {
        >= 'a' and <= 'z' => ((ushort)(0x41 + c - 'a'), false),
        >= 'A' and <= 'Z' => ((ushort)(0x41 + c - 'A'), true),
        >= '0' and <= '9' => ((ushort)(0x30 + c - '0'), false),
        ' ' => (VK_SPACE, false),
        '.' => (0xBE, false), ',' => (0xBC, false), '-' => (0xBD, false), '=' => (0xBB, false),
        '/' => (0xBF, false), ';' => (0xBA, false), '\'' => (0xDE, false), '`' => (0xC0, false),
        '\\' => (0xDC, false), '[' => (0xDB, false), ']' => (0xDD, false),
        '!' => (0x31, true), '@' => (0x32, true), '#' => (0x33, true), '$' => (0x34, true),
        '%' => (0x35, true), '^' => (0x36, true), '&' => (0x37, true), '*' => (0x38, true),
        '(' => (0x39, true), ')' => (0x30, true), '_' => (0xBD, true), '+' => (0xBB, true),
        '?' => (0xBF, true), ':' => (0xBA, true), '"' => (0xDE, true), '~' => (0xC0, true),
        '|' => (0xDC, true), '{' => (0xDB, true), '}' => (0xDD, true), '<' => (0xBC, true),
        '>' => (0xBE, true),
        _ => (0, false),
    };
}
