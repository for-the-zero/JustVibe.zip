import { readFileSync } from 'node:fs';
let html = readFileSync('dist/index.html', 'utf8');
const tagM = /<link\b[^>]*rel="stylesheet"[^>]*>/.exec(html);
console.log('TAG=', tagM && tagM[0]);
const allLinks = [...html.matchAll(/<link[^>]*>/g)].map(m => m[0]);
console.log('ALL_LINKS=', JSON.stringify(allLinks));
console.log('STYLE_BEFORE=', (html.match(/<style>/g) || []).length);
const srcM = tagM && /href="([^"]+)"/.exec(tagM[0]);
console.log('SRC=', srcM && srcM[1]);
