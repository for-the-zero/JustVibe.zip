using System.ComponentModel;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Keyeal.Models;
using Keyeal.Services;

namespace Keyeal.Views;

public partial class SettingsWindow : Avalonia.Controls.Window
{
    private readonly Settings S;

    public SettingsWindow()
    {
        InitializeComponent();
        S = App.Inst.S;
        DataContext = S;
        try
        {
            using var stream = AssetLoader.Open(new Uri("avares://Keyeal/Assets/icon32.png"));
            Icon = new Avalonia.Controls.WindowIcon(stream);
        }
        catch { }
        ChkCtrl.IsChecked = (S.ClearMods & KeyLabelProvider.ModCtrl) != 0;
        ChkShift.IsChecked = (S.ClearMods & KeyLabelProvider.ModShift) != 0;
        ChkAlt.IsChecked = (S.ClearMods & KeyLabelProvider.ModAlt) != 0;
        ChkWin.IsChecked = (S.ClearMods & KeyLabelProvider.ModWin) != 0;
        S.PropertyChanged += OnSettingChanged;
    }

    private void OnSettingChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(Settings.AutoStart))
            AutoStartService.Apply(S.AutoStart);
        else if (e.PropertyName == nameof(Settings.Position))
            S.SuggestEnterFor(S.Position);
    }

    private void OnPaletteClick(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
    {
        if ((sender as Avalonia.Controls.Button)?.DataContext is Palette p)
            S.ApplyPalette(p);
    }

    private void OnClearModChanged(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
    {
        S.ClearMods =
            (ChkCtrl.IsChecked == true ? KeyLabelProvider.ModCtrl : 0) |
            (ChkShift.IsChecked == true ? KeyLabelProvider.ModShift : 0) |
            (ChkAlt.IsChecked == true ? KeyLabelProvider.ModAlt : 0) |
            (ChkWin.IsChecked == true ? KeyLabelProvider.ModWin : 0);
    }

    protected override void OnClosing(Avalonia.Controls.WindowClosingEventArgs e)
    {
        if (App.Inst.ShouldCancelClose(this))
            e.Cancel = true;
        base.OnClosing(e);
    }

    private void OnReset(object? sender, Avalonia.Interactivity.RoutedEventArgs e)
    {
        S.ResetToDefaults();
        AutoStartService.Apply(S.AutoStart);
        ChkCtrl.IsChecked = (S.ClearMods & KeyLabelProvider.ModCtrl) != 0;
        ChkShift.IsChecked = (S.ClearMods & KeyLabelProvider.ModShift) != 0;
        ChkAlt.IsChecked = (S.ClearMods & KeyLabelProvider.ModAlt) != 0;
        ChkWin.IsChecked = (S.ClearMods & KeyLabelProvider.ModWin) != 0;
    }

    private void OnDone(object? sender, Avalonia.Interactivity.RoutedEventArgs e) => Hide();
}
