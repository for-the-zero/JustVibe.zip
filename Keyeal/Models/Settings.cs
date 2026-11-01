using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;
using Avalonia.Media;

namespace Keyeal.Models;

public enum TrackOrientation { Horizontal, Vertical }
public enum TrackPosition
{
    BottomCenter,
    BottomLeft,
    BottomRight,
    TopCenter,
    TopLeft,
    TopRight,
    LeftCenter,
    RightCenter,
    Center
}
public enum OverflowBehavior { FlushAll, RemoveOldest }
public enum TrackScreenMode { Primary, FollowMouse }

public enum EnterAnimation
{
    FromBottom, FromTop, FromLeft, FromRight,
    ZoomIn, ZoomOut, Fade, FlipX, FlipY
}

public enum ExitAnimation
{
    FadeUp, FadeShrink, Fade, FallDown, FloatUp, SlideLeft, SlideRight, ZoomOut
}

public enum EasingKind
{
    Linear, InQuad, OutQuad, InOutQuad,
    InCubic, OutCubic, InOutCubic, OutQuart, OutExpo,
    InBack, OutBack, InOutBack, OutElastic, OutBounce
}

public enum TrailKind { None, Brush, Ribbon, Comet, Dots, Particles }
public enum ClickFxKind { None, Ripple, DoubleRipple, Halo, Burst, Pulse }

/// 颜色方案
public sealed record Palette(string Name, Color Bg, Color Modifier, Color Text, Color Pressed, Color Border, Color Count);

