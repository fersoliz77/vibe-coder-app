const { spawn, exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// Strip ANSI escape codes from terminal output
function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[mGKHFJsu]|\x1B\][^\x07]*\x07|\x1B[^[\]]/g, '');
}

/**
 * Claude Code Manager — Detects, installs, authenticates, and interfaces with the Claude CLI.
 * Handles three states:
 *   1. Not installed  → guides user to install
 *   2. Installed but not authenticated → guides user to login (opens browser)
 *   3. Authenticated  → ready to use
 */

let activeProcess = null;

// ─── Detection ──────────────────────────────────────────────────────────────

async function findClaudePath() {
  const isWin = process.platform === 'win32';
  // On Windows, npm installs a `claude.cmd` wrapper — `where claude` finds the .ps1 but
  // Electron can't run it directly; we need the .cmd version.
  const candidates = isWin
    ? ['claude.cmd', 'claude']
    : ['claude'];

  for (const name of candidates) {
    const command = isWin ? `where ${name}` : `which ${name}`;
    try {
      const { stdout } = await execAsync(command, { timeout: 5000, shell: true });
      const found = stdout.trim().split(/\r?\n/)[0];
      if (found) return found;
    } catch {
      continue;
    }
  }

  // Fallback: well-known npm global bin paths on Windows
  if (isWin) {
    const npmBin = process.env.APPDATA
      ? `${process.env.APPDATA}\\npm\\claude.cmd`
      : null;
    if (npmBin) {
      try {
        const { stdout } = await execAsync(`"${npmBin}" --version`, { timeout: 5000, shell: false });
        if (stdout.trim()) return npmBin;
      } catch {}
    }
  }

  return null;
}

async function checkClaudeInstalled() {
  const path = await findClaudePath();
  return { installed: !!path, path };
}

async function checkClaudeAuth(claudePath) {
  if (!claudePath) return { authenticated: false };
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  delete cleanEnv.ELECTRON_NO_ASAR;

  try {
    // In Claude CLI v2.1+, `claude config list` is no longer a direct command.
    // Instead, we run `claude --print "hi"` with a very short timeout to probe auth.
    // If not authenticated, the process exits with a message about login.
    // A safer approach: check if there's an existing credential file on disk.
    const os = require('os');
    const fs = require('fs');
    const path = require('path');

    const credentialPaths = [
      path.join(os.homedir(), '.claude', '.credentials.json'),
      path.join(os.homedir(), '.claude', 'credentials.json'),
      path.join(os.homedir(), '.config', 'claude', 'credentials.json'),
      path.join(process.env.APPDATA || '', 'claude', '.credentials.json'),
    ];

    for (const credPath of credentialPaths) {
      try {
        const content = fs.readFileSync(credPath, 'utf8');
        const creds = JSON.parse(content);
        if (creds && (creds.access_token || creds.apiKey || Object.keys(creds).length > 0)) {
          return { authenticated: true };
        }
      } catch {}
    }

    // Fallback: run `claude --version` with a marker; if it exits cleanly, assume authenticated.
    // Some versions output auth warnings to stderr.
    const { stdout, stderr } = await execAsync(
      `"${claudePath}" --version`,
      { env: cleanEnv, timeout: 8000, shell: false }
    );
    const combined = (stdout + stderr).toLowerCase();
    if (combined.includes('not logged in') || combined.includes('unauthenticated') || combined.includes('please log in') || combined.includes('login')) {
      return { authenticated: false };
    }
    // If the version check passes cleanly, try a lightweight command to confirm
    return { authenticated: true };
  } catch (err) {
    const msg = (err.stderr || err.message || '').toLowerCase();
    if (msg.includes('not logged in') || msg.includes('unauthenticated') || msg.includes('please log in')) {
      return { authenticated: false };
    }
    return { authenticated: false, error: err.message };
  }
}


/**
 * Full status check: installed? authenticated?
 * Returns: { installed, authenticated, path, version }
 */
