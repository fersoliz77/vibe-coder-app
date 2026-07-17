import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import './OnboardingWizard.css';

const TOTAL_STEPS = 4;

const BACKENDS = [
  { value: 'firebase', label: 'Firebase' },
  { value: 'supabase', label: 'Supabase' },
];

// ─── Step 1: Welcome ─────────────────────────────────────────────────────────
function StepWelcome() {
  const { t } = useI18n();
  return (
    <div className="onboarding-wizard__content" key="step-welcome">
      <h1 className="onboarding-wizard__title">{t('onboarding.welcomeTitle')}</h1>
      <p className="onboarding-wizard__subtitle">
        {t('onboarding.welcomeCopy')}
      </p>

      <div className="onboarding-wizard__preferences" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '120px' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '15px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚡</div>
          {t('onboarding.environmentSummary')}
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Environment ──────────────────────────────────────────────────────
function StepEnvironment({ environment, checking, installing, progress, log, onInstall, onCancel, onCheck }) {
  const { t } = useI18n();
  const rawItems = environment?.items || [];
  // Override firebase and supabase to be optional since database selection is done during project creation
  const items = rawItems.map(item => {
    if (item.id === 'firebase' || item.id === 'supabase') {
      return {
        ...item,
        required: false,
        instruction: t('onboarding.optional')
      };
    }
    return item;
  });

  const percentage = progress?.total
    ? Math.round((Math.max(0, progress.current - (progress.type === 'step-start' ? 1 : 0)) / progress.total) * 100)
    : 0;

  return (
    <div className="onboarding-wizard__content" key="step-environment">
      <h2 className="onboarding-wizard__title">{t('onboarding.toolsTitle')}</h2>
      <p className="onboarding-wizard__subtitle">
        {t('onboarding.toolsCopy')}
      </p>

      {installing && (
        <div className="onboarding-wizard__progress">
          <div className="onboarding-wizard__progress-info">
            <span>{progress?.label || t('onboarding.installing')}</span>
            <span>{percentage}%</span>
          </div>
          <div className="onboarding-wizard__progress-track">
            <div className="onboarding-wizard__progress-bar" style={{ width: `${percentage}%` }} />
          </div>
          {log.length > 0 && (
            <div className="onboarding-wizard__log">
              {log.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}
        </div>
      )}

      <div className="onboarding-wizard__env-list">
        {checking && !items.length && (
          <div className="onboarding-wizard__env-item">
            <div className="onboarding-wizard__env-info">
              <span className="onboarding-wizard__env-name">{t('onboarding.checkingEnvironment')}</span>
            </div>
          </div>
        )}
        {items.map((item) => (
          <div key={item.id} className="onboarding-wizard__env-item">
            <div className="onboarding-wizard__env-info">
              <span className="onboarding-wizard__env-name">{item.name}</span>
              <span className="onboarding-wizard__env-status">
                {checking ? t('onboarding.checking') : item.installed ? item.version || t('onboarding.installed') : item.instruction || t('onboarding.notInstalled')}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {item.installed ? (
                <span className="onboarding-wizard__badge onboarding-wizard__badge--installed">
                  {item.required ? t('onboarding.installedRequired') : t('onboarding.installedOptional')}
                </span>
              ) : (
                <span className={`onboarding-wizard__badge onboarding-wizard__badge--${item.required ? 'required' : 'optional'}`}>
                  {item.required ? t('onboarding.required') : t('onboarding.optional')}
                </span>
              )}
              <span className={`onboarding-wizard__status-indicator onboarding-wizard__status-indicator--${item.installed ? 'ready' : 'missing'}`}>
                {item.installed ? '✓' : '—'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        {installing ? (
          <button className="onboarding-wizard__btn onboarding-wizard__btn--danger" onClick={onCancel}>
            {t('onboarding.cancelInstallation')}
          </button>
        ) : (
          <>
            <button
              className="onboarding-wizard__btn onboarding-wizard__btn--secondary"
              disabled={checking}
              onClick={onCheck}
            >
              {checking ? t('onboarding.checking') : t('onboarding.checkAgain')}
            </button>
            <button
              className="onboarding-wizard__btn onboarding-wizard__btn--primary"
              disabled={checking || items.length === 0 || !items.some(i => !i.installed) || !window.electronAPI?.setup?.install || environment?.supported === false}
              onClick={onInstall}
            >
              {items.length > 0 && !items.some(i => !i.installed) ? `${t('onboarding.allInstalled')} ✓` : t('onboarding.installMissing')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Step 3: AI Agents ────────────────────────────────────────────────────────
// This step installs the necessary CLI tools for each AI agent.
// Authentication/login is intentionally left for later inside the app.
function StepAgents({ openCode, claudeStatus, codexReady }) {
  const { t } = useI18n();
  return (
    <div className="onboarding-wizard__content" key="step-agents">
      <h2 className="onboarding-wizard__title">{t('onboarding.agentsTitle')}</h2>
      <p className="onboarding-wizard__subtitle">
        {t('onboarding.agentsCopy')}
      </p>

      {/* OpenCode */}
      <div className="onboarding-wizard__agent-card">
        <div className="onboarding-wizard__agent-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: 16 }}>OpenCode</strong>
              <span className="onboarding-wizard__agent-badge">{t('onboarding.aiTerminal')}</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
              {openCode.loading || openCode.installing
                ? openCode.progress || t('onboarding.verifying')
                : (openCode.status?.usable || openCode.status?.installed)
                  ? t('onboarding.installedWithVersion', { version: openCode.status.version ? ` · v${openCode.status.version}` : '' })
                  : openCode.error
                    ? t('onboarding.installErrorLater')
                    : t('onboarding.pendingInstall')}
            </p>
          </div>
          <div>
            {openCode.loading || openCode.installing ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#38bdf8' }}>
                <span className="onboarding-wizard__spinner" /> {t('onboarding.installing')}
              </span>
            ) : (openCode.status?.usable || openCode.status?.installed) ? (
              <span style={{ fontSize: 14, color: '#10b981', fontWeight: 600 }}>✓ {t('onboarding.ready')}</span>
            ) : (
              <span style={{ fontSize: 13, color: '#f59e0b' }}>⚠ {t('onboarding.retrying')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Claude Code CLI */}
      <div className="onboarding-wizard__agent-card" style={{ borderColor: 'rgba(251, 146, 60, 0.15)', background: 'rgba(251, 146, 60, 0.04)' }}>
        <div className="onboarding-wizard__agent-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: 16 }}>Claude Code</strong>
              <span className="onboarding-wizard__agent-badge" style={{ color: '#fb923c', background: 'rgba(251, 146, 60, 0.12)' }}>CLI</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
              {claudeStatus?.loading
                ? t('onboarding.verifying')
                : claudeStatus?.installing
                  ? t('onboarding.installing')
                  : claudeStatus?.installed
                    ? t('onboarding.cliInstalled')
                    : t('onboarding.installingClaudeCli')}
            </p>
          </div>
          <div>
            {claudeStatus?.loading || claudeStatus?.installing ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#38bdf8' }}>
                <span className="onboarding-wizard__spinner" /> {t('onboarding.installing')}
              </span>
            ) : claudeStatus?.installed ? (
              <span style={{ fontSize: 14, color: '#10b981', fontWeight: 600 }}>✓ {t('onboarding.ready')}</span>
            ) : (
              <span style={{ fontSize: 13, color: '#f59e0b' }}>⚠ {t('onboarding.error')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Codex / ChatGPT — bundled, no install needed */}
      <div className="onboarding-wizard__agent-card" style={{ borderColor: 'rgba(16, 185, 129, 0.15)', background: 'rgba(16, 185, 129, 0.04)' }}>
        <div className="onboarding-wizard__agent-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: 16 }}>ChatGPT (Codex)</strong>
              <span className="onboarding-wizard__agent-badge" style={{ color: '#34d399', background: 'rgba(52, 211, 153, 0.12)' }}>{t('onboarding.included')}</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
              {codexReady
                ? t('onboarding.bundledBinary')
                : t('onboarding.checkingBundledBinary')}
            </p>
          </div>
          <div>
            {codexReady
              ? <span style={{ fontSize: 14, color: '#10b981', fontWeight: 600 }}>✓ {t('onboarding.ready')}</span>
              : <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#38bdf8' }}><span className="onboarding-wizard__spinner" /> {t('onboarding.checkingBundledBinary')}</span>
            }
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
        💡 {t('onboarding.agentsHint')}
      </p>
    </div>
  );
}

// ─── Step 4: Done ─────────────────────────────────────────────────────────────
function StepDone({ environment }) {
  const { t } = useI18n();
  const items = environment?.items || [];
  const readyCount = items.filter((i) => i.installed).length;

  return (
    <div className="onboarding-wizard__content" key="step-done">
      <div className="onboarding-wizard__success-hero">
        <div className="onboarding-wizard__success-icon">✓</div>
        <h2 className="onboarding-wizard__title" style={{ textAlign: 'center' }}>{t('onboarding.doneTitle')}</h2>
        <p className="onboarding-wizard__subtitle" style={{ textAlign: 'center', maxWidth: 440 }}>
          {t('onboarding.doneCopy')}
        </p>
        {items.length > 0 && (
          <p style={{ fontSize: 14, color: '#94a3b8', textAlign: 'center' }}>
            {t('onboarding.toolsInstalled', { ready: readyCount, total: items.length })}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function OnboardingWizard({ onComplete }) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);

  // Prefs (forced by default to ensure all features are installed)
  const backend = 'firebase';
  const includeMobile = true;

  // Step 2 env
  const checkSequence = useRef(0);
  const [environment, setEnvironment] = useState(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(null);
  const [log, setLog] = useState([]);

  // Step 3 agents
  const [openCode, setOpenCode] = useState({ loading: true, installing: false, status: null, error: '', progress: '' });
  const [claudeStatus, setClaudeStatus] = useState({ loading: true, installing: false, installed: false });
  const [codexReady, setCodexReady] = useState(null); // null = checking, true/false = result

  const options = { includeMobile, backend };

  // ── Env check ────────────────────────────────────────────────────────────
  const doCheck = async () => {
    if (!window.electronAPI?.setup?.check) { setChecking(false); return; }
    const seq = ++checkSequence.current;
    setChecking(true);
    try {
      const result = await window.electronAPI.setup.check(options);
      if (seq !== checkSequence.current) return;
      setEnvironment(result);
    } catch {}
    finally { if (seq === checkSequence.current) setChecking(false); }
  };

  useEffect(() => { if (step === 2) doCheck(); }, [step, includeMobile, backend]);

  useEffect(() => {
    if (!window.electronAPI?.setup?.onProgress) return;
    return window.electronAPI.setup.onProgress((event) => {
      setProgress(event);
      if (event?.message) setLog((prev) => [...prev.slice(-9), event.message]);
    });
  }, []);

  const doInstall = async () => {
    if (!window.electronAPI?.setup?.install) return;
    setInstalling(true);
    setLog([]);
    setProgress(null);
    try {
      const result = await window.electronAPI.setup.install(options);
      if (result?.environment) setEnvironment(result.environment);
      else await doCheck();
    } catch {}
    finally { setInstalling(false); }
  };

  const doCancel = async () => {
    try { await window.electronAPI?.setup?.cancel?.(); } catch {}
  };

  // ── Agents check ─────────────────────────────────────────────────────────
  const checkOpenCode = async () => {
    if (!window.electronAPI?.opencode?.getStatus) { setOpenCode((s) => ({ ...s, loading: false })); return null; }
    setOpenCode((s) => ({ ...s, loading: true, error: '' }));
    try {
      const status = await window.electronAPI.opencode.getStatus();
      setOpenCode({ loading: false, installing: false, status, error: '', progress: '' });
      return status;
    } catch (e) {
      setOpenCode({ loading: false, installing: false, status: null, error: e?.message || t('onboarding.error'), progress: '' });
      return null;
    }
  };

  const installOpenCode = async () => {
    if (!window.electronAPI?.opencode?.install) return;
    setOpenCode((s) => ({ ...s, installing: true, error: '', progress: t('onboarding.verifying') }));
    try {
      const result = await window.electronAPI.opencode.install();
      if (!result?.success && !result?.cancelled) throw new Error(result?.error || t('onboarding.installErrorLater'));
      if (result?.status) setOpenCode({ loading: false, installing: false, status: result.status, error: '', progress: '' });
      else await checkOpenCode();
    } catch (e) {
      setOpenCode((s) => ({ ...s, installing: false, error: e?.message || t('onboarding.error'), progress: '' }));
    }
  };

  useEffect(() => {
    if (!window.electronAPI?.opencode?.onInstallProgress) return;
    return window.electronAPI.opencode.onInstallProgress((event) => {
      setOpenCode((s) => s.installing ? { ...s, progress: event?.message || s.progress } : s);
    });
  }, []);

  // Check/install Claude CLI — only the binary, no auth
  const installClaude = async () => {
    if (!window.electronAPI?.claude?.install) {
      setClaudeStatus({ loading: false, installing: false, installed: false });
      return;
    }
    setClaudeStatus({ loading: false, installing: true, installed: false });
    try {
      const result = await window.electronAPI.claude.install();
      const installed = result?.success === true || result?.status?.installed === true;
      setClaudeStatus({ loading: false, installing: false, installed });
    } catch {
      setClaudeStatus({ loading: false, installing: false, installed: false });
    }
  };

  const checkClaudeInstalled = async () => {
    if (!window.electronAPI?.claude?.getStatus) {
      setClaudeStatus({ loading: false, installing: false, installed: false });
      return false;
    }
    setClaudeStatus((s) => ({ ...s, loading: true }));
    try {
      const result = await window.electronAPI.claude.getStatus();
      const installed = Boolean(result?.installed);
      setClaudeStatus({ loading: false, installing: false, installed });
      return installed;
    } catch {
      setClaudeStatus({ loading: false, installing: false, installed: false });
      return false;
    }
  };

  // Check Codex binary (bundled in app, no download needed)
  const checkCodexReady = async () => {
    if (!window.electronAPI?.openai?.getStatus) { setCodexReady(true); return; }
    try {
      await window.electronAPI.openai.getStatus();
      setCodexReady(true);
    } catch {
      setCodexReady(true); // Codex is bundled, always available
    }
  };

  useEffect(() => {
    if (step === 3) {
      checkCodexReady();
      // Auto-install OpenCode only if it's truly not installed
      checkOpenCode().then((status) => {
        const isReady = status?.usable || status?.installed;
        if (!isReady && window.electronAPI?.opencode?.install) {
          installOpenCode();
        }
      });
      // Auto-install Claude CLI if not installed
      checkClaudeInstalled().then((installed) => {
        if (!installed) installClaude();
      });
    }
  }, [step]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleNext = async () => {
    if (step < TOTAL_STEPS) {
      setStep((s) => s + 1);
    } else {
      // Persist completion flag and hand off to App
      await window.electronAPI?.store?.set('onboardingCompleted', true);
      onComplete();
    }
  };

  const handleBack = () => setStep((s) => Math.max(1, s - 1));

  const canProceedFromStep2 = !installing && !checking;

  const stepLabels = ['welcome', 'tools', 'agents', 'finish'].map((key) => t(`onboarding.steps.${key}`));

  return (
    <div className="onboarding-wizard">
      <div className="onboarding-wizard__container">
        {/* Step indicators */}
        <div className="onboarding-wizard__steps" role="tablist">
          {stepLabels.map((label, i) => {
            const num = i + 1;
            const isActive = num === step;
            const isCompleted = num < step;
            return (
              <div
                key={num}
                className={`onboarding-wizard__step-indicator ${isActive ? 'is-active' : ''} ${isCompleted ? 'is-completed' : ''}`}
                role="tab"
                aria-selected={isActive}
                title={label}
              >
                {isCompleted ? '✓' : num}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        {step === 1 && (
          <StepWelcome />
        )}
        {step === 2 && (
          <StepEnvironment
            environment={environment}
            checking={checking}
            installing={installing}
            progress={progress}
            log={log}
            onInstall={doInstall}
            onCancel={doCancel}
            onCheck={doCheck}
          />
        )}
        {step === 3 && (
          <StepAgents
            openCode={openCode}
            claudeStatus={claudeStatus}
            codexReady={codexReady}
          />
        )}
        {step === 4 && <StepDone environment={environment} />}

        {/* Footer */}
        <div className="onboarding-wizard__footer">
          {step > 1 && step < 4 ? (
            <span className="onboarding-wizard__footer-text">{t('onboarding.skipHint')}</span>
          ) : (
            <span />
          )}
          <div className="onboarding-wizard__buttons">
            {step > 1 && step < 4 && (
              <button
                className="onboarding-wizard__btn onboarding-wizard__btn--secondary"
                onClick={handleBack}
                disabled={installing}
              >
                {t('onboarding.back')}
              </button>
            )}
            {step < 4 ? (
              <button
                className="onboarding-wizard__btn onboarding-wizard__btn--primary"
                onClick={handleNext}
                disabled={step === 2 && !canProceedFromStep2}
              >
                {step === 3 ? t('onboarding.finishSetup') : `${t('onboarding.next')} →`}
              </button>
            ) : (
              <button
                className="onboarding-wizard__btn onboarding-wizard__btn--primary"
                onClick={handleNext}
              >
                {t('onboarding.startCreating')} →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
