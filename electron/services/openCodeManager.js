const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { killProcessTree } = require('./processUtils');
const { resolveNpmInvocation } = require('./environmentManager');
const { buildSubprocessEnv } = require('./subprocessEnv');

const execFileAsync = util.promisify(execFile);
const PACKAGE_NAME = 'opencode-ai';
const INSTALL_PACKAGE = `${PACKAGE_NAME}@1.17.18`;
let activeInstallation = null;

// ─── Status cache (avoids re-running opencode --version + auth list on every click) ──
const STATUS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let _statusCache = null;
let _statusCacheAt = 0;

function invalidateStatusCache() {
  _statusCache = null;
  _statusCacheAt = 0;
}

function stripAnsi(value) {
  return String(value || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
}

function getEnvironment(extra = {}) {
  const npmBin = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm');
  const nodeBin = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs');
  return buildSubprocessEnv({ extra: {
    PATH: [npmBin, nodeBin, process.env.PATH].filter(Boolean).join(path.delimiter),
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    ...extra,
  } });
}

function getNativeCandidates() {
  const npmRoot = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm');
  return [
    path.join(npmRoot, 'node_modules', PACKAGE_NAME, 'bin', 'opencode.exe'),
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links', 'opencode.exe'),
  ];
}

async function findOpenCodePath() {
  for (const candidate of getNativeCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const { stdout } = await execFileAsync('where.exe', ['opencode.exe'], {
      env: getEnvironment(),
      timeout: 7_000,
      windowsHide: true,
    });
    return stdout.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

function parseAuthProviders(output) {
  const clean = stripAnsi(output);
  const providers = [];
  for (const line of clean.split(/\r?\n/)) {
    const match = line.match(/[●•]\s+(.+?)(?:\s{2,}|\s+(?:oauth|api))?$/i);
    if (match?.[1]) providers.push(match[1].trim());
  }
  return [...new Set(providers)].slice(0, 50);
}

async function _fetchOpenCodeStatus() {
  const executablePath = await findOpenCodePath();
  if (!executablePath) return { installed: false, usable: false, authenticated: false, path: null, version: null, providers: [] };
  let version = null;
  try {
    const { stdout, stderr } = await execFileAsync(executablePath, ['--version'], {
      cwd: os.homedir(),
      env: getEnvironment(),
      timeout: 10_000,
      windowsHide: true,
    });
    version = stripAnsi(stdout || stderr).split(/\s/)[0] || null;
  } catch {}

  let providers = [];
  try {
    const { stdout, stderr } = await execFileAsync(executablePath, ['auth', 'list'], {
      cwd: os.homedir(),
      env: getEnvironment(),
      timeout: 12_000,
      windowsHide: true,
    });
    providers = parseAuthProviders(`${stdout || ''}\n${stderr || ''}`);
  } catch {}
  return {
    installed: true,
    usable: Boolean(version),
    authenticated: providers.length > 0,
    path: executablePath,
    version,
    providers,
  };
}

async function getOpenCodeStatus() {
  const now = Date.now();
  if (_statusCache && (now - _statusCacheAt) < STATUS_CACHE_TTL_MS) {
    return _statusCache;
  }
  const result = await _fetchOpenCodeStatus();
  _statusCache = result;
  _statusCacheAt = Date.now();
  return result;
}

function sanitizeProgress(value) {
  return stripAnsi(value).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

async function installOpenCode(onProgress = () => {}) {
  if (activeInstallation) return { success: false, busy: true, error: 'OpenCode installation is already running.' };
  const reservation = { process: null };
  activeInstallation = reservation;
  invalidateStatusCache(); // force fresh check during install
  const existing = await getOpenCodeStatus();
  if (existing.usable) {
    activeInstallation = null;
    return { success: true, status: existing, alreadyInstalled: true };
  }
  const npm = await resolveNpmInvocation();
  if (!npm) {
    activeInstallation = null;
    return { success: false, error: 'Node.js and npm are required to install OpenCode.' };
  }
  const invocation = { file: npm.file, args: [...npm.argsPrefix, 'install', '--global', INSTALL_PACKAGE] };

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(invocation.file, invocation.args, {
      env: getEnvironment(),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    reservation.process = child;
    const send = (type, chunk) => {
      const message = sanitizeProgress(chunk);
      if (message) onProgress({ type, message });
    };
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (activeInstallation === reservation) activeInstallation = null;
      if (!result.success) return resolve(result);
      const status = await getOpenCodeStatus();
      resolve(status.installed
        ? { success: true, status }
        : { success: false, error: 'OpenCode installation finished but the executable was not found.' });
    };
    child.stdout.on('data', (chunk) => send('stdout', chunk));
    child.stderr.on('data', (chunk) => send('stderr', chunk));
    child.once('error', (error) => finish({ success: false, error: error.message }));
    child.once('close', (code) => finish(code === 0
      ? { success: true }
      : { success: false, error: `OpenCode installer exited with code ${code}.` }));
  });
}

function terminateAllOpenCodeProcesses() {
  if (!activeInstallation) return 0;
  if (activeInstallation.process) killProcessTree(activeInstallation.process);
  else activeInstallation = null;
  return 1;
}

function setupOpenCodeHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('opencode:status', () => getOpenCodeStatus());
  ipcMain.handle('opencode:install', async (event) => {
    const mainWindow = getMainWindow?.();
    if (!mainWindow || mainWindow.isDestroyed?.() || event.sender !== mainWindow.webContents) {
      return { success: false, error: 'OpenCode installation request was rejected.' };
    }
    const { dialog } = require('electron');
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Install OpenCode',
      message: 'Install the official OpenCode agent?',
      detail: `Vibe IDE Code will install only ${INSTALL_PACKAGE} through npm. Claude Code and Codex will not be downloaded.`,
      buttons: ['Cancel', 'Install OpenCode'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { success: false, cancelled: true };
    return installOpenCode((progress) => {
    const mainWindow = getMainWindow?.();
    if (mainWindow && !mainWindow.isDestroyed?.()) mainWindow.webContents.send('opencode:install-progress', progress);
    });
  });
}

module.exports = {
  INSTALL_PACKAGE,
  PACKAGE_NAME,
  findOpenCodePath,
  getNativeCandidates,
  getOpenCodeStatus,
  installOpenCode,
  parseAuthProviders,
  setupOpenCodeHandlers,
  terminateAllOpenCodeProcesses,
};
