const test = require('node:test');
const assert = require('node:assert/strict');
const { itemMetadata } = require('../electron/services/environmentCatalog');
const { stripAnsi } = require('../electron/services/environmentVersion');

const {
  ANDROID_AVD_NAME,
  ANDROID_BUILD_TOOLS_VERSION,
  ANDROID_COMMAND_LINE_TOOLS_URL,
  ANDROID_SDK_PACKAGES,
  ANDROID_SYSTEM_IMAGE,
  INSTALL_ALLOWLIST,
  SUPABASE_INSTRUCTION,
  buildInstallationPlan,
  cancelEnvironmentInstallation,
  getAvdHardwareConfig,
  getJavaRuntimeEnv,
  installAllEnvironment,
  normalizeOptions,
  parseVersionOutput,
} = require('../electron/services/environmentManager');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function environment(items) {
  const missing = items.filter((item) => !item.installed);
  return {
    items,
    summary: { installed: items.length - missing.length, missing: missing.length, requiredMissing: missing.length },
    instructions: [],
  };
}

test('Android provisioning uses pinned Google packages and conservative adaptive AVD settings', () => {
  assert.equal(ANDROID_AVD_NAME, 'Vibe_API_35');
  assert.equal(ANDROID_BUILD_TOOLS_VERSION, '35.0.0');
  assert.equal(ANDROID_SYSTEM_IMAGE, 'system-images;android-35;google_apis;x86_64');
  assert.match(ANDROID_COMMAND_LINE_TOOLS_URL, /^https:\/\/dl\.google\.com\/android\/repository\/commandlinetools-win-13114758_latest\.zip$/);
  assert.deepEqual(ANDROID_SDK_PACKAGES, [
    'platform-tools', 'platforms;android-35', 'build-tools;35.0.0', 'emulator', 'system-images;android-35;google_apis;x86_64',
  ]);
  assert.deepEqual(getAvdHardwareConfig(4 * 1024 ** 3, 8), { ramMb: 1024, cpuCores: 1, heapMb: 256, dataPartition: '4G' });
  assert.deepEqual(getAvdHardwareConfig(8 * 1024 ** 3, 4), { ramMb: 1536, cpuCores: 2, heapMb: 384, dataPartition: '6G' });
  assert.deepEqual(getAvdHardwareConfig(16 * 1024 ** 3, 12), { ramMb: 2048, cpuCores: 4, heapMb: 512, dataPartition: '8G' });
});

