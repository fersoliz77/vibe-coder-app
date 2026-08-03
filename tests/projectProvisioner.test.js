const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createProjectProvisioner,
  createSupabaseProjectViaApi,
  getDefaultProjectsRoot,
  getProvisioningOptions,
  setupProjectProvisionerHandlers,
} = require('../electron/services/projectProvisioner');

function makeTempParent() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-provisioner-'));
}

function successfulRunner(calls, overrides = {}) {
  return async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, kind: options.kind });
    const key = `${command} ${args.slice(0, 2).join(' ')}`;
    if (overrides[key]) return overrides[key](command, args, options);
    if (command === 'gh' && args[0] === 'api') return { success: true, stdout: 'active-user\n' };
    if (command === 'vercel' && args[0] === 'whoami') return { success: true, stdout: 'personal-user\n' };
    if (command === 'vercel' && args[0] === 'deploy') return { success: true, stdout: 'https://demo.vercel.app\n' };
    if (command === 'git' && args[0] === 'config') return { success: true, stdout: args.includes('user.email') ? 'developer@example.com\n' : 'Developer\n' };
    return { success: true, stdout: '' };
  };
}

test('options expose only supported stacks and the Documents default root', () => {
  const options = getProvisioningOptions();
  assert.deepEqual(options.projectTypes.map(({ id }) => id), ['next-ts', 'vite-react-ts', 'mobile-suite']);
  assert.deepEqual(options.backends.map(({ id }) => id), ['none', 'firebase', 'supabase']);
  assert.equal(getDefaultProjectsRoot(), path.join(os.homedir(), 'Documents', 'Vibe Projects'));
});

