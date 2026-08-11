const { randomUUID } = require('crypto');

const LEARNING_ORIGIN = 'https://vibe-ide-code.vercel.app';
const SIDEBAR_WIDTH = 72;
const TITLEBAR_HEIGHT = 40;

function isTrustedLearningUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.origin === LEARNING_ORIGIN && !url.username && !url.password;
  } catch {
    return false;
  }
}

function publicFailure() {
  return {
    ok: false,
    error: {
      code: 'AUTH_LEARNING_OPEN_FAILED',
      message: 'The learning platform could not be opened.',
    },
  };
}

class LearningViewManager {
  constructor({ WebContentsView, authService, getMainWindow = () => null } = {}) {
    this.WebContentsView = WebContentsView;
    this.authService = authService;
    this.getMainWindow = getMainWindow;
    this.view = null;
    this.pendingView = null;
    this.hostWindow = null;
    this.generation = 0;
    this.resize = () => this.updateBounds();
    this.windowClosed = () => this.close(false);
  }

  publish(state) {
    const mainWindow = this.getMainWindow?.();
    if (mainWindow && !mainWindow.isDestroyed?.()) {
      mainWindow.webContents.send('learning:state-changed', state);
    }
  }

  updateBounds() {
    if (!this.view || this.view.webContents.isDestroyed?.()) return;
    const bounds = this.hostWindow?.getContentBounds?.();
    if (!bounds) return;
    this.view.setBounds({
      x: SIDEBAR_WIDTH,
      y: TITLEBAR_HEIGHT,
      width: Math.max(0, bounds.width - SIDEBAR_WIDTH),
      height: Math.max(0, bounds.height - TITLEBAR_HEIGHT),
    });
  }

  configureView(view) {
    const webContents = view.webContents;
    const isolatedSession = webContents.session;
    isolatedSession.setPermissionCheckHandler(() => false);
    isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolatedSession.on('will-download', (event) => event.preventDefault());

    const keepNavigationTrusted = (event, targetUrl) => {
      if (!isTrustedLearningUrl(targetUrl)) event.preventDefault();
    };
    webContents.on('will-navigate', keepNavigationTrusted);
    webContents.on('will-redirect', keepNavigationTrusted);
    webContents.setWindowOpenHandler(({ url }) => {
      if (isTrustedLearningUrl(url)) {
        setImmediate(() => {
          if (!webContents.isDestroyed?.()) webContents.loadURL(url).catch(() => {});
        });
      }
      return { action: 'deny' };
    });
    webContents.on('render-process-gone', () => this.close());
  }

  destroyView(view) {
    if (!view) return;
    try { view.webContents.session.clearStorageData().catch(() => {}); } catch {}
    try { view.webContents.close(); } catch {}
  }

  async open() {
    this.close(false);
    const generation = this.generation;
    this.publish({ status: 'loading' });
    let view;
    try {
      const prepared = await this.authService.prepareLearning();
      if (generation !== this.generation) return { ok: false, cancelled: true };
      if (!isTrustedLearningUrl(prepared.target)) throw new Error('Untrusted learning URL.');

      view = new this.WebContentsView({
        webPreferences: {
          partition: `vibe-learning-${randomUUID()}`,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      });
      this.pendingView = view;
      this.configureView(view);
      await view.webContents.loadURL(prepared.target);
      if (generation !== this.generation || view.webContents.isDestroyed?.()) {
        this.destroyView(view);
        return { ok: false, cancelled: true };
      }

      const mainWindow = this.getMainWindow?.();
      if (!mainWindow || mainWindow.isDestroyed?.()) throw new Error('Main window is unavailable.');
      this.pendingView = null;
      this.view = view;
      this.hostWindow = mainWindow;
      mainWindow.contentView.addChildView(view);
      mainWindow.on('resize', this.resize);
      mainWindow.once('closed', this.windowClosed);
      this.updateBounds();
      this.publish({ status: 'ready' });
      return { ok: true, handoff: prepared.handoff };
    } catch {
      if (view) this.destroyView(view);
      if (this.pendingView === view) this.pendingView = null;
      if (generation !== this.generation) return { ok: false, cancelled: true };
      const failure = publicFailure();
      this.publish({ status: 'error', error: failure.error });
      return failure;
    }
  }

  close(notify = true) {
    this.generation += 1;
    if (this.hostWindow && !this.hostWindow.isDestroyed?.()) {
      this.hostWindow.removeListener('resize', this.resize);
      this.hostWindow.removeListener('closed', this.windowClosed);
      if (this.view) {
        try { this.hostWindow.contentView.removeChildView(this.view); } catch {}
      }
    }
    this.destroyView(this.view);
    this.destroyView(this.pendingView);
    this.view = null;
    this.pendingView = null;
    this.hostWindow = null;
    if (notify) this.publish({ status: 'closed' });
    return { ok: true };
  }
}

module.exports = { LEARNING_ORIGIN, LearningViewManager, isTrustedLearningUrl };