test('Android provisioning pins sdkmanager to the detected JDK 17 runtime', () => {
  const compiler = 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.19.10-hotspot\\bin\\javac.exe';
  const env = getJavaRuntimeEnv(compiler);
  assert.equal(env.JAVA_HOME, 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.19.10-hotspot');
  assert.equal(env.PATH.split(';')[0], 'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.19.10-hotspot\\bin');
});

test('installation plan is restricted to the fixed allowlist and preserves dependency order', () => {
  const plan = buildInstallationPlan(
    { includeMobile: true, backend: 'firebase' },
    { items: [] },
  );

  assert.deepEqual(plan.map((step) => step.id), [
    'node',
    'git',
    'gh',
    'java',
    'flutter',
    'vercel',
    'firebase',
  ]);
  assert.ok(plan.every((step) => step === INSTALL_ALLOWLIST[step.id]));
  assert.ok(plan.every((step) => ['winget.exe', 'npm', 'git'].includes(step.file)));
  assert.deepEqual(INSTALL_ALLOWLIST.vercel.args, ['install', '--global', 'vercel']);
  assert.deepEqual(INSTALL_ALLOWLIST.firebase.args, ['install', '--global', 'firebase-tools']);
});

test('a missing Android SDK is provisioned directly without reinstalling Android Studio', async () => {
  const readyItems = ['node', 'npm', 'git', 'gh', 'vercel', 'java', 'flutter'].map((id) => ({ id, installed: true }));
  const before = environment([...readyItems, { id: 'android-sdk', installed: false }]);
  const after = environment([...readyItems, { id: 'android-sdk', installed: true }]);
  const events = [];
  let checks = 0;
  let tracked = 0;
  let provisioned = 0;
  let provisionedWithJava = null;
  const result = await installAllEnvironment({ backend: 'supabase', includeMobile: true }, (event) => events.push(event), {
    checkEnvironment: async () => (++checks === 1 ? before : after),
    runTracked: async () => { tracked += 1; return { success: true }; },
    probeEnvironmentItem: async (id) => ({ installed: true, ...(id === 'java' ? { path: 'C:\\jdk-17\\bin\\javac.exe' } : {}) }),
    provisionAndroidSdk: async (_run, _progress, javaCompilerPath) => { provisioned += 1; provisionedWithJava = javaCompilerPath; return { success: true }; },
  });
  assert.equal(result.success, true);
  assert.equal(tracked, 0);
  assert.equal(provisioned, 1);
  assert.equal(provisionedWithJava, 'C:\\jdk-17\\bin\\javac.exe');
  assert.equal(events.some((event) => /Android Studio/.test(event.message || '')), false);
});

test('installed tools are omitted and a missing npm selects the allowlisted Node repair', () => {
  const environment = {
    items: [
      { id: 'node', installed: true },
      { id: 'npm', installed: false },
      { id: 'git', installed: true },
      { id: 'gh', installed: true },
      { id: 'vercel', installed: true },
    ],
  };
  assert.deepEqual(buildInstallationPlan({ backend: 'supabase' }, environment).map((step) => step.id), ['node']);
});

test('Supabase is diagnosis-only and cannot add a command to the plan', () => {
  const plan = buildInstallationPlan({ backend: 'supabase' }, { items: [] });
  assert.equal(plan.some((step) => step.id === 'supabase'), false);
  assert.match(SUPABASE_INSTRUCTION, /^Instala Supabase CLI siguiendo la guía oficial: https:\/\/supabase\.com\//);
  assert.throws(() => normalizeOptions({ backend: 'supabase & calc.exe' }), /Backend no soportado/);
});

test('environment catalog derives backend requirements without mutating shared metadata', () => {
  assert.equal(itemMetadata('firebase', { backend: 'firebase' }).required, true);
  assert.equal(itemMetadata('firebase', { backend: 'supabase' }).required, false);
  assert.equal(itemMetadata('supabase', { backend: 'supabase' }).installable, false);
  assert.deepEqual(normalizeOptions({ includeMobile: 1, backend: 'SUPABASE' }), { includeMobile: false, backend: 'supabase' });
});

test('parses versions from supported CLI output formats', () => {
  const samples = [
    ['node', 'v22.14.0\r\n', '22.14.0'],
    ['npm', '10.9.2', '10.9.2'],
    ['git', 'git version 2.47.1.windows.1', '2.47.1.windows.1'],
    ['gh', 'gh version 2.67.0 (2025-01-01)', '2.67.0'],
    ['vercel', 'Vercel CLI 39.4.2', '39.4.2'],
    ['firebase', '13.29.1', '13.29.1'],
    ['supabase', '2.19.7', '2.19.7'],
    ['flutter', 'Flutter 3.24.5 • channel stable', '3.24.5'],
    ['java', 'openjdk 17.0.13 2024-10-15', '17.0.13'],
    ['java', 'javac 17.0.14', '17.0.14'],
  ];
  for (const [tool, output, expected] of samples) assert.equal(parseVersionOutput(tool, output), expected, tool);
  assert.equal(parseVersionOutput('node', ''), null);
  assert.equal(parseVersionOutput('unknown', '\u001b[32mv1.2.3-beta.1\u001b[0m'), '1.2.3-beta.1');
  assert.equal(parseVersionOutput('node', 'Node release 22.14.0'), null);
  assert.equal(stripAnsi('\u001b[31mfailed\u001b[0m'), 'failed');
});

test('cancellation after a tracked step prevents subsequent processes and complete progress', async () => {
  const tracked = deferred();
  const events = [];
  let trackCalls = 0;
  let checkCalls = 0;
  const install = installAllEnvironment({ backend: 'supabase' }, (event) => events.push(event), {
    checkEnvironment: async () => { checkCalls += 1; return environment([]); },
    resolveInstallationInvocation: async (step) => ({ file: step.file, args: [...step.args] }),
    runTracked: async () => { trackCalls += 1; return tracked.promise; },
  });
  while (trackCalls === 0) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cancelEnvironmentInstallation(), { success: true, cancelled: true });
  tracked.resolve({ success: false, code: null, error: 'cancelled' });
  const result = await install;
  assert.equal(result.cancelled, true);
  assert.equal(trackCalls, 1);
  assert.equal(checkCalls, 1);
  assert.equal(events.some((event) => event.type === 'complete'), false);
});

test('cancellation during mobile probes never starts Android provisioning', async () => {
  const probes = deferred();
  const events = [];
  let probeCalls = 0;
  let provisionCalls = 0;
  const installed = ['node', 'npm', 'git', 'gh', 'vercel', 'java', 'flutter'].map((id) => ({ id, installed: true }));
  installed.push({ id: 'android-sdk', installed: false });
  const install = installAllEnvironment({ backend: 'supabase', includeMobile: true }, (event) => events.push(event), {
    checkEnvironment: async () => environment(installed),
    resolveInstallationInvocation: async (step) => ({ file: step.file, args: [...step.args] }),
    runTracked: async () => ({ success: true, code: 0 }),
    probeEnvironmentItem: async () => { probeCalls += 1; return probes.promise; },
    provisionAndroidSdk: async () => { provisionCalls += 1; return { success: true }; },
  });
  while (probeCalls < 2) await new Promise((resolve) => setImmediate(resolve));
  cancelEnvironmentInstallation();
  probes.resolve({ installed: true });
  const result = await install;
  assert.equal(result.cancelled, true);
  assert.equal(provisionCalls, 0);
  assert.equal(events.some((event) => event.type === 'complete'), false);
});

test('cancellation during the final environment check returns cancelled without complete', async () => {
  const finalCheckStarted = deferred();
  const events = [];
  let checks = 0;
  let finalSignal;
  const ready = environment(['node', 'npm', 'git', 'gh', 'vercel'].map((id) => ({ id, installed: true })));
  const install = installAllEnvironment({ backend: 'supabase' }, (event) => events.push(event), {
    checkEnvironment: async (_options, { signal }) => {
      checks += 1;
      if (checks === 1) return ready;
      finalSignal = signal;
      finalCheckStarted.resolve();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return ready;
    },
  });
  await finalCheckStarted.promise;
  cancelEnvironmentInstallation();
  const result = await install;
  assert.equal(finalSignal.aborted, true);
  assert.equal(result.cancelled, true);
  assert.equal(events.at(-1).type, 'cancelled');
  assert.equal(events.some((event) => event.type === 'complete'), false);
});

test('cancellation aborts the initial environment probe signal immediately', async () => {
  const probeStarted = deferred();
  let receivedSignal;
  const events = [];
  const install = installAllEnvironment({ backend: 'supabase' }, (event) => events.push(event), {
    checkEnvironment: async (_options, { signal }) => {
      receivedSignal = signal;
      probeStarted.resolve();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return environment([]);
    },
  });
  await probeStarted.promise;
  assert.equal(receivedSignal.aborted, false);
  cancelEnvironmentInstallation();
  const result = await install;
  assert.equal(receivedSignal.aborted, true);
  assert.equal(result.cancelled, true);
  assert.equal(events.at(-1).type, 'cancelled');
});

test('cancellation aborts both mobile probe signals without starting Android provisioning', async () => {
  const probesStarted = deferred();
  const signals = [];
  let provisionCalls = 0;
  const installed = ['node', 'npm', 'git', 'gh', 'vercel', 'java', 'flutter'].map((id) => ({ id, installed: true }));
  installed.push({ id: 'android-sdk', installed: false });
  const install = installAllEnvironment({ backend: 'supabase', includeMobile: true }, null, {
    checkEnvironment: async () => environment(installed),
    resolveInstallationInvocation: async (step) => ({ file: step.file, args: [...step.args] }),
    runTracked: async () => ({ success: true, code: 0 }),
    probeEnvironmentItem: async (_id, signal) => {
      signals.push(signal);
      if (signals.length === 2) probesStarted.resolve();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return { installed: false };
    },
    provisionAndroidSdk: async () => { provisionCalls += 1; return { success: true }; },
  });
  await probesStarted.promise;
  cancelEnvironmentInstallation();
  const result = await install;
  assert.equal(signals.every((signal) => signal.aborted), true);
  assert.equal(result.cancelled, true);
  assert.equal(provisionCalls, 0);
});
