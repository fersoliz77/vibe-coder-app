const { ipcMain } = require('electron');

let windowHandlersRegistered = false;

function installCloseGuard(mainWindow) {
  if (!mainWindow || mainWindow.__vibeCloseGuardInstalled) return;
  mainWindow.__vibeCloseGuardInstalled = true;
  mainWindow.on('close', (event) => {
    if (mainWindow.__vibeCloseApproved || mainWindow.__vibeUpdateInstallApproved) return;
    event.preventDefault();
    mainWindow.webContents.send('window:close-requested');
  });
}

function prepareWindowForUpdateInstall(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed?.()) return () => {};
  mainWindow.__vibeUpdateInstallApproved = true;
  return () => { mainWindow.__vibeUpdateInstallApproved = false; };
}

function setupWindowHandlers(getMainWindow) {
  if (windowHandlersRegistered) return;

  ipcMain.on('window:minimize', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });

  ipcMain.on('window:maximize', () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  ipcMain.on('window:close-confirmed', () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.__vibeCloseApproved = true;
    mainWindow.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    const mainWindow = getMainWindow();
    return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized());
  });

  windowHandlersRegistered = true;
}

module.exports = { installCloseGuard, prepareWindowForUpdateInstall, setupWindowHandlers };
