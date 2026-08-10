/*
 * La deuda de valores escritos a mano no puede volver a crecer.
 *
 * Habia casi mil `padding: 12px` y `font-size: 0.95rem` sueltos. Los que
 * coincidian exacto con la escala ya se convirtieron; los que quedan no tienen
 * escalon y son decisiones de diseño, no traducciones.
 *
 * El problema de dejarlos ahi sin mas es que nada distingue los que quedaron de
 * los que se agregan manana. En un mes vuelven a ser mil y el trabajo se
 * deshace solo.
 *
 * Este gate acepta lo que hay como deuda declarada y rechaza cualquier aumento.
 * Es el mismo trato que el de anchos de pantalla: no obliga a arreglar todo hoy,
 * pero impide que empeore.
 *
 * Bajar los numeros es progreso y solo avisa; subirlos falla.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRoot = fileURLToPath(new URL('../', import.meta.url));
const SIBLINGS = ['../../vibe coder app/', '../../vibe coder web/'];

/*
 * Deuda declarada por producto. Son los valores sin escalon en la escala que
 * quedaron despues de convertir todos los que coincidian exacto.
 */
const BUDGET = {
  web: { space: 155, font: 84, radius: 23 },
  app: { space: 131, font: 33, radius: 102 },
};

/* Los archivos generados no cuentan: sus valores vienen del contrato. */
const GENERATED = ['tokens.css', 'components.css'];

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
      else if (item.name.endsWith('.css') && !GENERATED.includes(item.name)) found.push(path);
    }
  }
  await walk(directory);
  return found;
}

const PATTERNS = {
  space: /\b(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?\s*:\s*[^;{}]*?[1-9][0-9.]*(?:px|rem)/g,
  font: /\bfont-size\s*:\s*[0-9.]+(?:px|rem|em)/g,
  radius: /\bborder-radius\s*:\s*[^;{}]*?[1-9][0-9.]*(?:px|rem|%)/g,
};

const roots = [ownRoot];
for (const candidate of SIBLINGS) {
  const root = fileURLToPath(new URL(candidate, import.meta.url));
  if (resolve(root) !== resolve(ownRoot) && await exists(root)) roots.push(root);
}

const failures = [];

for (const root of roots) {
  const label = (await exists(join(root, 'src/styles/tokens.css'))) ? 'app' : 'web';
  const budget = BUDGET[label];
  const counts = { space: 0, font: 0, radius: 0 };
  const worst = new Map();

  for (const path of await cssUnder(join(root, 'src'))) {
    const css = await readFile(path, 'utf8');
    for (const [kind, pattern] of Object.entries(PATTERNS)) {
      const hits = css.match(pattern) ?? [];
      counts[kind] += hits.length;
      if (hits.length === 0) continue;
      const file = relative(root, path).replaceAll('\\', '/');
      worst.set(file, (worst.get(file) ?? 0) + hits.length);
    }
  }

  const parts = Object.entries(counts)
    .map(([kind, count]) => `${kind} ${count}/${budget[kind]}`)
    .join(', ');
  console.log(`  ${label}: ${parts}`);

  for (const [kind, count] of Object.entries(counts)) {
    if (count > budget[kind]) {
      failures.push(`${label}: ${kind} subio a ${count}, y la deuda declarada es ${budget[kind]}.`);
      const top = [...worst].sort((a, b) => b[1] - a[1]).slice(0, 5);
      top.forEach(([file, n]) => failures.push(`    ${file} (${n} literal(es) en total)`));
    } else if (count < budget[kind]) {
      console.log(`    ${kind} bajo de ${budget[kind]} a ${count}: podes ajustar BUDGET.`);
    }
  }
}

if (failures.length) {
  console.error('\nLa deuda de valores escritos a mano aumento:');
  failures.forEach((line) => console.error(line));
  console.error('\nUsa la escala. Si el valor de verdad no tiene escalon, subilo a design-tokens/tokens.json.');
  console.error('Para convertir lo que ya coincide exacto: node design-tokens/migrate-literals.mjs <archivo>');
  process.exit(1);
}

console.log('Literal checks passed (la deuda declarada no aumento).');
