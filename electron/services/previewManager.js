const { execFile, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const util = require('util');
const { assertNoLinkedPath, validateProjectCwd } = require('../ipc/fsGuards');
const { getProjectById, getProjects, isProjectRegistered } = require('./projectManager');
const { killProcessTree } = require('./processUtils');
const {
  ANDROID_AVD_NAME,
  getAndroidAvdPath,
  getAndroidSdkPath,
  getProcessEnv,
  resolveFlutterToolInvocation,
  resolveNpmInvocation,
} = require('./environmentManager');
const {
  PREVIEW_HOST,
  PREVIEW_PORT,
  PREVIEW_URL,
  buildAdbRotationArgs,
  buildAdbRotationCommands,
  buildAdbScreenshotArgs,
  buildFlutterControlInput,
  buildFlutterRunSpawnOptions,
  buildWebDevArgs,
  classifyWebScript,
  isConfiguredAvdNameOutput,
  isValidManagedSerial,
  parseAdbEmulatorSerials,
} = require('./previewCommands');
const { planWebLaunch, readIndexHtmlHead } = require('./previewProfiles');
const { createStaticServer } = require('./previewStaticServer');
const { AUDIT_SCRIPT, classifyPreviewError, formatDiagnosis } = require('./previewDiagnostics');
const { sanitizeIssue, sanitizeLog } = require('./previewSanitization');

const execFileAsync = util.promisify(execFile);
const MAX_LOG_LINES = 250;
const READY_TIMEOUT_MS = 60_000;
const ANDROID_BOOT_TIMEOUT_MS = 180_000;
const MAX_ISSUES = 100;
const MAX_HISTORY = 20;
const WATCH_IGNORES = new Set(['node_modules', '.git', 'build', 'dist']);
/*
 * Los errores de vista previa viajan al renderer por IPC, y ahi se pierde todo
 * menos el mensaje. Por eso el mensaje ES el codigo: la pantalla lo traduce a
 * una frase que un alumno entienda, en su idioma, en vez de mostrar una linea
 * de npm en ingles.
 */
function previewError(code) {
  return new Error(code);
}

function classifyRunFailure(run) {
  const text = (run?.logs || []).slice(-80).map((entry) => entry.line).join(' ');
  if (/EADDRINUSE|address already in use|port \d+ is (?:already )?in use/i.test(text)) return 'PREVIEW_PORT_BUSY';
  if (/cannot find module|err_module_not_found|failed to resolve import|is not recognized as an internal|command not found|module_not_found/i.test(text)) return 'PREVIEW_DEPENDENCIES_MISSING';
  if (/failed to compile|syntaxerror|unexpected token|parse error|module build failed|transform failed/i.test(text)) return 'PREVIEW_CODE_ERROR';
  return 'PREVIEW_EXITED';
}

let getMainWindow = () => null;
let webRun = null;
let androidRun = null;
let emulatorRun = null;
let webGeneration = 0;
let androidGeneration = 0;
let browserListenersInstalled = false;
let diagnosticsLogger = null;
let webTransition = Promise.resolve();

function recordPreviewError(target, operation, error, category = classifyPreviewError(error)) {
  diagnosticsLogger?.log('preview', 'error', { target, operation, category, errorName: error?.name || 'Error' });
}

function validateCwd(cwd) {
  return validateProjectCwd(cwd, isProjectRegistered);
}

function resolveRepairProject(projectId, findProject = getProjectById, validateProject = validateCwd) {
  if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 160) throw new Error('A valid project ID is required.');
  const project = findProject(projectId.trim());
  if (!project) throw new Error('The project is no longer registered.');
  return { ...project, path: validateProject(project.path) };
}

function serializeWebTransition(operation) {
  const next = webTransition.then(operation, operation);
  webTransition = next.catch(() => {});
  return next;
}

function isTrustedPreviewUrl(url) {
  return url === PREVIEW_URL;
}

function isTrustedPreviewResourceUrl(value) {
  try { return new URL(value).origin === PREVIEW_URL; } catch { return false; }
}

