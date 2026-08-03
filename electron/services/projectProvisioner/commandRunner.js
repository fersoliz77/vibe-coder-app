const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { killProcessTree } = require('../processUtils');
const { buildSubprocessEnv } = require('../subprocessEnv');
const { ProvisioningError } = require('./core');

const ALLOWED_COMMANDS = new Set(['npm', 'flutter', 'git', 'gh', 'vercel', 'firebase', 'supabase']);

function normalizeRunnerResult(result) {
  if (result == null) return { success: true, stdout: '', stderr: '', code: 0 };
  return {
    success: result.success !== false && (result.code == null || result.code === 0),
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    code: result.code,
  };
}

function isolatedProfilePrefix(command) {
  if (command === 'vercel' && process.env.VIBE_VERCEL_CONFIG_DIR) {
    const configured = process.env.VIBE_VERCEL_CONFIG_DIR;
    if (!path.isAbsolute(configured) || !fs.existsSync(configured) || !fs.statSync(configured).isDirectory()) {
      throw new ProvisioningError('CLI_PROFILE_INVALID', 'The isolated Vercel CLI profile directory is invalid.');
    }
    return ['--global-config', path.resolve(configured)];
  }
  return [];
}

function withIsolatedProfile(command, invocation) {
  return { ...invocation, prefix: [...invocation.prefix, ...isolatedProfilePrefix(command)] };
}

function findExecutableOnPath(fileName) {
  for (const entry of String(process.env.PATH || '').split(path.delimiter)) {
    const directory = entry.replace(/^"|"$/g, '');
    if (!directory) continue;
    const candidate = path.join(directory, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function unavailableCommand(command) {
  throw new ProvisioningError(
    'CLI_UNAVAILABLE',
    `${command} is not available as a trusted native executable or JavaScript entry point.`,
    { publicMessage: `${command} is installed in an unsupported location or is incomplete. Repair it from Setup Center, then retry.` },
  );
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
  let script = candidates[command]?.find((candidate) => fs.existsSync(candidate));
  let scriptNode = null;
  if (command === 'npm' && !script) {
    const node = findExecutableOnPath('node.exe');
    const adjacent = node && path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (adjacent && fs.existsSync(adjacent)) {
      script = adjacent;
      scriptNode = node;
    }
  }
  if (script) {
    const systemNode = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe');
    const node = scriptNode || (fs.existsSync(systemNode) ? systemNode : process.execPath);
    return withIsolatedProfile(command, { file: node, prefix: [script], env: node === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {} });
  }
  if (command === 'supabase') {
    const bundled = path.join(__dirname, '..', '..', '..', 'node_modules', `@supabase/cli-windows-${process.arch}`, 'bin', 'supabase.exe')
      .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
    if (fs.existsSync(bundled)) return withIsolatedProfile(command, { file: bundled, prefix: [], env: {} });
    const native = path.join(npmGlobal, 'supabase', 'node_modules', `@supabase/cli-windows-${process.arch}`, 'bin', 'supabase.exe');
    if (fs.existsSync(native)) return withIsolatedProfile(command, { file: native, prefix: [], env: {} });
  }
  if (command === 'gh') {
    const gh = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe');
    if (fs.existsSync(gh)) return withIsolatedProfile(command, { file: gh, prefix: [], env: {} });
    const discovered = findExecutableOnPath('gh.exe');
    if (discovered) return { file: discovered, prefix: [], env: {} };
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
    if (fs.existsSync(dart) && fs.existsSync(snapshot)) return withIsolatedProfile(command, { file: dart, prefix: [snapshot], env: {} });
  }
  if (command === 'git') {
    const git = findExecutableOnPath('git.exe');
    return { file: git || 'git.exe', prefix: [], env: {} };
  }
  unavailableCommand(command);
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
          env: buildSubprocessEnv({
            provider: command === 'gh' ? 'github' : command,
            extra: { ...invocation.env, ...options.env, FORCE_COLOR: '0', NO_COLOR: '1' },
          }),
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
          if (options.signal?.aborted) reject(new ProvisioningError('CANCELLED', 'Provisioning was cancelled.'));
          else reject(error);
        });
        child.once('close', (code) => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          children.delete(child);
          options.signal?.removeEventListener('abort', abort);
          if (options.signal?.aborted) reject(new ProvisioningError('CANCELLED', 'Provisioning was cancelled.'));
          else resolve({ success: code === 0, code, stdout, stderr });
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

function createCommandInvoker(runner) {
  return async function invoke(job, command, args, cwd, kind = 'local', extraEnv = {}) {
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
      throw new ProvisioningError('CLI_FAILED', `${command} failed while provisioning the project.`, {
        publicMessage: `${command} could not complete this provisioning step. Check that the CLI is installed and authenticated, then retry.`,
        commandResult: result,
      });
    }
    return result;
  };
}

async function runReadCommand(runner, command, args) {
  const raw = typeof runner === 'function'
    ? await runner(command, args, { kind: 'read', timeout: 15_000 })
    : await runner.run(command, args, { kind: 'read', timeout: 15_000 });
  return normalizeRunnerResult(raw);
}

module.exports = {
  createCommandInvoker,
  createDefaultRunner,
  normalizeRunnerResult,
  resolveDefaultInvocation,
  runReadCommand,
};
