const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(root, 'src', 'features', 'settings', 'SettingsPanel.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'features', 'settings', 'SettingsPanel.css'), 'utf8');
const locales = fs.readFileSync(path.join(root, 'src', 'i18n', 'locales.js'), 'utf8');

test('settings separates AI, tools, and connections into focused keyboard tabs', () => {
  for (const id of ['ai', 'tools', 'connections', 'preferences', 'account', 'support']) {
    assert.match(panel, new RegExp(`id: '${id}'`));
    assert.match(panel, new RegExp(`settings-panel-${id}`));
  }
  assert.match(panel, /useState\('ai'\)/);
  assert.doesNotMatch(panel, /activeTab === 'services'/);
  assert.match(panel, /role="tablist"/);
  assert.match(panel, /ArrowRight[\s\S]*ArrowLeft/);
});

test('desktop settings keeps the navigation rail fixed while only long content scrolls', () => {
  assert.match(styles, /\.settings-panel \{[^}]*overflow: hidden/);
  assert.match(styles, /\.settings-shell \{[^}]*min-height: 0/);
  assert.match(styles, /\.settings-tabs \{[^}]*border-right:/);
  assert.match(styles, /\.settings-content \{[^}]*overflow-y: auto/);
  assert.match(styles, /\.settings-providers \{[^}]*repeat\(3/);
  assert.match(styles, /\.settings-delivery \{[^}]*repeat\(4/);
  assert.match(panel, /'github', 'vercel', 'supabase', 'firebase'/);
});

test('new settings destinations are translated in English and Spanish', () => {
  assert.match(locales, /ai: 'AI', aiCopy: 'Models and assistants'/);
  assert.match(locales, /tools: 'Tools', toolsCopy: 'Local development environment'/);
  assert.match(locales, /connections: 'Connections', connectionsCopy: 'Connected services'/);
  assert.match(locales, /ai: 'IA', aiCopy: 'Modelos y asistentes'/);
  assert.match(locales, /tools: 'Herramientas', toolsCopy: 'Entorno de desarrollo local'/);
  assert.match(locales, /connections: 'Conexiones', connectionsCopy: 'Servicios conectados'/);
});
