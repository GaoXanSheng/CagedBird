/* 构建：单文件 dist/index.html —— 依赖全部内联，双击即可离线游玩 */
import fs from 'node:fs';
import esbuild from 'esbuild';

const html = fs.readFileSync('index.html', 'utf8');
const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!mod) throw new Error('module script not found');
fs.writeFileSync('.build-entry.mjs', mod[1]);

await esbuild.build({
  entryPoints: ['.build-entry.mjs'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: '.build-bundle.mjs',
  legalComments: 'none',
  logLevel: 'info',
});

const bundle = fs.readFileSync('.build-bundle.mjs', 'utf8').replace(/<\/script/gi, '<\\/script');
const out = html
  .replace(/<script type="importmap">[\s\S]*?<\/script>/, '')
  .replace(/<script type="module">[\s\S]*?<\/script>/, () => '<script type="module">\n' + bundle + '\n</script>');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', out);
fs.unlinkSync('.build-entry.mjs');
fs.unlinkSync('.build-bundle.mjs');
console.log('dist/index.html:', (fs.statSync('dist/index.html').size / 1048576).toFixed(2), 'MB');
