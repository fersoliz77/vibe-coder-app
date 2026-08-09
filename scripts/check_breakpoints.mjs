/*
 * Los cortes de pantalla salen de una escala, no del ojo.
 *
 * Habia doce anchos distintos entre 480px y 980px -900, 860, 820, 768, 760,
 * 720, 721, 700, 640, 620, 620, 480-, elegidos de a uno segun donde se rompia
 * la pantalla que se estaba mirando. Con esa dispersion, dos componentes
 * vecinos cambian de forma en momentos distintos y el layout se siente roto
 * aunque cada regla, por separado, sea razonable.
 *
 * Esto no se puede resolver con tokens: CSS no permite variables dentro de
 * `@media`, asi que la escala vive en design-tokens/tokens.json y se hace
 * cumplir desde aca.
 *
 * Los anchos ya existentes que no estan en la escala se listan como deuda
 * conocida, con su archivo. La lista solo puede achicarse: cualquier ancho
 * nuevo fuera de la escala falla.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRoot = fileURLToPath(new URL('../', import.meta.url));
const SIBLINGS = ['../../vibe coder app/', '../../vibe coder web/'];

/*
 * Deuda heredada: anchos que ya estaban cuando se declaro la escala. Migrarlos
 * es trabajo de la fase de migracion, una familia por vez, porque cada uno hay
 * que mirarlo en pantalla. Subir estos numeros no; bajarlos, si.
 *
 * Es por producto y no un total: en CI cada repositorio esta solo y ve solo lo
 * suyo, asi que un unico numero global daba de menos y fallaba sin motivo.
 */
const GRANDFATHERED = { web: 9, app: 10 };

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

const contract = JSON.parse(await readFile(new URL('../design-tokens/tokens.json', import.meta.url), 'utf8'));
const scale = Object.entries(contract.breakpoints)
  .filter(([key]) => !key.startsWith('$'))
  .map(([name, value]) => [name, Number.parseInt(value, 10)]);
const allowed = new Set(scale.map(([, px]) => px));

const roots = [ownRoot];
for (const candidate of SIBLINGS) {
  const root = fileURLToPath(new URL(candidate, import.meta.url));
  if (resolve(root) !== resolve(ownRoot) && await exists(root)) roots.push(root);
}

const scaleLabel = scale.map(([name, px]) => `${name} ${px}px`).join(', ');
const failures = [];
let queries = 0;

for (const root of roots) {
  const label = (await exists(join(root, 'src/styles/tokens.css'))) ? 'app' : 'web';
  const budget = GRANDFATHERED[label] ?? 0;
  const offenders = [];

  for (const path of await cssUnder(join(root, 'src'))) {
    const css = await readFile(path, 'utf8');
    css.split('\n').forEach((text, index) => {
      for (const [, width] of text.matchAll(/@media[^{]*?\((?:max|min)-width:\s*(\d+)px\)/g)) {
        queries += 1;
        const px = Number.parseInt(width, 10);
        if (allowed.has(px)) continue;
        offenders.push({ px, file: relative(root, path).replaceAll('\\', '/'), line: index + 1 });
      }
    });
  }

  if (offenders.length > budget) {
    const byWidth = new Map();
    for (const entry of offenders) {
      if (!byWidth.has(entry.px)) byWidth.set(entry.px, []);
      byWidth.get(entry.px).push(entry);
    }
    failures.push(`${label}: ${offenders.length} ancho(s) fuera de la escala, y la deuda aceptada es ${budget}.`);
    for (const [px, entries] of [...byWidth].sort((a, b) => b[0] - a[0])) {
      failures.push(`  ${px}px  (${entries.length})`);
      entries.forEach((entry) => failures.push(`    ${entry.file}:${entry.line}`));
    }
    continue;
  }

  const note = offenders.length < budget
    ? ` — bajo de ${budget}; podes ajustar GRANDFATHERED.${''}`
    : '';
  console.log(`  ${label}: ${offenders.length}/${budget} ancho(s) heredado(s) fuera de la escala${note}`);
}

console.log(`Breakpoints: ${queries} consulta(s) revisadas contra la escala [${scaleLabel}].`);

if (failures.length) {
  console.error('\nAnchos de pantalla fuera de la escala declarada:');
  failures.forEach((line) => console.error(line));
  console.error('\nUsa uno de la escala, o subilo a la escala si de verdad hace falta otro corte.');
  process.exit(1);
}

console.log('Breakpoint checks passed (deuda heredada sin aumentar).');
