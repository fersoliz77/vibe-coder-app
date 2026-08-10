import { lazy, Suspense, useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './layouts/sidebar/Sidebar';
import Dashboard from './features/dashboard/Dashboard';
import ProjectList from './features/projects/ProjectList';
import FileExplorer from './features/explorer/FileExplorer';
import TerminalPanel from './features/terminal/TerminalPanel';
import { useServices } from './hooks/useServices';
import { useTerminal } from './hooks/useTerminal';
import { useClaude } from './hooks/useClaude';
import { useAppStore } from './store/useAppStore';
import AuthGate from './features/auth/AuthGate';
import { useAuth } from './features/auth/AuthContext';
import { applyDocumentTheme } from './utils/theme';
import OpenCodeSetupDialog from './features/opencode/OpenCodeSetupDialog';
import OpenCodePanel from './features/opencode/OpenCodePanel';
import { useI18n } from './i18n/I18nContext';
import './styles/App.css';
import { VIEWS, restoreView } from './utils/viewRestore';
import AppSplash from './components/AppSplash';
import { applyAccessibility, readAccessibility } from './utils/accessibility';
import MandatoryUpdateGate from './features/updates/MandatoryUpdateGate';
import { getEnvironmentInstallPercent, getEnvironmentInstallStatus } from './features/setup/environmentProgress';

const ClaudePanel = lazy(() => import('./features/claude/ClaudePanel'));
const OpenAIPanel = lazy(() => import('./features/openai/OpenAIPanel'));
const SettingsPanel = lazy(() => import('./features/settings/SettingsPanel'));
const OnboardingWizard = lazy(() => import('./features/setup/OnboardingWizard'));
const PreviewCenter = lazy(() => import('./features/preview/PreviewCenter'));


const OPENCODE_BOOTSTRAP_KEY = 'opencodeBootstrapCompleted';


function Workspace({ setCloseCheck }) {
  const { state: authState, logout } = useAuth();
  const { t } = useI18n();
  const [activeView, setActiveView] = useState(VIEWS.DASHBOARD);
  const [isMaximized, setIsMaximized] = useState(false);
  const [openCodeStatus, setOpenCodeStatus] = useState(null);
  const [openCodeSetup, setOpenCodeSetup] = useState({ open: false, phase: 'idle', progress: '', error: '' });
  const [openAIAvailable, setOpenAIAvailable] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [environmentInstallation, setEnvironmentInstallation] = useState({ status: 'idle', progress: null });
  const openCodeRequest = useRef(0);
  const explorerRef = useRef(null);

  // Onboarding: null = not yet loaded from store, false = needs onboarding, true = done
  const [onboardingDone, setOnboardingDone] = useState(null);
  const [onboardingError, setOnboardingError] = useState('');
  const {
    currentProject,
    theme,
    initialized,
    lastView,
    setCurrentProject,
    clearCurrentProject,
    setTheme,
    setLastView,
  } = useAppStore();
  const viewRestored = useRef(false);
  const isDarkMode = theme !== 'light';
  
  const serviceHook = useServices(currentProject?.path);
  const terminalHook = useTerminal(currentProject?.path);
  const claudeHook = useClaude(currentProject?.path);

  // Window controls
  const handleMinimize = () => window.electronAPI?.window?.minimize();
  const handleMaximize = () => window.electronAPI?.window?.maximize();
  const handleClose = async () => {
    window.electronAPI?.window?.close();
  };

  useEffect(() => setCloseCheck(async () => await explorerRef.current?.prepareToLeave?.() !== false), [setCloseCheck]);
  const handleOpenProjectParent = useCallback(async (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!currentProject?.path || !window.electronAPI?.fs?.openFolder) return;
    const result = await window.electronAPI.fs.openFolder(currentProject.path, currentProject.path);
    if (result && !result.success) {
      console.error('Failed to open project folder:', result.error);
    }
  }, [currentProject]);

  const loadOnboarding = useCallback(async () => {
    setOnboardingError('');
    if (!window.electronAPI?.store) { setOnboardingDone(true); return; }
    try {
      const done = await window.electronAPI.store.get('onboardingCompleted', false);
      setOnboardingDone(Boolean(done));
    } catch (error) {
      setOnboardingError(error?.message || t('app.initializationFailed'));
    }
  }, [t]);

  useEffect(() => {
    loadOnboarding();
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.window?.onMaximizedChanged) return undefined;

    window.electronAPI.window.isMaximized?.().then(setIsMaximized).catch(() => {});
    return window.electronAPI.window.onMaximizedChanged(setIsMaximized);
  }, []);

  useEffect(() => {
    const setup = window.electronAPI?.setup;
    if (!setup?.onProgress) return undefined;
    let active = true;
    setup.getState?.().then((state) => {
      if (active && state) setEnvironmentInstallation(state);
    }).catch(() => {});
    const unsubscribe = setup.onProgress((progress) => {
      if (active) setEnvironmentInstallation({ status: getEnvironmentInstallStatus(progress), progress });
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
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

  // Configuracion informaba el estado de GitHub/Vercel pero no ofrecia forma de
  // conectarlos. El comando oficial se ejecuta en la terminal del proyecto, que
  // es la unica con cwd autorizado.
  const handleRunInTerminal = useCallback(async (command) => {
    if (!currentProject || !command) return false;
    setActiveView(VIEWS.TERMINAL);
    const existing = terminalHook.terminals.find((term) => !term.error);
    const target = existing ?? await terminalHook.createTerminal();
    if (!target?.id || target.error) return false;
    terminalHook.setActiveTerminalId(target.id);
    terminalHook.writeToTerminal(target.id, `${command}\r`);
    return true;
  }, [currentProject, terminalHook]);

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

  // Restaura la ultima vista una unica vez, cuando el store ya cargo.
  useEffect(() => {
    if (!initialized || viewRestored.current) return;
    viewRestored.current = true;
    setActiveView(restoreView(lastView, Boolean(currentProject)));
  }, [initialized, lastView, currentProject]);

  // Recien despues de restaurar se empieza a guardar, para no pisar
  // la vista guardada con el valor inicial por defecto.
  useEffect(() => {
    if (!viewRestored.current) return;
    setLastView(activeView);
  }, [activeView, setLastView]);

  const handleNavigate = useCallback((view) => {
    if (view === 'opencode') handleOpenCode();
    else setActiveView(view);
  }, [handleOpenCode]);

  const handleProjectSelect = useCallback(async (project) => {
    if (currentProject?.path && currentProject.path !== project.path && await explorerRef.current?.prepareToLeave?.() === false) return;
    claudeHook.cancel();
    window.electronAPI?.openai?.cancel();
    terminalHook.closeAllTerminals();
    closeOpenCodeSetup();
    if (currentProject?.path && currentProject.path !== project.path) {
      window.electronAPI?.preview?.web?.stop(currentProject.path).catch(() => {});
      window.electronAPI?.preview?.android?.stopEmulator(currentProject.path).catch(() => {});
    }
    setCurrentProject(project);
    setActiveView(VIEWS.DASHBOARD);
  }, [terminalHook.closeAllTerminals, closeOpenCodeSetup, currentProject, setCurrentProject]);

  const handleBackToProjects = useCallback(async () => {
    if (await explorerRef.current?.prepareToLeave?.() === false) return;
    claudeHook.cancel();
    window.electronAPI?.openai?.cancel();
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

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    if (await explorerRef.current?.prepareToLeave?.() === false) return;
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }, [loggingOut, logout]);

  const renderView = () => {
    if (!initialized) {
      return <AppSplash />;
    }

    if (activeView === VIEWS.SETTINGS) {
      return (
        <SettingsPanel
          theme={theme}
          onSetTheme={setTheme}
          onReopenOnboarding={() => setOnboardingDone(false)}
          onRunInTerminal={handleRunInTerminal}
          canRunInTerminal={Boolean(currentProject)}
        />
      );
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
        return <TerminalPanel {...terminalHook} isDark={isDarkMode} />;
      case VIEWS.CLAUDE:
        return <ClaudePanel {...claudeHook} />;
      case VIEWS.OPENAI:
        return <OpenAIPanel cwd={currentProject?.path} />;
      case VIEWS.FILES:
        return null;
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
            onOpenPreview={() => setActiveView(VIEWS.PREVIEW)}
            onOpenFiles={() => setActiveView(VIEWS.FILES)}
            onOpenProjects={() => setActiveView(VIEWS.PROJECTS)}
          />
        );
    }
  };

  const environmentProgress = environmentInstallation.progress;
  const environmentPercentage = getEnvironmentInstallPercent(environmentProgress);
  const showEnvironmentToast = environmentInstallation.status === 'installing' && activeView !== VIEWS.SETTINGS;

  // Mientras se lee la bandera de onboarding se muestra la marca, no un vacio.
  if (onboardingDone === null) return <AppSplash error={onboardingError} onRetry={loadOnboarding} />;

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
          <button className="titlebar__btn" onClick={handleMinimize} title={t('common.minimize')} aria-label={t('common.minimize')}>
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 8h10v1H3z"/></svg>
          </button>
          <button className="titlebar__btn" onClick={handleMaximize} title={t('common.maximize')} aria-label={t('common.maximize')}>
            {isMaximized ? (
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 5v8h8V5H3zm7 7H4V6h6v6zm1-8v1h2v6h-2v1h3V4h-3z"/></svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3v10h10V3H3zm9 9H4V4h8v8z"/></svg>
            )}
          </button>
          <button className="titlebar__btn titlebar__btn--close" onClick={handleClose} title={t('common.close')} aria-label={t('common.close')}>
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
          onLogout={handleLogout}
          loggingOut={loggingOut}
          currentProject={currentProject}
          onBackToProjects={handleBackToProjects}
          authState={authState}
        />
        <main className="main-content">
          {currentProject && (
            <div style={{ display: activeView === VIEWS.FILES ? 'block' : 'none', height: '100%', width: '100%' }}>
              <FileExplorer ref={explorerRef} project={currentProject} isDark={isDarkMode} />
            </div>
          )}
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
                isDark={isDarkMode}
              />
            </div>
          )}
          {activeView !== VIEWS.OPENCODE && renderView()}
        </main>
        {openCodeSetup.open && <OpenCodeSetupDialog state={openCodeSetup} onClose={closeOpenCodeSetup} onInstall={installOpenCode} />}
      </div>
      {showEnvironmentToast && (
        <aside className="vc-toast environment-install-toast" role="status" aria-live="polite" aria-label={t('setup.backgroundInstallTitle')}>
          <div className="environment-install-toast__heading">
            <span className="environment-install-toast__pulse" aria-hidden="true" />
            <strong>{environmentProgress?.label || t('setup.backgroundInstallTitle')}</strong>
            {environmentPercentage !== null && <span>{environmentPercentage}%</span>}
          </div>
          <p>{environmentProgress?.message || t('setup.preparingInstallation')}</p>
          <div className="environment-install-toast__track" role="progressbar" aria-label={t('setup.progress')} aria-valuemin="0" aria-valuemax="100" {...(environmentPercentage !== null ? { 'aria-valuenow': environmentPercentage } : {})}>
            <span className={environmentPercentage === null ? 'is-indeterminate' : ''} style={environmentPercentage !== null ? { width: `${environmentPercentage}%` } : undefined} />
          </div>
          <div className="environment-install-toast__footer">
            <span>{t('setup.backgroundInstallCopy')}</span>
            <button type="button" onClick={() => setActiveView(VIEWS.SETTINGS)}>{t('setup.viewProgress')}</button>
          </div>
        </aside>
      )}
    </>
  );
}

export default function App() {
  const { initialized, initializationError, init, theme } = useAppStore();
  const closeCheckRef = useRef(null);
  const setCloseCheck = useCallback((check) => {
    closeCheckRef.current = check;
    return () => { if (closeCheckRef.current === check) closeCheckRef.current = null; };
  }, []);
  const prepareToRestart = useCallback(async () => !closeCheckRef.current || await closeCheckRef.current() !== false, []);

  useEffect(() => {
    applyAccessibility(readAccessibility());
    return window.electronAPI?.window?.onCloseRequested?.(async () => {
      if (closeCheckRef.current && await closeCheckRef.current() === false) return;
      window.electronAPI.window.confirmClose();
    });
  }, []);

  useEffect(() => {
    applyDocumentTheme(document, theme);
  }, [theme]);

  if (!initialized) return <AppSplash error={initializationError} onRetry={init} />;
  return (
    <Suspense fallback={<AppSplash />}>
      <AuthGate>
        <MandatoryUpdateGate prepareToRestart={prepareToRestart}>
          <Workspace setCloseCheck={setCloseCheck} />
        </MandatoryUpdateGate>
      </AuthGate>
    </Suspense>
  );
}
