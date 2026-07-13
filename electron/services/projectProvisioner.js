const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { killProcessTree } = require('./processUtils');

const GRANT_TTL_MS = 10 * 60 * 1000;
const PROJECT_TYPES = new Set(['next-ts', 'vite-react-ts', 'mobile-suite']);
const BACKENDS = new Set(['none', 'firebase', 'supabase']);
const SUPABASE_REGIONS = new Set([
  'ap-east-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-south-1', 'ap-southeast-1',
  'ap-southeast-2', 'ca-central-1', 'eu-central-1', 'eu-central-2', 'eu-north-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'sa-east-1', 'us-east-1', 'us-east-2',
  'us-west-1', 'us-west-2',
]);
const FIREBASE_LOCATIONS = new Set([
  'nam5', 'eur3', 'asia-south1', 'asia-southeast1', 'australia-southeast1',
]);
const ALLOWED_COMMANDS = new Set(['npm', 'flutter', 'git', 'gh', 'vercel', 'firebase', 'supabase']);
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const FORBIDDEN_REQUEST_KEYS = new Set(['args', 'argv', 'command', 'commands', 'cliArgs', 'shell']);

class ProvisioningError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProvisioningError';
    this.code = code;
    Object.assign(this, details);
  }
}

function getDefaultProjectsRoot() {
  return path.join(os.homedir(), 'Documents', 'Vibe Projects');
}

function normalizeForComparison(candidate) {
  const resolved = path.resolve(candidate);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertWindows(platform) {
  if (platform !== 'win32') {
    throw new ProvisioningError('UNSUPPORTED_PLATFORM', 'Project provisioning is supported on Windows only.');
  }
}

function assertRealParent(parentPath, fsImpl = fs) {
  if (typeof parentPath !== 'string' || !parentPath.trim() || parentPath.includes('\0')) {
    throw new ProvisioningError('INVALID_LOCATION', 'Choose a valid parent folder.');
  }
  const resolved = path.resolve(parentPath);
  const root = path.parse(resolved).root;
  if (normalizeForComparison(resolved) === normalizeForComparison(root)) {
    throw new ProvisioningError('INVALID_LOCATION', 'A drive root cannot be used as a project location.');
  }

  let stat;
  try {
    stat = fsImpl.lstatSync(resolved);
  } catch {
    throw new ProvisioningError('INVALID_LOCATION', 'The selected parent folder does not exist.');
  }
  if (!stat.isDirectory()) {
    throw new ProvisioningError('INVALID_LOCATION', 'The selected location is not a folder.');
  }
  if (stat.isSymbolicLink()) {
    throw new ProvisioningError('INVALID_LOCATION', 'Junctions and symbolic links cannot be project locations.');
  }

  let realPath;
  try {
    realPath = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(resolved) : fsImpl.realpathSync(resolved);
  } catch {
    throw new ProvisioningError('INVALID_LOCATION', 'The selected parent folder cannot be resolved.');
  }
  if (normalizeForComparison(realPath) !== normalizeForComparison(resolved)) {
    throw new ProvisioningError('INVALID_LOCATION', 'Junctions and symbolic links cannot be project locations.');
  }
  return resolved;
}

function slugifyProjectName(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProvisioningError('INVALID_NAME', 'Enter a project name.');
  }
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (slug.length < 2 || RESERVED_WINDOWS_NAMES.test(slug) || /[. ]$/.test(slug)) {
    throw new ProvisioningError('INVALID_NAME', 'The project name does not produce a safe Windows slug.');
  }
  return slug;
}

function getProvisioningOptions() {
  return {
    projectTypes: [
      { id: 'next-ts', label: 'Next.js + TypeScript' },
      { id: 'vite-react-ts', label: 'Vite + React + TypeScript' },
      { id: 'mobile-suite', label: 'Next.js web + Flutter Android (Kotlin)' },
    ],
    backends: [
      { id: 'none', label: 'No backend' },
      { id: 'firebase', label: 'Firebase (Spark)' },
      { id: 'supabase', label: 'Supabase (Nano)' },
    ],
    supabaseRegions: [...SUPABASE_REGIONS].sort(),
    firebaseLocations: [...FIREBASE_LOCATIONS].sort(),
    defaultProjectsRoot: getDefaultProjectsRoot(),
  };
}

function sanitizeText(value) {
  let text = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  text = text.replace(/(password|secret|service[_ -]?role|access[_ -]?token|refresh[_ -]?token|api[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]');
  text = text.replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted]');
  text = text.replace(/\bsb_(?:secret|service_role)_[A-Za-z0-9_-]+\b/gi, '[redacted]');
  return text.slice(0, 500);
}

function publicError(error) {
  if (error?.code === 'CANCELLED' || error?.name === 'AbortError') {
    return { code: 'CANCELLED', message: 'Provisioning was cancelled.' };
  }
  if (error?.code === 'SUPABASE_QUOTA') {
    return {
      code: 'SUPABASE_QUOTA',
      provider: 'supabase',
      message: 'Supabase could not create another Nano project because this organization has reached its quota. Choose Firebase or upgrade the Supabase organization, then retry.',
      alternatives: ['firebase', 'supabase-upgrade'],
    };
  }
  return {
    code: error?.code || 'PROVISIONING_FAILED',
    message: sanitizeText(error?.publicMessage || error?.message || 'Project provisioning failed.'),
  };
}

function parseJsonOutput(output) {
  const text = String(output || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const closing = text[start] === '[' ? text.lastIndexOf(']') : text.lastIndexOf('}');
  if (closing <= start) return null;
  try {
    return JSON.parse(text.slice(start, closing + 1));
  } catch {
    return null;
  }
}

function findValue(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key) && (typeof child === 'string' || typeof child === 'number')) return String(child);
  }
  for (const child of Object.values(value)) {
    const found = findValue(child, keys);
    if (found) return found;
  }
  return null;
}

