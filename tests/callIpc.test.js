const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function load() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'callIpc.js'), 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

test('a resolved call reports success and carries the data through', async () => {
  const { callIpc } = await load();
  assert.deepEqual(await callIpc(async () => ({ id: 7 })), { ok: true, data: { id: 7 }, error: '' });
});

test('a rejected call never escapes as an exception', async () => {
  const { callIpc } = await load();
  const result = await callIpc(async () => { throw new Error('EPIPE: channel closed'); });
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  assert.match(result.error, /EPIPE/);
});

test('the electron wrapper is stripped so the message stays readable', async () => {
  const { normalizeIpcError } = await load();
  assert.equal(
    normalizeIpcError(new Error("Error invoking remote method 'claude:getStatus': Error: spawn ENOENT")),
    'spawn ENOENT',
  );
});

test('a handler answering { success: false } counts as a failure', async () => {
  const { callIpc } = await load();
  const result = await callIpc(async () => ({ success: false, error: 'shell not found' }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'shell not found');
});

test('a missing api does not crash and explains itself', async () => {
  const { callIpc } = await load();
  for (const missing of [undefined, null, 'nope', {}]) {
    const result = await callIpc(missing);
    assert.equal(result.ok, false);
    assert.ok(result.error.length > 0);
  }
});

test('there is always a message to show, never an empty error', async () => {
  const { callIpc, normalizeIpcError } = await load();
  for (const thrown of [null, undefined, '', 0, new Error('')]) {
    assert.ok(normalizeIpcError(thrown).length > 0);
    const result = await callIpc(async () => { throw thrown; });
    assert.equal(result.ok, false);
    assert.ok(result.error.length > 0);
  }
});

test('a call resolving undefined is still a success, not a silent failure', async () => {
  const { callIpc } = await load();
  assert.deepEqual(await callIpc(async () => undefined), { ok: true, data: null, error: '' });
});
