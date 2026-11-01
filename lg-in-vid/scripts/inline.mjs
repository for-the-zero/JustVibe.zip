import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve('dist');
const htmlPath = resolve(dist, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
const abs = (u) => decodeURIComponent(u.replace(/^\.?\//, ''));

html = html
  .replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (m, src) => {
    const code = readFileSync(resolve(dist, abs(src)), 'utf8');
    return `<script type="module">\n${code}\n</script>`;
  })
  .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, (m) => {
    const srcM = /href="([^"]+)"/.exec(m);
    if (!srcM) return m;
    const css = readFileSync(resolve(dist, abs(srcM[1])), 'utf8');
    return `<style>\n${css}\n</style>`;
  });

writeFileSync(htmlPath, html);
if (existsSync(resolve(dist, 'assets'))) rmSync(resolve(dist, 'assets'), { recursive: true, force: true });
console.log('inlined -> dist/index.html');
