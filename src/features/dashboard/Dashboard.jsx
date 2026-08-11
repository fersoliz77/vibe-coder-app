import { useEffect, useState } from 'react';
import GlobalServices from '../services/GlobalServices';
import { useAuth } from '../auth/AuthContext';
import ClaudeIcon from '../../components/icons/ClaudeIcon';
import OpenCodeIcon from '../../components/icons/OpenCodeIcon';
import { useI18n } from '../../i18n/I18nContext';
import './Dashboard.css';

const INITIAL_WEB = { available: null, state: 'loading', issues: [], diagnostics: { status: 'idle' }, sync: { history: [] }, activity: [] };
const INITIAL_ANDROID = { available: null, emulatorState: 'loading', appState: 'stopped' };

const DENSITY_KEY = 'vibe-dashboard-density';

const QUICK_ACTIONS = [
  {
    id: 'terminal',
    titleKey: 'dashboard.openTerminal',
    descriptionKey: 'dashboard.openTerminalCopy',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>,
  },
  { id: 'claude', titleKey: 'dashboard.askClaude', descriptionKey: 'dashboard.askClaudeCopy', icon: <ClaudeIcon /> },
  { id: 'opencode', title: 'OpenCode', descriptionKey: 'dashboard.openCodeCopy', icon: <OpenCodeIcon /> },
];

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

function AccountCard({ authState, account, progress, completedLessons, totalLessons, t, formatDate }) {
  return (
    <section className="identity-card glass-card" aria-label={t('dashboard.accountAccess')}>
      <div className="identity-card__profile">
        <div className="identity-card__avatar">{authState.user?.email?.[0]?.toUpperCase() || 'V'}</div>
        <div><span className="identity-card__eyebrow">{t('dashboard.platformAccount')}</span><h2>{authState.user?.email || t('dashboard.activeAccount')}</h2><p>{t('dashboard.role', { role: account.role ? t(`roles.${account.role}`) : t('dashboard.unavailable') })} · {t('dashboard.plan', { plan: account.planName || t('dashboard.unavailable') })}</p></div>
      </div>
      <div className="identity-card__access">
        <span className={`identity-card__status identity-card__status--${authState.policy}`}>{account.status ? t(`accountStatuses.${account.status}`) : authState.policy}</span>
        <span>{t('dashboard.offlineLease', { date: authState.leaseExpiresAt ? formatDate(authState.leaseExpiresAt, { dateStyle: 'medium', timeStyle: 'short' }) : t('dashboard.unavailable') })}</span>
      </div>
      <div className="identity-card__progress">
        <div><span>{t('dashboard.learningProgress')}</span><strong>{Math.round(progress)}%</strong></div>
        <div className="identity-card__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div>
        <small>{t('dashboard.lessonsCompleted', { completed: completedLessons, total: totalLessons })}</small>
      </div>
    </section>
  );
}

