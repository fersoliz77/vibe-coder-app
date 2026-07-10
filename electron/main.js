const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { setupServiceHandlers } = require('./services/serviceManager');
const { setupTerminalHandlers } = require('./services/terminalManager');
const { setupClaudeHandlers } = require('./services/claudeManager');
const { initProjectManager, setupProjectHandlers } = require('./services/projectManager');

let mainWindow;
let windowHandlersRegistered = false;
let dialogHandlersRegistered = false;
let fileHandlersRegistered = false;

function setupWindowHandlers() {
  if (windowHandlersRegistered) return;

  ipcMain.on('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });

  ipcMain.on('window:maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  ipcMain.handle('window:isMaximized', () => {
    return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized());
  });

  windowHandlersRegistered = true;
}

function setupDialogHandlers() {
  if (dialogHandlersRegistered) return;

  ipcMain.handle('dialog:open-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:create-directory', async () => {
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

function setupFileSystemHandlers() {
  if (fileHandlersRegistered) return;

  const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']);
  const TEXT_EXTENSIONS = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.css', '.scss', '.sass', '.html', '.htm',
    '.py', '.sql', '.yml', '.yaml', '.toml', '.env', '.gitignore', '.sh', '.bat', '.ps1', '.xml',
    '.cjs', '.mjs', '.log', '.csv', '.ini', '.lock', '.rb', '.php', '.java', '.kt', '.go', '.rs'
  ]);

  function normalizeWithinProject(targetPath) {
    return path.normalize(targetPath);
  }

  function getCopyPath(targetDir, baseName) {
    const extension = path.extname(baseName);
    const stem = extension ? baseName.slice(0, -extension.length) : baseName;
    let attempt = 1;
    let candidate = path.join(targetDir, `${stem} copy${extension}`);

    while (fs.existsSync(candidate)) {
      attempt += 1;
      candidate = path.join(targetDir, `${stem} copy ${attempt}${extension}`);
    }

    return candidate;
  }

  function isTextPreviewable(extension, size) {
    return TEXT_EXTENSIONS.has(extension) || size <= 1024 * 1024;
  }

  ipcMain.handle('fs:read-dir', async (_, dirPath) => {
    const IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', '.cache', '__pycache__', '.DS_Store']);

    function readDir(currentPath, depth = 0) {
      if (depth > 6) return [];

      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        return entries
          .filter((entry) => !IGNORED.has(entry.name))
          .sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          })
          .map((entry) => ({
            name: entry.name,
            path: path.join(currentPath, entry.name),
            isDirectory: entry.isDirectory(),
            children: entry.isDirectory() ? [] : undefined,
          }));
      } catch {
        return [];
      }
    }

    return readDir(dirPath);
  });

  ipcMain.handle('fs:search', async (_, projectPath, query) => {
    try {
      const normalizedProjectPath = normalizeWithinProject(projectPath);
      const searchQuery = String(query || '').trim().toLowerCase();
      if (!searchQuery) {
        return { success: true, files: [], contentMatches: [] };
      }

      const IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', '.cache', '__pycache__', '.DS_Store']);
      const files = [];
      const contentMatches = [];
      const MAX_RESULTS = 100;

      function walk(currentPath, depth = 0) {
        if (depth > 8 || files.length + contentMatches.length >= MAX_RESULTS) return;

        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (IGNORED.has(entry.name)) continue;
          const fullPath = path.join(currentPath, entry.name);

          if (entry.name.toLowerCase().includes(searchQuery)) {
            files.push({
              name: entry.name,
              path: fullPath,
              isDirectory: entry.isDirectory(),
            });
          }

          if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
            continue;
          }

          const extension = path.extname(entry.name).toLowerCase();
          const size = fs.statSync(fullPath).size;
          if (!isTextPreviewable(extension, size) || contentMatches.length >= MAX_RESULTS) continue;

          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lower = content.toLowerCase();
            const index = lower.indexOf(searchQuery);
            if (index !== -1) {
              const start = Math.max(0, index - 40);
              const end = Math.min(content.length, index + searchQuery.length + 80);
              contentMatches.push({
                name: entry.name,
                path: fullPath,
                snippet: content.slice(start, end).replace(/\s+/g, ' ').trim(),
              });
            }
          } catch {
            // Ignore non-utf8 files.
          }
        }
      }

      walk(normalizedProjectPath);
      return { success: true, files: files.slice(0, MAX_RESULTS), contentMatches: contentMatches.slice(0, MAX_RESULTS) };
    } catch (error) {
      return { success: false, error: error.message, files: [], contentMatches: [] };
    }
  });

  ipcMain.handle('fs:read-file', async (_, filePath) => {
    try {
      const normalizedPath = normalizeWithinProject(filePath);
      const stats = fs.statSync(normalizedPath);

      if (!stats.isFile()) {
        return { success: false, error: 'Target is not a file.' };
      }

      const extension = path.extname(normalizedPath).toLowerCase();
      const size = stats.size;

      if (IMAGE_EXTENSIONS.has(extension)) {
        const buffer = fs.readFileSync(normalizedPath);
        const mime = extension === '.svg'
          ? 'image/svg+xml'
          : extension === '.jpg'
            ? 'image/jpeg'
            : `image/${extension.slice(1)}`;

        return {
          success: true,
          type: 'image',
          name: path.basename(normalizedPath),
          path: normalizedPath,
          extension,
          size,
          content: `data:${mime};base64,${buffer.toString('base64')}`,
        };
      }

      if (!isTextPreviewable(extension, size) && size > 1024 * 1024) {
        return {
          success: false,
          error: 'This file is too large or binary to preview safely.',
          name: path.basename(normalizedPath),
          path: normalizedPath,
          extension,
          size,
        };
      }

      const content = fs.readFileSync(normalizedPath, 'utf8');
      return {
        success: true,
        type: 'text',
        name: path.basename(normalizedPath),
        path: normalizedPath,
        extension,
        size,
        content,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:write-file', async (_, filePath, content) => {
    try {
      const normalizedPath = normalizeWithinProject(filePath);
      fs.writeFileSync(normalizedPath, content, 'utf8');
      return { success: true, path: normalizedPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:open-file', async (_, filePath) => {
    await shell.openPath(filePath);
    return { success: true };
  });

  ipcMain.handle('fs:open-folder', async (_, folderPath) => {
    try {
      const normalizedPath = path.normalize(folderPath);

      if (process.platform === 'win32') {
        const child = spawn('explorer.exe', [normalizedPath], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return { success: true, path: normalizedPath };
      }

      const result = await shell.openPath(normalizedPath);
      return { success: result === '', path: normalizedPath, error: result || null };
    } catch (error) {
      return { success: false, path: folderPath, error: error.message };
    }
  });

  ipcMain.handle('fs:create-file', async (_, targetDir, fileName) => {
    try {
      const normalizedDir = normalizeWithinProject(targetDir);
      const targetPath = path.join(normalizedDir, fileName);

      if (fs.existsSync(targetPath)) {
        return { success: false, error: 'A file or folder with that name already exists.' };
      }

      fs.writeFileSync(targetPath, '', 'utf8');
      return { success: true, path: targetPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:create-folder', async (_, targetDir, folderName) => {
    try {
      const normalizedDir = normalizeWithinProject(targetDir);
      const targetPath = path.join(normalizedDir, folderName);

      if (fs.existsSync(targetPath)) {
        return { success: false, error: 'A file or folder with that name already exists.' };
      }

      fs.mkdirSync(targetPath, { recursive: true });
      return { success: true, path: targetPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:rename-entry', async (_, targetPath, nextName) => {
    try {
      const normalizedPath = normalizeWithinProject(targetPath);
      const parentDir = path.dirname(normalizedPath);
      const nextPath = path.join(parentDir, nextName);

      if (!fs.existsSync(normalizedPath)) {
        return { success: false, error: 'The selected file or folder no longer exists.' };
      }

      if (fs.existsSync(nextPath)) {
        return { success: false, error: 'A file or folder with that name already exists.' };
      }

      fs.renameSync(normalizedPath, nextPath);
      return { success: true, path: nextPath, oldPath: normalizedPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:move-entry', async (_, sourcePath, targetDir) => {
    try {
      const normalizedSource = normalizeWithinProject(sourcePath);
      const normalizedTargetDir = normalizeWithinProject(targetDir);
      const destinationPath = path.join(normalizedTargetDir, path.basename(normalizedSource));

      if (!fs.existsSync(normalizedSource)) {
        return { success: false, error: 'The selected file or folder no longer exists.' };
      }

      if (!fs.existsSync(normalizedTargetDir) || !fs.statSync(normalizedTargetDir).isDirectory()) {
        return { success: false, error: 'Target folder is invalid.' };
      }

      if (destinationPath === normalizedSource) {
        return { success: true, path: normalizedSource, oldPath: normalizedSource };
      }

      if (fs.existsSync(destinationPath)) {
        return { success: false, error: 'An item with the same name already exists in that folder.' };
      }

      fs.renameSync(normalizedSource, destinationPath);
      return { success: true, path: destinationPath, oldPath: normalizedSource };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:copy-entry', async (_, sourcePath, targetDir) => {
    try {
      const normalizedSource = normalizeWithinProject(sourcePath);
      const normalizedTargetDir = normalizeWithinProject(targetDir);
      const destinationPath = path.join(normalizedTargetDir, path.basename(normalizedSource));

      if (!fs.existsSync(normalizedSource)) {
        return { success: false, error: 'The selected file or folder no longer exists.' };
      }

      if (fs.existsSync(destinationPath)) {
        return { success: false, error: 'An item with the same name already exists in that folder.' };
      }

      fs.cpSync(normalizedSource, destinationPath, { recursive: true });
      return { success: true, path: destinationPath, oldPath: normalizedSource };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:duplicate-entry', async (_, targetPath) => {
    try {
      const normalizedPath = normalizeWithinProject(targetPath);
      const parentDir = path.dirname(normalizedPath);
      const destinationPath = getCopyPath(parentDir, path.basename(normalizedPath));

      if (!fs.existsSync(normalizedPath)) {
        return { success: false, error: 'The selected file or folder no longer exists.' };
      }

      fs.cpSync(normalizedPath, destinationPath, { recursive: true });
      return { success: true, path: destinationPath, oldPath: normalizedPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:delete-entry', async (_, targetPath) => {
    try {
      const normalizedPath = normalizeWithinProject(targetPath);

      if (!fs.existsSync(normalizedPath)) {
        return { success: false, error: 'The selected file or folder no longer exists.' };
      }

      fs.rmSync(normalizedPath, { recursive: true, force: true });
      return { success: true, path: normalizedPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  fileHandlersRegistered = true;
}

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
  setupWindowHandlers();
  setupDialogHandlers();
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
