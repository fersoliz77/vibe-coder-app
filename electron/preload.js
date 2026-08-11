const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback, mapArgs = (...args) => args) {
  const listener = (_, ...args) => callback(...mapArgs(...args));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

async function invokeRequirement(channel, ...args) {
  const response = await ipcRenderer.invoke(channel, ...args);
  if (!response || typeof response !== 'object' || !Object.hasOwn(response, 'ok')) return response;
  if (response.ok) return response.data;
  const error = new Error('The requirement action needs attention.');
  error.code = response.error?.code || 'REQUIREMENTS_FAILED';
  if (response.error?.retry?.id) error.retry = response.error.retry;
  throw error;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Authentication tokens never cross into the renderer.
  auth: {
    getState: () => ipcRenderer.invoke('auth:get-state'),
    login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
    google: () => ipcRenderer.invoke('auth:google'),
    cancelOAuth: () => ipcRenderer.invoke('auth:cancel-oauth'),
    revalidate: () => ipcRenderer.invoke('auth:revalidate'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    openHelp: () => ipcRenderer.invoke('auth:open-help'),
    openLearning: () => ipcRenderer.invoke('auth:open-learning'),
    closeLearning: () => ipcRenderer.invoke('auth:close-learning'),
    onLearningStateChanged: (callback) => subscribe('learning:state-changed', callback, (state) => [state]),
    onStateChanged: (callback) => subscribe('auth:state-changed', callback, (state) => [state]),
  },

  diagnostics: {
    exportReport: () => ipcRenderer.invoke('diagnostics:export'),
  },

  updates: {
    getState: () => ipcRenderer.invoke('updates:get-state'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStateChanged: (callback) => subscribe('updates:state-changed', callback, (state) => [state]),
  },

  // ─── Window Controls ────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    confirmClose: () => ipcRenderer.send('window:close-confirmed'),
    onMaximizedChanged: (callback) => subscribe('window:maximized-changed', callback, (value) => [value]),
    onCloseRequested: (callback) => subscribe('window:close-requested', callback, () => []),
  },

  // ─── Local Database (Store) ─────────────────────────
  store: {
    get: (key, defaultValue) => ipcRenderer.invoke('store:get', key, defaultValue),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    delete: (key) => ipcRenderer.invoke('store:delete', key),
    getAll: () => ipcRenderer.invoke('store:getAll'),
  },

  // ─── Projects ──────────────────────────────────────
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    getRecoveryState: () => ipcRenderer.invoke('projects:get-recovery-state'),
    acknowledgeRecovery: () => ipcRenderer.invoke('projects:acknowledge-recovery'),
    chooseImport: () => ipcRenderer.invoke('projects:choose-import'),
    analyzeImport: (grantId) => ipcRenderer.invoke('projects:analyze-import', grantId),
    planImport: (grantId, choices) => ipcRenderer.invoke('projects:plan-import', grantId, choices),
    confirmImport: (grantId, planId) => ipcRenderer.invoke('projects:confirm-import', grantId, planId),
    cancelImport: (grantId) => ipcRenderer.invoke('projects:cancel-import', grantId),
    remove: (id) => ipcRenderer.invoke('projects:remove', id),
    updateLastOpened: (id) => ipcRenderer.invoke('projects:update-last-opened', id),
    openDirectoryDialog: () => ipcRenderer.invoke('dialog:open-directory'),
    createDirectoryDialog: () => ipcRenderer.invoke('dialog:create-directory'),
  },
  requirements: {
    list: (projectId) => invokeRequirement('requirements:list', projectId),
    refresh: (projectId) => invokeRequirement('requirements:refresh', projectId),
    preview: (projectId, requirementId) => invokeRequirement('requirements:preview', projectId, requirementId),
    apply: (grantId, confirmationNonce) => invokeRequirement('requirements:apply', grantId, confirmationNonce),
    retry: (retryId) => invokeRequirement('requirements:retry', retryId),
    cancel: (grantId) => invokeRequirement('requirements:cancel', grantId),
    copyGuidance: (projectId, requirementId) => invokeRequirement('requirements:copy-guidance', projectId, requirementId),
    onProgress: (callback) => subscribe('requirements:progress', callback, (progress) => [progress]),
  },
  dialog: {
    confirmDirtyTabs: (fileNames) => ipcRenderer.invoke('dialog:confirm-dirty-tabs', fileNames),
  },

  setup: {
    getState: () => ipcRenderer.invoke('setup:environment-state'),
    check: (options) => ipcRenderer.invoke('setup:environment-check', options),
    install: (options) => ipcRenderer.invoke('setup:environment-install', options),
    cancel: () => ipcRenderer.invoke('setup:environment-cancel'),
    onProgress: (callback) => subscribe('setup:environment-progress', callback, (event) => [event]),
  },

  projectCreation: {
    getDefaultLocation: () => ipcRenderer.invoke('projects:get-default-root'),
    chooseLocation: () => ipcRenderer.invoke('projects:choose-location'),
    getOptions: () => ipcRenderer.invoke('projects:get-provisioning-options'),
    provision: (request, locationGrant) => ipcRenderer.invoke('projects:provision', request, locationGrant),
    cancel: () => ipcRenderer.invoke('projects:cancel-provisioning'),
    onProgress: (callback) => subscribe('projects:provisioning-progress', callback, (event) => [event]),
  },

  // ─── File System ───────────────────────────────
  fs: {
    readDir: (projectPath, dirPath) => ipcRenderer.invoke('fs:read-dir', projectPath, dirPath),
    readFile: (projectPath, filePath) => ipcRenderer.invoke('fs:read-file', projectPath, filePath),
    writeFile: (projectPath, filePath, content) => ipcRenderer.invoke('fs:write-file', projectPath, filePath, content),
    openFile: (projectPath, filePath) => ipcRenderer.invoke('fs:open-file', projectPath, filePath),
    openFolder: (projectPath, folderPath) => ipcRenderer.invoke('fs:open-folder', projectPath, folderPath),
    search: (projectPath, query) => ipcRenderer.invoke('fs:search', projectPath, query),
    gitStatus: (projectPath) => ipcRenderer.invoke('fs:git-status', projectPath),
    gitStage: (projectPath, targetPath) => ipcRenderer.invoke('fs:git-stage', projectPath, targetPath),
    gitUnstage: (projectPath, targetPath) => ipcRenderer.invoke('fs:git-unstage', projectPath, targetPath),
    gitCommit: (projectPath, message) => ipcRenderer.invoke('fs:git-commit', projectPath, message),
    createFile: (projectPath, targetDir, fileName) => ipcRenderer.invoke('fs:create-file', projectPath, targetDir, fileName),
    createFolder: (projectPath, targetDir, folderName) => ipcRenderer.invoke('fs:create-folder', projectPath, targetDir, folderName),
    renameEntry: (projectPath, targetPath, nextName) => ipcRenderer.invoke('fs:rename-entry', projectPath, targetPath, nextName),
    moveEntry: (projectPath, sourcePath, targetDir) => ipcRenderer.invoke('fs:move-entry', projectPath, sourcePath, targetDir),
    copyEntry: (projectPath, sourcePath, targetDir) => ipcRenderer.invoke('fs:copy-entry', projectPath, sourcePath, targetDir),
    duplicateEntry: (projectPath, targetPath) => ipcRenderer.invoke('fs:duplicate-entry', projectPath, targetPath),
    deleteEntry: (projectPath, targetPath) => ipcRenderer.invoke('fs:delete-entry', projectPath, targetPath),
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
    // Status: { installed, authenticated, path, version }
    getStatus: () => ipcRenderer.invoke('claude:status'),
    // Legacy availability check
    checkAvailability: () => ipcRenderer.invoke('claude:check'),
    // Install CLI
    install: () => ipcRenderer.invoke('claude:install'),
    // Login is owned by the user's locally installed provider CLI.
    login: () => ipcRenderer.invoke('claude:login'),
    // Logout
    logout: () => ipcRenderer.invoke('claude:logout'),
    // Send a prompt
    sendPrompt: (prompt, cwd, model, history) => ipcRenderer.invoke('claude:send', prompt, cwd, model, history),
    cancel: (runId, projectPath) => ipcRenderer.invoke('claude:cancel', runId, projectPath),
    // Event subscriptions
    onData: (callback) => subscribe('claude:data', callback),
    onComplete: (callback) => subscribe('claude:complete', callback),
    onError: (callback) => subscribe('claude:error', callback),
    onInstallProgress: (callback) => subscribe('claude:install-progress', callback),
    onLoginProgress: (callback) => subscribe('claude:login-progress', callback),
  },

  // ─── System Info ───────────────────────────────────
  system: {
    platform: process.platform,
  },

  // ─── OpenAI through the official Codex CLI ───────────────────
  openai: {
    getStatus: () => ipcRenderer.invoke('openai:status'),
    getModels: () => ipcRenderer.invoke('openai:models'),
    login: () => ipcRenderer.invoke('openai:login'),
    logout: () => ipcRenderer.invoke('openai:logout'),
    sendPrompt: (prompt, history, model, reasoning, cwd) => ipcRenderer.invoke('openai:send', prompt, history, model, reasoning, cwd),
    cancel: (runId, projectPath) => ipcRenderer.invoke('openai:cancel', runId, projectPath),
    onStarted: (callback) => subscribe('openai:started', callback),
    onData: (callback) => subscribe('openai:data', callback),
    onComplete: (callback) => subscribe('openai:complete', callback),
    onError: (callback) => subscribe('openai:error', callback),
    onLoginProgress: (callback) => subscribe('openai:login-progress', callback),
  },

  opencode: {
    getStatus: () => ipcRenderer.invoke('opencode:status'),
    install: () => ipcRenderer.invoke('opencode:install'),
    onInstallProgress: (callback) => subscribe('opencode:install-progress', callback, (progress) => [progress]),
  },
  preview: {
    web: {
      status: (cwd) => ipcRenderer.invoke('preview:web-status', cwd),
      start: (cwd) => ipcRenderer.invoke('preview:web-start', cwd),
      stop: (cwd) => ipcRenderer.invoke('preview:web-stop', cwd),
      openExternal: (cwd) => ipcRenderer.invoke('preview:web-open-external', cwd),
      audit: (cwd) => ipcRenderer.invoke('preview:web-audit', cwd),
      clearIssues: (cwd) => ipcRenderer.invoke('preview:web-clear-issues', cwd),
      copyDiagnosis: (cwd) => ipcRenderer.invoke('preview:web-copy-diagnosis', cwd),
      snapshot: (cwd, bounds) => ipcRenderer.invoke('preview:web-snapshot', cwd, bounds),
      onStatus: (callback) => subscribe('preview:web-status', callback, (status) => [status]),
    },
    android: {
      status: (cwd) => ipcRenderer.invoke('preview:android-status', cwd),
      startEmulator: (cwd) => ipcRenderer.invoke('preview:android-start-emulator', cwd),
      stopEmulator: (cwd) => ipcRenderer.invoke('preview:android-stop-emulator', cwd),
      runApp: (cwd) => ipcRenderer.invoke('preview:android-run-app', cwd),
      stopApp: (cwd) => ipcRenderer.invoke('preview:android-stop-app', cwd),
      hotReload: (cwd) => ipcRenderer.invoke('preview:android-hot-reload', cwd),
      hotRestart: (cwd) => ipcRenderer.invoke('preview:android-hot-restart', cwd),
      rotate: (cwd, orientation) => ipcRenderer.invoke('preview:android-rotate', cwd, orientation),
      screenshot: (cwd) => ipcRenderer.invoke('preview:android-screenshot', cwd),
      onStatus: (callback) => subscribe('preview:android-status', callback, (status) => [status]),
    },
    onLog: (callback) => subscribe('preview:log', callback, (entry) => [entry]),
  },
});
