const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  UpdateManager,
  buildFeed,
  setupUpdateHandlers,
} = require('../electron/services/updateManager');
const { installIpcAuthorization } = require('../electron/auth/ipcGuard');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(options = {}) {
  const updater = new EventEmitter();
  updater.feeds = [];
  updater.setFeedURL = (feed) => { updater.feeds.push(feed); };
  updater.checkForUpdates = options.checkForUpdates || (async () => ({ isUpdateAvailable: false }));
  updater.downloadUpdate = options.downloadUpdate || (async () => []);
  updater.quitAndInstall = (...args) => { updater.installArgs = args; };
  const authService = {
    policy: 'active',
    getPolicy() { return this.policy; },
    getUpdateCredentials() {
      return {
        updateUrl: 'https://updates.example.test',
        accessToken: 'secret-access-token',
        apiKey: 'secret-api-key',
        channel: 'stable',
      };
    },
  };
  const sent = [];
  const window = {
    webContents: { send: (...args) => sent.push(args) },
    isDestroyed: () => false,
  };
  let prepared = 0;
  let revoked = 0;
  const manager = new UpdateManager({
    app: { isPackaged: options.isPackaged !== false, getVersion: () => options.appVersion || '1.0.0' },
    platform: options.platform || 'win32',
    updater,
    authService,
    getMainWindow: () => window,
    prepareWindowForUpdateInstall: () => {
      prepared += 1;
      return () => { revoked += 1; };
    },
    statePath: options.statePath ?? null,
    persistRequirement: options.persistRequirement,
    verifyUpdate: options.verifyUpdate || (() => true),
  });
  return { updater, authService, manager, sent, get prepared() { return prepared; }, get revoked() { return revoked; } };
}

test('private generic feed is encoded and carries the Supabase auth headers', () => {
  assert.deepEqual(buildFeed({
    updateUrl: 'https://updates.example.test/',
    accessToken: 'access',
    apiKey: 'anon',
    channel: 'stable/beta',
  }), {
    url: 'https://updates.example.test/stable%2Fbeta',
    headers: { Authorization: 'Bearer access', apikey: 'anon' },
  });
  assert.throws(() => buildFeed({
    updateUrl: 'http://unsafe.test',
    accessToken: 'access',
    apiKey: 'anon',
    channel: 'stable',
  }), (error) => error.code === 'UPDATE_CREDENTIALS_INVALID');
});

test('only packaged Windows initializes electron-updater', async () => {
  for (const options of [{ isPackaged: false }, { platform: 'darwin' }]) {
    const harness = createHarness(options);
    await harness.manager.handleAuthState({ policy: 'active' });
    assert.equal(harness.manager.getState().status, 'disabled');
    assert.equal(harness.updater.listenerCount('error'), 0);
    assert.equal(harness.updater.feeds.length, 0);
  }
});

test('active access configures conservative updater flags and reports current safely', async () => {
  const harness = createHarness();
  const state = await harness.manager.handleAuthState({ policy: 'active' });

  assert.equal(state.status, 'current');
  assert.equal(state.mandatory, false);
  assert.equal(state.blocking, false);
  assert.equal(harness.updater.autoDownload, false);
  assert.equal(harness.updater.autoInstallOnAppQuit, false);
  assert.equal(harness.updater.allowPrerelease, false);
  assert.equal(harness.updater.allowDowngrade, false);
  assert.equal(harness.updater.logger, null);
  assert.equal(harness.updater.feeds[0].provider, 'generic');
  assert.equal(harness.updater.feeds[0].url, 'https://updates.example.test/stable');
  assert.deepEqual(harness.updater.feeds[0].requestHeaders, {
    Authorization: 'Bearer secret-access-token',
    apikey: 'secret-api-key',
  });
  assert.equal(JSON.stringify(state).includes('secret'), false);
  assert.equal(harness.sent.every(([channel]) => channel === 'updates:state-changed'), true);
});

