const crypto = require('crypto');

const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const CALLBACK_SCHEMES = Object.freeze({ packaged: 'vibeidecode', development: 'vibeidecode-dev' });

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function createPkceTransaction({ now = Date.now(), randomBytes = crypto.randomBytes } = {}) {
  const codeVerifier = base64Url(randomBytes(32));
  return {
    codeVerifier,
    codeChallenge: base64Url(crypto.createHash('sha256').update(codeVerifier, 'ascii').digest()),
    nonce: base64Url(randomBytes(32)),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OAUTH_TRANSACTION_TTL_MS).toISOString(),
  };
}

function isPendingTransactionExpired(transaction, now = Date.now()) {
  const createdAt = Date.parse(transaction?.createdAt);
  const expiresAt = Date.parse(transaction?.expiresAt);
  return !Number.isFinite(createdAt)
    || !Number.isFinite(expiresAt)
    || createdAt > now
    || expiresAt <= now
    || expiresAt <= createdAt
    || expiresAt - createdAt > OAUTH_TRANSACTION_TTL_MS;
}

function getOAuthRedirectUri(isPackaged) {
  const scheme = isPackaged ? CALLBACK_SCHEMES.packaged : CALLBACK_SCHEMES.development;
  return `${scheme}://auth/callback`;
}

function createOAuthAuthorizeUrl(supabaseUrl, transaction) {
  const authorizeUrl = new URL(`${supabaseUrl}/auth/v1/authorize`);
  authorizeUrl.searchParams.set('provider', 'google');
  authorizeUrl.searchParams.set('redirect_to', transaction.redirectUri);
  authorizeUrl.searchParams.set('code_challenge', transaction.codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 's256');
  authorizeUrl.searchParams.set('nonce', transaction.nonce);
  return authorizeUrl.toString();
}

function parseOAuthCallback(rawUrl, expectedRedirectUri) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 4096) {
    throw new Error('Invalid OAuth callback URL.');
  }

  let callback;
  let expected;
  try {
    callback = new URL(rawUrl);
    expected = new URL(expectedRedirectUri);
  } catch {
    throw new Error('Invalid OAuth callback URL.');
  }

  if (callback.protocol !== expected.protocol
    || callback.hostname !== expected.hostname
    || callback.pathname !== expected.pathname
    || callback.port
    || callback.username
    || callback.password
    || callback.hash) {
    throw new Error('OAuth callback target does not match.');
  }

  if (callback.searchParams.get('oauth_attempt') !== expected.searchParams.get('oauth_attempt')) {
    throw new Error('OAuth callback transaction does not match.');
  }

  const allowed = new Set(['code', 'error', 'error_code', 'error_description', 'oauth_attempt']);
  for (const key of callback.searchParams.keys()) {
    if (!allowed.has(key) || callback.searchParams.getAll(key).length !== 1) {
      throw new Error('OAuth callback contains invalid parameters.');
    }
  }

  const code = callback.searchParams.get('code');
  const error = callback.searchParams.get('error');
  const errorCode = callback.searchParams.get('error_code');
  const errorDescription = callback.searchParams.get('error_description');
  if (Boolean(code) === Boolean(error)) {
    throw new Error('OAuth callback is incomplete.');
  }
  if (code && !/^[A-Za-z0-9._~-]{1,2048}$/.test(code)) {
    throw new Error('OAuth authorization code is invalid.');
  }
  if (error && !/^[A-Za-z0-9._-]{1,128}$/.test(error)) {
    throw new Error('OAuth error is invalid.');
  }
  if ((!error && (errorCode || errorDescription))
    || (errorCode && !/^[A-Za-z0-9._-]{1,128}$/.test(errorCode))
    || (errorDescription && (errorDescription.length > 512 || /[\u0000-\u001f\u007f]/.test(errorDescription)))) {
    throw new Error('OAuth error details are invalid.');
  }

  return {
    code: code || null,
    error: error || null,
    errorCode: errorCode || null,
    errorDescription: errorDescription || null,
  };
}

module.exports = {
  CALLBACK_SCHEMES,
  OAUTH_TRANSACTION_TTL_MS,
  createOAuthAuthorizeUrl,
  createPkceTransaction,
  getOAuthRedirectUri,
  isPendingTransactionExpired,
  parseOAuthCallback,
};
