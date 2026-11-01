using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using Avalonia.Media;
using Avalonia.Threading;
using Keyeal.Models;

namespace Keyeal.Services;

/// 设置加载 / 防抖保存（%APPDATA%\Keyeal\settings.json）
public sealed class SettingsService
{
    public Settings Current { get; private set; } = new();

    private DispatcherTimer? _saveTimer;
    private static string Dir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Keyeal");
    private static string FilePath => Path.Combine(Dir, "settings.json");

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter(), new ColorJsonConverter() },
    };

    public void Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var loaded = JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath), JsonOpts);
                if (loaded is { }) Current = loaded;
            }
        }
        catch (Exception ex)
        {
            Log.Error("load settings: " + ex);
            Current = new Settings();
        }
    }

    public void RequestSave()
    {
        if (_saveTimer is { }) return;
        _saveTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        _saveTimer.Tick += (_, _) =>
        {
            _saveTimer?.Stop();
            _saveTimer = null;
            SaveNow();
        };
        _saveTimer.Start();
    }

    public void SaveNow()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(Current, JsonOpts));
        }
        catch (Exception ex) { Log.Error("save settings: " + ex); }
    }
}

/// Color ⇋ "#AARRGGBB"
public sealed class ColorJsonConverter : JsonConverter<Color>
{
    public override Color Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var s = reader.GetString();
        if (string.IsNullOrEmpty(s)) return default;
        try { return Color.Parse(s); }
        catch { return default; }
    }

    public override void Write(Utf8JsonWriter writer, Color value, JsonSerializerOptions options)
        => writer.WriteStringValue($"#{value.A:X2}{value.R:X2}{value.G:X2}{value.B:X2}");
}
