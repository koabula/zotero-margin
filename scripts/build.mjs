import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'build', 'addon');
await mkdir(out, { recursive: true });
await cp(path.join(root, 'addon'), out, { recursive: true });
await build({ entryPoints: [path.join(root, 'src/main.ts')], bundle: true, format: 'iife', globalName: 'Margin', target: 'firefox140', outfile: path.join(out, 'plugin.js'), legalComments: 'eof', sourcemap: false });
await mkdir(path.join(out, 'katex'), { recursive: true });
await cp(path.join(root, 'node_modules/katex/dist/katex.min.css'), path.join(out, 'katex/katex.min.css'));
await cp(path.join(root, 'node_modules/katex/dist/fonts'), path.join(out, 'katex/fonts'), { recursive: true });
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
manifest.version = packageInfo.version;
await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
const entries = {};
async function collect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await collect(file);
    else entries[path.relative(out, file).replaceAll('\\', '/')] = new Uint8Array(await readFile(file));
  }
}
await collect(out);
entries['THIRD_PARTY_NOTICES.txt'] = strToU8(await readFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8'));
for (const name of ['markdown-it', 'katex', 'argparse', 'entities', 'linkify-it', 'mdurl', 'punycode.js', 'uc.micro']) {
  const dir = path.join(root, 'node_modules', name);
  for (const file of await readdir(dir)) if (/^license/i.test(file)) entries[`licenses/${name}-${file}`] = new Uint8Array(await readFile(path.join(dir, file)));
}
await mkdir(path.join(root, 'dist'), { recursive: true });
const archive = path.join(root, 'dist', `margin-${packageInfo.version}.xpi`);
await writeFile(archive, zipSync(entries, { level: 6 }));
console.log(`Built ${archive} (${Object.keys(entries).length} files)`);
