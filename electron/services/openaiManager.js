const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { validateProjectCwd } = require('../ipc/fsGuards');
const { isProjectRegistered } = require('./projectManager');
const { killProcessTree } = require('./processUtils');

// Vibe IDE Code never stores provider credentials. OpenCode owns its local auth.

async function getOpenAIStatus() {
  try {
    const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
    if (fs.existsSync(authPath)) {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      if (auth.openai && auth.openai.accessToken) {
        // Try to decode JWT if present to show email
        try {
          const parts = auth.openai.accessToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            return { authenticated: true, email: payload.email || payload.sub || 'OpenAI API' };
          }
        } catch {}
        return { authenticated: true, email: 'OpenAI API' };
      }
    }
  } catch (err) {
    console.error('[OpenAI Status Error]', err);
  }
  return { authenticated: false, email: null };
}

// ─── ANSI Stripper ──────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// ─── Chat with ChatGPT via opencode CLI ──────────────────────────────────────

let activeRun = null;
let nextRunId = 1;
let currentRunId = 0;

function resolveOpenCodePath(projectPath) {
  const output = execFileSync('where.exe', ['opencode.cmd'], {
    cwd: os.homedir(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  const resolved = output.trim().split(/\r?\n/).find(Boolean);
  if (!resolved || !path.isAbsolute(resolved)) throw new Error('OpenCode CLI is not installed or not available in PATH.');
  const relative = projectPath ? path.relative(projectPath, resolved) : '..';
  if (projectPath && relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('OpenCode must be installed outside the project directory.');
  }
  return resolved;
}

function assertSafeModel(model) {
  if (!model) return null;
  const value = model;
  if (!/^[a-zA-Z0-9._:/-]+$/.test(value)) throw new Error('Invalid model name.');
  return value;
}

async function sendChatMessage(prompt, conversationHistory = [], model, cwd, mainWindow) {
  return new Promise((resolve) => {
    let validatedCwd;
    let validatedModel;
    let opencodePath;
    try {
      validatedCwd = validateProjectCwd(cwd, isProjectRegistered);
      validatedModel = assertSafeModel(model);
      opencodePath = resolveOpenCodePath(validatedCwd);
    } catch (error) {
      resolve({ success: false, error: error.message });
      return;
    }

    const runId = nextRunId++;
    currentRunId = runId;
    const previousRun = activeRun;
    activeRun = null;
    if (previousRun) {
      killProcessTree(previousRun.process);
    }

    // Prefix the model with openai/ for the opencode CLI
    const prefixedModel = validatedModel && (validatedModel.startsWith('openai/') ? validatedModel : `openai/${validatedModel}`);

    const cleanEnv = {
      ...process.env,
      NO_COLOR: '1',
      TERM: 'dumb',
    };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;

    try {
      // Spawn opencode run and pipe the prompt to stdin
      const commandLine = prefixedModel
        ? `"${opencodePath}" run - --model ${prefixedModel}`
        : `"${opencodePath}" run -`;
      const proc = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
        cwd: validatedCwd,
        env: cleanEnv,
        stdio: 'pipe',
        shell: false,
      });
      activeRun = { id: runId, process: proc };

      // Pass conversation history along with the new prompt
      // opencode handles previous session continuation via flags, but for stateless we just inject history
      let fullPrompt = '';
      for (const msg of conversationHistory) {
        if (msg.role === 'user') fullPrompt += `User: ${msg.content}\n\n`;
        if (msg.role === 'assistant') fullPrompt += `Assistant: ${msg.content}\n\n`;
      }
      fullPrompt += `User: ${prompt}\n`;

      proc.stdin.write(fullPrompt, 'utf8');
      proc.stdin.end();

      let fullOutput = '';

      proc.stdout.on('data', (data) => {
        if (currentRunId !== runId || activeRun?.id !== runId) return;
        const text = stripAnsi(data.toString());
        fullOutput += text;
        const win = mainWindow || null;
        if (win && !win.isDestroyed()) win.webContents.send('openai:data', text);
      });

      proc.stderr.on('data', (data) => {
        if (currentRunId !== runId || activeRun?.id !== runId) return;
        const text = stripAnsi(data.toString());
        console.log('[openai:stderr]', text);
        if (!text.includes('Warning:') && !text.includes('no stdin')) {
          const win = mainWindow || null;
          if (win && !win.isDestroyed()) win.webContents.send('openai:data', text);
        }
      });

      proc.on('close', (code) => {
        if (currentRunId !== runId || activeRun?.id !== runId) {
          resolve({ success: false, cancelled: true });
          return;
        }
        activeRun = null;
        const win = mainWindow || null;
        if (win && !win.isDestroyed()) win.webContents.send('openai:complete', { code, success: code === 0, output: fullOutput });
        resolve({ success: code === 0, code, error: code === 0 ? undefined : `opencode exited with code ${code}` });
      });

      proc.on('error', (error) => {
        if (currentRunId !== runId || activeRun?.id !== runId) {
          resolve({ success: false, cancelled: true });
          return;
        }
        activeRun = null;
        const win = mainWindow || null;
        if (win && !win.isDestroyed()) win.webContents.send('openai:error', error.message);
        resolve({ success: false, error: error.message });
      });

    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

// ─── IPC Setup ─────────────────────────────────────────────────────────────

function setupOpenAIHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('openai:status', async () => {
    return await getOpenAIStatus();
  });

  ipcMain.handle('openai:login', async () => {
    try {
      const command = process.env.ComSpec || 'cmd.exe';
      const opencodePath = resolveOpenCodePath();
      const child = spawn(command, ['/d', '/s', '/c', `start "OpenCode authentication" "${opencodePath}" auth login`], {
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
        shell: false,
      });
      child.unref();
      return { success: true, pending: true };
    } catch (error) {
      return { success: false, error: `Could not launch OpenCode authentication: ${error.message}` };
    }
  });

  ipcMain.handle('openai:logout', () => {
    try {
      const command = process.env.ComSpec || 'cmd.exe';
      const opencodePath = resolveOpenCodePath();
      const child = spawn(command, ['/d', '/s', '/c', `start "OpenCode logout" "${opencodePath}" auth logout`], {
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
        shell: false,
      });
      child.unref();
      return { success: true, pending: true };
    } catch (error) {
      return { success: false, error: `Could not launch OpenCode logout: ${error.message}` };
    }
  });

  ipcMain.handle('openai:send', async (_, prompt, conversationHistory, model, cwd) => {
    const mainWindow = getMainWindow();
    try {
      return await sendChatMessage(prompt, conversationHistory || [], model, cwd, mainWindow);
    } catch (err) {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('openai:error', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('openai:cancel', () => {
    currentRunId = nextRunId++;
    if (activeRun) {
      const run = activeRun;
      activeRun = null;
      killProcessTree(run.process);
    }
    return { success: true };
  });
}

function terminateAllOpenAIProcesses() {
  currentRunId = nextRunId++;
  if (activeRun) killProcessTree(activeRun.process);
  activeRun = null;
}

module.exports = { setupOpenAIHandlers, terminateAllOpenAIProcesses };
