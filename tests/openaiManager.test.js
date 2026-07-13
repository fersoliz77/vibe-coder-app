const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildOpenCodeAuthCommand } = require('../electron/services/openaiManager');

test('OpenCode authentication calls the CLI directly and preserves the executable path', () => {
  const executable = path.resolve('C:/Program Files/OpenCode/opencode.cmd');
  assert.equal(
    buildOpenCodeAuthCommand(executable, 'login'),
    `call "${executable}" auth login & exit`,
  );
});

test('OpenCode authentication rejects unsupported actions', () => {
  assert.throws(() => buildOpenCodeAuthCommand(path.resolve('opencode.cmd'), 'remove'), /Unsupported/);
});
