# m3e-img-viewer

基于 OpenSeadragon 的图片查看器，可与 `m3e-img-mask` 配合使用（监听 `open-image` 事件）。

## 安装

```bash
npm i m3e-img-viewer m3e-img-mask
```

## 使用

```ts
import 'm3e-img-mask';
import { installViewer } from 'm3e-img-viewer';

installViewer({
  container: '#article-content', // 可选：在该容器内收集图片
  selector: 'm3e-img-mask',      // 可选：图片元素选择器
});
```

默认样式已由包入口自动引入（`m3e-img-viewer.css`）。

## API

- `installViewer(options?)`：监听文档上的 `open-image` 事件并打开查看器
- `openViewer(target, options?)`：手动打开指定图片
- `closeViewer()`：关闭查看器

`options`：
- `container`：收集同组图片的容器元素或选择器
- `selector`：图片选择器，默认 `m3e-img-mask, m3e-lazy-image`

## 功能

支持缩放/拖拽、上一张下一张、缩略图、旋转/翻转、适应/原始大小、保存、全屏、键盘快捷键（Esc/←/→/+/-/0/F/S）等。
