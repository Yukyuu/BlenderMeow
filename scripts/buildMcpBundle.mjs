import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '1.3.2';

function toDataUrlPng(filePath) {
  const buf = fs.readFileSync(filePath);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const faviconDataUrl = toDataUrlPng(path.join(rootDir, 'public', 'favicon.png'));
const inlineAssets = {
  './icon.png': toDataUrlPng(path.join(rootDir, 'public', 'icon.png')),
};
for (let n = 1; n <= 8; n++) {
  inlineAssets[`./theotown/template_${n}x${n}.png`] = toDataUrlPng(
    path.join(rootDir, 'public', 'theotown', `template_${n}x${n}.png`),
  );
}

const distAssetsDir = path.join(rootDir, 'dist', 'assets');
const cssFiles = fs.existsSync(distAssetsDir)
  ? fs.readdirSync(distAssetsDir).filter((f) => f.endsWith('.css'))
  : [];
const cssContent = cssFiles
  .map((f) => fs.readFileSync(path.join(distAssetsDir, f), 'utf8'))
  .join('\n')
  .replace(/<\/style/gi, '<\\/style');

const result = await esbuild.build({
  entryPoints: [path.join(rootDir, 'src', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  loader: { '.css': 'empty' },
  define: {
    'import.meta.env.MODE': '"production"',
    'import.meta.env.PROD': 'true',
    'import.meta.env.DEV': 'false',
    '__APP_VERSION__': JSON.stringify(version),
  },
});

const jsCode = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const assetsJson = JSON.stringify(inlineAssets).replace(/<\/script/gi, '<\\/script');

const html = [
  '<!DOCTYPE html>',
  '<html lang="zh-CN">',
  '<head>',
  '  <meta charset="UTF-8" />',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />',
  '  <meta name="theme-color" content="#1e1e22" />',
  '  <meta name="apple-mobile-web-app-capable" content="yes" />',
  `  <link rel="icon" type="image/png" href="${faviconDataUrl}" />`,
  `  <title>Blender Meow v${version} · AI 等距3D建模坊 (MCP/Sidecar)</title>`,
  `  <style>${cssContent}</style>`,
  '</head>',
  '<body>',
  '  <div id="app"></div>',
  `  <script>globalThis.__BMEOW_INLINE_ASSETS__=${assetsJson};</script>`,
  `  <script>${jsCode}</script>`,
  '</body>',
  '</html>',
].join('\n');

const outDir = path.join(rootDir, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'blendermeow-mcp.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(`Built standalone MCP Sidecar HTML: ${outPath} (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)`);
