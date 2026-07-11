const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { setupWindowHandlers } = require('./ipc/windowManager');
const { setupDialogHandlers } = require('./ipc/dialogManager');
const { setupFileSystemHandlers } = require('./ipc/fileSystemManager');
const { setupServiceHandlers } = require('./services/serviceManager');
const { setupTerminalHandlers } = require('./services/terminalManager');
const { setupClaudeHandlers } = require('./services/claudeManager');
const { initProjectManager, setupProjectHandlers } = require('./services/projectManager');

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
    },
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
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
  createWindow();

  // Initialize Managers
  initProjectManager();
  setupWindowHandlers(() => mainWindow);
  setupDialogHandlers(() => mainWindow);
  setupFileSystemHandlers();

  // Setup IPC handlers for each subsystem
  setupProjectHandlers(ipcMain);
  setupServiceHandlers(ipcMain);
  setupTerminalHandlers(ipcMain, () => mainWindow);
  setupClaudeHandlers(ipcMain, () => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
