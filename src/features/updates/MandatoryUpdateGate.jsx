import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useI18n } from '../../i18n/I18nContext';
import './MandatoryUpdateGate.css';

const PASS_THROUGH_STATUSES = new Set(['current', 'disabled']);

function UpdateTitlebar() {
  const { t } = useI18n();
  return (
    <div className="titlebar update-titlebar">
      <div className="titlebar__brand">
        <div className="titlebar__logo">V</div>
        <span className="titlebar__name">Vibe IDE Code</span>
      </div>
      <div className="titlebar__controls">
        <button className="titlebar__btn" type="button" onClick={() => window.electronAPI.window.minimize()} title={t('common.minimize')} aria-label={t('common.minimize')}>
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 8h10v1H3z" /></svg>
        </button>
        <button className="titlebar__btn" type="button" onClick={() => window.electronAPI.window.maximize()} title={t('common.maximize')} aria-label={t('common.maximize')}>
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3v10h10V3H3zm9 9H4V4h8v8z" /></svg>
        </button>
        <button className="titlebar__btn titlebar__btn--close" type="button" onClick={() => window.electronAPI.window.close()} title={t('common.close')} aria-label={t('common.close')}>
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 7.293l3.646-3.647.708.708L8.707 8l3.647 3.646-.708.708L8 8.707l-3.646 3.647-.708-.708L7.293 8 3.646 4.354l.708-.708L8 7.293z" /></svg>
        </button>
      </div>
    </div>
  );
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** exponent)).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function errorMessage(state, t) {
  const code = state?.error?.code;
  if (code === 'UPDATE_DOWNLOAD_FAILED') return t('updates.errors.download');
  if (code === 'UPDATE_INSTALL_FAILED') return t('updates.errors.install');
  return t('updates.errors.check');
}

