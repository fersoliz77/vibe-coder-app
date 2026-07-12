const fs = require('fs');
const path = require('path');
const { app } = require('electron');

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
  try {
    fs.writeFileSync(projectsFilePath, JSON.stringify(projects, null, 2));
  } catch (error) {
    console.error('Error saving projects:', error);
  }
}

function setupProjectHandlers(ipcMain) {
  ipcMain.handle('projects:list', () => {
    return getProjects();
  });

  ipcMain.handle('projects:add', (_, projectPath) => {
    const projects = getProjects();
    
    // Check if already exists
    const existingIndex = projects.findIndex(p => p.path === projectPath);
    if (existingIndex >= 0) {
      // Update last opened
      projects[existingIndex].lastOpened = Date.now();
      saveProjects(projects);
      return projects[existingIndex];
    }
    
    // Create new
    const newProject = {
      id: `proj_${Date.now()}`,
      name: path.basename(projectPath),
      path: projectPath,
      createdAt: Date.now(),
      lastOpened: Date.now()
    };
    
    projects.unshift(newProject);
    saveProjects(projects);
    return newProject;
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
};
