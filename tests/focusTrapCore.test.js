const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function load() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'hooks', 'focusTrapCore.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

test('tab in the middle of the dialog is left alone', async () => {
  const { nextFocusIndex } = await load();
  assert.equal(nextFocusIndex(4, 1, false), null);
  assert.equal(nextFocusIndex(4, 2, true), null);
});

test('tab on the last element wraps to the first instead of leaving', async () => {
  const { nextFocusIndex } = await load();
  assert.equal(nextFocusIndex(4, 3, false), 0);
});

test('shift+tab on the first element wraps to the last instead of leaving', async () => {
  const { nextFocusIndex } = await load();
  assert.equal(nextFocusIndex(4, 0, true), 3);
});

test('focus outside the dialog is pulled back in', async () => {
  const { nextFocusIndex } = await load();
  assert.equal(nextFocusIndex(4, -1, false), 0);
  assert.equal(nextFocusIndex(4, -1, true), 3);
});

test('a single focusable element always keeps the focus', async () => {
  const { nextFocusIndex } = await load();
  assert.equal(nextFocusIndex(1, 0, false), 0);
  assert.equal(nextFocusIndex(1, 0, true), 0);
});

test('an empty dialog does not try to move the focus', async () => {
  const { nextFocusIndex } = await load();
  for (const shift of [true, false]) {
    assert.equal(nextFocusIndex(0, -1, shift), null);
    assert.equal(nextFocusIndex(-1, 0, shift), null);
  }
});

test('the focus never escapes: every result stays within range', async () => {
  const { nextFocusIndex } = await load();
  for (let count = 1; count <= 6; count += 1) {
    for (let current = -1; current < count; current += 1) {
      for (const shift of [true, false]) {
        const next = nextFocusIndex(count, current, shift);
        if (next === null) continue;
        assert.ok(next >= 0 && next < count, `count=${count} current=${current} shift=${shift} -> ${next}`);
      }
    }
  }
});

test('the focusable selector skips disabled controls and tabindex -1', async () => {
  const { FOCUSABLE_SELECTOR } = await load();
  assert.ok(FOCUSABLE_SELECTOR.includes(':not([disabled])'));
  assert.ok(FOCUSABLE_SELECTOR.includes('[tabindex]:not([tabindex="-1"])'));
});
