const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { sanitizeStoredConfig, sanitizeStoredValue } = require('../electron/ipc/storeManager');

function project() {
  return {
    id: 'proj_1', name: 'App', path: path.join(path.parse(process.cwd()).root, 'projects', 'app'), privateFutureField: 'hidden',
    workspace: { analyzedAt: 1, fingerprint: 'hidden', targets: [{ id: 'web', name: 'web', kind: 'web', framework: 'React', technologies: ['React'], evidence: ['package.json'] }] },
  };
}

test('startup config migration removes private project analysis and legacy chat data', () => {
  const result = sanitizeStoredConfig({ currentProject: project(), recentProjects: [project()], 'chat:claude:path': [{ content: 'private' }], theme: 'dark' });
  const serialized = JSON.stringify(result);
  assert.equal(result.theme, 'dark');
  assert.doesNotMatch(serialized, /privateFutureField|fingerprint|evidence|chat:claude|private/);
});

test('store writes cannot persist a full project record again', () => {
  const result = sanitizeStoredValue('currentProject', project());
  assert.equal(result.id, 'proj_1');
  assert.equal('privateFutureField' in result, false);
  assert.equal('fingerprint' in result.workspace, false);
});

test('favorite project preferences keep only bounded unique IDs', () => {
  const ids = [' proj_1 ', 'proj_1', '', null, 'x'.repeat(161), ...Array.from({ length: 250 }, (_, index) => `proj_${index + 2}`)];
  const result = sanitizeStoredValue('favoriteProjectIds', ids);
  assert.equal(result[0], 'proj_1');
  assert.equal(result.length, 200);
  assert.equal(new Set(result).size, result.length);
  assert.deepEqual(sanitizeStoredConfig({ favoriteProjectIds: 'invalid' }).favoriteProjectIds, []);
});

test('explorer persistence removes legacy paths and keeps an exact relative manifest', () => {
  const result = sanitizeStoredConfig({
    'fileExplorerState:C:\\private\\app': { openTabPaths: ['C:\\private\\app\\secret.js'] },
    'fileExplorerTabs:proj_1': { version: 1, tabs: ['src/App.jsx', 'src/App.jsx', '../secret'], panes: { primary: 'src/App.jsx', secondary: '../secret' }, splitView: true },
  });
  assert.equal(Object.keys(result).some((key) => key.startsWith('fileExplorerState:')), false);
  assert.deepEqual(result['fileExplorerTabs:proj_1'], { version: 1, tabs: ['src/App.jsx'], panes: { primary: 'src/App.jsx', secondary: null }, splitView: true });
  assert.equal(sanitizeStoredValue('fileExplorerTabs:proj_1', { version: 2, tabs: [] }), null);
});
