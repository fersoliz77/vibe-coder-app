/*
 * Reemplaza valores escritos a mano por el token de la escala, SOLO cuando
 * coinciden exacto.
 *
 * La migracion de nombres -de --text-primary a --vc-text-1- es mecanica porque
 * cada nombre viejo tiene un equivalente. La de numeros no: `0.95rem` no existe
 * en ninguna escala y decidir si sube o baja cambia como se ve, que no es algo
 * que pueda resolver un script.
 *
 * Asi que este solo toca lo que no admite duda. `padding: 8px` y
 * `var(--vc-space-2)` computan al mismo pixel, entonces el cambio es
 * literalmente invisible y no necesita revision de diseño; solo hay que
 * comprobar que no se rompio la sintaxis, y de eso se encargan los gates.
 *
 * Lo que queda fuera de la escala se informa con su archivo y su frecuencia:
 * es la lista de decisiones que si necesitan a alguien mirando la pantalla.
 *
 * Uso:
 *   node design-tokens/migrate-literals.mjs --dry src/features/auth/AuthGate.css
 *   node design-tokens/migrate-literals.mjs src/features/**\/*.css
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRoot = fileURLToPath(new URL('../', import.meta.url));
const dry = process.argv.includes('--dry');
const files = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

if (files.length === 0) {
  console.error('Uso: node design-tokens/migrate-literals.mjs [--dry] <archivo.css> [...]');
  process.exit(1);
}

const contract = JSON.parse(await readFile(new URL('tokens.json', import.meta.url), 'utf8'));
const entries = (group) => Object.entries(group).filter(([key]) => !key.startsWith('$'));

/** px -> nombre de token, para cada escala que admite reemplazo exacto. */
const scaleFor = (group) => new Map(
  entries(group)
    .filter(([, value]) => /^\d+px$/.test(value))
    .map(([name, value]) => [Number.parseInt(value, 10), name]),
);

const SPACE = scaleFor(contract.space);
const RADIUS = scaleFor(contract.radius);
const FONT = scaleFor(contract.typography);

/* 1rem = 16px. Es el tamaño raiz que usan los dos productos. */
const toPx = (amount, unit) => (unit === 'rem' ? amount * 16 : amount);

/*
 * Una declaracion se saltea entera si trae calc(), var() o un valor negativo.
 * Dentro de calc() el reemplazo es valido pero cambia como se lee la formula, y
 * los negativos no tienen token: en los dos casos conviene que lo mire alguien.
 */
const SKIP = /calc\(|var\(|(^|\s)-\d/;

function convertValue(value, scale) {
  let touched = false;
  const converted = value.replace(/(^|\s)([0-9.]+)(px|rem)(?=$|\s)/g, (match, lead, amount, unit) => {
    const px = toPx(Number.parseFloat(amount), unit);
    const token = scale.get(px);
    if (!token) return match;
    touched = true;
    return `${lead}var(--vc-${token})`;
  });
  return touched ? converted : null;
}

const offScale = new Map();
function noteOffScale(value, file, scaleName) {
  for (const [, amount, unit] of value.matchAll(/([0-9.]+)(px|rem)/g)) {
    if (Number.parseFloat(amount) === 0) continue;
    const key = `${amount}${unit} (${scaleName})`;
    if (!offScale.has(key)) offScale.set(key, { count: 0, files: new Set() });
    const record = offScale.get(key);
    record.count += 1;
    record.files.add(file);
  }
}

const PROPERTIES = [
  [/\b((?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?)\s*:\s*([^;{}]+);/g, SPACE, 'espacio'],
  [/\b(border-radius)\s*:\s*([^;{}]+);/g, RADIUS, 'radio'],
  [/\b(font-size)\s*:\s*([^;{}]+);/g, FONT, 'tipografia'],
];

let total = 0;

for (const file of files) {
  const path = resolve(ownRoot, file);
  const before = await readFile(path, 'utf8').catch(() => null);
  if (before === null) {
    console.error(`  ${file}: no se pudo leer`);
    process.exitCode = 1;
    continue;
  }

  let changes = 0;
  let after = before;
  for (const [pattern, scale, scaleName] of PROPERTIES) {
    after = after.replace(pattern, (declaration, property, value) => {
      if (SKIP.test(value)) return declaration;
      const converted = convertValue(value.trim(), scale);
      if (converted === null) {
        noteOffScale(value, basename(path), scaleName);
        return declaration;
      }
      changes += 1;
      if (/[0-9.]+(px|rem)/.test(converted)) noteOffScale(converted, basename(path), scaleName);
      return `${property}: ${converted};`;
    });
  }

  if (changes > 0) console.log(`  ${basename(path)}: ${changes} declaracion(es)`);
  total += changes;
  if (!dry && after !== before) await writeFile(path, after, 'utf8');
}

console.log(`\n${total} declaracion(es) ${dry ? 'se convertirian' : 'convertidas'} a la escala, sin cambio de valor computado.`);

if (offScale.size > 0) {
  const worst = [...offScale].sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  console.log(`\nFuera de la escala (${offScale.size} valor(es) distintos). Estos si necesitan que alguien mire la pantalla:`);
  for (const [value, record] of worst) {
    console.log(`  ${value.padEnd(22)} ${String(record.count).padStart(3)} uso(s)  ${[...record.files].slice(0, 3).join(', ')}`);
  }
}
