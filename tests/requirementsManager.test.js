const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequirementsManager, deriveRequirements, requirementIpcError, setupRequirementsHandlers } = require('../electron/services/requirementsManager');
const { analyzeWorkspace } = require('../electron/services/workspaceAnalyzer');

function workspace({ fingerprint = 'workspace-fingerprint', installed = false, recommendations = [] } = {}) {
  return {
    fingerprint,
    targets: [{ id: 'target-root', relativePath: '.', capabilities: { webPreview: true } }],
    dependencies: [{ targetId: 'target-root', installState: installed ? 'appears-installed' : 'install-needed', lockfiles: ['package-lock.json'] }],
    packageManagerDetails: [{ manager: 'npm', path: 'package-lock.json' }],
    packageManagers: ['npm'],
    readiness: { status: installed ? 'ready' : 'configuration-needed', missingEnvironment: [], recommendations },
  };
}

function fixture({ workspaceValue = workspace(), onboarding = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-requirements-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { react: '19.1.0' } }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: {} }));
  let project = { id: 'project-1', path: root, primaryTargetId: 'target-root', workspace: workspaceValue, onboarding };
  project.requirements = deriveRequirements(project, null, 100);
  const updateProject = (_id, updater) => {
    project = updater({ ...project });
    return project;
  };
  return { root, get project() { return project; }, getProjectById: () => project, updateProject };
}

/*
 * `REVIEW_PREVIEW` era un pendiente sin accion detras: su descriptor decia
 * `supported: false`, asi que el boton no llevaba a ningun lado y el globito
 * del lateral no se apagaba nunca. Un proyecto que Vibe no puede arrancar solo
 * ya no debe nada.
 */
test('a project Vibe cannot start on its own leaves no pending requirement', () => {
  const project = {
    id: 'project-manual',
    primaryTargetId: 'target-root',
    workspace: {
      targets: [{ id: 'target-root', relativePath: '.', capabilities: { webPreview: false } }],
      dependencies: [],
      readiness: { status: 'ready', missingEnvironment: [], recommendations: [], launch: { mode: 'manual', runtime: null, command: ['npm', 'run', 'start'] } },
    },
  };
  assert.deepEqual(deriveRequirements(project, null, 100).items, []);
  /* Y el pendiente que dejo una version anterior se apaga solo al reanalizar. */
  const previous = { revision: 1, items: [{ id: 'req_old', type: 'REVIEW_PREVIEW', status: 'pending', severity: 'advisory', relativePath: '.', detail: {} }] };
  assert.deepEqual(deriveRequirements(project, previous, 100).items, []);
});

