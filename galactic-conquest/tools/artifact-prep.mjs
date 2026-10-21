// Turns a built test build into one self-contained page fragment for publishing
// as a claude.ai artifact: scripts and styles inlined, document skeleton removed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const name = process.argv[2];
if (!name) {
  console.error('usage: node tools/artifact-prep.mjs <testbuild-folder>');
  process.exit(1);
}
const htmlPath = resolve('dist/testbuilds', name, 'index.html');
const dir = dirname(htmlPath);
let html = readFileSync(htmlPath, 'utf8');

html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_m, src) => {
  const js = readFileSync(resolve(dir, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (m, href) => {
  if (/^https?:/.test(href)) return m;
  return `<style>${readFileSync(resolve(dir, href), 'utf8')}</style>`;
});

const head = (html.match(/<head>([\s\S]*?)<\/head>/) ?? [])[1] ?? '';
const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/) ?? [])[1] ?? '';
const headKept = head
  .replace(/<meta charset[^>]*>/gi, '')
  .replace(/<meta name="viewport"[^>]*>/gi, '')
  .replace(/<link rel="modulepreload"[^>]*>/gi, '')
  .replace(/<link rel="icon"[^>]*>/gi, '');

mkdirSync('artifact', { recursive: true });
const out = resolve('artifact', `${name}.html`);
writeFileSync(out, `${headKept.trim()}\n${body.trim()}\n`);
console.log(`wrote ${out}`);
