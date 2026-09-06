import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
const root = path.resolve(import.meta.dirname, '..');
const run = path.join(root, '.runtime', process.argv[2] || `run-${Date.now()}`);
await mkdir(path.join(run, 'profile', 'extensions'), { recursive: true });
await mkdir(path.join(run, 'data'), { recursive: true });
await writeFile(path.join(run, 'result.json'), JSON.stringify({ ok: null, stage: 'prepared', at: new Date().toISOString() }));
const prefs = {
  'extensions.zotero.useDataDir': true, 'extensions.zotero.dataDir': path.join(run, 'data'),
  'extensions.zotero.firstRun2': false, 'extensions.zotero.firstRunGuidance': false,
  'extensions.zotero.automaticScraperUpdates': false, 'extensions.zotero.sync.autoSync': false,
  'extensions.autoDisableScopes': 0, 'extensions.enabledScopes': 15,
  'extensions.logging.enabled': true,
  'extensions.zoteroWinWordIntegration.skipInstallation': true,
  'extensions.zoteroOpenOfficeIntegration.skipInstallation': true,
  'browser.shell.checkDefaultBrowser': false, 'toolkit.telemetry.enabled': false,
  'extensions.margin.language': 'auto', 'intl.locale.requested': 'zh-CN', 'extensions.zotero.fontSize': 13,
};
await writeFile(path.join(run, 'profile/user.js'), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const entries = unzipSync(await readFile(path.join(root, `dist/margin-${version}.xpi`)));
let bootstrap = strFromU8(entries['bootstrap.js']);
bootstrap = bootstrap.replace('  await Margin.startup({ id, rootURI });', `  await Margin.startup({ id, rootURI });\n  scope.RUNTIME_DIR = ${JSON.stringify(run)};\n  timers.setTimeout(() => Services.scriptloader.loadSubScript(rootURI + 'integration.js', scope), 2500);`);
// Record failures even when the plugin fails before the integration runner starts.
bootstrap = bootstrap.replace('async function startup({ id, rootURI }) {', 'async function startup({ id, rootURI }) {\n try {');
bootstrap = bootstrap.replace('\n}\nfunction shutdown()', `\n } catch (error) { await IOUtils.writeJSON(${JSON.stringify(path.join(run, 'result.json'))}, {ok:false, stage:'bootstrap', error:String(error), stack:error.stack}); throw error; }\n}\nfunction shutdown()`);
entries['bootstrap.js'] = strToU8(bootstrap);
entries['integration.js'] = new Uint8Array(await readFile(path.join(root, 'scripts/runtime-integration.js')));
await writeFile(path.join(run, 'profile/extensions/margin@zotero.local.xpi'), zipSync(entries));

// Small deterministic PDF fixture: 3 pages, labels i / 21 / 22.
const bodies = [
  'Margin Reading Lab. This document is a local test fixture.',
  'Security of Multi-Party Computation. The view of an adversary consists of inputs and messages. A simulator produces an ideal-world view.',
  'Definition. A simulator is an algorithm that generates an ideal-world view indistinguishable from the real-world view. End of proof.',
];
const objects = [null, '<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 1 << /S /D /St 21 >>] >> >>', '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
for (let i = 0; i < 3; i++) {
  const lines = bodies[i].match(/.{1,65}(?: |$)/g) || [bodies[i]];
  const stream = `BT /F1 15 Tf 65 710 Td 23 TL ${lines.map((l, j) => `${j ? 'T* ' : ''}(${l.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n')} ET`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
}
let pdf = '%PDF-1.7\n', offsets = [0];
for (let i = 1; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n` + offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile(path.join(run, 'reading-lab.pdf'), pdf);
await writeFile(path.join(root, '.runtime/current.json'), JSON.stringify({ run, profile: path.join(run, 'profile') }));
console.log(run);
