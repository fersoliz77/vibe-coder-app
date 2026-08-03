const test = require('node:test');
const assert = require('node:assert/strict');

test('dirty-tab discard clears dirty state and allows transition', async () => {
  const { resolveDirtyTabTransition } = await import('../src/features/explorer/dirtyTabTransition.mjs');
  let dirty = true;
  const allowed = await resolveDirtyTabTransition('discard', {
    save: async () => false,
    discard: () => { dirty = false; },
  });
  assert.equal(allowed, true);
  assert.equal(dirty, false);
});

test('dirty-tab cancel blocks transition and save failures remain blocked', async () => {
  const { resolveDirtyTabTransition } = await import('../src/features/explorer/dirtyTabTransition.mjs');
  assert.equal(await resolveDirtyTabTransition('cancel', { save: async () => true, discard() {} }), false);
  assert.equal(await resolveDirtyTabTransition('save', { save: async () => false, discard() {} }), false);
});
