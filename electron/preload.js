const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback, mapArgs = (...args) => args) {
  const listener = (_, ...args) => callback(...mapArgs(...args));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Window Controls ────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizedChanged: (callback) => subscribe('window:maximized-changed', callback, (value) => [value]),
  },

  // ─── Projects ──────────────────────────────────────
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    add: (path) => ipcRenderer.invoke('projects:add', path),
    remove: (id) => ipcRenderer.invoke('projects:remove', id),
    updateLastOpened: (id) => ipcRenderer.invoke('projects:update-last-opened', id),
    openDirectoryDialog: () => ipcRenderer.invoke('dialog:open-directory'),
    createDirectoryDialog: () => ipcRenderer.invoke('dialog:create-directory'),
  },

  // ─── File System ───────────────────────────────
  fs: {
    readDir: (dirPath) => ipcRenderer.invoke('fs:read-dir', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('fs:read-file', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs:write-file', filePath, content),
    openFile: (filePath) => ipcRenderer.invoke('fs:open-file', filePath),
    openFolder: (folderPath) => ipcRenderer.invoke('fs:open-folder', folderPath),
    search: (projectPath, query) => ipcRenderer.invoke('fs:search', projectPath, query),
    gitStatus: (projectPath) => ipcRenderer.invoke('fs:git-status', projectPath),
    createFile: (targetDir, fileName) => ipcRenderer.invoke('fs:create-file', targetDir, fileName),
    createFolder: (targetDir, folderName) => ipcRenderer.invoke('fs:create-folder', targetDir, folderName),
    renameEntry: (targetPath, nextName) => ipcRenderer.invoke('fs:rename-entry', targetPath, nextName),
    moveEntry: (sourcePath, targetDir) => ipcRenderer.invoke('fs:move-entry', sourcePath, targetDir),
    copyEntry: (sourcePath, targetDir) => ipcRenderer.invoke('fs:copy-entry', sourcePath, targetDir),
    duplicateEntry: (targetPath) => ipcRenderer.invoke('fs:duplicate-entry', targetPath),
    deleteEntry: (targetPath) => ipcRenderer.invoke('fs:delete-entry', targetPath),
  },

  // ─── Services (Vercel, Supabase, GitHub) ────────────
  services: {
    checkAll: (projectPath) => ipcRenderer.invoke('services:check-all', projectPath),
    check: (serviceName, projectPath) => ipcRenderer.invoke('services:check', serviceName, projectPath),
    connect: (serviceName, projectPath) => ipcRenderer.invoke('services:connect', serviceName, projectPath),
    disconnect: (serviceName, projectPath) => ipcRenderer.invoke('services:disconnect', serviceName, projectPath),
  },

  // ─── Terminal (xterm + node-pty) ────────────────────
  terminal: {
    create: (options) => ipcRenderer.invoke('terminal:create', options),
    write: (id, data) => ipcRenderer.send('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
    destroy: (id) => ipcRenderer.send('terminal:destroy', id),
    onData: (callback) => subscribe('terminal:data', callback),
    onExit: (callback) => subscribe('terminal:exit', callback),
  },

  // ─── Claude Code ───────────────────────────────────
  claude: {
    checkAvailability: () => ipcRenderer.invoke('claude:check'),
    sendPrompt: (prompt, cwd) => ipcRenderer.invoke('claude:send', prompt, cwd),
    cancel: () => ipcRenderer.send('claude:cancel'),
    onData: (callback) => subscribe('claude:data', callback),
    onComplete: (callback) => subscribe('claude:complete', callback),
    onError: (callback) => subscribe('claude:error', callback),
  },

  // ─── System Info ───────────────────────────────────
  system: {
    platform: process.platform,
    homedir: require('os').homedir(),
  },
});
