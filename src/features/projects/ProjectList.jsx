import { useState, useEffect } from 'react';
import GlobalServices from '../services/GlobalServices';
import CreateProjectWizard from './CreateProjectWizard';
import './ProjectList.css';
import { useI18n } from '../../i18n/I18nContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import { ASYNC_STATES, loading, runAsync } from '../../utils/asyncState';

export default function ProjectList({ onProjectSelect, onOpenSetup, services = [], claudeAvailable = false, onRefreshServices }) {
  const { t, formatDate } = useI18n();
  // Antes: `isLoading` mas una lista vacia. Listar podia fallar, el error se
  // escribia en la consola y la pantalla quedaba en blanco, indistinguible de
  // "todavia no creaste ningun proyecto".
  const [listing, setListing] = useState(loading([]));
  const [wizardOpen, setWizardOpen] = useState(false);
  const [createdProject, setCreatedProject] = useState(null);
  const [environmentMissing, setEnvironmentMissing] = useState(false);
  const [projectError, setProjectError] = useState('');
  // Proyecto pendiente de confirmacion antes de quitarlo de la lista.
  const [pendingRemoval, setPendingRemoval] = useState(null);

  useEffect(() => {
    loadProjects();
    window.electronAPI?.setup?.check({ includeMobile: true, backend: 'firebase' })
      .then((environment) => setEnvironmentMissing(Boolean(environment?.summary?.requiredMissing)))
      .catch(() => {});
  }, []);

  const loadProjects = async () => {
    setListing((current) => loading(current.data ?? []));
    setListing(await runAsync(
      async () => (window.electronAPI?.projects ? await window.electronAPI.projects.list() : []),
      { fallbackError: t('projects.listFailed') },
    ));
  };

  const handleImport = async () => {
    setProjectError('');
    try {
      if (window.electronAPI && window.electronAPI.projects) {
        const newProject = await window.electronAPI.projects.import();
        if (newProject) onProjectSelect(newProject);
      }
    } catch (error) {
      setProjectError(error?.message || t('projects.importFailed'));
    }
  };

  const handleCreate = async () => {
    setCreatedProject(null);
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    if (createdProject) onProjectSelect(createdProject);
  };

  const handleSelect = async (project) => {
    if (window.electronAPI && window.electronAPI.projects) {
      await window.electronAPI.projects.updateLastOpened(project.id);
    }
    onProjectSelect(project);
  };

  const handleRemove = (e, project) => {
    e.stopPropagation();
    setPendingRemoval(project);
  };

  const confirmRemove = async () => {
    const project = pendingRemoval;
    setPendingRemoval(null);
    if (!project || !window.electronAPI?.projects) return;
    setProjectError('');
    try {
      await window.electronAPI.projects.remove(project.id);
    } catch (error) {
      setProjectError(error?.message || t('projects.removeFailed'));
      return;
    }
    loadProjects();
  };

  return (
    <div className="project-dashboard-layout">
      <div className="project-list-main">
        <div className="project-header">
          <div><h1 className="project-title">{t('projects.heading')}</h1><p className="project-subtitle">{t('projects.subtitle')}</p></div>
          <button className="btn btn--primary" type="button" onClick={handleCreate}>{t('projects.create')}</button>
        </div>

        {environmentMissing && <div className="project-setup-banner"><div><strong>{t('projects.environmentNeeded')}</strong><span>{t('projects.environmentCopy')}</span></div><button type="button" onClick={onOpenSetup}>{t('projects.reviewEnvironment')}</button></div>}
        {projectError && <div className="project-error" role="alert">{projectError}</div>}

      {/* Los cuatro estados que esta pantalla puede tener, cada uno con su cara. */}
      {listing.state === ASYNC_STATES.LOADING && (
        <div className="project-empty" role="status">
          <p className="text-tertiary">{t('projects.loading')}</p>
        </div>
      )}

      {listing.state === ASYNC_STATES.ERROR && (
        <div className="project-error project-error--block" role="alert">
          <div>
            <strong>{t('projects.listFailed')}</strong>
            <p>{listing.error}</p>
          </div>
          <button className="btn btn--primary" type="button" onClick={loadProjects}>{t('projects.retry')}</button>
        </div>
      )}

      {listing.state === ASYNC_STATES.EMPTY && (
        <div className="project-empty">
          <p className="text-tertiary">{t('projects.empty')}</p>
        </div>
      )}

      {listing.state === ASYNC_STATES.SUCCESS && (
        <div className="project-grid">
          {listing.data.map(proj => (
            <div key={proj.id} className="glass-card project-card" role="button" tabIndex="0" onClick={() => handleSelect(proj)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); handleSelect(proj); } }}>
              <div className="project-card__header">
                <div className="project-card__icon-wrapper project-card__icon-wrapper--folder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <button
                  className="project-card__remove"
                  onClick={(e) => handleRemove(e, proj)}
                  title={t('projects.remove')}
                  aria-label={t('projects.removeAria', { name: proj.name })}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <div className="project-card__content">
                <h3>{proj.name}</h3>
                <p className="text-tertiary" title={proj.path}>
                  {proj.path.length > 30 ? '...' + proj.path.substring(proj.path.length - 27) : proj.path}
                </p>
                <div className="project-card__meta">
                  <span className="project-card__date">
                    {t('projects.lastOpened', { date: formatDate(proj.lastOpened) })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

        {/* Text Links: Create / Import */}
        <div className="project-actions-bar">
          <button className="project-action-link" onClick={handleCreate}>
            + {t('projects.create')}
          </button>
          <span className="project-actions-divider">·</span>
          <button className="project-action-link" onClick={handleImport}>
            {t('projects.import')}
          </button>
        </div>
      </div>

      <div className="project-list-sidebar">
        <GlobalServices services={services} onRefresh={onRefreshServices} />
      </div>
      {wizardOpen && <CreateProjectWizard onClose={closeWizard} onCreated={(response) => { setCreatedProject(response.project); loadProjects(); }} />}
      <ConfirmDialog
        open={Boolean(pendingRemoval)}
        title={t('projects.removeTitle', { name: pendingRemoval?.name })}
        description={t('projects.removeCopy')}
        detail={t('projects.removeDetail', { path: pendingRemoval?.path })}
        confirmLabel={t('projects.removeConfirm')}
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemoval(null)}
      />
    </div>
  );
}
