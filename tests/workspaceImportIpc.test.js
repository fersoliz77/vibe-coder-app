const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setupProjectHandlers } = require('../electron/services/projectManager');

function createIpc() {
  const handlers = new Map();
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) };
}

test('import IPC rejects a stale plan, keeps the grant, and applies only a newly reviewed plan', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-import-ipc-'));
  const ipc = createIpc();
  const registrations = [];
  let id = 0;
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'existing', scripts: { dev: 'vite' }, devDependencies: { vite: '6' } }));
    setupProjectHandlers(ipc, () => null, {
      chooseImportDirectory: async () => root,
      randomUUID: () => `opaque-${++id}`,
      registerImportedProject: (projectPath, metadata) => {
        const project = { id: 'project-id', path: projectPath, ...metadata };
        registrations.push(project);
        return project;
      },
      isImportedProjectRegistered: () => false,
    });

    const selection = await ipc.handlers.get('projects:choose-import')();
    assert.match(selection.id, /^opaque-/);
    const firstAnalysis = await ipc.handlers.get('projects:analyze-import')(null, selection.id);
    const firstPlan = await ipc.handlers.get('projects:plan-import')(null, selection.id, { primaryTargetId: firstAnalysis.recommendedTargetId, acknowledgeLowConfidence: false });

    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'changed', scripts: { dev: 'vite' }, dependencies: { react: '19' }, devDependencies: { vite: '6' } }));
    await assert.rejects(() => ipc.handlers.get('projects:confirm-import')(null, selection.id, firstPlan.planId), (error) => error.code === 'IMPORT_PLAN_STALE');
    assert.equal(registrations.length, 0);

    const currentAnalysis = await ipc.handlers.get('projects:analyze-import')(null, selection.id);
    const currentPlan = await ipc.handlers.get('projects:plan-import')(null, selection.id, { primaryTargetId: currentAnalysis.recommendedTargetId, acknowledgeLowConfidence: false });
    const result = await ipc.handlers.get('projects:confirm-import')(null, selection.id, currentPlan.planId);
    assert.equal(result.project.name, path.basename(root));
    assert.equal(result.project.workspace.fingerprint, currentAnalysis.fingerprint);
    assert.equal(result.project.onboarding.guarantees.sourceFilesChanged, false);
    assert.equal(registrations.length, 1);
    await assert.rejects(() => ipc.handlers.get('projects:confirm-import')(null, selection.id, currentPlan.planId));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('expired import grants cannot be analyzed or planned', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-import-expiry-'));
  const ipc = createIpc();
  let now = 100;
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'existing' }));
    setupProjectHandlers(ipc, () => null, { chooseImportDirectory: async () => root, randomUUID: () => 'expiring-grant', now: () => now });
    const selection = await ipc.handlers.get('projects:choose-import')();
    now += 10 * 60 * 1000 + 1;
    await assert.rejects(() => ipc.handlers.get('projects:analyze-import')(null, selection.id), /expired/);
    assert.throws(() => ipc.handlers.get('projects:plan-import')(null, selection.id, {}), /Analyze/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
