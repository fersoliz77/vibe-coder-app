const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function load() {
  const file = path.join(__dirname, '..', 'src', 'features', 'explorer', 'menuKeyboard.js');
  const source = fs.readFileSync(file, 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

test('the menu key and shift+f10 open the menu', async () => {
  const { opensMenu } = await load();
  assert.equal(opensMenu({ key: 'ContextMenu' }), true);
  assert.equal(opensMenu({ key: 'F10', shiftKey: true }), true);
});

test('f10 on its own does not open the menu', async () => {
  const { opensMenu } = await load();
  assert.equal(opensMenu({ key: 'F10' }), false);
  assert.equal(opensMenu({ key: 'Enter' }), false);
  assert.equal(opensMenu({ key: 'F10', shiftKey: false }), false);
});

test('escape and tab both close the menu', async () => {
  const { menuAction } = await load();
  assert.equal(menuAction({ key: 'Escape' }), 'close');
  assert.equal(menuAction({ key: 'Tab' }), 'close');
});

test('keys the menu does not own are left alone', async () => {
  const { menuAction } = await load();
  for (const key of ['ArrowLeft', 'ArrowRight', 'a', 'F2', 'Delete']) {
    assert.equal(menuAction({ key }), null, `"${key}" no deberia consumirse`);
  }
});

test('moving skips options that are disabled', async () => {
  const { nextMenuIndex } = await load();
  const enabled = [true, false, false, true];
  assert.equal(nextMenuIndex('next', 0, enabled), 3);
  assert.equal(nextMenuIndex('previous', 3, enabled), 0);
});

test('first and last land on an enabled option, not a dead one', async () => {
  const { nextMenuIndex } = await load();
  const enabled = [false, true, true, false];
  assert.equal(nextMenuIndex('first', -1, enabled), 1);
  assert.equal(nextMenuIndex('last', -1, enabled), 2);
});

test('movement wraps around the menu', async () => {
  const { nextMenuIndex } = await load();
  const enabled = [true, true, true];
  assert.equal(nextMenuIndex('next', 2, enabled), 0);
  assert.equal(nextMenuIndex('previous', 0, enabled), 2);
});

test('a menu with every option disabled moves nowhere instead of hanging', async () => {
  const { nextMenuIndex } = await load();
  for (const action of ['next', 'previous', 'first', 'last']) {
    assert.equal(nextMenuIndex(action, -1, [false, false]), null);
    assert.equal(nextMenuIndex(action, -1, []), null);
  }
});

test('a single enabled option always keeps the focus', async () => {
  const { nextMenuIndex } = await load();
  const enabled = [false, true, false];
  for (const action of ['next', 'previous', 'first', 'last']) {
    assert.equal(nextMenuIndex(action, 1, enabled), 1);
  }
});

test('movement never lands on a disabled option', async () => {
  const { nextMenuIndex } = await load();
  const layouts = [
    [true, false, true, false, true],
    [false, false, true],
    [true, true, false, false],
  ];
  for (const enabled of layouts) {
    for (const action of ['next', 'previous', 'first', 'last']) {
      for (let current = -1; current < enabled.length; current += 1) {
        const target = nextMenuIndex(action, current, enabled);
        if (target === null) continue;
        assert.ok(enabled[target], `${action} desde ${current} cayo en una opcion deshabilitada`);
      }
    }
  }
});