async function getClaudeStatus() {
  const { installed, path } = await checkClaudeInstalled();
  if (!installed) return { installed: false, authenticated: false, path: null };

  // Get version
  let version = null;
  try {
    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;
    const { stdout } = await execAsync(`"${path}" --version`, { env: cleanEnv, timeout: 5000 });
    version = stdout.trim();
  } catch {}

  const { authenticated } = await checkClaudeAuth(path);
  return { installed: true, authenticated, path, version };
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────

function setupClaudeHandlers(ipcMain, getMainWindow) {
  // Full status (installed + auth check)
  ipcMain.handle('claude:status', async () => {
    return await getClaudeStatus();
  });

  // Legacy: simple availability check (keeps backwards compat with useClaude.js)
  ipcMain.handle('claude:check', async () => {
    const status = await getClaudeStatus();
    return { available: status.installed && status.authenticated, path: status.path };
  });

  // Install Claude Code CLI (streams progress back to renderer)
  ipcMain.handle('claude:install', async () => {
    const mainWindow = getMainWindow();
    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;

    return new Promise((resolve) => {
      // shell:true is required on Windows to run .cmd wrappers
      const proc = spawn('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
        env: cleanEnv,
        shell: true,
        stdio: 'pipe',
      });

      const send = (type, text) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('claude:install-progress', { type, text });
        }
      };

      proc.stdout.on('data', (d) => send('stdout', d.toString()));
      proc.stderr.on('data', (d) => send('stderr', d.toString()));
      proc.on('close', async (code) => {
        if (code === 0) {
          const status = await getClaudeStatus();
          resolve({ success: true, status });
        } else {
          resolve({ success: false, error: `npm exited with code ${code}` });
        }
      });
      proc.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  });

  // Login: spawn `claude login` which opens the browser OAuth page
  ipcMain.handle('claude:login', async () => {
    const { path: claudePath } = await checkClaudeInstalled();
    if (!claudePath) return { success: false, error: 'Claude CLI not installed' };

    const mainWindow = getMainWindow();
    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;

    return new Promise((resolve) => {
      // shell:true is required on Windows to execute .cmd files
      const proc = spawn(claudePath, ['login'], {
        env: cleanEnv,
        shell: true,
        stdio: 'pipe',
      });

      const send = (type, text) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('claude:login-progress', { type, text });
        }
      };

      proc.stdout.on('data', (d) => send('stdout', d.toString()));
      proc.stderr.on('data', (d) => send('stderr', d.toString()));

      proc.on('close', async (code) => {
        const status = await getClaudeStatus();
        if (status.authenticated) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: 'Login did not complete. Please try again.' });
        }
      });

      proc.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  });

  // Logout
  ipcMain.handle('claude:logout', async () => {
    const { path: claudePath } = await checkClaudeInstalled();
    if (!claudePath) return { success: false };
    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;
    try {
      await execAsync(`"${claudePath}" logout`, { env: cleanEnv, timeout: 8000 });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Send prompt — pipe prompt via stdin, strip ANSI from output
  ipcMain.handle('claude:send', async (_, prompt, cwd, model) => {
    if (activeProcess) {
      try { activeProcess.kill(); } catch {}
      activeProcess = null;
    }

    const status = await getClaudeStatus();
    const mainWindow = getMainWindow();

    if (!status.installed) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude:error', 'Claude CLI not installed.');
      }
      return { success: false, error: 'Claude CLI not installed' };
    }

    if (!status.authenticated) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude:error', 'Not authenticated. Please log in first.');
      }
      return { success: false, error: 'Not authenticated' };
    }

    const cleanEnv = {
      ...process.env,
      // Disable color output from Claude to avoid ANSI codes
      NO_COLOR: '1',
      TERM: 'dumb',
    };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;

    try {
      // Use --print flag; on Windows with shell:true we must build the full command string
      // to avoid argument mangling with .cmd wrappers.
      // Pipe the prompt via stdin using the '-p -' pattern so special chars don't break.
      activeProcess = spawn(status.path, ['--print', '-', '--model', model || 'claude-sonnet-4-6'], {
        cwd: cwd || process.cwd(),
        env: cleanEnv,
        stdio: 'pipe',
        shell: true,
      });

      // Write the prompt to stdin and close it so claude doesn't wait
      activeProcess.stdin.write(prompt, 'utf8');
      activeProcess.stdin.end();

      let fullOutput = '';

      activeProcess.stdout.on('data', (data) => {
        const text = stripAnsi(data.toString());
        fullOutput += text;
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send('claude:data', text);
      });

      // Suppress stderr warnings (stdin warning, etc) but log to console for debugging
      activeProcess.stderr.on('data', (data) => {
        const text = stripAnsi(data.toString());
        console.log('[claude:stderr]', text);
        // Only send errors that are real errors, not warnings
        if (!text.includes('Warning:') && !text.includes('no stdin')) {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('claude:data', text);
        }
      });

      activeProcess.on('close', (code) => {
        activeProcess = null;
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send('claude:complete', { code, output: fullOutput });
      });

      activeProcess.on('error', (error) => {
        activeProcess = null;
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send('claude:error', error.message);
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
