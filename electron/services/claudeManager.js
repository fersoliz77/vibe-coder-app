const { spawn, exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

/**
 * Claude Code Manager — Detects and interfaces with the Claude CLI.
 * Handles spawning Claude as a subprocess with proper environment isolation.
 */

let activeProcess = null;

async function checkClaudeAvailability() {
  const command = process.platform === 'win32' ? 'where claude' : 'which claude';
  try {
    const { stdout } = await execAsync(command, { timeout: 5000 });
    return { available: true, path: stdout.trim().split(/\r?\n/)[0] };
  } catch {
    return { available: false, path: null };
  }
}

function setupClaudeHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('claude:check', async () => {
    return await checkClaudeAvailability();
  });

  ipcMain.handle('claude:send', async (_, prompt, cwd) => {
    // Cancel any existing process
    if (activeProcess) {
      try { activeProcess.kill(); } catch {}
      activeProcess = null;
    }

    const availability = await checkClaudeAvailability();
    const mainWindow = getMainWindow();
    if (!availability.available) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude:error', 'Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code');
      }
      return { success: false, error: 'Claude CLI not available' };
    }

    // Clean environment to prevent ELECTRON_RUN_AS_NODE conflicts
    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;

    try {
      activeProcess = spawn(availability.path, ['--print', prompt], {
        cwd: cwd || process.cwd(),
        env: cleanEnv,
        stdio: 'pipe',
        shell: false,
      });

      let fullOutput = '';

      activeProcess.stdout.on('data', (data) => {
        const text = data.toString();
        fullOutput += text;
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('claude:data', text);
        }
      });

      activeProcess.stderr.on('data', (data) => {
        const text = data.toString();
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('claude:data', text);
        }
      });

      activeProcess.on('close', (code) => {
        activeProcess = null;
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('claude:complete', {
            code,
            output: fullOutput,
          });
        }
      });

      activeProcess.on('error', (error) => {
        activeProcess = null;
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('claude:error', error.message);
        }
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.on('claude:cancel', () => {
    if (activeProcess) {
      try { activeProcess.kill(); } catch {}
      activeProcess = null;
    }
  });
}

module.exports = { setupClaudeHandlers };