export default function Dashboard({ services, onOpenTerminal, onOpenClaude, onOpenCode, onOpenProjects, onOpenPreview, onOpenFiles, onOpenRequirements, onRefreshAll, currentProject }) {
  const { services: serviceList } = services;
  const { state: authState } = useAuth();
  const { language, t, formatDate } = useI18n();
  const [web, setWeb] = useState(INITIAL_WEB);
  const [android, setAndroid] = useState(INITIAL_ANDROID);
  const [git, setGit] = useState({ state: 'loading', entries: [] });
  const [chatActivity, setChatActivity] = useState([]);
  const account = authState.account || {};
  const completedLessons = Number(account.completedLessons) || 0;
  const totalLessons = Number(account.totalLessons) || 0;
  const calculatedProgress = totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;
  const progress = Math.min(100, Math.max(0, Number(account.progressPercentage) || calculatedProgress));

  useEffect(() => {
    if (!currentProject?.path) return undefined;
    let cancelled = false;
    const preview = window.electronAPI?.preview;
    const fs = window.electronAPI?.fs;
    const store = window.electronAPI?.store;
    setWeb(INITIAL_WEB);
    setAndroid(INITIAL_ANDROID);
    setGit({ state: 'loading', entries: [] });
    setChatActivity([]);

    if (preview?.web?.status) {
      preview.web.status(currentProject.path)
        .then((status) => { if (!cancelled && status) setWeb(status); })
        .catch(() => { if (!cancelled) setWeb({ ...INITIAL_WEB, available: null, state: 'unavailable' }); });
    } else {
      setWeb({ ...INITIAL_WEB, available: null, state: 'unavailable' });
    }
    if (preview?.android?.status) {
      preview.android.status(currentProject.path)
        .then((status) => { if (!cancelled && status) setAndroid(status); })
        .catch(() => { if (!cancelled) setAndroid({ ...INITIAL_ANDROID, available: null, emulatorState: 'unavailable' }); });
    } else {
      setAndroid({ ...INITIAL_ANDROID, available: null, emulatorState: 'unavailable' });
    }
    if (fs?.gitStatus) {
      fs.gitStatus(currentProject.path)
        .then((result) => { if (!cancelled) setGit(result?.success ? { state: 'ready', entries: result.entries || [] } : { state: 'unavailable', entries: [] }); })
        .catch(() => { if (!cancelled) setGit({ state: 'unavailable', entries: [] }); });
    } else {
      setGit({ state: 'unavailable', entries: [] });
    }
    if (store?.get) {
      Promise.allSettled([
        store.get(`chat:claude:${currentProject.path}`, []),
        store.get(`chat:openai:${currentProject.path}`, []),
      ]).then(([claudeResult, openAIResult]) => {
        if (cancelled) return;
        const latest = (result, provider) => {
          if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return null;
          const timestamp = Math.max(...result.value.map((message) => Number(new Date(message?.timestamp))).filter(Number.isFinite));
          return Number.isFinite(timestamp) ? { type: 'conversation', provider, timestamp } : null;
        };
        setChatActivity([latest(claudeResult, 'Claude'), latest(openAIResult, 'OpenAI')].filter(Boolean));
      });
    }
    const offWeb = preview?.web?.onStatus?.((status) => setWeb(status));
    const offAndroid = preview?.android?.onStatus?.((status) => setAndroid(status));
    return () => { cancelled = true; offWeb?.(); offAndroid?.(); };
  }, [currentProject?.path]);

  const connectedCount = serviceList.filter((service) => service.connected).length;
  const vercel = serviceList.find((service) => service.id === 'vercel');
  const github = serviceList.find((service) => service.id === 'github');
  const gitService = serviceList.find((service) => service.id === 'git');
  const backendService = serviceList.find((service) => service.id === currentProject?.backend);
  const deliveryState = vercel?.checking ? 'loading' : vercel?.connected && vercel?.projectLinked === true ? 'ready' : 'attention';
  const issueCount = Array.isArray(web.issues) ? web.issues.length : 0;
  const previewHasProblems = web.state === 'stopped' || web.state === 'error' || issueCount > 0 || web.diagnostics?.status === 'error';
  const deliveryNeedsSetup = deliveryState === 'attention';
  const pendingRequirements = (currentProject?.requirements?.items || []).filter((item) => item.status === 'pending');
  /*
   * Capa basica y capa completa.
   *
   * El tablero mostraba a la vez salud del preview, estado de Git, servicios,
   * entrega, actividad reciente, accesos rapidos y la tarjeta de cuenta. Para
   * alguien que recien termino el onboarding son siete conceptos antes de
   * poder abrir un archivo.
   *
   * No se saca nada: la capa completa sigue teniendo todo, a un click. Lo que
   * cambia es con que arranca alguien que todavia no sabe que necesita.
   */
  const [detailed, setDetailed] = useState(() => {
    try { return localStorage.getItem(DENSITY_KEY) === 'detailed'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(DENSITY_KEY, detailed ? 'detailed' : 'basic'); } catch { /* sin storage se pierde la preferencia, no la funcion */ }
  }, [detailed]);

  const revealServices = () => document.querySelector('.dashboard__sidebar')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  let nextAction = { title: t('dashboard.nextReviewTitle'), copy: t('dashboard.nextReviewCopy'), cta: t('dashboard.openPreview'), onClick: onOpenPreview, tone: 'ready' };
  if (pendingRequirements.length) nextAction = { title: t('dashboard.nextRequirementsTitle'), copy: t('dashboard.nextRequirementsCopy', { count: pendingRequirements.length }), cta: t('dashboard.reviewRequirements'), onClick: onOpenRequirements, tone: 'warning' };
  else if (previewHasProblems) nextAction = { title: t('dashboard.nextPreviewTitle'), copy: t('dashboard.nextPreviewCopy'), cta: t('dashboard.inspectPreview'), onClick: onOpenPreview, tone: 'warning' };
  else if (git.state === 'ready' && git.entries.length > 0) nextAction = { title: t('dashboard.nextGitTitle'), copy: t('dashboard.nextGitCopy', { count: git.entries.length }), cta: t('dashboard.reviewFiles'), onClick: onOpenFiles, tone: 'accent' };
  else if (deliveryNeedsSetup) nextAction = { title: t('dashboard.nextDeliveryTitle'), copy: t('dashboard.nextDeliveryCopy'), cta: t('dashboard.viewServices'), onClick: revealServices, tone: 'warning' };

  const previewActivity = [
    ...(Array.isArray(web.activity) ? web.activity : []),
    ...(Array.isArray(web.sync?.history) ? web.sync.history.map((entry) => ({ ...entry, type: 'sync-history' })) : []),
    ...chatActivity,
  ]
    .filter((item) => Number.isFinite(Number(new Date(item.timestamp))))
    .sort((a, b) => Number(new Date(b.timestamp)) - Number(new Date(a.timestamp)))
    .slice(0, 5);
  const activityLabel = (item) => item.type === 'conversation'
    ? t('dashboard.activityConversation', { provider: item.provider })
    : t(`dashboard.activityTypes.${item.type}`, { count: item.count || 0 });
  const statusLabel = (state, namespace) => t(`dashboard.${namespace}.${state}`);
  const workspaceTargets = Array.isArray(currentProject?.workspace?.targets) ? currentProject.workspace.targets : [];
  const primaryTarget = workspaceTargets.find((target) => target.id === currentProject?.primaryTargetId);
  const projectType = primaryTarget
    ? primaryTarget.kind === 'flutter' || primaryTarget.kind === 'android' ? t('dashboard.projectTypes.mobileSuite') : primaryTarget.kind === 'web' ? t('dashboard.projectTypes.web') : primaryTarget.kind
    : currentProject?.type === 'mobile-suite'
    ? t('dashboard.projectTypes.mobileSuite')
    : ['next-ts', 'vite-react-ts'].includes(currentProject?.type)
      ? t('dashboard.projectTypes.web')
      : t('dashboard.statusUnavailable');
  const projectStack = primaryTarget
    ? primaryTarget.technologies?.join(' · ') || primaryTarget.framework || t('dashboard.statusUnavailable')
    : currentProject?.type === 'mobile-suite'
    ? t('dashboard.projectStacks.mobileSuite')
    : currentProject?.type === 'vite-react-ts'
      ? t('dashboard.projectStacks.vite')
      : currentProject?.type === 'next-ts'
        ? t('dashboard.projectStacks.next')
        : t('dashboard.statusUnavailable');
  const repositoryVisibility = currentProject?.repositoryVisibility === 'private'
    ? t('dashboard.privateVisibility')
    : t('dashboard.visibilityUnavailable');

  return (
    <div className="dashboard">
      <div className="dashboard__inner">
        <div className="dashboard__main">
          {!currentProject ? (
            <>
              <AccountCard {...{ authState, account, progress, completedLessons, totalLessons, t, formatDate }} />
              <section className="dashboard__section">
                <div className="dashboard__section-header"><h2 className="dashboard__section-title">{t('dashboard.quickActions')}</h2></div>
                <div className="dashboard__actions-grid">
                  <button className="action-card glass-card" onClick={onOpenProjects} type="button">
                    <div className="action-card__icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7h6l2 2h10v10H3z"/><path d="M3 7V5h6l2 2"/></svg></div>
                    <div className="action-card__text"><span className="action-card__title">{t('dashboard.openProjects')}</span><span className="action-card__desc text-secondary">{t('dashboard.openProjectsCopy')}</span></div>
                  </button>
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="project-outcome">
                <div className="project-outcome__glow" />
                <div className="project-outcome__content">
                  <span className="project-outcome__eyebrow">{t('dashboard.projectOutcome')}</span>
                  <h1>{currentProject.name}</h1>
                  <div className="project-outcome__signals">
                    <span className={`outcome-signal is-${web.state === 'ready' && !issueCount ? 'ready' : web.state === 'loading' ? 'loading' : 'attention'}`}><i />{statusLabel(web.state, 'webStates')}</span>
                    <span className={`outcome-signal is-${web.diagnostics?.status === 'clean' ? 'ready' : web.diagnostics?.status === 'idle' ? 'neutral' : 'attention'}`}><i />{statusLabel(web.diagnostics?.status || 'idle', 'diagnosticStates')}</span>
                    {android.available !== false && <span className={`outcome-signal is-${android.appState === 'running' ? 'ready' : android.available === null ? 'loading' : 'neutral'}`}><i />{t('dashboard.androidStatus', { status: statusLabel(android.available === null ? android.emulatorState : android.appState, 'androidStates') })}</span>}
                  </div>
                </div>
                <button className="project-outcome__cta" type="button" onClick={pendingRequirements.length ? onOpenRequirements : onOpenPreview}>{pendingRequirements.length ? t('dashboard.reviewRequirements') : t('dashboard.openPreview')}<ArrowIcon /></button>
              </section>

              {detailed && <section className="project-details glass-card" aria-labelledby="project-details-title">
                <div className="project-details__header">
                  <div><span className="dashboard-card-eyebrow">{t('dashboard.projectDetails')}</span><h2 id="project-details-title">{t('dashboard.projectConfiguration')}</h2></div>
                  <span className="project-details__status">{currentProject.provisioningStatus === 'partial' ? t('dashboard.partialProject') : t('dashboard.registeredProject')}</span>
                </div>
                <div className="project-details__grid">
                  <article><span>{t('dashboard.projectType')}</span><strong>{projectType}</strong><small>{projectStack}</small></article>
                  {workspaceTargets.length > 0 && <article><span>{t('dashboard.projectTargets')}</span><strong>{t('dashboard.targetCount', { count: workspaceTargets.length })}</strong><small>{workspaceTargets.map((target) => target.name).join(' · ')}</small></article>}
                  <article><span>{t('dashboard.projectBackend')}</span><strong>{currentProject.backend ? currentProject.backend[0].toUpperCase() + currentProject.backend.slice(1) : t('dashboard.notConfigured')}</strong><small>{backendService?.project || (backendService?.projectLinked ? t('dashboard.linkedProject') : t('dashboard.linkPending'))}</small></article>
                  <article><span>{t('dashboard.projectRepository')}</span><strong>{github?.project || t('dashboard.linkPending')}</strong><small>{repositoryVisibility}</small></article>
                  <article><span>{t('dashboard.projectDelivery')}</span><strong>{vercel?.project || t('dashboard.linkPending')}</strong><small>{vercel?.projectLinked ? t('dashboard.vercelLinked') : t('dashboard.vercelPending')}</small></article>
                  <article><span>{t('dashboard.projectGit')}</span><strong>{gitService?.project || t('dashboard.notConfigured')}</strong><small>{git.state === 'ready' && git.entries.length ? t('dashboard.changeCount', { count: git.entries.length }) : git.state === 'ready' ? t('dashboard.clean') : t('dashboard.statusUnavailable')}</small></article>
                  <article><span>{currentProject.origin === 'imported' ? t('dashboard.projectRegistered') : t('dashboard.projectDates')}</span><strong>{currentProject.registeredAt || currentProject.createdAt ? formatDate(currentProject.registeredAt || currentProject.createdAt, { dateStyle: 'medium' }) : t('dashboard.statusUnavailable')}</strong><small>{currentProject.lastOpened ? t('dashboard.lastOpened', { date: formatDate(currentProject.lastOpened, { dateStyle: 'medium', timeStyle: 'short' }) }) : t('dashboard.lastOpenedUnavailable')}</small></article>
                  <article className="project-details__path"><span>{t('dashboard.projectLocation')}</span><strong title={currentProject.path}>{currentProject.path}</strong></article>
                </div>
              </section>}

              {detailed && <section className="health-strip" aria-label={t('dashboard.projectHealth')}>
                <button type="button" onClick={onOpenPreview} className={`health-item is-${previewHasProblems ? 'attention' : web.state === 'ready' ? 'ready' : 'neutral'}`}><span>{t('dashboard.previewHealth')}</span><strong>{issueCount ? t('dashboard.issueCount', { count: issueCount }) : statusLabel(web.state, 'webStates')}</strong></button>
                <button type="button" onClick={onOpenFiles} className={`health-item is-${git.state === 'ready' && !git.entries.length ? 'ready' : git.state === 'ready' ? 'attention' : 'neutral'}`}><span>{t('dashboard.gitHealth')}</span><strong>{git.state === 'loading' ? t('dashboard.checking') : git.state === 'unavailable' ? t('dashboard.statusUnavailable') : git.entries.length ? t('dashboard.changeCount', { count: git.entries.length }) : t('dashboard.clean')}</strong></button>
                <button type="button" onClick={revealServices} className="health-item"><span>{t('dashboard.servicesHealth')}</span><strong>{t('dashboard.connectedCount', { connected: connectedCount, total: serviceList.length })}</strong></button>
                <button type="button" onClick={revealServices} className={`health-item is-${deliveryState}`}><span>{t('dashboard.deliveryHealth')}</span><strong>{deliveryState === 'loading' ? t('dashboard.checking') : deliveryState === 'ready' ? t('dashboard.deliveryReady') : t('dashboard.deliveryNotReady')}</strong></button>
              </section>}

              <div className="dashboard__outcome-grid">
                <section className={`next-action is-${nextAction.tone}`}>
                  <div><span className="dashboard-card-eyebrow">{t('dashboard.nextAction')}</span><h2>{nextAction.title}</h2><p>{nextAction.copy}</p></div>
                  <button type="button" onClick={nextAction.onClick}>{nextAction.cta}<ArrowIcon /></button>
                </section>
                {detailed && <section className="recent-activity glass-card">
                  <div className="recent-activity__header"><span className="dashboard-card-eyebrow">{t('dashboard.recentActivity')}</span><strong>{t('dashboard.latestUpdates')}</strong></div>
                  {previewActivity.length ? <ol>{previewActivity.map((item, index) => <li key={`${item.type}-${item.timestamp}-${index}`}><i /><span>{activityLabel(item)}</span><time>{formatDate(item.timestamp, { dateStyle: 'medium', timeStyle: 'short' })}</time></li>)}</ol> : <p className="recent-activity__empty">{t('dashboard.noRecentActivity')}</p>}
                </section>}
              </div>

              <section className="dashboard__section dashboard__section--quiet">
                <div className="dashboard__section-header"><h2 className="dashboard__section-title">{t('dashboard.quickActions')}</h2></div>
                <div className="dashboard__actions-grid">{QUICK_ACTIONS.map((action) => {
                  const handleClick = { terminal: onOpenTerminal, claude: onOpenClaude, opencode: onOpenCode }[action.id];
                  return <button key={action.id} className="action-card glass-card" onClick={handleClick} type="button"><div className="action-card__icon">{action.icon}</div><div className="action-card__text"><span className="action-card__title">{action.titleKey ? t(action.titleKey) : action.title}</span><span className="action-card__desc text-secondary">{t(action.descriptionKey)}</span></div></button>;
                })}</div>
              </section>
              {/* Nada se retira: la capa completa esta a un click. */}
              <button type="button" className="dashboard__density-toggle" onClick={() => setDetailed((value) => !value)} aria-pressed={detailed}>
                {detailed ? t('dashboard.showBasic') : t('dashboard.showDetailed')}
              </button>
            </>
          )}
        </div>

        <div className="dashboard__sidebar" hidden={Boolean(currentProject) && !detailed}>
          <div className="dashboard__sidebar-header">{t('dashboard.providerStatus')}</div>
          <GlobalServices
            services={serviceList}
            inProject={!!currentProject}
            onRefresh={() => onRefreshAll(currentProject?.path)}
          />
        </div>
      </div>
    </div>
  );
}
