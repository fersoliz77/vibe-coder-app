const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MAX_SEARCH_FILE_BYTES, MAX_TEXT_BYTES, searchProject } = require('../electron/ipc/fileSystemManager');

test('filesystem limits are explicit and search skips oversized content', async () => {
  assert.equal(MAX_TEXT_BYTES, 2 * 1024 * 1024);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-search-'));
  try {
    fs.writeFileSync(path.join(directory, 'small.txt'), 'find-this safely');
    fs.writeFileSync(path.join(directory, 'large.txt'), Buffer.alloc(MAX_SEARCH_FILE_BYTES + 1, 0x61));
    const result = await searchProject(directory, 'find-this');
    assert.deepEqual(result.contentMatches.map((entry) => entry.name), ['small.txt']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('search includes safe extensionless text and rejects extensionless binary data', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-extensionless-'));
  try {
    for (const name of ['Dockerfile', 'Makefile', 'LICENSE', '.env', 'notes']) {
      fs.writeFileSync(path.join(directory, name), `needle in ${name}`);
    }
    fs.writeFileSync(path.join(directory, 'binary'), Buffer.from([0, 1, 2, 3, 110, 101, 101, 100, 108, 101]));
    const result = await searchProject(directory, 'needle');
    assert.deepEqual(result.contentMatches.map((entry) => entry.name).sort(), ['.env', 'Dockerfile', 'LICENSE', 'Makefile', 'notes'].sort());
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('search never reads a symlinked file outside the project', async (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-search-project-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-search-outside-'));
  try {
    const secret = path.join(outside, 'secret.txt');
    fs.writeFileSync(secret, 'outside-needle');
    try {
      fs.symlinkSync(secret, path.join(project, 'linked.txt'), 'file');
    } catch (error) {
      t.skip(`File symlinks unavailable: ${error.message}`);
      return;
    }
    const result = await searchProject(project, 'outside-needle');
    assert.deepEqual(result.contentMatches, []);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
