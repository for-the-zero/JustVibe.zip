# m3e-img-mask

基于 Lit 的图片遮罩/占位组件，配合 `m3e-img-viewer` 可实现点击查看大图。

## 安装

```bash
npm i m3e-img-mask
```

## 使用

```ts
import 'm3e-img-mask';
```

```html
<m3e-img-mask src="/a.jpg" alt="示例" width="320px" height="200px"></m3e-img-mask>

<!-- 无骨架屏、禁用查看器 -->
<m3e-img-mask src="/a.jpg" skeleton="false" no-viewer></m3e-img-mask>
```

## 属性

- `src`：图片地址
- `alt` / `title`：图片描述与标题
- `width` / `height`：容器/图片尺寸（如 `320px`、`100%`）
- `skeleton`：是否显示骨架屏与加载指示，默认 `true`，设为 `false` 可关闭
- `no-viewer`：禁用点击打开查看器

## 事件与样式

- 加载完成且未设置 `no-viewer` 时，点击会冒泡派发 `open-image` 事件，`event.detail.target` 为当前元素。
- CSS Parts：`container`、`img`
