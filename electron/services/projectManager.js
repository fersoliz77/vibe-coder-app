const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { validateProjectCwd } = require('../ipc/fsGuards');
const { writeJsonAtomic } = require('./atomicJson');
const { analyzeWorkspace } = require('./workspaceAnalyzer');
const { deriveRequirements } = require('./requirementsManager');
const { MAX_PROJECTS_FILE_BYTES, normalizeProjectRecord, toPublicImportAnalysis, toPublicProject } = require('./projectContracts');

let projectsFilePath;
let projectsBackupPath;
let projectsBeforeRepairPath;
let projectsCorruptPath;
let projectRecoveryState = null;
const importGrants = new Map();
const IMPORT_GRANT_TTL_MS = 10 * 60 * 1000;
const IMPORT_CHOICE_KEYS = new Set(['primaryTargetId', 'acknowledgeLowConfidence']);

function initProjectManager({ userDataPath = app.getPath('userData') } = {}) {
  projectRecoveryState = null;
  projectsFilePath = path.join(userDataPath, 'projects.json');
  projectsBackupPath = path.join(userDataPath, 'projects.backup.json');
  projectsBeforeRepairPath = path.join(userDataPath, 'projects.before-repair.json');
  projectsCorruptPath = path.join(userDataPath, 'projects.corrupt.json');

  if (!fs.existsSync(projectsFilePath)) {
    const recovered = recoverProjectsBackup();
    if (recovered) projectRecoveryState = { status: 'recovered', projectCount: recovered, occurredAt: Date.now() };
    else writeJsonAtomic(projectsFilePath, []);
  } else {
    try {
      const { projects, repaired, parsed } = readProjectsFile();
      if (repaired) {
        writeJsonAtomic(projectsBeforeRepairPath, parsed);
        saveProjects(projects, { createBackup: false });
        projectRecoveryState = { status: 'repaired', projectCount: projects.length, occurredAt: Date.now() };
      }
    } catch (error) {
      console.error('Project registry validation failed; recovery will be attempted.', error?.code || error?.name || 'UNKNOWN');
      try { fs.copyFileSync(projectsFilePath, projectsCorruptPath); } catch {}
      const recovered = recoverProjectsBackup();
      projectRecoveryState = { status: recovered ? 'recovered' : 'unavailable', projectCount: recovered || 0, occurredAt: Date.now() };
    }
  }
}

function readProjectsFile(filePath = projectsFilePath) {
  const data = fs.readFileSync(filePath, 'utf-8');
  if (Buffer.byteLength(data) > MAX_PROJECTS_FILE_BYTES) throw new Error('projects.json exceeds the safe size limit.');
  const parsed = JSON.parse(data);
  if (!Array.isArray(parsed)) throw new Error('projects.json must contain a project list.');
  const projects = parsed.map(normalizeProjectRecord).filter(Boolean);
  return { projects, parsed, repaired: JSON.stringify(projects) !== JSON.stringify(parsed) };
}

function recoverProjectsBackup() {
  if (!projectsBackupPath || !fs.existsSync(projectsBackupPath)) return false;
  try {
    const { projects } = readProjectsFile(projectsBackupPath);
    writeJsonAtomic(projectsFilePath, projects);
    return projects.length;
  } catch (error) {
    console.error('Project registry backup recovery failed.', error?.code || error?.name || 'UNKNOWN');
    return false;
  }
}

function getProjectRecoveryState() {
  return projectRecoveryState ? { ...projectRecoveryState } : null;
}

function acknowledgeProjectRecovery() {
  projectRecoveryState = null;
  return { success: true };
}

function getProjects() {
  if (!projectsFilePath) return [];
  try {
    return readProjectsFile().projects;
  } catch (error) {
    console.error('Project registry could not be read.', error?.code || error?.name || 'UNKNOWN');
    return [];
  }
}