test('managed npm install uses one-use consent and isolated fixed execution', async () => {
  const state = fixture();
  const calls = [];
  const progress = [];
  let scans = 0;
  const manager = createRequirementsManager({
    getProjectById: state.getProjectById,
    updateProject: state.updateProject,
    analyze: async () => (++scans === 1 ? workspace() : workspace({ installed: true })),
    runner: { run: async (...args) => { calls.push(args); return { success: true }; } },
    randomUUID: () => 'grant-1',
    randomBytes: () => Buffer.alloc(32, 7),
    now: () => 1_000,
  });
  try {
    const item = state.project.requirements.items.find((candidate) => candidate.type === 'INSTALL_DEPENDENCIES');
    const preview = manager.preview(state.project.id, item.id);
    assert.deepEqual(preview.action.display.args, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    await manager.apply(preview.grantId, preview.confirmationNonce, (event) => progress.push(event));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'npm');
    assert.deepEqual(calls[0][1], ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    assert.equal(calls[0][2].cwd, fs.realpathSync(state.root));
    assert.equal(calls[0][2].env.NPM_CONFIG_IGNORE_SCRIPTS, 'true');
    assert.equal(calls[0][2].env.NPM_CONFIG_USERCONFIG, process.platform === 'win32' ? 'NUL' : '/dev/null');
    assert.equal(calls[0][2].env.NPM_CONFIG_GLOBALCONFIG, process.platform === 'win32' ? 'NUL' : '/dev/null');
    assert.equal(preview.action.effects.temporaryCacheMayChange, true);
    /* El analisis previo a la accion ahora tiene su propia etapa: antes corria sin que la pantalla mostrara nada. */
    assert.deepEqual(progress.map((event) => event.stage), ['validating', 'analyzing', 'preparing', 'installing', 'verifying', 'complete']);
    assert.deepEqual(progress.map((event) => event.percent), [8, 10, 25, 45, 85, 100]);
    assert.deepEqual(progress.find((event) => event.stage === 'installing').estimate, { minSeconds: 60, maxSeconds: 300 });
    await assert.rejects(() => manager.apply(preview.grantId, preview.confirmationNonce), (error) => error.code === 'ACTION_GRANT_INVALID');
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('requirements IPC exposes stable error codes without technical messages', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const manager = {
    list: () => { const error = new Error('C:\\private\\project\\package-lock.json failed'); error.code = 'ACTION_STALE'; throw error; },
    apply: async (_grant, _nonce, onProgress) => { onProgress({ projectId: 'p', requirementId: 'r', stage: 'installing', percent: 45 }); return { projectId: 'p' }; },
  };
  setupRequirementsHandlers(ipcMain, manager);
  const failure = await handlers.get('requirements:list')({ sender: { send: () => {} } }, 'p');
  assert.deepEqual(failure, { ok: false, error: { code: 'ACTION_STALE' } });
  assert.doesNotMatch(JSON.stringify(failure), /private|package-lock/);
  const sent = [];
  const success = await handlers.get('requirements:apply')({ sender: { send: (...args) => sent.push(args) } }, 'g', 'n');
  assert.deepEqual(success, { ok: true, data: { projectId: 'p' } });
  assert.deepEqual(sent[0], ['requirements:progress', { projectId: 'p', requirementId: 'r', stage: 'installing', percent: 45 }]);
  assert.deepEqual(requirementIpcError(new Error('raw')), { code: 'REQUIREMENTS_FAILED' });
  const retryError = new Error('raw');
  retryError.code = 'ACTION_VERIFY_FAILED';
  retryError.retryId = 'safe-retry-id';
  assert.deepEqual(requirementIpcError(retryError), { code: 'ACTION_VERIFY_FAILED', retry: { id: 'safe-retry-id', stage: 'verify-install' } });
});

test('lockfile content changes invalidate a reviewed action before npm runs', async () => {
  const state = fixture();
  let ran = false;
  const manager = createRequirementsManager({
    getProjectById: state.getProjectById,
    updateProject: state.updateProject,
    analyze: async () => workspace(),
    runner: { run: async () => { ran = true; return { success: true }; } },
    randomUUID: () => 'grant-2',
    randomBytes: () => Buffer.alloc(32, 9),
    now: () => 2_000,
  });
  try {
    const item = state.project.requirements.items[0];
    const preview = manager.preview(state.project.id, item.id);
    fs.writeFileSync(path.join(state.root, 'package-lock.json'), JSON.stringify({ name: 'changed', lockfileVersion: 3, packages: {} }));
    await assert.rejects(() => manager.apply(preview.grantId, preview.confirmationNonce), (error) => error.code === 'ACTION_STALE');
    assert.equal(ran, false);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('insufficient disk space blocks npm before it can change dependencies', async () => {
  const state = fixture();
  let ran = false;
  const manager = createRequirementsManager({
    getProjectById: state.getProjectById,
    updateProject: state.updateProject,
    analyze: async () => workspace(),
    diskSpace: () => 1,
    runner: { run: async () => { ran = true; return { success: true }; } },
    randomUUID: () => 'disk-grant',
    randomBytes: () => Buffer.alloc(32, 4),
    now: () => 2_500,
  });
  try {
    const item = state.project.requirements.items[0];
    const preview = manager.preview(state.project.id, item.id);
    assert.ok(preview.action.display.requiredFreeBytes >= 512 * 1024 * 1024);
    await assert.rejects(() => manager.apply(preview.grantId, preview.confirmationNonce), (error) => error.code === 'DISK_SPACE_LOW');
    assert.equal(ran, false);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('a failed post-install check retries verification without running npm twice', async () => {
  const state = fixture();
  let scans = 0;
  let runs = 0;
  let ids = 0;
  const manager = createRequirementsManager({
    getProjectById: state.getProjectById,
    updateProject: state.updateProject,
    analyze: async () => {
      scans += 1;
      if (scans === 2) throw new Error('temporary analyzer failure');
      return scans >= 3 ? workspace({ installed: true }) : workspace();
    },
    diskSpace: () => Number.MAX_SAFE_INTEGER,
    runner: { run: async () => { runs += 1; return { success: true }; } },
    randomUUID: () => `retry-id-${++ids}`,
    randomBytes: () => Buffer.alloc(32, 6),
    now: () => 2_700,
  });
  try {
    const item = state.project.requirements.items[0];
    const preview = manager.preview(state.project.id, item.id);
    let retryId;
    await assert.rejects(() => manager.apply(preview.grantId, preview.confirmationNonce), (error) => {
      retryId = error.retryId;
      return error.code === 'ACTION_VERIFY_FAILED' && typeof retryId === 'string';
    });
    assert.equal(runs, 1);
    const result = await manager.retry(retryId);
    assert.equal(runs, 1);
    assert.equal(result.projectPatch.requirements.items.find((candidate) => candidate.id === item.id).status, 'completed');
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('project npm configuration disables managed execution and manual effects are explicit', () => {
  const state = fixture();
  try {
    fs.writeFileSync(path.join(state.root, '.npmrc'), 'registry=https://registry.example.test');
    const manager = createRequirementsManager({ getProjectById: state.getProjectById, updateProject: state.updateProject });
    const preview = manager.preview(state.project.id, state.project.requirements.items[0].id);
    assert.equal(preview.action.supported, false);
    assert.equal(preview.action.actionType, 'MANUAL_DEPENDENCY_INSTALL');
    assert.equal(preview.action.effects.projectFilesMayChange, true);
    assert.equal(preview.action.effects.projectCodeMayExecute, true);
    assert.equal(preview.grantId, null);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('non-pending requirements cannot be previewed or applied again', () => {
  const state = fixture();
  try {
    state.project.requirements.items[0].status = 'completed';
    const manager = createRequirementsManager({ getProjectById: state.getProjectById, updateProject: state.updateProject });
    assert.throws(() => manager.preview(state.project.id, state.project.requirements.items[0].id), (error) => error.code === 'REQUIREMENT_NOT_PENDING');
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('confirming a low-confidence root updates the authoritative onboarding flag', async () => {
  const state = fixture({ workspaceValue: workspace({ installed: true, recommendations: ['CONFIRM_PROJECT_ROOT'] }), onboarding: { acknowledgedLowConfidence: false } });
  const manager = createRequirementsManager({
    getProjectById: state.getProjectById,
    updateProject: state.updateProject,
    randomUUID: () => 'grant-root',
    randomBytes: () => Buffer.alloc(32, 3),
    now: () => 3_000,
  });
  try {
    const item = state.project.requirements.items.find((candidate) => candidate.type === 'CONFIRM_PROJECT_ROOT');
    const preview = manager.preview(state.project.id, item.id);
    await manager.apply(preview.grantId, preview.confirmationNonce);
    assert.equal(state.project.onboarding.acknowledgedLowConfidence, true);
    assert.equal(state.project.requirements.items.find((candidate) => candidate.id === item.id).status, 'completed');
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('manual guidance copies the same command shown in the preview', () => {
  const state = fixture();
  let copied = '';
  try {
    state.project.workspace.packageManagerDetails = [{ manager: 'pnpm', path: 'pnpm-lock.yaml' }];
    state.project.workspace.packageManagers = ['pnpm'];
    state.project.workspace.dependencies[0].lockfiles = ['pnpm-lock.yaml'];
    state.project.requirements = deriveRequirements(state.project, null, 100);
    const manager = createRequirementsManager({ getProjectById: state.getProjectById, updateProject: state.updateProject, clipboard: { writeText: (value) => { copied = value; } } });
    const item = state.project.requirements.items[0];
    const preview = manager.preview(state.project.id, item.id);
    manager.copyGuidance(state.project.id, item.id);
    assert.equal(copied, [preview.action.display.tool, ...preview.action.display.args].join(' '));
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
});

test('workspace members produce one requirement for their shared install scope', () => {
  const state = fixture({ workspaceValue: {
    ...workspace(),
    targets: [
      { id: 'admin', relativePath: 'apps/admin', capabilities: {} },
      { id: 'store', relativePath: 'apps/store', capabilities: {} },
    ],
    dependencies: ['admin', 'store'].map((targetId) => ({ targetId, installState: 'install-needed', lockfiles: ['package-lock.json'], installScope: { relativePath: '.', workspaceRoot: '.', isWorkspaceMember: true, manager: 'npm', managerVersion: '11.0.0', lockfile: 'package-lock.json' } })),
  } });
  try {
    assert.equal(state.project.requirements.items.filter((item) => item.type === 'INSTALL_DEPENDENCIES').length, 1);
    assert.deepEqual(state.project.requirements.items[0].detail.targetIds, ['admin', 'store']);
  } finally { fs.rmSync(state.root, { recursive: true, force: true }); }
});

test('requirements responses expose only the screen state and no internal project data', () => {
  const state = fixture();
  try {
    state.project.secretFutureField = 'must-not-leak';
    state.project.workspace.environment = { names: [{ name: 'PRIVATE_TOKEN' }] };
    const manager = createRequirementsManager({ getProjectById: state.getProjectById, updateProject: state.updateProject });
    const result = manager.list(state.project.id);
    const serialized = JSON.stringify(result);
    assert.deepEqual(Object.keys(result).sort(), ['projectId', 'projectPatch', 'schemaVersion']);
    assert.equal(result.projectPatch.requirements.items.length, state.project.requirements.items.length);
    assert.doesNotMatch(serialized, /must-not-leak|PRIVATE_TOKEN|fingerprint|environment|onboarding/);
    const preview = manager.preview(state.project.id, state.project.requirements.items[0].id);
    assert.equal('projectId' in preview, false);
    assert.equal('expiresAt' in preview, false);
    assert.equal('reversible' in preview.action, false);
  } finally { fs.rmSync(state.root, { recursive: true, force: true }); }
});

test('a nested standalone npm app installs in its own analyzed scope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-requirements-nested-'));
  let project;
  let commandCwd = '';
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'root' }));
    fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({ name: 'web', dependencies: { react: '19' } }));
    fs.writeFileSync(path.join(root, 'apps', 'web', 'package-lock.json'), JSON.stringify({ name: 'web', lockfileVersion: 3, packages: {} }));
    const analyzed = await analyzeWorkspace(root);
    project = { id: 'project-nested', name: 'Nested', path: root, primaryTargetId: analyzed.recommendedTargetId, workspace: analyzed, onboarding: {} };
    project.requirements = deriveRequirements(project, null, 100);
    const manager = createRequirementsManager({
      getProjectById: () => project,
      updateProject: (_id, updater) => { project = updater({ ...project }); return project; },
      analyze: analyzeWorkspace,
      runner: { run: async (_tool, _args, options) => {
        commandCwd = options.cwd;
        fs.mkdirSync(path.join(root, 'apps', 'web', 'node_modules', 'react'), { recursive: true });
        fs.writeFileSync(path.join(root, 'apps', 'web', 'node_modules', 'react', 'package.json'), JSON.stringify({ name: 'react' }));
        return { success: true };
      } },
      randomUUID: () => 'nested-grant',
      randomBytes: () => Buffer.alloc(32, 5),
      now: () => 4_000,
    });
    const item = project.requirements.items.find((candidate) => candidate.type === 'INSTALL_DEPENDENCIES');
    assert.equal(item.relativePath, 'apps/web');
    const preview = manager.preview(project.id, item.id);
    await manager.apply(preview.grantId, preview.confirmationNonce);
    assert.equal(commandCwd, fs.realpathSync(path.join(root, 'apps', 'web')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
