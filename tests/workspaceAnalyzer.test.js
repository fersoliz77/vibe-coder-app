const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { analyzeWorkspace } = require('../electron/services/workspaceAnalyzer');

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-workspace-'));
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test('detects multiple web and Flutter applications without executing project code', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ private: true, workspaces: ['apps/*'], packageManager: 'pnpm@9.0.0' }));
    write(root, 'turbo.json', '{}');
    write(root, 'apps/admin/package.json', JSON.stringify({ name: 'admin', scripts: { dev: 'next dev' }, dependencies: { next: '15.0.0', react: '19.0.0' }, devDependencies: { typescript: '5.0.0' } }));
    write(root, 'apps/store/package.json', JSON.stringify({ name: 'store', scripts: { dev: 'vite' }, dependencies: { react: '19.0.0' }, devDependencies: { vite: '6.0.0' } }));
    write(root, 'apps/mobile/pubspec.yaml', 'name: mobile\ndependencies:\n  flutter:\n    sdk: flutter\n');
    write(root, 'apps/mobile/android/.keep', '');
    const result = await analyzeWorkspace(root);
    assert.equal(result.layout, 'workspace');
    assert.equal(result.targets.length, 4);
    assert.equal(result.targets.find((target) => target.name === 'admin').framework, 'Next.js');
    assert.equal(result.targets.find((target) => target.name === 'store').capabilities.webPreview, true);
    assert.equal(result.targets.find((target) => target.name === 'mobile').capabilities.androidPreview, true);
    assert.deepEqual(result.packageManagers, ['pnpm']);
    assert.ok(result.workspaceSignals.includes('Turborepo'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('recognizes backend, deployment, and container markers without reading secrets', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ name: 'api', dependencies: { express: '5', '@supabase/supabase-js': '2' } }));
    write(root, 'firebase.json', '{}');
    write(root, 'vercel.json', '{}');
    write(root, 'Dockerfile', 'FROM node:22');
    write(root, '.env', 'SECRET=do-not-read');
    const result = await analyzeWorkspace(root);
    assert.ok(result.services.includes('Firebase'));
    assert.ok(result.services.includes('Vercel'));
    assert.ok(result.services.includes('Docker'));
    assert.doesNotMatch(JSON.stringify(result), /do-not-read/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('returns a generic usable workspace for unknown folders', async () => {
  const root = fixture();
  try {
    write(root, 'README.md', '# Existing project');
    const result = await analyzeWorkspace(root);
    assert.equal(result.layout, 'unknown');
    assert.equal(result.targets[0].kind, 'generic');
    assert.equal(result.targets[0].capabilities.terminal, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('malformed manifests and linked paths produce bounded warnings', async () => {
  const root = fixture();
  const outside = fixture();
  try {
    write(root, 'package.json', '{bad json');
    try { fs.symlinkSync(outside, path.join(root, 'linked'), 'junction'); } catch {}
    const result = await analyzeWorkspace(root);
    assert.ok(result.warnings.some((warning) => warning.code === 'MALFORMED_MANIFEST'));
    if (fs.existsSync(path.join(root, 'linked'))) assert.ok(result.warnings.some((warning) => warning.code === 'LINK_SKIPPED'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('scan limits return deterministic partial results instead of failing', async () => {
  const root = fixture();
  try {
    for (let index = 0; index < 20; index += 1) write(root, `apps/app-${index}/package.json`, JSON.stringify({ name: `app-${index}` }));
    const result = await analyzeWorkspace(root, { maxEntries: 5 });
    assert.equal(result.complete, false);
    assert.ok(result.stats.entriesVisited <= 5);
    assert.ok(result.warnings.some((warning) => warning.code === 'SCAN_LIMIT'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('audits readiness without returning environment values or script bodies', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({
      name: 'reviewed-app',
      packageManager: 'pnpm@9.12.0',
      engines: { node: '>=22' },
      scripts: { dev: 'vite --host 0.0.0.0', build: 'secret-build-command', test: 'node --test' },
      dependencies: { react: '19.0.0' },
      devDependencies: { vite: '6.0.0', typescript: '5.0.0' },
    }));
    write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9');
    write(root, '.env.example', 'VITE_API_URL=https://example.invalid\nPRIVATE_TOKEN=example-secret');
    write(root, '.env.local', 'VITE_API_URL=https://real.invalid\nPRIVATE_TOKEN=real-secret');
    write(root, 'src/config.ts', 'export const url = import.meta.env.VITE_API_URL; const key = process.env.SERVER_KEY;');
    fs.mkdirSync(path.join(root, '.git'));

    const result = await analyzeWorkspace(root);
    const serialized = JSON.stringify(result);
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.projectAssessment.classification, 'project');
    assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(result.git.detected, true);
    assert.ok(result.scripts.some((script) => script.name === 'build' && script.category === 'build'));
    assert.ok(result.dependencies[0].groups.some((group) => group.packageNames.includes('react')));
    assert.ok(result.environment.names.some((item) => item.name === 'SERVER_KEY'));
    assert.equal(result.environment.names.find((item) => item.name === 'VITE_API_URL').configuredLocally, true);
    assert.equal(result.environment.valuesStored, false);
    assert.equal(result.environment.valuesReturned, false);
    assert.ok(result.runtimes.some((item) => item.runtime === 'node' && item.declaredRange === '>=22'));
    assert.doesNotMatch(serialized, /real-secret|example-secret|secret-build-command|https:\/\/real\.invalid/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('decision fingerprint changes when a preview capability appears', async () => {
  const root = fixture();
  try {
    write(root, 'pubspec.yaml', 'name: mobile\ndependencies:\n  flutter:\n    sdk: flutter\n');
    const before = await analyzeWorkspace(root);
    assert.equal(before.targets[0].capabilities.androidPreview, false);
    write(root, 'android/.keep', '');
    const after = await analyzeWorkspace(root);
    assert.equal(after.targets[0].capabilities.androidPreview, true);
    assert.notEqual(after.fingerprint, before.fingerprint);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unknown folders require explicit confirmation and manifest changes invalidate the fingerprint', async () => {
  const root = fixture();
  try {
    write(root, 'README.md', '# Notes');
    const unknown = await analyzeWorkspace(root);
    assert.equal(unknown.projectAssessment.classification, 'folder');
    assert.equal(unknown.projectAssessment.requiresAcknowledgement, true);
    assert.equal(unknown.readiness.status, 'not-a-project');

    write(root, 'package.json', JSON.stringify({ name: 'now-a-project', dependencies: { react: '19' } }));
    const detected = await analyzeWorkspace(root);
    assert.notEqual(detected.fingerprint, unknown.fingerprint);
    assert.equal(detected.projectAssessment.classification, 'project');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
