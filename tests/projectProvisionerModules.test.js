const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCommandInvoker, normalizeRunnerResult, resolveDefaultInvocation } = require('../electron/services/projectProvisioner/commandRunner');
const { configureFirebase } = require('../electron/services/projectProvisioner/firebaseAdapter');
const { getRuntimeOptions, preflightProviders } = require('../electron/services/projectProvisioner/remoteAdapters');
const { scaffoldProject } = require('../electron/services/projectProvisioner/scaffold');
const { findSupabaseClientKey } = require('../electron/services/projectProvisioner/supabaseAdapter');
const { validateRequest } = require('../electron/services/projectProvisioner/validation');

test('validation normalizes legacy requests and rejects command injection fields', () => {
  assert.deepEqual(validateRequest({
    projectName: 'Legacy Web',
    type: 'web',
    stack: { web: 'react-vite-typescript' },
  }), {
    name: 'Legacy Web',
    slug: 'legacy-web',
    type: 'vite-react-ts',
    stack: { web: 'react-vite-typescript' },
    backend: 'none',
    repository: { visibility: 'private' },
    deployment: { provider: 'vercel' },
  });
  assert.throws(
    () => validateRequest({ name: 'Unsafe Demo', type: 'next-ts', shell: 'calc.exe' }),
    (error) => error.code === 'UNSAFE_ARGUMENTS',
  );
});

test('Firebase project IDs require 6-30 characters and an alphanumeric ending', () => {
  const request = (projectId) => ({
    name: 'Firebase Demo', type: 'next-ts', backend: 'firebase', firebase: { projectId, location: 'nam5' },
  });
  assert.throws(() => validateRequest(request('abcde')), (error) => error.code === 'INVALID_FIREBASE_PROJECT');
  assert.throws(() => validateRequest(request('abcde-')), (error) => error.code === 'INVALID_FIREBASE_PROJECT');
  assert.equal(validateRequest(request('abcdef')).firebase.projectId, 'abcdef');
  assert.equal(validateRequest(request(`a${'b'.repeat(29)}`)).firebase.projectId.length, 30);
});

test('command invoker validates generated arguments and preserves cancellation and quota errors', async () => {
  const controller = new AbortController();
  const job = { controller };
  let called = 0;
  const invoke = createCommandInvoker(async () => { called += 1; return { success: true }; });
  await assert.rejects(invoke(job, 'npm', ['bad\nargument'], 'C:\\project'), (error) => error.code === 'UNSAFE_ARGUMENTS');
  await assert.rejects(invoke(job, 'powershell', [], 'C:\\project'), (error) => error.code === 'UNSAFE_COMMAND');
  assert.equal(called, 0);

  controller.abort();
  await assert.rejects(invoke(job, 'npm', ['install'], 'C:\\project'), (error) => error.code === 'CANCELLED');
  const quotaInvoke = createCommandInvoker(async () => ({ success: false, stderr: 'Free project quota reached' }));
  await assert.rejects(
    quotaInvoke({ controller: new AbortController() }, 'supabase', ['projects', 'list'], 'C:\\project'),
    (error) => error.code === 'SUPABASE_QUOTA',
  );
  assert.deepEqual(normalizeRunnerResult(), { success: true, stdout: '', stderr: '', code: 0 });
});

test('Firebase adapter writes the existing authenticated-only Firestore rules unchanged', async () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-firebase-adapter-'));
  const state = { projectPath, remotes: {}, remoteCreationAttempted: false };
  const request = {
    slug: 'firebase-demo',
    type: 'next-ts',
    firebase: { projectId: 'firebase-demo', location: 'nam5' },
  };
  const invoke = async (_job, command, args) => {
    if (command === 'firebase' && args[0] === 'apps:create') return { stdout: '{"appId":"web-id"}' };
    if (command === 'firebase' && args[0] === 'apps:sdkconfig') {
      return { stdout: '{"apiKey":"public-key","authDomain":"firebase-demo.firebaseapp.com","messagingSenderId":"123"}' };
    }
    return { stdout: '' };
  };
  try {
    await configureFirebase({ job: {}, request, state, invoke, fsImpl: fs });
    assert.equal(
      fs.readFileSync(path.join(projectPath, 'firestore.rules'), 'utf8'),
      "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if request.auth != null;\n    }\n  }\n}\n",
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(projectPath, 'firebase.json'), 'utf8')), {
      firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
    });
    assert.equal(state.remotes.firebase.authConfigured, false);
    assert.equal(state.remotes.firebase.manualSteps[0].code, 'ENABLE_EMAIL_PASSWORD_AUTH');
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test('Supabase adapter prefers publishable keys and never selects service-role keys', () => {
  const selected = findSupabaseClientKey([
    { name: 'anon', api_key: 'anon-key' },
    { name: 'service_role', api_key: 'service-secret' },
    { name: 'publishable', api_key: 'publishable-key' },
  ]);
  assert.deepEqual(selected, { key: 'publishable-key', type: 'publishable' });
  assert.equal(findSupabaseClientKey([{ name: 'service_role', api_key: 'service-secret' }]), null);
});

