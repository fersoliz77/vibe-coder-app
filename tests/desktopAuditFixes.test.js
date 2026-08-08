const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canAccessChannel, installIpcAuthorization, isTrustedMainFrame } = require('../electron/auth/ipcGuard');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('privileged IPC accepts only the current main frame', async () => {
  const handlers = new Map();
  const listeners = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    on(channel, listener) { listeners.set(channel, listener); },
  };
  const mainFrame = {};
  const webContents = { mainFrame };
  const window = { webContents, isDestroyed: () => false };
  installIpcAuthorization(ipcMain, () => 'active', () => window);
  ipcMain.handle('fs:write-file', () => 'written');
  ipcMain.on('terminal:write', (event) => { event.called = true; });

  assert.equal(isTrustedMainFrame({ sender: webContents, senderFrame: mainFrame }, () => window), true);
  assert.equal(await handlers.get('fs:write-file')({ sender: webContents, senderFrame: mainFrame }), 'written');
  assert.throws(() => handlers.get('fs:write-file')({ sender: {}, senderFrame: mainFrame }), (error) => error.code === 'IPC_INVALID_SENDER');
  assert.throws(() => handlers.get('fs:write-file')({ sender: webContents, senderFrame: {} }), (error) => error.code === 'IPC_INVALID_SENDER');
  const untrustedEvent = { sender: webContents, senderFrame: {}, called: false };
  listeners.get('terminal:write')(untrustedEvent);
  assert.equal(untrustedEvent.called, false);
});

test('startup can read preferences before authentication without opening productive IPC', () => {
  assert.equal(canAccessChannel('denied', 'store:getAll'), true);
  assert.equal(canAccessChannel('denied', 'store:get'), true);
  assert.equal(canAccessChannel('denied', 'store:set'), false);
  assert.equal(canAccessChannel('denied', 'fs:write-file'), false);
});

test('close confirmation is registered above auth and delegates dirty workspace checks', () => {
  const app = source('src/App.jsx');
  assert.match(app, /onCloseRequested/);
  assert.match(app, /closeCheckRef\.current/);
  assert.match(app, /confirmClose\(\)/);
  assert.match(app, /<AuthGate><Workspace setCloseCheck=/);
  assert.doesNotMatch(app.slice(0, app.indexOf('export default function App')), /onCloseRequested/);
});

test('store and auth initialization failures are recoverable and polling catches rejection', () => {
  const store = source('src/store/useAppStore.js');
  const auth = source('src/features/auth/AuthGate.jsx');
  assert.match(store, /initializationStatus: 'error'/);
  assert.match(store, /initializationError/);
  assert.match(auth, /error=\{loadError\}/);
  assert.match(auth, /setInterval\(\(\) => \{ refreshState\(\); \}/);
});

test('AI conversations remain session-only and legacy cleartext keys are purged', () => {
  const claude = source('src/hooks/useClaude.js');
  const openai = source('src/features/openai/OpenAIPanel.jsx');
  const store = source('electron/ipc/storeManager.js');
  assert.doesNotMatch(claude, /chat:claude|store\.set\(storageKey/);
  assert.doesNotMatch(openai, /chat:openai|store\.set\(storageKey/);
  assert.match(store, /key\.startsWith\('chat:'\)/);
  assert.match(claude, /setMessages\(\[\]\)/);
  assert.match(openai, /setMessages\(\[\]\)/);
});

test('onboarding does not auto-install Claude or infer Codex readiness from rejection', () => {
  const wizard = source('src/features/setup/OnboardingWizard.jsx');
  assert.doesNotMatch(wizard, /if \(!installed\) installClaude\(\)/);
  assert.match(wizard, /onClick=\{onInstallClaude\}/);
  assert.match(wizard, /setCodexReady\(status\?\.installed === true\)/);
  assert.match(wizard, /catch \{\s*setCodexReady\(false\)/);
});

test('navigation accessibility and lazy loading contracts are present', () => {
  assert.match(source('src/layouts/sidebar/Sidebar.jsx'), /aria-current/);
  assert.match(source('src/features/settings/SettingsPanel.jsx'), /tabIndex=\{activeTab === tab\.id \? 0 : -1\}/);
  assert.match(source('src/features/settings/SettingsPanel.jsx'), /ArrowRight/);
  assert.match(source('src/features/preview/PreviewCenter.jsx'), /ArrowLeft/);
  assert.match(source('src/features/preview/PreviewCenter.jsx'), /aria-controls="preview-panel-web"/);
  assert.match(source('src/App.jsx'), /lazy\(\(\) => import/);
  assert.doesNotMatch(source('src/App.jsx'), /Preload OpenCode in background/);
});
