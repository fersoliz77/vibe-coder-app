/*
 * Generador de la capa de tokens.
 *
 * Antes habia dos tokens.css mantenidos a mano, uno por producto, y un gate que
 * comparaba sus bytes. Eso detectaba que se hubieran separado, pero no impedia
 * que se separaran, y no podia ver el error mas facil de cometer: cambiar un
 * hex y olvidarse de su componente RGB, que se declaraba al lado a mano.
 *
 * Aca los `-rgb` se derivan del mismo hex, asi que ya no pueden discrepar.
 *
 * Escribe en los dos productos cuando estan uno al lado del otro, y solo en el
 * propio cuando esta solo -que es el caso de CI-.
 *
 * Uso:
 *   node design-tokens/build.mjs           genera
 *   node design-tokens/build.mjs --check   falla si lo generado no coincide
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRoot = fileURLToPath(new URL('../', import.meta.url));
const SIBLINGS = ['../../vibe coder app/', '../../vibe coder web/'];
const TOKEN_FILES = ['src/tokens.css', 'src/styles/tokens.css'];

const check = process.argv.includes('--check');

/** Descarta las claves de documentacion: `$comment` no es un token. */
const entries = (group) => Object.entries(group ?? {}).filter(([key]) => !key.startsWith('$'));

function toRgbTriplet(hex) {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`no es un hex valido: ${hex}`);
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)).join(', ');
}

function declarations(pairs, indent = '  ') {
  return pairs.map(([name, value]) => `${indent}--vc-${name}: ${value};`).join('\n');
}

/*
 * `transition: all` anima tambien el layout: provoca saltos y no se puede
 * razonar sobre que se movio. Estas listas explicitas son su reemplazo, y se
 * arman de la escala de duracion para que no se desincronicen.
 */
function transitionList(name, duration, properties) {
  const lines = properties.map((property) => `    ${property} var(--vc-${duration}) var(--vc-ease)`);
  return `  --vc-transition-${name}:\n${lines.join(',\n')};`;
}

/** Bloque de un tema, con sus `-rgb` derivados. */
function themeBlock(theme, rgbFrom) {
  const values = Object.fromEntries(entries(theme));
  const rgb = entries(rgbFrom).map(([token, from]) => {
    const source = values[from];
    if (!source) throw new Error(`rgbFrom apunta a "${from}", que el tema no define`);
    return [token, toRgbTriplet(source)];
  });
  // `ink-source` existe solo para derivar --vc-ink-rgb; no se emite como token.
  const visible = entries(theme).filter(([name]) => name !== 'ink-source');
  return [declarations(visible), declarations(rgb)].join('\n\n');
}

const contract = JSON.parse(await readFile(new URL('tokens.json', import.meta.url), 'utf8'));

/*
 * El hash cubre el contrato, no el archivo: reordenar comentarios no deberia
 * contar como un cambio de contrato, pero cambiar un color si.
 */
function contractHash(source) {
  const meaningful = JSON.stringify(source, (key, value) => (key.startsWith('$') ? undefined : value));
  return createHash('sha256').update(meaningful).digest('hex').slice(0, 12);
}

const hash = contractHash(contract);
const { typography, space, radius, motion, focus, themes, rgbFrom, aliases, transitionProperties, themeSelectors } = contract;

const shared = [
  '  /* ─── Tipografia ──────────────────────────────────────────────────*/',
  declarations(entries(typography)),
  '',
  '  /* ─── Espaciado: escala base 4 ────────────────────────────────────*/',
  declarations(entries(space)),
  '',
  '  /* ─── Radios ──────────────────────────────────────────────────────*/',
  declarations(entries(radius)),
  '',
  '  /* ─── Movimiento ──────────────────────────────────────────────────*/',
  declarations(entries(motion)),
  transitionList('fast', 'duration-fast', transitionProperties),
  transitionList('normal', 'duration-normal', transitionProperties),
  '',
  '  /* ─── Foco ────────────────────────────────────────────────────────*/',
  declarations(entries(focus)),
].join('\n');

