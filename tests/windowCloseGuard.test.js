const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { installCloseGuard, prepareWindowForUpdateInstall } = require('../electron/ipc/windowManager');

test('native close requests renderer confirmation once and approved close does not loop', () => {
  const window = new EventEmitter();
  const sent = [];
  window.webContents = { send: (channel) => sent.push(channel) };
  installCloseGuard(window);

  let prevented = false;
  window.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(sent, ['window:close-requested']);

  window.__vibeCloseApproved = true;
  prevented = false;
  window.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.deepEqual(sent, ['window:close-requested']);
});

test('close guard is installed once on every recreated BrowserWindow', () => {
  const first = new EventEmitter();
  const second = new EventEmitter();
  first.webContents = { send() {} };
  second.webContents = { send() {} };
  installCloseGuard(first);
  installCloseGuard(first);
  installCloseGuard(second);
  assert.equal(first.listenerCount('close'), 1);
  assert.equal(second.listenerCount('close'), 1);
});

test('update installation explicitly bypasses and can restore the native close guard', () => {
  const window = new EventEmitter();
  window.webContents = { send() {} };
  window.isDestroyed = () => false;
  installCloseGuard(window);

  const revoke = prepareWindowForUpdateInstall(window);
  let prevented = false;
  window.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, false);

  revoke();
  window.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});
