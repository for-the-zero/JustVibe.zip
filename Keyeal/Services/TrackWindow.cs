using Avalonia;
using Keyeal.Models;
using Keyeal.Rendering;

namespace Keyeal.Services;

public sealed class TrackWindow : OverlayWindowBase
{
    public TrackRenderer Renderer { get; } = new();
    public PixelRect CurrentBounds { get; private set; }

    public TrackWindow()
    {
        Content = Renderer;
        Title = "Keyeal Track";
    }

    public void FitTo(ScreenEntry entry)
    {
        CurrentBounds = entry.Bounds;
        Position = entry.Bounds.Position;
        Width = entry.Bounds.Width / entry.Scale;
        Height = entry.Bounds.Height / entry.Scale;
    }

    public void OnKey(KeyDisplayEvent e) => Renderer.HandleKey(e);
}
