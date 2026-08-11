const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acknowledgeProjectRecovery, getProjectRecoveryState, getProjects, initProjectManager, registerProject } = require('../electron/services/projectManager');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value));
}

test('a corrupt project registry is preserved and restored from the last valid backup', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-project-recovery-'));
  const firstPath = path.join(userDataPath, 'first');
  const secondPath = path.join(userDataPath, 'second');
  fs.mkdirSync(firstPath);
  fs.mkdirSync(secondPath);
  try {
    writeJson(path.join(userDataPath, 'projects.json'), [{ id: 'proj_first', name: 'First', path: firstPath, createdAt: 1, lastOpened: 1 }]);
    initProjectManager({ userDataPath });
    registerProject(secondPath, { name: 'Second' });
    assert.equal(fs.existsSync(path.join(userDataPath, 'projects.backup.json')), true);

    fs.writeFileSync(path.join(userDataPath, 'projects.json'), '{broken json');
    initProjectManager({ userDataPath });
    assert.equal(fs.readFileSync(path.join(userDataPath, 'projects.corrupt.json'), 'utf8'), '{broken json');
    assert.deepEqual(getProjects().map((project) => project.id), ['proj_first']);
    assert.equal(getProjectRecoveryState().status, 'recovered');
    acknowledgeProjectRecovery();
    assert.equal(getProjectRecoveryState(), null);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('automatic metadata repair keeps an exact before-repair copy', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-project-repair-'));
  const projectPath = path.join(userDataPath, 'valid');
  fs.mkdirSync(projectPath);
  const original = [
    { id: 'proj_valid', name: 'Valid', path: projectPath, unknown: 'remove-me' },
    { id: '', name: 'Broken', path: projectPath },
  ];
  try {
    writeJson(path.join(userDataPath, 'projects.json'), original);
    initProjectManager({ userDataPath });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userDataPath, 'projects.before-repair.json'), 'utf8')), original);
    assert.equal(getProjects().length, 1);
    assert.equal(getProjects()[0].unknown, undefined);
    assert.equal(getProjectRecoveryState().status, 'repaired');
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
