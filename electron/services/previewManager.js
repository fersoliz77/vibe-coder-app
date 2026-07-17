const { execFile, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const util = require('util');
const { assertNoLinkedPath, validateProjectCwd } = require('../ipc/fsGuards');
const { isProjectRegistered } = require('./projectManager');
const { killProcessTree } = require('./processUtils');
const {
  ANDROID_AVD_NAME,
  getAndroidAvdPath,
  getAndroidSdkPath,
  getProcessEnv,
  resolveFlutterToolInvocation,
  resolveNpmInvocation,
} = require('./environmentManager');

const execFileAsync = util.promisify(execFile);
const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`;
const MAX_LOG_LINES = 250;
const READY_TIMEOUT_MS = 60_000;
const ANDROID_BOOT_TIMEOUT_MS = 180_000;

let getMainWindow = () => null;
let webRun = null;
let androidRun = null;
let emulatorRun = null;
let webGeneration = 0;
let androidGeneration = 0;

function validateCwd(cwd) {
  return validateProjectCwd(cwd, isProjectRegistered);
}

function isTrustedPreviewUrl(url) {
  return url === PREVIEW_URL;
}

function sanitizeLog(value, projectCwd = '') {
  let clean = String(value || '')
    .replace(/\x1B(?:\][^\x07]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r/g, '');
  if (projectCwd) clean = clean.split(projectCwd).join('[project]');
  clean = clean.replace(/\b(token|password|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=[redacted]');
  return clean.slice(0, 8_000).trim();
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function detectProjectTargets(projectCwd) {
  const root = path.resolve(projectCwd);
  const nestedWeb = path.join(root, 'web');
  const mobile = path.join(root, 'mobile');
  assertNoLinkedPath(root, nestedWeb);
  assertNoLinkedPath(root, mobile);
  const webCwd = fs.existsSync(path.join(nestedWeb, 'package.json'))
    ? nestedWeb
    : fs.existsSync(path.join(root, 'package.json')) ? root : null;
  return {
    projectCwd: root,
    webCwd,
    mobileCwd: fs.existsSync(path.join(mobile, 'pubspec.yaml')) ? mobile : null,
  };
}

function classifyWebScript(packageJson) {
  const script = String(packageJson?.scripts?.dev || '').trim().toLowerCase();
  if (!script) return null;
  if (/^next(?:\.cmd)?\s+dev$/.test(script)) return 'next';
  if (/^vite(?:\.cmd)?$/.test(script)) return 'vite';
  return null;
}

function buildWebDevArgs(kind) {
  if (kind === 'next') return ['run', 'dev', '--', '-H', PREVIEW_HOST, '-p', String(PREVIEW_PORT)];
  if (kind === 'vite') return ['run', 'dev', '--', '--host', PREVIEW_HOST, '--port', String(PREVIEW_PORT), '--strictPort'];
  throw new Error('Unsupported web development server. Only exact Vite and Next.js dev scripts are supported.');
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
}

function publicWebStatus(projectCwd, targets) {
  const ownsRun = webRun?.projectCwd === projectCwd;
  return {
    available: Boolean(targets.webCwd),
    state: ownsRun ? webRun.state : 'stopped',
    url: ownsRun && webRun.state === 'ready' ? PREVIEW_URL : null,
    error: ownsRun ? webRun.error : null,
    logs: ownsRun ? webRun.logs : [],
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
    logs: ownsApp ? androidRun.logs : (emulatorRun?.logs || []),
    avdName: ANDROID_AVD_NAME,
  };
}

function publishWeb() {
  if (!webRun) return;
  publish('preview:web-status', publicWebStatus(webRun.projectCwd, detectProjectTargets(webRun.projectCwd)));
}

function publishAndroid(projectCwd = androidRun?.projectCwd || emulatorRun?.projectCwd) {
  if (!projectCwd) return;
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
      webRun.error = 'The development server did not become ready in time.';
      publishWeb();
      return;
    }
    setTimeout(check, 400).unref();
  };
  check();
}

async function startWeb(cwd) {
  const projectCwd = validateCwd(cwd);
  const targets = detectProjectTargets(projectCwd);
  if (!targets.webCwd) throw new Error('No package.json was found in web/ or the project root.');
  if (webRun?.process && !webRun.process.killed) {
    if (webRun.projectCwd === projectCwd) return publicWebStatus(projectCwd, targets);
    throw new Error('A web preview is already running for another project.');
  }
  const packageJson = readJson(path.join(targets.webCwd, 'package.json'));
  const kind = classifyWebScript(packageJson);
  if (!packageJson?.scripts?.dev) throw new Error('The project does not define an npm dev script.');
  if (!kind) throw new Error('Unsupported npm dev script. Use exactly "vite" or "next dev".');
  const npm = await resolveNpmInvocation();
  if (!npm) throw new Error('A trusted npm installation could not be resolved.');

  const run = { projectCwd, state: 'starting', error: null, logs: [], process: null };
  webRun = run;
  const args = [...npm.argsPrefix, ...buildWebDevArgs(kind)];
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
    publishWeb();
  });
  child.once('close', (code) => {
    if (webRun !== run) return;
    run.process = null;
    if (run.state !== 'stopping') {
      run.state = code === 0 ? 'stopped' : 'error';
      run.error = code === 0 ? null : `Development server exited with code ${code}.`;
    } else run.state = 'stopped';
    publishWeb();
  });
  webGeneration += 1;
  publishWeb();
  waitForWebReady(webGeneration);
  return publicWebStatus(projectCwd, targets);
}

function stopWeb(cwd) {
  const projectCwd = validateCwd(cwd);
  if (webRun?.projectCwd !== projectCwd) return publicWebStatus(projectCwd, detectProjectTargets(projectCwd));
  webGeneration += 1;
  webRun.state = 'stopping';
  if (webRun.process) killProcessTree(webRun.process);
  else webRun.state = 'stopped';
  publishWeb();
  return publicWebStatus(projectCwd, detectProjectTargets(projectCwd));
}

function getAndroidTools() {
  const sdk = getAndroidSdkPath();
  const emulator = path.join(sdk, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
  const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  return { sdk, emulator, adb };
}

function assertAvdExists() {
  if (!fs.existsSync(path.join(getAndroidAvdPath(), 'config.ini'))) {
    throw new Error(`Android virtual device ${ANDROID_AVD_NAME} is not installed.`);
  }
}

function parseAdbEmulatorSerials(output) {
  return String(output || '').split(/\r?\n/)
    .map((line) => line.match(/^(emulator-\d+)\s+device$/)?.[1])
    .filter(Boolean);
}

function isConfiguredAvdNameOutput(output) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines[0] === ANDROID_AVD_NAME;
}

async function queryConfiguredAvdName(adb, serial, execute = execFileAsync) {
  if (!/^emulator-\d+$/.test(serial)) return false;
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
  if (!/^emulator-\d+$/.test(serial)) return false;
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
      const run = { projectCwd, state: booted ? 'running' : 'starting', error: null, serial, logs: [], process: null };
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
      : { projectCwd, state: 'starting', error: null, serial: existingSerial, logs: [], process: null };
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

  const run = { projectCwd, state: 'starting', error: null, serial: null, logs: [], process: null };
  emulatorRun = run;
  androidGeneration += 1;
  const generation = androidGeneration;
  const child = spawn(tools.emulator, ['-avd', ANDROID_AVD_NAME, '-no-snapshot-save'], {
    env: getProcessEnv({ ANDROID_SDK_ROOT: tools.sdk, ANDROID_HOME: tools.sdk }),
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  run.process = child;
  child.stdout.on('data', (data) => appendLog(run, 'android', 'stdout', data));
  child.stderr.on('data', (data) => appendLog(run, 'android', 'stderr', data));
  child.once('error', (error) => {
    if (emulatorRun !== run) return;
    run.state = 'error'; run.error = sanitizeLog(error.message); publishAndroid(projectCwd);
  });
  child.once('close', (code) => {
    if (emulatorRun !== run) return;
    run.process = null;
    if (run.state === 'stopping' || run.state === 'stopped') { run.state = 'stopped'; run.error = null; }
    else if (run.state !== 'error') { run.state = code === 0 ? 'stopped' : 'error'; run.error = code ? `Emulator exited with code ${code}.` : null; }
    run.serial = null;
    publishAndroid(projectCwd);
  });
  publishAndroid(projectCwd);
  waitForAndroidBoot(run, tools.adb, generation);
  return publicAndroidStatus(projectCwd, targets);
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
  const run = { projectCwd, state: 'starting', error: null, logs: [], process: null };
  androidRun = run;
  const child = spawn(flutter.file, [...flutter.argsPrefix, 'run', '-d', serial], {
    cwd: targets.mobileCwd,
    env: getProcessEnv({ ANDROID_SDK_ROOT: tools.sdk, ANDROID_HOME: tools.sdk }),
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  run.process = child;
  child.stdout.on('data', (data) => { if (run.state === 'starting') run.state = 'running'; appendLog(run, 'android', 'stdout', data); publishAndroid(projectCwd); });
  child.stderr.on('data', (data) => appendLog(run, 'android', 'stderr', data));
  child.once('error', (error) => { if (androidRun === run) { run.state = 'error'; run.error = sanitizeLog(error.message, projectCwd); publishAndroid(projectCwd); } });
  child.once('close', (code) => {
    if (androidRun !== run) return;
    run.process = null;
    if (run.state !== 'stopping') { run.state = code === 0 ? 'stopped' : 'error'; run.error = code ? `Flutter exited with code ${code}.` : null; }
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
  if (webRun?.process) killProcessTree(webRun.process);
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

function setupPreviewHandlers(ipcMain, mainWindowProvider) {
  getMainWindow = mainWindowProvider;
  ipcMain.handle('preview:web-status', (_event, cwd) => getWebStatus(cwd));
  ipcMain.handle('preview:web-start', (_event, cwd) => startWeb(cwd));
  ipcMain.handle('preview:web-stop', (_event, cwd) => stopWeb(cwd));
  ipcMain.handle('preview:web-open-external', async (_event, cwd) => {
    const status = await getWebStatus(cwd);
    if (status.state !== 'ready' || !isTrustedPreviewUrl(status.url)) throw new Error('The trusted preview is not ready.');
    const { shell } = require('electron');
    await shell.openExternal(PREVIEW_URL);
    return true;
  });
  ipcMain.handle('preview:android-status', (_event, cwd) => getAndroidStatus(cwd));
  ipcMain.handle('preview:android-start-emulator', (_event, cwd) => startEmulator(cwd));
  ipcMain.handle('preview:android-stop-emulator', (_event, cwd) => stopEmulator(cwd));
  ipcMain.handle('preview:android-run-app', (_event, cwd) => runAndroidApp(cwd));
  ipcMain.handle('preview:android-stop-app', (_event, cwd) => stopAndroidApp(cwd));
}

module.exports = {
  PREVIEW_HOST, PREVIEW_PORT, PREVIEW_URL,
  buildWebDevArgs, classifyWebScript, detectManagedEmulatorSerial, detectProjectTargets,
  isAndroidBootComplete, isConfiguredAvdNameOutput, isTrustedPreviewUrl, parseAdbEmulatorSerials, sanitizeLog,
  setupPreviewHandlers, terminateAllPreviews,
};
