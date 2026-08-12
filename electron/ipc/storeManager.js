const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../services/atomicJson');
const { toPublicProject } = require('../services/projectContracts');

function purgeLegacyChatHistory(data) {
  const next = { ...data };
  for (const key of Object.keys(next)) {
    if (key.startsWith('chat:')) delete next[key];
  }
  return next;
}

function sanitizeFavoriteProjectIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === 'string').map((id) => id.trim()).filter((id) => id && id.length <= 160))].slice(0, 200);
}

function isSafeRelativeTabPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.startsWith('/') && !/[\\:\0-\x1f]/.test(value)
    && value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function sanitizeExplorerTabManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) return null;
  if (Object.keys(value).some((key) => !['version', 'tabs', 'panes', 'splitView'].includes(key))) return null;
  const tabs = [...new Set((Array.isArray(value.tabs) ? value.tabs : []).filter(isSafeRelativeTabPath))].slice(0, 100);
  const splitView = value.splitView === true;
  const pane = (name) => typeof value.panes?.[name] === 'string' && tabs.includes(value.panes[name]) ? value.panes[name] : null;
  return { version: 1, tabs, panes: { primary: pane('primary'), secondary: splitView ? pane('secondary') : null }, splitView };
}

function sanitizeStoredConfig(data) {
  const next = purgeLegacyChatHistory(data);
  for (const key of Object.keys(next)) {
    if (key.startsWith('fileExplorerState:')) delete next[key];
    if (key.startsWith('fileExplorerTabs:')) {
      const projectId = key.slice('fileExplorerTabs:'.length);
      const manifest = projectId && projectId.length <= 160 ? sanitizeExplorerTabManifest(next[key]) : null;
      if (manifest) next[key] = manifest; else delete next[key];
    }
  }
  const validProject = (project) => project && typeof project.id === 'string' && typeof project.name === 'string' && typeof project.path === 'string' && path.isAbsolute(project.path);
  if (next.currentProject !== undefined) {
    if (validProject(next.currentProject)) next.currentProject = toPublicProject(next.currentProject);
    else delete next.currentProject;
  }
  if (next.recentProjects !== undefined) {
    next.recentProjects = Array.isArray(next.recentProjects) ? next.recentProjects.filter(validProject).slice(0, 10).map((project) => toPublicProject(project)) : [];
  }
  if (next.favoriteProjectIds !== undefined) next.favoriteProjectIds = sanitizeFavoriteProjectIds(next.favoriteProjectIds);
  return next;
}

function sanitizeStoredValue(key, value) {
  if (key === 'currentProject') return sanitizeStoredConfig({ currentProject: value }).currentProject || null;
  if (key === 'recentProjects') return sanitizeStoredConfig({ recentProjects: value }).recentProjects;
  if (key === 'favoriteProjectIds') return sanitizeFavoriteProjectIds(value);
  if (key.startsWith('fileExplorerTabs:')) return sanitizeExplorerTabManifest(value);
  return value;
}

class StoreManager {
  constructor() {
    // userData maps to %APPDATA%/vibe-ide-coder on Windows
    this.storePath = path.join(app.getPath('userData'), 'config.json');
    this.data = this.readData();
  }

  readData() {
    let parsed;
    try {
      if (fs.existsSync(this.storePath)) {
        const fileContent = fs.readFileSync(this.storePath, 'utf8');
        parsed = JSON.parse(fileContent);
      }
    } catch (error) {
      console.error('Error reading config.json:', error);
      return {};
    }
    if (!parsed) return {};

    const data = sanitizeStoredConfig(parsed);
    if (JSON.stringify(data) !== JSON.stringify(parsed)) {
      try {
        this.writeData(data);
      } catch (error) {
        console.error('Error removing legacy chat history:', error);
      }
    }
    return data;
  }

  writeData(data) {
    writeJsonAtomic(this.storePath, data);
  }

  get(key, defaultValue = null) {
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }

  set(key, value) {
    const next = { ...this.data, [key]: sanitizeStoredValue(key, value) };
    this.writeData(next);
    this.data = next;
  }

  delete(key) {
    const next = { ...this.data };
    delete next[key];
    this.writeData(next);
    this.data = next;
  }

  getAll() {
    return this.data;
  }
}

let store;

function setupStoreHandlers() {
  store = new StoreManager();

  ipcMain.handle('store:get', (event, key, defaultValue) => {
    return store.get(key, defaultValue);
  });

  ipcMain.handle('store:set', (event, key, value) => {
    store.set(key, value);
    return true;
  });

  ipcMain.handle('store:delete', (event, key) => {
    store.delete(key);
    return true;
  });

  ipcMain.handle('store:getAll', () => {
    return store.getAll();
  });
}

function getStore() {
  if (!store) store = new StoreManager();
  return store;
}

module.exports = {
  setupStoreHandlers,
  getStore,
  purgeLegacyChatHistory,
  sanitizeStoredConfig,
  sanitizeStoredValue,
  sanitizeFavoriteProjectIds,
  sanitizeExplorerTabManifest,
};
