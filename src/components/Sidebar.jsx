import './Sidebar.css';

const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    id: 'files',
    label: 'Explorer',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
    ),
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
  {
    id: 'claude',
    label: 'Claude AI',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
        <path d="M6 10a6 6 0 0 0 12 0" />
        <path d="M12 16v4" />
        <path d="M8 22h8" />
        <circle cx="9" cy="7" r="0.8" fill="currentColor" />
        <circle cx="15" cy="7" r="0.8" fill="currentColor" />
      </svg>
    ),
  },
];

export default function Sidebar({ activeView, onNavigate, connectedCount, claudeAvailable, isDarkMode, onToggleTheme, currentProject, onBackToProjects }) {
  return (
    <aside className="sidebar">
      {/* Navigation */}
      <nav className="sidebar__nav">
        {currentProject && (
          <>
            <button 
              className="sidebar__item" 
              onClick={onBackToProjects}
              style={{ marginBottom: '16px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '16px' }}
            >
              <span className="sidebar__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
              </span>
              <span className="sidebar__label">All Projects</span>
            </button>

            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`sidebar__item ${activeView === item.id ? 'sidebar__item--active' : ''}`}
                onClick={() => onNavigate(item.id)}
                title={item.label}
              >
                <span className="sidebar__icon">{item.icon}</span>
                <span className="sidebar__label">{item.label}</span>
                {item.id === 'dashboard' && connectedCount > 0 && (
                  <span className="sidebar__badge sidebar__badge--success">{connectedCount}</span>
                )}
                {item.id === 'claude' && claudeAvailable && (
                  <span className="sidebar__badge sidebar__badge--success">✓</span>
                )}
              </button>
            ))}
          </>
        )}
      </nav>

      {/* Bottom section */}
      <div className="sidebar__footer">
        <button
          className="sidebar__item"
          onClick={onToggleTheme}
          title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          <span className="sidebar__icon">
            {isDarkMode ? (
              // Sun icon for dark mode (click to light)
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              // Moon icon for light mode (click to dark)
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </span>
          <span className="sidebar__label">Toggle Theme</span>
        </button>
        <div className="sidebar__version">
          <span className="text-tertiary" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>v1.0.0</span>
        </div>
      </div>
    </aside>
  );
}
