import '@m3e/web/theme';
import '../m3e-img-mask/src/index';
import { installViewer } from '../m3e-img-viewer/src/index';
import './style.css';

installViewer({ container: '#gallery' });

const app = document.getElementById('app')!;
const img = (w: number, h: number, text: string, bg = '4f6bed', fg = 'ffffff') =>
  `https://placehold.co/${w}x${h}/${bg}/${fg}/png?text=${encodeURIComponent(text)}`;

app.innerHTML = `
  <m3e-theme>
    <main class="page">
      <h1>m3e-img-kit demo</h1>
      <p>m3e-img-mask（可选宽高、有无 skeleton）+ m3e-img-viewer</p>

      <section>
        <h2>带 skeleton + 可点击查看</h2>
        <div id="gallery" class="row" data-viewer-group>
          <m3e-img-mask src="${img(800, 500, 'Image 1', '4f6bed')}" alt="图 1" width="240px" height="150px"></m3e-img-mask>
          <m3e-img-mask src="${img(800, 500, 'Image 2', '2e9f6e')}" alt="图 2" width="240px" height="150px"></m3e-img-mask>
          <m3e-img-mask src="${img(800, 500, 'Image 3', 'd97706')}" alt="图 3" width="240px" height="150px"></m3e-img-mask>
        </div>
      </section>

      <section>
        <h2>无 skeleton（skeleton="false"）</h2>
        <div class="row">
          <m3e-img-mask src="${img(600, 400, 'No Skeleton 1', '64748b')}" alt="无骨架屏 1" width="200px" height="133px" skeleton="false" no-viewer></m3e-img-mask>
          <m3e-img-mask src="${img(600, 400, 'No Skeleton 2', '475569')}" alt="无骨架屏 2" width="200px" height="133px" skeleton="false" no-viewer></m3e-img-mask>
        </div>
        <p class="note">上例已设置 <code>skeleton="false"</code> 与 <code>no-viewer</code>，不显示骨架占位与加载后的查看器入口行为。</p>
      </section>

      <section>
        <h2>自定义尺寸（仅宽度）</h2>
        <div class="row">
          <m3e-img-mask src="${img(900, 600, 'Width 320', '7c3aed')}" alt="自定义宽度" width="320px"></m3e-img-mask>
        </div>
      </section>
    </main>
  </m3e-theme>
`;
