/*
 * Cada familia declarada tiene que estar realmente disponible.
 *
 * La capa de tokens declaraba una familia editorial con Newsreader que el
 * escritorio nunca descargaba: ahi el token resolvia a Georgia, en silencio.
 * El gate de paridad no podia verlo porque compara los bytes de tokens.css, no
 * que fuentes carga cada producto.
 *
 * Es el mismo error que un token inexistente: el contrato promete algo que en
 * pantalla no existe, y nada falla.
 *
 * Solo se verifica la PRIMERA familia de cada pila. Las que siguen son
 * respaldos deliberados -Georgia, system-ui, monospace- y justamente existen
 * para no tener que descargarse.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRoot = fileURLToPath(new URL('../', import.meta.url));
const SIBLINGS = ['../../vibe coder app/', '../../vibe coder web/'];
const TOKEN_FILES = ['src/tokens.css', 'src/styles/tokens.css'];

/* Familias que provee el sistema operativo o el navegador: no se descargan. */
const SYSTEM_FAMILIES = new Set([
  'system-ui', '-apple-system', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
  'ui-monospace', 'ui-sans-serif', 'ui-serif', 'ui-rounded',
  'segoe ui', 'segoe ui variable', 'georgia', 'times new roman', 'arial', 'helvetica',
  'cascadia code', 'consolas', 'menlo', 'monaco', 'courier new',
]);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function filesUnder(directory, extensions) {
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
      else if (extensions.some((extension) => item.name.endsWith(extension))) found.push(path);
    }
  }
  await walk(directory);
  return found;
}

/** Primera familia de cada `--vc-font-*`, que es la que el producto pretende usar. */
function declaredFamilies(css) {
  const families = new Map();
  for (const [, token, stack] of css.matchAll(/(--vc-font-[\w-]+)\s*:\s*([^;]+);/g)) {
    const first = stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (!first || SYSTEM_FAMILIES.has(first.toLowerCase())) continue;
    families.set(first, token);
  }
  return families;
}

async function auditProduct(label, root) {
  const tokenFile = TOKEN_FILES.map((file) => join(root, file)).find(() => true);
  let css = null;
  for (const candidate of TOKEN_FILES) {
    css = await readFile(join(root, candidate), 'utf8').catch(() => null);
    if (css !== null) break;
  }
  if (css === null) return { label, families: new Map(), missing: [], sources: 0 };

  const families = declaredFamilies(css);

  /*
   * Donde puede cargarse una fuente: un <link> o un @import a un proveedor, o
   * un @font-face propio. Se junta todo el texto y se busca el nombre; no hace
   * falta entender la sintaxis de cada proveedor para saber si esta pedida.
   */
  const html = await filesUnder(root, ['.html']).then((paths) => paths.filter((path) => !path.includes('dist')));
  /*
   * La capa de tokens queda fuera a proposito: es donde se DECLARA la familia,
   * y declarar no es cargar. Incluirla hacia que el gate se satisficiera solo,
   * encontrando el nombre que el mismo puso bajo sospecha.
   */
  const tokenPaths = new Set(TOKEN_FILES.map((file) => resolve(join(root, file))));
  const styles = await filesUnder(join(root, 'src'), ['.css'])
    .then((paths) => paths.filter((path) => !tokenPaths.has(resolve(path))));
  const loaders = [...html, ...styles];
  const declarations = await Promise.all(loaders.map((path) => readFile(path, 'utf8').catch(() => '')));
  const haystack = declarations.join('\n');

  const missing = [];
  for (const [family, token] of families) {
    // Los proveedores escriben los espacios como `+` en la URL.
    const variants = [family, family.replaceAll(' ', '+'), family.replaceAll(' ', '%20')];
    if (variants.some((variant) => haystack.includes(variant))) continue;
    missing.push({ family, token, file: relative(root, tokenFile).replaceAll('\\', '/') });
  }

  return { label, families, missing, sources: loaders.length };
}

const products = [{ label: 'este producto', root: ownRoot }];
for (const candidate of SIBLINGS) {
  const root = fileURLToPath(new URL(candidate, import.meta.url));
  if (resolve(root) === resolve(ownRoot) || !(await exists(root))) continue;
  products.push({ label: 'producto hermano', root });
}

const reports = await Promise.all(products.map(({ label, root }) => auditProduct(label, root)));
const missing = reports.flatMap((report) => report.missing.map((entry) => ({ ...entry, product: report.label })));

for (const report of reports) {
  const names = [...report.families.keys()];
  console.log(`${report.label}: ${names.length} familia(s) declarada(s) [${names.join(', ')}], ${report.sources} archivo(s) revisados.`);
}

if (missing.length) {
  console.error('\nFamilias declaradas que el producto no carga:');
  for (const entry of missing) {
    console.error(`  - ${entry.family} (${entry.token}, ${entry.file}) en ${entry.product}`);
  }
  console.error('\nCargala, o sacala del contrato. Una familia declarada y no cargada cae al respaldo sin avisar.');
  process.exit(1);
}

console.log('\nFont loading checks passed (cada familia declarada esta pedida por su producto).');