function normalizeWindowsCredential(value) {
  const direct = String(value || '').trim();
  if (/^sbp_[A-Za-z0-9_-]+$/.test(direct)) return direct;
  const bytes = [];
  for (let index = 0; index < direct.length; index += 1) {
    const code = direct.charCodeAt(index);
    bytes.push(code & 0xff);
    const high = (code >> 8) & 0xff;
    if (high) bytes.push(high);
  }
  return Buffer.from(bytes).toString('utf8').trim();
}

function readSupabaseAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  try {
    const { Entry, findCredentials } = require('@napi-rs/keyring');
    for (const account of ['supabase', 'access-token']) {
      try {
        const plain = new Entry('Supabase CLI', account).getPassword();
        if (plain) return normalizeWindowsCredential(plain);
      } catch {}
      try {
        const credential = findCredentials('Supabase CLI', `Supabase CLI:${account}`).find((item) => item.account === account);
        if (credential?.password) return normalizeWindowsCredential(credential.password);
      } catch {}
    }
  } catch {}
  try {
    return fs.readFileSync(path.join(os.homedir(), '.supabase', 'access-token'), 'utf8').trim();
  } catch {
    throw new ProvisioningError('SUPABASE_LOGIN_REQUIRED', 'Sign in to Supabase from Settings before creating a project.');
  }
}

async function createSupabaseProjectViaApi(config, fetchImpl = fetch) {
  const accessToken = readSupabaseAccessToken();
  const response = await fetchImpl('https://api.supabase.com/v1/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: config.name,
      organization_id: config.organizationId,
      region: config.region,
      db_pass: config.password,
      desired_instance_size: 'nano',
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = JSON.stringify(payload);
    if (response.status === 402 || response.status === 429 || /quota|project limit|free project|billing/i.test(message)) {
      throw new ProvisioningError('SUPABASE_QUOTA', 'Supabase project quota reached.');
    }
    throw new ProvisioningError('SUPABASE_CREATE_FAILED', 'Supabase could not create the project.', {
      publicMessage: 'Supabase could not create the project. Check the organization, free-tier availability, and account access, then retry.',
    });
  }
  return payload;
}

function normalizeRunnerResult(result) {
  if (result == null) return { success: true, stdout: '', stderr: '', code: 0 };
  return {
    success: result.success !== false && (result.code == null || result.code === 0),
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    code: result.code,
  };
}

function resolveDefaultInvocation(command) {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const npmGlobal = path.join(appData, 'npm', 'node_modules');
  const nodeRoot = path.dirname(process.execPath);
  const candidates = {
    npm: [
      path.join(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ],
    vercel: [path.join(npmGlobal, 'vercel', 'dist', 'index.js')],
    firebase: [path.join(npmGlobal, 'firebase-tools', 'lib', 'bin', 'firebase.js')],
  };
  const script = candidates[command]?.find((candidate) => fs.existsSync(candidate));
  if (script) {
    const systemNode = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe');
    const node = fs.existsSync(systemNode) ? systemNode : process.execPath;
    return { file: node, prefix: [script], env: node === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
  }
  if (command === 'supabase') {
    const bundled = path.join(__dirname, '..', '..', 'node_modules', `@supabase/cli-windows-${process.arch}`, 'bin', 'supabase.exe')
      .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    if (fs.existsSync(bundled)) return { file: bundled, prefix: [], env: {} };
    const native = path.join(npmGlobal, 'supabase', 'node_modules', `@supabase/cli-windows-${process.arch}`, 'bin', 'supabase.exe');
    if (fs.existsSync(native)) return { file: native, prefix: [], env: {} };
  }
  if (command === 'gh') {
    const gh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe');
    if (fs.existsSync(gh)) return { file: gh, prefix: [], env: {} };
  }
  if (command === 'flutter') {
    let flutterRoot = process.env.FLUTTER_ROOT;
    const managedFlutterRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'flutter');
    if (!flutterRoot && fs.existsSync(path.join(managedFlutterRoot, 'bin'))) flutterRoot = managedFlutterRoot;
    if (!flutterRoot) {
      for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
        if (!entry) continue;
        const wrapper = path.join(entry.replace(/^"|"$/g, ''), 'flutter.bat');
        if (fs.existsSync(wrapper)) {
          flutterRoot = path.dirname(path.dirname(wrapper));
          break;
        }
      }
    }
    const dart = flutterRoot && path.join(flutterRoot, 'bin', 'cache', 'dart-sdk', 'bin', 'dart.exe');
    const snapshot = flutterRoot && path.join(flutterRoot, 'bin', 'cache', 'flutter_tools.snapshot');
    if (fs.existsSync(dart) && fs.existsSync(snapshot)) return { file: dart, prefix: [snapshot], env: {} };
  }
  const windowsName = ['npm', 'vercel', 'firebase', 'supabase', 'flutter'].includes(command) ? `${command}.cmd` : command;
  return { file: windowsName, prefix: [], env: {} };
}

function createDefaultRunner() {
  const children = new Set();
  return {
    run(command, args, options = {}) {
      const invocation = resolveDefaultInvocation(command);
      return new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(invocation.file, [...invocation.prefix, ...args], {
          cwd: options.cwd,
          env: { ...process.env, ...invocation.env, ...options.env, FORCE_COLOR: '0', NO_COLOR: '1' },
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        children.add(child);
        let stdout = '';
        let stderr = '';
        const collect = (current, chunk) => (current + chunk.toString('utf8')).slice(-2_000_000);
        const timeout = options.timeout ? setTimeout(() => killProcessTree(child), options.timeout) : null;
        child.stdout?.on('data', (chunk) => { stdout = collect(stdout, chunk); });
        child.stderr?.on('data', (chunk) => { stderr = collect(stderr, chunk); });
        const abort = () => killProcessTree(child);
        options.signal?.addEventListener('abort', abort, { once: true });
        child.once('error', (error) => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          children.delete(child);
          options.signal?.removeEventListener('abort', abort);
          if (options.signal?.aborted) {
            reject(new ProvisioningError('CANCELLED', 'Provisioning was cancelled.'));
          } else {
            reject(error);
          }
        });
        child.once('close', (code) => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          children.delete(child);
          options.signal?.removeEventListener('abort', abort);
          if (options.signal?.aborted) {
            reject(new ProvisioningError('CANCELLED', 'Provisioning was cancelled.'));
          } else {
            resolve({ success: code === 0, code, stdout, stderr });
          }
        });
      });
    },
    terminateAll() {
      for (const child of children) killProcessTree(child);
      const count = children.size;
      children.clear();
      return count;
    },
  };
}

