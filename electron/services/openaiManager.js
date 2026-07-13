const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const util = require('util');
const { validateProjectCwd } = require('../ipc/fsGuards');
const { isProjectRegistered } = require('./projectManager');
const { killProcessTree } = require('./processUtils');

const execFileAsync = util.promisify(execFile);

const CODEX_TARGETS = {
  x64: { packageName: '@openai/codex-win32-x64', triple: 'x86_64-pc-windows-msvc' },
  arm64: { packageName: '@openai/codex-win32-arm64', triple: 'aarch64-pc-windows-msvc' },
};

const FALLBACK_MODELS = [
  { id: 'gpt-5.4', name: 'GPT-5.4', description: 'Strong model for everyday coding.', defaultReasoning: 'medium', reasoningLevels: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', description: 'Fast and efficient for simpler tasks.', defaultReasoning: 'medium', reasoningLevels: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'gpt-5.5', name: 'GPT-5.5', description: 'Frontier model for complex work.', defaultReasoning: 'medium', reasoningLevels: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Most capable model for ambitious work.', defaultReasoning: 'medium', reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', description: 'Balanced model for everyday work.', defaultReasoning: 'medium', reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', description: 'Fast and affordable model.', defaultReasoning: 'medium', reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
];

let activeRun = null;
let activeLogin = null;
let nextRunId = 1;
let currentRunId = 0;

function cleanProviderEnv() {
  const env = { ...process.env, NO_COLOR: '1', TERM: 'dumb' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  return env;
}

function resolveCodexPath() {
  const target = CODEX_TARGETS[process.arch];
  if (process.platform !== 'win32' || !target) throw new Error(`Unsupported Codex platform: ${process.platform}-${process.arch}.`);
  const packageRoot = path.dirname(require.resolve(`${target.packageName}/package.json`));
  let executable = path.join(packageRoot, 'vendor', target.triple, 'bin', 'codex.exe');
  executable = executable.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  if (!fs.existsSync(executable)) throw new Error('The official OpenAI Codex executable is unavailable. Reinstall Vibe IDE Code.');
  return executable;
}

function assertSafeModel(model) {
  if (!model) return null;
  if (!/^[a-zA-Z0-9._:/-]+$/.test(model)) throw new Error('Invalid model name.');
  return model;
}

function assertSafeReasoning(reasoning) {
  const value = reasoning || 'medium';
  if (!['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value)) throw new Error('Invalid reasoning level.');
  return value;
}

function isSupportedModelVersion(slug) {
  const match = String(slug || '').match(/^gpt-(\d+)\.(\d+)(?:-|$)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 5 || (major === 5 && minor >= 4);
}

function normalizeModelCatalog(payload) {
  const source = Array.isArray(payload) ? payload : payload?.models;
  if (!Array.isArray(source)) return FALLBACK_MODELS;
  const models = source
    .filter((model) => model.visibility === 'list' && isSupportedModelVersion(model.slug))
    .map((model) => ({
      id: model.slug,
      name: model.display_name || model.slug,
      description: model.description || '',
      defaultReasoning: model.default_reasoning_level || 'medium',
      reasoningLevels: (model.supported_reasoning_levels || []).map((level) => level.effort).filter(Boolean),
    }));
  if (!models.some((model) => model.id === 'gpt-5.4')) return FALLBACK_MODELS;
  return models.sort((left, right) => {
    if (left.id === 'gpt-5.4') return -1;
    if (right.id === 'gpt-5.4') return 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true });
  });
}

async function getOpenAIModels() {
  try {
    const { stdout } = await execFileAsync(resolveCodexPath(), ['debug', 'models'], {
      env: cleanProviderEnv(),
      timeout: 20000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { models: normalizeModelCatalog(JSON.parse(stdout)), defaultModel: 'gpt-5.4' };
  } catch {
    return { models: FALLBACK_MODELS, defaultModel: 'gpt-5.4' };
  }
}

function buildCodexExecArgs(model, reasoning) {
  const validatedModel = assertSafeModel(model);
  const validatedReasoning = assertSafeReasoning(reasoning);
  return [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color', 'never',
    '--sandbox', 'workspace-write',
    ...(validatedModel ? ['--model', validatedModel] : []),
    '--config', `model_reasoning_effort="${validatedReasoning}"`,
    '-',
  ];
}

async function getOpenAIStatus() {
  let executable;
  try {
    executable = resolveCodexPath();
  } catch (error) {
    return { installed: false, authenticated: false, email: null, provider: 'OpenAI', error: error.message };
  }
  try {
    const { stdout, stderr } = await execFileAsync(executable, ['login', 'status'], {
      env: cleanProviderEnv(),
      timeout: 8000,
      windowsHide: true,
    });
    const output = `${stdout}\n${stderr}`.trim();
    const authenticated = /logged in/i.test(output);
    return {
      installed: true,
      authenticated,
      email: authenticated ? (/chatgpt/i.test(output) ? 'ChatGPT account' : 'OpenAI account') : null,
      provider: 'OpenAI',
    };
  } catch (error) {
    return { installed: true, authenticated: false, email: null, provider: 'OpenAI', error: error.stderr?.trim() || null };
  }
}

function sendLoginProgress(mainWindow, type, text) {
  if (text && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('openai:login-progress', { type, text });
  }
}

function loginWithOpenAI(mainWindow) {
  if (activeLogin) return Promise.resolve({ success: false, error: 'OpenAI authentication is already in progress.' });
  return new Promise((resolve) => {
    let executable;
    try {
      executable = resolveCodexPath();
    } catch (error) {
      resolve({ success: false, error: error.message });
      return;
    }

    const child = spawn(executable, ['login'], {
      env: cleanProviderEnv(),
      windowsHide: true,
      stdio: 'pipe',
    });
    activeLogin = child;
    sendLoginProgress(mainWindow, 'info', 'Se abrió la autenticación oficial de OpenAI en tu navegador.');

    child.stdout.on('data', (data) => sendLoginProgress(mainWindow, 'info', data.toString().trim()));
    child.stderr.on('data', (data) => sendLoginProgress(mainWindow, 'info', data.toString().trim()));
    child.on('error', (error) => {
      activeLogin = null;
      resolve({ success: false, error: error.message });
    });
    child.on('close', async (code) => {
      activeLogin = null;
      const status = await getOpenAIStatus();
      resolve(status.authenticated
        ? { success: true, state: status }
        : { success: false, error: code === 0 ? 'OpenAI authentication did not complete.' : `Codex login exited with code ${code}.` });
    });
  });
}

async function logoutFromOpenAI() {
  try {
    await execFileAsync(resolveCodexPath(), ['logout'], {
      env: cleanProviderEnv(),
      timeout: 10000,
      windowsHide: true,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function sendChatMessage(prompt, conversationHistory = [], model, reasoning, cwd, mainWindow) {
  return new Promise((resolve) => {
    let validatedCwd;
    let executable;
    let args;
    try {
      validatedCwd = validateProjectCwd(cwd, isProjectRegistered);
      executable = resolveCodexPath();
      args = buildCodexExecArgs(model, reasoning);
    } catch (error) {
      resolve({ success: false, error: error.message });
      return;
    }

    const runId = nextRunId++;
    currentRunId = runId;
    const previousRun = activeRun;
    activeRun = null;
    if (previousRun) killProcessTree(previousRun.process);

    const child = spawn(executable, args, {
      cwd: validatedCwd,
      env: cleanProviderEnv(),
      windowsHide: true,
      stdio: 'pipe',
    });
    activeRun = { id: runId, process: child };

    let fullPrompt = '';
    for (const message of conversationHistory) {
      if (message.role === 'user') fullPrompt += `User: ${message.content}\n\n`;
      if (message.role === 'assistant') fullPrompt += `Assistant: ${message.content}\n\n`;
    }
    fullPrompt += `User: ${String(prompt || '')}\n`;
    child.stdin.end(fullPrompt, 'utf8');

    let fullOutput = '';
    let errorOutput = '';
    child.stdout.on('data', (data) => {
      if (currentRunId !== runId || activeRun?.id !== runId) return;
      const text = data.toString();
      fullOutput += text;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('openai:data', text);
    });
    child.stderr.on('data', (data) => { errorOutput += data.toString(); });
    child.on('error', (error) => {
      if (currentRunId !== runId || activeRun?.id !== runId) return resolve({ success: false, cancelled: true });
      activeRun = null;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('openai:error', error.message);
      resolve({ success: false, error: error.message });
    });
    child.on('close', (code) => {
      if (currentRunId !== runId || activeRun?.id !== runId) return resolve({ success: false, cancelled: true });
      activeRun = null;
      if (code !== 0) {
        const error = errorOutput.trim() || `Codex exited with code ${code}.`;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('openai:error', error);
        resolve({ success: false, code, error });
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('openai:complete', { code, success: true, output: fullOutput });
      resolve({ success: true, code, output: fullOutput });
    });
  });
}

function setupOpenAIHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('openai:status', () => getOpenAIStatus());
  ipcMain.handle('openai:models', () => getOpenAIModels());
  ipcMain.handle('openai:login', () => loginWithOpenAI(getMainWindow()));
  ipcMain.handle('openai:logout', () => logoutFromOpenAI());
  ipcMain.handle('openai:send', (_, prompt, history, model, reasoning, cwd) => sendChatMessage(prompt, history || [], model, reasoning, cwd, getMainWindow()));
  ipcMain.handle('openai:cancel', () => {
    currentRunId = nextRunId++;
    if (activeRun) killProcessTree(activeRun.process);
    activeRun = null;
    return { success: true };
  });
}

function terminateAllOpenAIProcesses() {
  currentRunId = nextRunId++;
  if (activeRun) killProcessTree(activeRun.process);
  if (activeLogin) killProcessTree(activeLogin);
  activeRun = null;
  activeLogin = null;
}

module.exports = { buildCodexExecArgs, getOpenAIModels, getOpenAIStatus, normalizeModelCatalog, resolveCodexPath, setupOpenAIHandlers, terminateAllOpenAIProcesses };
