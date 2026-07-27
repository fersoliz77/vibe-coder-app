const { app, BrowserWindow, ipcMain, shell, session, clipboard } = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const os = require('os');
const fs = require('fs');
const { setupWindowHandlers } = require('./ipc/windowManager');
const { setupDialogHandlers } = require('./ipc/dialogManager');
const { setupFileSystemHandlers } = require('./ipc/fileSystemManager');
const { setupServiceHandlers } = require('./services/serviceManager');
const { setupTerminalHandlers, terminateAllTerminals } = require('./services/terminalManager');
const { installClaudeCode, setupClaudeHandlers, terminateAllClaudeProcesses } = require('./services/claudeManager');
const { setupOpenAIHandlers, terminateAllOpenAIProcesses } = require('./services/openaiManager');
const { installOpenCode, setupOpenCodeHandlers, terminateAllOpenCodeProcesses } = require('./services/openCodeManager');
const { initProjectManager, setupProjectHandlers, registerProject } = require('./services/projectManager');
const { installAllEnvironment, setupEnvironmentHandlers, cancelEnvironmentInstallation } = require('./services/environmentManager');
const { setupProjectProvisionerHandlers } = require('./services/projectProvisioner');
const { setupPreviewHandlers, terminateAllPreviews } = require('./services/previewManager');
const { setupStoreHandlers } = require('./ipc/storeManager');
const { AuthService, setupAuthHandlers } = require('./auth/authService');
const { AuthRealtime } = require('./auth/authRealtime');
const { AdminSignupAlerts } = require('./auth/adminSignupAlerts');
const { StudentBroadcastAlerts } = require('./auth/studentBroadcastAlerts');
const { installIpcAuthorization } = require('./auth/ipcGuard');

// Required on Windows for Notification (native OS toast, used by admin signup
// alerts) to show with the correct app identity and icon.
app.setAppUserModelId('com.vibeidecoder.app');

