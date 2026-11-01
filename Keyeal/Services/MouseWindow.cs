using Avalonia;
using Keyeal.Rendering;

namespace Keyeal.Services;

public sealed class MouseWindow : OverlayWindowBase
{
    public MouseEffectLayer Layer { get; } = new();
    public PixelRect CurrentBounds { get; private set; }

    public MouseWindow()
    {
        Content = Layer;
        Title = "Keyeal Mouse";
    }

    public void FitTo(ScreenEntry entry)
    {
        CurrentBounds = entry.Bounds;
        Position = entry.Bounds.Position;
        Width = entry.Bounds.Width / entry.Scale;
        Height = entry.Bounds.Height / entry.Scale;
    }
}
