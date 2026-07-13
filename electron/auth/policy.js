const MAX_OFFLINE_LEASE_MS = 7 * 24 * 60 * 60 * 1000;
const MEMBERSHIP_STATUSES = Object.freeze([
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

function getEffectivePolicy({ membershipStatus, lastValidatedAt, leaseExpiresAt, now = Date.now() } = {}) {
  if (!MEMBERSHIP_STATUSES.includes(membershipStatus)) return 'denied';
  if (membershipStatus === 'suspended' || membershipStatus === 'archived') return 'denied';

  const expiry = Date.parse(getLeaseExpiry(lastValidatedAt, leaseExpiresAt));
  const currentTime = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(currentTime)) return 'denied';
  if (currentTime >= expiry) return 'restricted';

  return membershipStatus === 'active' ? 'active' : 'restricted';
}

module.exports = {
  MAX_OFFLINE_LEASE_MS,
  MEMBERSHIP_STATUSES,
  getEffectivePolicy,
  getLeaseExpiry,
};
