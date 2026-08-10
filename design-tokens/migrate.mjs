/*
 * Migra una familia de pantallas del nombre heredado al canonico.
 *
 * El diccionario existia como documentacion y eso ya era util para planificar,
 * pero una migracion hecha a mano sobre 1200 usos se equivoca en algun lado y
 * el error aparece semanas despues en una pantalla que nadie miraba. Aca el
 * mapa se ejecuta: la misma fuente que se reviso es la que aplica el cambio.
 *
 * Se migra por familia, no todo junto, porque cada archivo hay que mirarlo en
 * pantalla despues. El plan lo dice y la herramienta lo respeta: recibe rutas,
 * no un comodin sobre el proyecto entero.
 *
 * Uso:
 *   node design-tokens/migrate.mjs src/features/auth/AuthGate.css
 *   node design-tokens/migrate.mjs --dry src/features/auth/*.css
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRoot = fileURLToPath(new URL('../', import.meta.url));
const dry = process.argv.includes('--dry');
const files = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

if (files.length === 0) {
  console.error('Uso: node design-tokens/migrate.mjs [--dry] <archivo.css> [...]');
  console.error('Migra una familia por vez. No acepta comodines sobre todo el proyecto.');
  process.exit(1);
}

const contractDir = new URL('./', import.meta.url);
const map = JSON.parse(await readFile(new URL('legacy-map.json', contractDir), 'utf8'));
const exceptions = JSON.parse(await readFile(new URL('exceptions.json', contractDir), 'utf8'));

/* Que producto es este, para elegir la mitad correcta del diccionario. */
const product = existsSync(join(ownRoot, 'src/styles/tokens.css')) ? 'app' : 'web';

/*
 * Solo se traduce lo que es un token unico. Algunas entradas del mapa
 * describen una composicion -`--timing-fast` vale duracion MAS easing- y no un
 * reemplazo: sustituirlas mecanicamente escribiria `var(--vc-a + --vc-b)`, que
 * es CSS invalido y que el navegador descarta en silencio, exactamente el tipo
 * de error que este sistema existe para evitar.
 */
const SINGLE_TOKEN = /^--vc-[\w-]+$/;
const composed = [];
const rules = [];
for (const [legacy, target] of Object.entries(map[product] ?? {})) {
  if (SINGLE_TOKEN.test(target)) rules.push([legacy, target]);
  else composed.push(`${legacy} (${target})`);
}

const excepted = new Set();
for (const [group, entries] of Object.entries(exceptions)) {
  if (group.startsWith('$')) continue;
  for (const name of Object.keys(entries)) if (!name.startsWith('$')) excepted.add(name);
}

console.log(`Producto: ${product}. ${rules.length} regla(s) de traduccion, ${excepted.size} excepcion(es) que no se tocan.`);
if (composed.length > 0) {
  console.log(`No se traducen automaticamente (valen una composicion, no un token): ${composed.join(', ')}`);
}
if (dry) console.log('Modo simulacion: no se escribe nada.\n');

let totalChanges = 0;

for (const file of files) {
  const path = resolve(ownRoot, file);
  const before = await readFile(path, 'utf8').catch(() => null);
  if (before === null) {
    console.error(`  ${file}: no se pudo leer`);
    process.exitCode = 1;
    continue;
  }

  let after = before;
  const applied = [];
  for (const [legacy, canonical] of rules) {
    // Solo `var(--nombre)` exacto: no se tocan definiciones ni nombres que
    // empiecen igual. `--radius-sm` no debe alcanzar a `--radius-sm-alt`.
    const pattern = new RegExp(`var\\(\\s*${legacy}\\s*\\)`, 'g');
    const hits = (after.match(pattern) ?? []).length;
    if (hits === 0) continue;
    after = after.replace(pattern, `var(${canonical})`);
    applied.push(`${legacy} -> ${canonical} (${hits})`);
    totalChanges += hits;
  }

  /* Lo que queda sin migrar despues de pasar: o es excepcion, o falta en el mapa. */
  const remaining = new Set();
  // Sin comentarios: un `var()` citado en una explicacion no es un consumo.
  const code = after.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, name] of code.matchAll(/var\(\s*(--[a-z][\w-]*)\s*\)/g)) {
    if (name.startsWith('--vc-') || excepted.has(name)) continue;
    remaining.add(name);
  }

  console.log(`\n${basename(path)}`);
  if (applied.length === 0) console.log('  sin cambios');
  applied.forEach((line) => console.log(`  ${line}`));
  if (remaining.size > 0) {
    console.log(`  QUEDA SIN MIGRAR: ${[...remaining].join(', ')}`);
    console.log('  (no estan en el mapa ni registrados como excepcion)');
  }

  if (!dry && after !== before) await writeFile(path, after, 'utf8');
}

console.log(`\n${totalChanges} referencia(s) ${dry ? 'se migrarian' : 'migradas'}.`);
if (!dry && totalChanges > 0) {
  console.log('Ahora hay que mirar estas pantallas en claro y en oscuro antes de publicar.');
}
