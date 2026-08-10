import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import SetupCenter from '../setup/SetupCenter';
import { useI18n } from '../../i18n/I18nContext';
import { readAccessibility, saveAccessibility } from '../../utils/accessibility';
import './SettingsPanel.css';

// Los que el asistente de creacion exige o usa para el backend.
const DELIVERY_SERVICES = ['github', 'vercel', 'supabase', 'firebase'];

const SETTINGS_TABS = [
  { id: 'ai', labelKey: 'settings.tabs.ai', descriptionKey: 'settings.tabs.aiCopy' },
  { id: 'tools', labelKey: 'settings.tabs.tools', descriptionKey: 'settings.tabs.toolsCopy' },
  { id: 'connections', labelKey: 'settings.tabs.connections', descriptionKey: 'settings.tabs.connectionsCopy' },
  { id: 'preferences', labelKey: 'settings.tabs.preferences', descriptionKey: 'settings.tabs.preferencesCopy' },
  { id: 'account', labelKey: 'settings.tabs.account', descriptionKey: 'settings.tabs.accountCopy' },
  { id: 'support', labelKey: 'settings.tabs.support', descriptionKey: 'settings.tabs.supportCopy' },
];

function ProviderStatus({ name, detail, connected, loading }) {
  const { t } = useI18n();
  return (
    <div className="settings-provider">
      <span className={`status-dot ${loading ? 'status-dot--checking' : connected ? 'status-dot--connected' : 'status-dot--disconnected'}`} />
      <div>
        <strong>{name}</strong>
        <span>{loading ? t('settings.checking') : detail}</span>
      </div>
    </div>
  );
}

/*
 * GitHub y Vercel se comprobaban pero no se podian conectar desde ningun lado.
 * El asistente de creacion bloqueaba en el paso 5 pidiendo ambas cuentas y
 * mandaba a Configuracion, donde no habia ningun control. Aca esta el control:
 * el comando oficial de cada CLI, para copiar o ejecutar en la terminal del
 * proyecto abierto.
 */
function DeliveryProvider({ service, command, onRun, canRun }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* sin portapapeles queda el comando a la vista igual */ }
  };

  return (
    <div className="settings-delivery__item">
      <ProviderStatus
        name={service.name}
        loading={service.checking}
        connected={service.connected}
        detail={service.connected ? (service.user || t('settings.connected')) : t('settings.notConnected')}
      />
      {!service.connected && !service.checking && (
        command ? (
          <div className="settings-delivery__connect">
            <button className="btn btn--small" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
              {t('settings.connect')}
            </button>
            {open && (
              <div className="settings-delivery__command">
                <p className="settings-copy">{t('settings.connectManual')}</p>
                <code>{command}</code>
                <div className="settings-delivery__actions">
                  <button className="btn btn--small" type="button" onClick={copy}>{copied ? t('settings.connectCopied') : t('settings.connectCopy')}</button>
                  <button className="btn btn--small btn--ghost" type="button" disabled={!canRun} onClick={() => onRun(command)}>{t('settings.connectRun')}</button>
                </div>
                {!canRun && <small className="settings-delivery__hint">{t('settings.connectNeedsProject')}</small>}
              </div>
            )}
          </div>
        ) : (
          <small className="settings-delivery__hint">{t('settings.connectNoCommand')}</small>
        )
      )}
    </div>
  );
}

