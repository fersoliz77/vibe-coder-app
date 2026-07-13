import './ServiceCard.css';

const SERVICE_ICONS = {
  vercel: (
    <svg viewBox="0 0 76 65" fill="currentColor" className="service-icon__svg">
      <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
    </svg>
  ),
  supabase: (
    <svg viewBox="0 0 109 113" fill="none" className="service-icon__svg">
      <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#paint0_linear)" />
      <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#paint1_linear)" fillOpacity="0.2" />
      <path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" fill="#3ECF8E" />
      <defs>
        <linearGradient id="paint0_linear" x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse">
          <stop stopColor="#249361" />
          <stop offset="1" stopColor="#3ECF8E" />
        </linearGradient>
        <linearGradient id="paint1_linear" x1="36.1558" y1="30.578" x2="54.4844" y2="65.0806" gradientUnits="userSpaceOnUse">
          <stop />
          <stop offset="1" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="service-icon__svg">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  ),
  git: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="service-icon__svg">
      <path d="M23.546 10.93L13.067.452a2.9 2.9 0 00-4.107 0l-2.35 2.35 2.628 2.628c.84-.236 1.765.176 2.183.993.418.817.18 1.815-.572 2.385v4.298c.75.57 1.01 1.574.62 2.404-.39.83-1.315 1.258-2.176 1.008-.862-.25-1.423-1.077-1.32-1.95.103-.872.824-1.536 1.704-1.564v-4.3c-.88-.028-1.602-.692-1.705-1.564-.103-.873.458-1.7 1.32-1.95l-2.6-2.6L.452 13.07a2.9 2.9 0 000 4.107l10.48 10.478a2.9 2.9 0 004.106 0l8.508-8.508a2.9 2.9 0 000-4.107v-.11z" />
    </svg>
  ),
  firebase: (
    <svg viewBox="0 0 24 24" fill="none" className="service-icon__svg">
      <path d="M3.5 18L9.7 3.3c.3-.7 1.3-.7 1.6 0l2.4 5.6-4.5 4.5-5.7-5.7v10.3z" fill="#FFA000"/>
      <path d="M13.7 8.9l2.5-4.8c.3-.5 1-.5 1.3 0l4.3 12.3c.3.8-.3 1.7-1.2 1.7H14.1l-.4-.8z" fill="#F57C00"/>
      <path d="M19.8 18.1H4.2c-.9 0-1.3-1.1-.7-1.7l9.6-9.6c.4-.4 1-.4 1.4 0l5.9 5.9.7 2.1c.2.5.1 1.1-.3 1.4-.3.4-.8.6-1.3.6z" fill="#FFCA28"/>
    </svg>
  )
};

const SERVICE_COLORS = {
  vercel: { accent: '#fff', bg: 'rgba(255,255,255,0.06)' },
  supabase: { accent: '#3ECF8E', bg: 'rgba(62,207,142,0.08)' },
  github: { accent: '#f0f0f0', bg: 'rgba(240,240,240,0.06)' },
  git: { accent: '#F1502F', bg: 'rgba(241,80,47,0.08)' },
  firebase: { accent: '#FFCA28', bg: 'rgba(255,202,40,0.08)' },
};

export default function ServiceCard({ service, onRefresh }) {
  const { id, name, connected, user, checking } = service;
  const colors = SERVICE_COLORS[id] || SERVICE_COLORS.github;

  return (
    <div
      className={`service-card glass-card ${connected ? 'service-card--connected' : ''} ${checking ? 'service-card--checking' : ''}`}
      style={{ '--service-accent': colors.accent, '--service-bg': colors.bg }}
    >
      {/* Gradient border on connected */}
      {connected && <div className="service-card__glow" />}

      <div className="service-card__header">
        <div className="service-card__icon-wrap">
          {SERVICE_ICONS[id]}
        </div>
        <div className="service-card__status-wrap">
          <span className={`status-dot ${checking ? 'status-dot--checking' : connected ? 'status-dot--connected' : 'status-dot--disconnected'}`} />
          <span className="service-card__status-text">
            {checking ? 'Checking...' : connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      <div className="service-card__body">
        <h3 className="service-card__name">{name}</h3>
        {connected && user && (
          <p className="service-card__user text-mono">{user}</p>
        )}
        {!checking && (
          <p className={`service-card__hint ${!service.project ? 'service-card__hint--warn' : ''}`}>
            {!service.authenticated && service.projectLinked ? 'Cuenta no autenticada' : service.projectLinked === false ? 'Proyecto no vinculado' : service.project ? `Linked: ${service.project}` : 'Conectado al proyecto'}
          </p>
        )}
        {!connected && !checking && (
          <p className="service-card__hint">Not authenticated</p>
        )}
      </div>

      <div className="service-card__actions">
        <button
          className="btn btn--small"
          onClick={() => onRefresh(id)}
          disabled={checking}
        >
          {checking ? (
            <span className="service-card__spinner">⟳</span>
          ) : (
            '↻ Refresh'
          )}
        </button>
      </div>
    </div>
  );
}
