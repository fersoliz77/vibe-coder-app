const fs = require('fs');
const path = require('path');
const { app, safeStorage, shell } = require('electron');
const { getEffectivePolicy, getLeaseExpiry, MEMBERSHIP_STATUSES } = require('./policy');

class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function readConfig() {
  let packaged = {};
  try {
    packaged = JSON.parse(fs.readFileSync(path.join(__dirname, 'runtime-config.json'), 'utf8'));
  } catch {}
  const config = {
    supabaseUrl: process.env.VIBE_SUPABASE_URL?.replace(/\/$/, '') || packaged.supabaseUrl,
    anonKey: process.env.VIBE_SUPABASE_ANON_KEY || packaged.anonKey,
    membershipRpc: process.env.VIBE_SUPABASE_MEMBERSHIP_RPC || packaged.membershipRpc || 'get_desktop_access',
    helpUrl: process.env.VIBE_AUTH_HELP_URL || packaged.helpUrl || null,
  };
  const missing = Object.entries(config)
    .filter(([key, value]) => key !== 'helpUrl' && !value)
    .map(([key]) => key);
  return { ...config, missing };
}

function publicError(error) {
  return {
    code: error.code || 'AUTH_UNEXPECTED',
    message: error.message || 'Authentication failed.',
  };
}

function isValidRecord(record) {
  return Boolean(
    record?.session?.access_token
    && record?.session?.refresh_token
    && record?.session?.user?.id
    && MEMBERSHIP_STATUSES.includes(record?.membership?.status)
    && Number.isFinite(Date.parse(record?.lastValidatedAt))
    && Number.isFinite(Date.parse(record?.leaseExpiresAt)),
  );
}

class AuthService {
  constructor() {
    this.config = readConfig();
    this.sessionPath = path.join(app.getPath('userData'), 'auth-session.bin');
    this.record = null;
    this.lastError = null;
  }

  initialize() {
    if (this.config.missing.length) {
      this.lastError = publicError(new AuthError(
        'AUTH_CONFIG_MISSING',
        `Missing authentication configuration: ${this.config.missing.join(', ')}.`,
      ));
    }
    if (!fs.existsSync(this.sessionPath)) return;
    if (!safeStorage.isEncryptionAvailable()) {
      this.lastError = publicError(new AuthError('AUTH_SECURE_STORAGE_UNAVAILABLE', 'OS-backed secure storage is unavailable.'));
      return;
    }
    try {
      const encrypted = fs.readFileSync(this.sessionPath);
      const record = JSON.parse(safeStorage.decryptString(encrypted));
      if (!isValidRecord(record)) throw new AuthError('AUTH_SESSION_INVALID', 'The encrypted session is incomplete or invalid.');
      this.record = record;
    } catch {
      this.record = null;
      this.lastError = publicError(new AuthError('AUTH_SESSION_INVALID', 'The encrypted session could not be read. Sign in again.'));
    }
  }

  getPolicy() {
    if (this.config.missing.length) return 'denied';
    if (!isValidRecord(this.record)) return 'denied';
    return getEffectivePolicy({
      membershipStatus: this.record?.membership?.status,
      lastValidatedAt: this.record?.lastValidatedAt,
      leaseExpiresAt: this.record?.leaseExpiresAt,
    });
  }

  getState() {
    const policy = this.getPolicy();
    const leaseExpired = this.record?.leaseExpiresAt && Date.now() > Date.parse(this.record.leaseExpiresAt);
    return {
      authenticated: Boolean(this.record?.session?.access_token),
      policy,
      restrictionReason: policy === 'restricted'
        ? (leaseExpired ? 'OFFLINE_LEASE_EXPIRED' : 'ACCOUNT_RESTRICTED')
        : null,
      membership: this.record?.membership ? {
        status: this.record.membership.status,
        schoolId: this.record.membership.schoolId || null,
        schoolName: this.record.membership.schoolName || null,
        planId: this.record.membership.planId || null,
        planName: this.record.membership.planName || null,
        completedLessons: this.record.membership.completedLessons || 0,
        totalLessons: this.record.membership.totalLessons || 0,
        progressPercentage: this.record.membership.progressPercentage || 0,
      } : null,
      user: this.record?.session?.user ? {
        id: this.record.session.user.id,
        email: this.record.session.user.email,
      } : null,
      leaseExpiresAt: this.record?.leaseExpiresAt || null,
      configurationReady: this.config.missing.length === 0,
      error: this.lastError,
    };
  }

  requireConfig() {
    if (this.config.missing.length) {
      throw new AuthError('AUTH_CONFIG_MISSING', `Missing authentication configuration: ${this.config.missing.join(', ')}.`);
    }
  }

