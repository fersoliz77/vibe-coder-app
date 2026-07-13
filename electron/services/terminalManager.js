const { validateProjectCwd } = require('../ipc/fsGuards');
const { isProjectRegistered } = require('./projectManager');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { findOpenCodePath } = require('./openCodeManager');

/**
 * Terminal Manager — Creates and manages PTY sessions via node-pty.
 * Each terminal gets a unique ID and communicates via IPC.
 */

let pty;
try {
  pty = require('node-pty');
} catch (e) {
  console.warn('node-pty not available. Terminal will run in fallback mode.');
  pty = null;
}

const terminals = new Map();
let nextTerminalId = 1;

function getTerminalEnvironment() {
  const npmBin = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm');
  const nodeBin = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs');
  const gitBash = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
  return {
    ...process.env,
    PATH: [npmBin, nodeBin, process.env.PATH].filter(Boolean).join(path.delimiter),
    COLORTERM: 'truecolor',
    ...(process.env.OPENCODE_GIT_BASH_PATH || !fs.existsSync(gitBash) ? {} : { OPENCODE_GIT_BASH_PATH: gitBash }),
  };
}

function getDefaultShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function selectTerminalExecutable(options, openCodePath) {
  if (options.mode === 'opencode') {
    if (!openCodePath) throw new Error('OpenCode is not installed.');
    return openCodePath;
  }
  if (options.mode) throw new Error('Unsupported terminal mode.');
  return options.shell || getDefaultShell();
}

function setupTerminalHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('terminal:create', async (_, options = {}) => {
    const id = `term-${nextTerminalId++}`;
    let shell;
    if (options.mode === 'opencode') {
      const openCodePath = await findOpenCodePath();
      try { shell = selectTerminalExecutable(options, openCodePath); } catch (error) { return { id, error: error.message }; }
    } else {
      try { shell = selectTerminalExecutable(options); } catch (error) { return { id, error: error.message }; }
    }
    let cwd;
    try {
      cwd = validateProjectCwd(options.cwd, isProjectRegistered);
    } catch (error) {
      return { id, error: error.message };
    }
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    if (!pty) {
      // Fallback: notify renderer that terminal is unavailable
      return { id, error: 'node-pty not available. Install native dependencies.' };
    }

    try {
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: getTerminalEnvironment(),
      });

      ptyProcess.onData((data) => {
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal:data', id, data);
        }
      });

      ptyProcess.onExit(() => {
        terminals.delete(id);
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('terminal:exit', id);
        }
      });

      terminals.set(id, ptyProcess);
      return { id, shell, cwd };
    } catch (error) {
      return { id, error: error.message };
    }
  });

  ipcMain.on('terminal:write', (_, id, data) => {
    const term = terminals.get(id);
    if (term) term.write(data);
  });

  ipcMain.on('terminal:resize', (_, id, cols, rows) => {
    const term = terminals.get(id);
    if (term) {
      try {
        term.resize(cols, rows);
      } catch (e) {
        // Ignore resize errors
      }
    }
  });

  ipcMain.on('terminal:destroy', (_, id) => {
    const term = terminals.get(id);
    if (term) {
      term.kill();
      terminals.delete(id);
    }
  });
}

function terminateAllTerminals() {
  for (const terminal of terminals.values()) {
    try { terminal.kill(); } catch {}
  }
  terminals.clear();
}

module.exports = { selectTerminalExecutable, setupTerminalHandlers, terminateAllTerminals };
