const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { killProcessTree } = require('./processUtils');

const execFileAsync = util.promisify(execFile);
const SUPPORTED_BACKENDS = Object.freeze(['firebase', 'supabase']);
const SUPABASE_INSTRUCTION = 'Instala Supabase CLI siguiendo la guía oficial: https://supabase.com/docs/guides/local-development/cli/getting-started. Después, vuelve a comprobar el entorno.';
const MAX_OUTPUT_LENGTH = 12_000;

const WINGET_ARGS = Object.freeze([
  'install',
  '--exact',
  '--silent',
  '--accept-package-agreements',
  '--accept-source-agreements',
  '--disable-interactivity',
]);

const INSTALL_ALLOWLIST = Object.freeze({
  node: Object.freeze({
    id: 'node',
    label: 'Node.js LTS',
    file: 'winget.exe',
    args: Object.freeze([...WINGET_ARGS, '--id', 'OpenJS.NodeJS.LTS']),
  }),
  git: Object.freeze({
    id: 'git',
    label: 'Git',
    file: 'winget.exe',
    args: Object.freeze([...WINGET_ARGS, '--id', 'Git.Git']),
  }),
  gh: Object.freeze({
    id: 'gh',
    label: 'GitHub CLI',
    file: 'winget.exe',
    args: Object.freeze([...WINGET_ARGS, '--id', 'GitHub.cli']),
  }),
  java: Object.freeze({
    id: 'java',
    label: 'JDK 17',
    file: 'winget.exe',
    args: Object.freeze([...WINGET_ARGS, '--id', 'EclipseAdoptium.Temurin.17.JDK']),
  }),
  'android-sdk': Object.freeze({
    id: 'android-sdk',
    label: 'Android Studio y Android SDK',
    file: 'winget.exe',
    args: Object.freeze([...WINGET_ARGS, '--id', 'Google.AndroidStudio']),
  }),
  flutter: Object.freeze({
    id: 'flutter',
    label: 'Flutter',
    file: 'git',
    args: Object.freeze([
      'clone', '--branch', 'stable', '--depth', '1',
      'https://github.com/flutter/flutter.git',
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'flutter'),
    ]),
  }),
  vercel: Object.freeze({
    id: 'vercel',
    label: 'Vercel CLI',
    file: 'npm',
    args: Object.freeze(['install', '--global', 'vercel']),
  }),
  firebase: Object.freeze({
    id: 'firebase',
    label: 'Firebase CLI',
    file: 'npm',
    args: Object.freeze(['install', '--global', 'firebase-tools']),
  }),
});

const INSTALL_ORDER = Object.freeze(['node', 'git', 'gh', 'java', 'android-sdk', 'flutter', 'vercel', 'firebase']);
let activeInstallation = null;
let nextInstallationId = 1;

function normalizeOptions(options = {}) {
  if (!options || typeof options !== 'object') options = {};
  const backend = options.backend == null ? 'firebase' : String(options.backend).toLowerCase();
  if (!SUPPORTED_BACKENDS.includes(backend)) {
    throw new TypeError(`Backend no soportado. Usa uno de: ${SUPPORTED_BACKENDS.join(', ')}.`);
  }
  return { includeMobile: options.includeMobile === true, backend };
}

