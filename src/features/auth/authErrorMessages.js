const MESSAGE_PATTERNS = [
  [/invalid login credentials|invalid credentials/i, 'auth.errors.invalidCredentials'],
  [/email not confirmed/i, 'auth.errors.emailNotConfirmed'],
  [/network|fetch failed|failed to fetch|econn|timeout/i, 'auth.errors.serviceUnavailable'],
];

const CODE_KEYS = {
  AUTH_ACCESS_REVOKED: 'auth.errors.accessRevoked',
  AUTH_CONFIG_MISSING: 'auth.errors.configuration',
  AUTH_ACCESS_INVALID: 'auth.errors.invalidAccess',
  AUTH_OAUTH_CALLBACK_INVALID: 'auth.errors.oauthCallbackInvalid',
  AUTH_OAUTH_DENIED: 'auth.errors.oauthDenied',
  AUTH_OAUTH_PROTOCOL_UNAVAILABLE: 'auth.errors.oauthProtocolUnavailable',
  AUTH_OAUTH_TRANSACTION_EXPIRED: 'auth.errors.oauthExpired',
  AUTH_REQUEST_TIMEOUT: 'auth.errors.serviceUnavailable',
  AUTH_UNEXPECTED: 'auth.errors.unexpected',
};

export function localizedAuthError(error, t) {
  if (!error) return '';
  const message = String(error.message || '');
  const pattern = MESSAGE_PATTERNS.find(([expression]) => expression.test(message));
  if (pattern) return t(pattern[1]);
  if (CODE_KEYS[error.code]) return t(CODE_KEYS[error.code]);
  if (error.code === 'AUTH_REMOTE_REJECTED') return t('auth.errors.remoteRejected');
  return t('auth.errors.unexpected');
}
