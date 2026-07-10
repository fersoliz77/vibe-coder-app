const os = require('os');

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

function getDefaultShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function setupTerminalHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('terminal:create', (_, options = {}) => {
    const id = `term-${nextTerminalId++}`;
    const shell = options.shell || getDefaultShell();
    const cwd = options.cwd || os.homedir();
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
        env: { ...process.env, COLORTERM: 'truecolor' },
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

module.exports = { setupTerminalHandlers };
