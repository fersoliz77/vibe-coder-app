const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../services/atomicJson');

class StoreManager {
  constructor() {
    // userData maps to %APPDATA%/vibe-ide-coder on Windows
    this.storePath = path.join(app.getPath('userData'), 'config.json');
    this.data = this.readData();
  }

  readData() {
    try {
      if (fs.existsSync(this.storePath)) {
        const fileContent = fs.readFileSync(this.storePath, 'utf8');
        return JSON.parse(fileContent);
      }
    } catch (error) {
      console.error('Error reading config.json:', error);
    }
    return {};
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
  getStore
};
