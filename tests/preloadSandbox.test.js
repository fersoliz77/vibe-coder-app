const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

test('sandboxed preload loads using only Electron and exposes a working bridge', async () => {
  const ipcRenderer = new EventEmitter();
  const calls = [];
  ipcRenderer.invoke = async (...args) => { calls.push(['invoke', ...args]); return 'ok'; };
  ipcRenderer.send = (...args) => calls.push(['send', ...args]);
  const exposed = {};
  const contextBridge = { exposeInMainWorld(name, value) { exposed[name] = value; } };
  const requestedModules = [];
  const sandbox = {
    process: { platform: 'win32' },
    require(name) {
      requestedModules.push(name);
      if (name === 'electron') return { contextBridge, ipcRenderer };
      throw new Error(`Unsupported sandbox preload module: ${name}`);
    },
  };
  const code = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'preload.js' });

  assert.deepEqual(requestedModules, ['electron']);
  assert.equal(exposed.electronAPI.system.platform, 'win32');
  assert.equal(await exposed.electronAPI.store.get('key', null), 'ok');
  assert.deepEqual(calls[0], ['invoke', 'store:get', 'key', null]);
  assert.equal(await exposed.electronAPI.diagnostics.exportReport(), 'ok');
  assert.deepEqual(calls[1], ['invoke', 'diagnostics:export']);
  assert.equal(await exposed.electronAPI.auth.google(), 'ok');
  assert.deepEqual(calls[2], ['invoke', 'auth:google']);
  assert.equal(await exposed.electronAPI.updates.check(), 'ok');
  assert.deepEqual(calls[3], ['invoke', 'updates:check']);
  assert.equal(await exposed.electronAPI.updates.getHistory(), 'ok');
  assert.deepEqual(calls[4], ['invoke', 'updates:get-history']);
  assert.equal(await exposed.electronAPI.updates.download(), 'ok');
  assert.deepEqual(calls[5], ['invoke', 'updates:download']);
  assert.equal(await exposed.electronAPI.updates.install(), 'ok');
  assert.deepEqual(calls[6], ['invoke', 'updates:install']);
  assert.equal(await exposed.electronAPI.requirements.preview('project-id', 'requirement-id'), 'ok');
  assert.deepEqual(calls[7], ['invoke', 'requirements:preview', 'project-id', 'requirement-id']);
  assert.equal(await exposed.electronAPI.requirements.apply('grant-id', 'nonce'), 'ok');
  assert.deepEqual(calls[8], ['invoke', 'requirements:apply', 'grant-id', 'nonce']);

  let requirementProgress;
  const unsubscribeRequirementProgress = exposed.electronAPI.requirements.onProgress((progress) => { requirementProgress = progress; });
  ipcRenderer.emit('requirements:progress', {}, { projectId: 'project-id', stage: 'installing', percent: 45 });
  assert.equal(requirementProgress.percent, 45);
  unsubscribeRequirementProgress();
  assert.equal(await exposed.electronAPI.requirements.retry('retry-id'), 'ok');
  assert.deepEqual(calls.at(-1), ['invoke', 'requirements:retry', 'retry-id']);
  assert.equal(await exposed.electronAPI.projects.getRecoveryState(), 'ok');
  assert.deepEqual(calls.at(-1), ['invoke', 'projects:get-recovery-state']);

  let closeRequested = false;
  const unsubscribe = exposed.electronAPI.window.onCloseRequested(() => { closeRequested = true; });
  ipcRenderer.emit('window:close-requested', {});
  assert.equal(closeRequested, true);
  unsubscribe();

  let updateState;
  const unsubscribeUpdate = exposed.electronAPI.updates.onStateChanged((state) => { updateState = state; });
  ipcRenderer.emit('updates:state-changed', {}, { status: 'available', mandatory: true, blocking: true });
  assert.equal(updateState.status, 'available');
  unsubscribeUpdate();
});