test('scaffold module generates fixed Vite commands without accepting request arguments', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-scaffold-module-'));
  const projectPath = path.join(parent, 'safe-demo');
  const calls = [];
  try {
    await scaffoldProject({
      job: {},
      request: { type: 'vite-react-ts', slug: 'safe-demo', args: ['malicious'] },
      projectPath,
      state: {},
      invoke: async (_job, command, args, cwd) => calls.push({ command, args, cwd }),
      fsImpl: fs,
    });
    assert.deepEqual(calls, [
      { command: 'npm', args: ['create', 'vite@latest', '.', '--', '--template', 'react-ts'], cwd: projectPath },
      { command: 'npm', args: ['install'], cwd: projectPath },
    ]);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('remote adapters expose sanitized runtime account metadata from read-only commands', async () => {
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'supabase') return { stdout: '[{"id":"org_123","name":"Example"}]' };
    if (command === 'firebase') return { stdout: 'Logged in as firebase@example.com' };
    if (command === 'gh') return { stdout: 'github-user\n' };
    return { stdout: 'vercel-user extra-output\n' };
  };
  const options = await getRuntimeOptions(runner);
  assert.deepEqual(options.supabaseOrganizations, [{ id: 'org_123', name: 'Example' }]);
  assert.equal(options.supabaseUser, 'Example');
  assert.equal(options.firebaseUser, 'firebase@example.com');
  assert.equal(options.githubUser, 'github-user');
  assert.equal(options.vercelUser, 'vercel-user');
  assert.equal(calls.every(({ options: value }) => value.kind === 'read' && value.timeout === 15_000), true);
});

test('Supabase preflight matches organization id or slug exactly', async () => {
  const base = async (_job, command, args) => {
    if (command === 'gh' && args[0] === 'api') return { stdout: 'github-user' };
    if (command === 'vercel') return { stdout: 'vercel-user' };
    if (command === 'git') return { stdout: 'Developer' };
    if (command === 'supabase') return { stdout: '[{"id":"real-org","name":"requested-org"}]' };
    return { stdout: '' };
  };
  await assert.rejects(preflightProviders({
    job: {}, projectPath: 'C:\\project', invoke: base,
    request: { backend: 'supabase', supabase: { organizationId: 'requested-org' } },
  }), (error) => error.code === 'SUPABASE_ORG_UNAVAILABLE');

  const exact = async (...args) => {
    if (args[1] === 'supabase') return { stdout: '[{"slug":"requested-org"}]' };
    return base(...args);
  };
  assert.equal((await preflightProviders({
    job: {}, projectPath: 'C:\\project', invoke: exact,
    request: { backend: 'supabase', supabase: { organizationId: 'requested-org' } },
  })).githubUser, 'github-user');
});

test('Windows command resolution never falls back to cmd or bat wrappers', (context) => {
  if (process.platform !== 'win32') return context.skip('Windows-only command resolution');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-command-resolution-'));
  const previous = { APPDATA: process.env.APPDATA, PATH: process.env.PATH, FLUTTER_ROOT: process.env.FLUTTER_ROOT };
  try {
    fs.writeFileSync(path.join(root, 'vercel.cmd'), 'exit /b 0');
    fs.writeFileSync(path.join(root, 'flutter.bat'), 'exit /b 0');
    process.env.APPDATA = root;
    process.env.PATH = root;
    process.env.FLUTTER_ROOT = root;
    assert.throws(() => resolveDefaultInvocation('vercel'), (error) => error.code === 'CLI_UNAVAILABLE');
    assert.throws(() => resolveDefaultInvocation('flutter'), (error) => error.code === 'CLI_UNAVAILABLE');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('command resolution applies an isolated Vercel profile without exposing tokens', (context) => {
  if (process.platform !== 'win32') return context.skip('Windows-only command resolution');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-cli-profile-'));
  const appData = path.join(root, 'appdata');
  const npmGlobal = path.join(appData, 'npm', 'node_modules');
  const vercelScript = path.join(npmGlobal, 'vercel', 'dist', 'index.js');
  const vercelConfig = path.join(root, 'vercel-profile');
  const previous = {
    APPDATA: process.env.APPDATA,
    VIBE_VERCEL_CONFIG_DIR: process.env.VIBE_VERCEL_CONFIG_DIR,
  };
  try {
    fs.mkdirSync(path.dirname(vercelScript), { recursive: true });
    fs.mkdirSync(vercelConfig, { recursive: true });
    fs.writeFileSync(vercelScript, '');
    process.env.APPDATA = appData;
    process.env.VIBE_VERCEL_CONFIG_DIR = vercelConfig;
    assert.deepEqual(resolveDefaultInvocation('vercel').prefix.slice(-2), ['--global-config', vercelConfig]);
    assert.equal(resolveDefaultInvocation('vercel').prefix.some((value) => /token/i.test(value)), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
