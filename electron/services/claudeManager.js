const { spawn, execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const fs = require('fs');
const path = require('path');
const { validateProjectCwd } = require('../ipc/fsGuards');
const { isProjectRegistered } = require('./projectManager');
const { killProcessTree } = require('./processUtils');
const { resolveNpmInvocation } = require('./environmentManager');

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

let activeRun = null;
let nextRunId = 1;
let currentRunId = 0;
const backgroundProcesses = new Set();

function trackBackgroundProcess(processHandle) {
  backgroundProcesses.add(processHandle);
  processHandle.once('close', () => backgroundProcesses.delete(processHandle));
  processHandle.once('error', () => backgroundProcesses.delete(processHandle));
  return processHandle;
}

function assertSafeModel(model) {
  const value = model || 'claude-sonnet-4-6';
  if (!/^[a-zA-Z0-9._:/-]+$/.test(value)) throw new Error('Invalid model name.');
  return value;
}

// ─── Detection ──────────────────────────────────────────────────────────────

async function findClaudePath() {
  const isWin = process.platform === 'win32';
  if (isWin) {
    const nativePath = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (fs.existsSync(nativePath)) return nativePath;
  }

  const candidates = isWin
    ? ['claude.cmd', 'claude']
    : ['claude'];

  for (const name of candidates) {
    try {
      const { stdout } = await execFileAsync(isWin ? 'where.exe' : 'which', [name], { timeout: 5000, windowsHide: true });
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
        const { stdout } = await execFileAsync(npmBin, ['--version'], { timeout: 5000, windowsHide: true });
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
    const { stdout, stderr } = await execFileAsync(claudePath, ['--version'], {
      env: cleanEnv,
      timeout: 8000,
      windowsHide: true,
    });
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
    const { stdout } = await execFileAsync(path, ['--version'], { env: cleanEnv, timeout: 5000, windowsHide: true });
    version = stdout.trim();
  } catch {}

  const { authenticated } = await checkClaudeAuth(path);
  return { installed: true, authenticated, path, version };
}

async function installClaudeCode(onProgress = () => {}) {
  const npm = await resolveNpmInvocation();
  if (!npm) return { success: false, error: 'Node.js and npm are required to install Claude Code.' };
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  delete cleanEnv.ELECTRON_NO_ASAR;

  return new Promise((resolve) => {
    const proc = trackBackgroundProcess(spawn(npm.file, [...npm.argsPrefix, 'install', '--global', '@anthropic-ai/claude-code'], {
      env: cleanEnv,
      shell: false,
      stdio: 'pipe',
      windowsHide: true,
    }));
    proc.stdout.on('data', (data) => onProgress({ type: 'stdout', text: data.toString() }));
    proc.stderr.on('data', (data) => onProgress({ type: 'stderr', text: data.toString() }));
    proc.on('close', async (code) => {
      if (code !== 0) return resolve({ success: false, error: `npm exited with code ${code}` });
      resolve({ success: true, status: await getClaudeStatus() });
    });
    proc.on('error', (error) => resolve({ success: false, error: error.message }));
  });
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
    return installClaudeCode(({ type, text }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude:install-progress', { type, text });
      }
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
      const proc = trackBackgroundProcess(spawn(claudePath, ['login'], {
        env: cleanEnv,
        shell: /\.cmd$/i.test(claudePath),
        stdio: 'pipe',
        windowsHide: true,
      }));

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
      await execFileAsync(claudePath, ['logout'], { env: cleanEnv, timeout: 8000, windowsHide: true });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Send prompt — pipe prompt via stdin, strip ANSI from output
  ipcMain.handle('claude:send', async (_, prompt, cwd, model) => {
    let validatedCwd;
    let validatedModel;
    try {
      validatedCwd = validateProjectCwd(cwd, isProjectRegistered);
      validatedModel = assertSafeModel(model);
    } catch (error) {
      return { success: false, error: error.message };
    }

    const runId = nextRunId++;
    currentRunId = runId;
    const previousRun = activeRun;
    activeRun = null;
    if (previousRun) {
      killProcessTree(previousRun.process);
    }

    const status = await getClaudeStatus();
    const mainWindow = getMainWindow();

    if (currentRunId !== runId) return { success: false, cancelled: true };

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
      const proc = spawn(status.path, ['--print', '-', '--model', validatedModel], {
        cwd: validatedCwd,
        env: cleanEnv,
        stdio: 'pipe',
        shell: /\.cmd$/i.test(status.path),
        windowsHide: true,
      });
      activeRun = { id: runId, process: proc };

      // Write the prompt to stdin and close it so claude doesn't wait
      proc.stdin.write(String(prompt || ''), 'utf8');
      proc.stdin.end();

      let fullOutput = '';

      proc.stdout.on('data', (data) => {
        if (currentRunId !== runId || activeRun?.id !== runId) return;
        const text = stripAnsi(data.toString());
        fullOutput += text;
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send('claude:data', text);
      });

      // Suppress stderr warnings (stdin warning, etc) but log to console for debugging
      proc.stderr.on('data', (data) => {
        if (currentRunId !== runId || activeRun?.id !== runId) return;
        const text = stripAnsi(data.toString());
        console.log('[claude:stderr]', text);
        // Only send errors that are real errors, not warnings
        if (!text.includes('Warning:') && !text.includes('no stdin')) {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) win.webContents.send('claude:data', text);
        }
      });

      proc.on('close', (code) => {
        if (currentRunId !== runId || activeRun?.id !== runId) return;
        activeRun = null;
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send('claude:complete', { code, success: code === 0, output: fullOutput });
      });

      proc.on('error', (error) => {
        if (currentRunId !== runId || activeRun?.id !== runId) return;
        activeRun = null;
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send('claude:error', error.message);
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('claude:cancel', () => {
    currentRunId = nextRunId++;
    if (activeRun) {
      const run = activeRun;
      activeRun = null;
      killProcessTree(run.process);
    }
    return { success: true };
  });
}

function terminateAllClaudeProcesses() {
  currentRunId = nextRunId++;
  if (activeRun) killProcessTree(activeRun.process);
  activeRun = null;
  for (const processHandle of backgroundProcesses) killProcessTree(processHandle);
  backgroundProcesses.clear();
}

module.exports = { installClaudeCode, setupClaudeHandlers, terminateAllClaudeProcesses };
