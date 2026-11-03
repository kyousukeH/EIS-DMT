import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const output = path.join(root, 'eis-dmt-console.html');

let html = await readFile(path.join(dist, 'index.html'), 'utf8');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const scriptMatch = html.match(/<script\b([^>]*?)\bsrc="([^"]+)"([^>]*)><\/script>/i);
const styleMatch = html.match(/<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="([^"]+)")[^>]*>/i);

if (!scriptMatch || !styleMatch) {
  throw new Error('无法从 dist/index.html 找到构建后的脚本或样式资源。');
}

const resolveAsset = (asset) => path.join(dist, asset.replace(/^\//, ''));
const javascript = (await readFile(resolveAsset(scriptMatch[2]), 'utf8')).replace(/<\/script/gi, '<\\/script');
const css = (await readFile(resolveAsset(styleMatch[1]), 'utf8')).replace(/<\/style/gi, '<\\/style');
const runtimeConfig = {
  mode: 'mock',
  namespace: 'konveyor-forklift',
  inventoryEnabled: true,
  defaultStorageClass: 'ocs-storagecluster-ceph-rbd',
  defaultVolumeMode: 'Block',
  defaultAccessMode: 'ReadWriteMany',
  version: packageJson.version,
};
const bootstrap = `<script>globalThis.__EIS_DMT_CONFIG__=${JSON.stringify(runtimeConfig)};</script>`;

html = html
  .replace(styleMatch[0], () => `<style>\n${css}\n</style>`)
  .replace(scriptMatch[0], () => `${bootstrap}\n<script type="module">\n${javascript}\n</script>`)
  .replace('</head>', '    <meta name="eis-dmt-export" content="standalone-mock" />\n  </head>');

await writeFile(output, html, 'utf8');
const size = Buffer.byteLength(html);
stdout.write(`Standalone HTML created: ${output} (${(size / 1024 / 1024).toFixed(2)} MiB)\n`);
