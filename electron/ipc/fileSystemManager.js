const { ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const {
  assertSafeEntryName,
  assertNotProjectRoot,
  getProjectRelativePath,
  isSubPath,
  resolveProjectChildPath,
  resolveProjectEntryPath,
  resolveProjectRoot,
} = require('./fsGuards');
const { isProjectRegistered } = require('../services/projectManager');

let fileHandlersRegistered = false;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']);
const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.css', '.scss', '.sass', '.html', '.htm',
  '.py', '.sql', '.yml', '.yaml', '.toml', '.env', '.gitignore', '.sh', '.bat', '.ps1', '.xml',
  '.cjs', '.mjs', '.log', '.csv', '.ini', '.lock', '.rb', '.php', '.java', '.kt', '.go', '.rs'
]);
const IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', '.cache', '__pycache__', '.DS_Store']);

function withProjectRoot(projectPath) {
  return resolveProjectRoot(projectPath, isProjectRegistered);
}

function withProjectEntry(projectPath, targetPath) {
  return resolveProjectEntryPath(projectPath, targetPath, isProjectRegistered);
}

function withProjectChild(projectPath, parentDir, entryName) {
  return resolveProjectChildPath(projectPath, parentDir, entryName, isProjectRegistered);
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

function ensureExistingDirectory(targetPath, message = 'Target folder is invalid.') {
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
    throw new Error(message);
  }
}

function readDirectoryEntries(currentPath) {
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
}

