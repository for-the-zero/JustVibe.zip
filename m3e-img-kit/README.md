# m3e-img-kit

从 Fenstego3 博客/链接页面提取的 Lit 组件：

- `m3e-img-mask/`：图片遮罩/占位组件（可选 `width`、`height`，可选 `skeleton` 骨架屏）
- `m3e-img-viewer/`：图片查看器（缩放/旋转/翻转/全屏/下载/缩略图导航，基于 OpenSeadragon）

## 运行 demo

```bash
npm install
npm run dev
```

## m3e-img-mask

```ts
import 'm3e-img-mask/src';
```

```html
<m3e-img-mask src="..." alt="..." width="240px" height="150px"></m3e-img-mask>
<m3e-img-mask src="..." skeleton="false" no-viewer></m3e-img-mask>
```

- `src` / `alt` / `title`
- `width` / `height`：可选尺寸
- `skeleton`：是否显示骨架屏（默认 `true`，可设 `skeleton="false"`）
- `no-viewer`：禁用点击打开查看器
- 加载完成后触发 `open-image` 事件（`detail.target` 为元素本身）

## m3e-img-viewer

```ts
import { installViewer, openViewer, closeViewer } from 'm3e-img-viewer/src';

installViewer({ container: '#gallery', selector: 'm3e-img-mask, m3e-lazy-image' });
// 或手动：openViewer(targetElement, { container, selector })
```
