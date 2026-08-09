/*
 * Contraste AA sobre la capa de tokens.
 *
 * El archivo de tokens declaraba los ratios en comentarios ("15.2:1", "6.4:1").
 * Un comentario no falla cuando alguien cambia un hex: dice lo que era verdad
 * el dia que se escribio. Esto los calcula.
 *
 * Se verifica cada combinacion que el producto usa de verdad, en los dos temas.
 * Los umbrales son los de WCAG 2.1: 4.5:1 para texto normal, 3:1 para texto
 * grande y para bordes o iconos que transmiten informacion.
 *
 * El umbral se elige por el uso real, no por la familia del token. Un color de
 * estado que rotula un badge es texto normal aunque se llame "estado": pedirle
 * 3:1 es declararlo accesible sin haberlo comprobado.
 */
import { readFile } from 'node:fs/promises';

const AA_TEXT = 4.5;
const AA_LARGE = 3;

function parseTokens(css, scopePattern) {
  const scope = css.match(scopePattern)?.[0] ?? '';
  const tokens = {};
  for (const [, name, value] of scope.matchAll(/(--vc-[a-z0-9-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

function toRgb(hex) {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
}

/** Luminancia relativa segun WCAG 2.1. */
function luminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/*
 * Las combinaciones que el producto pinta de verdad. No se verifica el producto
 * cartesiano: texto terciario sobre el acento no existe en ninguna pantalla, y
 * exigirlo obligaria a aclarar colores que nadie usa asi.
 */
const PAIRS = [
  ['text-1', 'surface-0', AA_TEXT, 'texto principal sobre el fondo'],
  ['text-1', 'surface-1', AA_TEXT, 'texto principal sobre panel'],
  ['text-1', 'surface-2', AA_TEXT, 'texto principal sobre panel elevado'],
  ['text-2', 'surface-0', AA_TEXT, 'texto secundario sobre el fondo'],
  ['text-2', 'surface-1', AA_TEXT, 'texto secundario sobre panel'],
  ['text-3', 'surface-0', AA_TEXT, 'texto terciario sobre el fondo'],
  ['text-3', 'surface-1', AA_TEXT, 'texto terciario sobre panel'],
  /*
   * Estados y acento: se pintan como texto normal, no como titulo. Estos pares
   * estaban en 3:1 por arrastre del umbral de texto grande, y ese umbral no
   * corresponde a un enlace ni a la etiqueta de un badge.
   */
  ['accent', 'surface-0', AA_TEXT, 'acento sobre el fondo (enlaces y estados)'],
  ['accent', 'surface-1', AA_TEXT, 'acento sobre panel'],
  ['success', 'surface-1', AA_TEXT, 'estado correcto'],
  ['warning', 'surface-1', AA_TEXT, 'estado de aviso'],
  ['danger', 'surface-1', AA_TEXT, 'estado de error'],
  ['success', 'success-soft', AA_TEXT, 'estado correcto sobre su propio fondo'],
  ['warning', 'warning-soft', AA_TEXT, 'aviso sobre su propio fondo'],
  ['danger', 'danger-soft', AA_TEXT, 'error sobre su propio fondo'],
  ['accent', 'accent-soft', AA_TEXT, 'acento sobre su propio fondo'],
  // Texto sobre el estado en solido: botones destructivos, badges rellenos.
  ['on-accent', 'accent', AA_TEXT, 'texto dentro del boton primario'],
  ['on-success', 'success', AA_TEXT, 'texto sobre exito solido'],
  ['on-warning', 'warning', AA_TEXT, 'texto sobre aviso solido'],
  ['on-danger', 'danger', AA_TEXT, 'texto sobre error solido'],
  // Un borde no es texto: 3:1 es el umbral que le corresponde de verdad.
  ['line-strong', 'surface-1', AA_LARGE, 'borde con informacion'],
];

/*
 * Identico en los dos repositorios: la web guarda los tokens en src/tokens.css
 * y el escritorio en src/styles/tokens.css. El archivo es el mismo contenido.
 */
const TOKEN_FILES = ['../src/tokens.css', '../src/styles/tokens.css'];
let css = null;
for (const candidate of TOKEN_FILES) {
  try {
    css = await readFile(new URL(candidate, import.meta.url), 'utf8');
    break;
  } catch {
    /* se prueba el siguiente */
  }
}
if (css === null) {
  console.error(`Contraste: no se encontro la capa de tokens (${TOKEN_FILES.join(' ni ')}).`);
  process.exit(1);
}
const themes = [
  ['oscuro', parseTokens(css, /:root\s*\{[\s\S]*?\}/)],
  ['claro', parseTokens(css, /body\.light-mode[\s\S]*?\{[\s\S]*?\}/)],
];

const failures = [];
const rows = [];

for (const [themeName, tokens] of themes) {
  // El tema claro solo redefine lo que cambia; lo demas se hereda del oscuro.
  const resolved = themeName === 'claro' ? { ...themes[0][1], ...tokens } : tokens;

  for (const [foreground, background, minimum, description] of PAIRS) {
    const fgHex = resolved[`--vc-${foreground}`];
    const bgHex = resolved[`--vc-${background}`];
    const fg = fgHex && toRgb(fgHex);
    const bg = bgHex && toRgb(bgHex);
    if (!fg || !bg) {
      failures.push(`${themeName}: no se pudo leer --vc-${foreground} sobre --vc-${background}`);
      continue;
    }
    const ratio = contrast(fg, bg);
    const ok = ratio >= minimum;
    rows.push(`  ${ok ? 'ok  ' : 'FALLA'} ${themeName.padEnd(7)} ${ratio.toFixed(2).padStart(5)}:1 (min ${minimum})  ${description}`);
    if (!ok) {
      failures.push(`${themeName}: ${description} — ${fgHex} sobre ${bgHex} da ${ratio.toFixed(2)}:1, hace falta ${minimum}:1`);
    }
  }
}

console.log('Contraste WCAG AA (calculado, no declarado):');
rows.forEach((row) => console.log(row));

if (failures.length) {
  console.error('\nContraste insuficiente:');
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}

console.log(`\nContrast checks passed (${rows.length} combinaciones en 2 temas).`);
