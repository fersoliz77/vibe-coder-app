const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function load() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'explorer', 'treeKeyboard.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

const file = { isDirectory: false, isExpanded: false };
const closedDir = { isDirectory: true, isExpanded: false };
const openDir = { isDirectory: true, isExpanded: true };

test('up and down move between visible rows whatever the node is', async () => {
  const { treeAction } = await load();
  for (const node of [file, closedDir, openDir]) {
    assert.equal(treeAction({ key: 'ArrowDown', ...node }), 'next');
    assert.equal(treeAction({ key: 'ArrowUp', ...node }), 'previous');
  }
});

test('right expands a closed folder and then steps into it', async () => {
  const { treeAction } = await load();
  assert.equal(treeAction({ key: 'ArrowRight', ...closedDir }), 'expand');
  assert.equal(treeAction({ key: 'ArrowRight', ...openDir }), 'enterChild');
});

test('right does nothing on a file or on an empty open folder', async () => {
  const { treeAction } = await load();
  assert.equal(treeAction({ key: 'ArrowRight', ...file }), null);
  assert.equal(treeAction({ key: 'ArrowRight', ...openDir, hasChildren: false }), null);
});

test('left collapses an open folder, otherwise goes up to the parent', async () => {
  const { treeAction } = await load();
  assert.equal(treeAction({ key: 'ArrowLeft', ...openDir }), 'collapse');
  assert.equal(treeAction({ key: 'ArrowLeft', ...closedDir }), 'goToParent');
  assert.equal(treeAction({ key: 'ArrowLeft', ...file }), 'goToParent');
});

test('enter and space activate the row', async () => {
  const { treeAction } = await load();
  assert.equal(treeAction({ key: 'Enter', ...file }), 'activate');
  assert.equal(treeAction({ key: ' ', ...closedDir }), 'activate');
});

test('delete asks to remove the row, but shift+delete is left to the system', async () => {
  const { treeAction } = await load();
  assert.equal(treeAction({ key: 'Delete', ...file }), 'delete');
  assert.equal(treeAction({ key: 'Delete', ...file, shiftKey: true }), null);
});

test('keys the tree does not own are left to the rest of the app', async () => {
  const { treeAction } = await load();
  // F2 (renombrar) y Ctrl+X/C/V los maneja el atajo global del explorador.
  for (const key of ['Tab', 'Escape', 'a', 'F2', 'PageDown', 'Backspace']) {
    assert.equal(treeAction({ key, ...file }), null, `"${key}" no deberia consumirse`);
  }
});

test('movement stops at the ends instead of wrapping around', async () => {
  const { nextIndex } = await load();
  assert.equal(nextIndex('previous', 0, 5), 0);
  assert.equal(nextIndex('next', 4, 5), 4);
  assert.equal(nextIndex('first', 3, 5), 0);
  assert.equal(nextIndex('last', 1, 5), 4);
});

test('movement never lands outside the visible rows', async () => {
  const { nextIndex } = await load();
  for (const action of ['next', 'previous', 'first', 'last', 'enterChild']) {
    for (let count = 1; count <= 4; count += 1) {
      for (let current = 0; current < count; current += 1) {
        const target = nextIndex(action, current, count);
        if (target === null) continue;
        assert.ok(target >= 0 && target < count, `${action} ${current}/${count} -> ${target}`);
      }
    }
  }
  assert.equal(nextIndex('next', 0, 0), null);
});

test('the parent is the closest row above with a smaller depth', async () => {
  const { parentIndex } = await load();
  //  0 src            level 0
  //  1   components   level 1
  //  2     Button.jsx level 2
  //  3   index.js     level 1
  const levels = [0, 1, 2, 1];
  assert.equal(parentIndex(levels, 2), 1);
  assert.equal(parentIndex(levels, 1), 0);
  assert.equal(parentIndex(levels, 3), 0);
});

test('a root row has no parent to go up to', async () => {
  const { parentIndex } = await load();
  assert.equal(parentIndex([0, 1, 0], 0), null);
  assert.equal(parentIndex([0, 1, 0], 2), null);
  assert.equal(parentIndex([], 0), null);
});
