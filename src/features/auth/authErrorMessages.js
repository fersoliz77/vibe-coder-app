const MESSAGE_PATTERNS = [
  [/invalid login credentials|invalid credentials/i, 'auth.errors.invalidCredentials'],
  [/email not confirmed/i, 'auth.errors.emailNotConfirmed'],
  [/network|fetch failed|failed to fetch|econn|timeout/i, 'auth.errors.serviceUnavailable'],
];

const CODE_KEYS = {
  AUTH_ACCESS_REVOKED: 'auth.errors.accessRevoked',
  AUTH_CONFIG_MISSING: 'auth.errors.configuration',
  AUTH_ACCESS_INVALID: 'auth.errors.invalidAccess',
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
