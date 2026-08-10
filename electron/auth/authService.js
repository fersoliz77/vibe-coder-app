const fs = require('fs');
const path = require('path');
const { app, safeStorage, shell } = require('electron');
const { ACCOUNT_ROLES, ACCOUNT_STATUSES, getEffectivePolicy, getLeaseExpiry } = require('./policy');
const {
  createOAuthAuthorizeUrl,
  createPkceTransaction,
  getOAuthRedirectUri,
  isPendingTransactionExpired,
  parseOAuthCallback,
} = require('./oauth');

const AUTH_REQUEST_TIMEOUT_MS = 15_000;
const LEARNING_HANDOFF_CODE = /^[A-Za-z0-9_-]{43}$/;

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
    accessRpc: process.env.VIBE_SUPABASE_MEMBERSHIP_RPC || packaged.accessRpc || 'get_desktop_access',
    helpUrl: process.env.VIBE_AUTH_HELP_URL || packaged.helpUrl || null,
    updateUrl: process.env.VIBE_UPDATE_URL?.replace(/\/$/, '') || packaged.updateUrl || 'https://vibe-desktop-updates.vibe-ide-coder.workers.dev',
    updateChannel: process.env.VIBE_UPDATE_CHANNEL || packaged.updateChannel || 'stable',
  };
  const missing = Object.entries(config)
    .filter(([key, value]) => !['helpUrl', 'updateChannel'].includes(key) && !value)
    .map(([key]) => key);
  return { ...config, missing };
}

function publicError(error) {
  return {
    code: error.code || 'AUTH_UNEXPECTED',
    message: error.message || 'Authentication failed.',
  };
}

function buildLearningUrl(helpUrl, code = null) {
  let base;
  try { base = new URL(helpUrl); } catch { throw new AuthError('AUTH_HELP_NOT_CONFIGURED', 'The learning platform URL is invalid.'); }
  if (base.protocol !== 'https:' || base.username || base.password) {
    throw new AuthError('AUTH_HELP_NOT_CONFIGURED', 'The learning platform URL is invalid.');
  }
  const url = new URL(code ? '/learn/handoff' : '/learn', base.origin);
  if (code) url.hash = new URLSearchParams({ code }).toString();
  return url.toString();
}

function isValidRecord(record) {
  return Boolean(
    record?.session?.access_token
    && record?.session?.refresh_token
    && record?.session?.user?.id
    && ACCOUNT_ROLES.includes(record?.account?.role)
    && ACCOUNT_STATUSES.includes(record?.account?.status)
    && Number.isFinite(Date.parse(record?.lastValidatedAt))
    && Number.isFinite(Date.parse(record?.leaseExpiresAt)),
  );
}

class AuthService {
  constructor({ protocolRegistered = true } = {}) {
    this.config = readConfig();
    this.sessionPath = path.join(app.getPath('userData'), 'auth-session.bin');
    this.oauthTransactionPath = path.join(app.getPath('userData'), 'auth-oauth.bin');
    this.pendingOAuthTransaction = null;
    this.record = null;
    this.lastError = null;
    this.sessionGeneration = 0;
    this.revalidationPromise = null;
    this.protocolRegistered = protocolRegistered;
    this.isPackaged = app.isPackaged;
    this.openExternal = (url) => shell.openExternal(url);
  }

  initialize() {
    if (this.config.missing.length) {
      this.lastError = publicError(new AuthError(
        'AUTH_CONFIG_MISSING',
        `Missing authentication configuration: ${this.config.missing.join(', ')}.`,
      ));
    }
    this.restorePendingOAuthTransaction();
    if (!fs.existsSync(this.sessionPath)) return;
    if (!safeStorage.isEncryptionAvailable()) {
      this.lastError = publicError(new AuthError('AUTH_SECURE_STORAGE_UNAVAILABLE', 'OS-backed secure storage is unavailable.'));
      return;
    }
    try {
      const encrypted = fs.readFileSync(this.sessionPath);
      const record = JSON.parse(safeStorage.decryptString(encrypted));
      this.restoreRecord(record);
    } catch {
      this.record = null;
      this.lastError = publicError(new AuthError('AUTH_SESSION_INVALID', 'The encrypted session could not be read. Sign in again.'));
    }
  }