if (!app.isPackaged) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const envFile = require('fs').readFileSync(envPath, 'utf8');
    for (const line of envFile.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

let mainWindow;

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
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    icon: app.isPackaged
      ? path.join(__dirname, '..', 'dist', 'icon.png')
      : path.join(__dirname, '..', 'public', 'icon.png'),
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (/^https:\/\//i.test(targetUrl)) shell.openExternal(targetUrl);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    let allowed = false;
    try {
      const parsed = new URL(targetUrl);
      if (app.isPackaged && parsed.protocol === 'file:') {
        const targetPath = path.resolve(fileURLToPath(parsed));
        const entryPath = path.resolve(__dirname, '..', 'dist', 'index.html');
        allowed = targetPath === entryPath;
      } else if (!app.isPackaged) {
        allowed = parsed.origin === 'http://localhost:5173';
      }
    } catch {}
    if (!allowed) event.preventDefault();
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
    if (process.env.VIBE_OPEN_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

const isEnvironmentInstaller = process.argv.includes('--install-environment');

if (isEnvironmentInstaller) {
  app.whenReady().then(async () => {
    let bootstrapWindow;
    const languagePath = path.join(app.getPath('userData'), 'installer-preferences.json');
    const readLanguage = () => {
      try { return JSON.parse(fs.readFileSync(languagePath, 'utf8')).language === 'es' ? 'es' : 'en'; } catch { return 'en'; }
    };
    const saveLanguage = (language) => {
      fs.mkdirSync(path.dirname(languagePath), { recursive: true });
      fs.writeFileSync(languagePath, JSON.stringify({ language }), { encoding: 'utf8', mode: 0o600 });
      // Keep the installer choice available to the renderer's existing config store.
      const configPath = path.join(app.getPath('userData'), 'config.json');
      let config = {};
      try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      fs.writeFileSync(configPath, JSON.stringify({ ...config, language }, null, 2), { encoding: 'utf8', mode: 0o600 });
    };
    const messages = {
      en: { title: 'Preparing your development environment', starting: 'Starting setup...', environment: 'Development environment', checking: 'Checking required tools', queuedOpenCode: 'Queued after environment setup', queuedClaude: 'Queued after OpenCode', environmentReady: 'Required tools and Android development files are prepared.', installOpenCode: 'Installing the OpenCode CLI', installingOpenCode: 'Installing OpenCode...', openCodeMissing: 'OpenCode could not be installed.', openCodeReady: 'Installed and ready.', openCodeAlready: 'Already installed and ready.', installClaude: 'Installing the Claude Code CLI', installingClaude: 'Installing Claude Code...', claudeMissing: 'Claude Code could not be installed.', ready: 'Environment ready', attention: 'Environment setup needs attention', failedEnvironment: 'One or more required tools could not be installed.', review: 'Review the details below, then close this window.', complete: 'Your tools are installed. The Android emulator was prepared but was not launched.', unexpected: 'Setup stopped unexpectedly' },
      es: { title: 'Preparando tu entorno de desarrollo', starting: 'Iniciando configuracion...', environment: 'Entorno de desarrollo', checking: 'Comprobando herramientas necesarias', queuedOpenCode: 'En cola despues del entorno', queuedClaude: 'En cola despues de OpenCode', environmentReady: 'Las herramientas necesarias y los archivos de Android estan preparados.', installOpenCode: 'Instalando la CLI de OpenCode', installingOpenCode: 'Instalando OpenCode...', openCodeMissing: 'No se pudo instalar OpenCode.', openCodeReady: 'Instalado y listo.', openCodeAlready: 'Ya esta instalado y listo.', installClaude: 'Instalando la CLI de Claude Code', installingClaude: 'Instalando Claude Code...', claudeMissing: 'No se pudo instalar Claude Code.', ready: 'Entorno listo', attention: 'La configuracion necesita atencion', failedEnvironment: 'No se pudieron instalar una o mas herramientas necesarias.', review: 'Revisa los detalles y despues cierra esta ventana.', complete: 'Tus herramientas estan instaladas. El emulador de Android se preparo, pero no se inicio.', unexpected: 'La configuracion se detuvo inesperadamente' },
    };
    const system = {
      platform: process.platform === 'win32' ? 'Windows' : os.platform(),
      cpu: `${os.cpus().length} CPU`,
      memory: `${Math.round(os.totalmem() / 1024 ** 3)} GB RAM`,
    };
    let bootstrapState = {
      status: 'welcome',
      language: readLanguage(),
      title: '',
      detail: '',
      progress: 0,
      total: 0,
      current: 0,
      stages: [],
      output: [],
      system,
    };
    let exitCode = 1;
    let exitScheduled = false;

    const publish = (update) => {
      bootstrapState = { ...bootstrapState, ...update };
      if (bootstrapWindow && !bootstrapWindow.isDestroyed()) {
        bootstrapWindow.webContents.send('bootstrap:status', bootstrapState);
      }
    };
    const addOutput = (message) => {
      if (!message) return;
      const output = [...bootstrapState.output, String(message).replace(/\s+/g, ' ').trim()].filter(Boolean).slice(-6);
      publish({ output });
    };
    const finish = (success, detail) => {
      const t = messages[bootstrapState.language];
      exitCode = success ? 0 : 1;
      publish({
        status: success ? 'success' : 'failure',
        title: success ? t.ready : t.attention,
        detail,
        progress: success ? bootstrapState.total : bootstrapState.progress,
        current: success ? bootstrapState.total : bootstrapState.current,
        stages: bootstrapState.stages.map((stage) => stage.status === 'active' ? { ...stage, status: success ? 'complete' : 'failed' } : stage),
      });
    };
    const createBootstrapWindow = () => {
      bootstrapWindow = new BrowserWindow({
        width: 660,
        height: 680,
        minWidth: 420,
        minHeight: 560,
        resizable: true,
        frame: false,
        backgroundColor: '#0a0d14',
        title: 'Vibe IDE Code Setup',
        webPreferences: {
          preload: path.join(__dirname, 'bootstrap-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      bootstrapWindow.removeMenu();
      bootstrapWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      bootstrapWindow.webContents.on('will-navigate', (event) => event.preventDefault());
      bootstrapWindow.on('close', (event) => {
        if (bootstrapState.status === 'welcome' && !exitScheduled) {
          event.preventDefault();
          exitScheduled = true;
          app.exit(1);
          return;
        }
        if (bootstrapState.status === 'running') event.preventDefault();
        if (bootstrapState.status === 'failure' && !exitScheduled) {
          event.preventDefault();
          exitScheduled = true;
          app.exit(1);
        }
      });
      bootstrapWindow.loadFile(path.join(__dirname, 'bootstrap.html'));
    };

    ipcMain.handle('bootstrap:get-status', () => bootstrapState);
    ipcMain.on('bootstrap:acknowledge', () => {
      if (['success', 'failure'].includes(bootstrapState.status) && !exitScheduled) {
        exitScheduled = true;
        app.exit(exitCode);
      }
    });
    ipcMain.handle('bootstrap:copy-details', () => {
      clipboard.writeText([bootstrapState.title, bootstrapState.detail, ...bootstrapState.output].filter(Boolean).join('\n'));
      return true;
    });
    ipcMain.on('bootstrap:open-app', () => {
      if (bootstrapState.status !== 'success' || exitScheduled) return;
      exitScheduled = true;
      app.relaunch({ args: [] });
      app.exit(0);
    });

    const runInstallation = async () => {
      const t = messages[bootstrapState.language];
      publish({
        status: 'running', title: t.title, detail: t.starting, total: 0, current: 0, progress: 0, output: [],
        stages: [
          { id: 'environment', label: t.environment, detail: t.checking, status: 'active' },
          { id: 'opencode', label: 'OpenCode', detail: t.queuedOpenCode, status: 'pending' },
          { id: 'claude', label: 'Claude Code', detail: t.queuedClaude, status: 'pending' },
        ],
      });

    try {
      const updateStage = (id, update) => publish({
        stages: bootstrapState.stages.map((stage) => stage.id === id ? { ...stage, ...update } : stage),
      });
      const environment = await installAllEnvironment({ includeMobile: true, backend: 'firebase' }, (event) => {
        if (event.type === 'start') {
          const total = (event.total || 0) + 2;
          publish({ total, current: event.current || 0, progress: 0, detail: event.message });
        }
        if (event.type === 'step-start') {
          updateStage('environment', { detail: event.message, status: 'active' });
          publish({ current: event.current || 0, progress: event.current || 0, detail: event.message });
        }
        if (event.type === 'step-complete') {
          publish({ current: event.current || 0, progress: event.current || 0, detail: event.message });
        }
        if (event.type === 'output') addOutput(event.message);
        if (event.type === 'step-error' || event.type === 'error') addOutput(event.message);
      });
      if (!environment.success) {
        updateStage('environment', { status: 'failed', detail: environment.error || t.failedEnvironment });
        return finish(false, `${environment.error || t.failedEnvironment} ${t.review}`);
      }

      updateStage('environment', { status: 'complete', detail: t.environmentReady });
      updateStage('opencode', { status: 'active', detail: t.installOpenCode });
      publish({ current: Math.max(1, bootstrapState.total - 1), progress: Math.max(1, bootstrapState.total - 1), detail: t.installingOpenCode });
      const openCode = await installOpenCode((event) => addOutput(event.message));
      if (!openCode.success) {
        updateStage('opencode', { status: 'failed', detail: openCode.error || t.openCodeMissing });
        return finish(false, `${openCode.error || t.openCodeMissing} ${t.review}`);
      }

      updateStage('opencode', { status: 'complete', detail: openCode.alreadyInstalled ? t.openCodeAlready : t.openCodeReady });
      updateStage('claude', { status: 'active', detail: t.installClaude });
      publish({ current: bootstrapState.total, progress: bootstrapState.total, detail: t.installingClaude });
      const claude = await installClaudeCode((event) => addOutput(event.text));
      if (!claude.success) {
        updateStage('claude', { status: 'failed', detail: claude.error || t.claudeMissing });
        return finish(false, `${claude.error || t.claudeMissing} ${t.review}`);
      }

      updateStage('claude', { status: 'complete', detail: t.openCodeReady });
      finish(true, t.complete);
    } catch (error) {
      addOutput(error.message);
      finish(false, `${t.unexpected}: ${error.message}`);
    }
    };
    ipcMain.on('bootstrap:start', (_event, requestedLanguage) => {
      if (bootstrapState.status !== 'welcome') return;
      const language = requestedLanguage === 'es' ? 'es' : 'en';
      try { saveLanguage(language); } catch (error) { addOutput(`Could not save installer language: ${error.message}`); }
      publish({ language });
      runInstallation();
    });
    createBootstrapWindow();
  });
} else app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();

  const authService = new AuthService();
  authService.initialize();
  let previousPolicy = authService.getPolicy();
  let leaseTimer = null;
  let notifyAuthState;
  let authRealtime;
  let adminSignupAlerts;
  let studentBroadcastAlerts;
  let projectProvisioner;
  const revalidateAndNotify = async () => {
    if (!authService.getState().authenticated) return;
    await authService.revalidate();
    notifyAuthState?.();
  };
  const handleAuthState = (state) => {
    if (previousPolicy === 'active' && state.policy !== 'active') {
      terminateAllTerminals();
      terminateAllClaudeProcesses();
      terminateAllOpenAIProcesses();
      terminateAllOpenCodeProcesses();
      cancelEnvironmentInstallation();
      projectProvisioner?.terminateAllProvisions();
      terminateAllPreviews();
    }
    previousPolicy = state.policy;
    if (leaseTimer) clearTimeout(leaseTimer);
    const expiresAt = Date.parse(state.leaseExpiresAt);
    if (state.authenticated && Number.isFinite(expiresAt)) {
      const delay = Math.max(0, expiresAt - Date.now());
      leaseTimer = setTimeout(() => notifyAuthState?.(), Math.min(delay, 2_147_483_647));
      leaseTimer.unref();
    }
    authRealtime?.sync().catch(() => {});
    adminSignupAlerts?.sync().catch(() => {});
    studentBroadcastAlerts?.sync().catch(() => {});
  };
  notifyAuthState = setupAuthHandlers(ipcMain, authService, () => mainWindow, handleAuthState);
  authRealtime = new AuthRealtime(authService, revalidateAndNotify);
  adminSignupAlerts = new AdminSignupAlerts(authService);
  studentBroadcastAlerts = new StudentBroadcastAlerts(authService);
  handleAuthState(authService.getState());
  installIpcAuthorization(ipcMain, () => authService.getPolicy());
  const authRefreshTimer = setInterval(async () => {
    if (!authService.getState().authenticated) return;
    await revalidateAndNotify();
  }, 5 * 60 * 1000);
  authRefreshTimer.unref();
  app.once('before-quit', () => {
    clearInterval(authRefreshTimer);
    if (leaseTimer) clearTimeout(leaseTimer);
    authRealtime.stop().catch(() => {});
    adminSignupAlerts.stop().catch(() => {});
    studentBroadcastAlerts.stop().catch(() => {});
    cancelEnvironmentInstallation();
    projectProvisioner?.terminateAllProvisions();
    terminateAllOpenCodeProcesses();
    terminateAllTerminals();
    terminateAllPreviews();
  });

  // Initialize Managers
  setupStoreHandlers();
  initProjectManager();
  setupWindowHandlers(() => mainWindow);
  setupDialogHandlers(() => mainWindow);
  setupFileSystemHandlers();

  // Setup IPC handlers for each subsystem
  setupProjectHandlers(ipcMain, () => mainWindow);
  setupEnvironmentHandlers(ipcMain, () => mainWindow);
  projectProvisioner = setupProjectProvisionerHandlers(ipcMain, () => mainWindow, registerProject);
  setupServiceHandlers(ipcMain);
  setupTerminalHandlers(ipcMain, () => mainWindow);
  setupClaudeHandlers(ipcMain, () => mainWindow);
  setupOpenAIHandlers(ipcMain, () => mainWindow);
  setupOpenCodeHandlers(ipcMain, () => mainWindow);
  setupPreviewHandlers(ipcMain, () => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