test('location grants are opaque, single-use, and do not disclose any path', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  const calls = [];
  try {
    const provisioner = createProjectProvisioner({ runner: successfulRunner(calls) });
    const grant = provisioner.createLocationGrant(parent);
    assert.equal(Object.hasOwn(grant, 'parentPath'), false);
    assert.equal(Object.hasOwn(grant, 'path'), false);
    assert.deepEqual(Object.keys(grant).sort(), ['expiresAt', 'id', 'token']);
    const result = await provisioner.provisionProject({ name: 'Safe Demo', type: 'vite-react-ts', backend: 'none' }, grant);
    assert.equal(result.status, 'completed');
    await assert.rejects(
      provisioner.provisionProject({ name: 'Another Demo', type: 'vite-react-ts', backend: 'none' }, grant),
      /permission expired/i,
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('expired grants and drive roots are rejected', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  let clock = 100;
  try {
    const provisioner = createProjectProvisioner({ now: () => clock, runner: async () => ({ success: true }) });
    const grant = provisioner.createLocationGrant(parent);
    clock += 11 * 60 * 1000;
    await assert.rejects(
      provisioner.provisionProject({ name: 'Expired Demo', type: 'next-ts', backend: 'none' }, grant),
      /permission expired/i,
    );
    assert.throws(() => provisioner.createLocationGrant(path.parse(parent).root), /drive root/i);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('only one provisioning job can run and a rejected second job keeps its grant', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  const calls = [];
  let releaseFirst;
  let markStarted;
  const firstStarted = new Promise((resolve) => { markStarted = resolve; });
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const baseRunner = successfulRunner(calls);
  let shouldBlock = true;
  const runner = async (...args) => {
    if (shouldBlock) {
      shouldBlock = false;
      markStarted();
      await firstBlocked;
    }
    return baseRunner(...args);
  };
  try {
    const provisioner = createProjectProvisioner({ runner });
    const first = provisioner.provisionProject(
      { name: 'First Demo', type: 'vite-react-ts', backend: 'none' },
      provisioner.createLocationGrant(parent),
    );
    await firstStarted;
    const secondGrant = provisioner.createLocationGrant(parent);
    await assert.rejects(
      provisioner.provisionProject({ name: 'Second Demo', type: 'vite-react-ts', backend: 'none' }, secondGrant),
      (error) => error.code === 'PROVISIONING_ACTIVE',
    );
    releaseFirst();
    assert.equal((await first).status, 'completed');
    assert.equal((await provisioner.provisionProject(
      { name: 'Second Demo', type: 'vite-react-ts', backend: 'none' },
      secondGrant,
    )).status, 'completed');
  } finally {
    releaseFirst?.();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('requests cannot inject CLI arguments or select both backends', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  const calls = [];
  try {
    const provisioner = createProjectProvisioner({ runner: successfulRunner(calls) });
    const unsafeGrant = provisioner.createLocationGrant(parent);
    await assert.rejects(
      provisioner.provisionProject({ name: 'Demo', type: 'next-ts', backend: 'none', args: ['&', 'calc.exe'] }, unsafeGrant),
      /CLI arguments/i,
    );
    const backendGrant = provisioner.createLocationGrant(parent);
    await assert.rejects(
      provisioner.provisionProject({ name: 'Demo', type: 'next-ts', firebase: {}, supabase: {} }, backendGrant),
      /never both/i,
    );
    assert.equal(calls.length, 0);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('mobile provisioning uses web as the Vercel cwd and Flutter Android Kotlin arguments', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  const calls = [];
  try {
    const provisioner = createProjectProvisioner({ runner: successfulRunner(calls) });
    const result = await provisioner.provisionProject(
      { name: 'Mobile Suite', type: 'mobile-suite', backend: 'none' },
      provisioner.createLocationGrant(parent),
    );
    assert.equal(result.status, 'completed');
    const flutter = calls.find(({ command }) => command === 'flutter');
    assert.ok(flutter.args.includes('--platforms=android'));
    assert.ok(flutter.args.includes('--android-language=kotlin'));
    const vercel = calls.find(({ command, args }) => command === 'vercel' && args[0] === 'link');
    assert.equal(vercel.cwd, path.join(result.projectPath, 'web'));
    assert.equal(result.remotes.vercel.status, 'created');
    assert.equal(result.remotes.vercel.gitConnection.status, 'created');
    assert.equal(result.remotes.vercel.deployment.status, 'created');
    assert.equal(Object.hasOwn(result.remotes.vercel, 'cwd'), false);
    const github = calls.find(({ command, args }) => command === 'gh' && args[0] === 'repo');
    assert.ok(github.args.includes('--private'));
    assert.equal(result.remotes.github.status, 'created');
    assert.ok(calls.some(({ command, args }) => command === 'git' && args[0] === 'push'));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('Supabase quota failures preserve local work, return alternatives, and never register the project', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  const calls = [];
  let registered = false;
  const runner = successfulRunner(calls, {
    'supabase orgs list': async () => ({ success: true, stdout: '[{"id":"org_123","name":"Example"}]' }),
    'supabase projects create': async () => ({ success: false, stderr: 'Free project quota reached' }),
  });
  try {
    const provisioner = createProjectProvisioner({
      runner,
      registerProject: async (projectPath, metadata) => { registered = true; return { path: projectPath, ...metadata }; },
      supabaseProjectCreator: async () => { throw Object.assign(new Error('quota'), { code: 'SUPABASE_QUOTA' }); },
    });
    const result = await provisioner.provisionProject({
      name: 'Quota Demo',
      type: 'next-ts',
      backend: 'supabase',
      supabase: { organizationId: 'org_123', region: 'us-east-1', password: 'safe-password-123' },
    }, provisioner.createLocationGrant(parent));
    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'SUPABASE_QUOTA');
    assert.deepEqual(result.error.alternatives, ['firebase', 'supabase-upgrade']);
    assert.equal(result.localRolledBack, false);
    assert.equal(result.retryable, false);
    assert.equal(result.partial, true);
    assert.equal(result.manualCleanupRequired, true);
    assert.equal(fs.existsSync(result.projectPath), true);
    assert.equal(registered, true);
    assert.equal(result.project.provisioningStatus, 'partial');
    assert.equal(JSON.stringify(result).includes('safe-password-123'), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('local failures preserve and register partial work before any remote resource creation', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  try {
    const provisioner = createProjectProvisioner({
      runner: async (command) => command === 'git'
        ? { success: false, stderr: 'git unavailable' }
        : { success: true },
    });
    const result = await provisioner.provisionProject(
      { name: 'Rollback Demo', type: 'vite-react-ts', backend: 'none' },
      provisioner.createLocationGrant(parent),
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.localRolledBack, false);
    assert.equal(result.retryable, true);
    assert.equal(result.partial, true);
    assert.equal(result.manualCleanupRequired, false);
    assert.equal(fs.existsSync(result.projectPath), true);
    assert.equal(result.project.provisioningStatus, 'partial');
    assert.deepEqual(result.remotes, {});
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('Firebase configures Spark web and Android apps plus Firestore, and reports Auth as a manual step', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, kind: options.kind });
    if (command === 'gh' && args[0] === 'api') return { success: true, stdout: 'active-user' };
    if (command === 'vercel' && args[0] === 'whoami') return { success: true, stdout: 'personal-user' };
    if (command === 'vercel' && args[0] === 'deploy') return { success: true, stdout: 'https://firebase-mobile.vercel.app' };
    if (command === 'git' && args[0] === 'config') return { success: true, stdout: args.includes('user.email') ? 'developer@example.com' : 'Developer' };
    if (command === 'firebase' && args[0] === 'apps:create' && args[1] === 'WEB') {
      return { success: true, stdout: '{"result":{"appId":"web-app-id"}}' };
    }
    if (command === 'firebase' && args[0] === 'apps:create' && args[1] === 'ANDROID') {
      return { success: true, stdout: '{"result":{"appId":"android-app-id"}}' };
    }
    if (command === 'firebase' && args[0] === 'apps:sdkconfig' && args[1] === 'WEB') {
      return {
        success: true,
        stdout: '{"result":{"sdkConfig":{"apiKey":"public-web-key","authDomain":"demo.firebaseapp.com","messagingSenderId":"123"}}}',
      };
    }
    if (command === 'firebase' && args[0] === 'apps:sdkconfig' && args[1] === 'ANDROID') {
      return {
        success: true,
        stdout: '{"result":{"fileContents":"{\\"project_info\\":{\\"project_id\\":\\"demo\\"}}"}}',
      };
    }
    return { success: true, stdout: '' };
  };
  try {
    const provisioner = createProjectProvisioner({ runner, randomUUID: () => '12345678-1234-1234-1234-123456789abc' });
    const result = await provisioner.provisionProject({
      name: 'Firebase Mobile',
      type: 'mobile-suite',
      backend: 'firebase',
      firebase: { location: 'nam5' },
    }, provisioner.createLocationGrant(parent));
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.equal(result.remotes.firebase.plan, 'spark');
    assert.equal(result.remotes.firebase.authConfigured, false);
    assert.deepEqual(result.remotes.firebase.manualSteps, [{
      code: 'ENABLE_EMAIL_PASSWORD_AUTH',
      message: 'Enable Email/Password sign-in in the Firebase console before using authentication.',
    }]);
    assert.equal(result.remotes.firebase.firestoreConfigured, true);
    assert.equal(result.remotes.firebase.androidAppCreated, true);
    assert.equal(result.remotes.firebase.status, 'created');
    assert.equal(result.remotes.firebase.resources.webApp.status, 'created');
    assert.equal(result.remotes.firebase.resources.firestore.status, 'created');
    assert.equal(result.remotes.firebase.resources.androidApp.status, 'created');
    const firebaseConfig = JSON.parse(fs.readFileSync(path.join(result.projectPath, 'firebase.json'), 'utf8'));
    assert.deepEqual(Object.keys(firebaseConfig), ['firestore']);
    const env = fs.readFileSync(path.join(result.projectPath, 'web', '.env.local'), 'utf8');
    assert.match(env, /NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=/);
    assert.doesNotMatch(env, /STORAGE/);
    const googleServices = JSON.parse(fs.readFileSync(path.join(result.projectPath, 'mobile', 'android', 'app', 'google-services.json'), 'utf8'));
    assert.equal(googleServices.project_info.project_id, 'demo');
    const commandText = calls.flatMap(({ args }) => args).join(' ');
    assert.doesNotMatch(commandText, /(?:^|\s)(storage|hosting)(?:$|\s|:)/i);
    const deploy = calls.find(({ command, args }) => command === 'firebase' && args[0] === 'deploy');
    assert.equal(deploy.args[deploy.args.indexOf('--only') + 1], 'firestore');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('Supabase uses only a publishable client key and initializes and links the Nano project', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  const calls = [];
  const progress = [];
  const serviceSecret = 'sb_secret_must_never_escape';
  const runner = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, kind: options.kind });
    if (command === 'gh' && args[0] === 'api') return { success: true, stdout: 'active-user' };
    if (command === 'vercel' && args[0] === 'whoami') return { success: true, stdout: 'personal-user' };
    if (command === 'vercel' && args[0] === 'deploy') return { success: true, stdout: 'https://supabase-demo.vercel.app' };
    if (command === 'git' && args[0] === 'config') return { success: true, stdout: args.includes('user.email') ? 'developer@example.com' : 'Developer' };
    if (command === 'supabase' && args[0] === 'orgs') return { success: true, stdout: '[{"id":"org_123"}]' };
    if (command === 'supabase' && args[0] === 'projects' && args[1] === 'create') {
      return { success: true, stdout: '{"id":"abcdefghijklmnopqrst","url":"https://abcdefghijklmnopqrst.supabase.co"}' };
    }
    if (command === 'supabase' && args[0] === 'projects' && args[1] === 'api-keys') {
      return {
        success: true,
        stdout: JSON.stringify([
          { name: 'publishable', api_key: 'sb_publishable_public' },
          { name: 'service_role', api_key: serviceSecret },
        ]),
      };
    }
    return { success: true, stdout: '' };
  };
  try {
    const provisioner = createProjectProvisioner({
      runner,
      onProgress: (event) => progress.push(event),
      supabaseProjectCreator: async () => ({ id: 'abcdefghijklmnopqrst', url: 'https://abcdefghijklmnopqrst.supabase.co' }),
    });
    const result = await provisioner.provisionProject({
      name: 'Supabase Demo',
      type: 'vite-react-ts',
      backend: 'supabase',
      supabase: { organizationId: 'org_123', region: 'us-east-1', password: 'safe-password-123' },
    }, provisioner.createLocationGrant(parent));
    assert.equal(result.status, 'completed');
    assert.equal(result.remotes.supabase.size, 'nano');
    assert.equal(result.remotes.supabase.clientKeyType, 'publishable');
    assert.equal(result.remotes.supabase.status, 'created');
    assert.ok(calls.some(({ command, args }) => command === 'supabase' && args[0] === 'init'));
    assert.ok(calls.some(({ command, args }) => command === 'supabase' && args[0] === 'link'));
    assert.equal(calls.some(({ args }) => args.includes('safe-password-123')), false);
    const env = fs.readFileSync(path.join(result.projectPath, '.env.local'), 'utf8');
    assert.match(env, /VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_public/);
    assert.equal(env.includes(serviceSecret), false);
    assert.equal(JSON.stringify(result).includes(serviceSecret), false);
    assert.equal(JSON.stringify(progress).includes(serviceSecret), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('cancellation after GitHub creation records an unknown deterministic remote', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  let provisioner;
  const calls = [];
  const baseRunner = successfulRunner(calls);
  const runner = async (command, args, options) => {
    const result = await baseRunner(command, args, options);
    if (command === 'gh' && args[0] === 'repo') provisioner.cancelProvisioning();
    return result;
  };
  try {
    provisioner = createProjectProvisioner({ runner });
    const result = await provisioner.provisionProject(
      { name: 'Ambiguous Remote', type: 'vite-react-ts', backend: 'none' },
      provisioner.createLocationGrant(parent),
    );
    assert.equal(result.status, 'cancelled');
    assert.equal(result.manualCleanupRequired, true);
    assert.deepEqual(result.remotes.github, {
      owner: 'active-user',
      repository: 'ambiguous-remote',
      private: true,
      url: 'https://github.com/active-user/ambiguous-remote',
      status: 'unknown',
      created: null,
    });
    assert.equal(JSON.stringify(result.remotes).includes(parent), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('Supabase Management API keeps the database password out of the URL and process arguments', async () => {
  const previousToken = process.env.SUPABASE_ACCESS_TOKEN;
  process.env.SUPABASE_ACCESS_TOKEN = 'sbp_test_token';
  let request;
  try {
    const result = await createSupabaseProjectViaApi({
      name: 'secure-demo',
      organizationId: 'org_123',
      region: 'us-east-1',
      password: 'safe-password-123',
    }, async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ id: 'project-ref' }) };
    });
    assert.equal(result.id, 'project-ref');
    assert.equal(request.url.includes('safe-password-123'), false);
    assert.equal(request.options.headers.Authorization, 'Bearer sbp_test_token');
    assert.equal(JSON.parse(request.options.body).db_pass, 'safe-password-123');
  } finally {
    if (previousToken == null) delete process.env.SUPABASE_ACCESS_TOKEN;
    else process.env.SUPABASE_ACCESS_TOKEN = previousToken;
  }
});

test('Supabase Management API forwards cancellation to fetch', async () => {
  const previousToken = process.env.SUPABASE_ACCESS_TOKEN;
  process.env.SUPABASE_ACCESS_TOKEN = 'sbp_test_token';
  const controller = new AbortController();
  let receivedSignal;
  try {
    const pending = createSupabaseProjectViaApi({
      name: 'cancel-demo',
      organizationId: 'org_123',
      region: 'us-east-1',
      password: 'safe-password-123',
      signal: controller.signal,
    }, async (_url, options) => {
      receivedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    });
    assert.equal(receivedSignal, controller.signal);
    controller.abort();
    await assert.rejects(pending, (error) => error.name === 'AbortError');
  } finally {
    if (previousToken == null) delete process.env.SUPABASE_ACCESS_TOKEN;
    else process.env.SUPABASE_ACCESS_TOKEN = previousToken;
  }
});

test('cancelling Supabase provisioning aborts Management API creation and preserves partial local work', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  const calls = [];
  let markStarted;
  const creationStarted = new Promise((resolve) => { markStarted = resolve; });
  try {
    const provisioner = createProjectProvisioner({
      runner: successfulRunner(calls, {
        'supabase orgs list': async () => ({ success: true, stdout: '[{"id":"org_123"}]' }),
      }),
      supabaseProjectCreator: async ({ signal }) => {
        markStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        });
      },
    });
    const pending = provisioner.provisionProject({
      name: 'Abort API Demo',
      type: 'next-ts',
      backend: 'supabase',
      supabase: { organizationId: 'org_123', region: 'us-east-1', password: 'safe-password-123' },
    }, provisioner.createLocationGrant(parent));
    await creationStarted;
    assert.deepEqual(provisioner.cancelProvisioning(), { success: true, cancelled: 1 });
    const result = await pending;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.error.code, 'CANCELLED');
    assert.equal(result.retryable, false);
    assert.equal(result.partial, true);
    assert.equal(result.manualCleanupRequired, true);
    assert.equal(result.localRolledBack, false);
    assert.equal(fs.existsSync(result.projectPath), true);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('cancellation aborts the tracked provision and preserves local work before remote creation', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only provisioner');
  const parent = makeTempParent();
  let started;
  const commandStarted = new Promise((resolve) => { started = resolve; });
  const runner = async (_command, _args, { signal }) => {
    started();
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    return { success: true };
  };
  try {
    const provisioner = createProjectProvisioner({ runner });
    const pending = provisioner.provisionProject(
      { name: 'Cancel Demo', type: 'next-ts', backend: 'none' },
      provisioner.createLocationGrant(parent),
    );
    await commandStarted;
    assert.deepEqual(provisioner.cancelProvisioning(), { success: true, cancelled: 1 });
    const result = await pending;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.error.code, 'CANCELLED');
    assert.equal(result.localRolledBack, false);
    assert.equal(result.retryable, true);
    assert.equal(result.partial, true);
    assert.equal(result.manualCleanupRequired, false);
    assert.equal(fs.existsSync(result.projectPath), true);
    assert.equal(result.project.provisioningStatus, 'partial');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('IPC setup installs provisioning handlers once and sends sanitized progress', () => {
  const handlers = new Map();
  const sent = [];
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const window = {
    isDestroyed: () => false,
    webContents: { send: (...args) => sent.push(args) },
  };
  const first = setupProjectProvisionerHandlers(ipcMain, () => window, async () => ({}));
  const second = setupProjectProvisionerHandlers(ipcMain, () => window, async () => ({}));
  assert.equal(first, second);
  assert.deepEqual([...handlers.keys()], [
    'projects:get-provisioning-options',
    'projects:get-default-root',
    'projects:choose-location',
    'projects:provision',
    'projects:cancel-provisioning',
  ]);
  assert.deepEqual(sent, []);
});