function safeRelativeProjectPath(projectCwd, targetPath) {
  const relative = path.relative(path.resolve(projectCwd), path.resolve(targetPath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

function isIgnoredWatchPath(relativePath) {
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return !parts.length || parts.some((part) => WATCH_IGNORES.has(part));
}

function addIssue(run, issue) {
  if (!run || webRun !== run || !['starting', 'ready'].includes(run.state)) return;
  const clean = sanitizeIssue(issue, run.projectCwd);
  if (!clean.message) return;
  run.issues.push(clean);
  if (clean.severity === 'error') recordPreviewError('web', 'diagnostic', null, clean.category);
  if (run.issues.length > MAX_ISSUES) run.issues.splice(0, run.issues.length - MAX_ISSUES);
  publishWeb();
}

function addActivity(run, type, metadata = {}) {
  if (!Array.isArray(run.activity)) run.activity = [];
  run.activity.push({ type, timestamp: new Date().toISOString(), ...metadata });
  if (run.activity.length > MAX_HISTORY) run.activity.splice(0, run.activity.length - MAX_HISTORY);
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function detectProjectTargets(projectCwd) {
  const root = path.resolve(projectCwd);
  const project = getProjects().find((entry) => path.resolve(entry.path) === root);
  const detectedTargets = Array.isArray(project?.workspace?.targets) ? project.workspace.targets : [];
  const primary = detectedTargets.find((target) => target.id === project?.primaryTargetId);
  const firstWeb = [primary, ...detectedTargets].find((target) => target?.capabilities?.webPreview);
  const firstMobile = [primary, ...detectedTargets].find((target) => target?.kind === 'flutter' && target?.capabilities?.androidPreview);
  const resolveDetected = (target) => target && target.relativePath
    ? path.resolve(root, target.relativePath === '.' ? '' : target.relativePath)
    : null;
  const detectedWeb = resolveDetected(firstWeb);
  const detectedMobile = resolveDetected(firstMobile);
  if (detectedWeb) assertNoLinkedPath(root, detectedWeb);
  if (detectedMobile) assertNoLinkedPath(root, detectedMobile);
  const nestedWeb = path.join(root, 'web');
  const mobile = path.join(root, 'mobile');
  assertNoLinkedPath(root, nestedWeb);
  assertNoLinkedPath(root, mobile);
  /*
   * Antes esto exigia `package.json`. Una carpeta con `index.html` y nada mas
   * es un proyecto web perfectamente valido, y es el primero que hace un
   * alumno: ahora tambien cuenta.
   */
  const hasWebEntry = (directory) => Boolean(directory)
    && (fs.existsSync(path.join(directory, 'package.json')) || fs.existsSync(path.join(directory, 'index.html')));
  const webCwd = hasWebEntry(detectedWeb) ? detectedWeb : hasWebEntry(nestedWeb) ? nestedWeb : hasWebEntry(root) ? root : null;
  return {
    projectCwd: root,
    webCwd,
    mobileCwd: detectedMobile && fs.existsSync(path.join(detectedMobile, 'pubspec.yaml'))
      ? detectedMobile
      : fs.existsSync(path.join(mobile, 'pubspec.yaml')) ? mobile : null,
  };
}

function publish(channel, payload) {
  const window = getMainWindow?.();
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function appendLog(run, target, stream, chunk) {
  if (!run) return;
  for (const rawLine of String(chunk || '').split(/\r?\n/)) {
    const line = sanitizeLog(rawLine, run.projectCwd);
    if (!line) continue;
    const entry = { target, stream, line, timestamp: new Date().toISOString() };
    run.logs.push(entry);
    if (run.logs.length > MAX_LOG_LINES) run.logs.splice(0, run.logs.length - MAX_LOG_LINES);
    publish('preview:log', entry);
  }
  if (target === 'web' && webRun === run && run.sync?.state === 'compiling') {
    const output = String(chunk || '');
    if (/(compiled|ready|built|hmr update|page reload)/i.test(output) && !/(error|failed)/i.test(output)) verifySynchronized(run);
    if (/(failed to compile|build error|compilation failed)/i.test(output)) {
      run.sync.state = 'error';
      run.sync.error = 'Compilation failed. Review runtime logs.';
      addActivity(run, 'sync-error');
      publishWeb();
    }
  }
}

/*
 * En un monorepo las dependencias suelen quedar izadas en la raiz, asi que un
 * `node_modules` ausente en la subcarpeta no significa que falte instalar.
 */
function dependenciesInstalled(webCwd, projectCwd) {
  return [webCwd, projectCwd].some((directory) => directory && fs.existsSync(path.join(directory, 'node_modules')));
}

function webLaunchPlan(projectCwd, webCwd) {
  if (!webCwd) return planWebLaunch({});
  return planWebLaunch({
    packageJson: readJson(path.join(webCwd, 'package.json')),
    dependenciesInstalled: dependenciesInstalled(webCwd, projectCwd),
    indexHtml: readIndexHtmlHead(webCwd),
  });
}

function publicLaunch(plan, projectCwd, webCwd) {
  return {
    mode: plan.mode,
    runtime: plan.runtime,
    script: plan.script,
    command: plan.manualCommand ? [...plan.manualCommand] : null,
    dependenciesInstalled: plan.dependenciesInstalled === true,
    relativePath: webCwd ? (safeRelativeProjectPath(projectCwd, webCwd) || '.') : null,
    reason: plan.reason,
  };
}

function publicWebStatus(projectCwd, targets) {
  const ownsRun = webRun?.projectCwd === projectCwd;
  const plan = webLaunchPlan(projectCwd, targets.webCwd);
  return {
    available: Boolean(targets.webCwd) && ['managed-npm', 'managed-static'].includes(plan.mode),
    launch: publicLaunch(plan, projectCwd, targets.webCwd),
    state: ownsRun ? webRun.state : 'stopped',
    url: ownsRun && webRun.state === 'ready' ? PREVIEW_URL : null,
    error: ownsRun ? webRun.error : null,
    logs: ownsRun ? webRun.logs : [],
    issues: ownsRun ? webRun.issues : [],
    diagnostics: ownsRun ? { status: webRun.issues.some((issue) => issue.severity === 'error') ? 'error' : webRun.issues.length ? 'issues' : 'clean' } : { status: 'idle' },
    sync: ownsRun ? webRun.sync : { state: 'waiting', lastSyncAt: null, changedFiles: [], changedCount: 0, compileDurationMs: null, error: null, history: [] },
    activity: ownsRun ? webRun.activity : [],
  };
}

function publicAndroidStatus(projectCwd, targets) {
  const ownsApp = androidRun?.projectCwd === projectCwd;
  return {
    available: Boolean(targets.mobileCwd),
    emulatorState: emulatorRun?.state || 'stopped',
    emulatorError: emulatorRun?.error || null,
    serial: emulatorRun?.serial || null,
    appState: ownsApp ? androidRun.state : 'stopped',
    appError: ownsApp ? androidRun.error : null,
    errors: [emulatorRun?.error && { category: 'emulator', message: emulatorRun.error }, ownsApp && androidRun.error && { category: 'flutter', message: androidRun.error }].filter(Boolean),
    activity: ownsApp ? androidRun.activity : (emulatorRun?.projectCwd === projectCwd ? emulatorRun.activity || [] : []),
    logs: ownsApp ? androidRun.logs : (emulatorRun?.logs || []),
    avdName: ANDROID_AVD_NAME,
  };
}

function healthCheck() {
  return new Promise((resolve) => {
    const request = http.get(PREVIEW_URL, { timeout: 1_500 }, (response) => {
      response.resume();
      resolve(Boolean(response.statusCode && response.statusCode < 500));
    });
    request.once('timeout', () => { request.destroy(); resolve(false); });
    request.once('error', () => resolve(false));
  });
}

async function verifySynchronized(run) {
  if (webRun !== run || run.sync.state !== 'compiling' || run.sync.verifying) return;
  run.sync.verifying = true;
  const healthy = await healthCheck();
  if (webRun !== run || run.sync.state !== 'compiling') return;
  run.sync.verifying = false;
  if (!healthy) {
    run.sync.state = 'error';
    run.sync.error = 'The preview did not respond after the source change.';
    addActivity(run, 'sync-error');
  } else {
    const now = Date.now();
    run.sync.state = 'synchronized';
    run.sync.lastSyncAt = new Date(now).toISOString();
    run.sync.compileDurationMs = run.sync.compileStartedAt ? now - run.sync.compileStartedAt : null;
    run.sync.error = null;
    const historyEntry = { timestamp: run.sync.lastSyncAt, files: run.sync.changedFiles, count: run.sync.changedCount, durationMs: run.sync.compileDurationMs };
    run.sync.history = [...run.sync.history, historyEntry].slice(-MAX_HISTORY);
    addActivity(run, 'synchronized', { count: run.sync.changedCount });
  }
  publishWeb();
}

function startSourceWatcher(run, webCwd) {
  const changed = new Set();
  try {
    run.watcher = fs.watch(webCwd, { recursive: process.platform === 'win32' }, (_eventType, filename) => {
      if (webRun !== run || !filename) return;
      const absolute = path.resolve(webCwd, String(filename));
      const relative = safeRelativeProjectPath(run.projectCwd, absolute);
      if (!relative || isIgnoredWatchPath(relative)) return;
      changed.add(relative);
      run.sync.state = 'change-detected';
      run.sync.changedFiles = [...changed].slice(-20);
      run.sync.changedCount = changed.size;
      run.sync.error = null;
      publishWeb();
      clearTimeout(run.watchTimer);
      run.watchTimer = setTimeout(() => {
        if (webRun !== run || !['ready', 'starting'].includes(run.state)) return;
        run.sync.state = 'compiling';
        run.sync.compileStartedAt = Date.now();
        run.sync.verifying = false;
        addActivity(run, 'change-detected', { count: changed.size });
        changed.clear();
        publishWeb();
        run.healthTimer = setTimeout(() => verifySynchronized(run), 1_200);
        run.healthTimer.unref?.();
      }, 250);
      run.watchTimer.unref?.();
    });
    run.watcher.once('error', (error) => {
      if (webRun !== run) return;
      run.sync.state = 'error'; run.sync.error = sanitizeLog(error.message, run.projectCwd); publishWeb();
    });
  } catch (error) {
    run.sync.state = 'error'; run.sync.error = sanitizeLog(error.message, run.projectCwd);
  }
}

function closeSourceWatcher(run) {
  clearTimeout(run?.watchTimer); clearTimeout(run?.healthTimer);
  try { run?.watcher?.close(); } catch {}
  if (run) run.watcher = null;
}

function publishWeb() {
  if (!webRun) return;
  diagnosticsLogger?.setState('preview-web', { state: webRun.state, issueCount: webRun.issues.length, syncState: webRun.sync.state });
  publish('preview:web-status', publicWebStatus(webRun.projectCwd, detectProjectTargets(webRun.projectCwd)));
}

function publishAndroid(projectCwd = androidRun?.projectCwd || emulatorRun?.projectCwd) {
  if (!projectCwd) return;
  diagnosticsLogger?.setState('preview-android', { emulatorState: emulatorRun?.state || 'stopped', appState: androidRun?.state || 'stopped' });
  publish('preview:android-status', publicAndroidStatus(projectCwd, detectProjectTargets(projectCwd)));
}

function waitForWebReady(generation) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const check = () => {
    if (!webRun || generation !== webGeneration || webRun.state !== 'starting') return;
    const request = http.get(PREVIEW_URL, { timeout: 1_500 }, (response) => {
      response.resume();
      if (response.statusCode && response.statusCode < 500 && webRun && generation === webGeneration) {
        webRun.state = 'ready';
        webRun.error = null;
        publishWeb();
      } else schedule();
    });
    request.once('timeout', () => request.destroy());
    request.once('error', schedule);
  };
  const schedule = () => {
    if (!webRun || generation !== webGeneration || webRun.state !== 'starting') return;
    if (Date.now() >= deadline) {
      webRun.state = 'error';
      webRun.error = 'PREVIEW_TIMEOUT';
      recordPreviewError('web', 'start', null, 'timeout');
      publishWeb();
      return;
    }
    setTimeout(check, 400).unref();
  };
  check();
}

function createWebRun(projectCwd, webCwd, plan) {
  return {
    projectCwd, webCwd, plan, state: 'starting', error: null, logs: [], issues: [], activity: [], process: null, server: null, watcher: null,
    sync: { state: 'waiting', lastSyncAt: null, changedFiles: [], changedCount: 0, compileDurationMs: null, error: null, history: [] },
  };
}

function webRunIsLive() {
  return Boolean((webRun?.process && !webRun.process.killed) || webRun?.server?.listening);
}

function closeWebServer(run) {
  const server = run?.server;
  if (!server) return;
  run.server = null;
  try { server.closeAllConnections?.(); } catch {}
  try { server.close(); } catch {}
  run.state = 'stopped';
}

/*
 * Sitio estatico: se sirve desde el proceso principal, sin npm y sin ejecutar
 * nada del proyecto. Queda listo apenas el socket escucha, asi que no hay
 * espera ni sondeo.
 */
async function startStaticWeb(projectCwd, targets, plan) {
  let server;
  try {
    server = await createStaticServer(targets.webCwd, { host: PREVIEW_HOST, port: PREVIEW_PORT });
  } catch (error) {
    throw previewError(/EADDRINUSE/i.test(String(error?.message || '')) ? 'PREVIEW_PORT_BUSY' : 'PREVIEW_STATIC_UNAVAILABLE');
  }
  const run = createWebRun(projectCwd, targets.webCwd, plan);
  run.server = server;
  run.state = 'ready';
  webRun = run;
  webGeneration += 1;
  startSourceWatcher(run, targets.webCwd);
  publishWeb();
  return publicWebStatus(projectCwd, targets);
}

async function startWeb(cwd) {
  const projectCwd = validateCwd(cwd);
  const targets = detectProjectTargets(projectCwd);
  if (!targets.webCwd) throw previewError('PREVIEW_NO_WEB_TARGET');
  if (webRunIsLive()) {
    if (webRun.projectCwd === projectCwd) return publicWebStatus(projectCwd, targets);
    throw previewError('PREVIEW_BUSY_OTHER_PROJECT');
  }
  const plan = webLaunchPlan(projectCwd, targets.webCwd);
  if (plan.mode === 'managed-static') return startStaticWeb(projectCwd, targets, plan);
  if (plan.mode !== 'managed-npm') throw previewError(`PREVIEW_${plan.reason || 'NO_MANIFEST'}`);
  /*
   * Sin `node_modules` el servidor arranca y muere con un error de npm que no
   * le dice nada a nadie. Es mejor detenerse antes y nombrar lo que falta.
   */
  if (!plan.dependenciesInstalled) throw previewError('PREVIEW_DEPENDENCIES_MISSING');
  const npm = await resolveNpmInvocation();
  if (!npm) throw previewError('PREVIEW_NPM_MISSING');

  const run = createWebRun(projectCwd, targets.webCwd, plan);
  webRun = run;
  const args = [...npm.argsPrefix, ...buildWebDevArgs(plan)];
  const child = spawn(npm.file, args, {
    cwd: targets.webCwd,
    env: getProcessEnv({ BROWSER: 'none', HOST: PREVIEW_HOST, PORT: String(PREVIEW_PORT) }),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  run.process = child;
  child.stdout.on('data', (data) => appendLog(run, 'web', 'stdout', data));
  child.stderr.on('data', (data) => appendLog(run, 'web', 'stderr', data));
  child.once('error', (error) => {
    if (webRun !== run) return;
    run.state = 'error';
    run.error = sanitizeLog(error.message, projectCwd);
    recordPreviewError('web', 'start', error, 'process');
    publishWeb();
  });
  child.once('close', (code) => {
    if (webRun !== run) return;
    closeSourceWatcher(run);
    run.process = null;
    if (run.state !== 'stopping') {
      run.state = code === 0 ? 'stopped' : 'error';
      run.error = code === 0 ? null : classifyRunFailure(run);
      if (code !== 0) recordPreviewError('web', 'run', null, 'process');
    } else run.state = 'stopped';
    publishWeb();
  });
  webGeneration += 1;
  startSourceWatcher(run, targets.webCwd);
  publishWeb();
  waitForWebReady(webGeneration);
  return publicWebStatus(projectCwd, targets);
}

function stopWeb(cwd) {
  const projectCwd = validateCwd(cwd);
  if (webRun?.projectCwd !== projectCwd) return publicWebStatus(projectCwd, detectProjectTargets(projectCwd));
  webGeneration += 1;
  webRun.state = 'stopping';
  closeSourceWatcher(webRun);
  if (webRun.process) killProcessTree(webRun.process);
  else if (webRun.server) closeWebServer(webRun);
  else webRun.state = 'stopped';
  publishWeb();
  return publicWebStatus(projectCwd, detectProjectTargets(projectCwd));
}

function waitForManagedProcessExit(processHandle, timeoutMs = 8_000) {
  if (!processHandle || processHandle.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      processHandle.removeListener('close', onClose);
      reject(new Error('The managed preview process did not stop in time.'));
    }, timeoutMs);
    timer.unref?.();
    const onClose = () => { clearTimeout(timer); resolve(); };
    processHandle.once('close', onClose);
  });
}

async function repairWeb(projectId) {
  const project = resolveRepairProject(projectId);
  const run = webRun;
  if (run && run.projectCwd !== project.path) throw new Error('A web preview is active for another project.');
  if (run) {
    webGeneration += 1;
    run.state = 'stopping';
    closeSourceWatcher(run);
    publishWeb();
    if (run.process) {
      const exit = waitForManagedProcessExit(run.process);
      await killProcessTree(run.process);
      await exit;
    }
    closeWebServer(run);
    if (webRun === run) webRun = null;
  }
  return startWeb(project.path);
}

function getAndroidTools() {
  const sdk = getAndroidSdkPath();
  const emulator = path.join(sdk, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
  const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  return { sdk, emulator, adb };
}

async function requireManagedSerial() {
  const tools = getAndroidTools();
  const serial = await detectManagedEmulatorSerial(tools.adb);
  if (!serial || !isValidManagedSerial(serial) || !await isAndroidBootComplete(tools.adb, serial)) throw new Error('The managed Android device is not ready.');
  return { tools, serial };
}

function assertAvdExists() {
  if (!fs.existsSync(path.join(getAndroidAvdPath(), 'config.ini'))) {
    throw new Error(`Android virtual device ${ANDROID_AVD_NAME} is not installed.`);
  }
}

async function queryConfiguredAvdName(adb, serial, execute = execFileAsync) {
  if (!isValidManagedSerial(serial)) return false;
  try {
    const { stdout } = await execute(adb, ['-s', serial, 'emu', 'avd', 'name'], {
      env: getProcessEnv(), timeout: 5_000, windowsHide: true,
    });
    return isConfiguredAvdNameOutput(stdout);
  } catch { return false; }
}

async function detectManagedEmulatorSerial(adb, execute = execFileAsync, fileExists = fs.existsSync) {
  if (!fileExists(adb)) return null;
  try {
    const { stdout } = await execute(adb, ['devices'], { env: getProcessEnv(), timeout: 5_000, windowsHide: true });
    for (const serial of parseAdbEmulatorSerials(stdout)) {
      if (await queryConfiguredAvdName(adb, serial, execute)) return serial;
    }
  } catch {}
  return null;
}

async function isAndroidBootComplete(adb, serial, execute = execFileAsync) {
  if (!isValidManagedSerial(serial)) return false;
  try {
    const { stdout } = await execute(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], {
      env: getProcessEnv(), timeout: 5_000, windowsHide: true,
    });
    return String(stdout || '').trim() === '1';
  } catch { return false; }
}

function waitForAndroidBoot(run, adb, generation) {
  const deadline = Date.now() + ANDROID_BOOT_TIMEOUT_MS;
  const probe = async () => {
    if (emulatorRun !== run || generation !== androidGeneration || run.state !== 'starting') return;
    const serial = await detectManagedEmulatorSerial(adb);
    if (emulatorRun !== run || generation !== androidGeneration || run.state !== 'starting') return;
    if (serial) {
      run.serial = serial;
      if (await isAndroidBootComplete(adb, serial)) {
        if (emulatorRun !== run || generation !== androidGeneration || run.state !== 'starting') return;
        run.state = 'running';
        run.error = null;
        publishAndroid(run.projectCwd);
        return;
      }
    }
    if (Date.now() >= deadline) {
      run.state = 'error';
      run.error = `Android virtual device ${ANDROID_AVD_NAME} did not finish booting within 180 seconds.`;
      recordPreviewError('android-emulator', 'start', null, 'timeout');
      publishAndroid(run.projectCwd);
      if (run.process) killProcessTree(run.process);
      return;
    }
    setTimeout(probe, 1_000).unref();
  };
  setTimeout(probe, 250).unref();
}

async function getWebStatus(cwd) {
  const projectCwd = validateCwd(cwd);
  return publicWebStatus(projectCwd, detectProjectTargets(projectCwd));
}

async function getAndroidStatus(cwd) {
  const projectCwd = validateCwd(cwd);
  const targets = detectProjectTargets(projectCwd);
  const tools = getAndroidTools();
  const serial = await detectManagedEmulatorSerial(tools.adb);
  if (serial) {
    const booted = await isAndroidBootComplete(tools.adb, serial);
    if (emulatorRun) {
      emulatorRun.serial = serial;
      if (booted) {
        emulatorRun.state = 'running';
        emulatorRun.error = null;
      }
    } else {
      const run = { projectCwd, state: booted ? 'running' : 'starting', error: null, serial, logs: [], activity: [], process: null };
      emulatorRun = run;
      androidGeneration += 1;
      if (!booted) waitForAndroidBoot(run, tools.adb, androidGeneration);
    }
  } else if (!serial && emulatorRun?.state === 'running') {
    emulatorRun.state = 'stopped';
    emulatorRun.error = null;
    emulatorRun.serial = null;
  }
  return publicAndroidStatus(projectCwd, targets);
}

async function startEmulator(cwd) {
  const projectCwd = validateCwd(cwd);
  const targets = detectProjectTargets(projectCwd);
  if (!targets.mobileCwd) throw new Error('No mobile/pubspec.yaml was found.');
  assertAvdExists();
  const tools = getAndroidTools();
  if (!fs.existsSync(tools.emulator)) throw new Error('The trusted Android emulator executable was not found.');
  if (!fs.existsSync(tools.adb)) throw new Error('The trusted Android adb executable was not found.');
  const existingSerial = await detectManagedEmulatorSerial(tools.adb);
  if (existingSerial) {
    const booted = await isAndroidBootComplete(tools.adb, existingSerial);
    const processIsActive = emulatorRun?.process && !emulatorRun.process.killed;
    const run = processIsActive
      ? emulatorRun
      : { projectCwd, state: 'starting', error: null, serial: existingSerial, logs: [], activity: [], process: null };
    run.projectCwd = projectCwd;
    run.serial = existingSerial;
    run.state = booted ? 'running' : 'starting';
    run.error = null;
    if (!processIsActive) emulatorRun = run;
    if (!booted || !processIsActive) androidGeneration += 1;
    publishAndroid(projectCwd);
    if (!booted) waitForAndroidBoot(run, tools.adb, androidGeneration);
    return publicAndroidStatus(projectCwd, targets);
  }
  if (emulatorRun?.process && !emulatorRun.process.killed) return publicAndroidStatus(projectCwd, targets);

  const run = { projectCwd, state: 'starting', error: null, serial: null, logs: [], activity: [], process: null };
  emulatorRun = run;
  androidGeneration += 1;
  const generation = androidGeneration;
  const child = spawn(tools.emulator, ['-avd', ANDROID_AVD_NAME, '-no-snapshot-save'], {
    env: getProcessEnv({ ANDROID_SDK_ROOT: tools.sdk, ANDROID_HOME: tools.sdk }),
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  run.process = child;
  child.stdout.on('data', (data) => appendLog(run, 'android', 'stdout', data));
  child.stderr.on('data', (data) => appendLog(run, 'android', 'stderr', data));
  child.once('error', (error) => {
    if (emulatorRun !== run) return;
    run.state = 'error'; run.error = sanitizeLog(error.message); recordPreviewError('android-emulator', 'start', error, 'process'); publishAndroid(projectCwd);
  });
  child.once('close', (code) => {
    if (emulatorRun !== run) return;
    run.process = null;
    if (run.state === 'stopping' || run.state === 'stopped') { run.state = 'stopped'; run.error = null; }
    else if (run.state !== 'error') { run.state = code === 0 ? 'stopped' : 'error'; run.error = code ? `Emulator exited with code ${code}.` : null; if (code) recordPreviewError('android-emulator', 'run', null, 'process'); }
    run.serial = null;
    publishAndroid(projectCwd);
  });
  publishAndroid(projectCwd);
  waitForAndroidBoot(run, tools.adb, generation);
  return publicAndroidStatus(projectCwd, targets);
}

function sendFlutterControl(cwd, control) {
  const projectCwd = validateCwd(cwd);
  const input = buildFlutterControlInput(control);
  if (androidRun?.projectCwd !== projectCwd || androidRun.state !== 'running' || !androidRun.process?.stdin?.writable) throw new Error('The Flutter application is not running.');
  androidRun.process.stdin.write(input);
  addActivity(androidRun, control === 'reload' ? 'hot-reload' : 'hot-restart');
  return publicAndroidStatus(projectCwd, detectProjectTargets(projectCwd));
}

async function rotateAndroid(cwd, orientation) {
  const projectCwd = validateCwd(cwd);
  const { tools, serial } = await requireManagedSerial();
  for (const args of buildAdbRotationCommands(serial, orientation)) {
    await execFileAsync(tools.adb, args, { env: getProcessEnv(), timeout: 5_000, windowsHide: true });
  }
  if (emulatorRun?.projectCwd === projectCwd) addActivity(emulatorRun, 'rotation', { orientation });
  publishAndroid(projectCwd);
  return { orientation };
}

function safeArtifactPath(projectCwd, folder, prefix, extension, now = new Date()) {
  const root = path.resolve(projectCwd);
  const directory = path.join(root, '.vibe', folder);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = path.join(directory, `${prefix}-${stamp}.${extension}`);
  if (!safeRelativeProjectPath(root, target)) throw new Error('Unsafe artifact path.');
  assertNoLinkedPath(root, directory);
  fs.mkdirSync(directory, { recursive: true });
  assertNoLinkedPath(root, target);
  return target;
}

async function captureAndroidScreenshot(cwd) {
  const projectCwd = validateCwd(cwd);
  const { tools, serial } = await requireManagedSerial();
  const args = buildAdbScreenshotArgs(serial);
  const { stdout } = await execFileAsync(tools.adb, args, { env: getProcessEnv(), timeout: 15_000, windowsHide: true, encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 });
  const image = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || '');
  if (image.length < 8 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Android did not return a valid PNG screenshot.');
  const target = safeArtifactPath(projectCwd, 'screenshots', 'android', 'png');
  fs.writeFileSync(target, image, { mode: 0o600 });
  const metadata = { path: safeRelativeProjectPath(projectCwd, target), size: image.length, createdAt: new Date().toISOString() };
  if (emulatorRun?.projectCwd === projectCwd) addActivity(emulatorRun, 'screenshot', metadata);
  publishAndroid(projectCwd);
  return metadata;
}

async function runAndroidApp(cwd) {
  const projectCwd = validateCwd(cwd);
  const targets = detectProjectTargets(projectCwd);
  if (!targets.mobileCwd) throw new Error('No mobile/pubspec.yaml was found.');
  if (androidRun?.process && !androidRun.process.killed) {
    if (androidRun.projectCwd === projectCwd) return publicAndroidStatus(projectCwd, targets);
    throw new Error('An Android application is already running for another project.');
  }
  const tools = getAndroidTools();
  const flutter = await resolveFlutterToolInvocation();
  if (!flutter) throw new Error('The trusted Flutter installation was not found.');
  const serial = await detectManagedEmulatorSerial(tools.adb);
  if (!serial || !await isAndroidBootComplete(tools.adb, serial)) {
    throw new Error(`Start ${ANDROID_AVD_NAME} and wait until Android finishes booting.`);
  }
  const run = { projectCwd, state: 'starting', error: null, logs: [], activity: [], process: null };
  androidRun = run;
  const child = spawn(
    flutter.file,
    [...flutter.argsPrefix, 'run', '-d', serial],
    buildFlutterRunSpawnOptions(targets.mobileCwd, getProcessEnv({ ANDROID_SDK_ROOT: tools.sdk, ANDROID_HOME: tools.sdk })),
  );
  run.process = child;
  child.stdout.on('data', (data) => { if (run.state === 'starting') run.state = 'running'; appendLog(run, 'android', 'stdout', data); publishAndroid(projectCwd); });
  child.stderr.on('data', (data) => appendLog(run, 'android', 'stderr', data));
  child.once('error', (error) => { if (androidRun === run) { run.state = 'error'; run.error = sanitizeLog(error.message, projectCwd); recordPreviewError('android-app', 'run', error, 'process'); publishAndroid(projectCwd); } });
  child.once('close', (code) => {
    if (androidRun !== run) return;
    run.process = null;
    if (run.state !== 'stopping') { run.state = code === 0 ? 'stopped' : 'error'; run.error = code ? `Flutter exited with code ${code}.` : null; if (code) recordPreviewError('android-app', 'run', null, 'process'); }
    else run.state = 'stopped';
    publishAndroid(projectCwd);
  });
  publishAndroid(projectCwd);
  return publicAndroidStatus(projectCwd, targets);
}

function stopAndroidApp(cwd) {
  const projectCwd = validateCwd(cwd);
  if (androidRun?.projectCwd === projectCwd) {
    androidRun.state = 'stopping';
    androidRun.error = null;
    if (androidRun.process) killProcessTree(androidRun.process); else androidRun.state = 'stopped';
    publishAndroid(projectCwd);
  }
  return publicAndroidStatus(projectCwd, detectProjectTargets(projectCwd));
}

function getTrustedPreviewFrame() {
  const window = getMainWindow?.();
  if (!window || window.isDestroyed() || webRun?.state !== 'ready') throw new Error('The trusted preview is not ready.');
  const frame = window.webContents.mainFrame.frames.find((candidate) => isTrustedPreviewResourceUrl(candidate.url));
  if (!frame) throw new Error('The trusted preview frame has not finished loading.');
  return { window, frame };
}

async function runWebAudit(cwd) {
  const projectCwd = validateCwd(cwd);
  if (webRun?.projectCwd !== projectCwd) throw new Error('The trusted preview is not active for this project.');
  const { frame } = getTrustedPreviewFrame();
  const results = await frame.executeJavaScript(AUDIT_SCRIPT, true);
  if (!Array.isArray(results)) throw new Error('The preview audit returned an invalid result.');
  const auditIssues = results.slice(0, MAX_ISSUES).map((issue) => sanitizeIssue(issue, projectCwd));
  webRun.issues = [...webRun.issues.filter((issue) => !['responsive', 'accessibility'].includes(issue.category)), ...auditIssues].slice(-MAX_ISSUES);
  addActivity(webRun, 'audit', { count: auditIssues.length });
  publishWeb();
  return publicWebStatus(projectCwd, detectProjectTargets(projectCwd));
}

function clearWebIssues(cwd) {
  const projectCwd = validateCwd(cwd);
  if (webRun?.projectCwd === projectCwd) { webRun.issues = []; addActivity(webRun, 'issues-cleared'); publishWeb(); }
  return publicWebStatus(projectCwd, detectProjectTargets(projectCwd));
}

function copyWebDiagnosis(cwd) {
  const projectCwd = validateCwd(cwd);
  if (webRun?.projectCwd !== projectCwd) throw new Error('The trusted preview is not active for this project.');
  const { clipboard } = require('electron');
  clipboard.writeText(formatDiagnosis(webRun.issues));
  return true;
}

function validateCaptureBounds(bounds, window) {
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(bounds?.[key]));
  if (!values.every(Number.isFinite)) throw new Error('Invalid preview capture bounds.');
  const [x, y, width, height] = values.map(Math.round);
  const content = window.getContentBounds();
  if (x < 0 || y < 0 || width < 64 || height < 64 || width > 4096 || height > 4096 || x + width > content.width || y + height > content.height) throw new Error('Preview capture bounds are outside the application window.');
  return { x, y, width, height };
}

async function captureWebSnapshot(cwd, bounds) {
  const projectCwd = validateCwd(cwd);
  if (webRun?.projectCwd !== projectCwd) throw new Error('The trusted preview is not active for this project.');
  const { window } = getTrustedPreviewFrame();
  const rect = validateCaptureBounds(bounds, window);
  const actual = await window.webContents.mainFrame.executeJavaScript(`(() => { const frame = document.querySelector('iframe[src="${PREVIEW_URL}"]'); if (!frame) return null; const box = frame.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; })()`, true);
  const trustedRect = validateCaptureBounds(actual, window);
  if (['x', 'y', 'width', 'height'].some((key) => Math.abs(rect[key] - trustedRect[key]) > 2)) throw new Error('Preview capture bounds did not match the trusted frame.');
  const image = await window.webContents.capturePage(rect);
  const size = image.getSize();
  if (image.isEmpty() || size.width < 64 || size.height < 64 || size.width > 8192 || size.height > 8192) throw new Error('The preview snapshot dimensions were invalid.');
  const target = safeArtifactPath(projectCwd, 'snapshots', 'web-preview', 'png');
  const png = image.toPNG();
  fs.writeFileSync(target, png, { mode: 0o600 });
  const metadata = { path: safeRelativeProjectPath(projectCwd, target), width: size.width, height: size.height, size: png.length, createdAt: new Date().toISOString() };
  addActivity(webRun, 'snapshot', metadata);
  publishWeb();
  return metadata;
}

function installBrowserDiagnosticsListeners() {
  if (browserListenersInstalled) return;
  const window = getMainWindow?.();
  if (!window || window.isDestroyed()) return;
  browserListenersInstalled = true;
  window.webContents.on('console-message', (details) => {
    const severity = details.level === 'error' ? 'error' : details.level === 'warning' ? 'warning' : null;
    if (!severity || !webRun || !isTrustedPreviewResourceUrl(details.sourceId)) return;
    addIssue(webRun, { category: 'runtime', severity, message: details.message, metadata: { url: details.sourceId } });
  });
  const filter = { urls: [`${PREVIEW_URL}/*`] };
  const handleRequestFailure = (details, failed) => {
    if (!webRun || !['starting', 'ready'].includes(webRun.state) || !isTrustedPreviewResourceUrl(details.url)) return;
    if (!failed && details.statusCode < 400) return;
    const networkTypes = new Set(['xhr', 'fetch', 'mainFrame', 'subFrame']);
    addIssue(webRun, {
      category: networkTypes.has(details.resourceType) ? 'network' : 'resource', severity: 'error',
      message: failed ? `Request failed: ${details.error || 'network error'}` : `Request returned HTTP ${details.statusCode}.`,
      metadata: { url: details.url, method: details.method, resourceType: details.resourceType, statusCode: details.statusCode },
    });
  };
  window.webContents.session.webRequest.onCompleted(filter, (details) => handleRequestFailure(details, false));
  window.webContents.session.webRequest.onErrorOccurred(filter, (details) => handleRequestFailure(details, true));
}

async function stopEmulator(cwd) {
  const projectCwd = validateCwd(cwd);
  stopAndroidApp(projectCwd);
  if (emulatorRun) {
    androidGeneration += 1;
    emulatorRun.state = 'stopping';
    emulatorRun.error = null;
    publishAndroid(projectCwd);
    const tools = getAndroidTools();
    const serial = await detectManagedEmulatorSerial(tools.adb);
    if (serial) {
      try {
        await execFileAsync(tools.adb, ['-s', serial, 'emu', 'kill'], {
          env: getProcessEnv(), timeout: 3_000, windowsHide: true,
        });
      } catch {}
    }
    if (emulatorRun.process) killProcessTree(emulatorRun.process);
    emulatorRun.state = 'stopped'; emulatorRun.error = null; emulatorRun.serial = null;
    publishAndroid(projectCwd);
  }
  return publicAndroidStatus(projectCwd, detectProjectTargets(projectCwd));
}

function terminateAllPreviews() {
  webGeneration += 1;
  androidGeneration += 1;
  closeSourceWatcher(webRun);
  if (webRun?.process) killProcessTree(webRun.process);
  closeWebServer(webRun);
  if (androidRun?.process) killProcessTree(androidRun.process);
  const emulatorProcess = emulatorRun?.process;
  const tools = getAndroidTools();
  (async () => {
    try {
      const serial = await detectManagedEmulatorSerial(tools.adb);
      if (serial) {
        await execFileAsync(tools.adb, ['-s', serial, 'emu', 'kill'], {
          env: getProcessEnv(), timeout: 3_000, windowsHide: true,
        });
      }
    } catch {
      // Process-tree termination below is the fallback when adb cannot stop the AVD.
    } finally {
      if (emulatorProcess) killProcessTree(emulatorProcess);
    }
  })().catch(() => {});
  webRun = null; androidRun = null; emulatorRun = null;
}

function setupPreviewHandlers(ipcMain, mainWindowProvider, diagnostics) {
  getMainWindow = mainWindowProvider;
  diagnosticsLogger = diagnostics || null;
  installBrowserDiagnosticsListeners();
  const handle = (channel, target, operation, handler) => ipcMain.handle(channel, async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      recordPreviewError(target, operation, error);
      throw error;
    }
  });
  handle('preview:web-status', 'web', 'status', (_event, cwd) => getWebStatus(cwd));
  handle('preview:web-start', 'web', 'start', (_event, cwd) => serializeWebTransition(() => startWeb(cwd)));
  handle('preview:web-stop', 'web', 'stop', (_event, cwd) => serializeWebTransition(() => stopWeb(cwd)));
  handle('preview:web-repair', 'web', 'repair', (_event, projectId) => serializeWebTransition(() => repairWeb(projectId)));
  handle('preview:web-open-external', 'web', 'open-external', async (_event, cwd) => {
    const status = await getWebStatus(cwd);
    if (status.state !== 'ready' || !isTrustedPreviewUrl(status.url)) throw previewError('PREVIEW_NOT_READY');
    const { shell } = require('electron');
    await shell.openExternal(PREVIEW_URL);
    return true;
  });
  handle('preview:web-audit', 'web', 'audit', (_event, cwd) => runWebAudit(cwd));
  handle('preview:web-clear-issues', 'web', 'clear-issues', (_event, cwd) => clearWebIssues(cwd));
  handle('preview:web-copy-diagnosis', 'web', 'copy-diagnosis', (_event, cwd) => copyWebDiagnosis(cwd));
  handle('preview:web-snapshot', 'web', 'snapshot', (_event, cwd, bounds) => captureWebSnapshot(cwd, bounds));
  handle('preview:android-status', 'android', 'status', (_event, cwd) => getAndroidStatus(cwd));
  handle('preview:android-start-emulator', 'android-emulator', 'start', (_event, cwd) => startEmulator(cwd));
  handle('preview:android-stop-emulator', 'android-emulator', 'stop', (_event, cwd) => stopEmulator(cwd));
  handle('preview:android-run-app', 'android-app', 'start', (_event, cwd) => runAndroidApp(cwd));
  handle('preview:android-stop-app', 'android-app', 'stop', (_event, cwd) => stopAndroidApp(cwd));
  handle('preview:android-hot-reload', 'android-app', 'hot-reload', (_event, cwd) => sendFlutterControl(cwd, 'reload'));
  handle('preview:android-hot-restart', 'android-app', 'hot-restart', (_event, cwd) => sendFlutterControl(cwd, 'restart'));
  handle('preview:android-rotate', 'android-emulator', 'rotate', (_event, cwd, orientation) => rotateAndroid(cwd, orientation));
  handle('preview:android-screenshot', 'android-emulator', 'screenshot', (_event, cwd) => captureAndroidScreenshot(cwd));
}

module.exports = {
  PREVIEW_HOST, PREVIEW_PORT, PREVIEW_URL,
  buildAdbRotationArgs, buildAdbScreenshotArgs, buildWebDevArgs, classifyWebScript, detectManagedEmulatorSerial, detectProjectTargets,
  isAndroidBootComplete, isConfiguredAvdNameOutput, isIgnoredWatchPath, isTrustedPreviewResourceUrl, isTrustedPreviewUrl, isValidManagedSerial,
  parseAdbEmulatorSerials, safeArtifactPath, safeRelativeProjectPath, sanitizeIssue, sanitizeLog, validateCaptureBounds,
  classifyRunFailure, webLaunchPlan,
  resolveRepairProject,
  setupPreviewHandlers, terminateAllPreviews,
};
