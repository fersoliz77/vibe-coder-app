const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertSafeEntryName,
  getProjectRelativePath,
  isSubPath,
  resolveProjectChildPath,
  resolveProjectEntryPath,
} = require('../electron/ipc/fsGuards');

test('isSubPath accepts direct children and nested files', () => {
  assert.equal(isSubPath('C:/repo', 'C:/repo/src'), true);
  assert.equal(isSubPath('C:/repo', 'C:/repo/src/index.js'), true);
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