function stripAnsi(value) {
  return String(value || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
}

function parseVersionOutput(tool, output) {
  const clean = stripAnsi(output).replace(/\r/g, '');
  if (!clean) return null;

  const patterns = {
    node: /(?:^|\s)v(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i,
    npm: /(?:^|\s)(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?:\s|$)/,
    git: /git version\s+([^\s]+)/i,
    gh: /gh version\s+([^\s]+)/i,
    vercel: /(?:vercel(?: cli)?\s+)?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i,
    firebase: /(?:firebase(?: cli)?\s+)?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i,
    supabase: /(?:supabase(?: cli)?\s+)?v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i,
    flutter: /flutter\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i,
    java: /(?:openjdk|java|javac)\s+(?:version\s+)?["']?(\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?)/i,
  };
  const match = clean.match(patterns[tool] || /(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i);
  return match ? match[1] : null;
}

function getExtraPath() {
  const home = os.homedir();
  const entries = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
    path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI'),
    process.env.PATH,
  ];
  return entries.filter(Boolean).join(path.delimiter);
}

function getProcessEnv(extra = {}) {
  const env = { ...process.env, PATH: getExtraPath(), FORCE_COLOR: '0', NO_COLOR: '1', ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  return env;
}

async function findExecutable(name, candidates = []) {
  for (const candidate of candidates.filter(Boolean)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const { stdout } = await execFileAsync('where.exe', [name], {
      env: getProcessEnv(),
      timeout: 7_000,
      windowsHide: true,
    });
    return stdout.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

async function resolveNodeInvocation() {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const nodePath = await findExecutable('node.exe', [path.join(programFiles, 'nodejs', 'node.exe')]);
  return nodePath ? { file: nodePath, argsPrefix: [] } : null;
}

async function resolveNpmInvocation() {
  const node = await resolveNodeInvocation();
  if (!node) return null;
  const npmCli = [
    path.join(path.dirname(node.file), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((candidate) => fs.existsSync(candidate));
  return npmCli ? { file: node.file, argsPrefix: [npmCli] } : null;
}

async function resolveNpmGlobalCli(tool) {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const entries = {
    vercel: path.join(appData, 'npm', 'node_modules', 'vercel', 'dist', 'index.js'),
    firebase: path.join(appData, 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'),
  };
  const node = await resolveNodeInvocation();
  const entry = entries[tool];
  if (node && entry && fs.existsSync(entry)) return { file: node.file, argsPrefix: [entry], displayPath: entry };
  return null;
}

async function runProbe(file, args = [], extraEnv = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      env: getProcessEnv(extraEnv),
      timeout: 12_000,
      windowsHide: true,
      maxBuffer: 512 * 1024,
    });
    return { success: true, output: `${stdout || ''}\n${stderr || ''}`.trim() };
  } catch (error) {
    return {
      success: false,
      output: `${error.stdout || ''}\n${error.stderr || ''}`.trim(),
      error: error.message,
    };
  }
}

function itemMetadata(id, options) {
  const metadata = {
    node: { name: 'Node.js', category: 'core', required: true, installable: true },
    npm: { name: 'npm', category: 'core', required: true, installable: true },
    git: { name: 'Git', category: 'core', required: true, installable: true },
    gh: { name: 'GitHub CLI', category: 'tools', required: true, installable: true },
    vercel: { name: 'Vercel CLI', category: 'deployment', required: true, installable: true },
    firebase: { name: 'Firebase CLI', category: 'backend', required: options.backend === 'firebase', installable: true },
    supabase: { name: 'Supabase CLI', category: 'backend', required: options.backend === 'supabase', installable: false },
    flutter: { name: 'Flutter', category: 'mobile', required: true, installable: true },
    java: { name: 'JDK 17', category: 'mobile', required: true, installable: true },
    'android-sdk': { name: 'Android SDK', category: 'mobile', required: true, installable: true },
  };
  return { id, ...metadata[id] };
}

async function probeCommandItem(id, name, args, candidates = []) {
  const executable = await findExecutable(name, candidates);
  if (!executable) return { installed: false, version: null, path: null };
  const result = await runProbe(executable, args);
  return {
    installed: result.success || Boolean(result.output),
    version: parseVersionOutput(id, result.output),
    path: executable,
    ...(!result.success && !result.output ? { error: result.error } : {}),
  };
}

async function probeNpm() {
  const invocation = await resolveNpmInvocation();
  if (!invocation) return { installed: false, version: null, path: null };
  const result = await runProbe(invocation.file, [...invocation.argsPrefix, '--version']);
  return {
    installed: result.success,
    version: parseVersionOutput('npm', result.output),
    path: invocation.argsPrefix[0],
    ...(!result.success ? { error: result.error } : {}),
  };
}

async function probeNpmGlobal(id) {
  const invocation = await resolveNpmGlobalCli(id);
  if (!invocation) return { installed: false, version: null, path: null };
  const result = await runProbe(invocation.file, [...invocation.argsPrefix, '--version']);
  return {
    installed: result.success || Boolean(result.output),
    version: parseVersionOutput(id, result.output),
    path: invocation.displayPath,
    ...(!result.success && !result.output ? { error: result.error } : {}),
  };
}

async function probeSupabase() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const nativePath = path.join(
    appData,
    'npm',
    'node_modules',
    'supabase',
    'node_modules',
    `@supabase/cli-windows-${process.arch}`,
    'bin',
    'supabase.exe',
  );
  const bundledPath = path.join(__dirname, '..', '..', 'node_modules', `@supabase/cli-windows-${process.arch}`, 'bin', 'supabase.exe')
    .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  const executable = await findExecutable('supabase.exe', [bundledPath, nativePath]);
  if (!executable) {
    const wrapper = await findExecutable('supabase.cmd');
    return { installed: Boolean(wrapper), version: null, path: wrapper, ...(!wrapper ? { instruction: SUPABASE_INSTRUCTION } : {}) };
  }
  const result = await runProbe(executable, ['--version']);
  return {
    installed: result.success || Boolean(result.output),
    version: parseVersionOutput('supabase', result.output),
    path: executable,
  };
}

async function probeFlutter() {
  const installedPath = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'flutter', 'bin', 'flutter.bat');
  const flutterPath = await findExecutable('flutter.bat', [installedPath]);
  if (!flutterPath) return { installed: false, version: null, path: null };
  const binDir = path.dirname(flutterPath);
  const dart = path.join(binDir, 'cache', 'dart-sdk', 'bin', 'dart.exe');
  const snapshot = path.join(binDir, 'cache', 'flutter_tools.snapshot');
  if (!fs.existsSync(dart) || !fs.existsSync(snapshot)) return { installed: true, version: null, path: flutterPath };
  const result = await runProbe(dart, [snapshot, '--version', '--machine']);
  let version = parseVersionOutput('flutter', result.output);
  if (!version) {
    try { version = JSON.parse(result.output).frameworkVersion || null; } catch {}
  }
  return { installed: true, version, path: flutterPath };
}

function probeAndroidSdk() {
  const sdkPath = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Android', 'Sdk'),
  ].filter(Boolean).find((candidate) => fs.existsSync(candidate));
  if (!sdkPath) {
    return {
      installed: false,
      version: null,
      path: null,
      instruction: 'Android Studio instalará el SDK. Ábrelo una vez para completar el asistente y aceptar las licencias.',
    };
  }
  let version = null;
  try {
    const versions = fs.readdirSync(path.join(sdkPath, 'build-tools')).filter((entry) => /^\d+(?:\.\d+)+/.test(entry));
    version = versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] || null;
  } catch {}
  return { installed: true, version, path: sdkPath };
}

function getJdk17Candidates() {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const roots = [
    path.join(programFiles, 'Microsoft'),
    path.join(programFiles, 'Java'),
    path.join(programFiles, 'Eclipse Adoptium'),
  ];
  const candidates = [];
  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && /(?:jdk[-_]?17|17\.)/i.test(entry.name)) {
          candidates.push(path.join(root, entry.name, 'bin', 'javac.exe'));
        }
      }
    } catch {}
  }
  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'javac.exe'));
  return candidates.filter(Boolean);
}

