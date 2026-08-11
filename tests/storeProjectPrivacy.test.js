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