function UpdateScreen({ state, overlay, onDownload, onInstall, onRetry, busy, actionError }) {
  const { t } = useI18n();
  const cardRef = useRef(null);
  const status = state?.status || 'checking';
  const version = state?.version || '';
  const progress = Math.round(state?.progress?.percent || 0);
  const transferred = formatSize(state?.progress?.transferred);
  const total = formatSize(state?.progress?.total);
  const download = state?.download || {};
  const optimizedBytes = download.mode === 'differential' && download.installerSize > download.total
    ? formatSize(download.installerSize - download.total)
    : '';
  const modeCopy = download.mode === 'differential'
    ? t('updates.differentialMode', { saved: optimizedBytes || t('updates.calculating') })
    : download.mode === 'full' && download.fallback
      ? t('updates.fullFallbackMode')
      : download.mode === 'full'
        ? t('updates.fullMode')
        : t('updates.evaluatingMode');

  useFocusTrap({ active: true, containerRef: cardRef });

  let title = t('updates.checkingTitle');
  let copy = t('updates.checkingCopy');
  if (status === 'available') {
    title = t('updates.availableTitle');
    copy = t('updates.availableCopy', { version });
  } else if (status === 'downloading') {
    title = t('updates.downloadingTitle');
    copy = t('updates.downloadingCopy');
  } else if (status === 'downloaded') {
    title = t('updates.downloadedTitle');
    copy = t('updates.downloadedCopy', { version });
  } else if (status === 'error') {
    title = t('updates.errorTitle');
    copy = errorMessage(state, t);
  }

  return (
    <div className={`update-gate${overlay ? ' update-gate--overlay' : ''}`} role="dialog" aria-modal="true" aria-labelledby="update-title">
      <UpdateTitlebar />
      <div className="update-gate__field" aria-hidden="true"><span /><span /><span /></div>
      <main ref={cardRef} className="update-card">
        <div className="update-card__edition">
          <span>{t('updates.requiredEyebrow')}</span>
          {version && <code>v{version}</code>}
        </div>
        <div className="update-card__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none"><path d="M16 5v15m0 0 6-6m-6 6-6-6M7 25h18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <h1 id="update-title">{title}</h1>
        <p className="update-card__copy" role="status" aria-live="polite">{copy}</p>

        {status === 'downloading' && (
          <div className="update-progress">
            <div className="update-progress__meta">
              <span>{t('updates.progress')}</span>
              <strong>{progress}%</strong>
            </div>
            <div className="update-progress__track" role="progressbar" aria-label={t('updates.progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <p className={`update-progress__mode update-progress__mode--${download.mode || 'evaluating'}`}>{modeCopy}</p>
            {transferred && total && <small>{t('updates.transferred', { transferred, total })}</small>}
          </div>
        )}

        {status === 'downloaded' && state?.download && <p className={`update-progress__mode update-progress__mode--${download.mode}`}>{modeCopy}</p>}

        {actionError && <p className="update-card__error" role="alert">{actionError}</p>}

        <div className="update-card__actions">
          {status === 'available' && <button type="button" onClick={onDownload} disabled={busy}>{busy ? t('updates.starting') : t('updates.download')}</button>}
          {status === 'downloaded' && <button type="button" onClick={onInstall} disabled={busy}>{busy ? t('updates.restarting') : t('updates.restart')}</button>}
          {status === 'error' && state.mandatory && <button type="button" onClick={onRetry} disabled={busy}>{busy ? t('updates.retrying') : t('updates.retry')}</button>}
        </div>

        <div className="update-card__assurance">
          <span aria-hidden="true">✓</span>
          <p><strong>{t('updates.securityTitle')}</strong>{t('updates.securityCopy')}</p>
        </div>
      </main>
    </div>
  );
}

export default function MandatoryUpdateGate({ children, prepareToRestart }) {
  const { t } = useI18n();
  const [state, setState] = useState(null);
  const [admitted, setAdmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const latestRevision = useRef(-1);

  useEffect(() => {
    const updates = window.electronAPI?.updates;
    if (!updates) {
      setState({ status: 'disabled', blocking: false, mandatory: false });
      return undefined;
    }
    let active = true;
    const acceptState = (nextState) => {
      const revision = Number.isInteger(nextState?.revision) ? nextState.revision : 0;
      if (!active || revision < latestRevision.current) return;
      latestRevision.current = revision;
      setState(nextState);
    };
    const unsubscribe = updates.onStateChanged(acceptState);
    updates.getState()
      .then(acceptState)
      .catch(() => {
        if (active && latestRevision.current < 0) setState({ status: 'error', blocking: false, mandatory: false });
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const mayEnter = Boolean(state && (PASS_THROUGH_STATUSES.has(state.status) || (state.status === 'error' && !state.blocking)));
  useEffect(() => {
    if (mayEnter) setAdmitted(true);
  }, [mayEnter]);

  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    setActionError('');
    try {
      await window.electronAPI.updates[action]();
    } catch {
      setActionError(t('updates.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (busy) return;
    setActionError('');
    if (prepareToRestart && await prepareToRestart() === false) {
      setActionError(t('updates.unsavedCancelled'));
      return;
    }
    await run('install');
  };

  const showChildren = admitted || mayEnter;
  // AuthGate owns restricted/denied recovery. Keep the discovered mandatory
  // version in main, but do not cover the account actions while updates are disabled.
  const showUpdate = state?.status !== 'disabled' && (!showChildren || Boolean(state?.blocking));

  return (
    <>
      {showChildren && (
        <div className="update-gate__workspace" inert={showUpdate ? '' : undefined} aria-hidden={showUpdate ? 'true' : undefined}>
          {children}
        </div>
      )}
      {showUpdate && (
        <UpdateScreen
          state={state}
          overlay={showChildren}
          busy={busy}
          actionError={actionError}
          onDownload={() => run('download')}
          onInstall={install}
          onRetry={() => run(state?.error?.code === 'UPDATE_CHECK_FAILED' ? 'check' : 'download')}
        />
      )}
    </>
  );
}