function setupFileSystemHandlers() {
  if (fileHandlersRegistered) return;

  ipcMain.handle('fs:read-dir', async (_, projectPath, dirPath) => {
    try {
      const { resolvedTargetPath } = withProjectEntry(projectPath, dirPath || projectPath);
      ensureExistingDirectory(resolvedTargetPath);
      return readDirectoryEntries(resolvedTargetPath);
    } catch {
      return [];
    }
  });

  ipcMain.handle('fs:search', async (_, projectPath, query) => {
    try {
      const normalizedProjectPath = withProjectRoot(projectPath);
      const searchQuery = String(query || '').trim().toLowerCase();
      if (!searchQuery) {
        return { success: true, files: [], contentMatches: [] };
      }

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

  ipcMain.handle('fs:git-status', async (_, projectPath) => {
    try {
      const normalizedProjectPath = withProjectRoot(projectPath);
      return await new Promise((resolve) => {
        execFile('git', ['status', '--porcelain'], { cwd: normalizedProjectPath, timeout: 8000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: stderr || error.message, entries: [] });
            return;
          }

          const entries = stdout
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => ({
              code: line.slice(0, 2).trim() || '??',
              path: line.slice(3).trim(),
            }));

          resolve({ success: true, entries });
        });
      });
    } catch (error) {
      return { success: false, error: error.message, entries: [] };
    }
  });

  ipcMain.handle('fs:git-stage', async (_, projectPath, targetPath) => {
    try {
      const normalizedProjectPath = withProjectRoot(projectPath);
      const { resolvedTargetPath } = withProjectEntry(projectPath, targetPath);
      const relativePath = getProjectRelativePath(normalizedProjectPath, resolvedTargetPath);

      return await new Promise((resolve) => {
        execFile('git', ['add', '--', relativePath], { cwd: normalizedProjectPath, timeout: 8000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: stderr || error.message });
            return;
          }
          resolve({ success: true, output: stdout });
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:git-unstage', async (_, projectPath, targetPath) => {
    try {
      const normalizedProjectPath = withProjectRoot(projectPath);
      const { resolvedTargetPath } = withProjectEntry(projectPath, targetPath);
      const relativePath = getProjectRelativePath(normalizedProjectPath, resolvedTargetPath);

      return await new Promise((resolve) => {
        execFile('git', ['reset', 'HEAD', '--', relativePath], { cwd: normalizedProjectPath, timeout: 8000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: stderr || error.message });
            return;
          }
          resolve({ success: true, output: stdout });
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:git-commit', async (_, projectPath, message) => {
    try {
      const normalizedProjectPath = withProjectRoot(projectPath);
      const trimmedMessage = String(message || '').trim();
      if (!trimmedMessage) {
        return { success: false, error: 'Commit message is required.' };
      }

      return await new Promise((resolve) => {
        execFile('git', ['commit', '-m', trimmedMessage], { cwd: normalizedProjectPath, timeout: 120000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: stderr || stdout || error.message });
            return;
          }
          resolve({ success: true, output: stdout });
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:read-file', async (_, projectPath, filePath) => {
    try {
      const { resolvedTargetPath } = withProjectEntry(projectPath, filePath);
      const stats = fs.statSync(resolvedTargetPath);

      if (!stats.isFile()) {
        return { success: false, error: 'Target is not a file.' };
      }

      const extension = path.extname(resolvedTargetPath).toLowerCase();
      const size = stats.size;

      if (IMAGE_EXTENSIONS.has(extension)) {
        const buffer = fs.readFileSync(resolvedTargetPath);
        const mime = extension === '.svg'
          ? 'image/svg+xml'
          : extension === '.jpg'
            ? 'image/jpeg'
            : `image/${extension.slice(1)}`;

        return {
          success: true,
          type: 'image',
          name: path.basename(resolvedTargetPath),
          path: resolvedTargetPath,
          extension,
          size,
          content: `data:${mime};base64,${buffer.toString('base64')}`,
        };
      }

      if (!isTextPreviewable(extension, size) && size > 1024 * 1024) {
        return {
          success: false,
          error: 'This file is too large or binary to preview safely.',
          name: path.basename(resolvedTargetPath),
          path: resolvedTargetPath,
          extension,
          size,
        };
      }

      const content = fs.readFileSync(resolvedTargetPath, 'utf8');
      return {
        success: true,
        type: 'text',
        name: path.basename(resolvedTargetPath),
        path: resolvedTargetPath,
        extension,
        size,
        content,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:write-file', async (_, projectPath, filePath, content) => {
    try {
      const { resolvedTargetPath } = withProjectEntry(projectPath, filePath);
      fs.writeFileSync(resolvedTargetPath, content, 'utf8');
      return { success: true, path: resolvedTargetPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:open-file', async (_, projectPath, filePath) => {
    try {
      const { resolvedTargetPath } = withProjectEntry(projectPath, filePath);
      await shell.openPath(resolvedTargetPath);
      return { success: true, path: resolvedTargetPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:open-folder', async (_, projectPath, folderPath) => {
    try {
      const { resolvedTargetPath } = withProjectEntry(projectPath, folderPath || projectPath);
      ensureExistingDirectory(resolvedTargetPath);

      if (process.platform === 'win32') {
        const child = spawn('explorer.exe', [resolvedTargetPath], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return { success: true, path: resolvedTargetPath };
      }

      const result = await shell.openPath(resolvedTargetPath);
      return { success: result === '', path: resolvedTargetPath, error: result || null };
    } catch (error) {
      return { success: false, path: folderPath, error: error.message };
    }
  });

  ipcMain.handle('fs:create-file', async (_, projectPath, targetDir, fileName) => {
    try {
      const safeFileName = assertSafeEntryName(fileName);
      const { resolvedParentDir, resolvedChildPath } = withProjectChild(projectPath, targetDir, safeFileName);
      ensureExistingDirectory(resolvedParentDir);

      if (fs.existsSync(resolvedChildPath)) {
        return { success: false, error: 'A file or folder with that name already exists.' };
      }

      fs.writeFileSync(resolvedChildPath, '', 'utf8');
      return { success: true, path: resolvedChildPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:create-folder', async (_, projectPath, targetDir, folderName) => {
    try {
      const safeFolderName = assertSafeEntryName(folderName);
      const { resolvedParentDir, resolvedChildPath } = withProjectChild(projectPath, targetDir, safeFolderName);
      ensureExistingDirectory(resolvedParentDir);

      if (fs.existsSync(resolvedChildPath)) {
        return { success: false, error: 'A file or folder with that name already exists.' };
      }

      fs.mkdirSync(resolvedChildPath, { recursive: true });
      return { success: true, path: resolvedChildPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:rename-entry', async (_, projectPath, targetPath, nextName) => {
    try {
      const safeName = assertSafeEntryName(nextName);
      const { resolvedTargetPath } = withProjectEntry(projectPath, targetPath);
      assertNotProjectRoot(projectPath, resolvedTargetPath);
      const parentDir = path.dirname(resolvedTargetPath);
      const nextPath = path.join(parentDir, safeName);

      if (!fs.existsSync(resolvedTargetPath)) {
        return { success: false, error: 'The selected file or folder no longer exists.' };
      }

      if (!isSubPath(withProjectRoot(projectPath), nextPath)) {
        return { success: false, error: 'Rename target is outside the active project.' };
      }

      if (fs.existsSync(nextPath)) {
        return { success: false, error: 'A file or folder with that name already exists.' };
      }

      fs.renameSync(resolvedTargetPath, nextPath);
      return { success: true, path: nextPath, oldPath: resolvedTargetPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:move-entry', async (_, projectPath, sourcePath, targetDir) => {
    try {
      const { resolvedTargetPath: normalizedSource } = withProjectEntry(projectPath, sourcePath);
      assertNotProjectRoot(projectPath, normalizedSource);
      const { resolvedTargetPath: normalizedTargetDir } = withProjectEntry(projectPath, targetDir);
      const destinationPath = path.join(normalizedTargetDir, path.basename(normalizedSource));

      if (!fs.existsSync(normalizedSource)) {
        return { success: false, error: 'The selected file or folder no longer exists.' };
      }

      ensureExistingDirectory(normalizedTargetDir);

      if (destinationPath === normalizedSource) {
        return { success: true, path: normalizedSource, oldPath: normalizedSource };
      }

      if (isSubPath(normalizedSource, normalizedTargetDir)) {
        return { success: false, error: 'Cannot move a folder into itself.' };
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

  ipcMain.handle('fs:copy-entry', async (_, projectPath, sourcePath, targetDir) => {
    try {
      const { resolvedTargetPath: normalizedSource } = withProjectEntry(projectPath, sourcePath);
      const { resolvedTargetPath: normalizedTargetDir } = withProjectEntry(projectPath, targetDir);
      const destinationPath = path.join(normalizedTargetDir, path.basename(normalizedSource));

      if (!fs.existsSync(normalizedSource)) {
        return { success: false, error: 'The selected file or folder no longer exists.' };
      }

      ensureExistingDirectory(normalizedTargetDir);

      if (fs.existsSync(destinationPath)) {
        return { success: false, error: 'An item with the same name already exists in that folder.' };
      }

      fs.cpSync(normalizedSource, destinationPath, { recursive: true });
      return { success: true, path: destinationPath, oldPath: normalizedSource };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:duplicate-entry', async (_, projectPath, targetPath) => {
    try {
      const { resolvedTargetPath } = withProjectEntry(projectPath, targetPath);
      const parentDir = path.dirname(resolvedTargetPath);
      const destinationPath = getCopyPath(parentDir, path.basename(resolvedTargetPath));

      if (!fs.existsSync(resolvedTargetPath)) {
        return { success: false, error: 'The selected file or folder no longer exists.' };
      }

      fs.cpSync(resolvedTargetPath, destinationPath, { recursive: true });
      return { success: true, path: destinationPath, oldPath: resolvedTargetPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('fs:delete-entry', async (_, projectPath, targetPath) => {
    try {
      const { resolvedTargetPath } = withProjectEntry(projectPath, targetPath);
      assertNotProjectRoot(projectPath, resolvedTargetPath);

      if (!fs.existsSync(resolvedTargetPath)) {
        return { success: false, error: 'The selected file or folder no longer exists.' };
      }

      fs.rmSync(resolvedTargetPath, { recursive: true, force: true });
      return { success: true, path: resolvedTargetPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  fileHandlersRegistered = true;
}

module.exports = { setupFileSystemHandlers };
