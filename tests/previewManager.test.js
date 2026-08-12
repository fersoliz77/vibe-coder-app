const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyPreviewError, formatDiagnosis } = require('../electron/services/previewDiagnostics');
const previewCommands = require('../electron/services/previewCommands');

const {
  PREVIEW_URL,
  buildAdbRotationArgs,
  buildAdbScreenshotArgs,
  buildWebDevArgs,
  classifyWebScript,
  detectManagedEmulatorSerial,
  detectProjectTargets,
  isAndroidBootComplete,
  isConfiguredAvdNameOutput,
  isIgnoredWatchPath,
  isTrustedPreviewUrl,
  parseAdbEmulatorSerials,
  safeArtifactPath,
  safeRelativeProjectPath,
  sanitizeIssue,
  sanitizeLog,
  resolveRepairProject,
} = require('../electron/services/previewManager');

test('preview URL guard accepts only the fixed loopback origin', () => {
  assert.equal(PREVIEW_URL, 'http://127.0.0.1:4173');
  assert.equal(isTrustedPreviewUrl(PREVIEW_URL), true);
  for (const url of [
    'http://localhost:4173',
    'http://127.0.0.1:4173/',
    'http://127.0.0.1:4173.evil.test',
    'https://127.0.0.1:4173',
    'javascript:alert(1)',
  ]) assert.equal(isTrustedPreviewUrl(url), false, url);
});

