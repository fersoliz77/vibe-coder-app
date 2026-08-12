const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertSafeEntryName,
  assertNotProjectRoot,
  getProjectRelativePath,
  isSubPath,
  resolveProjectChildPath,
  resolveProjectEntryPath,
  normalizeProjectRelativePath,
  resolveProjectRelativePath,
  validateProjectCwd,
} = require('../electron/ipc/fsGuards');

test('isSubPath accepts direct children and nested files', () => {
  assert.equal(isSubPath('C:/repo', 'C:/repo/src'), true);
  assert.equal(isSubPath('C:/repo', 'C:/repo/src/index.js'), true);
});

test('project-relative paths are canonical and confined', () => {
  assert.equal(normalizeProjectRelativePath('src/index.js'), 'src/index.js');
  for (const invalid of ['', '../secret', '/secret', 'a//b', 'a/./b', 'C:/secret', 'src\\index.js', 'file.txt:stream']) {
    assert.throws(() => normalizeProjectRelativePath(invalid), /relative path/);
  }
  assert.throws(() => resolveProjectRelativePath('C:/repo', '../secret', () => true), /relative path/);
});

test('isSubPath rejects siblings and parent traversal', () => {
  assert.equal(isSubPath('C:/repo', 'C:/other/file.js'), false);
  assert.equal(isSubPath('C:/repo', 'C:/repo/../secret.txt'), false);
});

test('resolveProjectEntryPath rejects paths outside project', () => {
  assert.throws(() => {
    resolveProjectEntryPath('C:/repo', 'C:/repo/../secret.txt', () => true);
  }, /outside the active project/);
});

test('resolveProjectChildPath rejects unsafe names', () => {
  assert.throws(() => {
    resolveProjectChildPath('C:/repo', 'C:/repo/src', '../hack.js', () => true);
  }, /path separators/);
});

test('assertSafeEntryName accepts simple file names', () => {
  assert.equal(assertSafeEntryName('index.jsx'), 'index.jsx');
});

test('getProjectRelativePath returns git-safe relative path', () => {
  assert.equal(getProjectRelativePath('C:/repo', 'C:/repo/src/index.js'), 'src\\index.js');
});

test('destructive operations reject the project root', () => {
  assert.throws(() => assertNotProjectRoot('C:/repo', 'C:/repo'), /project root/);
  assert.doesNotThrow(() => assertNotProjectRoot('C:/repo', 'C:/repo/src'));
});

test('validateProjectCwd requires a registered existing directory', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-cwd-'));
  try {
    assert.equal(validateProjectCwd(project, (candidate) => candidate === project), project);
    assert.throws(() => validateProjectCwd(project, () => false), /not registered/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('resolveProjectEntryPath rejects directory junction traversal', (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-project-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-outside-'));
  const linked = path.join(project, 'linked');
  try {
    try {
      fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`Symlinks unavailable: ${error.message}`);
      return;
    }
    assert.throws(
      () => resolveProjectEntryPath(project, path.join(linked, 'secret.txt'), () => true),
      /Symbolic links and junctions/
    );
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
