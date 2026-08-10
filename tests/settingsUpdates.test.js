const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'settings', 'SettingsPanel.jsx'), 'utf8');
const locales = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'locales.js'), 'utf8');

test('settings checks updates through the fixed preload bridge without renderer credentials', () => {
  assert.match(source, /window\.electronAPI\.updates\.check\(\)/);
  assert.doesNotMatch(source, /updates\.check\([^)]/);
  assert.match(source, /updates\.getState\(\)/);
  assert.match(source, /updates\.onStateChanged\(accept\)/);
  assert.match(source, /unsubscribe\?\.\(\)/);
});

test('support places application updates before diagnostics with active-policy guarding', () => {
  assert.ok(source.indexOf("t('settings.applicationUpdates')") < source.indexOf("t('settings.localDiagnostics')"));
  assert.match(source, /state\.policy !== 'active'/);
  assert.match(source, /aria-busy=\{updateBusy\}/);
  assert.match(source, /disabled=\{updateBusy \|\| state\.policy !== 'active'/);
});

test('settings exposes transient current feedback and persistent update progress in both languages', () => {
  assert.match(source, /updateCurrentToast/);
  assert.match(source, /persistentUpdateToast/);
  assert.match(source, /updateState\.status === 'downloading'/);
  assert.match(source, /role=\{visibleUpdateToast\.tone === 'error' \? 'alert' : 'status'\}/);
  for (const key of ['applicationUpdates', 'checkForUpdates', 'updateCurrentToast', 'updateDownloading']) {
    assert.equal((locales.match(new RegExp(`${key}:`, 'g')) || []).length, 2, key);
  }
});
