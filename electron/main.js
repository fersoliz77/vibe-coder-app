const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const { setupWindowHandlers } = require('./ipc/windowManager');
const { setupDialogHandlers } = require('./ipc/dialogManager');
const { setupFileSystemHandlers } = require('./ipc/fileSystemManager');
const { setupServiceHandlers } = require('./services/serviceManager');
const { setupTerminalHandlers, terminateAllTerminals } = require('./services/terminalManager');
const { setupClaudeHandlers, terminateAllClaudeProcesses } = require('./services/claudeManager');
const { setupOpenAIHandlers, terminateAllOpenAIProcesses } = require('./services/openaiManager');
const { initProjectManager, setupProjectHandlers } = require('./services/projectManager');
const { setupStoreHandlers } = require('./ipc/storeManager');
const { AuthService, setupAuthHandlers } = require('./auth/authService');
const { AuthRealtime } = require('./auth/authRealtime');
const { installIpcAuthorization } = require('./auth/ipcGuard');

if (!app.isPackaged) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const envFile = require('fs').readFileSync(envPath, 'utf8');
    for (const line of envFile.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for node-pty IPC
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    icon: app.isPackaged
      ? path.join(__dirname, '..', 'dist', 'icon.png')
      : path.join(__dirname, '..', 'public', 'icon.png'),
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (/^https:\/\//i.test(targetUrl)) shell.openExternal(targetUrl);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    let allowed = false;
    try {
      const parsed = new URL(targetUrl);
      if (app.isPackaged && parsed.protocol === 'file:') {
        const targetPath = path.resolve(fileURLToPath(parsed));
        const entryPath = path.resolve(__dirname, '..', 'dist', 'index.html');
        allowed = targetPath === entryPath;
      } else if (!app.isPackaged) {
        allowed = parsed.origin === 'http://localhost:5173';
      }
    } catch {}
    if (!allowed) event.preventDefault();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized-changed', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized-changed', false);
  });

  // Load the app
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();

  const authService = new AuthService();
  authService.initialize();
  let previousPolicy = authService.getPolicy();
  let leaseTimer = null;
  let notifyAuthState;
  let authRealtime;
  const revalidateAndNotify = async () => {
    if (!authService.getState().authenticated) return;
    await authService.revalidate();
    notifyAuthState?.();
  };
  const handleAuthState = (state) => {
    if (previousPolicy === 'active' && state.policy !== 'active') {
      terminateAllTerminals();
      terminateAllClaudeProcesses();
      terminateAllOpenAIProcesses();
    }
    previousPolicy = state.policy;
    if (leaseTimer) clearTimeout(leaseTimer);
    const expiresAt = Date.parse(state.leaseExpiresAt);
    if (state.authenticated && Number.isFinite(expiresAt)) {
      const delay = Math.max(0, expiresAt - Date.now());
      leaseTimer = setTimeout(() => notifyAuthState?.(), Math.min(delay, 2_147_483_647));
      leaseTimer.unref();
    }
    authRealtime?.sync().catch(() => {});
  };
  notifyAuthState = setupAuthHandlers(ipcMain, authService, () => mainWindow, handleAuthState);
  authRealtime = new AuthRealtime(authService, revalidateAndNotify);
  handleAuthState(authService.getState());
  installIpcAuthorization(ipcMain, () => authService.getPolicy());
  const authRefreshTimer = setInterval(async () => {
    if (!authService.getState().authenticated) return;
    await revalidateAndNotify();
  }, 5 * 60 * 1000);
  authRefreshTimer.unref();
  app.once('before-quit', () => {
    clearInterval(authRefreshTimer);
    if (leaseTimer) clearTimeout(leaseTimer);
    authRealtime.stop().catch(() => {});
  });

  // Initialize Managers
  setupStoreHandlers();
  initProjectManager();
  setupWindowHandlers(() => mainWindow);
  setupDialogHandlers(() => mainWindow);
  setupFileSystemHandlers();

  // Setup IPC handlers for each subsystem
  setupProjectHandlers(ipcMain);
  setupServiceHandlers(ipcMain);
  setupTerminalHandlers(ipcMain, () => mainWindow);
  setupClaudeHandlers(ipcMain, () => mainWindow);
  setupOpenAIHandlers(ipcMain, () => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
