const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadModule() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'currentProject.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('renderer project state keeps only fields used by its screens', async () => {
  const { normalizeCurrentProject } = await loadModule();
  const result = normalizeCurrentProject({
    id: 'proj_1', name: 'App', path: 'C:\\projects\\app', backend: 'supabase', secretFutureField: 'hidden',
    workspace: { analyzedAt: 10, fingerprint: 'hidden', targets: [{ id: 'web', name: 'web', kind: 'web', framework: 'React', technologies: ['React'], evidence: ['package.json'] }] },
    requirements: { revision: 9, items: [{ id: 'req_1', type: 'REVIEW_PREVIEW', status: 'pending', severity: 'advisory', relativePath: '.', manager: 'npm', detail: {} }] },
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.backend, 'supabase');
  assert.doesNotMatch(serialized, /secretFutureField|fingerprint|evidence|revision|manager/);
});

test('late project patches cannot replace the currently selected project', async () => {
  const { applyCurrentProjectPatch } = await loadModule();
  const current = { id: 'proj_current', name: 'Current', path: 'C:\\projects\\current' };
  assert.equal(applyCurrentProjectPatch(current, 'proj_old', { requirements: { items: [] } }), null);
  const next = applyCurrentProjectPatch(current, 'proj_current', { requirements: { items: [] } });
  assert.equal(next.id, 'proj_current');
  assert.deepEqual(next.requirements.items, []);
});
