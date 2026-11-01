https://linux.do/t/topic/2832654

https://ftz.is-a.dev/blog/posts/learncs/#vertualkb

# VertualKb — 90° 翻转的虚拟键盘（Moonlight 串流辅助）

用 Avalonia 编写的 Windows 虚拟键盘：整个键盘按**手机竖屏键盘布局**排版，然后整体旋转 90° 显示在**屏幕右缘**（空格键贴屏幕右边缘）。

## 用途

手机用 Moonlight 横屏串流电脑时，把手机**顺时针竖过来**，这条键盘看起来就是一个正常的手机输入法键盘——可以直接像手机打字一样点按，按键通过 `SendInput` 直接发送给电脑当前前台窗口（游戏 / 聊天框等）。

- 键盘窗口不抢焦点（`WS_EX_NOACTIVATE`），点击键盘不会让游戏失焦。
- 窗口高度 = 屏幕高度，停靠屏幕右侧，Topmost 置顶。
- 顶部预览条实时显示正在输入的内容（仅提示用，字符是直接发给前台程序的）。

## 布局

- **字母层**：QWERTY 手机布局，Shift / 退格 / 空格 / 回车 / 逗号句号。
- **?123 符号层**：数字与常用符号，输入一个字符后自动回字母层。
- **更多（二级菜单）**：Esc、Tab、Caps、Insert/Home/PgUp/Del/End/PgDn、Win/Ctrl/Alt/Shift（粘滞，按一次再按字母即可组合键）、F1–F12、方向键（支持长按连发）、复制/粘贴/剪切（Ctrl+C/V/X）、音量键。
- 顶栏：⌨ 折叠成右侧小把手（随用随走）、清除预览、✕ 退出；拖动顶栏可移动窗口。

## 构建与运行

需要 .NET 9 SDK（或安装 .NET Desktop Runtime 后直接运行 exe）：

```bash
dotnet build -c Release
dotnet publish -c Release -r win-x64 --self-contained false
# 产物: bin/Release/net9.0-windows/publish/VertualKb.exe
```

## 注意

- 按键映射按**美式键盘布局**（VK + 扫描码）发送；中文输入需依赖目标程序的输入法。
- 目标程序若以管理员权限运行，需以管理员身份运行本程序才能注入按键（UIPI 限制）。
