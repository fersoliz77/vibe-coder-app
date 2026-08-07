import { useState, useRef, useEffect } from 'react';
import ClaudeIcon from '../../components/icons/ClaudeIcon';
import { useI18n } from '../../i18n/I18nContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import CopyButton from '../../components/CopyButton';
import './ClaudePanel.css';

// ─── Sub-components ─────────────────────────────────────────────────────────

function ProgressLog({ entries }) {
  const bottomRef = useRef(null);
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [entries]);
  if (!entries.length) return null;
  return (
    <div className="claude-progress-log">
      {entries.map((entry, i) => (
        <span key={i} className={`claude-progress-log__line claude-progress-log__line--${entry.type}`}>
          {entry.text}
        </span>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Screens ─────────────────────────────────────────────────────────────────

function StatusFailedScreen({ error, onRetry }) {
  const { t } = useI18n();
  return (
    <div className="claude-setup-screen" role="alert">
      <div className="claude-setup-screen__icon claude-setup-screen__icon--error"><ClaudeIcon size={28} /></div>
      <h3>{t('ai.statusFailed')}</h3>
      <p className="text-secondary">{t('ai.statusFailedCopy')}</p>
      {error && <pre className="claude-setup-screen__error">{error}</pre>}
      <button className="btn btn--primary" onClick={onRetry} type="button">{t('ai.retry')}</button>
    </div>
  );
}

function NotInstalledScreen({ onInstall, isInstalling, installLog }) {
  const { t } = useI18n();
  return (
    <div className="claude-setup-screen">
      <div className="claude-setup-screen__icon">
        <ClaudeIcon size={48} />
      </div>
      <h2 className="claude-setup-screen__title">{t('ai.notInstalled')}</h2>
      <p className="claude-setup-screen__desc">
        {t('ai.claudeInstallCopy')}
      </p>

      <div className="claude-setup-screen__info-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <span>{t('ai.claudeNpmCopy')}</span>
      </div>

      {isInstalling ? (
        <div className="claude-setup-screen__installing">
          <div className="claude-spinner" />
          <span>{t('ai.installingClaude')}</span>
        </div>
      ) : (
        <button className="btn btn--primary btn--large" onClick={onInstall}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {t('ai.installClaude')}
        </button>
      )}

      <ProgressLog entries={installLog} />
    </div>
  );
}

function NotAuthenticatedScreen({ onLogin, isLoggingIn, loginLog, version }) {
  const { t } = useI18n();
  return (
    <div className="claude-setup-screen">
      <div className="claude-setup-screen__icon claude-setup-screen__icon--auth">
        <ClaudeIcon size={48} />
        <div className="claude-setup-screen__icon-badge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
      </div>

      <h2 className="claude-setup-screen__title">{t('ai.connectAnthropic')}</h2>
      <p className="claude-setup-screen__desc">
        {t('ai.claudeInstalledCopy', { version: version ? ` (v${version})` : '' })}
      </p>

      <div className="claude-setup-screen__steps">
        {t('ai.claudeLoginSteps').map((step, index) => <div className="claude-setup-screen__step" key={step}><span className="claude-setup-screen__step-num">{index + 1}</span><span>{step}</span></div>)}
      </div>

      {isLoggingIn ? (
        <div className="claude-setup-screen__installing">
          <div className="claude-spinner" />
          <span>{t('ai.waitingBrowserAuth')}</span>
        </div>
      ) : (
        <button className="btn btn--primary btn--large" onClick={onLogin}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
          {t('ai.connectWithAnthropic')}
        </button>
      )}

      <ProgressLog entries={loginLog} />
    </div>
  );
}

const CLAUDE_MODELS = [
  { id: 'claude-fable-5', label: 'Claude Fable 5 (Most Capable)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
];

function ChatScreen({ status, messages, currentResponse, isRunning, input, setInput, onSend, onCancel, onLogout, inputRef, model, setModel }) {
  const { t } = useI18n();
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentResponse]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <>
      {/* Messages */}
      <div className="claude-panel__messages">
        {messages.length === 0 && !currentResponse && (
          <div className="claude-panel__welcome">
            <div className="claude-panel__welcome-icon">
              <ClaudeIcon size={48} />
            </div>
            <h3 className="claude-panel__welcome-title">{t('ai.claudeWelcome')}</h3>
            <p className="claude-panel__welcome-desc text-secondary">
              {t('ai.claudeWelcomeCopy')}
            </p>
            
            <div className="claude-panel__model-selector" style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{t('ai.model')}:</label>
              <select 
                value={model} 
                onChange={(e) => setModel(e.target.value)}
                style={{
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--text-primary)',
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '13px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {CLAUDE_MODELS.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="claude-panel__suggestions" style={{ marginTop: '24px' }}>
              {['react', 'debug', 'explainCode', 'tests'].map((key) => (
                <button key={key} className="claude-panel__suggestion btn btn--small" onClick={() => { setInput(t(`ai.suggestions.${key}`)); inputRef.current?.focus(); }}>
                  {t(`ai.suggestions.${key}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`claude-panel__message claude-panel__message--${msg.role}`}>
            {msg.role === 'user' && <div className="claude-panel__message-avatar claude-panel__message-avatar--user">{t('ai.you')}</div>}
            {msg.role === 'assistant' && <div className="claude-panel__message-avatar claude-panel__message-avatar--assistant"><ClaudeIcon size={14} /></div>}
            {msg.role === 'error' && <div className="claude-panel__message-avatar claude-panel__message-avatar--error">!</div>}
            <div className="claude-panel__message-content">
              <pre className="claude-panel__message-text">{msg.content}</pre>
              {/* Llevarse una respuesta al editor exigia seleccionarla a mano
                  dentro de un <pre> con scroll. */}
              {msg.role === 'assistant' && msg.content && <CopyButton value={msg.content} />}
            </div>
          </div>
        ))}

        {currentResponse && (
          <div className="claude-panel__message claude-panel__message--assistant claude-panel__message--streaming">
            <div className="claude-panel__message-avatar claude-panel__message-avatar--assistant"><ClaudeIcon size={14} /></div>
            <div className="claude-panel__message-content">
              <pre className="claude-panel__message-text">{currentResponse}</pre>
              <div className="claude-panel__cursor" />
            </div>
          </div>
        )}

        {isRunning && !currentResponse && (
          <div className="claude-panel__thinking">
            <div className="claude-panel__thinking-dots"><span /><span /><span /></div>
            <span className="text-tertiary">{t('ai.thinkingClaude')}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="claude-panel__input-area">
        <div className="claude-panel__input-wrap">
          <textarea
            ref={inputRef}
            className="claude-panel__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('ai.askClaude')}
            rows={1}
          />
          <div className="claude-panel__input-actions">
            {isRunning ? (
              <button className="btn btn--small btn--danger" onClick={onCancel}>■ {t('ai.stop')}</button>
            ) : (
              <button className="btn btn--small btn--primary" onClick={onSend} disabled={!input.trim()}>
                {t('ai.send')} ↵
              </button>
            )}
          </div>
        </div>
        <p className="claude-panel__input-hint text-tertiary">{t('ai.inputHint')}</p>
      </div>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClaudePanel({
  status,
  isAvailable,
  isRunning,
  isInstalling,
  isLoggingIn,
  installLog,
  loginLog,
  messages,
  currentResponse,
  sendPrompt,
  cancel,
  clear,
  install,
  login,
  logout,
  refreshStatus,
}) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const inputRef = useRef(null);
  // Limpiar y cerrar sesion borran historial que no se puede recuperar.
  const [pendingAction, setPendingAction] = useState(null);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;
    sendPrompt(trimmed, null, model);
    setInput('');
  };

  return (
    <div className="claude-panel">
      {/* Header — always shown */}
      <div className="claude-panel__header">
        <div className="claude-panel__header-left">
          <div className="claude-panel__avatar"><ClaudeIcon size={20} /></div>
          <div className="claude-panel__header-info">
            <h2 className="claude-panel__title">Claude Code</h2>
            <span className={`claude-panel__status ${isAvailable ? 'claude-panel__status--available' : status.loading ? 'claude-panel__status--loading' : ''}`}>
              <span className={`status-dot ${isAvailable ? 'status-dot--connected' : status.loading ? 'status-dot--checking' : 'status-dot--disconnected'}`} />
              {status.loading ? t('ai.checking') : isAvailable ? `${t('ai.connected')}${status.version ? ` · v${status.version}` : ''}` : !status.installed ? t('ai.notInstalled') : t('ai.notAuthenticated')}
            </span>
          </div>
        </div>
        <div className="claude-panel__header-actions">
          {isAvailable && messages.length > 0 && (
            <button className="btn btn--small" onClick={() => setPendingAction('clear')}>{t('ai.clear')}</button>
          )}
          {isAvailable && (
            <button className="btn btn--small btn--ghost" onClick={() => setPendingAction('logout')} title={t('ai.logout')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          )}
          {!status.loading && (
            <button className="btn btn--small btn--ghost" onClick={refreshStatus} title={t('ai.refresh')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="claude-panel__body">
        {status.loading ? (
          <div className="claude-panel__loading">
            <div className="claude-spinner" />
            <span className="text-tertiary">{t('ai.checking')}</span>
          </div>
        ) : status.error ? (
          <StatusFailedScreen error={status.error} onRetry={refreshStatus} />
        ) : !status.installed ? (
          <NotInstalledScreen onInstall={install} isInstalling={isInstalling} installLog={installLog} />
        ) : !status.authenticated ? (
          <NotAuthenticatedScreen onLogin={login} isLoggingIn={isLoggingIn} loginLog={loginLog} version={status.version} />
        ) : (
          <ChatScreen
            status={status}
            messages={messages}
            currentResponse={currentResponse}
            isRunning={isRunning}
            input={input}
            setInput={setInput}
            onSend={handleSend}
            onCancel={cancel}
            onLogout={() => setPendingAction('logout')}
            inputRef={inputRef}
            model={model}
            setModel={setModel}
          />
        )}
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction === 'logout' ? t('ai.logoutTitle') : t('ai.clearTitle')}
        description={pendingAction === 'logout' ? t('ai.logoutCopy') : t('ai.clearCopy')}
        confirmLabel={pendingAction === 'logout' ? t('ai.logoutConfirm') : t('ai.clearConfirm')}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action === 'logout') logout(); else clear();
        }}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
