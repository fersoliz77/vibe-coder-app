/*
 * El diccionario de nombres heredados tiene que seguir siendo cierto.
 *
 * Un mapa de migracion escrito una vez y nunca verificado envejece en semanas:
 * alguien agrega un alias, alguien borra otro, y cuando llega el momento de
 * migrar el mapa describe un producto que ya no existe. Entonces no sirve para
 * planificar, que es lo unico para lo que existia.
 *
 * Se verifican tres cosas:
 *
 *  1. Todo nombre heredado que el producto define esta en el mapa o registrado
 *     como excepcion. Uno nuevo sin documentar falla.
 *  2. El mapa no menciona nombres que ya no existen. Entradas muertas mienten
 *     sobre cuanto falta.
 *  3. No aparecen homonimos nuevos: mismo nombre en los dos productos con
 *     valor distinto. Los que ya estaban se declaran en `$open`.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRoot = fileURLToPath(new URL('../', import.meta.url));
const SIBLINGS = ['../../vibe coder app/', '../../vibe coder web/'];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function cssUnder(directory) {
  const found = [];
  async function walk(current) {
    let items;
    try {
      items = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (item.name === 'node_modules' || item.name === 'dist') continue;
      const path = join(current, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.name.endsWith('.css')) found.push(path);
    }
  }
  await walk(directory);
  return found;
}

/** Nombres heredados que define un producto, con su valor. */
async function legacyDefinitions(root) {
  const map = new Map();
  for (const path of await cssUnder(join(root, 'src'))) {
    const css = (await readFile(path, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, name, value] of css.matchAll(/^\s*(--[a-z][\w-]*)\s*:\s*([^;]+);/gm)) {
      if (name.startsWith('--vc-')) continue;
      map.set(name, value.trim());
    }
  }
  return map;
}

const contractDir = new URL('../design-tokens/', import.meta.url);
const map = JSON.parse(await readFile(new URL('legacy-map.json', contractDir), 'utf8'));
const exceptions = JSON.parse(await readFile(new URL('exceptions.json', contractDir), 'utf8'));

/* Todo nombre registrado como excepcion, sin importar la categoria. */
const excepted = new Set();
for (const [group, entries] of Object.entries(exceptions)) {
  if (group.startsWith('$')) continue;
  for (const name of Object.keys(entries)) {
    if (!name.startsWith('$')) excepted.add(name);
  }
}

/* Productos presentes, etiquetados como los espera el mapa. */
const products = [];
for (const root of [ownRoot, ...SIBLINGS.map((s) => fileURLToPath(new URL(s, import.meta.url)))]) {
  if (products.some((p) => resolve(p.root) === resolve(root))) continue;
  if (!(await exists(root))) continue;
  const label = (await exists(join(root, 'src/styles/tokens.css'))) ? 'app' : 'web';
  products.push({ label, root });
}

const failures = [];
const seen = new Map();

for (const { label, root } of products) {
  const declared = map[label] ?? {};
  const definitions = await legacyDefinitions(root);
  seen.set(label, definitions);

  for (const name of definitions.keys()) {
    if (declared[name] || excepted.has(name)) continue;
    failures.push(`${label}: ${name} esta definido pero no figura en legacy-map.json ni en exceptions.json`);
  }

  for (const name of Object.keys(declared)) {
    if (definitions.has(name)) continue;
    failures.push(`${label}: legacy-map.json menciona ${name}, que ya no se define en el producto`);
  }
}

/* Homonimos: mismo nombre en los dos, valor distinto. */
const open = new Set(Object.keys(map.$open ?? {}).filter((key) => !key.startsWith('$')));
if (seen.size === 2) {
  const [a, b] = [...seen.values()];
  for (const [name, value] of a) {
    if (!b.has(name) || b.get(name) === value) continue;
    if (open.has(name)) continue;
    failures.push(`${name} vale distinto en cada producto y no esta declarado en $open del mapa`);
  }
}

const total = [...seen.values()].reduce((sum, definitions) => sum + definitions.size, 0);
console.log(`Legacy tokens: ${total} nombre(s) heredado(s) en ${seen.size} producto(s), ${excepted.size} excepcion(es) registrada(s), ${open.size} homonimo(s) abierto(s).`);

if (failures.length) {
  console.error('\nEl diccionario de nombres heredados quedo desactualizado:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  console.error('\nActualiza design-tokens/legacy-map.json, o registra el valor en exceptions.json con su motivo.');
  process.exit(1);
}

console.log('Legacy token map checks passed (mapa completo, sin entradas muertas, sin homonimos nuevos).');