  restorePendingOAuthTransaction() {
    if (!fs.existsSync(this.oauthTransactionPath)) return;
    if (!safeStorage.isEncryptionAvailable()) {
      this.clearPendingOAuthTransaction();
      return;
    }
    try {
      const encrypted = fs.readFileSync(this.oauthTransactionPath);
      const transaction = JSON.parse(safeStorage.decryptString(encrypted));
      if (isPendingTransactionExpired(transaction)
        || typeof transaction.codeVerifier !== 'string'
        || typeof transaction.nonce !== 'string'
        || typeof transaction.redirectUri !== 'string'
        || typeof transaction.authorizeUrl !== 'string') {
        this.clearPendingOAuthTransaction();
        return;
      }
      this.pendingOAuthTransaction = transaction;
    } catch {
      this.clearPendingOAuthTransaction();
    }
  }

  persistPendingOAuthTransaction(transaction) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new AuthError('AUTH_SECURE_STORAGE_UNAVAILABLE', 'OS-backed secure storage is unavailable.');
    }
    this.pendingOAuthTransaction = transaction;
    try {
      fs.writeFileSync(this.oauthTransactionPath, safeStorage.encryptString(JSON.stringify(transaction)));
    } catch (error) {
      this.clearPendingOAuthTransaction(transaction);
      throw error;
    }
  }

  clearPendingOAuthTransaction(expectedTransaction = null) {
    if (expectedTransaction && this.pendingOAuthTransaction !== expectedTransaction) return true;
    this.pendingOAuthTransaction = null;
    try {
      fs.unlinkSync(this.oauthTransactionPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        try {
          if (!safeStorage.isEncryptionAvailable()) return false;
          fs.writeFileSync(this.oauthTransactionPath, safeStorage.encryptString(JSON.stringify({ invalidated: true })));
        } catch {
          return false;
        }
      }
    }
    return true;
  }

  restoreRecord(record) {
    if (isValidRecord(record)) {
      this.record = record;
      return;
    }

    const legacyAccount = record?.membership;
    const hasValidLegacyLease = Number.isFinite(Date.parse(record?.leaseExpiresAt));
    if (record?.account != null
      || legacyAccount?.role !== 'student'
      || !ACCOUNT_STATUSES.includes(legacyAccount?.status)
      || !hasValidLegacyLease) {
      throw new AuthError('AUTH_SESSION_INVALID', 'The encrypted session is incomplete or invalid.');
    }

    const migrated = {
      session: record.session,
      account: {
        role: 'student',
        status: legacyAccount.status,
        planId: legacyAccount.planId ?? null,
        planName: legacyAccount.planName ?? null,
        completedLessons: Number(legacyAccount.completedLessons) || 0,
        totalLessons: Number(legacyAccount.totalLessons) || 0,
        progressPercentage: Number(legacyAccount.progressPercentage) || 0,
      },
      lastValidatedAt: record.lastValidatedAt,
      leaseExpiresAt: getLeaseExpiry(record.lastValidatedAt, record.leaseExpiresAt),
    };
    if (!isValidRecord(migrated)) {
      throw new AuthError('AUTH_SESSION_INVALID', 'The encrypted session is incomplete or invalid.');
    }
    this.persist(migrated);
    this.record = migrated;
  }

  getPolicy() {
    if (this.config.missing.length) return 'denied';
    if (!isValidRecord(this.record)) return 'denied';
    return getEffectivePolicy({
      role: this.record?.account?.role,
      accountStatus: this.record?.account?.status,
      lastValidatedAt: this.record?.lastValidatedAt,
      leaseExpiresAt: this.record?.leaseExpiresAt,
    });
  }

  getState() {
    const oauthTransaction = this.pendingOAuthTransaction;
    const oauthPending = Boolean(oauthTransaction && !isPendingTransactionExpired(oauthTransaction));
    if (oauthTransaction && !oauthPending) this.clearPendingOAuthTransaction(oauthTransaction);
    const policy = this.getPolicy();
    const leaseExpired = this.record?.leaseExpiresAt && Date.now() > Date.parse(this.record.leaseExpiresAt);
    return {
      authenticated: Boolean(this.record?.session?.access_token),
      policy,
      restrictionReason: policy === 'restricted'
        ? (leaseExpired ? 'OFFLINE_LEASE_EXPIRED' : 'ACCOUNT_RESTRICTED')
        : null,
      account: this.record?.account ? {
        role: this.record.account.role,
        status: this.record.account.status,
        planId: this.record.account.planId ?? null,
        planName: this.record.account.planName ?? null,
        completedLessons: Number(this.record.account.completedLessons) || 0,
        totalLessons: Number(this.record.account.totalLessons) || 0,
        progressPercentage: Number(this.record.account.progressPercentage) || 0,
      } : null,
      user: this.record?.session?.user ? {
        id: this.record.session.user.id,
        email: this.record.session.user.email,
      } : null,
      leaseExpiresAt: this.record?.leaseExpiresAt || null,
      configurationReady: this.config.missing.length === 0,
      oauth: {
        pending: oauthPending,
        expiresAt: oauthPending ? oauthTransaction.expiresAt : null,
      },
      error: this.lastError,
    };
  }

  requireConfig() {
    if (this.config.missing.length) {
      throw new AuthError('AUTH_CONFIG_MISSING', `Missing authentication configuration: ${this.config.missing.join(', ')}.`);
    }
  }

  getRealtimeSession() {
    if (!this.record?.session?.access_token || !this.record?.session?.user?.id) return null;
    return {
      supabaseUrl: this.config.supabaseUrl,
      anonKey: this.config.anonKey,
      accessToken: this.record.session.access_token,
      userId: this.record.session.user.id,
    };
  }

  getUpdateCredentials() {
    if (this.getPolicy() !== 'active' || !this.record?.session?.access_token) return null;
    return {
      updateUrl: this.config.updateUrl,
      accessToken: this.record.session.access_token,
      apiKey: this.config.anonKey,
      channel: this.config.updateChannel,
    };
  }

  async request(pathname, options = {}) {
    const { timeoutMs = AUTH_REQUEST_TIMEOUT_MS, signal, ...fetchOptions } = options;
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
    try {
      const response = await fetch(`${this.config.supabaseUrl}${pathname}`, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          apikey: this.config.anonKey,
          'Content-Type': 'application/json',
          ...fetchOptions.headers,
        },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403
          ? 'AUTH_ACCESS_REVOKED'
          : 'AUTH_REMOTE_REJECTED';
        throw new AuthError(code, body.msg || body.message || body.error_description || `Authentication service returned ${response.status}.`);
      }
      return body;
    } catch (error) {
      if (timedOut) throw new AuthError('AUTH_REQUEST_TIMEOUT', 'The authentication service timed out.');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  normalizeAccess(payload) {
    const value = Array.isArray(payload) ? payload[0] : payload;
    const role = value?.role || value?.account_role;
    const status = value?.status || value?.account_status;
    if (!ACCOUNT_ROLES.includes(role) || !ACCOUNT_STATUSES.includes(status)) {
      throw new AuthError('AUTH_ACCESS_INVALID', 'Access RPC returned an unsupported or missing role or status.');
    }
    return {
      role,
      status,
      planId: value.plan_id ?? value.planId ?? null,
      planName: value.plan_name ?? value.planName ?? null,
      completedLessons: Number(value.completed_lessons ?? value.completedLessons ?? 0),
      totalLessons: Number(value.total_lessons ?? value.totalLessons ?? 0),
      progressPercentage: Number(value.progress_percentage ?? value.progressPercentage ?? 0),
      requestedLeaseExpiry: value.offline_lease_expires_at || value.offlineLeaseExpiresAt || null,
    };
  }

  async validateAccess(session) {
    const payload = await this.request(`/rest/v1/rpc/${encodeURIComponent(this.config.accessRpc)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: '{}',
    });
    return this.normalizeAccess(payload);
  }

  persist(record = this.record) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new AuthError('AUTH_SECURE_STORAGE_UNAVAILABLE', 'OS-backed secure storage is unavailable.');
    }
    fs.writeFileSync(this.sessionPath, safeStorage.encryptString(JSON.stringify(record)));
  }

  invalidateRecord() {
    this.record = null;
    if (!this.sessionPath) return { durable: true, storageError: false };
    try {
      fs.unlinkSync(this.sessionPath);
      return { durable: true, storageError: false };
    } catch (error) {
      if (error.code === 'ENOENT') return { durable: true, storageError: false };
      try {
        if (!safeStorage.isEncryptionAvailable()) return { durable: false, storageError: true };
        fs.writeFileSync(this.sessionPath, safeStorage.encryptString(JSON.stringify({ invalidated: true })));
        return { durable: true, storageError: true };
      } catch {
        return { durable: false, storageError: true };
      }
    }
  }

  async login({ email, password } = {}) {
    const generation = ++this.sessionGeneration;
    try {
      this.requireConfig();
      if (!email || !password) throw new AuthError('AUTH_CREDENTIALS_REQUIRED', 'Email and password are required.');
      const session = await this.request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const account = await this.validateAccess(session);
      if (generation !== this.sessionGeneration) return { ok: false, stale: true, state: this.getState() };
      const lastValidatedAt = new Date().toISOString();
      const record = {
        session,
        account,
        lastValidatedAt,
        leaseExpiresAt: getLeaseExpiry(lastValidatedAt, account.requestedLeaseExpiry),
      };
      this.persist(record);
      this.record = record;
      this.lastError = null;
      return { ok: true, state: this.getState() };
    } catch (error) {
      if (generation !== this.sessionGeneration) return { ok: false, stale: true, state: this.getState() };
      if (error.code === 'AUTH_ACCESS_INVALID') {
        if (!this.invalidateRecord().durable) {
          this.lastError = publicError(new AuthError('AUTH_SESSION_INVALIDATION_FAILED', 'The invalid local session could not be securely cleared.'));
          return { ok: false, error: this.lastError, state: this.getState() };
        }
      }
      this.lastError = publicError(error);
      return { ok: false, error: this.lastError, state: this.getState() };
    }
  }

  async loginWithGoogle() {
    let transaction;
    let created = false;
    try {
      this.requireConfig();
      if (!this.protocolRegistered) {
        throw new AuthError('AUTH_OAUTH_PROTOCOL_UNAVAILABLE', 'This installation could not register the Google sign-in callback protocol. Reinstall the application or contact support.');
      }
      transaction = this.pendingOAuthTransaction;
      if (transaction && isPendingTransactionExpired(transaction)) {
        this.clearPendingOAuthTransaction(transaction);
        transaction = null;
      }
      if (!transaction) {
        const pending = createPkceTransaction();
        const redirectUri = new URL(getOAuthRedirectUri(this.isPackaged));
        redirectUri.searchParams.set('oauth_attempt', pending.nonce);
        transaction = { ...pending, redirectUri: redirectUri.toString() };
        transaction.authorizeUrl = createOAuthAuthorizeUrl(this.config.supabaseUrl, transaction);
        this.persistPendingOAuthTransaction(transaction);
        created = true;
      }
      await this.openExternal(transaction.authorizeUrl);
      this.lastError = null;
      return { ok: true, pending: true, reopened: !created, state: this.getState() };
    } catch (error) {
      if (created) this.clearPendingOAuthTransaction(transaction);
      this.lastError = publicError(error);
      return { ok: false, error: this.lastError, state: this.getState() };
    }
  }

  cancelOAuth() {
    const transaction = this.pendingOAuthTransaction;
    this.sessionGeneration += 1;
    this.clearPendingOAuthTransaction(transaction);
    this.lastError = null;
    return { ok: true, state: this.getState() };
  }

  async handleOAuthCallback(rawUrl) {
    const generation = ++this.sessionGeneration;
    let transaction;
    let outcome;
    let consumeTransaction = false;
    try {
      this.requireConfig();
      transaction = this.pendingOAuthTransaction;
      if (!transaction || isPendingTransactionExpired(transaction)) {
        throw new AuthError('AUTH_OAUTH_TRANSACTION_EXPIRED', 'The Google sign-in request expired. Try again.');
      }
      let callback;
      try {
        callback = parseOAuthCallback(rawUrl, transaction.redirectUri);
        consumeTransaction = true;
      } catch (error) {
        if (error.message === 'OAuth callback transaction does not match.') {
          throw new AuthError('AUTH_OAUTH_CALLBACK_STALE', error.message);
        }
        throw new AuthError('AUTH_OAUTH_CALLBACK_INVALID', 'The Google sign-in callback is invalid.');
      }
      if (callback.error) {
        throw new AuthError('AUTH_OAUTH_DENIED', 'Google sign-in was cancelled or denied.');
      }
      const session = await this.request('/auth/v1/token?grant_type=pkce', {
        method: 'POST',
        body: JSON.stringify({ auth_code: callback.code, code_verifier: transaction.codeVerifier }),
      });
      const account = await this.validateAccess(session);
      if (generation !== this.sessionGeneration) {
        outcome = { ok: false, stale: true };
      } else {
        const lastValidatedAt = new Date().toISOString();
        const record = {
          session,
          account,
          lastValidatedAt,
          leaseExpiresAt: getLeaseExpiry(lastValidatedAt, account.requestedLeaseExpiry),
        };
        this.persist(record);
        this.record = record;
        this.lastError = null;
        outcome = { ok: true };
      }
    } catch (error) {
      if (generation !== this.sessionGeneration) {
        outcome = { ok: false, stale: true };
      } else {
        if (error.code === 'AUTH_OAUTH_CALLBACK_STALE') {
          outcome = { ok: false, stale: true };
        } else {
          if (error.code === 'AUTH_ACCESS_INVALID') this.invalidateRecord();
          this.lastError = publicError(error);
          outcome = { ok: false, error: this.lastError };
        }
      }
    } finally {
      if (consumeTransaction) this.clearPendingOAuthTransaction(transaction);
    }
    return { ...outcome, state: this.getState() };
  }

  async revalidate() {
    if (this.revalidationPromise) return this.revalidationPromise;
    const generation = this.sessionGeneration;
    this.revalidationPromise = this.performRevalidation(generation)
      .finally(() => { this.revalidationPromise = null; });
    return this.revalidationPromise;
  }

  async performRevalidation(generation) {
    try {
      this.requireConfig();
      if (!this.record?.session?.refresh_token) throw new AuthError('AUTH_SESSION_REQUIRED', 'Sign in to validate access.');
      const session = await this.request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: this.record.session.refresh_token }),
      });
      const account = await this.validateAccess(session);
      if (generation !== this.sessionGeneration) return { ok: false, stale: true, state: this.getState() };
      const lastValidatedAt = new Date().toISOString();
      const record = {
        session,
        account,
        lastValidatedAt,
        leaseExpiresAt: getLeaseExpiry(lastValidatedAt, account.requestedLeaseExpiry),
      };
      this.record = record;
      this.persist(record);
      this.lastError = null;
      return { ok: true, state: this.getState() };
    } catch (error) {
      if (generation !== this.sessionGeneration) return { ok: false, stale: true, state: this.getState() };
      if (error.code === 'AUTH_ACCESS_INVALID' || error.code === 'AUTH_ACCESS_REVOKED') {
        if (!this.invalidateRecord().durable) {
          this.lastError = publicError(new AuthError('AUTH_SESSION_INVALIDATION_FAILED', 'The invalid local session could not be securely cleared.'));
          return { ok: false, error: this.lastError, state: this.getState() };
        }
      }
      this.lastError = publicError(error);
      return { ok: false, error: this.lastError, state: this.getState() };
    }
  }

  logout() {
    this.sessionGeneration += 1;
    this.clearPendingOAuthTransaction();
    const invalidation = this.invalidateRecord();
    this.lastError = invalidation.storageError
      ? publicError(new AuthError('AUTH_SESSION_INVALIDATION_FAILED', 'The local session could not be securely cleared.'))
      : (this.config.missing.length ? this.lastError : null);
    return this.getState();
  }

  openHelp() {
    if (!this.config.helpUrl) {
      throw new AuthError('AUTH_HELP_NOT_CONFIGURED', 'VIBE_AUTH_HELP_URL is not configured.');
    }
    return shell.openExternal(this.config.helpUrl);
  }

  async openLearning() {
    if (!this.config.helpUrl) {
      throw new AuthError('AUTH_HELP_NOT_CONFIGURED', 'VIBE_AUTH_HELP_URL is not configured.');
    }
    let target;
    let handoff = false;
    try {
      target = buildLearningUrl(this.config.helpUrl);
      const accessToken = this.record?.session?.access_token;
      if (accessToken) {
        try {
          const result = await this.request('/functions/v1/learning-handoff', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ action: 'issue' }),
          });
          if (LEARNING_HANDOFF_CODE.test(result?.code || '')) {
            target = buildLearningUrl(this.config.helpUrl, result.code);
            handoff = true;
          }
        } catch {}
      }
      await this.openExternal(target);
      return { ok: true, handoff };
    } catch (error) {
      const failure = error?.code === 'AUTH_HELP_NOT_CONFIGURED'
        ? error
        : new AuthError('AUTH_LEARNING_OPEN_FAILED', 'The learning platform could not be opened.');
      return { ok: false, error: publicError(failure) };
    }
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
  ipcMain.handle('auth:google', async () => {
    const result = await authService.loginWithGoogle();
    notify();
    return result;
  });
  ipcMain.handle('auth:cancel-oauth', () => {
    const result = authService.cancelOAuth();
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
  ipcMain.handle('auth:open-learning', () => authService.openLearning());
  return notify;
}

module.exports = { AUTH_REQUEST_TIMEOUT_MS, AuthService, buildLearningUrl, readConfig, setupAuthHandlers };
