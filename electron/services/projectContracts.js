const path = require('path');

const PROJECT_FIELDS = [
  'name', 'slug', 'type', 'stack', 'backend', 'repositoryVisibility', 'deploymentProvider', 'provisioningStatus',
  'origin', 'registeredAt', 'primaryTargetId', 'workspace', 'onboarding', 'requirements',
];
const REQUIREMENT_TYPES = new Set(['INSTALL_DEPENDENCIES', 'CONFIGURE_ENVIRONMENT', 'REVIEW_PREVIEW', 'REVIEW_PARTIAL_SCAN', 'CONFIRM_PROJECT_ROOT']);
const REQUIREMENT_STATUSES = new Set(['pending', 'deferred', 'dismissed', 'completed', 'superseded']);
const REQUIREMENT_SEVERITIES = new Set(['blocking', 'advisory']);
const INSTALL_STATES = new Set(['install-needed', 'appears-installed', 'not-required']);
const MAX_PROJECT_JSON_BYTES = 8 * 1024 * 1024;
const MAX_PROJECTS_FILE_BYTES = 32 * 1024 * 1024;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const safeString = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\0\r\n]/.test(value);
const safeOptionalString = (value, max = 256) => value == null || safeString(value, max);
const safeTimestamp = (value) => value == null || (Number.isFinite(value) && value >= 0);

