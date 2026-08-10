const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./atomicJson');
const { verifySignedUpdateInfo } = require('./updateSignature');

const UPDATE_EVENT = 'updates:state-changed';
const CHECK_RETRY_MS = 15 * 60 * 1000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const EMPTY_PROGRESS = Object.freeze({
  percent: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0,
});

class UpdateManagerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function finiteNumber(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function sanitizeVersion(value) {
  const version = typeof value === 'string' ? value.trim() : '';
  return /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(version) ? version : null;
}

function parseStableVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value || '');
  return match ? match.slice(1).map(Number) : null;
}

function compareStableVersions(left, right) {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function sanitizeProgress(progress) {
  return {
    percent: finiteNumber(progress?.percent, 0, 100),
    bytesPerSecond: finiteNumber(progress?.bytesPerSecond),
    transferred: finiteNumber(progress?.transferred),
    total: finiteNumber(progress?.total),
  };
}

function buildFeed(credentials) {
  if (!credentials
    || typeof credentials.supabaseUrl !== 'string'
    || typeof credentials.accessToken !== 'string'
    || typeof credentials.apiKey !== 'string'
    || typeof credentials.bucket !== 'string'
    || typeof credentials.channel !== 'string') {
    throw new UpdateManagerError('UPDATE_CREDENTIALS_UNAVAILABLE', 'Update access is unavailable.');
  }
  let origin;
  try {
    const parsed = new URL(credentials.supabaseUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid');
    parsed.pathname = parsed.pathname.replace(/\/$/, '');
    origin = parsed.toString().replace(/\/$/, '');
  } catch {
    throw new UpdateManagerError('UPDATE_CREDENTIALS_INVALID', 'Update access is invalid.');
  }
  if (!credentials.accessToken || !credentials.apiKey || !credentials.bucket.trim() || !credentials.channel.trim()) {
    throw new UpdateManagerError('UPDATE_CREDENTIALS_UNAVAILABLE', 'Update access is unavailable.');
  }
  return {
    url: `${origin}/storage/v1/object/authenticated/${encodeURIComponent(credentials.bucket.trim())}/${encodeURIComponent(credentials.channel.trim())}`,
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      apikey: credentials.apiKey,
    },
  };
}

class UpdateManager {
  constructor({
    app,
    authService,
    updater = null,
    platform = process.platform,
    getMainWindow = () => null,
    prepareWindowForUpdateInstall = () => () => {},
    statePath,
    persistRequirement = writeJsonAtomic,
    verifyUpdate = verifySignedUpdateInfo,
  } = {}) {
    this.app = app;
    this.authService = authService;
    this.updater = updater;
    this.platform = platform;
    this.getMainWindow = getMainWindow;
    this.prepareWindowForUpdateInstall = prepareWindowForUpdateInstall;
    this.statePath = statePath === undefined && app?.getPath
      ? path.join(app.getPath('userData'), 'update-requirement.json')
      : statePath;
    this.installedVersion = sanitizeVersion(app?.getVersion?.()) || '0.0.0';
    this.persistRequirement = persistRequirement;
    this.verifyUpdate = verifyUpdate;
    this.requirementStateInvalid = false;
    this.eligible = Boolean(app?.isPackaged && platform === 'win32');
    this.policy = null;
    this.initialized = false;
    this.operation = null;
    this.operationGeneration = 0;
    this.checkPromise = null;
    this.downloadPromise = null;
    this.cancellationToken = null;
    this.knownVersion = this.loadRequiredVersion();
    this.retainedStatus = null;
    this.installApprovalRelease = null;
    this.checkTimer = null;
    this.revision = 0;
    this.state = { ...this.makeState('disabled'), revision: this.revision };
    this.onProgress = (progress) => this.handleProgress(progress);
    this.onDownloaded = (info) => this.handleDownloaded(info);
    this.onUpdaterError = () => this.handleUpdaterError();
  }

  makeState(status, options = {}) {
    const mandatory = Boolean(options.mandatory);
    return {
      status,
      mandatory,
      blocking: mandatory,
      version: sanitizeVersion(options.version),
      progress: status === 'downloading' ? sanitizeProgress(options.progress || EMPTY_PROGRESS) : null,
      error: status === 'error' ? {
        code: options.errorCode || (mandatory ? 'UPDATE_DOWNLOAD_FAILED' : 'UPDATE_CHECK_FAILED'),
        message: options.errorMessage || (mandatory
          ? 'The required update could not be prepared. Try again.'
          : 'Updates could not be checked. Try again.'),
      } : null,
    };
  }

  getState() {
    return {
      ...this.state,
      progress: this.state.progress ? { ...this.state.progress } : null,
      error: this.state.error ? { ...this.state.error } : null,
    };
  }

  publish(state) {
    this.revision += 1;
    this.state = { ...state, revision: this.revision };
    const mainWindow = this.getMainWindow?.();
    if (mainWindow && !mainWindow.isDestroyed?.()) {
      mainWindow.webContents.send(UPDATE_EVENT, this.getState());
    }
    return this.getState();
  }

  loadRequiredVersion() {
    if (!this.statePath) return null;
    try {
      const version = sanitizeVersion(JSON.parse(fs.readFileSync(this.statePath, 'utf8'))?.requiredVersion);
      if (version && compareStableVersions(version, this.installedVersion) === 1) return version;
      fs.rmSync(this.statePath, { force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') this.requirementStateInvalid = true;
    }
    return null;
  }

  rememberRequiredVersion(version) {
    const comparison = compareStableVersions(version, this.knownVersion);
    if (this.knownVersion && comparison === -1) return;
    if (!this.knownVersion || comparison === 1) this.knownVersion = version;
    if (this.statePath) this.persistRequirement(this.statePath, { requiredVersion: this.knownVersion });
    this.requirementStateInvalid = false;
  }

  clearInvalidRequirement() {
    if (!this.requirementStateInvalid) return;
    if (this.statePath) fs.rmSync(this.statePath, { force: true });
    this.requirementStateInvalid = false;
  }

  initialize() {
    if (this.initialized || !this.eligible) return this.getState();
    if (!this.updater) this.updater = require('electron-updater').autoUpdater;
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;
    this.updater.logger = null;
    this.updater.on('download-progress', this.onProgress);
    this.updater.on('update-downloaded', this.onDownloaded);
    this.updater.on('error', this.onUpdaterError);
    this.initialized = true;
    return this.getState();
  }

  isActive() {
    return this.eligible
      && this.policy === 'active'
      && this.authService?.getPolicy?.() === 'active';
  }

  requireActive() {
    if (!this.isActive()) {
      throw new UpdateManagerError('UPDATE_ACCESS_REQUIRED', 'Active access is required for updates.');
    }
  }

  configureFeed() {
    this.requireActive();
    const feed = buildFeed(this.authService.getUpdateCredentials());
    this.updater.setFeedURL({ provider: 'generic', url: feed.url, requestHeaders: feed.headers });
    this.updater.requestHeaders = feed.headers;
  }

  clearUpdaterAccess() {
    if (!this.updater) return;
    this.updater.requestHeaders = null;
    // Replacing the provider drops request headers retained by electron-updater.
    this.updater.setFeedURL({ provider: 'generic', url: 'https://updates.invalid/' });
    this.updater.requestHeaders = null;
    this.updater.updateInfoAndProvider = null;
  }

  cancelCurrentOperation() {
    this.operationGeneration += 1;
    try { this.cancellationToken?.cancel?.(); } catch {}
    this.cancellationToken = null;
    this.operation = null;
    this.checkPromise = null;
    this.downloadPromise = null;
  }

  clearScheduledCheck() {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = null;
  }

  scheduleCheck(delay, required = false) {
    this.clearScheduledCheck();
    if (!this.isActive() || (this.knownVersion && !required)) return;
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      this.check(required).catch(() => {});
    }, delay);
    this.checkTimer.unref?.();
  }

  async handleAuthState(state) {
    const wasActive = this.policy === 'active';
    this.policy = state?.policy || 'denied';
    if (!this.eligible) return this.publish(this.makeState('disabled'));
    this.initialize();

    if (this.policy !== 'active') {
      this.retainedStatus = this.knownVersion
        ? (this.state.status === 'downloaded' ? 'downloaded' : 'available')
        : null;
      this.cancelCurrentOperation();
      this.clearScheduledCheck();
      this.installApprovalRelease?.();
      this.installApprovalRelease = null;
      this.clearUpdaterAccess();
      return this.publish(this.makeState('disabled', {
        mandatory: Boolean(this.knownVersion),
        version: this.knownVersion,
      }));
    }

    if (this.knownVersion || this.requirementStateInvalid) {
      const status = this.retainedStatus || (this.state.status === 'disabled' ? 'available' : this.state.status);
      this.retainedStatus = null;
      if (status === 'downloading' || status === 'downloaded') return this.getState();
      this.publish(this.makeState('available', { mandatory: true, version: this.knownVersion }));
      return this.check(true);
    }
    if (this.state.status === 'disabled') this.publish(this.makeState('idle'));
    if (!wasActive) return this.check();
    return this.getState();
  }

  async check(required = Boolean(this.knownVersion || this.requirementStateInvalid)) {
    this.requireActive();
    if (this.checkPromise) return this.checkPromise;
    if (!['idle', 'current', 'available', 'error'].includes(this.state.status) || (this.state.mandatory && !required)) {
      throw new UpdateManagerError('UPDATE_STATE_INVALID', 'An update check is not allowed in the current state.');
    }
    const generation = ++this.operationGeneration;
    this.operation = 'check';
    this.publish(this.makeState('checking', { mandatory: required, version: this.knownVersion }));
    this.checkPromise = (async () => {
      try {
        this.configureFeed();
        const result = await this.updater.checkForUpdates();
        if (generation !== this.operationGeneration || !this.isActive()) return this.getState();
        if (!this.verifyUpdate(result?.updateInfo)) {
          throw new UpdateManagerError('UPDATE_SIGNATURE_INVALID', 'Update metadata signature is invalid.');
        }
        if (!result?.isUpdateAvailable) {
          this.cancellationToken = null;
          if (required && this.knownVersion) {
            const state = this.publish(this.makeState('error', {
              mandatory: true,
              version: this.knownVersion,
              errorCode: 'UPDATE_CHECK_FAILED',
              errorMessage: 'The required update is temporarily unavailable. Try again.',
            }));
            this.scheduleCheck(CHECK_RETRY_MS, true);
            return state;
          }
          this.clearInvalidRequirement();
          const state = this.publish(this.makeState('current'));
          this.scheduleCheck(CHECK_INTERVAL_MS);
          return state;
        }
        const version = sanitizeVersion(result.updateInfo?.version);
        if (!version || !parseStableVersion(version)) throw new UpdateManagerError('UPDATE_METADATA_INVALID', 'Update metadata is invalid.');
        if (this.knownVersion && compareStableVersions(version, this.knownVersion) === -1) {
          throw new UpdateManagerError('UPDATE_METADATA_INVALID', 'Update metadata is older than the required version.');
        }
        this.rememberRequiredVersion(version);
        this.cancellationToken = result.cancellationToken || null;
        return this.publish(this.makeState('available', { mandatory: true, version }));
      } catch {
        if (generation !== this.operationGeneration || !this.isActive()) return this.getState();
        const mandatory = Boolean(required || this.knownVersion || this.requirementStateInvalid);
        const state = this.publish(this.makeState('error', {
          mandatory,
          version: this.knownVersion,
          errorCode: 'UPDATE_CHECK_FAILED',
          errorMessage: mandatory
            ? 'The required update is temporarily unavailable. Try again.'
            : 'Updates could not be checked. Try again.',
        }));
        this.scheduleCheck(CHECK_RETRY_MS, mandatory);
        return state;
      } finally {
        if (generation === this.operationGeneration) {
          this.operation = null;
          this.checkPromise = null;
        }
      }
    })();
    return this.checkPromise;
  }

  async download() {
    this.requireActive();
    if (this.downloadPromise) return this.downloadPromise;
    const retrying = this.state.status === 'error' && this.state.mandatory;
    if (this.state.status !== 'available' && !retrying) {
      throw new UpdateManagerError('UPDATE_STATE_INVALID', 'An update download is not allowed in the current state.');
    }
    const generation = ++this.operationGeneration;
    this.operation = 'download';
    this.publish(this.makeState('downloading', {
      mandatory: true,
      version: this.knownVersion,
      progress: EMPTY_PROGRESS,
    }));
    this.downloadPromise = (async () => {
      try {
        const feed = buildFeed(this.authService.getUpdateCredentials());
        this.updater.requestHeaders = feed.headers;
        await this.updater.downloadUpdate(this.cancellationToken || undefined);
        if (generation !== this.operationGeneration || !this.isActive()) return this.getState();
        return this.publish(this.makeState('downloaded', { mandatory: true, version: this.knownVersion }));
      } catch {
        if (generation !== this.operationGeneration || !this.isActive()) return this.getState();
        return this.publish(this.makeState('error', {
          mandatory: true,
          version: this.knownVersion,
          errorCode: 'UPDATE_DOWNLOAD_FAILED',
          errorMessage: 'The required update could not be prepared. Try again.',
        }));
      } finally {
        if (generation === this.operationGeneration) {
          this.operation = null;
          this.downloadPromise = null;
        }
      }
    })();
    return this.downloadPromise;
  }

  handleProgress(progress) {
    if (this.operation !== 'download' || !this.isActive() || this.state.status !== 'downloading') return;
    this.publish(this.makeState('downloading', {
      mandatory: true,
      version: this.knownVersion,
      progress,
    }));
  }

  handleDownloaded() {
    if (this.operation !== 'download' || !this.isActive()) return;
    this.publish(this.makeState('downloaded', { mandatory: true, version: this.knownVersion }));
  }

  handleUpdaterError() {
    if (!this.operation || !this.isActive()) return;
    const installing = this.operation === 'install';
    if (installing) {
      this.installApprovalRelease?.();
      this.installApprovalRelease = null;
    }
    this.publish(this.makeState('error', {
      mandatory: Boolean(this.knownVersion),
      version: this.knownVersion,
      errorCode: installing
        ? 'UPDATE_INSTALL_FAILED'
        : (this.knownVersion ? 'UPDATE_DOWNLOAD_FAILED' : 'UPDATE_CHECK_FAILED'),
      errorMessage: installing
        ? 'The required update could not be installed. Try again.'
        : (this.knownVersion
        ? 'The required update could not be prepared. Try again.'
        : 'Updates could not be checked. Try again.'),
    }));
  }

  install() {
    this.requireActive();
    if (this.operation === 'install' || this.state.status !== 'downloaded' || !this.knownVersion) {
      throw new UpdateManagerError('UPDATE_STATE_INVALID', 'An update install is not allowed in the current state.');
    }
    const mainWindow = this.getMainWindow?.();
    this.installApprovalRelease = this.prepareWindowForUpdateInstall(mainWindow);
    this.operation = 'install';
    try {
      this.updater.quitAndInstall(true, true);
      return this.getState();
    } catch {
      this.installApprovalRelease?.();
      this.installApprovalRelease = null;
      this.operation = null;
      return this.publish(this.makeState('error', {
        mandatory: true,
        version: this.knownVersion,
        errorCode: 'UPDATE_INSTALL_FAILED',
        errorMessage: 'The required update could not be installed. Try again.',
      }));
    }
  }

  dispose() {
    this.cancelCurrentOperation();
    this.clearScheduledCheck();
    this.clearUpdaterAccess();
    this.updater?.removeListener?.('download-progress', this.onProgress);
    this.updater?.removeListener?.('update-downloaded', this.onDownloaded);
    this.updater?.removeListener?.('error', this.onUpdaterError);
    this.initialized = false;
  }
}

function setupUpdateHandlers(ipcMain, manager) {
  ipcMain.handle('updates:get-state', () => manager.getState());
  ipcMain.handle('updates:check', () => manager.check());
  ipcMain.handle('updates:download', () => manager.download());
  ipcMain.handle('updates:install', () => manager.install());
}

module.exports = {
  CHECK_INTERVAL_MS,
  CHECK_RETRY_MS,
  UPDATE_EVENT,
  UpdateManager,
  UpdateManagerError,
  buildFeed,
  compareStableVersions,
  parseStableVersion,
  sanitizeProgress,
  setupUpdateHandlers,
};