export default function SettingsPanel({ theme, onSetTheme, onReopenOnboarding, onRunInTerminal, canRunInTerminal = false }) {
  const { state, revalidate, logout } = useAuth();
  const { language, setLanguage, t, formatDate } = useI18n();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [accessibility, setAccessibility] = useState(readAccessibility);
  const [providers, setProviders] = useState({ loading: true, claude: null, openai: null, opencode: null, error: '' });
  const [delivery, setDelivery] = useState({ loading: true, services: [], commands: {}, error: '' });
  const [activeTab, setActiveTab] = useState('ai');
  const [updateState, setUpdateState] = useState({ status: 'disabled', progress: null, error: null, revision: -1 });
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateToast, setUpdateToast] = useState(null);
  const tabsRef = useRef(null);
  const updateRevisionRef = useRef(-1);
  const updateToastTimerRef = useRef(null);

  const handleTabKeyDown = (event) => {
    const current = SETTINGS_TABS.findIndex((tab) => tab.id === activeTab);
    let next = null;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = SETTINGS_TABS.length - 1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % SETTINGS_TABS.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    if (next === null) return;
    event.preventDefault();
    setActiveTab(SETTINGS_TABS[next].id);
    requestAnimationFrame(() => tabsRef.current?.querySelectorAll('[role="tab"]')[next]?.focus());
  };
  const [exportState, setExportState] = useState({ busy: false, message: '' });

  const refreshProviders = async () => {
    setProviders((current) => ({ ...current, loading: true, error: '' }));
    try {
      const [claudeResult, openaiResult, openCodeResult] = await Promise.allSettled([
        window.electronAPI.claude.getStatus(),
        window.electronAPI.openai.getStatus(),
        window.electronAPI.opencode.getStatus(),
      ]);
      const claude = claudeResult.status === 'fulfilled' ? claudeResult.value : null;
      const openai = openaiResult.status === 'fulfilled' ? openaiResult.value : null;
      const opencode = openCodeResult.status === 'fulfilled' ? openCodeResult.value : null;
      const failed = [claudeResult, openaiResult, openCodeResult].some((result) => result.status === 'rejected');
      setProviders({ loading: false, claude, openai, opencode, error: failed ? t('settings.providerUnavailable') : '' });
    } catch {
      setProviders({ loading: false, claude: null, openai: null, opencode: null, error: t('settings.statusUnavailable') });
    }
  };

  const refreshDelivery = async () => {
    setDelivery((current) => ({ ...current, loading: true, error: '' }));
    try {
      // Sin ruta de proyecto: lo que interesa aca es la cuenta, no el vinculo.
      const results = await window.electronAPI.services.checkAll(null);
      const commands = {};
      await Promise.all(DELIVERY_SERVICES.map(async (id) => {
        try {
          const { command } = await window.electronAPI.services.connect(id, null) ?? {};
          commands[id] = command || '';
        } catch { commands[id] = ''; }
      }));
      setDelivery({ loading: false, services: results ?? [], commands, error: '' });
    } catch {
      setDelivery({ loading: false, services: [], commands: {}, error: t('settings.deliveryUnavailable') });
    }
  };

  useEffect(() => {
    refreshProviders();
    refreshDelivery();
  }, [t]);

  useEffect(() => {
    saveAccessibility(accessibility);
  }, [accessibility]);

  useEffect(() => {
    const updates = window.electronAPI?.updates;
    if (!updates) return undefined;
    let active = true;
    const accept = (next) => {
      if (!active || !next || next.revision < updateRevisionRef.current) return;
      updateRevisionRef.current = next.revision;
      setUpdateState(next);
    };
    Promise.resolve(updates.getState()).then(accept).catch(() => {});
    const unsubscribe = updates.onStateChanged(accept);
    return () => {
      active = false;
      unsubscribe?.();
      clearTimeout(updateToastTimerRef.current);
    };
  }, []);

  const runAccountAction = async (action) => {
    setBusy(action);
    setMessage('');
    try {
      await (action === 'revalidate' ? revalidate() : logout());
      if (action === 'revalidate') setMessage(t('settings.accessRevalidated'));
    } catch (error) {
      setMessage(error?.message || t('settings.actionFailed'));
    } finally {
      setBusy('');
    }
  };

  const exportDiagnostics = async () => {
    setExportState({ busy: true, message: '' });
    try {
      const result = await window.electronAPI.diagnostics.exportReport();
      setExportState({ busy: false, message: result.exported ? t('settings.diagnosticsExported') : '' });
    } catch {
      setExportState({ busy: false, message: t('settings.diagnosticsFailed') });
    }
  };

  const showUpdateToast = (tone, text) => {
    clearTimeout(updateToastTimerRef.current);
    setUpdateToast({ tone, text });
    updateToastTimerRef.current = setTimeout(() => setUpdateToast(null), tone === 'error' ? 6000 : 4000);
  };

  const checkForUpdates = async () => {
    if (state.policy !== 'active' || !window.electronAPI?.updates) return;
    setUpdateChecking(true);
    setUpdateToast(null);
    try {
      const result = await window.electronAPI.updates.check();
      if (result && (result.revision ?? -1) >= updateRevisionRef.current) {
        updateRevisionRef.current = result.revision ?? updateRevisionRef.current;
        setUpdateState(result);
      }
      if (result?.status === 'current') showUpdateToast('success', t('settings.updateCurrentToast'));
      else if (result?.status === 'error' && !result.mandatory) showUpdateToast('error', t('settings.updateCheckFailed'));
    } catch {
      showUpdateToast('error', t('settings.updateCheckFailed'));
    } finally {
      setUpdateChecking(false);
    }
  };

  const account = state.account || {};
  const lease = state.leaseExpiresAt ? new Date(state.leaseExpiresAt) : null;
  const updateBusy = updateChecking || updateState.status === 'checking' || updateState.status === 'downloading';
  const persistentUpdateToast = updateBusy ? {
    tone: 'progress',
    text: updateState.status === 'downloading'
      ? t('settings.updateDownloading', { percentage: Math.round(updateState.progress?.percent || 0) })
      : t('settings.updateChecking'),
  } : null;
  const visibleUpdateToast = persistentUpdateToast || updateToast;

  return (
    <div className="settings-panel">
      <header className="settings-header">
        <div><p className="settings-eyebrow">{t('settings.headingEyebrow')}</p></div>
        <p>{t('settings.headingCopy')}</p>
      </header>

      <div className="settings-shell">
        <nav ref={tabsRef} className="settings-tabs" aria-label={t('settings.sections')} role="tablist" onKeyDown={handleTabKeyDown}>
          {SETTINGS_TABS.map((tab) => <button key={tab.id} id={`settings-tab-${tab.id}`} className={activeTab === tab.id ? 'is-active' : ''} type="button" role="tab" tabIndex={activeTab === tab.id ? 0 : -1} aria-selected={activeTab === tab.id} aria-controls={`settings-panel-${tab.id}`} onClick={() => setActiveTab(tab.id)}><strong>{t(tab.labelKey)}</strong><span>{t(tab.descriptionKey)}</span></button>)}
        </nav>

        <div className="settings-content">
          {activeTab === 'ai' && (
            <div id="settings-panel-ai" role="tabpanel" aria-labelledby="settings-tab-ai" className="settings-tab-panel settings-tab-panel--compact">
              <section className="settings-card settings-card--focus">
                <div className="settings-card__heading"><div><span>{t('settings.aiProviders')}</span><h2>{t('settings.modelsAccounts')}</h2></div><button className="btn btn--small" type="button" disabled={providers.loading} onClick={refreshProviders}>{t('settings.refreshStatuses')}</button></div>
                <p className="settings-copy">{t('settings.providerCopy')}</p>
                <div className="settings-providers">
                  <ProviderStatus name="Claude Code" loading={providers.loading} connected={providers.claude?.authenticated} detail={!providers.claude?.installed ? t('settings.cliNotInstalled') : providers.claude?.authenticated ? `${t('settings.connected')}${providers.claude.version ? ` · ${providers.claude.version}` : ''}` : t('settings.installedUnauthenticated')} />
                  <ProviderStatus name="OpenAI · Codex" loading={providers.loading} connected={providers.openai?.authenticated} detail={providers.openai?.authenticated ? `${t('settings.connected')} · ${providers.openai.email || t('settings.openAIAccount')}` : t('settings.notConnected')} />
                  <ProviderStatus name="OpenCode" loading={providers.loading} connected={providers.opencode?.authenticated} detail={!providers.opencode?.installed ? t('settings.optionalNotInstalled') : !providers.opencode?.usable ? t('settings.repairRequired') : providers.opencode?.authenticated ? `${providers.opencode.providers.join(', ')}${providers.opencode.version ? ` · ${providers.opencode.version}` : ''}` : t('settings.connectInTerminal')} />
                </div>
                {providers.error && <p className="settings-provider-error" role="status">{providers.error}</p>}
              </section>
            </div>
          )}

          {activeTab === 'connections' && (
            <div id="settings-panel-connections" role="tabpanel" aria-labelledby="settings-tab-connections" className="settings-tab-panel settings-tab-panel--compact">
              <section className="settings-card settings-card--focus">
                <div className="settings-card__heading"><div><span>{t('settings.deliveryEyebrow')}</span><h2>{t('settings.deliveryTitle')}</h2></div><button className="btn btn--small" type="button" disabled={delivery.loading} onClick={refreshDelivery}>{t('settings.refreshStatuses')}</button></div>
                <p className="settings-copy">{t('settings.deliveryCopy')}</p>
                <div className="settings-delivery">
                  {DELIVERY_SERVICES.map((id) => {
                    const service = delivery.services.find((item) => item.id === id)
                      ?? { id, name: id === 'github' ? 'GitHub' : id === 'vercel' ? 'Vercel' : id === 'supabase' ? 'Supabase' : 'Firebase', connected: false, checking: delivery.loading };
                    return (
                      <DeliveryProvider
                        key={id}
                        service={{ ...service, checking: delivery.loading || service.checking }}
                        command={delivery.commands[id]}
                        canRun={Boolean(canRunInTerminal && onRunInTerminal)}
                        onRun={onRunInTerminal}
                      />
                    );
                  })}
                </div>
                {delivery.error && <p className="settings-provider-error" role="status">{delivery.error}</p>}
              </section>
            </div>
          )}

          {activeTab === 'tools' && (
            <div id="settings-panel-tools" role="tabpanel" aria-labelledby="settings-tab-tools" className="settings-tab-panel">
              <section className="settings-card settings-card--setup">
                <div className="settings-card__heading"><div><span>{t('settings.localTools')}</span><h2>{t('settings.devEnvironment')}</h2></div><button className="btn btn--small btn--ghost" type="button" onClick={onReopenOnboarding}>{t('settings.openGuidedSetup')}</button></div>
                <SetupCenter compact />
              </section>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div id="settings-panel-preferences" role="tabpanel" aria-labelledby="settings-tab-preferences" className="settings-tab-panel settings-preferences">
              <section className="settings-card">
                <div className="settings-card__heading"><div><span>{t('settings.interface')}</span><h2>{t('settings.appearance')}</h2></div><span className="settings-saved">{t('settings.savedAutomatically')}</span></div>
                <p className="settings-copy">{t('settings.appearanceCopy')}</p>
                <div className="settings-segmented" aria-label={t('settings.visualTheme')}>
                  {['dark', 'light'].map((option) => <button type="button" key={option} className={theme === option ? 'is-active' : ''} aria-pressed={theme === option} onClick={() => onSetTheme(option)}>{t(`settings.${option}`)}</button>)}
                </div>
              </section>
              <section className="settings-card">
                <div className="settings-card__heading"><div><span>{t('settings.interface')}</span><h2>{t('settings.language')}</h2></div><span className="settings-saved">{t('settings.savedAutomatically')}</span></div>
                <p className="settings-copy">{t('settings.languageCopy')}</p>
                <div className="settings-segmented" aria-label={t('settings.language')}>
                  {['en', 'es'].map((option) => <button type="button" key={option} className={language === option ? 'is-active' : ''} aria-pressed={language === option} onClick={() => setLanguage(option)}>{t(`settings.${option === 'en' ? 'english' : 'spanish'}`)}</button>)}
                </div>
              </section>
              <section className="settings-card">
                <div className="settings-card__heading"><div><span>{t('settings.accessibility')}</span><h2>{t('settings.visualComfort')}</h2></div><span className="settings-saved">{t('settings.savedOnDevice')}</span></div>
                <p className="settings-copy">{t('settings.accessibilityCopy')}</p>
                <label className="settings-toggle"><span><strong>{t('settings.highContrast')}</strong><small>{t('settings.highContrastCopy')}</small></span><input type="checkbox" checked={accessibility.highContrast} onChange={(event) => setAccessibility((value) => ({ ...value, highContrast: event.target.checked }))} /></label>
                <label className="settings-toggle"><span><strong>{t('settings.reduceMotion')}</strong><small>{t('settings.reduceMotionCopy')}</small></span><input type="checkbox" checked={accessibility.reducedMotion} onChange={(event) => setAccessibility((value) => ({ ...value, reducedMotion: event.target.checked }))} /></label>
              </section>
            </div>
          )}

          {activeTab === 'account' && (
            <div id="settings-panel-account" role="tabpanel" aria-labelledby="settings-tab-account" className="settings-tab-panel">
              <section className="settings-card">
                <div className="settings-card__heading"><div><span>{t('settings.identity')}</span><h2>{t('settings.accountAccess')}</h2></div><span className={`settings-pill settings-pill--${state.policy}`}>{state.policy}</span></div>
                <dl className="settings-details">
                  <div><dt>{t('auth.email')}</dt><dd>{state.user?.email || t('settings.unavailable')}</dd></div>
                  <div><dt>{t('settings.role')}</dt><dd>{account.role ? t(`roles.${account.role}`) : t('settings.unavailable')}</dd></div>
                  <div><dt>{t('settings.accountStatus')}</dt><dd>{account.status ? t(`accountStatuses.${account.status}`) : t('settings.noStatus')}</dd></div>
                  <div><dt>{t('settings.plan')}</dt><dd>{account.planName || t('settings.noPlan')}</dd></div>
                  <div><dt>{t('settings.progress')}</dt><dd>{t('settings.lessons', { completed: account.completedLessons || 0, total: account.totalLessons || 0, percentage: Math.round(account.progressPercentage || 0) })}</dd></div>
                  <div><dt>{t('settings.offlineLease')}</dt><dd>{lease ? formatDate(lease, { dateStyle: 'medium', timeStyle: 'short' }) : t('settings.unavailable')}</dd></div>
                </dl>
                <div className="settings-actions">
                  <button className="btn btn--primary" type="button" disabled={Boolean(busy)} onClick={() => runAccountAction('revalidate')}>{busy === 'revalidate' ? t('settings.revalidating') : t('settings.revalidate')}</button>
                  <button className="btn btn--danger" type="button" disabled={Boolean(busy)} onClick={() => runAccountAction('logout')}>{busy === 'logout' ? t('settings.loggingOut') : t('settings.logout')}</button>
                  {message && <span className="settings-message" role="status">{message}</span>}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'support' && (
            <div id="settings-panel-support" role="tabpanel" aria-labelledby="settings-tab-support" className="settings-tab-panel">
              <section className="settings-card settings-update-card">
                <div className="settings-card__heading"><div><span>{t('settings.application')}</span><h2>{t('settings.applicationUpdates')}</h2></div><span className="settings-saved">{updateState.status === 'current' ? t('settings.updateCurrentStatus') : t('settings.updateAutomatic')}</span></div>
                <p className="settings-copy">{t('settings.updateCopy')}</p>
                <div className="settings-update-overview">
                  <div>
                    <strong>{updateBusy ? t('settings.updateChecking') : state.policy === 'active' ? t('settings.updateReady') : t('settings.updateRequiresAccess')}</strong>
                    <span>{updateState.status === 'error' ? t('settings.updateCheckFailed') : t('settings.updateBackgroundCopy')}</span>
                  </div>
                  <button className="btn btn--primary" type="button" aria-busy={updateBusy} disabled={updateBusy || state.policy !== 'active' || !window.electronAPI?.updates} onClick={checkForUpdates}>
                    {updateBusy ? t('settings.updateCheckingButton') : t('settings.checkForUpdates')}
                  </button>
                </div>
              </section>
              <section className="settings-card">
                <div className="settings-card__heading"><div><span>{t('settings.localDiagnostics')}</span><h2>{t('settings.supportReport')}</h2></div><span className="settings-saved">JSON</span></div>
                <p className="settings-copy">{t('settings.diagnosticsCopy')}</p>
                <div className="settings-privacy-note">{t('settings.diagnosticsPrivacy')}</div>
                <div className="settings-actions">
                  <button className="btn btn--primary" type="button" disabled={exportState.busy} onClick={exportDiagnostics}>{exportState.busy ? t('settings.exportingDiagnostics') : t('settings.exportDiagnostics')}</button>
                  {exportState.message && <span className="settings-message" role="status">{exportState.message}</span>}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
      {visibleUpdateToast && <div className={`vc-toast settings-update-toast settings-update-toast--${visibleUpdateToast.tone}`} role={visibleUpdateToast.tone === 'error' ? 'alert' : 'status'} aria-live={visibleUpdateToast.tone === 'error' ? 'assertive' : 'polite'}>{visibleUpdateToast.text}</div>}
    </div>
  );
}