public sealed class Settings : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return;
        field = value;
        Version++;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }

    /// 每次修改自增，渲染器据此重建文字缓存
    [JsonIgnore] public int Version { get; private set; }

    // ---------------------------------------------------------- 常规
    private bool _enabled = true;
    public bool Enabled { get => _enabled; set => Set(ref _enabled, value); }

    private bool _showKeyTrack = true;
    public bool ShowKeyTrack { get => _showKeyTrack; set => Set(ref _showKeyTrack, value); }

    private bool _mouseEnabled = true;
    public bool MouseEnabled { get => _mouseEnabled; set => Set(ref _mouseEnabled, value); }

    private bool _ignoreInjected = true;
    public bool IgnoreInjected { get => _ignoreInjected; set => Set(ref _ignoreInjected, value); }

    private bool _autoStart;
    public bool AutoStart { get => _autoStart; set => Set(ref _autoStart, value); }

    private TrackScreenMode _trackScreen = TrackScreenMode.Primary;
    public TrackScreenMode TrackScreen { get => _trackScreen; set => Set(ref _trackScreen, value); }

    // ---------------------------------------------------------- 气泡样式
    private Color _bgColor = Color.Parse("#E62A2E39");
    public Color BgColor { get => _bgColor; set => Set(ref _bgColor, value); }

    private Color _modifierColor = Color.Parse("#F01E2028");
    public Color ModifierColor { get => _modifierColor; set => Set(ref _modifierColor, value); }

    private Color _textColor = Color.Parse("#FFF2F4F8");
    public Color TextColor { get => _textColor; set => Set(ref _textColor, value); }

    private Color _pressedColor = Color.Parse("#FF4F75FF");
    public Color PressedColor { get => _pressedColor; set => Set(ref _pressedColor, value); }

    private Color _borderColor = Color.Parse("#38FFFFFF");
    public Color BorderColor { get => _borderColor; set => Set(ref _borderColor, value); }

    private Color _countColor = Color.Parse("#FF9AA3B2");
    public Color CountColor { get => _countColor; set => Set(ref _countColor, value); }

    private double _bubbleHeight = 56;
    public double BubbleHeight { get => _bubbleHeight; set => Set(ref _bubbleHeight, Math.Clamp(value, 24, 160)); }

    private double _fontSize = 22;
    public double FontSize { get => _fontSize; set => Set(ref _fontSize, Math.Clamp(value, 8, 80)); }

    private string _fontFamily = "Segoe UI Variable Text";
    public string FontFamily { get => _fontFamily; set => Set(ref _fontFamily, string.IsNullOrWhiteSpace(value) ? "Segoe UI Variable Text" : value); }

    private double _cornerRadius = 12;
    public double CornerRadius { get => _cornerRadius; set => Set(ref _cornerRadius, Math.Clamp(value, 0, 80)); }

    private double _borderThickness = 1.0;
    public double BorderThickness { get => _borderThickness; set => Set(ref _borderThickness, Math.Clamp(value, 0, 8)); }

    private double _bgOpacity = 0.94;
    public double BgOpacity { get => _bgOpacity; set => Set(ref _bgOpacity, Math.Clamp(value, 0.05, 1)); }

    private double _pressedScale = 0.94;
    public double PressedScale { get => _pressedScale; set => Set(ref _pressedScale, Math.Clamp(value, 0.8, 2.0)); }

    private bool _bubbleGlow = true;
    public bool BubbleGlow { get => _bubbleGlow; set => Set(ref _bubbleGlow, value); }

    // ---------------------------------------------------------- 轨道
    private TrackOrientation _orientation = TrackOrientation.Horizontal;
    public TrackOrientation Orientation { get => _orientation; set => Set(ref _orientation, value); }

    private TrackPosition _position = TrackPosition.BottomCenter;
    public TrackPosition Position { get => _position; set => Set(ref _position, value); }

    private double _maxTrackFraction = 0.72;
    public double MaxTrackFraction { get => _maxTrackFraction; set => Set(ref _maxTrackFraction, Math.Clamp(value, 0.15, 0.98)); }

    private OverflowBehavior _overflow = OverflowBehavior.RemoveOldest;
    public OverflowBehavior Overflow { get => _overflow; set => Set(ref _overflow, value); }

    private double _edgeMargin = 96;
    public double EdgeMargin { get => _edgeMargin; set => Set(ref _edgeMargin, Math.Clamp(value, 0, 400)); }

    /// 轨道半透明面板（把键帽装住的长条底板）
    private bool _showTrackPanel = true;
    public bool ShowTrackPanel { get => _showTrackPanel; set => Set(ref _showTrackPanel, value); }

    private Color _panelColor = Color.Parse("#8C10121A");
    public Color PanelColor { get => _panelColor; set => Set(ref _panelColor, value); }

    private double _gap = 8;
    public double Gap { get => _gap; set => Set(ref _gap, Math.Clamp(value, 0, 60)); }

    private double _paddingX = 16;
    public double PaddingX { get => _paddingX; set => Set(ref _paddingX, Math.Clamp(value, 0, 80)); }

    private bool _uppercase = true;
    public bool Uppercase { get => _uppercase; set => Set(ref _uppercase, value); }

    private bool _showRepeatCount = true;
    public bool ShowRepeatCount { get => _showRepeatCount; set => Set(ref _showRepeatCount, value); }

    /// 组合键（含控制键）按下时清空轨道
    private bool _comboClearsTrack = true;
    public bool ComboClearsTrack { get => _comboClearsTrack; set => Set(ref _comboClearsTrack, value); }

    /// 参与清空轨道的修饰键位掩码：1=Ctrl 2=Shift 4=Alt 8=Win（默认 Ctrl+Alt+Win，Shift 不清，避免打大写字母时不停清空）
    private int _clearMods = 1 | 4 | 8;
    public int ClearMods { get => _clearMods; set => Set(ref _clearMods, value); }

    // ---------------------------------------------------------- 动画
    private EnterAnimation _enter = EnterAnimation.FromBottom;
    public EnterAnimation Enter { get => _enter; set => Set(ref _enter, value); }

    private double _enterDuration = 180;
    public double EnterDuration { get => _enterDuration; set => Set(ref _enterDuration, Math.Clamp(value, 40, 2000)); }

    private EasingKind _enterEasing = EasingKind.OutBack;
    public EasingKind EnterEasing { get => _enterEasing; set => Set(ref _enterEasing, value); }

    private ExitAnimation _exit = ExitAnimation.FadeUp;
    public ExitAnimation Exit { get => _exit; set => Set(ref _exit, value); }

    private double _exitDuration = 200;
    public double ExitDuration { get => _exitDuration; set => Set(ref _exitDuration, Math.Clamp(value, 40, 2000)); }

    private EasingKind _exitEasing = EasingKind.OutCubic;
    public EasingKind ExitEasing { get => _exitEasing; set => Set(ref _exitEasing, value); }

    private double _pressDuration = 90;
    public double PressDuration { get => _pressDuration; set => Set(ref _pressDuration, Math.Clamp(value, 30, 1000)); }

    private double _dwellTime = 1400;
    public double DwellTime { get => _dwellTime; set => Set(ref _dwellTime, Math.Clamp(value, 0, 10000)); }

    // ---------------------------------------------------------- 鼠标
    private TrailKind _trail = TrailKind.Brush;
    public TrailKind Trail { get => _trail; set => Set(ref _trail, value); }

    private Color _trailColor = Color.Parse("#FFFFFFFF");
    public Color TrailColor { get => _trailColor; set => Set(ref _trailColor, value); }

    private double _trailSize = 5.0;
    public double TrailSize { get => _trailSize; set => Set(ref _trailSize, Math.Clamp(value, 1, 80)); }

    private double _trailLifetime = 360;
    public double TrailLifetime { get => _trailLifetime; set => Set(ref _trailLifetime, Math.Clamp(value, 80, 3000)); }

    private double _trailDensity = 1;
    public double TrailDensity { get => _trailDensity; set => Set(ref _trailDensity, Math.Clamp(value, 0.1, 3)); }

    private ClickFxKind _clickEffect = ClickFxKind.Ripple;
    public ClickFxKind ClickEffect { get => _clickEffect; set => Set(ref _clickEffect, value); }

    private Color _leftColor = Color.Parse("#FF5B7CFF");
    public Color LeftColor { get => _leftColor; set => Set(ref _leftColor, value); }

    private Color _rightColor = Color.Parse("#FFFF6B6B");
    public Color RightColor { get => _rightColor; set => Set(ref _rightColor, value); }

    private Color _middleColor = Color.Parse("#FFFFD166");
    public Color MiddleColor { get => _middleColor; set => Set(ref _middleColor, value); }

    private double _clickSize = 36;
    public double ClickSize { get => _clickSize; set => Set(ref _clickSize, Math.Clamp(value, 8, 300)); }

    private double _clickEnterDuration = 160;
    public double ClickEnterDuration { get => _clickEnterDuration; set => Set(ref _clickEnterDuration, Math.Clamp(value, 40, 800)); }

    private double _clickExitDuration = 520;
    public double ClickExitDuration { get => _clickExitDuration; set { Set(ref _clickExitDuration, Math.Clamp(value, 100, 3000)); _clickDuration = _clickExitDuration; } }

    private double _clickDuration = 520;
    public double ClickDuration { get => _clickExitDuration; set { Set(ref _clickExitDuration, Math.Clamp(value, 100, 3000)); _clickDuration = _clickExitDuration; } }

    private double _ringThickness = 1.6;
    public double RingThickness { get => _ringThickness; set => Set(ref _ringThickness, Math.Clamp(value, 0.5, 20)); }

    private bool _clickLeft = true;
    public bool ClickLeft { get => _clickLeft; set => Set(ref _clickLeft, value); }

    private bool _clickRight = true;
    public bool ClickRight { get => _clickRight; set => Set(ref _clickRight, value); }

    private bool _clickMiddle = true;
    public bool ClickMiddle { get => _clickMiddle; set => Set(ref _clickMiddle, value); }

    // ---------------------------------------------------------- 方案预设

    public static readonly Palette[] Palettes =
    {
        new("曜石黑", Color.Parse("#E62A2E39"), Color.Parse("#F01E2028"), Color.Parse("#FFF2F4F8"), Color.Parse("#FF4F75FF"), Color.Parse("#38FFFFFF"), Color.Parse("#FF9AA3B2")),
        new("极夜纯黑", Color.Parse("#E618191E"), Color.Parse("#F0121317"), Color.Parse("#FFFFFFFF"), Color.Parse("#FF6366F1"), Color.Parse("#28FFFFFF"), Color.Parse("#FF8E96A4")),
        new("云白", Color.Parse("#F2F4F5F8"), Color.Parse("#F6E3E5EB"), Color.Parse("#FF23272F"), Color.Parse("#FF3D6BFF"), Color.Parse("#33000000"), Color.Parse("#FF7A828E")),
        new("薄荷翠", Color.Parse("#E61F3D36"), Color.Parse("#F0152A25"), Color.Parse("#FFE8FFF6"), Color.Parse("#FF34D399"), Color.Parse("#3834D399"), Color.Parse("#FF34D399")),
        new("樱花粉", Color.Parse("#E6442532"), Color.Parse("#F02E181F"), Color.Parse("#FFFFE9F1"), Color.Parse("#FFFF7EB6"), Color.Parse("#38FF7EB6"), Color.Parse("#FFFF7EB6")),
        new("海盐青", Color.Parse("#E61E3050"), Color.Parse("#F0141F33"), Color.Parse("#FFE6F0FF"), Color.Parse("#FF4CC9F0"), Color.Parse("#384CC9F0"), Color.Parse("#FF4CC9F0")),
        new("日落金", Color.Parse("#E645301F"), Color.Parse("#F02E2015"), Color.Parse("#FFFFEFE6"), Color.Parse("#FFFF8C42"), Color.Parse("#38FF8C42"), Color.Parse("#FFFF8C42")),
        new("暗夜紫", Color.Parse("#E6322647"), Color.Parse("#F0221A31"), Color.Parse("#FFF1E9FF"), Color.Parse("#FFA78BFA"), Color.Parse("#38A78BFA"), Color.Parse("#FFA78BFA")),
    };

    public void ApplyPalette(Palette p)
    {
        BgColor = p.Bg;
        ModifierColor = p.Modifier;
        TextColor = p.Text;
        PressedColor = p.Pressed;
        BorderColor = p.Border;
        CountColor = p.Count;
    }

    /// 恢复所有默认值
    public void ResetToDefaults()
    {
        var d = new Settings();
        foreach (var prop in typeof(Settings).GetProperties())
        {
            if (prop.CanRead && prop.CanWrite && prop.Name != nameof(Version))
                prop.SetValue(this, prop.GetValue(d));
        }
    }

    /// 切换轨道方向时给一个合适的默认进入方向
    public void SuggestEnterFor(TrackPosition pos)
    {
        Enter = pos switch
        {
            TrackPosition.BottomCenter => EnterAnimation.FromBottom,
            TrackPosition.TopCenter => EnterAnimation.FromTop,
            TrackPosition.LeftCenter => EnterAnimation.FromRight,
            TrackPosition.RightCenter => EnterAnimation.FromLeft,
            _ => Enter
        };
    }
}
