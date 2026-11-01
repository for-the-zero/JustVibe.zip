using System.Runtime.InteropServices.JavaScript;
using Google.Protobuf;
using Google.Protobuf.Reflection;

public partial class Exports
{
    [JSExport]
    public static string Hello(string name) => "hi " + name;

    static readonly Dictionary<string, MessageDescriptor> Reg = Build();

    static readonly JsonFormatter Formatter = new JsonFormatter(
        JsonFormatter.Settings.Default.WithTypeRegistry(
            TypeRegistry.FromFiles(Reg.Values.Select(m => m.File).Distinct().ToArray())));

    static Dictionary<string, MessageDescriptor> Build()
    {
        var reg = new Dictionary<string, MessageDescriptor>();
        AddFile(Bilibili.App.Show.V1.PopularResultReq.Descriptor.File, reg);
        AddFile(Bilibili.App.View.V1.ViewReq.Descriptor.File, reg);
        AddFile(Bilibili.Metadata.Metadata.Descriptor.File, reg);
        AddFile(Bilibili.Ad.V1.AdAutoPlayVideoDto.Descriptor.File, reg);
        return reg;
    }

    static void AddFile(FileDescriptor file, Dictionary<string, MessageDescriptor> reg)
    {
        foreach (var m in Enumerate(file.MessageTypes)) reg[m.FullName] = m;
        foreach (var dep in file.Dependencies) AddFile(dep, reg);
    }

    static IEnumerable<MessageDescriptor> Enumerate(IEnumerable<MessageDescriptor> msgs)
    {
        foreach (var m in msgs)
        {
            yield return m;
            foreach (var n in Enumerate(m.NestedTypes)) yield return n;
        }
    }

    [JSExport]
    public static string Encode(string type, string json)
        => Convert.ToBase64String(JsonParser.Default.Parse(json, Reg[type]).ToByteArray());

    [JSExport]
    public static string Decode(string type, string b64)
        => Formatter.Format(Reg[type].Parser.ParseFrom(Convert.FromBase64String(b64)));

    [JSExport]
    public static string Types() => string.Join("\n", Reg.Keys.OrderBy(k => k));
}
