import { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ProjectList from './components/ProjectList';
import FileExplorer from './components/FileExplorer';
import TerminalPanel from './components/TerminalPanel';
import ClaudePanel from './components/ClaudePanel';
import { useServices } from './hooks/useServices';
import { useTerminal } from './hooks/useTerminal';
import { useClaude } from './hooks/useClaude';
import './App.css';

const VIEWS = {
  PROJECTS: 'projects',
  DASHBOARD: 'dashboard',
  FILES: 'files',
  TERMINAL: 'terminal',
  CLAUDE: 'claude',
};

export default function App() {
  const [activeView, setActiveView] = useState(VIEWS.PROJECTS);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [currentProject, setCurrentProject] = useState(null);
  
  const serviceHook = useServices(currentProject?.path);
  const terminalHook = useTerminal(currentProject?.path);
  const claudeHook = useClaude(currentProject?.path);

  // Window controls
  const handleMinimize = () => window.electronAPI?.window?.minimize();
  const handleMaximize = () => window.electronAPI?.window?.maximize();
  const handleClose = () => window.electronAPI?.window?.close();
  const handleOpenProjectParent = useCallback(async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!currentProject?.path || !window.electronAPI?.fs?.openFolder) return;
    const result = await window.electronAPI.fs.openFolder(currentProject.path);
    if (result && !result.success) {
      console.error('Failed to open project folder:', result.error);
    }
  }, [currentProject]);

  useEffect(() => {
    if (!window.electronAPI?.window?.onMaximizedChanged) return undefined;

    window.electronAPI.window.isMaximized?.().then(setIsMaximized).catch(() => {});
    return window.electronAPI.window.onMaximizedChanged(setIsMaximized);
  }, []);

  // Quick action: open terminal from dashboard
  const handleOpenTerminal = useCallback(() => {
    if (!currentProject) return;
    setActiveView(VIEWS.TERMINAL);
    if (terminalHook.terminals.length === 0) {
      terminalHook.createTerminal();
    }
  }, [terminalHook, currentProject]);

  // Quick action: open Claude from dashboard
  const handleOpenClaude = useCallback(() => {
    if (!currentProject) return;
    setActiveView(VIEWS.CLAUDE);
  }, [currentProject]);

  const handleProjectSelect = useCallback((project) => {
    setCurrentProject(project);
    setActiveView(VIEWS.DASHBOARD);
  }, []);

  const handleBackToProjects = useCallback(() => {
    setCurrentProject(null);
    setActiveView(VIEWS.PROJECTS);
  }, []);

  // Theme toggle
  const toggleTheme = useCallback(() => {
    setIsDarkMode((prev) => !prev);
  }, []);

  // Apply theme class to body
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.add('light-theme');
    }
  }, [isDarkMode]);

  const renderView = () => {
    if (!currentProject || activeView === VIEWS.PROJECTS) {
      return (
        <ProjectList 
          onProjectSelect={handleProjectSelect}
          services={serviceHook.services}
          claudeAvailable={claudeHook.isAvailable}
          onRefreshServices={() => serviceHook.checkAll(null)}
        />
      );
    }

    switch (activeView) {
      case VIEWS.TERMINAL:
        return <TerminalPanel {...terminalHook} />;
      case VIEWS.CLAUDE:
        return <ClaudePanel {...claudeHook} />;
      case VIEWS.FILES:
        return <FileExplorer project={currentProject} />;
      case VIEWS.DASHBOARD:
      default:
        return (
          <Dashboard
            services={serviceHook}
            currentProject={currentProject}
            onRefreshAll={serviceHook.checkAll}
            onRefreshService={serviceHook.checkOne}
            onOpenTerminal={handleOpenTerminal}
            onOpenClaude={handleOpenClaude}
          />
        );
    }
  };

  return (
    <>
      {/* Custom Titlebar */}
      <div className="titlebar">
        <div className="titlebar__brand">
          <div className="titlebar__logo">V</div>
          <span className="titlebar__name">VibeCoder Launch</span>
        </div>
        {currentProject && (
          <div className="titlebar__project">
            <div className="titlebar__project-name">{currentProject.name}</div>
            <button
              className="titlebar__project-path"
              title={`Open parent folder: ${currentProject.path}`}
              onClick={handleOpenProjectParent}
              onMouseDown={(event) => event.stopPropagation()}
              onMouseUp={(event) => event.stopPropagation()}
              type="button"
            >
              {currentProject.path}
            </button>
          </div>
        )}
        <div className="titlebar__controls">
          <button className="titlebar__btn" onClick={handleMinimize} title="Minimize">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 8h10v1H3z"/></svg>
          </button>
          <button className="titlebar__btn" onClick={handleMaximize} title="Maximize">
            {isMaximized ? (
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 5v8h8V5H3zm7 7H4V6h6v6zm1-8v1h2v6h-2v1h3V4h-3z"/></svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3v10h10V3H3zm9 9H4V4h8v8z"/></svg>
            )}
          </button>
          <button className="titlebar__btn titlebar__btn--close" onClick={handleClose} title="Close">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 7.293l3.646-3.647.708.708L8.707 8l3.647 3.646-.708.708L8 8.707l-3.646 3.647-.708-.708L7.293 8 3.646 4.354l.708-.708L8 7.293z"/></svg>
          </button>
        </div>
      </div>

      {/* App Layout */}
      <div className="app-layout">
        <Sidebar
          activeView={activeView}
          onNavigate={setActiveView}
          connectedCount={serviceHook.connectedCount}
          claudeAvailable={claudeHook.isAvailable}
          isDarkMode={isDarkMode}
          onToggleTheme={toggleTheme}
          currentProject={currentProject}
          onBackToProjects={handleBackToProjects}
        />
        <main className="main-content">
          {renderView()}
        </main>
      </div>
    </>
  );
}
