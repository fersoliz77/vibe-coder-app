const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeWorkspace } = require('./workspaceAnalyzer');
const { createDefaultRunner } = require('./projectProvisioner/commandRunner');
const { assertNoLinkedPath, isSubPath, validateProjectCwd } = require('../ipc/fsGuards');
const { toRequirementsState } = require('./projectContracts');

const ACTION_TTL_MS = 5 * 60 * 1000;
const MAX_GRANTS = 100;
const MAX_LOCKFILE_BYTES = 32 * 1024 * 1024;
const MIN_INSTALL_FREE_BYTES = 512 * 1024 * 1024;
const MAX_INSTALL_FREE_BYTES = 8 * 1024 * 1024 * 1024;
const PUBLIC_ERROR_CODES = new Set([
  'PROJECT_NOT_FOUND', 'REQUIREMENT_NOT_FOUND', 'REQUIREMENT_NOT_PENDING', 'ACTION_PRECONDITION_FAILED', 'ACTION_GRANT_INVALID',
  'ACTION_STALE', 'ACTION_NOT_SUPPORTED', 'ACTION_BUSY', 'ACTION_FAILED', 'ACTION_CANCELLED', 'GUIDANCE_UNAVAILABLE',
  'CLIPBOARD_UNAVAILABLE', 'CANCELLED', 'DISK_SPACE_LOW', 'ACTION_VERIFY_FAILED', 'ACTION_VERIFY_INCOMPLETE',
]);
const REQUIREMENT_TYPES = new Set(['INSTALL_DEPENDENCIES', 'CONFIGURE_ENVIRONMENT', 'REVIEW_PREVIEW', 'REVIEW_PARTIAL_SCAN', 'CONFIRM_PROJECT_ROOT']);
function manualInstallCommand(item) {
  if (item.manager === 'npm') return ['npm', 'install'];
  if (item.manager === 'pnpm') return item.detail?.lockfile ? ['pnpm', 'install', '--frozen-lockfile'] : ['pnpm', 'install'];
  if (item.manager === 'bun') return item.detail?.lockfile ? ['bun', 'install', '--frozen-lockfile'] : ['bun', 'install'];
  if (item.manager === 'yarn') return item.detail?.lockfile
    ? /^1(?:\.|$)/.test(item.detail?.managerVersion || '') ? ['yarn', 'install', '--frozen-lockfile'] : ['yarn', 'install', '--immutable']
    : ['yarn', 'install'];
  return null;
}

function stableId(type, scope = '.') {
  return `req_${crypto.createHash('sha256').update(`${type}:${scope}`).digest('hex').slice(0, 16)}`;
}

function targetFor(project, targetId) {
  return project.workspace?.targets?.find((target) => target.id === targetId) || null;
}

function dependencyCandidates(project) {
  const analysis = project.workspace || {};
  const pending = (analysis.dependencies || []).filter((item) => item.installState === 'install-needed');
  const grouped = new Map();
  for (const item of pending) {
    const target = targetFor(project, item.targetId);
    const relativePath = item.installScope?.relativePath || target?.relativePath || '.';
    const localLockfiles = (item.lockfiles || []).filter((lockfile) => path.posix.dirname(lockfile) === relativePath);
    const lockfile = item.installScope?.lockfile || localLockfiles[0] || null;
    const manager = item.installScope?.manager || (lockfile ? (analysis.packageManagerDetails || []).find((entry) => entry.path === lockfile)?.manager : null);
    const key = `${relativePath}:${manager || 'unknown'}:${lockfile || 'none'}`;
    const candidate = grouped.get(key) || { targetIds: [], relativePath, manager: manager || null, managerVersion: item.installScope?.managerVersion || null, lockfile };
    candidate.targetIds.push(item.targetId);
    grouped.set(key, candidate);
  }
  return [...grouped.values()].map((candidate) => ({ ...candidate, targetId: candidate.targetIds.length === 1 ? candidate.targetIds[0] : null }));
}

