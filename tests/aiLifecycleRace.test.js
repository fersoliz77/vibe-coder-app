const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
const { setupClaudeHandlers } = require('../electron/services/claudeManager');
const { sendChatMessage, setupOpenAIHandlers } = require('../electron/services/openaiManager');

function fakeIpc() {
  const handlers = new Map();
  return { handlers, handle(name, handler) { handlers.set(name, handler); } };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write() {}, end() {} };
  return child;
}

test('Claude cancellation during status preflight prevents process spawn', async () => {
  const ipc = fakeIpc();
  let releaseStatus;
  let spawnCount = 0;
  const status = new Promise((resolve) => { releaseStatus = resolve; });
  const projectPath = path.resolve('C:/race-project');
  setupClaudeHandlers(ipc, () => null, {
    getStatus: () => status,
    validateProjectCwd: () => projectPath,
    spawn: () => { spawnCount += 1; return fakeChild(); },
    killProcessTree() {},
  });
  const pending = ipc.handlers.get('claude:send')({}, 'prompt', projectPath, null, []);
  await Promise.resolve();
  ipc.handlers.get('claude:cancel')({}, null, projectPath);
  releaseStatus({ installed: true, authenticated: true, path: 'claude.exe' });
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal(spawnCount, 0);
});

test('Codex returns run identity immediately and project cleanup cancels it', () => {
  const projectPath = path.resolve('C:/navigation-project');
  const child = fakeChild();
  let killed = null;
  const dependencies = {
    validateProjectCwd: () => projectPath,
    resolveCodexPath: () => 'codex.exe',
    spawn: () => child,
    killProcessTree: (processHandle) => { killed = processHandle; },
  };
  const events = [];
  const mainWindow = { isDestroyed: () => false, webContents: { send: (channel, payload) => events.push({ channel, payload }) } };
  const run = sendChatMessage('prompt', [], null, 'medium', projectPath, mainWindow, dependencies);
  assert.equal(run.success, true);
  assert.equal(typeof run.runId, 'number');
  assert.equal(run.projectPath, projectPath);
  child.stdout.emit('data', Buffer.from('first output'));
  assert.deepEqual(events.map((event) => event.channel), ['openai:started', 'openai:data']);
  assert.equal(events[0].payload.runId, run.runId);

  const ipc = fakeIpc();
  setupOpenAIHandlers(ipc, () => null, dependencies);
  const cancelled = ipc.handlers.get('openai:cancel')({}, run.runId, projectPath);
  assert.equal(cancelled.success, true);
  assert.equal(killed, child);
});
