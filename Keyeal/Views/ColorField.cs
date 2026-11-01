using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Data;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;

namespace Keyeal.Views;

/// <summary>
/// 紧凑颜色编辑器（Avalonia 11 核心包不含 ColorPicker）：
/// 色块点击展开 A/R/G/B 滑杆，右侧 HEX 输入框双向同步。
/// </summary>
public sealed class ColorField : StackPanel
{
    public static readonly StyledProperty<Color> ColorProperty =
        AvaloniaProperty.Register<ColorField, Color>(nameof(Color), Colors.White, defaultBindingMode: BindingMode.TwoWay);

    public Color Color
    {
        get => GetValue(ColorProperty);
        set => SetValue(ColorProperty, value);
    }

    private readonly Border _swatch = new()
    {
        Width = 30,
        Height = 30,
        CornerRadius = new CornerRadius(7),
        BorderBrush = new SolidColorBrush(Color.FromArgb(70, 255, 255, 255)),
        BorderThickness = new Thickness(1),
    };
    private readonly TextBox _hex = new() { MinWidth = 100, MaxWidth = 130, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly StackPanel _sliders = new() { Orientation = Orientation.Vertical, Spacing = 3, IsVisible = false };
    private readonly Slider _a = NewSlider(), _r = NewSlider(), _g = NewSlider(), _b = NewSlider();
    private bool _updating;

    public ColorField()
    {
        Orientation = Orientation.Vertical;
        Spacing = 5;

        var toggle = new ToggleButton
        {
            Content = _swatch,
            Padding = new Thickness(2),
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
        };
        toggle.Click += (_, _) => _sliders.IsVisible = !_sliders.IsVisible;

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(toggle);
        row.Children.Add(_hex);
        Children.Add(row);

        //_sliders 已内联初始化
        _sliders.Children.Add(SliderRow("A", _a));
        _sliders.Children.Add(SliderRow("R", _r));
        _sliders.Children.Add(SliderRow("G", _g));
        _sliders.Children.Add(SliderRow("B", _b));
        Children.Add(_sliders);

        _hex.LostFocus += (_, _) => ApplyHex();
        _hex.KeyDown += (_, e) => { if (e.Key == Key.Enter) ApplyHex(); };

        _a.PropertyChanged += (_, e) => { if (e.Property.Name == "Value") ApplySliders(); };
        _r.PropertyChanged += (_, e) => { if (e.Property.Name == "Value") ApplySliders(); };
        _g.PropertyChanged += (_, e) => { if (e.Property.Name == "Value") ApplySliders(); };
        _b.PropertyChanged += (_, e) => { if (e.Property.Name == "Value") ApplySliders(); };

        PropertyChanged += (_, e) =>
        {
            if (e.Property == ColorProperty) UpdateFromColor();
        };
        UpdateFromColor();
    }

    private static Slider NewSlider() => new()
    {
        Minimum = 0,
        Maximum = 255,
        LargeChange = 16,
        SmallChange = 1,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid SliderRow(string label, Slider slider)
    {
        var g = new Grid { ColumnDefinitions = new ColumnDefinitions("16,240,40") };
        var l = new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center, Foreground = Brushes.Gray, FontSize = 11 };
        var v = new TextBlock
        {
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = Brushes.Gray,
            FontSize = 11,
            TextAlignment = TextAlignment.Right,
        };
        slider.ValueChanged += (_, e) => v.Text = $"{(int)Math.Round(e.NewValue)}";
        Grid.SetColumn(l, 0);
        Grid.SetColumn(slider, 1);
        Grid.SetColumn(v, 2);
        g.Children.Add(l);
        g.Children.Add(slider);
        g.Children.Add(v);
        return g;
    }

    private void ApplySliders()
    {
        if (_updating) return;
        _updating = true;
        try
        {
            Color = Color.FromArgb((byte)_a.Value, (byte)_r.Value, (byte)_g.Value, (byte)_b.Value);
        }
        finally { _updating = false; }
        RefreshVisuals();
    }

    private void ApplyHex()
    {
        var text = _hex.Text?.Trim();
        if (string.IsNullOrEmpty(text)) return;
        if (!text.StartsWith('#')) text = "#" + text;
        try
        {
            _updating = true;
            Color = Color.Parse(text);
            _updating = false;
            UpdateFromColor();
        }
        catch
        {
            _updating = true;
            UpdateFromColor();
            _updating = false;
        }
    }

    private void UpdateFromColor()
    {
        if (_updating) return;
        _updating = true;
        try
        {
            RefreshVisuals();
        }
        finally { _updating = false; }
    }

    private void RefreshVisuals()
    {
        var c = Color;
        _swatch.Background = new SolidColorBrush(c);
        _hex.Text = $"#{c.A:X2}{c.R:X2}{c.G:X2}{c.B:X2}";
        _a.Value = c.A;
        _r.Value = c.R;
        _g.Value = c.G;
        _b.Value = c.B;
    }
}
