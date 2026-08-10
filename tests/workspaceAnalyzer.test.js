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
    assert.ok(result.warnings.some((warning) => warning.code === 'SCAN_LIMIT'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
