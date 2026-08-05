const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function load() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'tablist.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

test('plain arrows change tab, arrows with ctrl or cmd move it', async () => {
  const { tabAction } = await load();
  assert.equal(tabAction({ key: 'ArrowLeft' }), 'previous');
  assert.equal(tabAction({ key: 'ArrowRight' }), 'next');
  assert.equal(tabAction({ key: 'ArrowLeft', ctrlKey: true }), 'moveLeft');
  assert.equal(tabAction({ key: 'ArrowRight', metaKey: true }), 'moveRight');
});

test('delete closes the tab, but shift+delete is left to the system', async () => {
  const { tabAction } = await load();
  assert.equal(tabAction({ key: 'Delete' }), 'close');
  assert.equal(tabAction({ key: 'Backspace' }), 'close');
  assert.equal(tabAction({ key: 'Delete', shiftKey: true }), null);
});

test('keys the tab bar does not own are left alone', async () => {
  const { tabAction } = await load();
  for (const key of ['Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'a', 'F2']) {
    assert.equal(tabAction({ key }), null, `"${key}" no deberia consumirse`);
  }
});

test('changing tab wraps around, as the pattern expects', async () => {
  const { nextTabIndex } = await load();
  assert.equal(nextTabIndex('previous', 0, 3), 2);
  assert.equal(nextTabIndex('next', 2, 3), 0);
  assert.equal(nextTabIndex('first', 2, 3), 0);
  assert.equal(nextTabIndex('last', 0, 3), 2);
});

test('a single tab always stays selected', async () => {
  const { nextTabIndex } = await load();
  for (const action of ['previous', 'next', 'first', 'last']) {
    assert.equal(nextTabIndex(action, 0, 1), 0);
  }
});

test('changing tab never lands outside the bar', async () => {
  const { nextTabIndex } = await load();
  for (const action of ['previous', 'next', 'first', 'last']) {
    for (let count = 1; count <= 5; count += 1) {
      for (let current = 0; current < count; current += 1) {
        const target = nextTabIndex(action, current, count);
        assert.ok(target >= 0 && target < count, `${action} ${current}/${count} -> ${target}`);
      }
    }
  }
  assert.equal(nextTabIndex('next', 0, 0), null);
});

test('moving a tab swaps it with its neighbour and follows it', async () => {
  const { moveTab } = await load();
  const result = moveTab(['a', 'b', 'c'], 1, 1);
  assert.deepEqual(result.items, ['a', 'c', 'b']);
  assert.equal(result.index, 2);
});

test('moving stops at the edges instead of jumping across the bar', async () => {
  const { moveTab } = await load();
  const left = moveTab(['a', 'b', 'c'], 0, -1);
  assert.deepEqual(left.items, ['a', 'b', 'c']);
  assert.equal(left.index, 0);

  const right = moveTab(['a', 'b', 'c'], 2, 1);
  assert.deepEqual(right.items, ['a', 'b', 'c']);
  assert.equal(right.index, 2);
});

test('moving never loses or duplicates a tab', async () => {
  const { moveTab } = await load();
  const original = ['a', 'b', 'c', 'd'];
  for (let from = 0; from < original.length; from += 1) {
    for (const direction of [-1, 1]) {
      const { items } = moveTab(original, from, direction);
      assert.equal(items.length, original.length);
      assert.deepEqual([...items].sort(), [...original].sort());
    }
  }
});

test('an out-of-range index leaves the bar untouched', async () => {
  const { moveTab } = await load();
  for (const from of [-1, 9]) {
    const { items } = moveTab(['a', 'b'], from, 1);
    assert.deepEqual(items, ['a', 'b']);
  }
});
