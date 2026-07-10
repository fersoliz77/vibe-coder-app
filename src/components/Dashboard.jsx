import ServiceCard from './ServiceCard';
import GlobalServices from './GlobalServices';
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
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
        <path d="M6 10a6 6 0 0 0 12 0" />
        <path d="M12 16v4" />
        <path d="M8 22h8" />
      </svg>
    ),
  },
];

export default function Dashboard({ services, onOpenTerminal, onOpenClaude, onRefreshAll, onRefreshService, currentProject }) {
  const { services: serviceList, connectedCount } = services;

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
                {currentProject ? 'Workspace Overview' : 'VibeCoder Launch'}
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

          {/* Quick Actions */}
          <section className="dashboard__section">
            <div className="dashboard__section-header">
              <h2 className="dashboard__section-title">Quick Actions</h2>
            </div>
            <div className="dashboard__actions-grid">
              {QUICK_ACTIONS.map((action) => {
                const handleClick = action.id === 'terminal' ? onOpenTerminal : onOpenClaude;
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
