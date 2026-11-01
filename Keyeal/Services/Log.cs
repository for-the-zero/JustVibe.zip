using System.Text;

namespace Keyeal.Services;

/// 极简文件日志：%APPDATA%\Keyeal\log.txt（超过 256KB 自动重开）
internal static class Log
{
    private static readonly object Gate = new();
    private static string Dir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Keyeal");
    private static string Path_ => System.IO.Path.Combine(Dir, "log.txt");

    public static void Init()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            var fi = new FileInfo(Path_);
            if (fi.Exists && fi.Length > 256 * 1024) fi.Delete();
            File.AppendAllText(Path_, $"\n==== Keyeal 启动 {DateTime.Now:yyyy-MM-dd HH:mm:ss} ====\n");
        }
        catch { /* 日志失败不影响运行 */ }
    }

    public static void Info(string msg) => Write("INFO", msg);
    public static void Warn(string msg) => Write("WARN", msg);
    public static void Error(string msg) => Write("ERRO", msg);

    private static void Write(string level, string msg)
    {
        try
        {
            lock (Gate)
                File.AppendAllText(Path_,
                    $"{DateTime.Now:HH:mm:ss.fff} [{level}] {msg}\n", Encoding.UTF8);
        }
        catch { }
    }
}
