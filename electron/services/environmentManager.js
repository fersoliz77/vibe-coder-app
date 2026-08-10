const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const { buildSubprocessEnv } = require('./subprocessEnv');
const path = require('path');
const util = require('util');
const { killProcessTree } = require('./processUtils');
const { INSTALL_ALLOWLIST, SUPABASE_INSTRUCTION, itemMetadata, normalizeOptions } = require('./environmentCatalog');
const { buildInstallationPlan } = require('./environmentPlan');
const { parseVersionOutput, stripAnsi } = require('./environmentVersion');

const execFileAsync = util.promisify(execFile);
const MAX_OUTPUT_LENGTH = 12_000;
const ANDROID_API_LEVEL = '35';
const ANDROID_BUILD_TOOLS_VERSION = '35.0.0';
const ANDROID_AVD_NAME = 'Vibe_API_35';
const ANDROID_SYSTEM_IMAGE = 'system-images;android-35;google_apis;x86_64';
const ANDROID_COMMAND_LINE_TOOLS_VERSION = '13114758';
const ANDROID_COMMAND_LINE_TOOLS_URL = `https://dl.google.com/android/repository/commandlinetools-win-${ANDROID_COMMAND_LINE_TOOLS_VERSION}_latest.zip`;
const ANDROID_SDK_PACKAGES = Object.freeze([
  'platform-tools',
  'platforms;android-35',
  `build-tools;${ANDROID_BUILD_TOOLS_VERSION}`,
  'emulator',
  ANDROID_SYSTEM_IMAGE,
]);

let activeInstallation = null;
let nextInstallationId = 1;

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
  return buildSubprocessEnv({ extra: { PATH: getExtraPath(), FORCE_COLOR: '0', NO_COLOR: '1', ...extra } });
}

function getDefaultAndroidSdkPath() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Android', 'Sdk');
}

function getAndroidSdkPath() {
  return [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME, getDefaultAndroidSdkPath()]
    .filter(Boolean)
    .find((candidate) => fs.existsSync(candidate)) || getDefaultAndroidSdkPath();
}

