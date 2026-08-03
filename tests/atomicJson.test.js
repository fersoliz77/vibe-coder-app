const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeJsonAtomic } = require('../electron/services/atomicJson');

test('atomic JSON writer replaces valid documents without leaving temporary files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-json-'));
  const target = path.join(directory, 'config.json');
  try {
    writeJsonAtomic(target, { first: true });
    writeJsonAtomic(target, { second: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { second: true });
    assert.deepEqual(fs.readdirSync(directory), ['config.json']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