  async request(pathname, options = {}) {
    const response = await fetch(`${this.config.supabaseUrl}${pathname}`, {
      ...options,
      headers: {
        apikey: this.config.anonKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AuthError('AUTH_REMOTE_REJECTED', body.msg || body.message || body.error_description || `Authentication service returned ${response.status}.`);
    }
    return body;
  }

  normalizeMembership(payload) {
    const value = Array.isArray(payload) ? payload[0] : payload;
    const status = value?.status || value?.membership_status;
    if (!MEMBERSHIP_STATUSES.includes(status)) {
      throw new AuthError('AUTH_MEMBERSHIP_INVALID', 'Membership RPC returned an unsupported or missing status.');
    }
    return {
      status,
      schoolId: value.school_id || value.schoolId || null,
      schoolName: value.school_name || value.schoolName || null,
      planId: value.plan_id || value.planId || null,
      planName: value.plan_name || value.planName || null,
      completedLessons: Number(value.completed_lessons ?? value.completedLessons ?? 0),
      totalLessons: Number(value.total_lessons ?? value.totalLessons ?? 0),
      progressPercentage: Number(value.progress_percentage ?? value.progressPercentage ?? 0),
      requestedLeaseExpiry: value.offline_lease_expires_at || value.offlineLeaseExpiresAt || null,
    };
  }

  async validateMembership(session) {
    const payload = await this.request(`/rest/v1/rpc/${encodeURIComponent(this.config.membershipRpc)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: '{}',
    });
    return this.normalizeMembership(payload);
  }

  persist(record = this.record) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new AuthError('AUTH_SECURE_STORAGE_UNAVAILABLE', 'OS-backed secure storage is unavailable.');
    }
    fs.writeFileSync(this.sessionPath, safeStorage.encryptString(JSON.stringify(record)));
  }

  async login({ email, password } = {}) {
    try {
      this.requireConfig();
      if (!email || !password) throw new AuthError('AUTH_CREDENTIALS_REQUIRED', 'Email and password are required.');
      const session = await this.request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const membership = await this.validateMembership(session);
      const lastValidatedAt = new Date().toISOString();
      const record = {
        session,
        membership,
        lastValidatedAt,
        leaseExpiresAt: getLeaseExpiry(lastValidatedAt, membership.requestedLeaseExpiry),
      };
      this.persist(record);
      this.record = record;
      this.lastError = null;
      return { ok: true, state: this.getState() };
    } catch (error) {
      this.lastError = publicError(error);
      return { ok: false, error: this.lastError, state: this.getState() };
    }
  }

  async revalidate() {
    try {
      this.requireConfig();
      if (!this.record?.session?.refresh_token) throw new AuthError('AUTH_SESSION_REQUIRED', 'Sign in to validate access.');
      const session = await this.request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: this.record.session.refresh_token }),
      });
      this.record = { ...this.record, session };
      this.persist();
      const membership = await this.validateMembership(session);
      const lastValidatedAt = new Date().toISOString();
      const record = {
        session,
        membership,
        lastValidatedAt,
        leaseExpiresAt: getLeaseExpiry(lastValidatedAt, membership.requestedLeaseExpiry),
      };
      this.persist(record);
      this.record = record;
      this.lastError = null;
      return { ok: true, state: this.getState() };
    } catch (error) {
      this.lastError = publicError(error);
      return { ok: false, error: this.lastError, state: this.getState() };
    }
  }

  logout() {
    this.record = null;
    this.lastError = this.config.missing.length ? this.lastError : null;
    try { fs.unlinkSync(this.sessionPath); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return this.getState();
  }

  openHelp() {
    if (!this.config.helpUrl) {
      throw new AuthError('AUTH_HELP_NOT_CONFIGURED', 'VIBE_AUTH_HELP_URL is not configured.');
    }
    return shell.openExternal(this.config.helpUrl);
  }
}

function setupAuthHandlers(ipcMain, authService, getMainWindow, onStateChange) {
  const notify = () => {
    const state = authService.getState();
    onStateChange?.(state);
    getMainWindow()?.webContents.send('auth:state-changed', state);
  };
  ipcMain.handle('auth:get-state', () => authService.getState());
  ipcMain.handle('auth:login', async (_, credentials) => {
    const result = await authService.login(credentials);
    notify();
    return result;
  });
  ipcMain.handle('auth:revalidate', async () => {
    const result = await authService.revalidate();
    notify();
    return result;
  });
  ipcMain.handle('auth:logout', () => {
    const state = authService.logout();
    notify();
    return state;
  });
  ipcMain.handle('auth:open-help', () => authService.openHelp());
  return notify;
}

module.exports = { AuthService, setupAuthHandlers };
