using System.Globalization;
using Avalonia.Data.Converters;
using Keyeal.Models;

namespace Keyeal.Views;

public sealed record EnumItem(object Value, string Name);

/// 下拉框数据源（中文标签）
public static class EnumLists
{
    // 原始枚举数组（直接绑定 SelectedItem）
    public static readonly TrackOrientation[] OrientationValues = (TrackOrientation[])Enum.GetValues<TrackOrientation>();
    public static readonly TrackPosition[] PositionValues = (TrackPosition[])Enum.GetValues<TrackPosition>();
    public static readonly OverflowBehavior[] OverflowValues = (OverflowBehavior[])Enum.GetValues<OverflowBehavior>();
    public static readonly TrackScreenMode[] TrackScreenValues = (TrackScreenMode[])Enum.GetValues<TrackScreenMode>();
    public static readonly EnterAnimation[] EnterAnimationValues = (EnterAnimation[])Enum.GetValues<EnterAnimation>();
    public static readonly ExitAnimation[] ExitAnimationValues = (ExitAnimation[])Enum.GetValues<ExitAnimation>();
    public static readonly EasingKind[] EasingValues = (EasingKind[])Enum.GetValues<EasingKind>();
    public static readonly TrailKind[] TrailValues = (TrailKind[])Enum.GetValues<TrailKind>();
    public static readonly ClickFxKind[] ClickFxValues = (ClickFxKind[])Enum.GetValues<ClickFxKind>();

    public static readonly EnumItem[] Orientation =
    {
        new(TrackOrientation.Horizontal, "横向轨道"),
        new(TrackOrientation.Vertical, "纵向轨道"),
    };

    public static readonly EnumItem[] Position =
    {
        new(TrackPosition.BottomCenter, "底部居中"),
        new(TrackPosition.BottomLeft, "左下角"),
        new(TrackPosition.BottomRight, "右下角"),
        new(TrackPosition.TopCenter, "顶部居中"),
        new(TrackPosition.TopLeft, "左上角"),
        new(TrackPosition.TopRight, "右上角"),
        new(TrackPosition.LeftCenter, "左侧居中"),
        new(TrackPosition.RightCenter, "右侧居中"),
        new(TrackPosition.Center, "屏幕正中"),
    };

    public static readonly EnumItem[] Overflow =
    {
        new(OverflowBehavior.FlushAll, "超出后整体清空（保留最新）"),
        new(OverflowBehavior.RemoveOldest, "超出后逐个移除最旧"),
    };

    public static readonly EnumItem[] TrackScreen =
    {
        new(TrackScreenMode.Primary, "主显示器"),
        new(TrackScreenMode.FollowMouse, "跟随鼠标所在屏幕"),
    };

    public static readonly EnumItem[] EnterAnimations =
    {
        new(EnterAnimation.FromBottom, "从下方弹入"),
        new(EnterAnimation.FromTop, "从上方落入"),
        new(EnterAnimation.FromLeft, "从左侧滑入"),
        new(EnterAnimation.FromRight, "从右侧滑入"),
        new(EnterAnimation.ZoomIn, "由小放大"),
        new(EnterAnimation.ZoomOut, "由大缩小"),
        new(EnterAnimation.Fade, "淡入"),
        new(EnterAnimation.FlipX, "横向展开"),
        new(EnterAnimation.FlipY, "纵向展开"),
    };

    public static readonly EnumItem[] ExitAnimations =
    {
        new(ExitAnimation.FadeUp, "向上隐去（推荐）"),
        new(ExitAnimation.Fade, "原地淡出"),
        new(ExitAnimation.FadeShrink, "缩小淡出"),
        new(ExitAnimation.FloatUp, "向上飘走"),
        new(ExitAnimation.FallDown, "向下坠落"),
        new(ExitAnimation.SlideLeft, "向左滑出"),
        new(ExitAnimation.SlideRight, "向右滑出"),
        new(ExitAnimation.ZoomOut, "急速缩小"),
    };

    public static readonly EnumItem[] Easings =
    {
        new(EasingKind.Linear, "线性"),
        new(EasingKind.InQuad, "缓入"),
        new(EasingKind.OutQuad, "缓出"),
        new(EasingKind.InOutQuad, "缓入缓出"),
        new(EasingKind.InCubic, "三次缓入"),
        new(EasingKind.OutCubic, "三次缓出"),
        new(EasingKind.InOutCubic, "三次缓入缓出"),
        new(EasingKind.OutQuart, "四次缓出"),
        new(EasingKind.OutExpo, "指数缓出"),
        new(EasingKind.InBack, "回缩缓入"),
        new(EasingKind.OutBack, "过冲回弹"),
        new(EasingKind.InOutBack, "双向回弹"),
        new(EasingKind.OutElastic, "弹性振荡"),
        new(EasingKind.OutBounce, "弹跳落地"),
    };

    public static readonly EnumItem[] Trails =
    {
        new(TrailKind.Brush, "画笔流线 · 渐细渐隐（推荐录屏）"),
        new(TrailKind.Ribbon, "丝带光轨 · 柔和双层"),
        new(TrailKind.Comet, "流星尾迹 · 亮核尖尾"),
        new(TrailKind.Dots, "光点珠迹 · 离散渐隐"),
        new(TrailKind.Particles, "极简星尘 · 随行动能"),
        new(TrailKind.None, "关闭拖尾"),
    };

    public static readonly EnumItem[] ClickFx =
    {
        new(ClickFxKind.None, "关闭"),
        new(ClickFxKind.Ripple, "单环 · 极简"),
        new(ClickFxKind.DoubleRipple, "双环 · 层次"),
        new(ClickFxKind.Halo, "光晕 · 柔雾"),
        new(ClickFxKind.Burst, "星散 · 8点"),
        new(ClickFxKind.Pulse, "脉冲 · 实心+环"),
    };
}

/// 枚举 → 中文名（下拉框显示用）
public sealed class EnumNameConverter : IValueConverter
{
    public static readonly EnumNameConverter Instance = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is null) return "";
        foreach (var list in new[]
                 {
                     EnumLists.Orientation, EnumLists.Position, EnumLists.Overflow, EnumLists.TrackScreen,
                     EnumLists.EnterAnimations, EnumLists.ExitAnimations, EnumLists.Easings,
                     EnumLists.Trails, EnumLists.ClickFx,
                 })
        {
            foreach (var item in list)
                if (Equals(item.Value, value))
                    return item.Name;
        }
        return value.ToString();
    }

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value;
}
