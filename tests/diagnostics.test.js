const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiagnosticsLogger, recordUnhandledRejection, sanitize, sanitizeString } = require('../electron/diagnostics/logger');
const { EXPORT_COOLDOWN_MS, REPORT_VERSION, createReport, setupDiagnosticsHandlers } = require('../electron/diagnostics/reportManager');

test('diagnostic redaction centrally removes credentials, identities, paths, prompts, and code', () => {
  const input = {
    token: 'top-secret-token',
    prompt: 'write all the code',
    code: 'const privateValue = true;',
    nested: {
      note: 'user@example.com Bearer abc.def.ghi token=visible C:\\Users\\private\\project\\app.js',
      jwt: 'eyJabcdefghijklmno.abcdefghijklmnop.abcdefghijklmnop',
      errorCode: 'ENOENT',
    },
  };
  const clean = sanitize(input);
  const serialized = JSON.stringify(clean);

  assert.equal(clean.token, '[redacted]');
  assert.equal(clean.prompt, '[redacted]');
  assert.equal(clean.code, '[redacted]');
  assert.equal(clean.nested.errorCode, 'ENOENT');
  for (const forbidden of ['top-secret-token', 'write all the code', 'privateValue', 'user@example.com', 'abc.def.ghi', 'visible', 'private\\project', 'eyJabcdefghijklmno']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('string redaction handles quoted JSON, auth schemes, cookies, provider keys, and paths with spaces', () => {
  const dirty = [
    '{"access_token":"access-value","refresh_token":"refresh-value","prompt":"private prompt","code":"private code"}',
    'Authorization: Basic dXNlcjpwYXNz',
    'Cookie: session=private-cookie; refresh=private-refresh',
    'OPENAI_API_KEY="sk-provider-secret-value" ANTHROPIC_API_KEY=anthropic-secret',
    'failed at C:\\Users\\Jane Doe\\My Private Project\\src\\app.js',
  ].join('\n');
  const clean = sanitizeString(dirty);
  for (const forbidden of ['access-value', 'refresh-value', 'private prompt', 'private code', 'dXNlcjpwYXNz', 'private-cookie', 'private-refresh', 'sk-provider', 'anthropic-secret', 'Jane Doe', 'My Private Project']) {
    assert.doesNotMatch(clean, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(clean, /"access_token":"\[redacted\]"/);
  assert.match(clean, /\[path\]/);
  const boundarySecret = sanitizeString(`${'x'.repeat(490)} Authorization: Bearer secret-value-that-crosses-the-limit`);
  assert.equal(boundarySecret.length <= 500, true);
  assert.doesNotMatch(boundarySecret, /secret-value|Bearer/);
});

test('string sanitization accepts an explicit limit while diagnostics retain the 500 default', () => {
  assert.equal(sanitizeString('x'.repeat(900)).length, 500);
  assert.equal(sanitizeString('x'.repeat(900), 800).length, 800);
  assert.equal(sanitizeString('secret=private ' + 'x'.repeat(900), 800).includes('private'), false);
});

test('diagnostic logger keeps only the configured newest events', () => {
  const logger = createDiagnosticsLogger({ capacity: 3, now: () => new Date('2026-08-02T12:00:00.000Z') });
  for (let index = 1; index <= 5; index += 1) logger.log('test', 'event', { index });
  assert.deepEqual(logger.getEvents().map((entry) => entry.details.index), [3, 4, 5]);
  assert.equal(logger.capacity, 3);
});

test('diagnostic report follows the local support contract without account identity', () => {
  const logger = createDiagnosticsLogger({ capacity: 5 });
  logger.setState('preview-web', { state: 'error', projectPath: 'C:\\Users\\private\\secret-project' });
  logger.log('ai', 'run-start', { provider: 'openai', runId: 42, prompt: 'private request', output: 'private code' });
  const report = createReport({
    diagnostics: logger,
    authService: { getState: () => ({
      policy: 'restricted', restrictionReason: 'ACCOUNT_RESTRICTED', authenticated: true,
      configurationReady: true, user: { email: 'private@example.com' },
    }) },
    appVersion: '1.2.3', platform: 'win32', arch: 'x64', release: 'test-release',
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.reportVersion, REPORT_VERSION);
  assert.deepEqual(report.application, { version: '1.2.3' });
  assert.deepEqual(report.platform, { name: 'win32', arch: 'x64', release: 'test-release' });
  assert.equal(report.policy.value, 'restricted');
  assert.equal(report.events[0].details.runId, 42);
  assert.doesNotMatch(serialized, /private request|private code|private@example|secret-project/);
  assert.equal(Object.hasOwn(report.policy, 'user'), false);
});

test('unhandled rejection logging preserves fail-fast behavior', () => {
  const logger = createDiagnosticsLogger();
  const failure = new Error('private failure text');
  assert.throws(() => recordUnhandledRejection(logger, failure), (error) => error === failure);
  assert.equal(logger.getEvents()[0].details.category, 'unhandled-rejection');
  assert.doesNotMatch(JSON.stringify(logger.getEvents()), /private failure text/);
});

test('diagnostic export validates sender and serializes and rate-limits dialogs', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const webContents = {};
  const mainWindow = { webContents, isDestroyed: () => false };
  const logger = createDiagnosticsLogger();
  let time = 10_000;
  let resolveDialog;
  let dialogCalls = 0;
  setupDiagnosticsHandlers(ipcMain, () => mainWindow, logger, { getState: () => ({ policy: 'denied' }) }, {
    now: () => time,
    showSaveDialog: () => { dialogCalls += 1; return new Promise((resolve) => { resolveDialog = resolve; }); },
    writeFile: async () => {},
    reportOptions: { appVersion: '1.0.0', platform: 'win32', arch: 'x64', release: 'test' },
  });
  const handler = handlers.get('diagnostics:export');

  await assert.rejects(() => handler({ sender: {} }), (error) => error.code === 'DIAGNOSTICS_INVALID_SENDER');
  const first = handler({ sender: webContents });
  assert.deepEqual(await handler({ sender: webContents }), { exported: false, canceled: false, busy: true });
  assert.equal(dialogCalls, 1);
  resolveDialog({ canceled: true });
  assert.deepEqual(await first, { exported: false, canceled: true });
  assert.deepEqual(await handler({ sender: webContents }), { exported: false, canceled: false, rateLimited: true });
  time += EXPORT_COOLDOWN_MS;
  const next = handler({ sender: webContents });
  assert.equal(dialogCalls, 2);
  resolveDialog({ canceled: true });
  await next;
});
