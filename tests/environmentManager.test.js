const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ANDROID_AVD_NAME,
  ANDROID_BUILD_TOOLS_VERSION,
  ANDROID_COMMAND_LINE_TOOLS_URL,
  ANDROID_SDK_PACKAGES,
  ANDROID_SYSTEM_IMAGE,
  INSTALL_ALLOWLIST,
  SUPABASE_INSTRUCTION,
  buildInstallationPlan,
  getAvdHardwareConfig,
  normalizeOptions,
  parseVersionOutput,
} = require('../electron/services/environmentManager');

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
    'android-sdk',
    'flutter',
    'vercel',
    'firebase',
  ]);
  assert.ok(plan.every((step) => step === INSTALL_ALLOWLIST[step.id]));
  assert.ok(plan.every((step) => ['winget.exe', 'npm', 'git'].includes(step.file)));
  assert.deepEqual(INSTALL_ALLOWLIST.vercel.args, ['install', '--global', 'vercel']);
  assert.deepEqual(INSTALL_ALLOWLIST.firebase.args, ['install', '--global', 'firebase-tools']);
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
});
