const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
 * Un archivo de texto abre listo para escribir.
 *
 * Antes no: el contenido se pintaba en un `<pre>` estatico y habia que apretar
 * un boton llamado "Editor" para poder tipear. Como solo una pestana podia
 * estar en ese estado, cambiar de archivo y volver te devolvia al `<pre>`, con
 * los cambios sin guardar a la vista pero congelados, y sin ningun cartel que
 * explicara por que el teclado no respondia.
 */

const EXPLORER = path.join(__dirname, '..', 'src', 'features', 'explorer');
const workspace = fs.readFileSync(path.join(EXPLORER, 'ExplorerWorkspace.jsx'), 'utf8');
const fileExplorer = fs.readFileSync(path.join(EXPLORER, 'FileExplorer.jsx'), 'utf8');

test('no editing flag decides whether a file can be typed into', () => {
  for (const [name, source] of [['ExplorerWorkspace.jsx', workspace], ['FileExplorer.jsx', fileExplorer]]) {
    assert.ok(!/editingTabId/.test(source), `${name}: volvio el estado que bloqueaba la escritura`);
  }
});

test('a text tab renders the editor, not a static block', () => {
  // El unico <pre> que queda es el del diff, que si es una vista de lectura.
  const preBlocks = workspace.match(/<pre className="file-explorer__diff-code[^>]*>/g) || [];
  for (const block of preBlocks) {
    assert.match(block, /dangerouslySetInnerHTML/, `un <pre> de texto plano volvio a reemplazar al editor: ${block}`);
  }
});

test('saving is always reachable and disabled only when there is nothing to save', () => {
  const saveButton = workspace.slice(workspace.indexOf('file-explorer__save-btn'));
  assert.match(
    saveButton.slice(0, 400),
    /disabled=\{paneTab\.draftContent === paneTab\.savedContent\}/,
    'el boton Guardar deberia deshabilitarse solo si no hay cambios',
  );
});

test('the editor is prefetched so opening a file does not stall', () => {
  assert.match(workspace, /export function prefetchCodeEditor/, 'falta el prefetch del editor');
  assert.match(fileExplorer, /prefetchCodeEditor\(\)/, 'el explorador no dispara el prefetch');
});

test('the editor stays a separate chunk, so the app still starts light', () => {
  assert.match(workspace, /lazy\(loadCodeEditor\)/, 'el editor debe seguir cargandose aparte');
  assert.match(workspace, /import\('\.\/CodeEditor'\)/, 'el import dinamico es lo que mantiene el chunk separado');
});