test('every available update blocks until download and explicit coordinated install', async () => {
  const cancellationToken = { cancel() {} };
  const harness = createHarness({
    checkForUpdates: async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: '2.4.1', files: [{ url: 'https://private/file.exe' }] },
      cancellationToken,
    }),
    downloadUpdate: async (receivedToken) => {
      assert.equal(receivedToken, cancellationToken);
      harness.updater.emit('download-progress', {
        percent: 41.5,
        bytesPerSecond: 500,
        transferred: 100,
        total: 240,
      });
      return ['C:\\private\\update.exe'];
    },
  });

  const available = await harness.manager.handleAuthState({ policy: 'active' });
  const { revision, ...availableState } = available;
  assert.ok(revision > 0);
  assert.deepEqual(availableState, {
    status: 'available', mandatory: true, blocking: true, version: '2.4.1', progress: null, error: null,
  });
  const downloaded = await harness.manager.download();
  assert.equal(downloaded.status, 'downloaded');
  assert.equal(downloaded.blocking, true);
  assert.equal(JSON.stringify(downloaded).includes('private'), false);

  harness.manager.install();
  assert.equal(harness.prepared, 1);
  assert.deepEqual(harness.updater.installArgs, [true, true]);
  assert.throws(() => harness.manager.install(), (error) => error.code === 'UPDATE_STATE_INVALID');
});

test('check failures before update knowledge do not block', async () => {
  const harness = createHarness({ checkForUpdates: async () => { throw new Error('https://private/token'); } });
  const state = await harness.manager.handleAuthState({ policy: 'active' });

  assert.equal(state.status, 'error');
  assert.equal(state.mandatory, false);
  assert.equal(state.blocking, false);
  assert.equal(JSON.stringify(state).includes('private'), false);
});

test('unsigned update metadata is rejected before an update can be offered', async () => {
  const harness = createHarness({
    verifyUpdate: () => false,
    checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: '8.0.0' } }),
  });
  const state = await harness.manager.handleAuthState({ policy: 'active' });
  assert.equal(state.status, 'error');
  assert.equal(state.mandatory, false);
  assert.equal(harness.manager.knownVersion, null);
});

test('a discovered requirement survives restart and cannot fail open', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-update-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'requirement.json');
  const first = createHarness({
    statePath,
    checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: '5.0.0' } }),
  });
  await first.manager.handleAuthState({ policy: 'active' });
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), { requiredVersion: '5.0.0' });

  const restarted = createHarness({
    statePath,
    checkForUpdates: async () => { throw new Error('offline'); },
  });
  const blocked = await restarted.manager.handleAuthState({ policy: 'active' });
  assert.equal(blocked.status, 'error');
  assert.equal(blocked.mandatory, true);
  assert.equal(blocked.version, '5.0.0');

  const upgraded = createHarness({ statePath, appVersion: '5.0.0' });
  await upgraded.manager.handleAuthState({ policy: 'active' });
  assert.equal(fs.existsSync(statePath), false);
  assert.equal(upgraded.manager.getState().mandatory, false);
});

test('persistence is retried for the same required version after a transient write failure', async () => {
  let attempts = 0;
  let persisted = null;
  const harness = createHarness({
    statePath: 'virtual-requirement.json',
    persistRequirement: (_filePath, value) => {
      attempts += 1;
      if (attempts === 1) throw new Error('disk temporarily unavailable');
      persisted = value;
    },
    checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: '6.0.0' } }),
  });
  const first = await harness.manager.handleAuthState({ policy: 'active' });
  assert.equal(first.mandatory, true);
  assert.equal(first.status, 'error');
  const second = await harness.manager.check(true);
  assert.equal(second.status, 'available');
  assert.deepEqual(persisted, { requiredVersion: '6.0.0' });
  assert.equal(attempts, 2);
});

test('an unreadable requirement fails closed until a successful authoritative check', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-corrupt-update-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'requirement.json');
  fs.writeFileSync(statePath, '{broken');
  const offline = createHarness({ statePath, checkForUpdates: async () => { throw new Error('offline'); } });
  const blocked = await offline.manager.handleAuthState({ policy: 'active' });
  assert.equal(blocked.mandatory, true);
  assert.equal(blocked.status, 'error');

  const online = createHarness({ statePath, checkForUpdates: async () => ({ isUpdateAvailable: false }) });
  const current = await online.manager.handleAuthState({ policy: 'active' });
  assert.equal(current.status, 'current');
  assert.equal(current.mandatory, false);
  assert.equal(fs.existsSync(statePath), false);
});

