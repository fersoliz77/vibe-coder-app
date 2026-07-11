import { useState, useEffect } from 'react';
import GlobalServices from '../services/GlobalServices';
import './ProjectList.css';

export default function ProjectList({ onProjectSelect, services = [], claudeAvailable = false, onRefreshServices }) {
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setIsLoading(true);
    try {
      if (window.electronAPI && window.electronAPI.projects) {
        const data = await window.electronAPI.projects.list();
        setProjects(data);
      }
    } catch (e) {
      console.error(e);
    }
    setIsLoading(false);
  };

  const handleImport = async () => {
    if (window.electronAPI && window.electronAPI.projects) {
      const folderPath = await window.electronAPI.projects.openDirectoryDialog();
      if (folderPath) {
        const newProject = await window.electronAPI.projects.add(folderPath);
        onProjectSelect(newProject);
      }
    }
  };

  const handleCreate = async () => {
    if (window.electronAPI && window.electronAPI.projects) {
      const folderPath = await window.electronAPI.projects.createDirectoryDialog();
      if (folderPath) {
        const newProject = await window.electronAPI.projects.add(folderPath);
        onProjectSelect(newProject);
      }
    }
  };

  const handleSelect = async (project) => {
    if (window.electronAPI && window.electronAPI.projects) {
      await window.electronAPI.projects.updateLastOpened(project.id);
    }
    onProjectSelect(project);
  };

  const handleRemove = async (e, id) => {
    e.stopPropagation();
    if (window.electronAPI && window.electronAPI.projects) {
      await window.electronAPI.projects.remove(id);
      loadProjects();
    }
  };

  return (
    <div className="project-dashboard-layout">
      <div className="project-list-main">
        <div className="project-header">
          <h1 className="project-title">Your Projects</h1>
        </div>

      {/* Project Cards Grid */}
      {!isLoading && projects.length > 0 ? (
        <div className="project-grid">
          {projects.map(proj => (
            <div key={proj.id} className="glass-card project-card" onClick={() => handleSelect(proj)}>
              <div className="project-card__header">
                <div className="project-card__icon-wrapper project-card__icon-wrapper--folder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <button
                  className="project-card__remove"
                  onClick={(e) => handleRemove(e, proj.id)}
                  title="Remove from list"
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
                    Last opened: {new Date(proj.lastOpened).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : !isLoading ? (
        <div className="project-empty">
          <p className="text-tertiary">No projects yet. Create or import one below.</p>
        </div>
      ) : null}

        {/* Text Links: Create / Import */}
        <div className="project-actions-bar">
          <button className="project-action-link" onClick={handleCreate}>
            + New Project
          </button>
          <span className="project-actions-divider">·</span>
          <button className="project-action-link" onClick={handleImport}>
            Import existing folder
          </button>
        </div>
      </div>

      <div className="project-list-sidebar">
        <GlobalServices services={services} onRefresh={onRefreshServices} />
      </div>
    </div>
  );
}

