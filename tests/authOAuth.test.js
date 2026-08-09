const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  OAUTH_TRANSACTION_TTL_MS,
  createOAuthAuthorizeUrl,
  createPkceTransaction,
  getOAuthRedirectUri,
  isPendingTransactionExpired,
  parseOAuthCallback,
} = require('../electron/auth/oauth');

test('PKCE uses an S256 challenge and a cryptographic nonce', () => {
  let seed = 0;
  const randomBytes = (size) => Buffer.alloc(size, ++seed);
  const transaction = createPkceTransaction({ now: 1_000, randomBytes });
  const expectedChallenge = crypto.createHash('sha256')
    .update(transaction.codeVerifier, 'ascii')
    .digest('base64url');

  assert.equal(transaction.codeVerifier.length, 43);
  assert.equal(transaction.codeChallenge, expectedChallenge);
  assert.match(transaction.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(transaction.expiresAt) - Date.parse(transaction.createdAt), OAUTH_TRANSACTION_TTL_MS);
});

test('OAuth redirect URI differs between packaged and development runs', () => {
  assert.equal(getOAuthRedirectUri(true), 'vibeidecode://auth/callback');
  assert.equal(getOAuthRedirectUri(false), 'vibeidecode-dev://auth/callback');
});

test('Supabase authorize URL uses the exact lowercase s256 contract', () => {
  assert.equal(
    createOAuthAuthorizeUrl('https://project.supabase.co', {
      redirectUri: 'vibeidecode://auth/callback',
      codeChallenge: 'challenge_value',
      nonce: 'nonce_value',
    }),
    'https://project.supabase.co/auth/v1/authorize?provider=google&redirect_to=vibeidecode%3A%2F%2Fauth%2Fcallback&code_challenge=challenge_value&code_challenge_method=s256&nonce=nonce_value',
  );
});

test('OAuth callback parser accepts only the exact callback contract', () => {
  assert.deepEqual(
    parseOAuthCallback('vibeidecode://auth/callback?code=authorization-code', 'vibeidecode://auth/callback'),
    { code: 'authorization-code', error: null, errorCode: null, errorDescription: null },
  );
  assert.deepEqual(
    parseOAuthCallback('vibeidecode-dev://auth/callback?error=access_denied&error_code=cancelled', 'vibeidecode-dev://auth/callback'),
    { code: null, error: 'access_denied', errorCode: 'cancelled', errorDescription: null },
  );

  for (const callback of [
    'vibeidecode://other/callback?code=x',
    'vibeidecode-dev://auth/callback?code=x',
    'vibeidecode://auth/callback?code=x&code=y',
    'vibeidecode://auth/callback?code=x&unexpected=1',
    'vibeidecode://auth/callback?code=x#token',
    'vibeidecode://auth/callback?code=x&error=denied',
  ]) {
    assert.throws(() => parseOAuthCallback(callback, 'vibeidecode://auth/callback'));
  }
});

test('pending OAuth transactions expire at the boundary and reject malformed clocks', () => {
  const now = Date.parse('2026-08-02T12:00:00.000Z');
  const transaction = createPkceTransaction({ now });
  assert.equal(isPendingTransactionExpired(transaction, now), false);
  assert.equal(isPendingTransactionExpired(transaction, now + OAUTH_TRANSACTION_TTL_MS - 1), false);
  assert.equal(isPendingTransactionExpired(transaction, now + OAUTH_TRANSACTION_TTL_MS), true);
  assert.equal(isPendingTransactionExpired({ ...transaction, createdAt: 'invalid' }, now), true);
  assert.equal(isPendingTransactionExpired({ ...transaction, createdAt: new Date(now + 1).toISOString() }, now), true);
  assert.equal(isPendingTransactionExpired({ ...transaction, expiresAt: new Date(now + OAUTH_TRANSACTION_TTL_MS + 1).toISOString() }, now), true);
});
