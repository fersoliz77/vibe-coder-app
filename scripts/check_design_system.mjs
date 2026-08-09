/*
 * Guardas del sistema visual (Workshop Precision).
 *
 * Las decisiones de la auditoria son faciles de tomar y faciles de perder: una
 * plantilla copiada de internet vuelve a traer `transition: all` y un glow de
 * 30px sobre el acento, y nadie lo nota hasta que el producto vuelve a parecer
 * otra plantilla de IA.
 *
 * Esto no reemplaza mirar la pantalla. Verifica las reglas que si se pueden
 * comprobar leyendo el CSS: que la capa de tokens sea la misma en los dos
 * productos, que no vuelva `transition: all`, que el blur quede en overlays y
 * que no haya halos de color permanentes.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Este archivo es identico en los dos repositorios, asi que no puede saber en
 * cual esta corriendo: descubre su propia raiz y busca al producto hermano al
 * lado. En CI solo hay uno de los dos y se verifica ese; en local estan los
 * dos y ademas se compara la capa de tokens.
 */
const ownRoot = fileURLToPath(new URL('../', import.meta.url));
const SIBLINGS = ['../../vibe coder app/', '../../vibe coder web/'];
const TOKEN_FILES = ['src/tokens.css', 'src/styles/tokens.css'];

function tokenFileIn(root) {
  return TOKEN_FILES.map((candidate) => join(root, candidate)).find((path) => existsSync(path)) ?? null;
}

async function cssFilesUnder(directory) {
  const found = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.css')) found.push(path);
    }
  }
  await walk(directory);
  return found;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

let siblingRoot = null;
for (const candidate of SIBLINGS) {
  const path = fileURLToPath(new URL(candidate, import.meta.url));
  if (resolve(path) !== resolve(ownRoot) && await exists(path)) siblingRoot = path;
}
const roots = siblingRoot ? [ownRoot, siblingRoot] : [ownRoot];
if (!siblingRoot) {
  console.warn('Design system: el producto hermano no esta al lado; se verifica solo este.');
}

const files = (await Promise.all(roots.map((root) => cssFilesUnder(join(root, 'src'))))).flat();
assert.ok(files.length > 0, 'no se encontro ningun CSS para verificar');

const sources = await Promise.all(files.map(async (path) => ({
  path,
  label: relative(siblingRoot && path.startsWith(siblingRoot) ? siblingRoot : ownRoot, path).replaceAll('\\', '/'),
  css: await readFile(path, 'utf8'),
})));

const failures = [];
const report = (label, line, message) => failures.push(`${label}:${line} ${message}`);

for (const { label, css } of sources) {
  css.split('\n').forEach((text, index) => {
    const line = index + 1;
    const code = text.split('/*')[0];

    // `transition: all` anima tambien el layout: provoca saltos y no se puede
    // razonar sobre que se movio. La capa de tokens trae listas explicitas.
    if (/transition:\s*all\b/.test(code)) {
      report(label, line, 'usa `transition: all`; usa --vc-transition-fast o una lista explicita de propiedades');
    }

    // Los tokens canonicos se definen exclusivamente en tokens.css. Una
    // redefinicion dentro de un componente aisla esa superficie del tema.
    if (label !== 'src/tokens.css'
      && label !== 'src/styles/tokens.css'
      && /--vc-(?:surface|text|line|accent|success|warning|danger)[\w-]*\s*:/.test(code)) {
      report(label, line, 'redefine un token canonico fuera de tokens.css y rompe la propagacion del tema');
    }

    // Blur solo en overlays: un panel esmerilado sobre contenido es el vidrio
    // que la auditoria manda retirar.
    if (/backdrop-filter:\s*blur/.test(code) && !/(overlay|backdrop|modal|layer|dialog|gate)/i.test(code)) {
      const selectorContext = css.slice(0, css.indexOf(text));
      const selector = selectorContext.split('}').pop() ?? '';
      if (!/(overlay|backdrop|modal|layer|dialog|gate|topbar|navbar)/i.test(selector)) {
        report(label, line, 'aplica blur fuera de un overlay');
      }
    }

    // Halo de color permanente: sombra ancha teñida con el acento. Los anillos
    // de foco y seleccion (`0 0 0 Npx`) son legitimos y no entran aca.
    const glow = code.match(/box-shadow:\s*[^;]*rgba\(var\(--vc-(?:accent|success|warning|danger)-rgb\)[^;]*/);
    if (glow && !/box-shadow:\s*(inset\s+)?0\s+0\s+0\s/.test(code)) {
      report(label, line, 'usa un glow de color; la elevacion va con --vc-shadow-*');
    }
  });
}

/*
 * Con el hermano al lado se comprueban las dos cosas que solo se pueden ver
 * teniendo los dos arboles. En CI cada repositorio esta solo, asi que esto se
 * salta: es la verificacion que hace el desarrollador, y la que la Fase 1
 * vuelve innecesaria al generar ambos desde una fuente unica.
 */
/*
 * Las comparaciones entre productos ignoran el tipo de salto de linea: si un
 * repositorio se clono con CRLF y el otro con LF, la diferencia no es de
 * contenido y no deberia fallar el gate.
 */
const sameText = (a, b) => a.replaceAll('\r\n', '\n') === b.replaceAll('\r\n', '\n');

if (siblingRoot) {
  // 1. La capa de tokens tiene que ser literalmente la misma en los dos
  //    productos: si se bifurca, la paridad visual se pierde sin que se note.
  const ownTokens = tokenFileIn(ownRoot);
  const siblingTokens = tokenFileIn(siblingRoot);
  if (!ownTokens || !siblingTokens) {
    failures.push('no se encontro la capa de tokens en alguno de los dos productos');
  } else {
    const [a, b] = await Promise.all([readFile(ownTokens, 'utf8'), readFile(siblingTokens, 'utf8')]);
    if (!sameText(a, b)) failures.push('la capa de tokens difiere entre los dos productos; debe ser identica');
  }

  // 2. Los gates estan duplicados en los dos repositorios porque cada CI clona
  //    solo el suyo. Duplicado y sin vigilar, se bifurca: esto lo detecta.
  const MIRRORED = [
    'scripts/check_design_system.mjs',
    'scripts/check_contrast.mjs',
    'scripts/check_token_refs.mjs',
    'scripts/check_static_a11y.mjs',
    'scripts/check_bundle_budgets.mjs',
    'scripts/check_font_loading.mjs',
    // La fuente del contrato tambien: si se bifurca, los dos productos generan
    // capas distintas y la paridad se pierde en el origen, no en la copia.
    'design-tokens/tokens.json',
    'design-tokens/build.mjs',
    'public/theme-boot.js',
  ];
  for (const name of MIRRORED) {
    const here = join(ownRoot, name);
    const there = join(siblingRoot, name);
    if (!existsSync(there)) {
      failures.push(`${name} falta en el producto hermano; debe existir en los dos`);
      continue;
    }
    const [a, b] = await Promise.all([readFile(here, 'utf8'), readFile(there, 'utf8')]);
    if (!sameText(a, b)) failures.push(`${name} difiere entre los dos productos; debe ser identico`);
  }
}

if (failures.length) {
  console.error('Design system: reglas de Workshop Precision incumplidas');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(`Design system checks passed (${sources.length} CSS files; tokens, theme propagation, transitions, blur and glow).`);
