const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INSTALL_PACKAGE,
  PACKAGE_NAME,
  getNativeCandidates,
  parseAuthProviders,
} = require('../electron/services/openCodeManager');
const { selectTerminalExecutable } = require('../electron/services/terminalManager');

test('OpenCode pins only the audited official npm package', () => {
  assert.equal(INSTALL_PACKAGE, 'opencode-ai@1.17.18');
  assert.equal(PACKAGE_NAME, 'opencode-ai');
  assert.doesNotMatch(INSTALL_PACKAGE, /claude|codex/i);
});

test('OpenCode resolves the executable from the unversioned npm package directory', () => {
  const executablePath = getNativeCandidates()[0];
  assert.match(executablePath, /node_modules[\\/]opencode-ai[\\/]bin[\\/]opencode\.exe$/i);
  assert.equal(executablePath.includes('opencode-ai@'), false);
});

test('OpenCode auth output exposes provider names without credentials', () => {
  const output = '\u001b[34m●\u001b[39m  OpenAI \u001b[90moauth\n\u001b[34m●\u001b[39m  Anthropic \u001b[90mapi';
  assert.deepEqual(parseAuthProviders(output), ['OpenAI', 'Anthropic']);
});

test('OpenCode terminal mode uses only the main-process executable path', () => {
  const trustedPath = 'C:\\Tools\\opencode.exe';
  assert.equal(selectTerminalExecutable({ mode: 'opencode', shell: 'malicious.cmd' }, trustedPath), trustedPath);
  assert.throws(() => selectTerminalExecutable({ mode: 'custom' }), /Unsupported terminal mode/);
});