function deriveRequirements(project, previous = project.requirements, generatedAt = Date.now()) {
  const candidates = [];
  for (const dependency of dependencyCandidates(project)) {
    candidates.push({
      id: stableId('INSTALL_DEPENDENCIES', dependency.relativePath),
      type: 'INSTALL_DEPENDENCIES',
      status: 'pending',
      severity: 'blocking',
      actionMode: dependency.manager === 'npm' && path.posix.basename(dependency.lockfile || '') === 'package-lock.json' ? 'managed' : 'manual',
      targetId: dependency.targetId,
      relativePath: dependency.relativePath,
      manager: dependency.manager,
      detail: { manager: dependency.manager, managerVersion: dependency.managerVersion, lockfile: dependency.lockfile, targetIds: dependency.targetIds },
    });
  }
  const missingEnvironment = project.workspace?.readiness?.missingEnvironment || [];
  if (missingEnvironment.length) candidates.push({ id: stableId('CONFIGURE_ENVIRONMENT'), type: 'CONFIGURE_ENVIRONMENT', status: 'pending', severity: 'blocking', actionMode: 'manual', targetId: null, relativePath: '.', detail: { count: missingEnvironment.length, names: missingEnvironment.slice(0, 100) } });
  if (project.workspace?.readiness?.recommendations?.includes('REVIEW_PREVIEW')) candidates.push({ id: stableId('REVIEW_PREVIEW'), type: 'REVIEW_PREVIEW', status: 'pending', severity: 'advisory', actionMode: 'manual', targetId: project.primaryTargetId || null, relativePath: targetFor(project, project.primaryTargetId)?.relativePath || '.', detail: {} });
  if (project.workspace?.readiness?.recommendations?.includes('REVIEW_PARTIAL_SCAN')) candidates.push({ id: stableId('REVIEW_PARTIAL_SCAN'), type: 'REVIEW_PARTIAL_SCAN', status: 'pending', severity: 'advisory', actionMode: 'metadata', targetId: null, relativePath: '.', detail: {} });
  if (project.workspace?.readiness?.recommendations?.includes('CONFIRM_PROJECT_ROOT') && !project.onboarding?.acknowledgedLowConfidence) candidates.push({ id: stableId('CONFIRM_PROJECT_ROOT'), type: 'CONFIRM_PROJECT_ROOT', status: 'pending', severity: 'blocking', actionMode: 'metadata', targetId: null, relativePath: '.', detail: {} });

  const previousItems = new Map((previous?.items || []).map((item) => [item.id, item]));
  const activeIds = new Set(candidates.map((item) => item.id));
  const items = candidates.map((item) => {
    const old = previousItems.get(item.id);
    const preserve = old && (['dismissed', 'deferred'].includes(old.status) || (old.status === 'completed' && item.type !== 'INSTALL_DEPENDENCIES'));
    return preserve ? { ...item, status: old.status, updatedAt: old.updatedAt } : item;
  });
  for (const old of previousItems.values()) {
    if (!activeIds.has(old.id) && ['completed', 'superseded'].includes(old.status)) items.push(old);
  }
  return {
    schemaVersion: 2,
    analysisFingerprint: project.workspace?.fingerprint || null,
    generatedAt,
    revision: Number(previous?.revision || 0) + 1,
    items: items.slice(0, 100),
  };
}

function publicError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveRequirement(project, requirementId, { requirePending = false } = {}) {
  const requirements = project.requirements || deriveRequirements(project);
  const item = requirements.items.find((candidate) => candidate.id === String(requirementId || ''));
  if (!item || !REQUIREMENT_TYPES.has(item.type)) throw publicError('REQUIREMENT_NOT_FOUND', 'The requirement is no longer available. Refresh the analysis.');
  if (requirePending && item.status !== 'pending') throw publicError('REQUIREMENT_NOT_PENDING', 'This requirement is no longer waiting for review.');
  return { requirements, item };
}

