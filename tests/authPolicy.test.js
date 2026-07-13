const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_OFFLINE_LEASE_MS, getEffectivePolicy, getLeaseExpiry } = require('../electron/auth/policy');
const { canAccessChannel } = require('../electron/auth/ipcGuard');

const validatedAt = '2026-07-01T00:00:00.000Z';

test('offline lease is capped at seven days', () => {
  assert.equal(getLeaseExpiry(validatedAt), '2026-07-08T00:00:00.000Z');
  assert.equal(getLeaseExpiry(validatedAt, '2026-08-01T00:00:00.000Z'), '2026-07-08T00:00:00.000Z');
  assert.equal(MAX_OFFLINE_LEASE_MS, 604800000);
});

test('server may shorten but never extend the lease', () => {
  assert.equal(getLeaseExpiry(validatedAt, '2026-07-03T00:00:00.000Z'), '2026-07-03T00:00:00.000Z');
});

test('membership states produce active, restricted, and denied policy', () => {
  const base = { lastValidatedAt: validatedAt, now: Date.parse('2026-07-02T00:00:00.000Z') };
  assert.equal(getEffectivePolicy({ ...base, membershipStatus: 'active' }), 'active');
  assert.equal(getEffectivePolicy({ ...base, membershipStatus: 'pending' }), 'restricted');
  assert.equal(getEffectivePolicy({ ...base, membershipStatus: 'restricted' }), 'restricted');
  assert.equal(getEffectivePolicy({ ...base, membershipStatus: 'suspended' }), 'denied');
  assert.equal(getEffectivePolicy({ ...base, membershipStatus: 'archived' }), 'denied');
});

test('expired leases restrict access while malformed leases deny access', () => {
  assert.equal(getEffectivePolicy({ membershipStatus: 'active', lastValidatedAt: validatedAt, now: Date.parse('2026-07-08T00:00:00.000Z') }), 'restricted');
  assert.equal(getEffectivePolicy({ membershipStatus: 'active', lastValidatedAt: validatedAt, now: Date.parse('2026-07-08T00:00:00.001Z') }), 'restricted');
  assert.equal(getEffectivePolicy({ membershipStatus: 'active', lastValidatedAt: 'bad date' }), 'denied');
});

test('restricted IPC permits state reads but denies productive actions', () => {
  assert.equal(canAccessChannel('restricted', 'projects:list'), true);
  assert.equal(canAccessChannel('restricted', 'fs:read-file'), false);
  assert.equal(canAccessChannel('restricted', 'fs:write-file'), false);
  assert.equal(canAccessChannel('restricted', 'terminal:create'), false);
  assert.equal(canAccessChannel('denied', 'projects:list'), false);
  assert.equal(canAccessChannel('denied', 'auth:logout'), true);
  assert.equal(canAccessChannel('active', 'fs:write-file'), true);
});