async function probeEnvironmentItem(id) {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  if (id === 'node') return probeCommandItem(id, 'node.exe', ['--version'], [path.join(programFiles, 'nodejs', 'node.exe')]);
  if (id === 'npm') return probeNpm();
  if (id === 'git') return probeCommandItem(id, 'git.exe', ['--version'], [path.join(programFiles, 'Git', 'cmd', 'git.exe')]);
  if (id === 'gh') return probeCommandItem(id, 'gh.exe', ['--version'], [path.join(programFiles, 'GitHub CLI', 'gh.exe')]);
  if (id === 'vercel' || id === 'firebase') return probeNpmGlobal(id);
  if (id === 'supabase') return probeSupabase();
  if (id === 'flutter') return probeFlutter();
  if (id === 'java') {
    const jdk = await probeCommandItem(id, 'javac.exe', ['--version'], getJdk17Candidates());
    if (!jdk.installed || jdk.version?.split('.')[0] === '17') return jdk;
    return {
      ...jdk,
      installed: false,
      detectedVersion: jdk.version,
      instruction: `Se detectó JDK ${jdk.version}; esta configuración requiere JDK 17.`,
    };
  }
  if (id === 'android-sdk') return probeAndroidSdk();
  return { installed: false, version: null, path: null, error: 'Componente desconocido.' };
}

