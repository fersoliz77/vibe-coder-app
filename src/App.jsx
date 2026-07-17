import { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './layouts/sidebar/Sidebar';
import Dashboard from './features/dashboard/Dashboard';
import ProjectList from './features/projects/ProjectList';
import FileExplorer from './features/explorer/FileExplorer';
import TerminalPanel from './features/terminal/TerminalPanel';
import ClaudePanel from './features/claude/ClaudePanel';
import OpenAIPanel from './features/openai/OpenAIPanel';
import { useServices } from './hooks/useServices';
import { useTerminal } from './hooks/useTerminal';
import { useClaude } from './hooks/useClaude';
import { useAppStore } from './store/useAppStore';
import AuthGate from './features/auth/AuthGate';
import { useAuth } from './features/auth/AuthContext';
import SettingsPanel from './features/settings/SettingsPanel';
import OpenCodeSetupDialog from './features/opencode/OpenCodeSetupDialog';
import OpenCodePanel from './features/opencode/OpenCodePanel';
import OnboardingWizard from './features/setup/OnboardingWizard';
import PreviewCenter from './features/preview/PreviewCenter';
import { useI18n } from './i18n/I18nContext';
import './styles/App.css';

const VIEWS = {
  PROJECTS: 'projects',
  DASHBOARD: 'dashboard',
  FILES: 'files',
  TERMINAL: 'terminal',
  CLAUDE: 'claude',
  OPENAI: 'openai',
  SETTINGS: 'settings',
  OPENCODE: 'opencode',
  PREVIEW: 'preview',
};

const OPENCODE_BOOTSTRAP_KEY = 'opencodeBootstrapCompleted';

function Workspace() {
  const { state: authState } = useAuth();
  const { t } = useI18n();
  const [activeView, setActiveView] = useState(VIEWS.DASHBOARD);
  const [isMaximized, setIsMaximized] = useState(false);
  const [openCodeStatus, setOpenCodeStatus] = useState(null);
  const [openCodeSetup, setOpenCodeSetup] = useState({ open: false, phase: 'idle', progress: '', error: '' });
  const [openAIAvailable, setOpenAIAvailable] = useState(false);
  const openCodeRequest = useRef(0);

  // Onboarding: null = not yet loaded from store, false = needs onboarding, true = done
  const [onboardingDone, setOnboardingDone] = useState(null);
  const {
    currentProject,
    theme,
    initialized,
    setCurrentProject,
    clearCurrentProject,
    setTheme,
  } = useAppStore();
  const isDarkMode = theme !== 'light';
  
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
    const result = await window.electronAPI.fs.openFolder(currentProject.path, currentProject.path);
    if (result && !result.success) {
      console.error('Failed to open project folder:', result.error);
    }
  }, [currentProject]);

  useEffect(() => {
    // Load onboarding flag from persistent store
    if (!window.electronAPI?.store) { setOnboardingDone(true); return; }
    window.electronAPI.store.get('onboardingCompleted', false).then((done) => {
      setOnboardingDone(Boolean(done));
    });
  }, []);

  useEffect(() => {
    try {
      const accessibility = JSON.parse(localStorage.getItem('vibe-accessibility') || '{}');
      document.body.classList.toggle('high-contrast', Boolean(accessibility.highContrast));
      document.body.classList.toggle('reduced-motion', Boolean(accessibility.reducedMotion));
    } catch {}
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.window?.onMaximizedChanged) return undefined;

    window.electronAPI.window.isMaximized?.().then(setIsMaximized).catch(() => {});
    return window.electronAPI.window.onMaximizedChanged(setIsMaximized);
  }, []);

  useEffect(() => {
    if (!initialized || !window.electronAPI?.opencode?.getStatus || !window.electronAPI?.store) return undefined;
    let cancelled = false;
    const runBootstrap = async () => {
      try {
        const [status, alreadyBootstrapped] = await Promise.all([
          window.electronAPI.opencode.getStatus(),
          window.electronAPI.store.get(OPENCODE_BOOTSTRAP_KEY, false),
        ]);
        if (cancelled) return;
        setOpenCodeStatus(status);
        if (!alreadyBootstrapped) {
          if (status.usable) {
            await window.electronAPI.store.set(OPENCODE_BOOTSTRAP_KEY, true);
          } else {
            setOpenCodeSetup({ open: true, phase: 'checking', progress: '', error: '' });
            const result = await window.electronAPI.opencode.install();
            if (cancelled) return;
            if (result?.success && result.status?.usable) {
              setOpenCodeStatus(result.status);
              setOpenCodeSetup({ open: false, phase: 'idle', progress: '', error: '' });
              await window.electronAPI.store.set(OPENCODE_BOOTSTRAP_KEY, true);
            } else if (result?.cancelled) {
              setOpenCodeSetup({ open: false, phase: 'idle', progress: '', error: '' });
            } else if (!result?.busy) {
              setOpenCodeSetup({ open: true, phase: 'idle', progress: '', error: result?.error || t('app.openCodeFirstRunFailed') });
            }
          }
        }
      } catch {
        if (!cancelled) setOpenCodeSetup((current) => current.open ? current : { open: true, phase: 'error', progress: '', error: t('app.openCodeFirstRunPrepareFailed') });
      }
    };
    runBootstrap();
    return () => { cancelled = true; };
  }, [initialized, t]);

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

  const handleOpenOpenAI = useCallback(() => {
    if (!currentProject) return;
    setActiveView(VIEWS.OPENAI);
  }, [currentProject]);

  const handleOpenCode = useCallback(async () => {
    if (!currentProject || !window.electronAPI?.opencode) return;
    const requestId = ++openCodeRequest.current;
    if (openCodeStatus?.usable) {
      terminalHook.createOpenCodeTerminal();
      setActiveView(VIEWS.OPENCODE);
      return;
    }
    try {
      const status = await window.electronAPI.opencode.getStatus();
      if (requestId !== openCodeRequest.current) return;
      setOpenCodeStatus(status);
      if (status.usable) {
        terminalHook.createOpenCodeTerminal();
        setActiveView(VIEWS.OPENCODE);
      } else {
        setOpenCodeSetup({ open: true, phase: 'idle', progress: '', error: status.installed ? t('app.openCodeRepair') : '' });
      }
    } catch (error) {
      setOpenCodeSetup({ open: true, phase: 'error', progress: '', error: error?.message || t('app.openCodeCheckFailed') });
    }
  }, [currentProject, openCodeStatus, terminalHook.createOpenCodeTerminal, t]);

  const installOpenCode = useCallback(async () => {
    const requestId = ++openCodeRequest.current;
    setOpenCodeSetup({ open: true, phase: 'installing', progress: t('app.downloadingOfficialPackage'), error: '' });
    try {
      const result = await window.electronAPI.opencode.install();
      if (requestId !== openCodeRequest.current) return;
      if (result.cancelled) {
        setOpenCodeSetup({ open: true, phase: 'idle', progress: '', error: '' });
        return;
      }
      if (!result.success) throw new Error(result.error || t('app.openCodeInstallFailed'));
      setOpenCodeStatus(result.status);
      terminalHook.createOpenCodeTerminal();
      setActiveView(VIEWS.OPENCODE);
    } catch (error) {
      setOpenCodeSetup({ open: true, phase: 'error', progress: '', error: error?.message || t('app.openCodeInstallFailed') });
    }
  }, [terminalHook.createOpenCodeTerminal, t]);

  // Preload OpenCode in background when project is selected and OpenCode is usable
  useEffect(() => {
    if (currentProject && openCodeStatus?.usable) {
      terminalHook.createOpenCodeTerminal();
    }
  }, [currentProject, openCodeStatus, terminalHook.createOpenCodeTerminal]);

  // Check OpenAI connection status to show green check badge in sidebar
  useEffect(() => {
    if (!window.electronAPI?.openai) return;
    const checkOpenAI = async () => {
      try {
        const s = await window.electronAPI.openai.getStatus();
        setOpenAIAvailable(Boolean(s?.authenticated));
      } catch {}
    };
    checkOpenAI();
  }, [activeView]);


  const closeOpenCodeSetup = useCallback(() => {
    openCodeRequest.current += 1;
    setOpenCodeSetup({ open: false, phase: 'idle', progress: '', error: '' });
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.opencode?.onInstallProgress) return undefined;
    return window.electronAPI.opencode.onInstallProgress((progress) => {
      setOpenCodeSetup((current) => current.phase === 'installing'
        ? { ...current, progress: progress.message || current.progress }
        : current);
    });
  }, []);

  useEffect(() => {
    if (!currentProject || activeView !== VIEWS.TERMINAL || terminalHook.terminals.length !== 0) return;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('open') === 'opencode') handleOpenCode();
  }, [activeView, currentProject, terminalHook.terminals.length, handleOpenCode]);

  const handleNavigate = useCallback((view) => {
    if (view === 'opencode') handleOpenCode();
    else setActiveView(view);
  }, [handleOpenCode]);

  const handleProjectSelect = useCallback((project) => {
    terminalHook.closeAllTerminals();
    closeOpenCodeSetup();
    if (currentProject?.path && currentProject.path !== project.path) {
      window.electronAPI?.preview?.web?.stop(currentProject.path).catch(() => {});
      window.electronAPI?.preview?.android?.stopEmulator(currentProject.path).catch(() => {});
    }
    setCurrentProject(project);
    setActiveView(VIEWS.DASHBOARD);
  }, [terminalHook.closeAllTerminals, closeOpenCodeSetup, currentProject, setCurrentProject]);

  const handleBackToProjects = useCallback(() => {
    terminalHook.closeAllTerminals();
    closeOpenCodeSetup();
    if (currentProject?.path) {
      window.electronAPI?.preview?.web?.stop(currentProject.path).catch(() => {});
      window.electronAPI?.preview?.android?.stopEmulator(currentProject.path).catch(() => {});
    }
    clearCurrentProject();
    setActiveView(VIEWS.PROJECTS);
  }, [clearCurrentProject, terminalHook.closeAllTerminals, closeOpenCodeSetup, currentProject]);

  // Theme toggle
  const toggleTheme = useCallback(() => {
    setTheme(isDarkMode ? 'light' : 'dark');
  }, [isDarkMode, setTheme]);

  // Apply theme class to body
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.add('light-theme');
    }
  }, [isDarkMode]);

  const renderView = () => {
    if (!initialized) {
      return <div className="main-content__loading">{t('common.loadingWorkspace')}</div>;
    }

    if (activeView === VIEWS.SETTINGS) {
      return <SettingsPanel theme={theme} onSetTheme={setTheme} onReopenOnboarding={() => setOnboardingDone(false)} />;
    }

    if (activeView === VIEWS.PROJECTS) {
      return (
        <ProjectList 
          onProjectSelect={handleProjectSelect}
          services={serviceHook.services}
          claudeAvailable={claudeHook.isAvailable}
          onRefreshServices={() => serviceHook.checkAll(null)}
          onOpenSetup={() => setActiveView(VIEWS.SETTINGS)}
        />
      );
    }

    switch (activeView) {
      case VIEWS.TERMINAL:
        return <TerminalPanel {...terminalHook} />;
      case VIEWS.CLAUDE:
        return <ClaudePanel {...claudeHook} />;
      case VIEWS.OPENAI:
        return <OpenAIPanel cwd={currentProject?.path} />;
      case VIEWS.FILES:
        return <FileExplorer project={currentProject} />;
      case VIEWS.PREVIEW:
        return currentProject ? <PreviewCenter project={currentProject} /> : null;
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
            onOpenCode={handleOpenCode}
            onOpenProjects={() => setActiveView(VIEWS.PROJECTS)}
          />
        );
    }
  };

  // While we haven't loaded the onboarding flag yet, render nothing
  if (onboardingDone === null) return null;

  // Show full-screen onboarding wizard on first launch
  if (!onboardingDone) {
    return (
      <OnboardingWizard
        onComplete={() => setOnboardingDone(true)}
      />
    );
  }

  return (
    <>
      {/* Custom Titlebar */}
      <div className="titlebar">
        <div className="titlebar__brand">
          <div className="titlebar__logo">V</div>
          <span className="titlebar__name">Vibe IDE Code</span>
        </div>
        {currentProject && (
          <div className="titlebar__project">
            <div className="titlebar__project-name">{currentProject.name}</div>
            <button
              className="titlebar__project-path"
              title={t('common.openParentFolder', { path: currentProject.path })}
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
          <button className="titlebar__btn" onClick={handleMinimize} title={t('common.minimize')}>
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 8h10v1H3z"/></svg>
          </button>
          <button className="titlebar__btn" onClick={handleMaximize} title={t('common.maximize')}>
            {isMaximized ? (
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 5v8h8V5H3zm7 7H4V6h6v6zm1-8v1h2v6h-2v1h3V4h-3z"/></svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3v10h10V3H3zm9 9H4V4h8v8z"/></svg>
            )}
          </button>
          <button className="titlebar__btn titlebar__btn--close" onClick={handleClose} title={t('common.close')}>
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 7.293l3.646-3.647.708.708L8.707 8l3.647 3.646-.708.708L8 8.707l-3.646 3.647-.708-.708L7.293 8 3.646 4.354l.708-.708L8 7.293z"/></svg>
          </button>
        </div>
      </div>

      {/* App Layout */}
      <div className="app-layout">
        <Sidebar
          activeView={activeView}
          onNavigate={handleNavigate}
          connectedCount={serviceHook.connectedCount}
          claudeAvailable={claudeHook.isAvailable}
          openCodeAvailable={Boolean(openCodeStatus?.installed)}
          openAIAvailable={openAIAvailable}
          isDarkMode={isDarkMode}
          onToggleTheme={toggleTheme}
          currentProject={currentProject}
          onBackToProjects={handleBackToProjects}
          authState={authState}
        />
        <main className="main-content">
          {currentProject && (
            <div
              style={{
                display: activeView === VIEWS.OPENCODE ? 'block' : 'none',
                height: '100%',
                width: '100%',
              }}
            >
              <OpenCodePanel
                activeView={activeView}
                project={currentProject}
                terminalHook={terminalHook}
              />
            </div>
          )}
          {activeView !== VIEWS.OPENCODE && renderView()}
        </main>
        {openCodeSetup.open && <OpenCodeSetupDialog state={openCodeSetup} onClose={closeOpenCodeSetup} onInstall={installOpenCode} />}
      </div>
    </>
  );
}

export default function App() {
  return <AuthGate><Workspace /></AuthGate>;
}
