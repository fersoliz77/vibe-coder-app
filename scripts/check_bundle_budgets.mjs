import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const distPath = fileURLToPath(dist);

/*
 * Los limites viven en datos, no aca: este archivo es el mismo en la web y en
 * el escritorio, y los dos productos no pueden pesar lo mismo. El escritorio
 * empaqueta CodeMirror y xterm, que la web no carga.
 */
let limits;
try {
  const declared = JSON.parse(readFileSync(new URL('bundle-budgets.json', root), 'utf8'));
  limits = Object.fromEntries(Object.entries(declared)
    .filter(([type]) => !type.startsWith('_'))
    .map(([type, budget]) => [type, { raw: budget.raw * 1024, gzip: budget.gzip * 1024 }]));
} catch (error) {
  console.error(`Bundle budgets: no se pudo leer bundle-budgets.json (${error.message}).`);
  process.exit(1);
}
for (const type of ['entry', 'chunk', 'css', 'totalJs']) {
  if (!limits[type]) {
    console.error(`Bundle budgets: falta el presupuesto "${type}" en bundle-budgets.json.`);
    process.exit(1);
  }
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function format(bytes) {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

let html;
try {
  html = readFileSync(new URL('index.html', dist), 'utf8');
} catch {
  console.error('Bundle budgets: dist/index.html is missing; run the build first.');
  process.exit(1);
}

const entryNames = new Set([...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/g)].map((match) => match[1].split('/').pop()));
const assets = filesUnder(distPath).filter((path) => /\.(?:js|css)$/.test(path)).map((path) => {
  const content = readFileSync(path);
  return {
    name: relative(distPath, path).replaceAll('\\', '/'),
    raw: statSync(path).size,
    gzip: gzipSync(content).length,
    type: path.endsWith('.css') ? 'css' : entryNames.has(path.split(/[\\/]/).pop()) ? 'entry' : 'chunk',
  };
});

const failures = [];
for (const asset of assets) {
  const budget = limits[asset.type];
  if (asset.raw > budget.raw || asset.gzip > budget.gzip) {
    failures.push(`${asset.name} (${asset.type}): ${format(asset.raw)} raw / ${format(asset.gzip)} gzip; budget ${format(budget.raw)} / ${format(budget.gzip)}`);
  }
}

const js = assets.filter((asset) => asset.type !== 'css');
const totalJs = js.reduce((total, asset) => ({ raw: total.raw + asset.raw, gzip: total.gzip + asset.gzip }), { raw: 0, gzip: 0 });
if (totalJs.raw > limits.totalJs.raw || totalJs.gzip > limits.totalJs.gzip) {
  failures.push(`total JS: ${format(totalJs.raw)} raw / ${format(totalJs.gzip)} gzip; budget ${format(limits.totalJs.raw)} / ${format(limits.totalJs.gzip)}`);
}

console.log('Bundle budgets (raw / gzip):');
for (const asset of assets.sort((a, b) => b.raw - a.raw)) {
  console.log(`  ${asset.type.padEnd(5)} ${asset.name}: ${format(asset.raw)} / ${format(asset.gzip)}`);
}
console.log(`  total JS: ${format(totalJs.raw)} / ${format(totalJs.gzip)}`);

if (failures.length) {
  console.error('\nClear bundle budget regression:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}