function normalizeProjectPath(projectPath) {
  const resolved = path.resolve(String(projectPath || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isProjectRegistered(projectPath) {
  const normalizedTarget = normalizeProjectPath(projectPath);
  return getProjects().some((project) => normalizeProjectPath(project.path) === normalizedTarget);
}

function saveProjects(projects, { createBackup = true } = {}) {
  if (createBackup && projectsBackupPath && fs.existsSync(projectsFilePath)) {
    try {
      const previous = readProjectsFile().projects;
      writeJsonAtomic(projectsBackupPath, previous);
    } catch {}
  }
  writeJsonAtomic(projectsFilePath, projects);
}

function safeProjectMetadata(metadata = {}) {
  const allowed = [
    'name', 'slug', 'type', 'stack', 'backend', 'repositoryVisibility', 'deploymentProvider', 'provisioningStatus',
    'origin', 'registeredAt', 'primaryTargetId', 'workspace', 'onboarding', 'requirements',
  ];
  return Object.fromEntries(allowed.filter((key) => metadata[key] !== undefined).map((key) => [key, metadata[key]]));
}

function createImportPlan(analysis, choices, { randomUUID = crypto.randomUUID, now = Date.now } = {}) {
  if (!choices || typeof choices !== 'object' || Array.isArray(choices) || Object.keys(choices).some((key) => !IMPORT_CHOICE_KEYS.has(key))) {
    throw new Error('The import choices are invalid.');
  }
  const primary = analysis?.targets?.find((target) => target.id === choices.primaryTargetId);
  if (!primary) throw new Error('Choose a detected application before continuing.');
  if (analysis.projectAssessment?.requiresAcknowledgement && choices.acknowledgeLowConfidence !== true) {
    throw new Error('Confirm that this is the folder you want to use before continuing.');
  }
  const operations = [
    { id: 'register-project', type: 'register-project', risk: 'local-metadata', required: true, selected: true, effects: ['project-registry'] },
    { id: 'save-workspace-map', type: 'save-workspace-map', risk: 'local-metadata', required: true, selected: true, effects: ['detected-targets', 'readiness-profile'] },
    primary.capabilities.webPreview || primary.capabilities.androidPreview
      ? { id: 'configure-preview', type: 'configure-preview', risk: 'local-metadata', required: true, selected: true, effects: ['managed-preview-profile'] }
      : { id: 'record-preview-gap', type: 'record-preview-gap', risk: 'none', required: true, selected: true, effects: ['setup-recommendation'] },
  ];
  if (analysis.readiness?.recommendations?.length) operations.push({ id: 'record-next-actions', type: 'record-next-actions', risk: 'none', required: true, selected: true, effects: analysis.readiness.recommendations });
  return {
    schemaVersion: 1,
    planId: randomUUID(),
    analysisFingerprint: analysis.fingerprint,
    createdAt: now(),
    choices: { primaryTargetId: primary.id, acknowledgeLowConfidence: choices.acknowledgeLowConfidence === true },
    operations,
    guarantees: { sourceFilesChanged: false, commandsExecuted: false, networkAccess: false, secretsStored: false },
  };
}

function registerProject(projectPath, metadata = {}) {
  const canonicalPath = validateProjectCwd(projectPath);
  const safeMetadata = safeProjectMetadata(metadata);
  const projects = getProjects();
  const existingIndex = projects.findIndex((project) => normalizeProjectPath(project.path) === normalizeProjectPath(canonicalPath));
  if (existingIndex >= 0) {
    projects[existingIndex] = normalizeProjectRecord({ ...projects[existingIndex], ...safeMetadata, path: canonicalPath, lastOpened: Date.now() });
    if (!projects[existingIndex]) throw new Error('The project metadata is invalid.');
    saveProjects(projects);
    return projects[existingIndex];
  }
  const project = {
    id: `proj_${crypto.randomUUID()}`,
    name: safeMetadata.name || path.basename(canonicalPath),
    path: canonicalPath,
    createdAt: Date.now(),
    lastOpened: Date.now(),
    ...safeMetadata,
  };
  const normalizedProject = normalizeProjectRecord(project);
  if (!normalizedProject) throw new Error('The project metadata is invalid.');
  projects.unshift(normalizedProject);
  saveProjects(projects);
  return normalizedProject;
}

function getProjectById(projectId) {
  return getProjects().find((project) => project.id === String(projectId || '')) || null;
}

function updateProject(projectId, updater) {
  if (typeof updater !== 'function') throw new Error('A trusted project update is required.');
  const projects = getProjects();
  const index = projects.findIndex((project) => project.id === String(projectId || ''));
  if (index < 0) throw new Error('The project is no longer registered.');
  const updated = normalizeProjectRecord(updater({ ...projects[index] }));
  if (!updated || updated.id !== projects[index].id || normalizeProjectPath(updated.path) !== normalizeProjectPath(projects[index].path)) {
    throw new Error('The project update is invalid.');
  }
  projects[index] = updated;
  saveProjects(projects);
  return updated;
}

function setupProjectHandlers(ipcMain, getMainWindow, {
  now = Date.now,
  randomUUID = crypto.randomUUID,
  analyzeImport = analyzeWorkspace,
  validateImportPath = validateProjectCwd,
  isImportedProjectRegistered = isProjectRegistered,
  registerImportedProject = registerProject,
  chooseImportDirectory = async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(getMainWindow?.(), { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths?.[0] || null;
  },
  onProjectRemoved = () => {},
} = {}) {
  ipcMain.handle('projects:list', () => {
    return getProjects().map((project) => toPublicProject(project));
  });

  ipcMain.handle('projects:get-recovery-state', () => getProjectRecoveryState());
  ipcMain.handle('projects:acknowledge-recovery', () => acknowledgeProjectRecovery());

  ipcMain.handle('projects:add', (_, projectPath) => {
    return toPublicProject(registerProject(projectPath));
  });

  ipcMain.handle('projects:choose-import', async () => {
    const selectedPath = await chooseImportDirectory();
    if (!selectedPath) return null;
    const projectPath = validateImportPath(selectedPath);
    const id = randomUUID();
    importGrants.set(id, { projectPath, expiresAt: now() + IMPORT_GRANT_TTL_MS, analysis: null, plan: null });
    return { id, name: path.basename(projectPath), path: projectPath };
  });

  ipcMain.handle('projects:analyze-import', async (_, grantId) => {
    const grant = importGrants.get(String(grantId || ''));
    if (!grant || grant.expiresAt <= now()) {
      importGrants.delete(String(grantId || ''));
      throw new Error('The import permission expired. Choose the folder again.');
    }
    grant.analysis = await analyzeImport(grant.projectPath);
    grant.plan = null;
    return toPublicImportAnalysis(grant.analysis);
  });

  ipcMain.handle('projects:plan-import', (_, grantId, choices) => {
    const id = String(grantId || '');
    const grant = importGrants.get(id);
    if (!grant || grant.expiresAt <= now() || !grant.analysis) throw new Error('Analyze the workspace again before preparing its setup.');
    grant.plan = createImportPlan(grant.analysis, choices, { randomUUID, now });
    return grant.plan;
  });

  ipcMain.handle('projects:confirm-import', async (_, grantId, planId) => {
    const id = String(grantId || '');
    const grant = importGrants.get(id);
    if (!grant || grant.expiresAt <= now() || !grant.analysis || !grant.plan || grant.plan.planId !== String(planId || '')) throw new Error('Review the current setup plan before importing the workspace.');
    validateImportPath(grant.projectPath);
    const currentAnalysis = await analyzeImport(grant.projectPath);
    if (currentAnalysis.fingerprint !== grant.plan.analysisFingerprint) {
      grant.analysis = currentAnalysis;
      grant.plan = null;
      const error = new Error('The workspace changed after it was reviewed. Analyze it again before importing.');
      error.code = 'IMPORT_PLAN_STALE';
      throw error;
    }
    const primary = currentAnalysis.targets.find((target) => target.id === grant.plan.choices.primaryTargetId);
    if (!primary) throw new Error('The selected application is no longer available.');
    const type = primary.kind === 'flutter' ? 'mobile-suite' : primary.framework === 'Next.js' ? 'next-ts' : primary.capabilities.webPreview ? 'vite-react-ts' : 'external';
    const alreadyRegistered = isImportedProjectRegistered(grant.projectPath);
    const existingProject = getProjects().find((item) => normalizeProjectPath(item.path) === normalizeProjectPath(grant.projectPath)) || null;
    const onboarding = {
      schemaVersion: 1,
      status: currentAnalysis.readiness.status,
      appliedAt: now(),
      acknowledgedLowConfidence: grant.plan.choices.acknowledgeLowConfidence || existingProject?.onboarding?.acknowledgedLowConfidence === true,
      plan: grant.plan.operations.map((operation) => ({ id: operation.id, type: operation.type, status: operation.type === 'record-next-actions' ? 'recorded' : 'applied' })),
      recommendations: currentAnalysis.readiness.recommendations,
      guarantees: grant.plan.guarantees,
    };
    const projectSeed = {
      id: existingProject?.id || 'pending-import',
      path: grant.projectPath,
      primaryTargetId: primary.id,
      workspace: currentAnalysis,
      onboarding,
    };
    const project = registerImportedProject(grant.projectPath, {
      name: currentAnalysis.name,
      type,
      stack: { primary: primary.framework || primary.kind, targets: currentAnalysis.targets.length },
      backend: currentAnalysis.services.includes('Supabase') ? 'supabase' : currentAnalysis.services.includes('Firebase') ? 'firebase' : undefined,
      origin: 'imported',
      registeredAt: now(),
      primaryTargetId: primary.id,
      workspace: currentAnalysis,
      onboarding,
      requirements: deriveRequirements(projectSeed, existingProject?.requirements || null, now()),
    });
    importGrants.delete(id);
    return { project: toPublicProject(project), alreadyRegistered, operations: grant.plan.operations.map((operation) => ({ id: operation.id, status: 'applied' })) };
  });

  ipcMain.handle('projects:cancel-import', (_, grantId) => {
    importGrants.delete(String(grantId || ''));
    return { success: true };
  });

  ipcMain.handle('projects:remove', (_, projectId) => {
    onProjectRemoved(String(projectId || ''));
    let projects = getProjects();
    projects = projects.filter(p => p.id !== projectId);
    saveProjects(projects);
    return { success: true };
  });

  ipcMain.handle('projects:update-last-opened', (_, projectId) => {
    const projects = getProjects();
    const index = projects.findIndex(p => p.id === projectId);
    if (index >= 0) {
      projects[index].lastOpened = Date.now();
      saveProjects(projects);
    }
    return { success: true, project: index >= 0 ? toPublicProject(projects[index]) : null };
  });
}

module.exports = {
  initProjectManager,
  setupProjectHandlers,
  getProjects,
  isProjectRegistered,
  registerProject,
  getProjectById,
  updateProject,
  safeProjectMetadata,
  createImportPlan,
  getProjectRecoveryState,
  acknowledgeProjectRecovery,
  normalizeProjectRecord,
  toPublicProject,
};
