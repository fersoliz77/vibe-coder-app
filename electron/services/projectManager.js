const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { validateProjectCwd } = require('../ipc/fsGuards');
const { writeJsonAtomic } = require('./atomicJson');
const { analyzeWorkspace } = require('./workspaceAnalyzer');

let projectsFilePath;
const importGrants = new Map();
const IMPORT_GRANT_TTL_MS = 10 * 60 * 1000;

function initProjectManager() {
  const userDataPath = app.getPath('userData');
  projectsFilePath = path.join(userDataPath, 'projects.json');
  
  if (!fs.existsSync(projectsFilePath)) {
    writeJsonAtomic(projectsFilePath, []);
  }
}

function getProjects() {
  if (!projectsFilePath) return [];
  try {
    const data = fs.readFileSync(projectsFilePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading projects:', error);
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

function saveProjects(projects) {
  writeJsonAtomic(projectsFilePath, projects);
}

function safeProjectMetadata(metadata = {}) {
  const allowed = [
    'name', 'slug', 'type', 'stack', 'backend', 'repositoryVisibility', 'deploymentProvider', 'provisioningStatus',
    'origin', 'registeredAt', 'primaryTargetId', 'workspace',
  ];
  return Object.fromEntries(allowed.filter((key) => metadata[key] !== undefined).map((key) => [key, metadata[key]]));
}

function registerProject(projectPath, metadata = {}) {
  const canonicalPath = validateProjectCwd(projectPath);
  const safeMetadata = safeProjectMetadata(metadata);
  const projects = getProjects();
  const existingIndex = projects.findIndex((project) => normalizeProjectPath(project.path) === normalizeProjectPath(canonicalPath));
  if (existingIndex >= 0) {
    projects[existingIndex] = { ...projects[existingIndex], ...safeMetadata, path: canonicalPath, lastOpened: Date.now() };
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
  projects.unshift(project);
  saveProjects(projects);
  return project;
}

function setupProjectHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('projects:list', () => {
    return getProjects();
  });

  ipcMain.handle('projects:add', (_, projectPath) => {
    return registerProject(projectPath);
  });

  ipcMain.handle('projects:choose-import', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(getMainWindow?.(), { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths?.[0]) return null;
    const projectPath = validateProjectCwd(result.filePaths[0]);
    const id = crypto.randomUUID();
    importGrants.set(id, { projectPath, expiresAt: Date.now() + IMPORT_GRANT_TTL_MS, analysis: null });
    return { id, name: path.basename(projectPath), path: projectPath };
  });

  ipcMain.handle('projects:analyze-import', async (_, grantId) => {
    const grant = importGrants.get(String(grantId || ''));
    if (!grant || grant.expiresAt <= Date.now()) {
      importGrants.delete(String(grantId || ''));
      throw new Error('The import permission expired. Choose the folder again.');
    }
    grant.analysis = await analyzeWorkspace(grant.projectPath);
    return grant.analysis;
  });

  ipcMain.handle('projects:confirm-import', (_, grantId, primaryTargetId) => {
    const id = String(grantId || '');
    const grant = importGrants.get(id);
    importGrants.delete(id);
    if (!grant || grant.expiresAt <= Date.now() || !grant.analysis) throw new Error('Analyze the workspace again before importing it.');
    const primary = grant.analysis.targets.find((target) => target.id === primaryTargetId);
    if (!primary) throw new Error('Choose a detected application before importing the workspace.');
    validateProjectCwd(grant.projectPath);
    const type = primary.kind === 'flutter' ? 'mobile-suite' : primary.framework === 'Next.js' ? 'next-ts' : primary.capabilities.webPreview ? 'vite-react-ts' : 'external';
    const alreadyRegistered = isProjectRegistered(grant.projectPath);
    const project = registerProject(grant.projectPath, {
      name: grant.analysis.name,
      type,
      stack: { primary: primary.framework || primary.kind, targets: grant.analysis.targets.length },
      backend: grant.analysis.services.includes('Supabase') ? 'supabase' : grant.analysis.services.includes('Firebase') ? 'firebase' : undefined,
      origin: 'imported',
      registeredAt: Date.now(),
      primaryTargetId: primary.id,
      workspace: grant.analysis,
    });
    return { project, alreadyRegistered };
  });

  ipcMain.handle('projects:cancel-import', (_, grantId) => {
    importGrants.delete(String(grantId || ''));
    return { success: true };
  });

  ipcMain.handle('projects:remove', (_, projectId) => {
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
    return { success: true };
  });
}

module.exports = {
  initProjectManager,
  setupProjectHandlers,
  getProjects,
  isProjectRegistered,
  registerProject,
  safeProjectMetadata,
};
