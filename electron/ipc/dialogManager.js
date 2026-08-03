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

  ipcMain.handle('dialog:confirm-dirty-tabs', async (_, fileNames) => {
    const names = Array.isArray(fileNames) ? fileNames.filter((name) => typeof name === 'string').slice(0, 10) : [];
    const result = await dialog.showMessageBox(getMainWindow(), {
      type: 'warning',
      title: 'Unsaved files',
      message: `${names.length} file${names.length === 1 ? '' : 's'} have unsaved changes.`,
      detail: names.join('\n'),
      buttons: ['Save All', 'Discard', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    return ['save', 'discard', 'cancel'][result.response] || 'cancel';
  });

  dialogHandlersRegistered = true;
}

module.exports = { setupDialogHandlers };