test('preview repair resolves only a bounded project ID in main', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-repair-'));
  try {
    const project = resolveRepairProject('proj_1', (id) => id === 'proj_1' ? { id, path: root } : null, (value) => value);
    assert.equal(project.path, root);
    assert.throws(() => resolveRepairProject(root, () => null, (value) => value), /no longer registered/);
    assert.throws(() => resolveRepairProject('', () => null), /valid project ID/);
    assert.throws(() => resolveRepairProject('x'.repeat(161), () => null), /valid project ID/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('web commands use fixed Vite and Next argument conventions', () => {
  assert.equal(classifyWebScript({ scripts: { dev: 'vite' } }), 'vite');
  assert.equal(classifyWebScript({ scripts: { dev: 'next dev' } }), 'next');
  assert.equal(classifyWebScript({ scripts: { dev: 'node tools/dev.js' } }), null);
  assert.equal(classifyWebScript({ scripts: { dev: 'echo vite' } }), null);
  assert.equal(classifyWebScript({ scripts: { dev: 'vite --host 0.0.0.0' } }), null);
  assert.equal(classifyWebScript({ scripts: { dev: 'next dev && echo unsafe' } }), null);
  assert.equal(classifyWebScript({ scripts: {} }), null);
  assert.deepEqual(buildWebDevArgs('vite'), ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort']);
  assert.deepEqual(buildWebDevArgs('next'), ['run', 'dev', '--', '-H', '127.0.0.1', '-p', '4173']);
  assert.equal(buildWebDevArgs('vite').some((value) => /[;&|]/.test(value)), false);
  assert.throws(() => buildWebDevArgs('generic'), /Unsupported/);
});

test('extracted preview command helpers retain the manager command contract', () => {
  assert.equal(previewCommands.PREVIEW_URL, PREVIEW_URL);
  assert.equal(previewCommands.classifyWebScript({ scripts: { dev: ' VITE.CMD ' } }), 'vite');
  assert.deepEqual(previewCommands.buildWebDevArgs('next'), buildWebDevArgs('next'));
  assert.throws(() => previewCommands.buildAdbScreenshotArgs('emulator-5554 & calc'), /Invalid/);
  assert.deepEqual(previewCommands.buildFlutterRunSpawnOptions('mobile', { SAFE: '1' }).stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(previewCommands.buildFlutterControlInput('reload'), 'r\n');
  assert.equal(previewCommands.buildFlutterControlInput('restart'), 'R\n');
  assert.throws(() => previewCommands.buildFlutterControlInput('quit'), /Invalid/);
});

test('preview diagnostics classify failures and format only sanitized issue fields', () => {
  assert.equal(classifyPreviewError(new Error('did not finish in time')), 'timeout');
  assert.equal(classifyPreviewError(new Error('Unsupported npm dev script')), 'validation');
  assert.equal(classifyPreviewError(new Error('spawn process exited')), 'process');
  assert.equal(classifyPreviewError(new Error('unexpected state')), 'runtime');
  assert.equal(formatDiagnosis([]), 'Preview diagnostics: no issues detected.');
  assert.equal(formatDiagnosis([{ severity: 'warning', category: 'responsive', message: 'Overflow' }]), '[WARNING] responsive: Overflow');
});

test('managed emulator discovery matches only the exact configured AVD', async () => {
  const calls = [];
  const execute = async (_adb, args) => {
    calls.push(args);
    if (args[0] === 'devices') {
      return { stdout: 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n192.168.1.2:5555\tdevice\n' };
    }
    if (args[1] === 'emulator-5554') return { stdout: 'Unrelated_API_35\nOK\n' };
    return { stdout: 'Vibe_API_35\nOK\n' };
  };

  assert.deepEqual(parseAdbEmulatorSerials('emulator-5554\tdevice\nemulator-bad\tdevice\nemulator-5556\toffline'), ['emulator-5554']);
  assert.equal(isConfiguredAvdNameOutput('Vibe_API_35\nOK\n'), true);
  assert.equal(isConfiguredAvdNameOutput('Vibe_API_35_clone\nOK\n'), false);
  assert.equal(await detectManagedEmulatorSerial('adb', execute, () => true), 'emulator-5556');
  assert.deepEqual(calls.slice(1), [
    ['-s', 'emulator-5554', 'emu', 'avd', 'name'],
    ['-s', 'emulator-5556', 'emu', 'avd', 'name'],
  ]);
});

test('Android boot completion requires an exact getprop value and validated serial', async () => {
  const execute = async (_adb, args) => ({ stdout: args[1] === 'emulator-5554' ? '1\r\n' : '0\n' });
  assert.equal(await isAndroidBootComplete('adb', 'emulator-5554', execute), true);
  assert.equal(await isAndroidBootComplete('adb', 'emulator-5556', execute), false);
  assert.equal(await isAndroidBootComplete('adb', 'device;rm -rf', execute), false);
});

test('mobile-suite targets prefer web/ and require mobile/pubspec.yaml', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-preview-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    let targets = detectProjectTargets(root);
    assert.equal(targets.webCwd, root);
    assert.equal(targets.mobileCwd, null);

    fs.mkdirSync(path.join(root, 'web'));
    fs.writeFileSync(path.join(root, 'web', 'package.json'), '{}');
    fs.mkdirSync(path.join(root, 'mobile'));
    fs.writeFileSync(path.join(root, 'mobile', 'pubspec.yaml'), 'name: sample\n');
    targets = detectProjectTargets(root);
    assert.equal(targets.webCwd, path.join(root, 'web'));
    assert.equal(targets.mobileCwd, path.join(root, 'mobile'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preview logs remove terminal controls, project paths, and excessive output', () => {
  const project = 'C:\\Users\\student\\secret-project';
  const output = sanitizeLog(`\u001b[31mfailed\u001b[0m at ${project}\u0000`, project);
  assert.equal(output, 'failed at [project]');
  assert.equal(sanitizeLog('x'.repeat(9_000)).length, 8_000);
  assert.doesNotMatch(sanitizeLog(`token=private ${'x'.repeat(8_000)}`), /private/);
});

test('preview issues are classified, sanitized, and stripped to allowed metadata', () => {
  const project = 'C:\\Users\\student\\project';
  const issue = sanitizeIssue({
    category: 'network', severity: 'warning', message: `token=bad failed at ${project}\u0000`,
    metadata: { url: 'http://127.0.0.1:4173/api', arbitrary: 'not allowed', statusCode: 500 },
  }, project);
  assert.equal(issue.category, 'network');
  assert.equal(issue.severity, 'warning');
  assert.match(issue.message, /token=\[redacted\]/);
  assert.match(issue.message, /\[(?:project|path)\]/);
  assert.deepEqual(issue.metadata, { url: 'http://127.0.0.1:4173/api', statusCode: '500' });
  assert.equal(sanitizeIssue({ category: 'unknown', severity: 'fatal', message: 'x' }).category, 'runtime');
});

test('preview console issues use central redaction before storage or copy', () => {
  const issue = sanitizeIssue({
    category: 'runtime', severity: 'error',
    message: '{"access_token":"private-access","refresh_token":"private-refresh","prompt":"private prompt","code":"private code"} Authorization: Basic dXNlcjpwYXNz Cookie: session=private user@example.com C:\\Users\\Jane Doe\\Private Project\\app.js',
    metadata: { code: 'private metadata code', prompt: 'private metadata prompt' },
  });
  const serialized = JSON.stringify(issue);
  for (const forbidden of ['private-access', 'private-refresh', 'private prompt', 'private code', 'dXNlcjpwYXNz', 'session=private', 'user@example.com', 'Jane Doe', 'Private Project']) assert.doesNotMatch(serialized, new RegExp(forbidden));
  assert.deepEqual(issue.metadata, {});
});

test('watcher guards ignore generated trees and expose relative paths only', () => {
  const root = path.resolve('C:\\workspace\\sample');
  assert.equal(safeRelativeProjectPath(root, path.join(root, 'src', 'App.jsx')), 'src/App.jsx');
  assert.equal(safeRelativeProjectPath(root, path.resolve(root, '..', 'secret.txt')), null);
  assert.equal(isIgnoredWatchPath('src/App.jsx'), false);
  for (const target of ['node_modules/pkg/a.js', '.git/index', 'web/dist/app.js', 'build/output']) assert.equal(isIgnoredWatchPath(target), true, target);
});

test('Android control builders accept only fixed actions and validated serials', () => {
  assert.deepEqual(previewCommands.buildAdbDisableAccelerometerArgs('emulator-5554'), ['-s', 'emulator-5554', 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
  assert.deepEqual(previewCommands.buildAdbRotationCommands('emulator-5554', 'landscape'), [
    ['-s', 'emulator-5554', 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'],
    ['-s', 'emulator-5554', 'shell', 'settings', 'put', 'system', 'user_rotation', '1'],
  ]);
  assert.deepEqual(buildAdbRotationArgs('emulator-5554', 'portrait'), ['-s', 'emulator-5554', 'shell', 'settings', 'put', 'system', 'user_rotation', '0']);
  assert.deepEqual(buildAdbRotationArgs('emulator-5554', 'landscape').slice(-1), ['1']);
  assert.deepEqual(buildAdbScreenshotArgs('emulator-5554'), ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p']);
  assert.throws(() => buildAdbRotationArgs('device;calc', 'portrait'), /Invalid/);
  assert.throws(() => buildAdbRotationArgs('emulator-5554', 'reverse'), /Invalid/);
});

test('artifact paths stay in project-local hidden directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-artifact-'));
  try {
    const target = safeArtifactPath(root, 'snapshots', 'web-preview', 'png', new Date('2026-01-02T03:04:05.000Z'));
    assert.equal(safeRelativeProjectPath(root, target), '.vibe/snapshots/web-preview-2026-01-02T03-04-05-000Z.png');
    assert.equal(fs.statSync(path.dirname(target)).isDirectory(), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
