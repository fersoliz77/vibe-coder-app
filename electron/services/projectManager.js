const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { validateProjectCwd } = require('../ipc/fsGuards');

let projectsFilePath;

function initProjectManager() {
  const userDataPath = app.getPath('userData');
  projectsFilePath = path.join(userDataPath, 'projects.json');
  
  if (!fs.existsSync(projectsFilePath)) {
    fs.writeFileSync(projectsFilePath, JSON.stringify([]));
  }
}

function getProjects() {
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
  fs.writeFileSync(projectsFilePath, JSON.stringify(projects, null, 2));
}

function registerProject(projectPath, metadata = {}) {
  const canonicalPath = validateProjectCwd(projectPath);
  const projects = getProjects();
  const existingIndex = projects.findIndex((project) => normalizeProjectPath(project.path) === normalizeProjectPath(canonicalPath));
  if (existingIndex >= 0) {
    projects[existingIndex] = { ...projects[existingIndex], ...metadata, path: canonicalPath, lastOpened: Date.now() };
    saveProjects(projects);
    return projects[existingIndex];
  }
  const project = {
    id: `proj_${crypto.randomUUID()}`,
    name: metadata.name || path.basename(canonicalPath),
    path: canonicalPath,
    createdAt: Date.now(),
    lastOpened: Date.now(),
    ...metadata,
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

  ipcMain.handle('projects:import', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(getMainWindow?.(), { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return registerProject(result.filePaths[0]);
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
};