async function checkEnvironment(options = {}) {
  const normalized = normalizeOptions(options);
  if (process.platform !== 'win32') {
    return {
      supported: false,
      platform: process.platform,
      ...normalized,
      checkedAt: new Date().toISOString(),
      items: [],
      summary: { installed: 0, missing: 0, requiredMissing: 0 },
      error: 'La configuración automática del entorno sólo está disponible en Windows.',
    };
  }

  const ids = ['node', 'npm', 'git', 'gh', 'vercel'];
  if (normalized.backend !== 'none' && !ids.includes(normalized.backend)) ids.push(normalized.backend);
  if (normalized.includeMobile) ids.push('flutter', 'java', 'android-sdk');

  const items = await Promise.all(ids.map(async (id) => ({
    ...itemMetadata(id, normalized),
    ...await probeEnvironmentItem(id),
  })));
  const missing = items.filter((item) => !item.installed);
  return {
    supported: true,
    platform: 'win32',
    ...normalized,
    checkedAt: new Date().toISOString(),
    items,
    summary: {
      installed: items.length - missing.length,
      missing: missing.length,
      requiredMissing: missing.filter((item) => item.required).length,
    },
    instructions: missing.filter((item) => item.instruction).map((item) => ({ id: item.id, text: item.instruction })),
  };
}

function getInstalledIds(environment) {
  const items = Array.isArray(environment?.items) ? environment.items : [];
  return new Set(items.filter((item) => item.installed).map((item) => item.id));
}

function buildInstallationPlan(options = {}, environment = { items: [] }) {
  const normalized = normalizeOptions(options);
  const installed = getInstalledIds(environment);
  const selected = new Set(['node', 'git', 'gh', 'vercel']);
  if (normalized.includeMobile) ['java', 'android-sdk', 'flutter'].forEach((id) => selected.add(id));
  if (normalized.backend === 'firebase') selected.add('firebase');

  // Reinstalling Node LTS is the allowlisted repair path when npm is missing.
  if (installed.has('node') && installed.has('npm')) selected.delete('node');
  for (const id of ['git', 'gh', 'vercel', 'java', 'android-sdk', 'flutter', 'firebase']) {
    if (installed.has(id)) selected.delete(id);
  }
  return INSTALL_ORDER.filter((id) => selected.has(id)).map((id) => INSTALL_ALLOWLIST[id]);
}

function emitProgress(callback, event) {
  if (typeof callback !== 'function') return;
  try { callback({ timestamp: new Date().toISOString(), ...event }); } catch {}
}

function appendOutput(current, chunk) {
  const combined = current + chunk;
  return combined.length > MAX_OUTPUT_LENGTH ? combined.slice(-MAX_OUTPUT_LENGTH) : combined;
}

function runTracked(run, file, args, progress) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(file, args, {
      env: getProcessEnv(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    run.processes.add(child);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      run.processes.delete(child);
      resolve({ ...result, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) });
    };
    const consume = (stream) => (data) => {
      const text = stripAnsi(data.toString());
      if (!text) return;
      if (stream === 'stdout') stdout = appendOutput(stdout, `${text}\n`);
      else stderr = appendOutput(stderr, `${text}\n`);
      emitProgress(progress, { type: 'output', stream, message: text });
    };

    child.stdout.on('data', consume('stdout'));
    child.stderr.on('data', consume('stderr'));
    child.once('error', (error) => finish({ success: false, code: null, error: error.message }));
    child.once('close', (code) => finish({ success: code === 0, code, error: code === 0 ? null : `${path.basename(file)} finalizó con código ${code}.` }));
  });
}

async function resolveInstallationInvocation(step) {
  if (step.file !== 'npm') return { file: step.file, args: [...step.args] };
  const npm = await resolveNpmInvocation();
  if (!npm) return null;
  return { file: npm.file, args: [...npm.argsPrefix, ...step.args] };
}

