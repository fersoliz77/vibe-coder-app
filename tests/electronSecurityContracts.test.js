const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('main renderer uses context isolation and Chromium sandbox', () => {
  const main = source('electron/main.js');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.doesNotMatch(source('electron/preload.js'), /require\(['"]os['"]\)/);
});

test('AI stream events carry run and project identity', () => {
  for (const manager of ['electron/services/claudeManager.js', 'electron/services/openaiManager.js']) {
    const content = source(manager);
    assert.match(content, /runId/);
    assert.match(content, /projectPath:\s*validatedCwd/);
  }
});

test('before-quit terminates both AI providers', () => {
  const main = source('electron/main.js');
  const beforeQuit = main.slice(main.indexOf("app.once('before-quit'"));
  assert.match(beforeQuit, /terminateAllClaudeProcesses\(\)/);
  assert.match(beforeQuit, /terminateAllOpenAIProcesses\(\)/);
});

test('packaged sandbox smoke mode avoids normal service initialization', () => {
  const main = source('electron/main.js');
  assert.match(main, /--sandbox-smoke-test/);
  assert.match(main, /sandbox-smoke\.html/);
  assert.match(main, /isSandboxSmokeTest[\s\S]+sandbox:\s*true/);
});

test('Google OAuth stays in main and uses explicit protocol and IPC contracts', () => {
  const main = source('electron/main.js');
  const auth = source('electron/auth/authService.js');
  const preload = source('electron/preload.js');
  const packageJson = JSON.parse(source('package.json'));

  assert.match(main, /requestSingleInstanceLock\(\)/);
  assert.match(main, /app\.on\('second-instance'/);
  assert.match(main, /app\.on\('open-url'/);
  assert.match(main, /isNormalExecution/);
  assert.match(auth, /safeStorage\.encryptString\(JSON\.stringify\(transaction\)\)/);
  assert.match(auth, /\/auth\/v1\/token\?grant_type=pkce/);
  assert.match(auth, /auth_code: callback\.code, code_verifier: transaction\.codeVerifier/);
  assert.match(preload, /google: \(\) => ipcRenderer\.invoke\('auth:google'\)/);
  assert.doesNotMatch(preload, /codeVerifier|code_verifier|access_token|refresh_token/);
  assert.deepEqual(packageJson.build.protocols[0].schemes, ['vibeidecode']);
});
