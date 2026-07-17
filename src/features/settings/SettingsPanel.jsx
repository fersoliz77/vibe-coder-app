import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import SetupCenter from '../setup/SetupCenter';
import { useI18n } from '../../i18n/I18nContext';
import './SettingsPanel.css';

const ACCESSIBILITY_KEY = 'vibe-accessibility';

const SETTINGS_TABS = [
  { id: 'services', labelKey: 'settings.tabs.services', descriptionKey: 'settings.tabs.servicesCopy' },
  { id: 'preferences', labelKey: 'settings.tabs.preferences', descriptionKey: 'settings.tabs.preferencesCopy' },
  { id: 'account', labelKey: 'settings.tabs.account', descriptionKey: 'settings.tabs.accountCopy' },
];

function readAccessibility() {
  try {
    return { highContrast: false, reducedMotion: false, ...JSON.parse(localStorage.getItem(ACCESSIBILITY_KEY) || '{}') };
  } catch {
    return { highContrast: false, reducedMotion: false };
  }
}

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

export default function SettingsPanel({ theme, onSetTheme, onReopenOnboarding }) {
  const { state, revalidate, logout } = useAuth();
  const { language, setLanguage, t, formatDate } = useI18n();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [accessibility, setAccessibility] = useState(readAccessibility);
  const [providers, setProviders] = useState({ loading: true, claude: null, openai: null, opencode: null, error: '' });
  const [activeTab, setActiveTab] = useState('services');

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

  useEffect(() => {
    refreshProviders();
  }, [t]);

  useEffect(() => {
    localStorage.setItem(ACCESSIBILITY_KEY, JSON.stringify(accessibility));
    document.body.classList.toggle('high-contrast', accessibility.highContrast);
    document.body.classList.toggle('reduced-motion', accessibility.reducedMotion);
  }, [accessibility]);

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

  const membership = state.membership || {};
  const lease = state.leaseExpiresAt ? new Date(state.leaseExpiresAt) : null;

  return (
    <div className="settings-panel">
      <header className="settings-header">
        <div><p className="settings-eyebrow">{t('settings.headingEyebrow')}</p><h1>{t('settings.heading')}</h1></div>
        <p>{t('settings.headingCopy')}</p>
      </header>

      <div className="settings-shell">
        <nav className="settings-tabs" aria-label={t('settings.sections')} role="tablist">
          {SETTINGS_TABS.map((tab) => <button key={tab.id} id={`settings-tab-${tab.id}`} className={activeTab === tab.id ? 'is-active' : ''} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`settings-panel-${tab.id}`} onClick={() => setActiveTab(tab.id)}><strong>{t(tab.labelKey)}</strong><span>{t(tab.descriptionKey)}</span></button>)}
        </nav>

        <div className="settings-content">
          {activeTab === 'services' && (
            <div id="settings-panel-services" role="tabpanel" aria-labelledby="settings-tab-services" className="settings-tab-panel">
              <section className="settings-card">
                <div className="settings-card__heading"><div><span>{t('settings.aiProviders')}</span><h2>{t('settings.modelsAccounts')}</h2></div><button className="btn btn--small" type="button" disabled={providers.loading} onClick={refreshProviders}>{t('settings.refreshStatuses')}</button></div>
                <p className="settings-copy">{t('settings.providerCopy')}</p>
                <div className="settings-providers">
                  <ProviderStatus name="Claude Code" loading={providers.loading} connected={providers.claude?.authenticated} detail={!providers.claude?.installed ? t('settings.cliNotInstalled') : providers.claude?.authenticated ? `${t('settings.connected')}${providers.claude.version ? ` · ${providers.claude.version}` : ''}` : t('settings.installedUnauthenticated')} />
                  <ProviderStatus name="OpenAI · Codex" loading={providers.loading} connected={providers.openai?.authenticated} detail={providers.openai?.authenticated ? `${t('settings.connected')} · ${providers.openai.email || t('settings.openAIAccount')}` : t('settings.notConnected')} />
                  <ProviderStatus name="OpenCode" loading={providers.loading} connected={providers.opencode?.authenticated} detail={!providers.opencode?.installed ? t('settings.optionalNotInstalled') : !providers.opencode?.usable ? t('settings.repairRequired') : providers.opencode?.authenticated ? `${providers.opencode.providers.join(', ')}${providers.opencode.version ? ` · ${providers.opencode.version}` : ''}` : t('settings.connectInTerminal')} />
                </div>
                {providers.error && <p className="settings-provider-error" role="status">{providers.error}</p>}
              </section>
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
                <div className="settings-card__heading"><div><span>{t('settings.identity')}</span><h2>{t('settings.schoolAccount')}</h2></div><span className={`settings-pill settings-pill--${state.policy}`}>{state.policy}</span></div>
                <dl className="settings-details">
                  <div><dt>{t('auth.email')}</dt><dd>{state.user?.email || t('settings.unavailable')}</dd></div>
                  <div><dt>{t('settings.school')}</dt><dd>{membership.schoolName || membership.schoolId || t('settings.schoolUnassigned')}</dd></div>
                  <div><dt>{t('settings.membership')}</dt><dd>{membership.status || t('settings.noStatus')}</dd></div>
                  <div><dt>{t('settings.plan')}</dt><dd>{membership.planName || t('settings.noPlan')}</dd></div>
                  <div><dt>{t('settings.progress')}</dt><dd>{t('settings.lessons', { completed: membership.completedLessons || 0, total: membership.totalLessons || 0, percentage: Math.round(membership.progressPercentage || 0) })}</dd></div>
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
        </div>
      </div>
    </div>
  );
}
