import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import './PreviewCenter.css';

const INITIAL_WEB = { available: false, state: 'loading', url: null, error: null, logs: [] };
const INITIAL_ANDROID = { available: false, emulatorState: 'loading', appState: 'stopped', logs: [] };
const VIEWPORTS = { desktop: 1440, tablet: 820, mobile: 390 };

function Icon({ name }) {
  const paths = {
    play: <path d="m8 5 11 7-11 7V5Z" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    reload: <><path d="M20 6v5h-5"/><path d="M19 11a8 8 0 1 0 .2 5"/></>,
    external: <><path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
    device: <><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function StateDot({ state }) {
  const active = ['ready', 'running'].includes(state);
  const busy = ['loading', 'starting', 'stopping'].includes(state);
  return <span className={`preview-state-dot ${active ? 'is-active' : ''} ${busy ? 'is-busy' : ''}`} />;
}

export default function PreviewCenter({ project }) {
  const { language, t } = useI18n();
  const api = window.electronAPI?.preview;
  const [tab, setTab] = useState('web');
  const [viewport, setViewport] = useState('desktop');
  const [web, setWeb] = useState(INITIAL_WEB);
  const [android, setAndroid] = useState(INITIAL_ANDROID);
  const [logs, setLogs] = useState([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [actionError, setActionError] = useState('');
  const logsEnd = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setWeb(INITIAL_WEB);
    setAndroid(INITIAL_ANDROID);
    setLogs([]);
    Promise.all([api?.web.status(project.path), api?.android.status(project.path)])
      .then(([webStatus, androidStatus]) => {
        if (cancelled) return;
        setWeb(webStatus);
        setAndroid(androidStatus);
        setLogs([...(webStatus.logs || []), ...(androidStatus.logs || [])].slice(-250));
      })
      .catch((error) => !cancelled && setActionError(error.message));
    const offWeb = api?.web.onStatus((status) => setWeb(status));
    const offAndroid = api?.android.onStatus((status) => setAndroid(status));
    const offLog = api?.onLog((entry) => setLogs((current) => [...current, entry].slice(-250)));
    return () => { cancelled = true; offWeb?.(); offAndroid?.(); offLog?.(); };
  }, [api, project.path]);

  useEffect(() => { if (logsOpen) logsEnd.current?.scrollIntoView({ block: 'nearest' }); }, [logs, logsOpen]);

  const act = async (operation) => {
    setActionError('');
    try { await operation(); } catch (error) { setActionError(error?.message || t('preview.actionFailed')); }
  };
  const webBusy = ['starting', 'stopping'].includes(web.state);
  const emulatorBusy = ['starting', 'stopping'].includes(android.emulatorState);
  const appBusy = ['starting', 'stopping'].includes(android.appState);
  const visibleLogs = logs.filter((entry) => entry.target === tab);

  return (
    <section className="preview-center">
      <header className="preview-header">
        <div>
          <span className="preview-eyebrow">{t('preview.eyebrow')}</span>
          <h1>{t('preview.title')}</h1>
          <p>{t('preview.subtitle')}</p>
        </div>
        <div className="preview-tabs" role="tablist" aria-label={t('preview.title')}>
          <button className={tab === 'web' ? 'is-active' : ''} onClick={() => setTab('web')} role="tab" aria-selected={tab === 'web'}>{t('preview.web')}</button>
          <button className={tab === 'android' ? 'is-active' : ''} onClick={() => setTab('android')} role="tab" aria-selected={tab === 'android'}>{t('preview.android')}</button>
        </div>
      </header>

      {actionError && <div className="preview-alert" role="alert">{actionError}<button onClick={() => setActionError('')} aria-label={t('common.close')}>×</button></div>}

      {tab === 'web' ? (
        <div className="preview-workspace">
          <div className="preview-toolbar">
            <div className="preview-status"><StateDot state={web.state} /><span>{t(`preview.webStates.${web.state}`)}</span></div>
            <div className="preview-viewport-switcher" aria-label={t('preview.viewport')}>
              {Object.keys(VIEWPORTS).map((name) => <button key={name} className={viewport === name ? 'is-active' : ''} onClick={() => setViewport(name)} title={t(`preview.${name}`)}>{t(`preview.${name}`)}</button>)}
            </div>
            <div className="preview-actions">
              <button className="preview-icon-button" disabled={web.state !== 'ready'} onClick={() => setFrameKey((key) => key + 1)} title={t('preview.reload')}><Icon name="reload" /></button>
              <button className="preview-icon-button" disabled={web.state !== 'ready'} onClick={() => act(() => api.web.openExternal(project.path))} title={t('preview.openBrowser')}><Icon name="external" /></button>
              {['starting', 'ready', 'stopping'].includes(web.state)
                ? <button className="preview-button is-danger" disabled={web.state === 'stopping'} onClick={() => act(() => api.web.stop(project.path))}><Icon name="stop" />{t('preview.stop')}</button>
                : <button className="preview-button is-primary" disabled={webBusy || web.state === 'loading' || !web.available} onClick={() => act(() => api.web.start(project.path))}><Icon name="play" />{t('preview.startWeb')}</button>}
            </div>
          </div>
          <div className="preview-stage">
            {web.state === 'ready' && web.url === 'http://127.0.0.1:4173' ? (
              <div className="preview-browser" style={{ '--preview-width': `${VIEWPORTS[viewport]}px` }}>
                <div className="preview-browser-bar"><i/><i/><i/><span>127.0.0.1:4173</span></div>
                <iframe key={frameKey} src="http://127.0.0.1:4173" title={t('preview.webFrameTitle')} sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" />
              </div>
            ) : <EmptyState icon="external" busy={['loading', 'starting', 'stopping'].includes(web.state)} title={!web.available && web.state !== 'loading' ? t('preview.noWeb') : web.error || t(`preview.webEmpty.${web.state}`)} copy={!web.available && web.state !== 'loading' ? t('preview.noWebCopy') : t(`preview.webEmptyCopy.${web.state}`)} />}
          </div>
        </div>
      ) : (
        <div className="preview-workspace android-workspace">
          <div className="android-device-card">
            <div className="android-device-visual"><Icon name="device" /><span>API 35</span></div>
            <div className="android-device-copy">
              <span className="preview-eyebrow">{t('preview.androidDevice')}</span>
              <h2>Vibe_API_35</h2>
              <p>{t('preview.androidDeviceCopy')}</p>
              <div className="android-state-row"><StateDot state={android.emulatorState} />{t(`preview.deviceStates.${android.emulatorState}`)}{android.serial && <code>{android.serial}</code>}</div>
            </div>
            <div className="android-device-actions">
              {['starting', 'running', 'stopping'].includes(android.emulatorState)
                ? <button className="preview-button is-danger" disabled={emulatorBusy} onClick={() => act(() => api.android.stopEmulator(project.path))}><Icon name="stop" />{t('preview.stopDevice')}</button>
                : <button className="preview-button is-primary" disabled={emulatorBusy || android.emulatorState === 'loading'} onClick={() => act(() => api.android.startEmulator(project.path))}><Icon name="play" />{t('preview.startDevice')}</button>}
            </div>
          </div>
          <div className="android-run-card">
            <div><span className="preview-step">02</span><h3>{t('preview.runFlutter')}</h3><p>{android.available ? t('preview.runFlutterCopy') : t('preview.noMobile')}</p></div>
            <div className="android-run-side">
              <div className="preview-status"><StateDot state={android.appState} />{t(`preview.appStates.${android.appState}`)}</div>
              {['starting', 'running', 'stopping'].includes(android.appState)
                ? <button className="preview-button is-danger" disabled={appBusy} onClick={() => act(() => api.android.stopApp(project.path))}><Icon name="stop" />{t('preview.stopApp')}</button>
                : <button className="preview-button is-primary" disabled={appBusy || android.emulatorState !== 'running' || !android.available} onClick={() => act(() => api.android.runApp(project.path))}><Icon name="play" />{t('preview.runApp')}</button>}
            </div>
          </div>
          {(android.emulatorError || android.appError) && <div className="preview-inline-error">{android.appError || android.emulatorError}</div>}
        </div>
      )}

      <div className={`preview-logs ${logsOpen ? 'is-open' : ''}`}>
        <button className="preview-logs-toggle" onClick={() => setLogsOpen((open) => !open)} aria-expanded={logsOpen}><span>{t('preview.logs')}</span><span>{visibleLogs.length} {t('preview.lines')}</span><b>{logsOpen ? '−' : '+'}</b></button>
        {logsOpen && <div className="preview-log-output">{visibleLogs.length ? visibleLogs.map((entry, index) => <div key={`${entry.timestamp}-${index}`} className={entry.stream === 'stderr' ? 'is-error' : ''}><time>{new Date(entry.timestamp).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>{entry.line}</span></div>) : <p>{t('preview.noLogs')}</p>}<span ref={logsEnd} /></div>}
      </div>
    </section>
  );
}

function EmptyState({ icon, busy, title, copy }) {
  return <div className="preview-empty"><div className={`preview-empty-icon ${busy ? 'is-busy' : ''}`}><Icon name={icon} /></div><h2>{title}</h2><p>{copy}</p></div>;
}
