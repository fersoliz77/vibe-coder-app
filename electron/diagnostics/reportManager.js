const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog } = require('electron');
const { sanitize } = require('./logger');

const REPORT_VERSION = 1;
const EXPORT_COOLDOWN_MS = 1_000;

function createReport({ diagnostics, authService, appVersion = app.getVersion(), platform = process.platform, arch = process.arch, release = os.release() }) {
  const auth = authService.getState();
  return sanitize({
    reportVersion: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    application: { version: appVersion },
    platform: { name: platform, arch, release },
    policy: {
      value: auth.policy,
      reason: auth.restrictionReason || auth.error?.code || null,
      authenticated: auth.authenticated,
      configurationReady: auth.configurationReady,
    },
    technicalStates: diagnostics.getStates(),
    events: diagnostics.getEvents(),
  });
}

function setupDiagnosticsHandlers(ipcMain, getMainWindow, diagnostics, authService, dependencies = {}) {
  const showSaveDialog = dependencies.showSaveDialog || dialog.showSaveDialog;
  const writeFile = dependencies.writeFile || fs.promises.writeFile;
  const now = dependencies.now || Date.now;
  let activeExport = null;
  let lastDialogAt = -Infinity;
  ipcMain.handle('diagnostics:export', async (event) => {
    const mainWindow = getMainWindow?.();
    if (!mainWindow || mainWindow.isDestroyed?.() || event?.sender !== mainWindow.webContents) {
      const error = new Error('Diagnostic export is only available to the main application window.');
      error.code = 'DIAGNOSTICS_INVALID_SENDER';
      throw error;
    }
    if (activeExport) return { exported: false, canceled: false, busy: true };
    const requestedAt = now();
    if (requestedAt - lastDialogAt < EXPORT_COOLDOWN_MS) return { exported: false, canceled: false, rateLimited: true };
    lastDialogAt = requestedAt;
    activeExport = (async () => {
      const result = await showSaveDialog(mainWindow, {
        title: 'Export local diagnostic report',
        defaultPath: `vibe-ide-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return { exported: false, canceled: true };
      const report = createReport({ diagnostics, authService, ...dependencies.reportOptions });
      await writeFile(path.resolve(result.filePath), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      diagnostics.log('diagnostics', 'report-exported', { success: true });
      return { exported: true, canceled: false };
    })();
    try {
      return await activeExport;
    } finally {
      activeExport = null;
    }
  });
}

module.exports = { EXPORT_COOLDOWN_MS, REPORT_VERSION, createReport, setupDiagnosticsHandlers };
