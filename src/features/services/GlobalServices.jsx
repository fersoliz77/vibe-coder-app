import './GlobalServices.css';

const SERVICE_DEFS = [
  {
    id: 'vercel',
    name: 'Vercel',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 22h20L12 2z" />
      </svg>
    )
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    )
  },
  {
    id: 'firebase',
    name: 'Firebase',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.32 17.52L2.73 7.82c-.15-.96.96-1.5 1.63-.8l3.07 3.07m12.25 7.43l1.59-9.7c.15-.96-.96-1.5-1.63-.8l-3.07 3.07M12 2v20"/>
      </svg>
    )
  },
  {
    id: 'git',
    name: 'Git',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="18" r="3"></circle>
        <circle cx="6" cy="6" r="3"></circle>
        <circle cx="18" cy="6" r="3"></circle>
        <path d="M18 9v6"></path>
        <path d="M6 9v12"></path>
        <path d="M6 15h12"></path>
      </svg>
    )
  },
  {
    id: 'supabase',
    name: 'Supabase',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    )
  }
];

export default function GlobalServices({ services, inProject = false, onRefresh }) {
  const getService = (id) => {
    return services.find(x => x.id === id) || { connected: false, checking: true };
  };

  const serviceList = SERVICE_DEFS.map(def => ({
    ...def,
    ...getService(def.id),
  }));

  const allOperational = serviceList.every(s => s.connected && !s.checking);
  const anyChecking = serviceList.some(s => s.checking);
  const connectedCount = serviceList.filter(s => s.connected).length;

  return (
    <div className={`global-services ${inProject ? 'global-services--project' : ''}`}>
      <div className="global-services__header">
        <div className="global-services__title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12h4l2-9 4 18 2-9h6" />
          </svg>
          {inProject ? 'Project Services' : 'Provider Status'}
        </div>
        <div className="global-services__header-right">
          <div className={`global-services__badge ${anyChecking ? 'global-services__badge--checking' : allOperational ? 'global-services__badge--ok' : 'global-services__badge--warn'}`}>
            {anyChecking ? 'Checking...' : `${connectedCount}/${serviceList.length} Connected`}
          </div>
          {onRefresh && (
            <button
              className={`global-services__refresh ${anyChecking ? 'spinning' : ''}`}
              onClick={onRefresh}
              title="Refresh status"
              disabled={anyChecking}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="global-services__list">
        {serviceList.map(service => (
          <div key={service.id} className="global-service-item">
            <div className="global-service-item__left">
              <div className={`global-service-item__icon ${service.connected ? 'icon--connected' : ''}`}>
                {service.icon}
              </div>
              <div className="global-service-item__info">
                <span className="global-service-item__name">{service.name}</span>
                {!service.checking && service.user && (
                  <span className="global-service-item__account">{service.user}</span>
                )}
                {/* Account authentication and local project linking are separate states. */}
                {!service.checking && inProject && (
                  <span className={`global-service-item__project ${service.projectLinked === false ? 'global-service-item__project--unlinked' : ''}`}>
                    ↳ {service.projectLinked === false ? 'Proyecto no vinculado' : service.project || 'Proyecto local'}
                  </span>
                )}
              </div>
            </div>
            <div className="global-service-item__right">
              {service.checking ? (
                <div className="global-service-item__spinner">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              ) : service.connected ? (
                <div className="global-service-item__status dot-ok">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                  </svg>
                </div>
              ) : (
                <div className="global-service-item__status dot-err">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />
                  </svg>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
