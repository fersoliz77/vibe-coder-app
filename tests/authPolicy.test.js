const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { MAX_OFFLINE_LEASE_MS, getEffectivePolicy, getLeaseExpiry, getLeaseTimerDelay } = require('../electron/auth/policy');
const { canAccessChannel } = require('../electron/auth/ipcGuard');
const { AuthService } = require('../electron/auth/authService');

const validatedAt = '2026-07-01T00:00:00.000Z';

function createSessionRecord(account = { role: 'student', status: 'active' }) {
  return {
    session: { access_token: 'old-access', refresh_token: 'old-refresh', user: { id: 'student-id', email: 'student@example.com' } },
    account,
    lastValidatedAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function createRevalidationService(accessResult) {
  const service = Object.create(AuthService.prototype);
  service.config = { missing: [], accessRpc: 'get_desktop_access' };
  service.sessionGeneration = 0;
  service.lastError = null;
  service.sessionPath = null;
  service.record = createSessionRecord();
  service.request = async (pathname) => {
    if (pathname.includes('/auth/v1/token')) {
      return { access_token: 'new-access', refresh_token: 'new-refresh', user: service.record.session.user };
    }
    if (accessResult instanceof Error) throw accessResult;
    return accessResult;
  };
  service.persist = (record) => { service.persistedRecord = record; };
  return service;
}

test('offline lease is capped at seven days', () => {
  assert.equal(getLeaseExpiry(validatedAt), '2026-07-08T00:00:00.000Z');
  assert.equal(getLeaseExpiry(validatedAt, '2026-08-01T00:00:00.000Z'), '2026-07-08T00:00:00.000Z');
  assert.equal(MAX_OFFLINE_LEASE_MS, 604800000);
});

test('server may shorten but never extend the lease', () => {
  assert.equal(getLeaseExpiry(validatedAt, '2026-07-03T00:00:00.000Z'), '2026-07-03T00:00:00.000Z');
});

test('lease timers are scheduled only for authenticated future expiries', () => {
  const now = Date.parse('2026-07-02T00:00:00.000Z');
  assert.equal(getLeaseTimerDelay({ authenticated: true, leaseExpiresAt: '2026-07-02T00:00:01.000Z' }, now), 1000);
  assert.equal(getLeaseTimerDelay({ authenticated: true, leaseExpiresAt: '2026-07-02T00:00:00.000Z' }, now), null);
  assert.equal(getLeaseTimerDelay({ authenticated: true, leaseExpiresAt: '2026-07-01T23:59:59.000Z' }, now), null);
  assert.equal(getLeaseTimerDelay({ authenticated: false, leaseExpiresAt: '2026-07-02T00:00:01.000Z' }, now), null);
  assert.equal(getLeaseTimerDelay({ authenticated: true, leaseExpiresAt: 'invalid' }, now), null);
});

test('active students and administrators receive productive access with a valid lease', () => {
  const base = { lastValidatedAt: validatedAt, now: Date.parse('2026-07-02T00:00:00.000Z') };
  assert.equal(getEffectivePolicy({ ...base, role: 'student', accountStatus: 'active' }), 'active');
  assert.equal(getEffectivePolicy({ ...base, role: 'student', accountStatus: 'pending' }), 'restricted');
  assert.equal(getEffectivePolicy({ ...base, role: 'student', accountStatus: 'restricted' }), 'restricted');
  assert.equal(getEffectivePolicy({ ...base, role: 'student', accountStatus: 'suspended' }), 'denied');
  assert.equal(getEffectivePolicy({ ...base, role: 'student', accountStatus: 'archived' }), 'denied');
  assert.equal(getEffectivePolicy({ ...base, role: 'admin', accountStatus: 'active' }), 'active');
  assert.equal(getEffectivePolicy({ ...base, role: 'admin', accountStatus: 'pending' }), 'restricted');
  assert.equal(getEffectivePolicy({ ...base, role: 'admin', accountStatus: 'restricted' }), 'restricted');
  assert.equal(getEffectivePolicy({ ...base, role: 'admin', accountStatus: 'suspended' }), 'denied');
  assert.equal(getEffectivePolicy({ ...base, role: 'admin', accountStatus: 'archived' }), 'denied');
  for (const accountStatus of ['pending', 'active', 'restricted', 'suspended', 'archived']) {
    assert.equal(getEffectivePolicy({ ...base, role: 'instructor', accountStatus }), 'denied');
  }
  assert.equal(getEffectivePolicy({ ...base, role: 'owner', accountStatus: 'active' }), 'denied');
});

test('expired leases restrict access while malformed leases deny access', () => {
  assert.equal(getEffectivePolicy({ role: 'student', accountStatus: 'active', lastValidatedAt: validatedAt, now: Date.parse('2026-07-08T00:00:00.000Z') }), 'restricted');
  assert.equal(getEffectivePolicy({ role: 'student', accountStatus: 'active', lastValidatedAt: validatedAt, now: Date.parse('2026-07-08T00:00:00.001Z') }), 'restricted');
  assert.equal(getEffectivePolicy({ role: 'admin', accountStatus: 'active', lastValidatedAt: validatedAt, now: Date.parse('2026-07-08T00:00:00.000Z') }), 'restricted');
  assert.equal(getEffectivePolicy({ role: 'student', accountStatus: 'active', lastValidatedAt: 'bad date' }), 'denied');
});

test('access responses normalize to the account contract', () => {
  const account = AuthService.prototype.normalizeAccess({
    account_role: 'student',
    account_status: 'active',
    plan_id: 'plan-pro',
    plan_name: 'Pro',
    completed_lessons: 12,
    total_lessons: 20,
    progress_percentage: 60,
    offline_lease_expires_at: '2026-07-03T00:00:00.000Z',
  });

  assert.deepEqual(account, {
    role: 'student',
    status: 'active',
    planId: 'plan-pro',
    planName: 'Pro',
    completedLessons: 12,
    totalLessons: 20,
    progressPercentage: 60,
    requestedLeaseExpiry: '2026-07-03T00:00:00.000Z',
  });
  assert.throws(
    () => AuthService.prototype.normalizeAccess({ role: 'owner', status: 'active' }),
    (error) => error.code === 'AUTH_ACCESS_INVALID',
  );
});

test('auth state exposes the complete plan and progress contract', () => {
  const service = Object.create(AuthService.prototype);
  service.config = { missing: [] };
  service.lastError = null;
  service.record = createSessionRecord({
    role: 'admin',
    status: 'active',
    planId: 'plan-team',
    planName: 'Team',
    completedLessons: 7,
    totalLessons: 10,
    progressPercentage: 70,
  });

  assert.deepEqual(service.getState().account, {
    role: 'admin',
    status: 'active',
    planId: 'plan-team',
    planName: 'Team',
    completedLessons: 7,
    totalLessons: 10,
    progressPercentage: 70,
  });
  assert.equal(service.getState().policy, 'active');
});

test('request classifies 401 and 403 as authoritative revocation, but not 5xx', async () => {
  const service = Object.create(AuthService.prototype);
  service.config = { supabaseUrl: 'https://example.test', anonKey: 'anon' };
  const originalFetch = global.fetch;

  try {
    for (const [status, code] of [[401, 'AUTH_ACCESS_REVOKED'], [403, 'AUTH_ACCESS_REVOKED'], [500, 'AUTH_REMOTE_REJECTED']]) {
      global.fetch = async () => ({ ok: false, status, json: async () => ({ message: 'Rejected' }) });
      await assert.rejects(service.request('/test'), (error) => error.code === code);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('legacy student records migrate to the persisted account shape', () => {
  for (const [leaseExpiresAt, expectedLease] of [
    ['2026-07-03T00:00:00.000Z', '2026-07-03T00:00:00.000Z'],
    ['2026-08-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z'],
  ]) {
    const service = Object.create(AuthService.prototype);
    let persisted;
    service.persist = (record) => { persisted = record; };

    service.restoreRecord({
      session: { access_token: 'access', refresh_token: 'refresh', user: { id: 'student-id', email: 'student@example.com' } },
      membership: { role: 'student', status: 'active', schoolId: 'obsolete', schoolName: 'Obsolete' },
      lastValidatedAt: validatedAt,
      leaseExpiresAt,
    });

    assert.deepEqual(service.record, persisted);
    assert.deepEqual(service.record.account, {
      role: 'student',
      status: 'active',
      planId: null,
      planName: null,
      completedLessons: 0,
      totalLessons: 0,
      progressPercentage: 0,
    });
    assert.equal(service.record.leaseExpiresAt, expectedLease);
    assert.equal('membership' in service.record, false);
    assert.equal('schoolId' in service.record.account, false);
    assert.equal('schoolName' in service.record.account, false);
  }
});

test('legacy administrative roles and invalid student statuses are not migrated', () => {
  for (const [role, status] of [['owner', 'active'], ['school_admin', 'active'], ['student', 'unknown']]) {
    const service = Object.create(AuthService.prototype);
    service.config = { missing: [] };
    service.record = null;
    service.persist = () => assert.fail('Rejected records must not be persisted.');
    const legacy = {
      session: { access_token: 'access', refresh_token: 'refresh', user: { id: 'profile-id' } },
      membership: { role, status },
      lastValidatedAt: validatedAt,
      leaseExpiresAt: '2026-07-03T00:00:00.000Z',
    };

    assert.throws(() => service.restoreRecord(legacy), (error) => error.code === 'AUTH_SESSION_INVALID');
    assert.equal(service.getPolicy(), 'denied');
  }
});

test('RPC revalidation moves an active student to restricted', async () => {
  const service = createRevalidationService({ role: 'student', status: 'restricted' });

  const result = await service.performRevalidation(0);

  assert.equal(result.ok, true);
  assert.equal(result.state.account.status, 'restricted');
  assert.equal(result.state.policy, 'restricted');
});

test('RPC revalidation grants productive access to an active admin', async () => {
  const service = createRevalidationService({ role: 'admin', status: 'active' });

  const result = await service.performRevalidation(0);

  assert.equal(result.ok, true);
  assert.equal(result.state.account.role, 'admin');
  assert.equal(result.state.policy, 'active');
});

test('empty successful access responses invalidate an active local record', async () => {
  const service = createRevalidationService([]);

  const result = await service.performRevalidation(0);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUTH_ACCESS_INVALID');
  assert.equal(result.state.authenticated, false);
  assert.equal(result.state.policy, 'denied');
  assert.equal(service.record, null);
});

test('authoritative 401 or 403 revalidation invalidates active access immediately', async () => {
  const revokedError = new Error('revoked');
  revokedError.code = 'AUTH_ACCESS_REVOKED';
  const service = createRevalidationService(revokedError);

  const result = await service.performRevalidation(0);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUTH_ACCESS_REVOKED');
  assert.equal(result.state.authenticated, false);
  assert.equal(result.state.policy, 'denied');
});

test('valid restrictive access replaces memory before persistence', async () => {
  for (const [account, expectedPolicy] of [
    [{ role: 'student', status: 'restricted' }, 'restricted'],
    [{ role: 'student', status: 'suspended' }, 'denied'],
    [{ role: 'admin', status: 'pending' }, 'restricted'],
  ]) {
    const service = createRevalidationService(account);
    service.persist = () => { throw new Error('disk unavailable'); };

    const result = await service.performRevalidation(0);

    assert.equal(result.ok, false);
    assert.deepEqual(result.state.account, {
      ...account,
      planId: null,
      planName: null,
      completedLessons: 0,
      totalLessons: 0,
      progressPercentage: 0,
    });
    assert.equal(result.state.policy, expectedPolicy);
  }
});

test('network and remote errors preserve active access within the offline lease', async () => {
  const networkError = new Error('network unavailable');
  const remoteError = new Error('remote rejected');
  remoteError.code = 'AUTH_REMOTE_REJECTED';

  for (const error of [networkError, remoteError]) {
    const service = createRevalidationService(error);
    const originalRecord = service.record;

    const result = await service.performRevalidation(0);

    assert.equal(result.ok, false);
    assert.equal(result.state.policy, 'active');
    assert.equal(service.record, originalRecord);
  }
});

test('logout returns denied state with a sanitized error when durable invalidation fails', () => {
  const service = Object.create(AuthService.prototype);
  service.config = { missing: [] };
  service.sessionGeneration = 0;
  service.lastError = null;
  service.sessionPath = 'C:\\sensitive\\auth-session.bin';
  service.record = createSessionRecord();
  const originalUnlink = fs.unlinkSync;

  let state;
  try {
    fs.unlinkSync = () => {
      const error = new Error(`EACCES: ${service.sessionPath}`);
      error.code = 'EACCES';
      throw error;
    };
    state = service.logout();
  } finally {
    fs.unlinkSync = originalUnlink;
  }

  assert.equal(state.authenticated, false);
  assert.equal(state.policy, 'denied');
  assert.equal(state.error.code, 'AUTH_SESSION_INVALIDATION_FAILED');
  assert.equal(state.error.message.includes('sensitive'), false);
  assert.equal(service.record, null);
});

test('restricted IPC permits state reads but denies productive actions', () => {
  assert.equal(canAccessChannel('restricted', 'projects:list'), true);
  assert.equal(canAccessChannel('restricted', 'fs:read-file'), false);
  assert.equal(canAccessChannel('restricted', 'fs:write-file'), false);
  assert.equal(canAccessChannel('restricted', 'terminal:create'), false);
  assert.equal(canAccessChannel('restricted', 'diagnostics:export'), true);
  assert.equal(canAccessChannel('denied', 'diagnostics:export'), true);
  assert.equal(canAccessChannel('denied', 'projects:list'), false);
  assert.equal(canAccessChannel('denied', 'auth:logout'), true);
  assert.equal(canAccessChannel('denied', 'auth:google'), true);
  assert.equal(canAccessChannel('denied', 'auth:unknown'), false);
  assert.equal(canAccessChannel('active', 'fs:write-file'), true);
});
