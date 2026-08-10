const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Android download percentages drive the environment progress bar', async () => {
  const progress = await import(pathToFileURL(path.join(root, 'src', 'features', 'setup', 'environmentProgress.js')));
  assert.equal(progress.getEnvironmentInstallPercent({ message: '[====] 10% Downloading x86_64.zip' }), 10);
  assert.equal(progress.getEnvironmentInstallPercent({ type: 'step-start', current: 1, total: 2 }), 0);
  assert.equal(progress.getEnvironmentInstallPercent({ type: 'step-complete', current: 1, total: 2 }), 50);
  assert.equal(progress.getEnvironmentInstallStatus({ type: 'complete', success: true }), 'completed');
  assert.equal(progress.isEnvironmentInstallTerminal({ type: 'cancelled' }), true);
});

test('environment installation state survives setup navigation and drives a global toast', () => {
  const preload = read('electron/preload.js');
  const manager = read('electron/services/environmentManager.js');
  const setup = read('src/features/setup/SetupCenter.jsx');
  const app = read('src/App.jsx');
  assert.match(preload, /getState: \(\) => ipcRenderer\.invoke\('setup:environment-state'\)/);
  assert.match(manager, /ipcMain\.handle\('setup:environment-state'/);
  assert.match(setup, /api\.getState\?\.\(\)/);
  assert.match(app, /setup\.getState\?\.\(\)/);
  assert.match(app, /environment-install-toast/);
  assert.match(app, /backgroundInstallCopy/);
  assert.match(app, /setActiveView\(VIEWS\.SETTINGS\)/);
});
