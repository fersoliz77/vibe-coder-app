const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../services/atomicJson');

function purgeLegacyChatHistory(data) {
  const next = { ...data };
  for (const key of Object.keys(next)) {
    if (key.startsWith('chat:')) delete next[key];
  }
  return next;
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

    const data = purgeLegacyChatHistory(parsed);
    if (Object.keys(data).length !== Object.keys(parsed).length) {
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
    const next = { ...this.data, [key]: value };
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
};