function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new ProvisioningError('INVALID_REQUEST', 'A project provisioning request is required.');
  }
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (Object.hasOwn(request, key)) {
      throw new ProvisioningError('UNSAFE_ARGUMENTS', 'Custom commands and CLI arguments are not accepted.');
    }
  }
  const requestedType = request.type;
  const type = requestedType === 'web'
    ? (request.stack?.web === 'react-vite-typescript' ? 'vite-react-ts' : 'next-ts')
    : requestedType;
  if (!PROJECT_TYPES.has(type)) {
    throw new ProvisioningError('INVALID_PROJECT_TYPE', 'Choose a supported project type.');
  }
  if (Array.isArray(request.backend) || (request.firebase && request.supabase)) {
    throw new ProvisioningError('INVALID_BACKEND', 'Choose Firebase or Supabase, never both.');
  }
  let backend = request.backend || 'none';
  if (!request.backend && request.firebase) backend = 'firebase';
  if (!request.backend && request.supabase) backend = 'supabase';
  if (!BACKENDS.has(backend)) {
    throw new ProvisioningError('INVALID_BACKEND', 'Choose Firebase, Supabase, or no backend.');
  }
  if ((backend === 'firebase' && request.supabase) || (backend === 'supabase' && request.firebase)) {
    throw new ProvisioningError('INVALID_BACKEND', 'Choose Firebase or Supabase, never both.');
  }
  const name = request.name ?? request.projectName;
  const slug = slugifyProjectName(name);
  const normalized = { name: String(name).trim(), slug, type, backend };

  if (backend === 'supabase') {
    const config = typeof request.supabase === 'object' ? request.supabase : request.backendConfig || {};
    const organizationId = config.organizationId ?? request.supabaseOrganizationId;
    const region = config.region ?? request.supabaseRegion;
    const password = config.password ?? config.databasePassword ?? request.supabasePassword;
    if (typeof organizationId !== 'string' || !/^[A-Za-z0-9_-]{3,80}$/.test(organizationId)) {
      throw new ProvisioningError('INVALID_SUPABASE_ORG', 'Choose a valid Supabase organization.');
    }
    if (!SUPABASE_REGIONS.has(region)) {
      throw new ProvisioningError('INVALID_SUPABASE_REGION', 'Choose a supported Supabase region.');
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 128 || /[\r\n\0]/.test(password)) {
      throw new ProvisioningError('INVALID_DATABASE_PASSWORD', 'Use a database password between 12 and 128 characters without control characters.');
    }
    normalized.supabase = { organizationId, region, password };
  }

  if (backend === 'firebase') {
    const config = typeof request.firebase === 'object' ? request.firebase : request.backendConfig || {};
    const location = config.location ?? request.firebaseLocation ?? 'nam5';
    const projectId = config.projectId || slug;
    if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) {
      throw new ProvisioningError('INVALID_FIREBASE_PROJECT', 'Choose a valid globally unique Firebase project ID.');
    }
    if (!FIREBASE_LOCATIONS.has(location)) {
      throw new ProvisioningError('INVALID_FIREBASE_LOCATION', 'Choose a supported Firestore location.');
    }
    normalized.firebase = { location, projectId };
  }
  return normalized;
}

function writeJson(filePath, value, fsImpl) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  fsImpl.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function writeText(filePath, value, fsImpl) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  fsImpl.writeFileSync(filePath, value, { encoding: 'utf8', flag: 'wx' });
}

function clientEnvPath(projectPath, type) {
  return path.join(type === 'mobile-suite' ? path.join(projectPath, 'web') : projectPath, '.env.local');
}

function envPrefix(type) {
  return type === 'vite-react-ts' ? 'VITE_' : 'NEXT_PUBLIC_';
}

function clonePublicState(state) {
  return JSON.parse(JSON.stringify(state));
}

