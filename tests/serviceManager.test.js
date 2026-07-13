const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runCommand } = require('../electron/services/serviceManager');

test('runCommand passes metacharacters as literal arguments without invoking a shell', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-command-'));
  const marker = path.join(tempDir, 'injected.txt');
  const payload = `safe & echo injected > "${marker}"`;

  try {
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', payload]);
    assert.equal(result.success, true);
    assert.equal(result.stdout, payload);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
