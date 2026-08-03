const MAX_OFFLINE_LEASE_MS = 7 * 24 * 60 * 60 * 1000;
const ACCOUNT_ROLES = Object.freeze([
  'admin',
  'student',
  'instructor',
]);
const ACCOUNT_STATUSES = Object.freeze([
  'pending',
  'active',
  'restricted',
  'suspended',
  'archived',
]);

function getLeaseExpiry(lastValidatedAt, requestedExpiry) {
  const validatedAt = Date.parse(lastValidatedAt);
  if (!Number.isFinite(validatedAt)) return null;

  const maximum = validatedAt + MAX_OFFLINE_LEASE_MS;
  const requested = Date.parse(requestedExpiry);
  return new Date(Number.isFinite(requested) ? Math.min(maximum, requested) : maximum).toISOString();
}

function getEffectivePolicy({ role, accountStatus, lastValidatedAt, leaseExpiresAt, now = Date.now() } = {}) {
  if (!ACCOUNT_ROLES.includes(role) || !ACCOUNT_STATUSES.includes(accountStatus)) return 'denied';
  if (role === 'instructor') return 'denied';
  if (role === 'admin' && accountStatus !== 'active') return 'denied';
  if (role === 'student' && (accountStatus === 'suspended' || accountStatus === 'archived')) return 'denied';

  const expiry = Date.parse(getLeaseExpiry(lastValidatedAt, leaseExpiresAt));
  const currentTime = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(currentTime)) return 'denied';
  if (currentTime >= expiry) return 'restricted';

  return accountStatus === 'active' ? 'active' : 'restricted';
}

function getLeaseTimerDelay({ authenticated, leaseExpiresAt } = {}, now = Date.now()) {
  if (!authenticated) return null;
  const expiry = Date.parse(leaseExpiresAt);
  const currentTime = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(currentTime) || expiry <= currentTime) return null;
  return Math.min(expiry - currentTime, 2_147_483_647);
}

module.exports = {
  MAX_OFFLINE_LEASE_MS,
  ACCOUNT_ROLES,
  ACCOUNT_STATUSES,
  getEffectivePolicy,
  getLeaseExpiry,
  getLeaseTimerDelay,
};
