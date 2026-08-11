const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { LearningViewManager, isTrustedLearningUrl } = require('../electron/services/learningViewManager');

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.session = new EventEmitter();
    this.session.setPermissionCheckHandler = (handler) => { this.permissionCheck = handler; };
    this.session.setPermissionRequestHandler = (handler) => { this.permissionRequest = handler; };
    this.session.clearStorageData = async () => {};
  }

  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  async loadURL(url) { this.loadedUrl = url; }
  isDestroyed() { return this.destroyed; }
  close() { this.destroyed = true; }
}

class FakeWebContentsView {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.webContents = new FakeWebContents();
    FakeWebContentsView.instances.push(this);
  }

  setBounds(bounds) { this.bounds = bounds; }
}

function createHost() {
  const host = new EventEmitter();
  host.destroyed = false;
  host.isDestroyed = () => host.destroyed;
  host.getContentBounds = () => ({ width: 1400, height: 900 });
  host.webContents = { send: (channel, state) => host.events.push([channel, state]) };
  host.events = [];
  host.contentView = {
    addChildView: (view) => { host.child = view; },
    removeChildView: (view) => { if (host.child === view) host.child = null; },
  };
  return host;
}

test('learning view uses an ephemeral sandbox and never returns the handoff URL', async () => {
  FakeWebContentsView.instances.length = 0;
  const host = createHost();
  const code = 'A'.repeat(43);
  const manager = new LearningViewManager({
    WebContentsView: FakeWebContentsView,
    authService: { prepareLearning: async () => ({ target: `https://vibe-ide-code.vercel.app/learn/handoff#code=${code}`, handoff: true }) },
    getMainWindow: () => host,
  });

  const result = await manager.open();
  const view = FakeWebContentsView.instances[0];
  assert.deepEqual(result, { ok: true, handoff: true });
  assert.equal(JSON.stringify(result).includes(code), false);
  assert.match(view.options.webPreferences.partition, /^vibe-learning-/);
  assert.equal(view.options.webPreferences.partition.startsWith('persist:'), false);
  assert.deepEqual(view.bounds, { x: 72, y: 40, width: 1328, height: 860 });
  assert.equal(view.webContents.permissionCheck(), false);
  let permissionGranted = true;
  view.webContents.permissionRequest(null, null, (value) => { permissionGranted = value; });
  assert.equal(permissionGranted, false);
  assert.deepEqual(view.webContents.windowOpenHandler({ url: 'https://attacker.test' }), { action: 'deny' });

  manager.close();
  assert.equal(view.webContents.destroyed, true);
  assert.equal(host.child, null);
});

test('learning top-level navigation accepts only the canonical origin', () => {
  assert.equal(isTrustedLearningUrl('https://vibe-ide-code.vercel.app/learn'), true);
  assert.equal(isTrustedLearningUrl('https://vibe-ide-code.vercel.app.evil.test/learn'), false);
  assert.equal(isTrustedLearningUrl('http://vibe-ide-code.vercel.app/learn'), false);
  assert.equal(isTrustedLearningUrl('https://user:pass@vibe-ide-code.vercel.app/learn'), false);
});

test('learning manager exposes only a stable error when preparation fails', async () => {
  const host = createHost();
  const manager = new LearningViewManager({
    WebContentsView: FakeWebContentsView,
    authService: { prepareLearning: async () => { throw new Error('private handoff failure'); } },
    getMainWindow: () => host,
  });
  assert.deepEqual(await manager.open(), {
    ok: false,
    error: { code: 'AUTH_LEARNING_OPEN_FAILED', message: 'The learning platform could not be opened.' },
  });
});
