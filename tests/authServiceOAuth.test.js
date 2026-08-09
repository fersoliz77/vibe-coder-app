const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthService } = require('../electron/auth/authService');

function createService() {
  const service = Object.create(AuthService.prototype);
  service.config = {
    missing: [],
    supabaseUrl: 'https://project.supabase.co',
    anonKey: 'anon',
    accessRpc: 'get_desktop_access',
  };
  service.protocolRegistered = true;
  service.isPackaged = true;
  service.pendingOAuthTransaction = null;
  service.record = null;
  service.lastError = null;
  service.sessionGeneration = 0;
  service.openedUrls = [];
  service.openExternal = async (url) => { service.openedUrls.push(url); };
  service.persistPendingOAuthTransaction = (transaction) => {
    service.pendingOAuthTransaction = transaction;
  };
  service.clearPendingOAuthTransaction = (expectedTransaction = null) => {
    if (expectedTransaction && service.pendingOAuthTransaction !== expectedTransaction) return true;
    service.pendingOAuthTransaction = null;
    return true;
  };
  return service;
}

function callbackFor(transaction, parameters) {
  const callback = new URL(transaction.redirectUri);
  for (const [key, value] of Object.entries(parameters)) callback.searchParams.set(key, value);
  return callback.toString();
}

test('Google OAuth reopens the current authorize URL without replacing its transaction', async () => {
  const service = createService();
  const first = await service.loginWithGoogle();
  const transaction = service.pendingOAuthTransaction;
  const second = await service.loginWithGoogle();

  assert.equal(first.ok, true);
  assert.equal(second.reopened, true);
  assert.equal(service.pendingOAuthTransaction, transaction);
  assert.deepEqual(service.openedUrls, [transaction.authorizeUrl, transaction.authorizeUrl]);
  assert.equal(new URL(transaction.authorizeUrl).searchParams.get('code_challenge_method'), 's256');
  assert.deepEqual(second.state.oauth, { pending: true, expiresAt: transaction.expiresAt });
});

test('OAuth cancellation invalidates the pending transaction', async () => {
  const service = createService();
  await service.loginWithGoogle();

  const result = service.cancelOAuth();

  assert.equal(result.ok, true);
  assert.equal(service.pendingOAuthTransaction, null);
  assert.deepEqual(result.state.oauth, { pending: false, expiresAt: null });
  assert.equal(service.sessionGeneration, 1);
});

test('OAuth callback errors finish the wait and expose a stable error code', async () => {
  const service = createService();
  await service.loginWithGoogle();
  const callback = callbackFor(service.pendingOAuthTransaction, { error: 'access_denied' });

  const result = await service.handleOAuthCallback(callback);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUTH_OAUTH_DENIED');
  assert.equal(result.state.oauth.pending, false);
  assert.equal(service.pendingOAuthTransaction, null);
});

test('an old callback cannot clear a transaction created after cancellation', async () => {
  const service = createService();
  await service.loginWithGoogle();
  const oldTransaction = service.pendingOAuthTransaction;
  const oldCallback = callbackFor(oldTransaction, { code: 'old-code' });
  let releaseToken;
  let tokenRequestStarted;
  const started = new Promise((resolve) => { tokenRequestStarted = resolve; });
  const token = new Promise((resolve) => { releaseToken = resolve; });
  service.request = async (pathname) => {
    if (pathname.includes('grant_type=pkce')) {
      tokenRequestStarted();
      await token;
      return { access_token: 'access', refresh_token: 'refresh', user: { id: 'user' } };
    }
    return { role: 'student', status: 'active' };
  };

  const callback = service.handleOAuthCallback(oldCallback);
  await started;
  service.cancelOAuth();
  await service.loginWithGoogle();
  const newTransaction = service.pendingOAuthTransaction;
  releaseToken();
  const result = await callback;

  assert.equal(result.stale, true);
  assert.notEqual(newTransaction, oldTransaction);
  assert.equal(service.pendingOAuthTransaction, newTransaction);
});

test('a callback arriving after a new login cannot consume the new transaction', async () => {
  const service = createService();
  await service.loginWithGoogle();
  const oldCallback = callbackFor(service.pendingOAuthTransaction, { code: 'old-code' });
  service.cancelOAuth();
  await service.loginWithGoogle();
  const newTransaction = service.pendingOAuthTransaction;

  const result = await service.handleOAuthCallback(oldCallback);

  assert.equal(result.stale, true);
  assert.equal(service.pendingOAuthTransaction, newTransaction);
  assert.equal(result.state.oauth.pending, true);
});

test('OAuth fails actionably when the callback protocol was not registered', async () => {
  const service = createService();
  service.protocolRegistered = false;

  const result = await service.loginWithGoogle();

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUTH_OAUTH_PROTOCOL_UNAVAILABLE');
  assert.equal(service.openedUrls.length, 0);
});
