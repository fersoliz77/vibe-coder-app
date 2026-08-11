const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeProjectRecord, normalizeRequirements, toPublicProject } = require('../electron/services/projectContracts');

function validWorkspace() {
  return {
    schemaVersion: 3,
    fingerprint: 'a'.repeat(64),
    analyzedAt: 100,
    targets: [{ id: 'web-root', name: 'web', relativePath: '.', kind: 'web', framework: 'React', technologies: ['React'], evidence: ['package.json'] }],
    dependencies: [{ targetId: 'web-root', ecosystem: 'npm', groups: [], installState: 'not-required', installScope: { relativePath: '.', workspaceRoot: null, manager: 'npm', lockfile: 'package-lock.json' } }],
    packageManagerDetails: [{ manager: 'npm', path: 'package-lock.json' }],
    readiness: { status: 'ready', recommendations: [], missingEnvironment: [] },
    environment: { names: [{ name: 'PRIVATE_TOKEN' }] },
  };
}

test('persisted project validation removes unknown fields and rejects unsafe nested paths', () => {
  const project = normalizeProjectRecord({ id: 'proj_1', name: 'Safe', path: path.join(path.parse(process.cwd()).root, 'safe-project'), createdAt: 1, unknown: 'drop', workspace: validWorkspace() });
  assert.equal(project.unknown, undefined);
  assert.equal(project.workspace.targets[0].relativePath, '.');

  const corrupted = validWorkspace();
  corrupted.targets[0].relativePath = '../outside';
  const recovered = normalizeProjectRecord({ id: 'proj_1', name: 'Safe', path: path.join(path.parse(process.cwd()).root, 'safe-project'), workspace: corrupted, requirements: { schemaVersion: 2, revision: 1, items: [] } });
  assert.equal(recovered.workspace, undefined);
  assert.equal(recovered.requirements, undefined);
});

test('invalid requirement states fail closed instead of becoming executable metadata', () => {
  assert.equal(normalizeRequirements({ schemaVersion: 2, revision: 1, items: [{ id: 'req_1', type: 'INSTALL_DEPENDENCIES', status: 'hacked', severity: 'blocking', relativePath: '.', detail: {} }] }), undefined);
});

test('public project DTO keeps screen fields and removes internal analysis', () => {
  const project = { id: 'proj_1', name: 'Safe', path: path.join(path.parse(process.cwd()).root, 'safe-project'), primaryTargetId: 'web-root', workspace: validWorkspace(), onboarding: { guarantees: { secretsStored: false } }, futureSecret: 'hidden' };
  const result = toPublicProject(project, { items: [] });
  const serialized = JSON.stringify(result);
  assert.equal(result.workspace.targets[0].framework, 'React');
  assert.doesNotMatch(serialized, /PRIVATE_TOKEN|evidence|fingerprint|onboarding|futureSecret/);
});