function safeRelativePath(value) {
  if (value === '.') return true;
  if (!safeString(value, 1024) || value.includes('\\') || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '..' && !normalized.startsWith('../');
}

function boundedClone(value) {
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > MAX_PROJECT_JSON_BYTES) return null;
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function normalizeWorkspace(value) {
  if (!isObject(value) || ![2, 3].includes(value.schemaVersion) || !/^[a-f0-9]{64}$/.test(String(value.fingerprint || ''))) return undefined;
  if (!Array.isArray(value.targets) || value.targets.length < 1 || value.targets.length > 256) return undefined;
  if (!value.targets.every((target) => isObject(target) && safeString(target.id, 160) && safeRelativePath(target.relativePath) && safeString(target.kind, 80))) return undefined;
  if (!Array.isArray(value.dependencies) || value.dependencies.length > 256 || !value.dependencies.every((dependency) => {
    if (!isObject(dependency) || !safeOptionalString(dependency.targetId, 160) || !INSTALL_STATES.has(dependency.installState)) return false;
    if (value.schemaVersion < 3 || dependency.ecosystem !== 'npm' || dependency.installState === 'not-required') return true;
    const scope = dependency.installScope;
    return isObject(scope)
      && safeRelativePath(scope.relativePath)
      && safeOptionalString(scope.workspaceRoot, 1024)
      && safeOptionalString(scope.manager, 20)
      && safeOptionalString(scope.lockfile, 1024);
  })) return undefined;
  if (!Array.isArray(value.packageManagerDetails) || value.packageManagerDetails.length > 256 || !value.packageManagerDetails.every((item) => isObject(item) && safeString(item.manager, 20) && safeRelativePath(item.path))) return undefined;
  if (!isObject(value.readiness) || !safeString(value.readiness.status, 80) || !Array.isArray(value.readiness.recommendations) || !Array.isArray(value.readiness.missingEnvironment)) return undefined;
  return boundedClone(value) || undefined;
}

function normalizeRequirements(value) {
  if (!isObject(value) || ![1, 2].includes(value.schemaVersion) || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Array.isArray(value.items) || value.items.length > 100) return undefined;
  const items = [];
  for (const item of value.items) {
    if (!isObject(item) || !safeString(item.id, 80) || !REQUIREMENT_TYPES.has(item.type) || !REQUIREMENT_STATUSES.has(item.status) || !REQUIREMENT_SEVERITIES.has(item.severity) || !safeRelativePath(item.relativePath)) return undefined;
    const names = Array.isArray(item.detail?.names) ? item.detail.names : [];
    if (names.length > 100 || !names.every((name) => /^[A-Z_][A-Z0-9_]{1,127}$/.test(name))) return undefined;
    const targetIds = Array.isArray(item.detail?.targetIds) ? item.detail.targetIds : [];
    if (targetIds.length > 256 || !targetIds.every((id) => safeString(id, 160))) return undefined;
    items.push({
      id: item.id,
      type: item.type,
      status: item.status,
      severity: item.severity,
      actionMode: safeOptionalString(item.actionMode, 20) ? item.actionMode : undefined,
      targetId: safeOptionalString(item.targetId, 160) ? item.targetId : null,
      relativePath: item.relativePath,
      manager: safeOptionalString(item.manager, 20) ? item.manager : null,
      detail: {
        manager: safeOptionalString(item.detail?.manager, 20) ? item.detail.manager : null,
        managerVersion: safeOptionalString(item.detail?.managerVersion, 40) ? item.detail.managerVersion : null,
        lockfile: safeOptionalString(item.detail?.lockfile, 1024) ? item.detail.lockfile : null,
        count: Number.isSafeInteger(item.detail?.count) && item.detail.count >= 0 ? item.detail.count : undefined,
        names,
        targetIds,
      },
      updatedAt: safeTimestamp(item.updatedAt) ? item.updatedAt : undefined,
    });
  }
  return {
    schemaVersion: value.schemaVersion,
    analysisFingerprint: /^[a-f0-9]{64}$/.test(String(value.analysisFingerprint || '')) ? value.analysisFingerprint : null,
    generatedAt: safeTimestamp(value.generatedAt) ? value.generatedAt : undefined,
    revision: value.revision,
    items,
  };
}

function normalizeProjectRecord(value) {
  if (!isObject(value) || !safeString(value.id, 160) || !safeString(value.name, 200) || !safeString(value.path, 32767) || !path.isAbsolute(value.path)) return null;
  const projectPath = path.resolve(value.path);
  if (projectPath === path.parse(projectPath).root) return null;
  const workspace = value.workspace === undefined ? undefined : normalizeWorkspace(value.workspace);
  const requirements = value.requirements === undefined ? undefined : normalizeRequirements(value.requirements);
  const project = {
    id: value.id,
    name: value.name,
    path: projectPath,
    createdAt: safeTimestamp(value.createdAt) ? value.createdAt : undefined,
    lastOpened: safeTimestamp(value.lastOpened) ? value.lastOpened : undefined,
  };
  for (const key of PROJECT_FIELDS) {
    if (['name', 'workspace', 'requirements'].includes(key) || value[key] === undefined) continue;
    const cloned = boundedClone(value[key]);
    if (cloned !== null) project[key] = cloned;
  }
  if (workspace) project.workspace = workspace;
  if (requirements && workspace) project.requirements = requirements;
  return project;
}

function toPublicRequirements(requirements) {
  return {
    items: (requirements?.items || []).slice(0, 100).map((item) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      severity: item.severity,
      relativePath: item.relativePath,
      detail: {
        count: Number.isSafeInteger(item.detail?.count) ? item.detail.count : 0,
        names: Array.isArray(item.detail?.names) ? item.detail.names.slice(0, 100) : [],
      },
    })),
  };
}

function toPublicWorkspace(workspace) {
  if (!workspace) return undefined;
  return {
    analyzedAt: Number.isFinite(workspace.analyzedAt) ? workspace.analyzedAt : null,
    targets: (workspace.targets || []).slice(0, 256).map((target) => ({
      id: target.id,
      name: target.name,
      kind: target.kind,
      framework: target.framework || null,
      technologies: Array.isArray(target.technologies) ? target.technologies.slice(0, 16) : [],
    })),
  };
}

function toPublicProject(project, requirements = project?.requirements) {
  if (!project) return null;
  const result = {};
  for (const key of ['id', 'name', 'path', 'type', 'backend', 'repositoryVisibility', 'provisioningStatus', 'origin', 'registeredAt', 'createdAt', 'lastOpened', 'primaryTargetId']) {
    if (project[key] !== undefined) result[key] = boundedClone(project[key]);
  }
  const workspace = toPublicWorkspace(project.workspace);
  if (workspace) result.workspace = workspace;
  if (requirements) result.requirements = toPublicRequirements(requirements);
  return result;
}

