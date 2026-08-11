import './Sidebar.css';
import ClaudeIcon from '../../components/icons/ClaudeIcon';
import OpenCodeIcon from '../../components/icons/OpenCodeIcon';
import { useI18n } from '../../i18n/I18nContext';
import { CheckIcon } from '../../components/icons/StatusIcons';

const NAV_ITEMS = [
  {
    id: 'dashboard',
    labelKey: 'sidebar.dashboard',
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
    labelKey: 'sidebar.explorer',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
    ),
  },
  {
    id: 'terminal',
    labelKey: 'sidebar.terminal',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
  {
    id: 'preview',
    labelKey: 'sidebar.preview',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="15" rx="2" />
        <path d="m10 9 5 3-5 3V9Z" />
      </svg>
    ),
  },
  {
    id: 'claude',
    label: 'Claude AI',
    icon: <ClaudeIcon />,
  },
  {
    id: 'openai',
    label: 'ChatGPT',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>
      </svg>
    ),
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    icon: <OpenCodeIcon />,
  },
];

export default function Sidebar({ activeView, onNavigate, connectedCount, claudeAvailable, openCodeAvailable, openAIAvailable, isDarkMode, onToggleTheme, onLogout, loggingOut, currentProject, onBackToProjects, authState }) {
  const { t } = useI18n();
  return (
    <aside className="sidebar">
      {/* Navigation */}
      <nav className="sidebar__nav">
        {!currentProject && (
          <>
            <button className={`sidebar__item ${activeView === 'dashboard' ? 'sidebar__item--active' : ''}`} onClick={() => onNavigate('dashboard')} type="button" aria-current={activeView === 'dashboard' ? 'page' : undefined}>
              <span className="sidebar__icon">{NAV_ITEMS[0].icon}</span><span className="sidebar__label">{t('sidebar.dashboard')}</span>
            </button>
            <button className={`sidebar__item ${activeView === 'projects' ? 'sidebar__item--active' : ''}`} onClick={() => onNavigate('projects')} type="button" aria-current={activeView === 'projects' ? 'page' : undefined}>
              <span className="sidebar__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7h6l2 2h10v10H3z"/><path d="M3 7V5h6l2 2"/></svg></span><span className="sidebar__label">{t('sidebar.projects')}</span>
            </button>
          </>
        )}
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
              <span className="sidebar__label">{t('sidebar.allProjects')}</span>
            </button>

            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`sidebar__item ${activeView === item.id ? 'sidebar__item--active' : ''}`}
                onClick={() => onNavigate(item.id)}
                title={item.labelKey ? t(item.labelKey) : item.label}
                type="button"
                aria-current={activeView === item.id ? 'page' : undefined}
              >
                <span className="sidebar__icon">{item.icon}</span>
                <span className="sidebar__label">{item.labelKey ? t(item.labelKey) : item.label}</span>
                {item.id === 'dashboard' && connectedCount > 0 && (
                  <span className="sidebar__badge sidebar__badge--success">{connectedCount}</span>
                )}
                {item.id === 'claude' && claudeAvailable && (
                  <span className="sidebar__badge sidebar__badge--success"><CheckIcon size={12} label={t('sidebar.connected')} /></span>
                )}
                {item.id === 'opencode' && openCodeAvailable && (
                  <span className="sidebar__badge sidebar__badge--success"><CheckIcon size={12} label={t('sidebar.connected')} /></span>
                )}
                {item.id === 'openai' && openAIAvailable && (
                  <span className="sidebar__badge sidebar__badge--success"><CheckIcon size={12} label={t('sidebar.connected')} /></span>
                )}
              </button>
            ))}
          </>
        )}
      </nav>

      {/* Bottom section */}
      <div className="sidebar__footer">
        <button className={`sidebar__item sidebar__item--learning ${activeView === 'learning' ? 'sidebar__item--active' : ''}`} onClick={() => onNavigate('learning')} title={t('sidebar.learning')} aria-label={t('sidebar.learning')} aria-current={activeView === 'learning' ? 'page' : undefined} type="button">
          <span className="sidebar__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 5 9-3 9 3-9 3-9-3Z"/><path d="M7 7v6c3 2 7 2 10 0V7"/><path d="M21 5v7"/></svg></span>
          <span className="sidebar__label">{t('sidebar.learning')}</span>
        </button>
       <button className={`sidebar__item ${activeView === 'settings' ? 'sidebar__item--active' : ''}`} onClick={() => onNavigate('settings')} title={t('sidebar.settings')} type="button" aria-current={activeView === 'settings' ? 'page' : undefined}>
          <span className="sidebar__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1.03H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.55V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.62.75 1.04 1.4 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15z"/></svg></span>
          <span className="sidebar__label">{t('sidebar.settings')} · {authState.user?.email || t('sidebar.account')}</span>
        </button>
        <button
          className="sidebar__item"
          onClick={onToggleTheme}
          title={isDarkMode ? t('sidebar.switchToLight') : t('sidebar.switchToDark')}
          type="button"
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
          <span className="sidebar__label">{t('sidebar.toggleTheme')}</span>
        </button>
        <button
          className="sidebar__item sidebar__item--logout"
          onClick={onLogout}
          title={t('auth.logout')}
          aria-label={t('auth.logout')}
          aria-busy={loggingOut}
          disabled={loggingOut}
          type="button"
        >
          <span className="sidebar__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            </svg>
          </span>
          <span className="sidebar__label">{t('auth.logout')}</span>
        </button>
        <div className="sidebar__version">
          <span className="text-tertiary" style={{ fontSize: '10px', letterSpacing: '0.5px' }}>v1.0.0</span>
        </div>
      </div>
    </aside>
  );
}
