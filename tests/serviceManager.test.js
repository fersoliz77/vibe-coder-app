const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runCommand, resolveCliInvocation, checkVercel, checkSupabase } = require('../electron/services/serviceManager');

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

test('Vercel authentication stays connected when the project is not linked', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-vercel-'));
  try {
    const service = await checkVercel(tempDir, async () => ({ success: true, stdout: 'fersoliz77', stderr: '' }));
    assert.equal(service.connected, true);
    assert.equal(service.user, 'fersoliz77');
    assert.equal(service.projectLinked, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Supabase authentication stays connected when the project is not initialized', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-supabase-'));
  try {
    const service = await checkSupabase(tempDir, async () => ({
      success: true,
      stdout: '[{"id":"org-id","name":"mktsolutions"}]',
      stderr: '',
    }));
    assert.equal(service.connected, true);
    assert.equal(service.user, 'mktsolutions');
    assert.equal(service.projectLinked, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Supabase uses its native executable on Windows to prevent console flashes', () => {
  if (process.platform !== 'win32') return;
  const invocation = resolveCliInvocation('supabase', (candidate) => candidate.endsWith('supabase.exe'));
  assert.match(invocation.file, /supabase\.exe$/i);
  assert.deepEqual(invocation.argsPrefix, []);
});