function toPublicImportAnalysis(analysis) {
  return {
    layout: analysis.layout,
    recommendedTargetId: analysis.recommendedTargetId,
    projectAssessment: {
      classification: analysis.projectAssessment?.classification,
      score: analysis.projectAssessment?.score,
      requiresAcknowledgement: analysis.projectAssessment?.requiresAcknowledgement === true,
    },
    readiness: {
      status: analysis.readiness?.status,
      checks: (analysis.readiness?.checks || []).map((check) => ({ id: check.id, status: check.status, count: check.count || 0 })),
      recommendations: [...(analysis.readiness?.recommendations || [])],
    },
    targets: (analysis.targets || []).map((target) => ({
      id: target.id,
      name: target.name,
      relativePath: target.relativePath,
      kind: target.kind,
      framework: target.framework || null,
      language: target.language || null,
      confidence: target.confidence,
      capabilities: {
        webPreview: target.capabilities?.webPreview === true,
        androidPreview: target.capabilities?.androidPreview === true,
      },
    })),
    products: (analysis.products || []).slice(0, 128).map((product) => ({
      id: product.id,
      name: product.name,
      relativePath: product.relativePath,
      role: product.role,
      platforms: [...(product.platforms || [])],
      technologies: [...(product.technologies || [])],
      targetIds: [...(product.targetIds || [])],
      primaryTargetId: product.primaryTargetId || null,
      previewable: product.previewable === true,
    })),
    packageManagers: [...(analysis.packageManagers || [])],
    workspaceSignals: [...(analysis.workspaceSignals || [])],
    services: [...(analysis.services || [])],
    warnings: (analysis.warnings || []).map((warning) => ({ code: warning.code })),
    dependencies: (analysis.dependencies || []).map((dependency) => ({
      installState: dependency.installState,
      groups: (dependency.groups || []).map((group) => ({ name: group.name, count: group.count })),
    })),
    scripts: (analysis.scripts || []).map((script) => ({ name: script.name })),
    environment: { names: (analysis.environment?.names || []).map((item) => ({ name: item.name })) },
    runtimes: (analysis.runtimes || []).map((runtime) => ({ runtime: runtime.runtime })),
    git: { detected: analysis.git?.detected === true },
    integrations: (analysis.integrations || []).map((integration) => ({ name: integration.name })),
  };
}

/*
 * El progreso sale mientras el analisis corre, asi que pasa por el mismo filtro
 * que el resultado: solo rutas relativas, contadores acotados y nombres de
 * aplicacion. Nada de rutas absolutas ni contenido de archivos.
 */
function toPublicImportProgress(grantId, progress) {
  const counter = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  return {
    grantId: String(grantId || ''),
    phase: progress?.phase === 'summarizing' ? 'summarizing' : 'scanning',
    directory: safeRelativePath(progress?.directory) ? progress.directory : null,
    entriesVisited: counter(progress?.entriesVisited),
    filesRead: counter(progress?.filesRead),
    foundCount: counter(progress?.foundCount),
    found: (Array.isArray(progress?.found) ? progress.found : []).slice(0, 12).map((name) => String(name).slice(0, 100)),
    elapsedMs: counter(progress?.elapsedMs),
  };
}

function toRequirementsState(project, requirements) {
  return {
    schemaVersion: 1,
    projectId: project.id,
    projectPatch: {
      primaryTargetId: project.primaryTargetId || null,
      workspace: toPublicWorkspace(project.workspace),
      requirements: toPublicRequirements(requirements),
    },
  };
}

module.exports = {
  MAX_PROJECT_JSON_BYTES,
  MAX_PROJECTS_FILE_BYTES,
  normalizeProjectRecord,
  normalizeRequirements,
  normalizeWorkspace,
  toPublicProject,
  toPublicImportAnalysis,
  toPublicImportProgress,
  toPublicRequirements,
  toPublicWorkspace,
  toRequirementsState,
};