function digestRegularFile(filePath, label, { parseJson = false } = {}) {
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw publicError('ACTION_PRECONDITION_FAILED', `${label} must be a regular file.`);
  if (stats.size > MAX_LOCKFILE_BYTES) throw publicError('ACTION_PRECONDITION_FAILED', `${label} is too large for a managed install.`);
  const content = fs.readFileSync(filePath);
  if (parseJson) {
    try {
      const parsed = JSON.parse(content.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    } catch {
      throw publicError('ACTION_PRECONDITION_FAILED', `${label} is not valid JSON.`);
    }
  }
  return crypto.createHash('sha256').update(content).digest('hex');
}

function installSnapshot(project, item) {
  const projectRoot = validateProjectCwd(project.path);
  const targetPath = path.resolve(projectRoot, item.relativePath === '.' ? '' : item.relativePath);
  if (!isSubPath(projectRoot, targetPath)) throw publicError('ACTION_PRECONDITION_FAILED', 'The dependency target is outside the project.');
  assertNoLinkedPath(projectRoot, targetPath);
  const packageJson = path.join(targetPath, 'package.json');
  const packageLock = path.join(targetPath, 'package-lock.json');
  for (const npmrc of new Set([path.join(projectRoot, '.npmrc'), path.join(targetPath, '.npmrc')])) {
    if (fs.existsSync(npmrc)) throw publicError('ACTION_PRECONDITION_FAILED', 'Managed install is unavailable when the project contains an .npmrc file.');
  }
  return {
    projectRoot: fs.realpathSync(projectRoot),
    targetPath: fs.realpathSync(targetPath),
    packageJson: digestRegularFile(packageJson, 'package.json', { parseJson: true }),
    packageLock: digestRegularFile(packageLock, 'package-lock.json', { parseJson: true }),
    requiredFreeBytes: Math.min(MAX_INSTALL_FREE_BYTES, Math.max(MIN_INSTALL_FREE_BYTES, fs.statSync(packageLock).size * 200)),
  };
}

function sameSnapshot(left, right) {
  return Boolean(left && right && Object.keys(left).every((key) => left[key] === right[key]));
}

function availableDiskBytes(targetPath) {
  if (typeof fs.statfsSync !== 'function') return null;
  try {
    const stats = fs.statfsSync(targetPath);
    return Number(BigInt(stats.bavail) * BigInt(stats.bsize));
  } catch {
    return null;
  }
}

function installDescriptor(project, item) {
  const targetPath = path.resolve(project.path, item.relativePath === '.' ? '' : item.relativePath);
  if (!isSubPath(project.path, targetPath)) throw publicError('ACTION_PRECONDITION_FAILED', 'The dependency target is outside the project.');
  assertNoLinkedPath(project.path, targetPath);
  const packageJson = path.join(targetPath, 'package.json');
  const packageLock = path.join(targetPath, 'package-lock.json');
  let supported = item.manager === 'npm' && path.posix.basename(item.detail?.lockfile || '') === 'package-lock.json' && fs.existsSync(packageJson) && fs.existsSync(packageLock);
  let snapshot = null;
  if (supported) {
    try { snapshot = installSnapshot(project, item); } catch { supported = false; }
  }
  const manualCommand = manualInstallCommand(item);
  return {
    supported,
    copyable: !supported && Boolean(manualCommand),
    actionType: supported ? 'INSTALL_NPM_DEPENDENCIES' : 'MANUAL_DEPENDENCY_INSTALL',
    display: supported
      ? { tool: 'npm', args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd: item.relativePath, requiredFreeBytes: snapshot.requiredFreeBytes }
      : { tool: manualCommand?.[0] || null, args: manualCommand?.slice(1) || null, cwd: item.relativePath },
    effects: { projectFilesMayChange: !supported, dependencyDirectoryMayChange: true, temporaryCacheMayChange: true, networkAccess: true, projectCodeMayExecute: !supported, appMetadataChanges: supported },
    reversible: 'partial',
    warning: supported ? 'LIFECYCLE_SCRIPTS_DISABLED' : 'MANUAL_ACTION_REQUIRED',
  };
}

function descriptorFor(project, item) {
  if (item.type === 'INSTALL_DEPENDENCIES') return installDescriptor(project, item);
  if (item.type === 'CONFIGURE_ENVIRONMENT') return { supported: false, actionType: 'MANUAL_ENVIRONMENT_SETUP', display: { names: item.detail.names }, effects: { projectFilesMayChange: true, dependencyDirectoryMayChange: false, temporaryCacheMayChange: false, networkAccess: false, projectCodeMayExecute: false, appMetadataChanges: false }, reversible: 'manual', warning: 'SECRET_VALUES_STAY_USER_OWNED' };
  if (item.type === 'REVIEW_PREVIEW') return { supported: false, actionType: 'OPEN_PREVIEW', destination: 'preview', display: {}, effects: { projectFilesMayChange: false, dependencyDirectoryMayChange: false, temporaryCacheMayChange: false, networkAccess: false, projectCodeMayExecute: true, appMetadataChanges: false }, reversible: 'not-applicable', warning: 'PROJECT_CODE_REQUIRES_SEPARATE_START' };
  return { supported: true, actionType: 'ACKNOWLEDGE_REQUIREMENT', display: {}, effects: { projectFilesMayChange: false, dependencyDirectoryMayChange: false, temporaryCacheMayChange: false, networkAccess: false, projectCodeMayExecute: false, appMetadataChanges: true }, reversible: 'yes', warning: null };
}

function publicPreview(requirementId, action, grantId, confirmationNonce) {
  return {
    schemaVersion: 1,
    requirementId,
    grantId,
    confirmationNonce,
    action: {
      supported: action.supported === true,
      copyable: action.copyable === true,
      destination: action.destination || null,
      actionType: action.actionType,
      display: {
        tool: action.display?.tool || null,
        args: Array.isArray(action.display?.args) ? [...action.display.args] : null,
        cwd: action.display?.cwd || null,
        names: Array.isArray(action.display?.names) ? action.display.names.slice(0, 100) : [],
        requiredFreeBytes: Number.isFinite(action.display?.requiredFreeBytes) ? action.display.requiredFreeBytes : null,
      },
      effects: {
        projectFilesMayChange: action.effects.projectFilesMayChange === true,
        dependencyDirectoryMayChange: action.effects.dependencyDirectoryMayChange === true,
        temporaryCacheMayChange: action.effects.temporaryCacheMayChange === true,
        networkAccess: action.effects.networkAccess === true,
        projectCodeMayExecute: action.effects.projectCodeMayExecute === true,
        appMetadataChanges: action.effects.appMetadataChanges === true,
      },
      warning: action.warning || null,
    },
  };
}

function requirementIpcError(error) {
  const result = { code: PUBLIC_ERROR_CODES.has(error?.code) ? error.code : 'REQUIREMENTS_FAILED' };
  if (result.code === 'ACTION_VERIFY_FAILED' && typeof error?.retryId === 'string') result.retry = { id: error.retryId, stage: 'verify-install' };
  return result;
}

function createRequirementsManager({ getProjectById, updateProject, analyze = analyzeWorkspace, runner = createDefaultRunner(), diskSpace = availableDiskBytes, now = Date.now, randomUUID = crypto.randomUUID, randomBytes = crypto.randomBytes, clipboard = null } = {}) {
  const grants = new Map();
  const retries = new Map();
  const active = new Map();
  const refreshes = new Map();
  const epochs = new Map();

  const requireProject = (projectId) => {
    const project = getProjectById?.(String(projectId || ''));
    if (!project) throw publicError('PROJECT_NOT_FOUND', 'The project is no longer registered.');
    validateProjectCwd(project.path);
    return project;
  };

  const list = (projectId) => {
    let project = requireProject(projectId);
    const requirements = project.requirements || deriveRequirements(project);
    if (!project.requirements) project = updateProject(project.id, (current) => ({ ...current, requirements }));
    return toRequirementsState(project, requirements);
  };

  const refresh = (projectId) => {
    const project = requireProject(projectId);
    if (active.has(project.id)) throw publicError('ACTION_BUSY', 'A requirement action is already running for this project.');
    if (refreshes.has(project.id)) return refreshes.get(project.id);
    const epoch = epochs.get(project.id) || 0;
    const operation = (async () => {
      const workspace = await analyze(project.path);
      if ((epochs.get(project.id) || 0) !== epoch) throw publicError('ACTION_CANCELLED', 'The requirements analysis was cancelled.');
      const current = requireProject(project.id);
      const requirements = deriveRequirements({ ...current, workspace }, current.requirements, now());
      const updated = updateProject(project.id, (latest) => ({ ...latest, workspace, requirements, onboarding: { ...latest.onboarding, status: workspace.readiness.status, recommendations: workspace.readiness.recommendations } }));
      return toRequirementsState(updated, requirements);
    })().finally(() => {
      if (refreshes.get(project.id) === operation) refreshes.delete(project.id);
    });
    refreshes.set(project.id, operation);
    return operation;
  };

  const preview = (projectId, requirementId) => {
    const project = requireProject(projectId);
    const { requirements, item } = resolveRequirement(project, requirementId, { requirePending: true });
    const action = descriptorFor(project, item);
    if (!action.supported) return publicPreview(item.id, action, null, null);
    for (const [id, grant] of grants) {
      if (grant.expiresAt <= now() || (grant.projectId === project.id && grant.requirementId === item.id)) grants.delete(id);
    }
    while (grants.size >= MAX_GRANTS) grants.delete(grants.keys().next().value);
    const grantId = randomUUID();
    const confirmationNonce = randomBytes(32).toString('base64url');
    const expiresAt = now() + ACTION_TTL_MS;
    const snapshot = action.actionType === 'INSTALL_NPM_DEPENDENCIES' ? installSnapshot(project, item) : null;
    grants.set(grantId, { projectId: project.id, requirementId: item.id, revision: requirements.revision, fingerprint: project.workspace?.fingerprint, actionType: action.actionType, confirmationNonce, expiresAt, snapshot });
    return publicPreview(item.id, action, grantId, confirmationNonce);
  };

  const markCompleted = (project, item, workspace = project.workspace) => {
    const previous = project.requirements || deriveRequirements(project);
    const completed = { ...item, status: 'completed', updatedAt: now() };
    const seeded = { ...previous, items: previous.items.map((candidate) => candidate.id === item.id ? completed : candidate) };
    return deriveRequirements({ ...project, workspace }, seeded, now());
  };

  const apply = async (grantId, confirmationNonce, onProgress = () => {}) => {
    const id = String(grantId || '');
    const grant = grants.get(id);
    grants.delete(id);
    if (!grant || grant.expiresAt <= now() || grant.confirmationNonce !== String(confirmationNonce || '')) throw publicError('ACTION_GRANT_INVALID', 'The action approval expired or is invalid. Review it again.');
    const project = requireProject(grant.projectId);
    const { requirements, item } = resolveRequirement(project, grant.requirementId, { requirePending: true });
    const startedAt = now();
    let progressPercent = 0;
    const progress = (stage, percent, estimate = null) => {
      progressPercent = percent;
      try { onProgress({ projectId: project.id, requirementId: item.id, stage, percent, startedAt, elapsedMs: Math.max(0, now() - startedAt), estimate }); } catch {}
    };
    progress('validating', 8);
    if (requirements.revision !== grant.revision || project.workspace?.fingerprint !== grant.fingerprint) throw publicError('ACTION_STALE', 'The project changed after this action was reviewed. Refresh requirements.');
    const action = descriptorFor(project, item);
    if (!action.supported || action.actionType !== grant.actionType) throw publicError('ACTION_NOT_SUPPORTED', 'This action can no longer be applied automatically.');

    if (action.actionType === 'ACKNOWLEDGE_REQUIREMENT') {
      progress('saving', 70);
      const acknowledged = item.type === 'CONFIRM_PROJECT_ROOT'
        ? { ...project, onboarding: { ...project.onboarding, acknowledgedLowConfidence: true } }
        : project;
      const nextRequirements = markCompleted(acknowledged, item);
      const updated = updateProject(project.id, (current) => {
        if (current.requirements?.revision !== requirements.revision) throw publicError('ACTION_STALE', 'The project changed after this action was reviewed. Refresh requirements.');
        return { ...current, onboarding: acknowledged.onboarding, requirements: nextRequirements };
      });
      progress('complete', 100);
      return toRequirementsState(updated, nextRequirements);
    }

    if (active.has(project.id) || refreshes.has(project.id)) throw publicError('ACTION_BUSY', 'Another requirement operation is already running for this project.');
    const controller = new AbortController();
    active.set(project.id, controller);
    let installCompleted = false;
    try {
      const before = await analyze(project.path);
      progress('preparing', 25);
      if (before.fingerprint !== grant.fingerprint) throw publicError('ACTION_STALE', 'The project changed after this action was reviewed. Refresh requirements.');
      const current = requireProject(project.id);
      if (current.requirements?.revision !== grant.revision || current.workspace?.fingerprint !== grant.fingerprint) throw publicError('ACTION_STALE', 'The project changed after this action was reviewed. Refresh requirements.');
      const snapshot = installSnapshot(current, item);
      if (!sameSnapshot(snapshot, grant.snapshot)) throw publicError('ACTION_STALE', 'The dependency files changed after this action was reviewed. Review it again.');
      const freeBytes = diskSpace(snapshot.targetPath);
      if (Number.isFinite(freeBytes) && freeBytes < snapshot.requiredFreeBytes) throw publicError('DISK_SPACE_LOW', 'There is not enough free disk space for a safe dependency installation.');
      const nullConfig = process.platform === 'win32' ? 'NUL' : '/dev/null';
      progress('installing', 45, { minSeconds: 60, maxSeconds: 300 });
      const result = await runner.run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: snapshot.targetPath, signal: controller.signal, timeout: 10 * 60 * 1000, env: { NPM_CONFIG_USERCONFIG: nullConfig, NPM_CONFIG_GLOBALCONFIG: nullConfig, NPM_CONFIG_IGNORE_SCRIPTS: 'true', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false', NPM_CONFIG_CACHE: path.join(os.tmpdir(), 'vibe-ide-npm-cache') } });
      if (!result?.success) throw publicError('ACTION_FAILED', 'Dependencies could not be installed with lifecycle scripts disabled.');
      installCompleted = true;
      progress('verifying', 85);
      const workspace = await analyze(project.path);
      const nextRequirements = markCompleted(project, item, workspace);
      if (nextRequirements.items.find((candidate) => candidate.id === item.id)?.status !== 'completed') throw publicError('ACTION_VERIFY_INCOMPLETE', 'Installed dependencies are still incomplete.');
      const updated = updateProject(project.id, (current) => ({ ...current, workspace, requirements: nextRequirements, onboarding: { ...current.onboarding, status: workspace.readiness.status, recommendations: workspace.readiness.recommendations } }));
      progress('complete', 100);
      return toRequirementsState(updated, nextRequirements);
    } catch (error) {
      progress('failed', progressPercent);
      if (installCompleted && error.code !== 'ACTION_VERIFY_INCOMPLETE') {
        const retryId = randomUUID();
        retries.set(retryId, { projectId: project.id, requirementId: item.id, expiresAt: now() + ACTION_TTL_MS });
        while (retries.size > MAX_GRANTS) retries.delete(retries.keys().next().value);
        const retryError = publicError('ACTION_VERIFY_FAILED', 'Dependencies were installed, but the result could not be verified.');
        retryError.retryId = retryId;
        throw retryError;
      }
      throw error;
    } finally {
      if (active.get(project.id) === controller) active.delete(project.id);
    }
  };

  const retry = async (retryId, onProgress = () => {}) => {
    const id = String(retryId || '');
    const retryGrant = retries.get(id);
    retries.delete(id);
    if (!retryGrant || retryGrant.expiresAt <= now()) throw publicError('ACTION_GRANT_INVALID', 'The verification retry expired.');
    const project = requireProject(retryGrant.projectId);
    const { item } = resolveRequirement(project, retryGrant.requirementId, { requirePending: true });
    const startedAt = now();
    const emit = (stage, percent) => {
      try { onProgress({ projectId: project.id, requirementId: item.id, stage, percent, startedAt, elapsedMs: Math.max(0, now() - startedAt), estimate: null }); } catch {}
    };
    try {
      emit('verifying', 70);
      const workspace = await analyze(project.path);
      const current = requireProject(project.id);
      const nextRequirements = markCompleted(current, item, workspace);
      if (nextRequirements.items.find((candidate) => candidate.id === item.id)?.status !== 'completed') throw publicError('ACTION_VERIFY_INCOMPLETE', 'Installed dependencies are still incomplete.');
      emit('saving', 90);
      const updated = updateProject(project.id, (latest) => ({ ...latest, workspace, requirements: nextRequirements, onboarding: { ...latest.onboarding, status: workspace.readiness.status, recommendations: workspace.readiness.recommendations } }));
      emit('complete', 100);
      return toRequirementsState(updated, nextRequirements);
    } catch (error) {
      emit('failed', 70);
      if (error.code === 'ACTION_VERIFY_INCOMPLETE') throw error;
      const nextRetryId = randomUUID();
      retries.set(nextRetryId, { ...retryGrant, expiresAt: now() + ACTION_TTL_MS });
      const retryError = publicError('ACTION_VERIFY_FAILED', 'The result could not be verified.');
      retryError.retryId = nextRetryId;
      throw retryError;
    }
  };

  const cancel = (grantId) => {
    const id = String(grantId || '');
    grants.delete(id);
    retries.delete(id);
    return { success: true };
  };

  const copyGuidance = (projectId, requirementId) => {
    const project = requireProject(projectId);
    const { item } = resolveRequirement(project, requirementId, { requirePending: true });
    const action = descriptorFor(project, item);
    if (item.type !== 'INSTALL_DEPENDENCIES' || action.supported || !action.copyable) throw publicError('GUIDANCE_UNAVAILABLE', 'There is no manual command for this requirement.');
    if (!clipboard?.writeText) throw publicError('CLIPBOARD_UNAVAILABLE', 'The clipboard is unavailable.');
    clipboard.writeText([action.display.tool, ...action.display.args].join(' '));
    return { success: true };
  };

  const cancelProject = (projectId) => {
    const id = String(projectId || '');
    epochs.set(id, (epochs.get(id) || 0) + 1);
    for (const [grantId, grant] of grants) if (grant.projectId === id) grants.delete(grantId);
    for (const [retryId, retryGrant] of retries) if (retryGrant.projectId === id) retries.delete(retryId);
    active.get(id)?.abort();
    return { success: true };
  };

  const cancelAll = () => {
    grants.clear();
    retries.clear();
    for (const projectId of refreshes.keys()) epochs.set(projectId, (epochs.get(projectId) || 0) + 1);
    for (const controller of active.values()) controller.abort();
    runner.terminateAll?.();
  };

  return { apply, cancel, cancelAll, cancelProject, copyGuidance, list, preview, refresh, retry };
}

function setupRequirementsHandlers(ipcMain, manager) {
  const handle = (channel, operation) => ipcMain.handle(channel, async (event, ...args) => {
    try { return { ok: true, data: await operation(event, ...args) }; }
    catch (error) { return { ok: false, error: requirementIpcError(error) }; }
  });
  handle('requirements:list', (_event, projectId) => manager.list(projectId));
  handle('requirements:refresh', (_event, projectId) => manager.refresh(projectId));
  handle('requirements:preview', (_event, projectId, requirementId) => manager.preview(projectId, requirementId));
  handle('requirements:apply', (event, grantId, confirmationNonce) => manager.apply(grantId, confirmationNonce, (progress) => event.sender.send('requirements:progress', progress)));
  handle('requirements:retry', (event, retryId) => manager.retry(retryId, (progress) => event.sender.send('requirements:progress', progress)));
  handle('requirements:cancel', (_event, grantId) => manager.cancel(grantId));
  handle('requirements:copy-guidance', (_event, projectId, requirementId) => manager.copyGuidance(projectId, requirementId));
}

module.exports = { ACTION_TTL_MS, createRequirementsManager, deriveRequirements, requirementIpcError, setupRequirementsHandlers };
