using Keyeal.Models;

namespace Keyeal.Rendering;

/// 数值缓动函数（自绘动画用）
public static class Easing
{
    public static double Evaluate(EasingKind kind, double t)
    {
        t = Math.Clamp(t, 0, 1);
        return kind switch
        {
            EasingKind.Linear => t,
            EasingKind.InQuad => t * t,
            EasingKind.OutQuad => 1 - (1 - t) * (1 - t),
            EasingKind.InOutQuad => t < 0.5 ? 2 * t * t : 1 - Math.Pow(-2 * t + 2, 2) / 2,
            EasingKind.InCubic => t * t * t,
            EasingKind.OutCubic => 1 - Math.Pow(1 - t, 3),
            EasingKind.InOutCubic => t < 0.5 ? 4 * t * t * t : 1 - Math.Pow(-2 * t + 2, 3) / 2,
            EasingKind.OutQuart => 1 - Math.Pow(1 - t, 4),
            EasingKind.OutExpo => t == 1 ? 1 : 1 - Math.Pow(2, -10 * t),
            EasingKind.InBack => 2.70158 * t * t * t - 1.70158 * t * t,
            EasingKind.OutBack => 1 + 2.70158 * Math.Pow(t - 1, 3) + 1.70158 * Math.Pow(t - 1, 2),
            EasingKind.InOutBack => InOutBack(t),
            EasingKind.OutElastic => OutElastic(t),
            EasingKind.OutBounce => OutBounce(t),
            _ => t,
        };
    }

    private static double InOutBack(double t)
    {
        const double c = 1.70158 * 1.525;
        return t < 0.5
            ? Math.Pow(2 * t, 2) * ((c + 1) * 2 * t - c) / 2
            : Math.Pow(2 * t - 2, 2) * ((c + 1) * (t * 2 - 2) + c) / 2 + 1;
    }

    private static double OutElastic(double t)
    {
        if (t is 0 or 1) return t;
        const double c4 = 2 * Math.PI / 3;
        return Math.Pow(2, -10 * t) * Math.Sin((t * 10 - 0.75) * c4) + 1;
    }

    private static double OutBounce(double t)
    {
        const double n1 = 7.5625, d1 = 2.75;
        if (t < 1 / d1) return n1 * t * t;
        if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
        if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
        return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }

    public static Avalonia.Media.Color Lerp(Avalonia.Media.Color a, Avalonia.Media.Color b, double t)
    {
        t = Math.Clamp(t, 0, 1);
        return Avalonia.Media.Color.FromArgb(
            (byte)Math.Round(a.A + (b.A - a.A) * t),
            (byte)Math.Round(a.R + (b.R - a.R) * t),
            (byte)Math.Round(a.G + (b.G - a.G) * t),
            (byte)Math.Round(a.B + (b.B - a.B) * t));
    }

    public static Avalonia.Media.Color WithAlpha(Avalonia.Media.Color c, double alphaMultiplier)
        => Avalonia.Media.Color.FromArgb(
            (byte)Math.Clamp(Math.Round(c.A * alphaMultiplier), 0, 255), c.R, c.G, c.B);
}
