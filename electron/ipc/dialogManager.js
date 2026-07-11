const { ipcMain, dialog } = require('electron');
const fs = require('fs');

let dialogHandlersRegistered = false;

function setupDialogHandlers(getMainWindow) {
  if (dialogHandlersRegistered) return;

  ipcMain.handle('dialog:open-directory', async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:create-directory', async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Create New Project Folder',
      buttonLabel: 'Create Project',
      properties: ['createDirectory'],
    });

    if (!result.canceled && result.filePath) {
      if (!fs.existsSync(result.filePath)) {
        fs.mkdirSync(result.filePath, { recursive: true });
      }
      return result.filePath;
    }

    return null;
  });

  dialogHandlersRegistered = true;
}

module.exports = { setupDialogHandlers };