function createProjectProvisioner({
  registerProject = async (projectPath, metadata) => ({ path: projectPath, ...metadata }),
  onProgress = () => {},
  runner = createDefaultRunner(),
  fsImpl = fs,
  platform = process.platform,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  dialog: injectedDialog,
  supabaseProjectCreator = createSupabaseProjectViaApi,
} = {}) {
  const grants = new Map();
  const active = new Map();

  function emit(state, stage, status, message, percent) {
    const event = {
      id: state.id,
      stage,
      status,
      message: sanitizeText(message),
      percent,
    };
    try { onProgress(event); } catch {}
  }

  function createLocationGrant(parentPath) {
    assertWindows(platform);
    const resolved = assertRealParent(parentPath, fsImpl);
    const token = randomUUID();
    const expiresAt = now() + GRANT_TTL_MS;
    grants.set(token, { parentPath: resolved, expiresAt });
    return Object.freeze({ id: token, token, expiresAt, path: resolved });
  }

  async function chooseLocationGrant(browserWindow) {
    assertWindows(platform);
    let dialog = injectedDialog;
    if (!dialog) {
      const electron = require('electron');
      dialog = electron.dialog;
    }
    if (!dialog?.showOpenDialog) {
      throw new ProvisioningError('DIALOG_UNAVAILABLE', 'The folder picker is unavailable.');
    }
    const result = await dialog.showOpenDialog(browserWindow, {
      title: 'Choose a parent folder for the new project',
      buttonLabel: 'Use this folder',
      defaultPath: getDefaultProjectsRoot(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    return createLocationGrant(result.filePaths[0]);
  }

  function consumeGrant(locationGrant) {
    const token = typeof locationGrant === 'string' ? locationGrant : locationGrant?.token || locationGrant?.id;
    if (typeof token !== 'string' || !token) {
      throw new ProvisioningError('INVALID_LOCATION_GRANT', 'Choose a project location again.');
    }
    const grant = grants.get(token);
    grants.delete(token);
    if (!grant || grant.expiresAt <= now()) {
      throw new ProvisioningError('EXPIRED_LOCATION_GRANT', 'The location permission expired. Choose the folder again.');
    }
    return assertRealParent(grant.parentPath, fsImpl);
  }

  async function getRuntimeOptions() {
    const options = getProvisioningOptions();
    try {
      const raw = typeof runner === 'function'
        ? await runner('supabase', ['orgs', 'list', '--output', 'json'], { kind: 'read', timeout: 15_000 })
        : await runner.run('supabase', ['orgs', 'list', '--output', 'json'], { kind: 'read', timeout: 15_000 });
      const result = normalizeRunnerResult(raw);
      const organizations = parseJsonOutput(result.stdout);
      options.supabaseOrganizations = Array.isArray(organizations)
        ? organizations.map((organization) => ({
            id: organization.id || organization.slug,
            name: organization.name || organization.slug || organization.id,
          })).filter((organization) => organization.id)
        : [];
    } catch {
      options.supabaseOrganizations = [];
    }
    try {
      const raw = typeof runner === 'function'
        ? await runner('gh', ['api', 'user', '--jq', '.login'], { kind: 'read', timeout: 15_000 })
        : await runner.run('gh', ['api', 'user', '--jq', '.login'], { kind: 'read', timeout: 15_000 });
      options.githubUser = normalizeRunnerResult(raw).stdout.trim() || null;
    } catch { options.githubUser = null; }
    try {
      const raw = typeof runner === 'function'
        ? await runner('vercel', ['whoami'], { kind: 'read', timeout: 15_000 })
        : await runner.run('vercel', ['whoami'], { kind: 'read', timeout: 15_000 });
      options.vercelUser = normalizeRunnerResult(raw).stdout.trim().split(/\s/)[0] || null;
    } catch { options.vercelUser = null; }
    return options;
  }

  async function invoke(job, command, args, cwd, kind = 'local', extraEnv = {}) {
    if (!ALLOWED_COMMANDS.has(command) || !Array.isArray(args)) {
      throw new ProvisioningError('UNSAFE_COMMAND', 'The provisioning command is not allowed.');
    }
    for (const [argumentIndex, arg] of args.entries()) {
      if (typeof arg !== 'string' || arg.length > 512 || /[\r\n\0]/.test(arg)) {
        throw new ProvisioningError('UNSAFE_ARGUMENTS', `Generated argument ${argumentIndex + 1} for ${command} failed validation.`);
      }
    }
    if (job.controller.signal.aborted) throw new ProvisioningError('CANCELLED', 'Provisioning was cancelled.');
    let raw;
    try {
      raw = typeof runner === 'function'
        ? await runner(command, [...args], { cwd, signal: job.controller.signal, kind, env: extraEnv })
        : await runner.run(command, [...args], { cwd, signal: job.controller.signal, kind, env: extraEnv });
    } catch (error) {
      if (job.controller.signal.aborted) throw new ProvisioningError('CANCELLED', 'Provisioning was cancelled.');
      throw error;
    }
    if (job.controller.signal.aborted) throw new ProvisioningError('CANCELLED', 'Provisioning was cancelled.');
    const result = normalizeRunnerResult(raw);
    if (!result.success) {
      const combined = `${result.stderr}\n${result.stdout}`;
      if (command === 'supabase' && /quota|project limit|maximum number|free project|billing/i.test(combined)) {
        throw new ProvisioningError('SUPABASE_QUOTA', 'Supabase project quota reached.', { commandResult: result });
      }
      throw new ProvisioningError(
        'CLI_FAILED',
        `${command} failed while provisioning the project.`,
        { publicMessage: `${command} could not complete this provisioning step. Check that the CLI is installed and authenticated, then retry.`, commandResult: result },
      );
    }
    return result;
  }

  async function stage(state, name, percent, message, operation) {
    state.steps[name] = { status: 'running' };
    state.currentStage = name;
    emit(state, name, 'running', message, percent);
    try {
      const value = await operation();
      state.steps[name] = { status: 'completed' };
      emit(state, name, 'completed', message, percent);
      return value;
    } catch (error) {
      state.steps[name] = { status: error?.code === 'CANCELLED' ? 'cancelled' : 'failed' };
      emit(state, name, state.steps[name].status, error?.code === 'CANCELLED' ? 'Provisioning cancelled.' : 'This step could not be completed.', percent);
      throw error;
    }
  }

  async function scaffold(job, request, projectPath, state) {
    fsImpl.mkdirSync(projectPath);
    state.localCreated = true;
    if (request.type === 'next-ts') {
      await invoke(job, 'npm', [
        'exec', '--yes', '--package=create-next-app@latest', '--', 'create-next-app', '.',
        '--ts', '--eslint', '--app', '--src-dir', '--use-npm', '--import-alias=@/*', '--yes', '--disable-git',
      ], projectPath);
      return;
    }
    if (request.type === 'vite-react-ts') {
      await invoke(job, 'npm', ['create', 'vite@latest', '.', '--', '--template', 'react-ts'], projectPath);
      await invoke(job, 'npm', ['install'], projectPath);
      return;
    }
    const webPath = path.join(projectPath, 'web');
    const mobilePath = path.join(projectPath, 'mobile');
    fsImpl.mkdirSync(webPath);
    fsImpl.mkdirSync(mobilePath);
    await invoke(job, 'npm', [
      'exec', '--yes', '--package=create-next-app@latest', '--', 'create-next-app', '.',
      '--ts', '--eslint', '--app', '--src-dir', '--use-npm', '--import-alias=@/*', '--yes', '--disable-git',
    ], webPath);
    const flutterName = request.slug.replace(/-/g, '_');
    await invoke(job, 'flutter', [
      'create', '--platforms=android', '--android-language=kotlin', '--org', 'com.vibecoder', '--project-name', flutterName, '.',
    ], mobilePath);
  }

  async function preflight(job, request, projectPath) {
    await invoke(job, 'gh', ['auth', 'status', '--active'], projectPath, 'remote');
    const githubUserResult = await invoke(job, 'gh', ['api', 'user', '--jq', '.login'], projectPath, 'remote');
    const githubUser = githubUserResult.stdout.trim().split(/\s/)[0];
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(githubUser)) {
      throw new ProvisioningError('GITHUB_ACCOUNT_INVALID', 'GitHub CLI did not return a valid active account.');
    }
    const vercelResult = await invoke(job, 'vercel', ['whoami'], projectPath, 'remote');
    const vercelUser = vercelResult.stdout.trim().split(/\s/)[0];
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/.test(vercelUser)) {
      throw new ProvisioningError('VERCEL_ACCOUNT_INVALID', 'Vercel CLI did not return a valid personal account.');
    }
    const gitName = await invoke(job, 'git', ['config', '--get', 'user.name'], projectPath);
    const gitEmail = await invoke(job, 'git', ['config', '--get', 'user.email'], projectPath);
    if (!gitName.stdout.trim() || !gitEmail.stdout.trim()) {
      throw new ProvisioningError('GIT_IDENTITY_MISSING', 'Configure your Git name and email before creating a project.');
    }
    const accounts = { githubUser, vercelUser };

    if (request.backend === 'firebase') {
      await invoke(job, 'firebase', ['login:list', '--json'], projectPath, 'remote');
    }
    if (request.backend === 'supabase') {
      const organizationsResult = await invoke(job, 'supabase', ['orgs', 'list', '--output', 'json'], projectPath, 'remote');
      const organizations = parseJsonOutput(organizationsResult.stdout);
      const serialized = organizations ? JSON.stringify(organizations) : '';
      if (!serialized.includes(`\"${request.supabase.organizationId}\"`)) {
        throw new ProvisioningError('SUPABASE_ORG_UNAVAILABLE', 'The selected Supabase organization is not available to the active account.');
      }
    }
    return accounts;
  }

  async function configureFirebase(job, request, state) {
    const projectId = request.firebase.projectId;
    state.remoteCreationAttempted = true;
    await invoke(job, 'firebase', ['projects:create', projectId, '--display-name', request.slug, '--json', '--non-interactive'], state.projectPath, 'remote');
    state.remotes.firebase = { projectId, plan: 'spark', created: true };

    const webAppResult = await invoke(job, 'firebase', ['apps:create', 'WEB', `${request.slug}-web`, '--project', projectId, '--json', '--non-interactive'], state.projectPath, 'remote');
    const webApp = parseJsonOutput(webAppResult.stdout);
    const webAppId = findValue(webApp, ['appId', 'app_id']);
    if (!webAppId) throw new ProvisioningError('FIREBASE_RESPONSE_INVALID', 'Firebase did not return the web app identifier.');
    const sdkResult = await invoke(job, 'firebase', ['apps:sdkconfig', 'WEB', webAppId, '--project', projectId, '--json', '--non-interactive'], state.projectPath, 'remote');
    const sdkConfig = parseJsonOutput(sdkResult.stdout);
    const apiKey = findValue(sdkConfig, ['apiKey', 'api_key']);
    const authDomain = findValue(sdkConfig, ['authDomain', 'auth_domain']) || `${projectId}.firebaseapp.com`;
    const messagingSenderId = findValue(sdkConfig, ['messagingSenderId', 'messaging_sender_id']) || '';
    if (!apiKey) throw new ProvisioningError('FIREBASE_RESPONSE_INVALID', 'Firebase did not return the client SDK configuration.');

    await invoke(job, 'firebase', [
      'firestore:databases:create', '(default)', '--location', request.firebase.location,
      '--project', projectId, '--non-interactive',
    ], state.projectPath, 'remote');

    const firebaseJson = path.join(state.projectPath, 'firebase.json');
    const rulesPath = path.join(state.projectPath, 'firestore.rules');
    const indexesPath = path.join(state.projectPath, 'firestore.indexes.json');
    writeJson(firebaseJson, {
      auth: { providers: { emailPassword: true } },
      firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
    }, fsImpl);
    writeText(rulesPath, "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if request.auth != null;\n    }\n  }\n}\n", fsImpl);
    writeJson(indexesPath, { indexes: [], fieldOverrides: [] }, fsImpl);
    writeJson(path.join(state.projectPath, '.firebaserc'), { projects: { default: projectId } }, fsImpl);
    await invoke(job, 'firebase', ['deploy', '--only', 'auth,firestore', '--project', projectId, '--force', '--non-interactive'], state.projectPath, 'remote');

    const prefix = envPrefix(request.type);
    const env = [
      `${prefix}FIREBASE_API_KEY=${apiKey}`,
      `${prefix}FIREBASE_AUTH_DOMAIN=${authDomain}`,
      `${prefix}FIREBASE_PROJECT_ID=${projectId}`,
      `${prefix}FIREBASE_MESSAGING_SENDER_ID=${messagingSenderId}`,
      `${prefix}FIREBASE_APP_ID=${webAppId}`,
      '',
    ].join('\n');
    writeText(clientEnvPath(state.projectPath, request.type), env, fsImpl);
    state.publicEnv = {
      [`${prefix}FIREBASE_API_KEY`]: apiKey,
      [`${prefix}FIREBASE_AUTH_DOMAIN`]: authDomain,
      [`${prefix}FIREBASE_PROJECT_ID`]: projectId,
      [`${prefix}FIREBASE_MESSAGING_SENDER_ID`]: messagingSenderId,
      [`${prefix}FIREBASE_APP_ID`]: webAppId,
    };

    state.remotes.firebase.webAppCreated = true;
    state.remotes.firebase.authConfigured = true;
    state.remotes.firebase.firestoreConfigured = true;
    if (request.type === 'mobile-suite') {
      const packageName = `com.vibecoder.${request.slug.replace(/-/g, '_').slice(0, 40)}`;
      const androidResult = await invoke(job, 'firebase', [
        'apps:create', 'ANDROID', `${request.slug}-android`, '--package-name', packageName,
        '--project', projectId, '--json', '--non-interactive',
      ], state.projectPath, 'remote');
      const androidAppId = findValue(parseJsonOutput(androidResult.stdout), ['appId', 'app_id']);
      if (!androidAppId) throw new ProvisioningError('FIREBASE_RESPONSE_INVALID', 'Firebase did not return the Android app identifier.');
      const androidConfig = await invoke(job, 'firebase', [
        'apps:sdkconfig', 'ANDROID', androidAppId, '--project', projectId, '--non-interactive',
      ], state.projectPath, 'remote');
      const androidPayload = parseJsonOutput(androidConfig.stdout);
      const fileContents = findValue(androidPayload, ['fileContents', 'file_contents']);
      const googleServices = fileContents ? parseJsonOutput(fileContents) : androidPayload;
      if (!googleServices) throw new ProvisioningError('FIREBASE_RESPONSE_INVALID', 'Firebase did not return google-services.json.');
      writeJson(path.join(state.projectPath, 'mobile', 'android', 'app', 'google-services.json'), googleServices, fsImpl);
      state.remotes.firebase.androidAppCreated = true;
    }
  }

  function findSupabaseClientKey(payload) {
    const queue = [payload];
    let anon = null;
    while (queue.length) {
      const value = queue.shift();
      if (Array.isArray(value)) {
        queue.push(...value);
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      const name = String(value.name || value.type || '').toLowerCase();
      const key = value.api_key || value.apiKey || value.key || value.value;
      if (typeof key === 'string' && (name.includes('publishable') || name === 'anon')) {
        if (name.includes('publishable')) return { key, type: 'publishable' };
        anon = { key, type: 'anon' };
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') queue.push(child);
      }
    }
    return anon;
  }

  async function configureSupabase(job, request, state) {
    state.remoteCreationAttempted = true;
    const created = await supabaseProjectCreator({
      name: request.slug,
      organizationId: request.supabase.organizationId,
      region: request.supabase.region,
      password: request.supabase.password,
    });
    const projectRef = findValue(created, ['ref', 'id', 'project_ref']);
    if (!projectRef || !/^[a-z0-9]{8,40}$/i.test(projectRef)) {
      throw new ProvisioningError('SUPABASE_RESPONSE_INVALID', 'Supabase did not return a valid project reference.');
    }
    const projectUrl = findValue(created, ['url', 'api_url']) || `https://${projectRef}.supabase.co`;
    state.remotes.supabase = { projectRef, projectUrl, size: 'nano', created: true };
    const keysResult = await invoke(job, 'supabase', [
      'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json',
    ], state.projectPath, 'remote');
    const clientKey = findSupabaseClientKey(parseJsonOutput(keysResult.stdout));
    if (!clientKey) {
      throw new ProvisioningError('SUPABASE_CLIENT_KEY_MISSING', 'Supabase did not return a publishable or anon client key.');
    }

    const prefix = envPrefix(request.type);
    const keyName = clientKey.type === 'publishable' ? 'SUPABASE_PUBLISHABLE_KEY' : 'SUPABASE_ANON_KEY';
    writeText(clientEnvPath(state.projectPath, request.type), [
      `${prefix}SUPABASE_URL=${projectUrl}`,
      `${prefix}${keyName}=${clientKey.key}`,
      '',
    ].join('\n'), fsImpl);
    state.publicEnv = {
      [`${prefix}SUPABASE_URL`]: projectUrl,
      [`${prefix}${keyName}`]: clientKey.key,
    };
    await invoke(job, 'supabase', ['init'], state.projectPath, 'remote');
    await invoke(job, 'supabase', [
      'link', '--project-ref', projectRef, '--yes',
    ], state.projectPath, 'remote', { SUPABASE_DB_PASSWORD: request.supabase.password });
    state.remotes.supabase.clientKeyType = clientKey.type;
    state.remotes.supabase.linked = true;
  }

  async function installBackendClients(job, request, state) {
    if (request.backend === 'none') return;
    const webPath = request.type === 'mobile-suite' ? path.join(state.projectPath, 'web') : state.projectPath;
    const prefix = envPrefix(request.type);
    const webPackage = request.backend === 'firebase' ? 'firebase' : '@supabase/supabase-js';
    await invoke(job, 'npm', ['install', webPackage], webPath);
    const sourceRoot = path.join(webPath, 'src', 'lib');
    fsImpl.mkdirSync(sourceRoot, { recursive: true });
    if (request.backend === 'firebase') {
      const envSource = request.type === 'vite-react-ts' ? 'import.meta.env' : 'process.env';
      writeText(path.join(sourceRoot, 'firebase.ts'), `import { getApps, initializeApp } from 'firebase/app';\nimport { getAuth } from 'firebase/auth';\nimport { getFirestore } from 'firebase/firestore';\n\nconst config = {\n  apiKey: ${envSource}.${prefix}FIREBASE_API_KEY,\n  authDomain: ${envSource}.${prefix}FIREBASE_AUTH_DOMAIN,\n  projectId: ${envSource}.${prefix}FIREBASE_PROJECT_ID,\n};\n\nexport const firebaseApp = getApps()[0] ?? initializeApp(config);\nexport const firebaseAuth = getAuth(firebaseApp);\nexport const firestore = getFirestore(firebaseApp);\n`, fsImpl);
    } else {
      const keyName = Object.keys(state.publicEnv).find((key) => key.endsWith('SUPABASE_PUBLISHABLE_KEY') || key.endsWith('SUPABASE_ANON_KEY'));
      const keyExpression = keyName?.startsWith('VITE_') ? `import.meta.env.${keyName}` : `process.env.${keyName}`;
      const urlExpression = prefix === 'VITE_' ? 'import.meta.env.VITE_SUPABASE_URL' : 'process.env.NEXT_PUBLIC_SUPABASE_URL';
      writeText(path.join(sourceRoot, 'supabase.ts'), `import { createClient } from '@supabase/supabase-js';\n\nexport const supabase = createClient(${urlExpression}!, ${keyExpression}!);\n`, fsImpl);
    }

    if (request.type !== 'mobile-suite') return;
    const mobilePath = path.join(state.projectPath, 'mobile');
    if (request.backend === 'firebase') {
      await invoke(job, 'flutter', ['pub', 'add', 'firebase_core', 'firebase_auth', 'cloud_firestore'], mobilePath);
      const settingsGradle = path.join(mobilePath, 'android', 'settings.gradle.kts');
      const appGradle = path.join(mobilePath, 'android', 'app', 'build.gradle.kts');
      if (fsImpl.existsSync(settingsGradle) && fsImpl.existsSync(appGradle)) {
        const settings = fsImpl.readFileSync(settingsGradle, 'utf8');
        const appBuild = fsImpl.readFileSync(appGradle, 'utf8');
        if (!settings.includes('com.google.gms.google-services')) {
          fsImpl.writeFileSync(settingsGradle, settings.replace(/(plugins\s*\{)/, '$1\n    id("com.google.gms.google-services") version "4.4.4" apply false'));
        }
        if (!appBuild.includes('com.google.gms.google-services')) {
          fsImpl.writeFileSync(appGradle, appBuild.replace(/(plugins\s*\{)/, '$1\n    id("com.google.gms.google-services")'));
        }
      }
      writeText(path.join(mobilePath, 'lib', 'backend_config.dart'), "import 'package:firebase_core/firebase_core.dart';\n\nFuture<FirebaseApp> initializeBackend() => Firebase.initializeApp();\n", fsImpl);
    } else {
      await invoke(job, 'flutter', ['pub', 'add', 'supabase_flutter'], mobilePath);
      const url = state.remotes.supabase.projectUrl;
      const key = Object.values(state.publicEnv).find((value) => value !== url);
      writeText(path.join(mobilePath, 'lib', 'backend_config.dart'), `import 'package:supabase_flutter/supabase_flutter.dart';\n\nconst supabaseUrl = '${url}';\nconst supabasePublishableKey = '${key}';\n\nFuture<void> initializeBackend() => Supabase.initialize(url: supabaseUrl, anonKey: supabasePublishableKey);\n`, fsImpl);
    }
  }

  async function provisionProject(rawRequest, locationGrant) {
    assertWindows(platform);
    const request = validateRequest(rawRequest);
    const parentPath = consumeGrant(locationGrant);
    const projectPath = path.join(parentPath, request.slug);
    if (normalizeForComparison(path.dirname(projectPath)) !== normalizeForComparison(parentPath)) {
      throw new ProvisioningError('INVALID_PROJECT_PATH', 'The generated project path is outside the approved location.');
    }
    if (fsImpl.existsSync(projectPath)) {
      throw new ProvisioningError('PROJECT_EXISTS', 'A file or folder already exists at the project path.');
    }

    const id = randomUUID();
    const controller = new AbortController();
    const job = { id, controller };
    const state = {
      id,
      status: 'running',
      retryable: false,
      name: request.name,
      slug: request.slug,
      type: request.type,
      backend: request.backend,
      projectPath,
      currentStage: null,
      steps: {},
      remotes: {},
      remoteCreationAttempted: false,
      localCreated: false,
      localRolledBack: false,
    };
    active.set(id, job);

    try {
      await stage(state, 'scaffold', 8, 'Creating the local project structure.', () => scaffold(job, request, projectPath, state));
      await stage(state, 'git-init', 18, 'Initializing the local Git repository.', async () => {
        await invoke(job, 'git', ['init', '--initial-branch=main'], projectPath);
      });
      const accounts = await stage(state, 'preflight', 28, 'Checking active provider accounts.', () => preflight(job, request, projectPath));
      if (request.backend === 'firebase') {
        await stage(state, 'backend', 43, 'Creating Firebase Spark resources with Auth and Firestore.', () => configureFirebase(job, request, state));
      } else if (request.backend === 'supabase') {
        await stage(state, 'backend', 43, 'Creating the Supabase Nano project and public client configuration.', () => configureSupabase(job, request, state));
      } else {
        state.steps.backend = { status: 'skipped' };
      }
      await stage(state, 'clients', 56, 'Installing and configuring the selected backend SDKs.', () => installBackendClients(job, request, state));
      await stage(state, 'git-commit', 65, 'Creating the initial source commit.', async () => {
        await invoke(job, 'git', ['add', '--all'], projectPath);
        await invoke(job, 'git', ['commit', '-m', 'Initial project scaffold'], projectPath);
      });
      await stage(state, 'github', 74, 'Creating and pushing the private GitHub repository.', async () => {
        state.remoteCreationAttempted = true;
        await invoke(job, 'gh', [
          'repo', 'create', request.slug, '--private', '--source', '.', '--remote', 'origin',
        ], projectPath, 'remote');
        state.remotes.github = {
          owner: accounts.githubUser,
          repository: request.slug,
          private: true,
          created: true,
          url: `https://github.com/${accounts.githubUser}/${request.slug}`,
        };
        await invoke(job, 'git', ['push', '--set-upstream', 'origin', 'main'], projectPath, 'remote');
        state.remotes.github.pushed = true;
      });
      await stage(state, 'vercel', 88, 'Creating Vercel and connecting the GitHub repository.', async () => {
        const cwd = request.type === 'mobile-suite' ? path.join(projectPath, 'web') : projectPath;
        await invoke(job, 'vercel', [
          'project', 'add', request.slug, '--scope', accounts.vercelUser, '--non-interactive',
        ], cwd, 'remote');
        state.remotes.vercel = { account: accounts.vercelUser, project: request.slug, created: true, linked: false, cwd };
        await invoke(job, 'vercel', [
          'link', '--yes', '--project', request.slug, '--scope', accounts.vercelUser, '--non-interactive',
        ], cwd, 'remote');
        state.remotes.vercel.linked = true;
        await invoke(job, 'vercel', [
          'git', 'connect', `${state.remotes.github.url}.git`, '--yes', '--scope', accounts.vercelUser, '--non-interactive',
        ], cwd, 'remote');
        for (const [key, value] of Object.entries(state.publicEnv || {})) {
          for (const environment of ['production', 'preview', 'development']) {
            await invoke(job, 'vercel', ['env', 'add', key, environment, '--value', value, '--yes', '--scope', accounts.vercelUser], cwd, 'remote');
          }
        }
        const deploymentResult = await invoke(job, 'vercel', ['deploy', '--prod', '--yes', '--scope', accounts.vercelUser, '--non-interactive'], cwd, 'remote');
        const deploymentUrl = deploymentResult.stdout.match(/https:\/\/[^\s]+/)?.[0];
        if (!deploymentUrl) throw new ProvisioningError('VERCEL_DEPLOYMENT_INVALID', 'Vercel did not return the production deployment URL.');
        state.remotes.vercel.url = deploymentUrl;
        state.remotes.vercel.deployed = true;
      });
      await stage(state, 'register', 96, 'Registering the project in Vibe IDE Coder.', async () => {
        state.project = await registerProject(projectPath, {
          name: request.name,
          slug: request.slug,
          type: request.type,
          backend: request.backend,
        });
      });
      state.status = 'completed';
      state.currentStage = null;
      state.repository = state.remotes.github;
      state.deployment = state.remotes.vercel;
      emit(state, 'complete', 'completed', 'Project provisioned successfully.', 100);
      return clonePublicState(state);
    } catch (error) {
      state.status = error?.code === 'CANCELLED' ? 'cancelled' : 'failed';
      state.retryable = true;
      state.error = publicError(error);
      state.message = state.error.message;
      state.repository = state.remotes.github;
      state.deployment = state.remotes.vercel;
      if (!state.remoteCreationAttempted && state.localCreated && fsImpl.existsSync(projectPath)) {
        try {
          fsImpl.rmSync(projectPath, { recursive: true, force: true });
          state.localRolledBack = true;
        } catch {}
      } else if (fsImpl.existsSync(projectPath) && !state.project) {
        try {
          state.project = await registerProject(projectPath, {
            name: request.name,
            slug: request.slug,
            type: request.type,
            backend: request.backend,
            provisioningStatus: 'partial',
          });
        } catch {}
      }
      return clonePublicState(state);
    } finally {
      active.delete(id);
    }
  }

  function cancelProvisioning() {
    let cancelled = 0;
    for (const job of active.values()) {
      if (!job.controller.signal.aborted) {
        job.controller.abort();
        cancelled += 1;
      }
    }
    return { success: true, cancelled };
  }

  function terminateAllProvisions() {
    const result = cancelProvisioning();
    if (typeof runner?.terminateAll === 'function') runner.terminateAll();
    return result;
  }

  return {
    getDefaultProjectsRoot,
    createLocationGrant,
    chooseLocationGrant,
    getProvisioningOptions,
    getRuntimeOptions,
    provisionProject,
    cancelProvisioning,
    terminateAllProvisions,
  };
}

const defaultProvisioner = createProjectProvisioner();
const configuredIpc = new WeakMap();

function createLocationGrant(parentPath) {
  return defaultProvisioner.createLocationGrant(parentPath);
}

function chooseLocationGrant(browserWindow) {
  return defaultProvisioner.chooseLocationGrant(browserWindow);
}

function provisionProject(request, locationGrant) {
  return defaultProvisioner.provisionProject(request, locationGrant);
}

function cancelProvisioning() {
  return defaultProvisioner.cancelProvisioning();
}

function terminateAllProvisions() {
  return defaultProvisioner.terminateAllProvisions();
}

function setupProjectProvisionerHandlers(ipcMain, getMainWindow, registerProject) {
  if (!ipcMain?.handle) throw new TypeError('ipcMain.handle is required.');
  if (configuredIpc.has(ipcMain)) return configuredIpc.get(ipcMain);
  const instance = createProjectProvisioner({
    registerProject,
    onProgress(event) {
      const mainWindow = getMainWindow?.();
      if (mainWindow && !mainWindow.isDestroyed?.()) {
        mainWindow.webContents.send('projects:provisioning-progress', event);
      }
    },
  });
  ipcMain.handle('projects:get-provisioning-options', () => instance.getRuntimeOptions());
  ipcMain.handle('projects:get-default-root', () => {
    const root = instance.getDefaultProjectsRoot();
    fs.mkdirSync(root, { recursive: true });
    return instance.createLocationGrant(root);
  });
  ipcMain.handle('projects:choose-location', () => instance.chooseLocationGrant(getMainWindow?.()));
  ipcMain.handle('projects:provision', (_event, request, grant) => instance.provisionProject(request, grant));
  ipcMain.handle('projects:cancel-provisioning', () => instance.cancelProvisioning());
  configuredIpc.set(ipcMain, instance);
  return instance;
}

module.exports = {
  createProjectProvisioner,
  getDefaultProjectsRoot,
  createLocationGrant,
  chooseLocationGrant,
  getProvisioningOptions,
  provisionProject,
  cancelProvisioning,
  terminateAllProvisions,
  setupProjectProvisionerHandlers,
  createSupabaseProjectViaApi,
};
