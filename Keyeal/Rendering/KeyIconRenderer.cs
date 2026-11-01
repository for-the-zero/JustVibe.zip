using Avalonia;
using Avalonia.Media;

namespace Keyeal.Rendering;

/// <summary>
/// 高清矢量按键图标渲染器：
/// 为所有修饰键（Ctrl/Shift/Alt/Win）及常用功能键（Enter/Backspace/Tab/Space/Esc/Delete/Arrows）
/// 提供纯正 SVG 矢量几何图形，免去字体不兼容或字符失真问题，呈现工业级锐利质感。
/// </summary>
public static class KeyIconRenderer
{
    private static readonly Dictionary<string, (Geometry FillGeom, Geometry? StrokeGeom, bool IsStrokeOnly, double ViewBox)> _iconMap = new();

    static KeyIconRenderer()
    {
        // 16x16 坐标系标准矢量定义
        RegisterStroke("⌃", "M 3.5,10.5 L 8,5.5 L 12.5,10.5", 16); // Ctrl
        RegisterFill("⇧", "M 8,2 L 13.5,7.5 L 10.5,7.5 L 10.5,14 L 5.5,14 L 5.5,7.5 L 2.5,7.5 Z", 16); // Shift
        RegisterStroke("⌥", "M 2.5,3.5 L 6,3.5 L 10.5,12.5 L 13.5,12.5 M 9.5,3.5 L 13.5,3.5", 16); // Alt / Option
        RegisterFill("⊞", "M 2,2.5 L 7,2.5 L 7,7.2 L 2,7.2 Z M 8.5,2.5 L 13.5,2.5 L 13.5,7.2 L 8.5,7.2 Z M 2,8.8 L 7,8.8 L 7,13.5 L 2,13.5 Z M 8.5,8.8 L 13.5,8.8 L 13.5,13.5 L 8.5,13.5 Z", 16); // Windows
        RegisterStroke("↵", "M 13,3.5 L 13,9.5 L 4,9.5 M 7.5,6 L 3.5,9.5 L 7.5,13", 16); // Enter / Return
        Register("⌫", "M 5.5,2.5 L 14,2.5 L 14,13.5 L 5.5,13.5 L 1.5,8 Z", "M 7,5.5 L 11,10.5 M 11,5.5 L 7,10.5", 16); // Backspace
        RegisterStroke("⇥", "M 2.5,8 L 11.5,8 M 8,4.5 L 11.5,8 L 8,11.5 M 13.5,3.5 L 13.5,12.5", 16); // Tab
        RegisterStroke("⎋", "M 8,2.5 L 13.5,8 L 2.5,8 Z M 2.5,11.5 L 13.5,11.5", 16); // Esc
        RegisterStroke("␣", "M 2.5,7.5 L 2.5,12 L 13.5,12 L 13.5,7.5", 16); // Space
        Register("⌦", "M 2,2.5 L 10.5,2.5 L 14.5,8 L 10.5,13.5 L 2,13.5 Z", "M 5,5.5 L 9,10.5 M 9,5.5 L 5,10.5", 16); // Del
        RegisterFill("⇪", "M 8,2.5 L 13.5,8 L 10.5,8 L 10.5,11.5 L 5.5,11.5 L 5.5,8 L 2.5,8 Z M 5.5,13 L 10.5,13 L 10.5,14.5 L 5.5,14.5 Z", 16); // Caps

        // 方向键
        RegisterStroke("↑", "M 8,13.5 L 8,3 M 4,7 L 8,3 L 12,7", 16);
        RegisterStroke("↓", "M 8,2.5 L 8,13 M 4,9 L 8,13 L 12,9", 16);
        RegisterStroke("←", "M 13.5,8 L 3,8 M 7,4 L 3,8 L 7,12", 16);
        RegisterStroke("→", "M 2.5,8 L 13,8 M 9,4 L 13,8 L 9,12", 16);
    }

    private static void RegisterFill(string key, string fillData, double vb)
    {
        var geom = StreamGeometry.Parse(fillData);
        _iconMap[key] = (geom, null, false, vb);
    }

    private static void RegisterStroke(string key, string strokeData, double vb)
    {
        var geom = StreamGeometry.Parse(strokeData);
        _iconMap[key] = (geom, null, true, vb);
    }

    private static void Register(string key, string fillData, string strokeData, double vb)
    {
        var fill = StreamGeometry.Parse(fillData);
        var stroke = StreamGeometry.Parse(strokeData);
        _iconMap[key] = (fill, stroke, false, vb);
    }

    public static bool HasIcon(string label) => _iconMap.ContainsKey(label);

    public static bool TryDrawIcon(DrawingContext ctx, string label, Rect cellRect, IBrush brush, double targetSize)
    {
        if (!_iconMap.TryGetValue(label, out var item)) return false;

        double size = Math.Min(targetSize, Math.Min(cellRect.Width * 0.55, cellRect.Height * 0.55));
        double scale = size / item.ViewBox;
        double cx = cellRect.X + (cellRect.Width - size) / 2;
        double cy = cellRect.Y + (cellRect.Height - size) / 2;

        using (ctx.PushTransform(
                   Matrix.CreateScale(scale, scale) *
                   Matrix.CreateTranslation(cx, cy)))
        {
            if (item.IsStrokeOnly)
            {
                var strokePen = new Pen(brush, 1.8 / scale, null, PenLineCap.Round, PenLineJoin.Round);
                ctx.DrawGeometry(null, strokePen, item.FillGeom);
            }
            else
            {
                ctx.DrawGeometry(brush, null, item.FillGeom);
                if (item.StrokeGeom is { })
                {
                    var innerPen = new Pen(new SolidColorBrush(Color.FromArgb(200, 20, 22, 28)), 1.6 / scale, null, PenLineCap.Round, PenLineJoin.Round);
                    ctx.DrawGeometry(null, innerPen, item.StrokeGeom);
                }
            }
        }
        return true;
    }
}