function getAndroidAvdPath() {
  return path.join(process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android', 'avd'), `${ANDROID_AVD_NAME}.avd`);
}

function getAndroidSdkManagerPath(sdkPath) {
  const root = path.join(sdkPath, 'cmdline-tools');
  const candidates = [path.join(root, 'latest', 'bin', 'sdkmanager.bat')];
  try {
    for (const entry of fs.readdirSync(root)) candidates.push(path.join(root, entry, 'bin', 'sdkmanager.bat'));
  } catch {}
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getAndroidAvdManagerPath(sdkPath) {
  const root = path.join(sdkPath, 'cmdline-tools');
  const candidates = [path.join(root, 'latest', 'bin', 'avdmanager.bat')];
  try {
    for (const entry of fs.readdirSync(root)) candidates.push(path.join(root, entry, 'bin', 'avdmanager.bat'));
  } catch {}
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getAvdHardwareConfig(totalMemory = os.totalmem(), cpuCount = os.cpus().length) {
  if (totalMemory < 6 * 1024 ** 3 || cpuCount <= 2) {
    return { ramMb: 1024, cpuCores: 1, heapMb: 256, dataPartition: '4G' };
  }
  if (totalMemory < 12 * 1024 ** 3 || cpuCount <= 4) {
    return { ramMb: 1536, cpuCores: 2, heapMb: 384, dataPartition: '6G' };
  }
  return { ramMb: 2048, cpuCores: Math.min(4, cpuCount), heapMb: 512, dataPartition: '8G' };
}

async function findExecutable(name, candidates = [], signal) {
  for (const candidate of candidates.filter(Boolean)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const { stdout } = await execFileAsync('where.exe', [name], {
      env: getProcessEnv(),
      timeout: 7_000,
      windowsHide: true,
      signal,
    });
    return stdout.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

async function resolveNodeInvocation(signal) {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const nodePath = await findExecutable('node.exe', [path.join(programFiles, 'nodejs', 'node.exe')], signal);
  return nodePath ? { file: nodePath, argsPrefix: [] } : null;
}

async function resolveNpmInvocation(signal) {
  const node = await resolveNodeInvocation(signal);
  if (!node) return null;
  const npmCli = [
    path.join(path.dirname(node.file), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((candidate) => fs.existsSync(candidate));
  return npmCli ? { file: node.file, argsPrefix: [npmCli] } : null;
}

async function resolveNpmGlobalCli(tool, signal) {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const entries = {
    vercel: path.join(appData, 'npm', 'node_modules', 'vercel', 'dist', 'index.js'),
    firebase: path.join(appData, 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'),
  };
  const node = await resolveNodeInvocation(signal);
  const entry = entries[tool];
  if (node && entry && fs.existsSync(entry)) return { file: node.file, argsPrefix: [entry], displayPath: entry };
  return null;
}

async function runProbe(file, args = [], extraEnv = {}, signal) {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      env: getProcessEnv(extraEnv),
      timeout: 12_000,
      windowsHide: true,
      maxBuffer: 512 * 1024,
      signal,
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

async function probeCommandItem(id, name, args, candidates = [], signal) {
  const executable = await findExecutable(name, candidates, signal);
  if (!executable) return { installed: false, version: null, path: null };
  const result = await runProbe(executable, args, {}, signal);
  return {
    installed: result.success || Boolean(result.output),
    version: parseVersionOutput(id, result.output),
    path: executable,
    ...(!result.success && !result.output ? { error: result.error } : {}),
  };
}

async function probeNpm(signal) {
  const invocation = await resolveNpmInvocation(signal);
  if (!invocation) return { installed: false, version: null, path: null };
  const result = await runProbe(invocation.file, [...invocation.argsPrefix, '--version'], {}, signal);
  return {
    installed: result.success,
    version: parseVersionOutput('npm', result.output),
    path: invocation.argsPrefix[0],
    ...(!result.success ? { error: result.error } : {}),
  };
}

async function probeNpmGlobal(id, signal) {
  const invocation = await resolveNpmGlobalCli(id, signal);
  if (!invocation) return { installed: false, version: null, path: null };
  const result = await runProbe(invocation.file, [...invocation.argsPrefix, '--version'], {}, signal);
  return {
    installed: result.success || Boolean(result.output),
    version: parseVersionOutput(id, result.output),
    path: invocation.displayPath,
    ...(!result.success && !result.output ? { error: result.error } : {}),
  };
}

async function probeSupabase(signal) {
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
  const executable = await findExecutable('supabase.exe', [bundledPath, nativePath], signal);
  if (!executable) {
    const wrapper = await findExecutable('supabase.cmd', [], signal);
    return { installed: Boolean(wrapper), version: null, path: wrapper, ...(!wrapper ? { instruction: SUPABASE_INSTRUCTION } : {}) };
  }
  const result = await runProbe(executable, ['--version'], {}, signal);
  return {
    installed: result.success || Boolean(result.output),
    version: parseVersionOutput('supabase', result.output),
    path: executable,
  };
}

async function probeFlutter(signal) {
  const installedPath = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'flutter', 'bin', 'flutter.bat');
  const invocation = await resolveFlutterToolInvocation([installedPath], signal);
  if (!invocation) {
    const flutterPath = await findExecutable('flutter.bat', [installedPath], signal);
    return flutterPath ? { installed: true, version: null, path: flutterPath } : { installed: false, version: null, path: null };
  }
  const result = await runProbe(invocation.file, [...invocation.argsPrefix, '--version', '--machine'], {}, signal);
  let version = parseVersionOutput('flutter', result.output);
  if (!version) {
    try { version = JSON.parse(result.output).frameworkVersion || null; } catch {}
  }
  return { installed: true, version, path: invocation.flutterPath };
}

async function resolveFlutterToolInvocation(extraCandidates = [], signal) {
  const managedPath = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'flutter', 'bin', 'flutter.bat');
  const flutterPath = await findExecutable('flutter.bat', [...extraCandidates, managedPath], signal);
  if (!flutterPath) return null;
  const binDir = path.dirname(flutterPath);
  const dart = path.join(binDir, 'cache', 'dart-sdk', 'bin', 'dart.exe');
  const snapshot = path.join(binDir, 'cache', 'flutter_tools.snapshot');
  if (!fs.existsSync(dart) || !fs.existsSync(snapshot)) return null;
  return { file: dart, argsPrefix: [snapshot], flutterPath };
}

function probeAndroidSdk() {
  const sdkPath = getAndroidSdkPath();
  const components = {
    commandLineTools: Boolean(getAndroidSdkManagerPath(sdkPath)),
    platformTools: fs.existsSync(path.join(sdkPath, 'platform-tools', 'adb.exe')),
    platform: fs.existsSync(path.join(sdkPath, 'platforms', `android-${ANDROID_API_LEVEL}`, 'android.jar')),
    buildTools: fs.existsSync(path.join(sdkPath, 'build-tools', ANDROID_BUILD_TOOLS_VERSION, 'aapt.exe')),
    emulator: fs.existsSync(path.join(sdkPath, 'emulator', 'emulator.exe')),
    systemImage: fs.existsSync(path.join(sdkPath, 'system-images', `android-${ANDROID_API_LEVEL}`, 'google_apis', 'x86_64', 'package.xml')),
    avd: fs.existsSync(path.join(getAndroidAvdPath(), 'config.ini')),
  };
  const missing = Object.entries(components).filter(([, available]) => !available).map(([name]) => name);
  if (missing.length) {
    const labels = {
      commandLineTools: 'las herramientas de linea de comandos',
      platformTools: 'platform-tools',
      platform: `Android API ${ANDROID_API_LEVEL}`,
      buildTools: `build-tools ${ANDROID_BUILD_TOOLS_VERSION}`,
      emulator: 'el emulador',
      systemImage: 'la imagen Google APIs x86_64 de API 35',
      avd: `el AVD ${ANDROID_AVD_NAME}`,
    };
    return {
      installed: false,
      version: null,
      path: fs.existsSync(sdkPath) ? sdkPath : null,
      components,
      instruction: `Faltan ${missing.map((name) => labels[name]).join(', ')}. Ejecuta la instalacion del entorno para preparar el SDK y el AVD sin abrir el emulador.`,
    };
  }
  return { installed: true, version: ANDROID_BUILD_TOOLS_VERSION, path: sdkPath, components };
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

async function probeEnvironmentItem(id, signal) {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  if (id === 'node') return probeCommandItem(id, 'node.exe', ['--version'], [path.join(programFiles, 'nodejs', 'node.exe')], signal);
  if (id === 'npm') return probeNpm(signal);
  if (id === 'git') return probeCommandItem(id, 'git.exe', ['--version'], [path.join(programFiles, 'Git', 'cmd', 'git.exe')], signal);
  if (id === 'gh') return probeCommandItem(id, 'gh.exe', ['--version'], [path.join(programFiles, 'GitHub CLI', 'gh.exe')], signal);
  if (id === 'vercel' || id === 'firebase') return probeNpmGlobal(id, signal);
  if (id === 'supabase') return probeSupabase(signal);
  if (id === 'flutter') return probeFlutter(signal);
  if (id === 'java') {
    const jdk = await probeCommandItem(id, 'javac.exe', ['--version'], getJdk17Candidates(), signal);
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

async function checkEnvironment(options = {}, { signal } = {}) {
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
    ...await probeEnvironmentItem(id, signal),
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

function emitProgress(callback, event) {
  if (typeof callback !== 'function') return;
  try { callback({ timestamp: new Date().toISOString(), ...event }); } catch {}
}

function appendOutput(current, chunk) {
  const combined = current + chunk;
  return combined.length > MAX_OUTPUT_LENGTH ? combined.slice(-MAX_OUTPUT_LENGTH) : combined;
}

function runTracked(run, file, args, progress, extraEnv = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(file, args, {
      env: getProcessEnv(extraEnv),
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

async function installAndroidCommandLineTools(run, sdkPath, progress) {
  const destination = path.join(sdkPath, 'cmdline-tools', 'latest');
  if (getAndroidSdkManagerPath(sdkPath)) return { success: true, skipped: true };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const archive = path.join(sdkPath, `commandlinetools-${ANDROID_COMMAND_LINE_TOOLS_VERSION}.zip`);
  const extractPath = path.join(sdkPath, `.commandlinetools-${run.id}`);
  fs.rmSync(extractPath, { recursive: true, force: true });
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Invoke-WebRequest -Uri $env:VIBE_ANDROID_TOOLS_URL -OutFile $env:VIBE_ANDROID_TOOLS_ARCHIVE -UseBasicParsing',
    'Expand-Archive -LiteralPath $env:VIBE_ANDROID_TOOLS_ARCHIVE -DestinationPath $env:VIBE_ANDROID_TOOLS_EXTRACT -Force',
    "$source = Join-Path $env:VIBE_ANDROID_TOOLS_EXTRACT 'cmdline-tools'",
    "if (!(Test-Path -LiteralPath (Join-Path $source 'bin\\sdkmanager.bat'))) { throw 'The downloaded Android command-line tools archive has an unexpected layout.' }",
    'Remove-Item -LiteralPath $env:VIBE_ANDROID_TOOLS_DESTINATION -Recurse -Force -ErrorAction SilentlyContinue',
    'Move-Item -LiteralPath $source -Destination $env:VIBE_ANDROID_TOOLS_DESTINATION',
    'Remove-Item -LiteralPath $env:VIBE_ANDROID_TOOLS_ARCHIVE -Force -ErrorAction SilentlyContinue',
    'Remove-Item -LiteralPath $env:VIBE_ANDROID_TOOLS_EXTRACT -Recurse -Force -ErrorAction SilentlyContinue',
  ].join('; ');
  if (run.cancelled) return { success: false, cancelled: true };
  const result = await runTracked(run, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], progress, {
    VIBE_ANDROID_TOOLS_URL: ANDROID_COMMAND_LINE_TOOLS_URL,
    VIBE_ANDROID_TOOLS_ARCHIVE: archive,
    VIBE_ANDROID_TOOLS_EXTRACT: extractPath,
    VIBE_ANDROID_TOOLS_DESTINATION: destination,
  });
  if (run.cancelled) {
    fs.rmSync(extractPath, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
    return { success: false, cancelled: true };
  }
  if (!result.success) {
    fs.rmSync(extractPath, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
  }
  return result;
}

function runAndroidBatch(run, managerPath, progress, sdkPath, acceptLicenses = false) {
  const script = acceptLicenses
    ? "1..100 | ForEach-Object { 'y' } | & $env:VIBE_ANDROID_MANAGER '--licenses'; exit $LASTEXITCODE"
    : "& $env:VIBE_ANDROID_MANAGER 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0' 'emulator' 'system-images;android-35;google_apis;x86_64'; exit $LASTEXITCODE";
  return runTracked(run, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], progress, {
    ANDROID_SDK_ROOT: sdkPath,
    ANDROID_HOME: sdkPath,
    VIBE_ANDROID_MANAGER: managerPath,
  });
}

function tuneAndroidAvd() {
  const configPath = path.join(getAndroidAvdPath(), 'config.ini');
  const hardware = getAvdHardwareConfig();
  let lines = [];
  try { lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/).filter(Boolean); } catch {}
  const values = {
    'AvdId': ANDROID_AVD_NAME,
    'abi.type': 'x86_64',
    'image.sysdir.1': 'system-images/android-35/google_apis/x86_64/',
    'tag.display': 'Google APIs',
    'tag.id': 'google_apis',
    'hw.cpu.ncore': String(hardware.cpuCores),
    'hw.ramSize': String(hardware.ramMb),
    'vm.heapSize': String(hardware.heapMb),
    'disk.dataPartition.size': hardware.dataPartition,
  };
  const remaining = new Set(Object.keys(values));
  lines = lines.map((line) => {
    const key = line.split('=', 1)[0];
    if (!remaining.has(key)) return line;
    remaining.delete(key);
    return `${key}=${values[key]}`;
  });
  for (const key of remaining) lines.push(`${key}=${values[key]}`);
  fs.writeFileSync(configPath, `${lines.join('\n')}\n`, 'utf8');
}

async function provisionAndroidSdk(run, progress) {
  const sdkPath = getAndroidSdkPath();
  fs.mkdirSync(sdkPath, { recursive: true });
  if (run.cancelled) return { success: false, cancelled: true };
  let result = await installAndroidCommandLineTools(run, sdkPath, progress);
  if (run.cancelled) return { success: false, cancelled: true };
  if (!result.success) return result;
  const sdkmanager = getAndroidSdkManagerPath(sdkPath);
  const avdmanager = getAndroidAvdManagerPath(sdkPath);
  if (!sdkmanager || !avdmanager) return { success: false, error: 'No se encontraron sdkmanager y avdmanager despues de instalar las herramientas de linea de comandos.' };

  if (run.cancelled) return { success: false, cancelled: true };
  result = await runAndroidBatch(run, sdkmanager, progress, sdkPath, true);
  if (run.cancelled) return { success: false, cancelled: true };
  if (!result.success) return result;
  if (run.cancelled) return { success: false, cancelled: true };
  result = await runAndroidBatch(run, sdkmanager, progress, sdkPath);
  if (run.cancelled) return { success: false, cancelled: true };
  if (!result.success) return result;

  if (!fs.existsSync(path.join(getAndroidAvdPath(), 'config.ini'))) {
    const script = "'no' | & $env:VIBE_ANDROID_MANAGER 'create' 'avd' '--name' 'Vibe_API_35' '--package' 'system-images;android-35;google_apis;x86_64' '--force'; exit $LASTEXITCODE";
    if (run.cancelled) return { success: false, cancelled: true };
    result = await runTracked(run, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], progress, {
      ANDROID_SDK_ROOT: sdkPath,
      ANDROID_HOME: sdkPath,
      VIBE_ANDROID_MANAGER: avdmanager,
    });
    if (run.cancelled) return { success: false, cancelled: true };
    if (!result.success) return result;
  }
  tuneAndroidAvd();
  return { success: true };
}

async function resolveInstallationInvocation(step, signal) {
  if (step.file !== 'npm') return { file: step.file, args: [...step.args] };
  const npm = await resolveNpmInvocation(signal);
  if (!npm) return null;
  return { file: npm.file, args: [...npm.argsPrefix, ...step.args] };
}

function cancelledInstallation(progress, results) {
  emitProgress(progress, { type: 'cancelled', message: 'Instalación cancelada.' });
  return { success: false, cancelled: true, steps: results };
}

async function installAllEnvironment(options = {}, onProgress, dependencies = {}) {
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

  const run = { id: nextInstallationId++, cancelled: false, controller: new AbortController(), processes: new Set() };
  activeInstallation = run;
  const results = [];
  const check = dependencies.checkEnvironment || checkEnvironment;
  const resolveInvocation = dependencies.resolveInstallationInvocation || resolveInstallationInvocation;
  const track = dependencies.runTracked || runTracked;
  const probeItem = dependencies.probeEnvironmentItem || probeEnvironmentItem;
  const provisionAndroid = dependencies.provisionAndroidSdk || provisionAndroidSdk;

  try {
    emitProgress(progress, { type: 'checking', message: 'Comprobando el entorno actual...' });
    const before = await check(normalized, { signal: run.controller.signal });
    if (run.cancelled) return cancelledInstallation(progress, results);
    const plan = buildInstallationPlan(normalized, before);
    const provisioningNeeded = normalized.includeMobile && !before.items.find((item) => item.id === 'android-sdk')?.installed;
    const totalSteps = plan.length + (provisioningNeeded ? 1 : 0);
    emitProgress(progress, { type: 'start', current: 0, total: totalSteps, message: totalSteps ? 'Iniciando instalación secuencial.' : 'El entorno ya está preparado.' });

    for (let index = 0; index < plan.length; index += 1) {
      if (run.cancelled) break;
      const step = plan[index];
      const baseEvent = { stepId: step.id, label: step.label, current: index + 1, total: totalSteps };
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

      const invocation = await resolveInvocation(step, run.controller.signal);
      if (run.cancelled) return cancelledInstallation(progress, results);
      if (!invocation) {
        const result = { id: step.id, success: false, error: 'npm no está disponible después de instalar Node.js.' };
        results.push(result);
        emitProgress(progress, { type: 'step-error', ...baseEvent, message: result.error });
        continue;
      }
      if (flutterTemporaryPath) invocation.args[invocation.args.length - 1] = flutterTemporaryPath;
      if (run.cancelled) return cancelledInstallation(progress, results);
      let execution = await track(run, invocation.file, invocation.args, (event) => emitProgress(progress, { ...baseEvent, ...event }));
      if (run.cancelled) {
        if (flutterTemporaryPath) fs.rmSync(flutterTemporaryPath, { recursive: true, force: true });
        return cancelledInstallation(progress, results);
      }
      if (flutterTemporaryPath) {
        const flutterTarget = step.args.at(-1);
        if (execution.success && !run.cancelled) {
          fs.renameSync(flutterTemporaryPath, flutterTarget);
          const flutterBatch = path.join(flutterTarget, 'bin', 'flutter.bat');
          if (run.cancelled) return cancelledInstallation(progress, results);
          execution = await track(run, process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${flutterBatch}" --version`], (event) => emitProgress(progress, { ...baseEvent, ...event }));
          if (run.cancelled) return cancelledInstallation(progress, results);
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

    if (!run.cancelled && provisioningNeeded) {
      const baseEvent = { stepId: 'android-sdk-provision', label: 'Android SDK y AVD API 35', current: plan.length + 1, total: totalSteps };
      emitProgress(progress, { type: 'step-start', ...baseEvent, message: 'Preparando las herramientas, imagen y AVD de Android...' });
      const [java, flutter] = await Promise.all([
        probeItem('java', run.controller.signal),
        probeItem('flutter', run.controller.signal),
      ]);
      if (run.cancelled) return cancelledInstallation(progress, results);
      let execution;
      if (!java.installed || !flutter.installed) {
        const missing = [!java.installed && 'JDK 17', !flutter.installed && 'Flutter'].filter(Boolean).join(' y ');
        execution = { success: false, error: `No se puede preparar Android hasta que estén disponibles: ${missing}.` };
      } else {
        if (run.cancelled) return cancelledInstallation(progress, results);
        execution = await provisionAndroid(run, (event) => emitProgress(progress, { ...baseEvent, ...event }));
        if (run.cancelled) return cancelledInstallation(progress, results);
      }
      const result = { id: 'android-sdk-provision', ...execution };
      results.push(result);
      emitProgress(progress, {
        type: execution.success ? 'step-complete' : 'step-error',
        ...baseEvent,
        message: execution.success ? 'Android SDK y AVD API 35 completados.' : execution.error,
      });
    }

    if (run.cancelled) {
      return cancelledInstallation(progress, results);
    }

    const after = await check(normalized, { signal: run.controller.signal });
    if (run.cancelled) return cancelledInstallation(progress, results);
    const success = results.every((result) => result.success) && after.summary.requiredMissing === 0;
    if (run.cancelled) return cancelledInstallation(progress, results);
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
  activeInstallation.controller.abort();
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
  ANDROID_AVD_NAME,
  ANDROID_BUILD_TOOLS_VERSION,
  ANDROID_COMMAND_LINE_TOOLS_URL,
  ANDROID_SDK_PACKAGES,
  ANDROID_SYSTEM_IMAGE,
  INSTALL_ALLOWLIST,
  SUPABASE_INSTRUCTION,
  buildInstallationPlan,
  cancelEnvironmentInstallation,
  checkEnvironment,
  getAvdHardwareConfig,
  getAndroidAvdPath,
  getAndroidSdkPath,
  getProcessEnv,
  installAllEnvironment,
  normalizeOptions,
  parseVersionOutput,
  resolveNpmInvocation,
  resolveFlutterToolInvocation,
  setupEnvironmentHandlers,
};
