const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
 * Cableado del teclado del explorador.
 *
 * `treeKeyboard` y `menuKeyboard` ya tienen pruebas propias y las dos pasaban
 * mientras el menu contextual era inalcanzable con teclado: probaban funciones
 * puras que nadie llamaba con las teclas correctas.
 *
 * Faltaba esto. No verifica que las funciones decidan bien, sino que el
 * componente las consulte, y en el orden correcto. Es analisis estatico del
 * fuente porque el repositorio no monta DOM en pruebas; alcanza para los dos
 * defectos reales que hubo:
 *
 *  1. `focusRow(index)` leia un `event` que no era parametro suyo. En Chromium
 *     resolvia al global `window.event`, asi que no fallaba: quedaba latente.
 *  2. `treeAction` devuelve null para Menu y Shift+F10, de modo que preguntarle
 *     primero descartaba la tecla y el menu nunca se abria.
 */

const COMPONENT = path.join(__dirname, '..', 'src', 'features', 'explorer', 'ExplorerTree.jsx');
const source = fs.readFileSync(COMPONENT, 'utf8');

/** Cuerpo de un `const nombre = useCallback(...)`, balanceando parentesis. */
function callbackBody(code, name) {
  const start = code.indexOf(`const ${name} = useCallback(`);
  assert.notEqual(start, -1, `no se encontro el callback ${name}`);
  let depth = 0;
  for (let i = code.indexOf('(', start); i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  assert.fail(`el callback ${name} no cierra`);
}

test('focusRow no lee ningun event: solo recibe un indice', () => {
  const body = callbackBody(source, 'focusRow');
  assert.match(body, /useCallback\(\(index\)/, 'focusRow debe recibir solo el indice');
  assert.doesNotMatch(
    body,
    /\bevent\b/,
    'focusRow referencia `event`, que no es parametro suyo: resolveria al global window.event',
  );
});

test('el manejador consulta el menu antes que el arbol', () => {
  const body = callbackBody(source, 'handleTreeKeyDown');
  const menu = body.indexOf('opensMenu(');
  const tree = body.indexOf('treeAction(');
  assert.notEqual(menu, -1, 'el manejador no consulta opensMenu: el menu queda inalcanzable');
  assert.notEqual(tree, -1, 'el manejador no consulta treeAction');
  assert.ok(
    menu < tree,
    'opensMenu debe consultarse antes que treeAction: treeAction devuelve null para Menu y Shift+F10, y el manejador descartaria la tecla',
  );
});

test('el manejador le pasa a opensMenu la tecla y el modificador del evento', () => {
  const body = callbackBody(source, 'handleTreeKeyDown');
  const call = body.match(/opensMenu\(([^)]*)\)/);
  assert.ok(call, 'no se pudo leer la llamada a opensMenu');
  assert.match(call[1], /key:\s*event\.key/, 'opensMenu necesita la tecla del evento');
  assert.match(call[1], /shiftKey:\s*event\.shiftKey/, 'sin shiftKey, Shift+F10 no se distingue de F10');
});

test('abrir el menu con teclado avisa al contenedor con la fila enfocada', () => {
  const body = callbackBody(source, 'openContextMenuForRow');
  assert.match(body, /onContextMenuKey\?\.\(/, 'openContextMenuForRow no llama a onContextMenuKey');
  assert.match(body, /getBoundingClientRect\(\)/, 'el menu debe posicionarse sobre la fila, no donde estuvo el mouse');
  assert.match(body, /isRoot:\s*row\.dataset\.nodeRoot/, 'el nodo debe informar si es la raiz');

  const handler = callbackBody(source, 'handleTreeKeyDown');
  assert.match(handler, /openContextMenuForRow\(row\)/, 'el manejador nunca abre el menu');
});

test('el menu por teclado consume la tecla', () => {
  const body = callbackBody(source, 'handleTreeKeyDown');
  const branch = body.slice(body.indexOf('opensMenu('));
  const close = branch.indexOf('return;');
  assert.match(
    branch.slice(0, close),
    /event\.preventDefault\(\)/,
    'sin preventDefault, Shift+F10 tambien dispara el menu nativo',
  );
});

test('opensMenu se importa donde se usa', () => {
  assert.match(source, /import \{ opensMenu \} from '\.\/menuKeyboard'/);
});
