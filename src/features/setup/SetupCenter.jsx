import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import './SetupCenter.css';
import { useI18n } from '../../i18n/I18nContext';
import { CheckIcon, AlertIcon } from '../../components/icons/StatusIcons';

const ENVIRONMENT_OPTIONS = Object.freeze({ includeMobile: true, backend: 'firebase' });

function StatusIcon({ installed, checking }) {
  if (checking) return <span className="setup-center__spinner" aria-hidden="true" />;
  return (
    <span className={`setup-center__status-icon ${installed ? 'is-ready' : 'is-missing'}`} aria-hidden="true">
      {installed ? <CheckIcon size={14} /> : <AlertIcon size={14} />}
    </span>
  );
}

function EnvironmentItem({ item, checking, t }) {
  return (
    <article className={`setup-center__item ${item?.installed ? 'is-ready' : 'is-missing'}`}>
      <StatusIcon installed={item?.installed} checking={checking} />
      <div className="setup-center__item-copy">
        <div className="setup-center__item-title">
          <strong>{item?.name || t('setup.component')}</strong>
          <span className={`setup-center__requirement ${item?.required ? 'is-required' : ''}`}>
            {item?.required ? t('setup.required') : t('setup.optional')}
          </span>
        </div>
        <p>{checking ? t('setup.checking') : item?.installed ? item.version || t('setup.installed') : item?.instruction || t('setup.notInstalled')}</p>
        {item?.path && <code title={item.path}>{item.path}</code>}
      </div>
    </article>
  );
}

