/*
 * Tokens referenciados que no existen.
 *
 * Una variable CSS que no esta definida no rompe nada: el navegador descarta
 * la declaracion entera y sigue. El resultado es una caja sin padding o un
 * texto sin color que nadie relaciona con un typo, porque no hay error en
 * ninguna consola.
 *
 * Asi convivieron veinte declaraciones rotas con los dos gates visuales en
 * verde. Este archivo existe para que eso no vuelva a pasar en silencio.
 *
 * Se verifica por producto, no sobre la union: un token que solo define la web
 * no esta disponible en el escritorio, y contarlo como definido esconderia
 * exactamente la clase de error que buscamos.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Identico en los dos repositorios: descubre su propia raiz y busca al producto
 * hermano al lado. En CI hay uno solo y se verifica ese.
 */
const ownRoot = fileURLToPath(new URL('../', import.meta.url));
const SIBLINGS = ['../../vibe coder app/', '../../vibe coder web/'];

/*
 * Excepciones: tokens que se consumen sin definirse en el arbol y aun asi son
 * correctos. Cada entrada lleva motivo; una excepcion sin motivo es deuda
 * disfrazada. Hoy no hay ninguna, y la lista vacia es la respuesta correcta.
 */
const ALLOWED = new Map([
  // ['--ejemplo', 'lo inyecta el host en runtime'],
]);

const SOURCE_EXTENSIONS = ['.css', '.js', '.jsx'];

async function sourcesUnder(directory) {
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
      else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(path);
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

/*
 * Un token queda definido de tres formas, y las tres cuentan. Mirar solo el CSS
 * daria falsos positivos sobre los que el producto inyecta desde React.
 */
function collectDefinitions(source) {
  // Tampoco define nada lo que este comentado: contarlo taparia un token que
  // en realidad falta, que es justo lo que este archivo busca.
  const code = stripBlockComments(source);
  const names = new Set();
  // 1. Declaracion CSS: `--nombre: valor;`
  for (const [, name] of code.matchAll(/(--[\w-]+)\s*:/g)) names.add(name);
  // 2. Objeto de estilo en JSX: `{ '--nombre': valor }`
  for (const [, name] of code.matchAll(/['"](--[\w-]+)['"]\s*:/g)) names.add(name);
  // 3. Imperativo: `element.style.setProperty('--nombre', valor)`
  for (const [, name] of code.matchAll(/setProperty\(\s*['"`](--[\w-]+)['"`]/g)) names.add(name);
  return names;
}

/*
 * Un `var()` dentro de un comentario no es un consumo: no lo resuelve nadie.
 * Se blanquea el contenido conservando los saltos de linea, para que los
 * numeros de linea que se reportan sigan siendo los del archivo.
 */
function stripBlockComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, ' '));
}

/*
 * Solo interesan los consumos sin respaldo. `var(--x, 8px)` puede apuntar a un
 * token inexistente sin consecuencia visible: el fallback es la definicion.
 */
function collectUsages(code) {
  const usages = [];
  stripBlockComments(code).split('\n').forEach((text, index) => {
    for (const match of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
      if (match[2] === ',') continue;
      usages.push({ name: match[1], line: index + 1 });
    }
  });
  return usages;
}

async function auditProduct(label, root) {
  const files = await sourcesUnder(join(root, 'src'));
  const sources = await Promise.all(files.map(async (path) => ({
    label: `${label}/${relative(join(root, 'src'), path).replaceAll('\\', '/')}`,
    code: await readFile(path, 'utf8'),
  })));

  const defined = new Set();
  for (const { code } of sources) {
    for (const name of collectDefinitions(code)) defined.add(name);
  }

  const missing = [];
  let inspected = 0;
  for (const { label: fileLabel, code } of sources) {
    for (const { name, line } of collectUsages(code)) {
      inspected += 1;
      if (defined.has(name) || ALLOWED.has(name)) continue;
      missing.push({ token: name, file: fileLabel, line });
    }
  }

  return { label, files: sources.length, defined: defined.size, inspected, missing };
}

const products = [{ label: basename(ownRoot.replace(/[\\/]$/, '')), root: ownRoot }];
for (const candidate of SIBLINGS) {
  const root = fileURLToPath(new URL(candidate, import.meta.url));
  if (resolve(root) === resolve(ownRoot) || !(await exists(root))) continue;
  products.push({ label: basename(root.replace(/[\\/]$/, '')), root });
}
if (products.length === 1) console.warn('Token refs: el producto hermano no esta al lado; se verifica solo este.');

const reports = await Promise.all(products.map(({ label, root }) => auditProduct(label, root)));
const missing = reports.flatMap((report) => report.missing);

for (const report of reports) {
  console.log(`${report.label}: ${report.files} archivos, ${report.defined} tokens definidos, ${report.inspected} consumos sin fallback.`);
}

if (missing.length) {
  // Agrupado por token: veinte hallazgos sobre cinco tokens son cinco typos,
  // no veinte problemas, y conviene que el mensaje lo diga.
  const byToken = new Map();
  for (const entry of missing) {
    if (!byToken.has(entry.token)) byToken.set(entry.token, []);
    byToken.get(entry.token).push(entry);
  }

  console.error(`\nTokens referenciados que no existen (${missing.length} en ${byToken.size} tokens):`);
  for (const [token, entries] of [...byToken].sort((a, b) => b[1].length - a[1].length)) {
    console.error(`\n  ${token}  (${entries.length})`);
    for (const entry of entries) console.error(`    ${entry.file}:${entry.line}`);
  }
  console.error('\nDefini el token o corregi la referencia. Si el consumo es legitimo, agregalo a ALLOWED con su motivo.');
  process.exit(1);
}

console.log(`\nToken reference checks passed (${reports.reduce((total, report) => total + report.inspected, 0)} consumos, 0 sin definicion).`);