test('download failures after update knowledge remain mandatory and retryable', async () => {
  let downloads = 0;
  const harness = createHarness({
    checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: '3.0.0' } }),
    downloadUpdate: async () => {
      downloads += 1;
      if (downloads === 1) throw new Error('C:\\secret\\installer.exe');
      return [];
    },
  });
  await harness.manager.handleAuthState({ policy: 'active' });

  const failed = await harness.manager.download();
  assert.equal(failed.status, 'error');
  assert.equal(failed.mandatory, true);
  assert.equal(failed.blocking, true);
  assert.equal(JSON.stringify(failed).includes('secret'), false);
  assert.equal((await harness.manager.download()).status, 'downloaded');
});

test('losing access cancels work, clears headers, blocks operations, and ignores stale completion', async () => {
  const check = deferred();
  let cancelled = false;
  const harness = createHarness({ checkForUpdates: () => check.promise });
  const checking = harness.manager.handleAuthState({ policy: 'active' });
  harness.authService.policy = 'restricted';
  await harness.manager.handleAuthState({ policy: 'restricted' });

  assert.equal(harness.manager.getState().status, 'disabled');
  assert.equal(harness.updater.requestHeaders, null);
  assert.equal(harness.updater.feeds.at(-1).url, 'https://updates.invalid/');
  await assert.rejects(harness.manager.download(), (error) => error.code === 'UPDATE_ACCESS_REQUIRED');

  check.resolve({
    isUpdateAvailable: true,
    updateInfo: { version: '9.0.0' },
    cancellationToken: { cancel() { cancelled = true; } },
  });
  await checking;
  assert.equal(cancelled, false);
  assert.equal(harness.manager.getState().status, 'disabled');
});

test('access loss after discovery preserves mandatory blocking and cancels a download token', async () => {
  let cancelled = false;
  const download = deferred();
  const harness = createHarness({
    checkForUpdates: async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: '4.0.0' },
      cancellationToken: { cancel() { cancelled = true; } },
    }),
    downloadUpdate: () => download.promise,
  });
  await harness.manager.handleAuthState({ policy: 'active' });
  const downloading = harness.manager.download();
  harness.authService.policy = 'denied';
  const disabled = await harness.manager.handleAuthState({ policy: 'denied' });

  assert.equal(cancelled, true);
  assert.equal(disabled.status, 'disabled');
  assert.equal(disabled.mandatory, true);
  assert.equal(disabled.blocking, true);
  download.resolve([]);
  await downloading;
  assert.equal(harness.manager.getState().status, 'disabled');
});

test('update IPC is main-frame guarded and accepts no renderer feed or token arguments', async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    on() {},
  };
  const mainFrame = {};
  const webContents = { mainFrame };
  const window = { webContents, isDestroyed: () => false };
  let policy = 'denied';
  const calls = [];
  const manager = {
    getState: () => ({ status: 'disabled' }),
    check: (...args) => { calls.push(['check', ...args]); },
    download: (...args) => { calls.push(['download', ...args]); },
    install: (...args) => { calls.push(['install', ...args]); },
  };
  installIpcAuthorization(ipcMain, () => policy, () => window);
  setupUpdateHandlers(ipcMain, manager);
  const trusted = { sender: webContents, senderFrame: mainFrame };

  assert.deepEqual(await handlers.get('updates:get-state')(trusted), { status: 'disabled' });
  assert.throws(() => handlers.get('updates:check')(trusted, 'https://evil', 'token'), (error) => error.code === 'AUTH_POLICY_DENIED');
  policy = 'active';
  await handlers.get('updates:check')(trusted, 'https://evil', 'token');
  assert.deepEqual(calls, [['check']]);
  assert.throws(() => handlers.get('updates:download')({ sender: webContents, senderFrame: {} }), (error) => error.code === 'IPC_INVALID_SENDER');
});
