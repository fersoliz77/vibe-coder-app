import ServiceCard from '../services/ServiceCard';
import GlobalServices from '../services/GlobalServices';
import { useAuth } from '../auth/AuthContext';
import ClaudeIcon from '../../components/icons/ClaudeIcon';
import OpenCodeIcon from '../../components/icons/OpenCodeIcon';
import './Dashboard.css';

const QUICK_ACTIONS = [
  {
    id: 'terminal',
    title: 'Open Terminal',
    description: 'Run commands in the current project workspace.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
  {
    id: 'claude',
    title: 'Ask Claude',
    description: 'Jump into the AI panel with this project preloaded.',
    icon: <ClaudeIcon />,
  },
  {
    id: 'opencode',
    title: 'OpenCode',
    description: 'Launch the OpenCode agent in a dedicated project terminal.',
    icon: <OpenCodeIcon />,
  },
];

export default function Dashboard({ services, onOpenTerminal, onOpenClaude, onOpenCode, onOpenProjects, onRefreshAll, onRefreshService, currentProject }) {
  const { services: serviceList, connectedCount } = services;
  const { state: authState } = useAuth();
  const membership = authState.membership || {};
  const completedLessons = Number(membership.completedLessons) || 0;
  const totalLessons = Number(membership.totalLessons) || 0;
  const calculatedProgress = totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;
  const progress = Math.min(100, Math.max(0, Number(membership.progressPercentage) || calculatedProgress));

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="dashboard">
      <div className="dashboard__inner">
        {/* Left: Main content */}
        <div className="dashboard__main">
          {/* Header */}
          <header className="dashboard__header animate-fade-in">
            <div className="dashboard__greeting">
              <h1 className="dashboard__title">
                {currentProject ? 'Workspace Overview' : 'Vibe IDE Code'}
              </h1>
              <p className="dashboard__date text-tertiary">{greeting} — {dateStr}</p>
              <p className="dashboard__subtitle text-secondary">
                {currentProject 
                  ? 'Your project services and tools are ready here.'
                  : 'Connect your favorite tools and start building instantly.'}
              </p>
            </div>
            <div className="dashboard__stats">
              <div className="dashboard__stat">
                <span className="dashboard__stat-value text-gradient">{connectedCount}</span>
                <span className="dashboard__stat-label text-tertiary">Services</span>
              </div>
            </div>
          </header>

          <section className="identity-card glass-card" aria-label="Cuenta y progreso educativo">
            <div className="identity-card__profile">
              <div className="identity-card__avatar">{authState.user?.email?.[0]?.toUpperCase() || 'V'}</div>
              <div><span className="identity-card__eyebrow">Cuenta escolar</span><h2>{authState.user?.email || 'Cuenta activa'}</h2><p>{membership.schoolName || membership.schoolId || 'Escuela no asignada'} · Plan {membership.planName || 'sin asignar'}</p></div>
            </div>
            <div className="identity-card__access">
              <span className={`identity-card__status identity-card__status--${authState.policy}`}>{membership.status || authState.policy}</span>
              <span>Lease offline: {authState.leaseExpiresAt ? new Date(authState.leaseExpiresAt).toLocaleString() : 'no disponible'}</span>
            </div>
            <div className="identity-card__progress">
              <div><span>Progreso educativo</span><strong>{Math.round(progress)}%</strong></div>
              <div className="identity-card__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div>
              <small>{completedLessons} de {totalLessons} lecciones completadas</small>
            </div>
          </section>

          {/* Quick Actions */}
          <section className="dashboard__section">
            <div className="dashboard__section-header">
              <h2 className="dashboard__section-title">Quick Actions</h2>
            </div>
            <div className="dashboard__actions-grid">
              {!currentProject && (
                <button className="action-card glass-card" onClick={onOpenProjects} type="button">
                  <div className="action-card__icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7h6l2 2h10v10H3z"/><path d="M3 7V5h6l2 2"/></svg></div>
                  <div className="action-card__text"><span className="action-card__title">Abrir proyectos</span><span className="action-card__desc text-secondary">Elegí o agregá un proyecto local para comenzar.</span></div>
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
                      <span className="action-card__title">{action.title}</span>
                      <span className="action-card__desc text-secondary">{action.description}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right: Provider Status */}
        <div className="dashboard__sidebar">
          <div className="dashboard__sidebar-header">Provider Status</div>
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
