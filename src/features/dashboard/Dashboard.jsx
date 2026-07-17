import ServiceCard from '../services/ServiceCard';
import GlobalServices from '../services/GlobalServices';
import { useAuth } from '../auth/AuthContext';
import ClaudeIcon from '../../components/icons/ClaudeIcon';
import OpenCodeIcon from '../../components/icons/OpenCodeIcon';
import { useI18n } from '../../i18n/I18nContext';
import './Dashboard.css';

const QUICK_ACTIONS = [
  {
    id: 'terminal',
    titleKey: 'dashboard.openTerminal',
    descriptionKey: 'dashboard.openTerminalCopy',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
  {
    id: 'claude',
    titleKey: 'dashboard.askClaude',
    descriptionKey: 'dashboard.askClaudeCopy',
    icon: <ClaudeIcon />,
  },
  {
    id: 'opencode',
    title: 'OpenCode',
    descriptionKey: 'dashboard.openCodeCopy',
    icon: <OpenCodeIcon />,
  },
];

export default function Dashboard({ services, onOpenTerminal, onOpenClaude, onOpenCode, onOpenProjects, onRefreshAll, onRefreshService, currentProject }) {
  const { services: serviceList } = services;
  const { state: authState } = useAuth();
  const { t, formatDate } = useI18n();
  const membership = authState.membership || {};
  const completedLessons = Number(membership.completedLessons) || 0;
  const totalLessons = Number(membership.totalLessons) || 0;
  const calculatedProgress = totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;
  const progress = Math.min(100, Math.max(0, Number(membership.progressPercentage) || calculatedProgress));

  return (
    <div className="dashboard">
      <div className="dashboard__inner">
        {/* Left: Main content */}
        <div className="dashboard__main">
          <section className="identity-card glass-card" aria-label={t('dashboard.accountProgress')}>
            <div className="identity-card__profile">
              <div className="identity-card__avatar">{authState.user?.email?.[0]?.toUpperCase() || 'V'}</div>
              <div><span className="identity-card__eyebrow">{t('dashboard.schoolAccount')}</span><h2>{authState.user?.email || t('dashboard.activeAccount')}</h2><p>{membership.schoolName || membership.schoolId || t('dashboard.schoolUnassigned')} · {t('dashboard.plan', { plan: membership.planName || t('dashboard.unavailable') })}</p></div>
            </div>
            <div className="identity-card__access">
              <span className={`identity-card__status identity-card__status--${authState.policy}`}>{membership.status || authState.policy}</span>
              <span>{t('dashboard.offlineLease', { date: authState.leaseExpiresAt ? formatDate(authState.leaseExpiresAt, { dateStyle: 'medium', timeStyle: 'short' }) : t('dashboard.unavailable') })}</span>
            </div>
            <div className="identity-card__progress">
              <div><span>{t('dashboard.learningProgress')}</span><strong>{Math.round(progress)}%</strong></div>
              <div className="identity-card__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div>
              <small>{t('dashboard.lessonsCompleted', { completed: completedLessons, total: totalLessons })}</small>
            </div>
          </section>

          {/* Quick Actions */}
          <section className="dashboard__section">
            <div className="dashboard__section-header">
              <h2 className="dashboard__section-title">{t('dashboard.quickActions')}</h2>
            </div>
            <div className="dashboard__actions-grid">
              {!currentProject && (
                <button className="action-card glass-card" onClick={onOpenProjects} type="button">
                  <div className="action-card__icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7h6l2 2h10v10H3z"/><path d="M3 7V5h6l2 2"/></svg></div>
                  <div className="action-card__text"><span className="action-card__title">{t('dashboard.openProjects')}</span><span className="action-card__desc text-secondary">{t('dashboard.openProjectsCopy')}</span></div>
                </button>
              )}
              {currentProject && QUICK_ACTIONS.map((action) => {
                const handlers = { terminal: onOpenTerminal, claude: onOpenClaude, opencode: onOpenCode };
                const handleClick = handlers[action.id];
                return (
                  <button
                    key={action.id}
                    className="action-card glass-card"
                    onClick={handleClick}
                    type="button"
                  >
                    <div className="action-card__icon">{action.icon}</div>
                    <div className="action-card__text">
                      <span className="action-card__title">{action.titleKey ? t(action.titleKey) : action.title}</span>
                      <span className="action-card__desc text-secondary">{t(action.descriptionKey)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right: Provider Status */}
        <div className="dashboard__sidebar">
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
