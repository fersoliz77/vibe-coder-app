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

  let closeRequested = false;
  const unsubscribe = exposed.electronAPI.window.onCloseRequested(() => { closeRequested = true; });
  ipcRenderer.emit('window:close-requested', {});
  assert.equal(closeRequested, true);
  unsubscribe();
});