export default function SetupCenter({ compact = false }) {
  const { t } = useI18n();
  const checkSequence = useRef(0);
  const [environment, setEnvironment] = useState(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmDialogRef = useRef(null);
  const confirmBackRef = useRef(null);

  // Instalar el entorno completo es costoso y dificil de revertir: el foco
  // arranca en "Volver" y no puede salir del dialogo.
  useFocusTrap({
    active: confirming,
    containerRef: confirmDialogRef,
    onEscape: () => setConfirming(false),
    initialFocusRef: confirmBackRef,
  });
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const [log, setLog] = useState([]);
  const [openCode, setOpenCode] = useState({ loading: true, installing: false, status: null, error: '', progress: '' });

  const api = typeof window !== 'undefined' ? window.electronAPI?.setup : null;
  const options = ENVIRONMENT_OPTIONS;

  const check = async () => {
    const sequence = ++checkSequence.current;
    if (!api?.check) {
      setChecking(false);
      setError(t('setup.unavailableApi'));
      return;
    }
    setChecking(true);
    setError('');
    try {
      const result = await api.check(options);
      if (sequence !== checkSequence.current) return;
      setEnvironment(result);
      if (!result.supported) setError(result.error || t('setup.unsupported'));
    } catch (checkError) {
      if (sequence !== checkSequence.current) return;
      setError(checkError?.message || t('setup.checkFailed'));
    } finally {
      if (sequence === checkSequence.current) setChecking(false);
    }
  };

  useEffect(() => {
    check();
  }, [t]);

  const checkOpenCode = async () => {
    if (!window.electronAPI?.opencode?.getStatus) {
      setOpenCode({ loading: false, installing: false, status: null, error: t('setup.unavailableApi'), progress: '' });
      return;
    }
    setOpenCode((current) => ({ ...current, loading: true, error: '', progress: '' }));
    try {
      const status = await window.electronAPI.opencode.getStatus();
      setOpenCode({ loading: false, installing: false, status, error: '', progress: '' });
    } catch (error) {
      setOpenCode({ loading: false, installing: false, status: null, error: error?.message || t('app.openCodeCheckFailed'), progress: '' });
    }
  };

  useEffect(() => {
    checkOpenCode();
  }, [t]);

  useEffect(() => {
    if (!window.electronAPI?.opencode?.onInstallProgress) return undefined;
    return window.electronAPI.opencode.onInstallProgress((event) => {
      setOpenCode((current) => current.installing
        ? { ...current, progress: event?.message || current.progress }
        : current);
    });
  }, []);

  useEffect(() => {
    if (!api?.onProgress) return undefined;
    return api.onProgress((event) => {
      setProgress(event);
      if (event?.message) setLog((current) => [...current.slice(-7), event.message]);
    });
  }, [api]);

  const install = async () => {
    setConfirming(false);
    setInstalling(true);
    setError('');
    setLog([]);
    try {
      const result = await api.install(options);
      if (!result.success && !result.cancelled) setError(result.error || t('setup.installFailed'));
      if (result.environment) setEnvironment(result.environment);
      else await check();
    } catch (installError) {
      setError(installError?.message || t('setup.installEnvironmentFailed'));
    } finally {
      setInstalling(false);
    }
  };

  const cancel = async () => {
    try { await api?.cancel?.(); } catch {}
  };

  const installOpenCode = async () => {
    if (!window.electronAPI?.opencode?.install) return;
    setOpenCode((current) => ({ ...current, installing: true, error: '', progress: t('setup.checkingOpenCode') }));
    try {
      const result = await window.electronAPI.opencode.install();
      if (!result?.success && !result?.cancelled) throw new Error(result?.error || t('app.openCodeInstallFailed'));
      if (result?.status) {
        setOpenCode({ loading: false, installing: false, status: result.status, error: '', progress: '' });
      } else {
        await checkOpenCode();
      }
    } catch (error) {
      setOpenCode((current) => ({ ...current, installing: false, error: error?.message || t('app.openCodeInstallFailed'), progress: '' }));
    }
  };

  const items = environment?.items || [];
  const required = items.filter((item) => item.required);
  const optional = items.filter((item) => !item.required);
  const percentage = progress?.total ? Math.round((Math.max(0, progress.current - (progress.type === 'step-start' ? 1 : 0)) / progress.total) * 100) : 0;

  return (
    <section className={`setup-center ${compact ? 'setup-center--compact' : ''}`} aria-labelledby="setup-center-title">
      <header className="setup-center__header">
        <div>
          <span className="setup-center__eyebrow">{t('setup.localEnvironment')}</span>
          <h2 id="setup-center-title">{t('setup.center')}</h2>
          <p>{t('setup.centerCopy')}</p>
        </div>
        <div className="setup-center__score" aria-label={t('setup.readyCount', { count: environment?.summary?.installed || 0, total: items.length || 0 })}>
          <strong>{environment?.summary?.installed || 0}</strong>
          <span>{t('setup.readyCount', { count: environment?.summary?.installed || 0, total: items.length || '—' })}</span>
        </div>
      </header>

      <div className="setup-center__controls">
        <p>{t('setup.includes')}</p>
        <button className="setup-center__button is-secondary" type="button" disabled={checking || installing} onClick={check}>
          {checking ? t('setup.checking') : t('setup.checkAgain')}
        </button>
      </div>

      {error && <div className="setup-center__notice is-error" role="alert">{error}</div>}

      <div className="setup-center__groups" aria-busy={checking}>
        <div className="setup-center__group">
          <div className="setup-center__group-heading"><h3>{t('setup.requiredPlural')}</h3><span>{required.filter((item) => item.installed).length}/{required.length}</span></div>
          <div className="setup-center__items">
            {required.map((item) => <EnvironmentItem key={item.id} item={item} checking={checking} t={t} />)}
            {!required.length && checking && <EnvironmentItem checking t={t} />}
            <article className={`setup-center__item setup-center__item--opencode ${openCode.status?.usable ? 'is-ready' : 'is-missing'}`} aria-labelledby="setup-opencode-title">
              <StatusIcon installed={openCode.status?.usable} checking={openCode.loading} />
              <div className="setup-center__item-copy">
                <div className="setup-center__item-title">
                  <strong id="setup-opencode-title">OpenCode</strong>
                  <span className="setup-center__requirement is-required">{t('setup.required')}</span>
                </div>
                <p>{openCode.loading ? t('setup.checkingOfficialExecutable') : openCode.status?.usable ? `${t('setup.ready')} · ${openCode.status.version || t('setup.installed')}` : openCode.status?.installed ? t('setup.installationDetectedRepair') : t('setup.notInstalled')}</p>
                <p>{openCode.loading ? t('setup.checking') : openCode.status?.authenticated ? t('setup.providers', { providers: openCode.status.providers.join(', ') }) : t('setup.connectProviders')}</p>
                {openCode.progress && <p>{openCode.progress}</p>}
                {openCode.error && <p className="setup-center__agent-error">{openCode.error}</p>}
              </div>
              {!openCode.loading && openCode.status && !openCode.status.installed && (
                <div className="setup-center__agent-actions">
                  <button className="setup-center__button is-primary" type="button" disabled={openCode.installing} onClick={installOpenCode}>{openCode.installing ? t('setup.installing') : t('setup.installOpenCode')}</button>
                </div>
              )}
            </article>
          </div>
        </div>
        {optional.length > 0 && (
          <div className="setup-center__group">
            <div className="setup-center__group-heading"><h3>{t('setup.optionalPlural')}</h3><span>{optional.filter((item) => item.installed).length}/{optional.length}</span></div>
            <div className="setup-center__items">{optional.map((item) => <EnvironmentItem key={item.id} item={item} checking={checking} t={t} />)}</div>
          </div>
        )}
      </div>

      {installing && (
        <div className="setup-center__progress" role="status" aria-live="polite">
          <div className="setup-center__progress-copy"><strong>{progress?.label || t('setup.preparingInstallation')}</strong><span>{progress?.message || t('setup.checkingRequirements')}</span></div>
          <div className="setup-center__progress-track"><span style={{ width: `${percentage}%` }} /></div>
          {log.length > 0 && <div className="setup-center__log">{log.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}</div>}
        </div>
      )}

      <footer className="setup-center__footer">
        <div>
          <strong>{environment?.summary?.requiredMissing ? t('setup.requirementsPending', { count: environment.summary.requiredMissing }) : t('setup.mainRequirementsReady')}</strong>
          <span>{t('setup.installFooterCopy')}</span>
        </div>
        {installing ? (
          <button className="setup-center__button is-danger" type="button" onClick={cancel}>{t('setup.cancel')}</button>
        ) : (
          <button className="setup-center__button is-primary" type="button" disabled={checking || !api?.install || environment?.supported === false} onClick={() => setConfirming(true)}>{t('setup.installAll')}</button>
        )}
      </footer>

      {confirming && (
        <div className="setup-center__dialog-backdrop" role="presentation" onMouseDown={() => setConfirming(false)}>
          <div ref={confirmDialogRef} className="setup-center__dialog" role="alertdialog" aria-modal="true" aria-labelledby="setup-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="setup-center__dialog-mark" aria-hidden="true">→</span>
            <h3 id="setup-confirm-title">{t('setup.confirmInstall')}</h3>
            <p>{t('setup.confirmCopy')}</p>
            <div className="setup-center__dialog-summary"><span>{t('setup.webMobileTools')} <strong>{t('setup.alwaysIncluded')}</strong></span></div>
            <div className="setup-center__dialog-actions">
              <button ref={confirmBackRef} className="setup-center__button is-secondary" type="button" onClick={() => setConfirming(false)}>{t('setup.back')}</button>
              <button className="setup-center__button is-primary" type="button" onClick={install}>{t('setup.confirmAndInstall')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