async function installAllEnvironment(options = {}, onProgress) {
  let normalized;
  try {
    normalized = normalizeOptions(options);
  } catch (error) {
    return { success: false, error: error.message, steps: [] };
  }
  const progress = typeof onProgress === 'function' ? onProgress : options?.onProgress;
  if (process.platform !== 'win32') {
    return { success: false, unsupported: true, error: 'La instalación automática sólo está disponible en Windows.', steps: [] };
  }
  if (activeInstallation) {
    return { success: false, busy: true, error: 'Ya hay una instalación del entorno en curso.', steps: [] };
  }

  const run = { id: nextInstallationId++, cancelled: false, processes: new Set() };
  activeInstallation = run;
  const results = [];

  try {
    emitProgress(progress, { type: 'checking', message: 'Comprobando el entorno actual...' });
    const before = await checkEnvironment(normalized);
    if (run.cancelled) return { success: false, cancelled: true, steps: results };
    const plan = buildInstallationPlan(normalized, before);
    emitProgress(progress, { type: 'start', current: 0, total: plan.length, message: plan.length ? 'Iniciando instalación secuencial.' : 'El entorno ya está preparado.' });

    for (let index = 0; index < plan.length; index += 1) {
      if (run.cancelled) break;
      const step = plan[index];
      const baseEvent = { stepId: step.id, label: step.label, current: index + 1, total: plan.length };
      emitProgress(progress, { type: 'step-start', ...baseEvent, message: `Instalando ${step.label}...` });

      if (run.cancelled) break;

      let flutterTemporaryPath = null;
      if (step.id === 'flutter') {
        const flutterTarget = step.args.at(-1);
        fs.mkdirSync(path.dirname(flutterTarget), { recursive: true });
        if (fs.existsSync(flutterTarget)) {
          const result = { id: step.id, success: false, error: 'Existe una instalación incompleta de Flutter. Elimínala desde el Centro de configuración y vuelve a intentar.' };
          results.push(result);
          emitProgress(progress, { type: 'step-error', ...baseEvent, message: result.error });
          continue;
        }
        flutterTemporaryPath = `${flutterTarget}.installing-${run.id}`;
        fs.rmSync(flutterTemporaryPath, { recursive: true, force: true });
      }

      const invocation = await resolveInstallationInvocation(step);
      if (!invocation) {
        const result = { id: step.id, success: false, error: 'npm no está disponible después de instalar Node.js.' };
        results.push(result);
        emitProgress(progress, { type: 'step-error', ...baseEvent, message: result.error });
        continue;
      }
      if (flutterTemporaryPath) invocation.args[invocation.args.length - 1] = flutterTemporaryPath;
      let execution = await runTracked(run, invocation.file, invocation.args, (event) => emitProgress(progress, { ...baseEvent, ...event }));
      if (flutterTemporaryPath) {
        const flutterTarget = step.args.at(-1);
        if (execution.success && !run.cancelled) {
          fs.renameSync(flutterTemporaryPath, flutterTarget);
          const flutterBatch = path.join(flutterTarget, 'bin', 'flutter.bat');
          execution = await runTracked(run, process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${flutterBatch}" --version`], (event) => emitProgress(progress, { ...baseEvent, ...event }));
        } else {
          fs.rmSync(flutterTemporaryPath, { recursive: true, force: true });
        }
      }
      const result = { id: step.id, ...execution };
      results.push(result);
      emitProgress(progress, {
        type: execution.success ? 'step-complete' : 'step-error',
        ...baseEvent,
        message: execution.success ? `${step.label} completado.` : execution.error,
      });
    }

    if (run.cancelled) {
      emitProgress(progress, { type: 'cancelled', message: 'Instalación cancelada.' });
      return { success: false, cancelled: true, steps: results };
    }

    const after = await checkEnvironment(normalized);
    const success = results.every((result) => result.success) && after.summary.requiredMissing === 0;
    emitProgress(progress, { type: 'complete', message: success ? 'Instalación finalizada.' : 'Instalación finalizada con incidencias.', success });
    return { success, cancelled: false, steps: results, environment: after, instructions: after.instructions };
  } catch (error) {
    emitProgress(progress, { type: 'error', message: error.message });
    return { success: false, cancelled: run.cancelled, error: error.message, steps: results };
  } finally {
    if (activeInstallation?.id === run.id) activeInstallation = null;
  }
}

function cancelEnvironmentInstallation() {
  if (!activeInstallation) return { success: true, cancelled: false };
  activeInstallation.cancelled = true;
  for (const child of activeInstallation.processes) killProcessTree(child);
  activeInstallation.processes.clear();
  return { success: true, cancelled: true };
}

function setupEnvironmentHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('setup:environment-check', (_event, options) => checkEnvironment(options));
  ipcMain.handle('setup:environment-install', (_event, options) => {
    return installAllEnvironment(options, (progress) => {
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('setup:environment-progress', progress);
      }
    });
  });
  ipcMain.handle('setup:environment-cancel', () => cancelEnvironmentInstallation());
}

module.exports = {
  INSTALL_ALLOWLIST,
  SUPABASE_INSTRUCTION,
  buildInstallationPlan,
  cancelEnvironmentInstallation,
  checkEnvironment,
  installAllEnvironment,
  normalizeOptions,
  parseVersionOutput,
  setupEnvironmentHandlers,
};