const css = `/* ═══════════════════════════════════════════════════════════════════
   Vibe IDE Code — Capa canonica de tokens (compartida web + escritorio)

   ARCHIVO GENERADO. No editar a mano: se regenera y se pierde el cambio.
   Fuente:  design-tokens/tokens.json
   Generar: npm run tokens
   Contrato: v${contract.version} (${hash})

   Regla: aca solo viven tokens canonicos --vc-*. Cada producto mapea sus
   nombres historicos sobre esta capa, de modo que ningun componente
   necesita cambiar para adoptar el sistema.
   ═══════════════════════════════════════════════════════════════════ */

:root {
${shared}

  /* ─── Tema oscuro (por defecto) ───────────────────────────────────*/
${themeBlock(themes.dark, rgbFrom)}

${declarations(entries(aliases).map(([name, target]) => [name, `var(--vc-${target})`]))}
}

/* ═══════════════════════════════════════════════════════════════════
   Tema claro. Se soportan los tres selectores en uso: la web escribe
   \`body.light-mode\`, el escritorio \`.light-theme\`, y theme-boot marca
   \`[data-theme]\` sobre <html> antes del primer pintado.
   ═══════════════════════════════════════════════════════════════════ */
${themeSelectors.join(',\n')} {
${themeBlock(themes.light, rgbFrom)}
}

/* ═══════════════════════════════════════════════════════════════════
   Base compartida
   ═══════════════════════════════════════════════════════════════════ */

/* Foco visible y consistente en todo control alcanzable por teclado.
   Se aplica solo con :focus-visible, asi el mouse no lo dispara. */
:focus-visible {
  outline: var(--vc-focus-ring);
  outline-offset: var(--vc-focus-offset);
  border-radius: var(--vc-radius-xs);
}

/* Contenido solo para lectores de pantalla: fuera de la vista, pero dentro
   del arbol de accesibilidad. No usa \`display:none\` ni \`visibility:hidden\`,
   que lo sacarian tambien del anuncio. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  white-space: nowrap;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
}

::selection {
  background: var(--vc-accent-soft);
  color: var(--vc-text-1);
}

/* Reduced motion es obligatorio: se neutraliza toda animacion
   decorativa sin desactivar cambios de estado. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

/** Productos presentes: el propio, y el hermano si esta al lado. */
const roots = [ownRoot];
for (const candidate of SIBLINGS) {
  const root = fileURLToPath(new URL(candidate, import.meta.url));
  if (resolve(root) !== resolve(ownRoot) && existsSync(root)) roots.push(root);
}

const targets = roots
  .map((root) => TOKEN_FILES.map((file) => join(root, file)).find((path) => existsSync(path)))
  .filter(Boolean);

if (targets.length === 0) {
  console.error('Tokens: no se encontro ningun tokens.css donde escribir.');
  process.exit(1);
}

/*
 * La comparacion ignora el tipo de salto de linea. Git convierte a CRLF al
 * clonar en Windows y el generador escribe LF, asi que comparar bytes hacia
 * fallar el gate en el runner de Windows y pasar en el de Linux, sin que
 * hubiera ninguna diferencia real de contenido.
 */
const sameContent = (a, b) => a !== null && a.replaceAll('\r\n', '\n') === b.replaceAll('\r\n', '\n');

const stale = [];
for (const target of targets) {
  const current = await readFile(target, 'utf8').catch(() => null);
  if (sameContent(current, css)) continue;
  if (check) stale.push(target);
  else await writeFile(target, css, 'utf8');
}

if (check) {
  if (stale.length) {
    console.error(`Tokens: ${stale.length} archivo(s) generados no coinciden con design-tokens/tokens.json:`);
    stale.forEach((path) => console.error(`  - ${path}`));
    console.error('\nSe editaron a mano o quedaron viejos. Corre `npm run tokens` y commitea el resultado.');
    process.exit(1);
  }
  console.log(`Tokens en sincronia (contrato v${contract.version} ${hash}, ${targets.length} producto(s)).`);
} else {
  console.log(`Tokens generados (contrato v${contract.version} ${hash}):`);
  targets.forEach((path) => console.log(`  ${path}`));
}
