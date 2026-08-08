import { useState, useRef, useEffect, useCallback } from 'react';
import CopyButton from '../../components/CopyButton';
import { callIpc } from '../../utils/callIpc';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useI18n } from '../../i18n/I18nContext';
import { appendProgress, appendRendererStream, limitChatMessages } from '../../utils/chatLimits.mjs';
import './OpenAIPanel.css';

function OpenAIAvatar({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>
    </svg>
  );
}

function ProgressLog({ entries }) {
  const bottomRef = useRef(null);
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), [entries]);
  if (!entries.length) return null;
  return (
    <div className="openai-progress-log">
      {entries.map((entry, i) => (
        <span key={i} className={`openai-progress-log__line openai-progress-log__line--${entry.type}`}>
          {entry.text}
        </span>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function NotAuthScreen({ onLogin, isLoggingIn, loginLog }) {
  const { t } = useI18n();
  return (
    <div className="openai-setup-screen">
      <div className="openai-setup-screen__icon">
        <OpenAIAvatar size={48} />
      </div>
      <h2 className="openai-setup-screen__title">{t('ai.openaiConnectTitle')}</h2>
      <p className="openai-setup-screen__desc">
        {t('ai.openaiConnectCopy')}
      </p>

      <div className="openai-setup-screen__steps">
        {t('ai.openaiLoginSteps').map((step, i) => (
          <div key={i} className="openai-setup-screen__step">
            <span className="openai-setup-screen__step-num">{i + 1}</span>
            <span>{step}</span>
          </div>
        ))}
      </div>

      {isLoggingIn ? (
        <div className="openai-setup-screen__installing">
          <div className="openai-spinner" />
          <span>{t('ai.waitingBrowserAuth')}</span>
        </div>
      ) : (
        <button className="btn btn--primary btn--large openai-btn" onClick={onLogin}>
          <OpenAIAvatar size={18} />
          {t('ai.connectWithOpenAI')}
        </button>
      )}

      <ProgressLog entries={loginLog} />
    </div>
  );
}

function ChatScreen({ email, messages, currentResponse, isRunning, input, setInput, onSend, onCancel, onLogout, inputRef, model, setModel, models, reasoning, setReasoning }) {
  const { t } = useI18n();
  const messagesEndRef = useRef(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentResponse]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  return (
    <>
      <div className="openai-panel__messages">
        {messages.length === 0 && !currentResponse && (
          <div className="openai-panel__welcome">
            <div className="openai-panel__welcome-icon"><OpenAIAvatar size={48} /></div>
            <h3 className="openai-panel__welcome-title">{t('ai.openaiWelcome')}</h3>
            <p className="openai-panel__welcome-desc text-secondary">
              {t('ai.connectedAs', { email })}
            </p>
            <div className="openai-panel__model-selector">
              <label>{t('ai.model')}
                <select value={model} onChange={(event) => {
                  const nextModel = models.find((item) => item.id === event.target.value);
                  setModel(event.target.value);
                  setReasoning(nextModel?.defaultReasoning || 'medium');
                }}>
                  {models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>{t('ai.reasoning')}
                <select value={reasoning} onChange={(event) => setReasoning(event.target.value)}>
                  {(models.find((item) => item.id === model)?.reasoningLevels || ['medium']).map((level) => <option key={level} value={level}>{t(`ai.reasoningLabels.${level}`) === `ai.reasoningLabels.${level}` ? level : t(`ai.reasoningLabels.${level}`)}</option>)}
                </select>
              </label>
              <small>{models.find((item) => item.id === model)?.description}</small>
            </div>
            <div className="openai-panel__suggestions">
              {['react', 'review', 'explainError', 'tests'].map(key => (
                <button key={key} className="openai-panel__suggestion btn btn--small" onClick={() => { setInput(t(`ai.suggestions.${key}`)); inputRef.current?.focus(); }}>
                  {t(`ai.suggestions.${key}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`openai-panel__message openai-panel__message--${msg.role}`}>
            {msg.role === 'user' && <div className="openai-panel__message-avatar openai-panel__message-avatar--user">{t('ai.you')}</div>}
            {msg.role === 'assistant' && <div className="openai-panel__message-avatar openai-panel__message-avatar--assistant"><OpenAIAvatar size={14} /></div>}
            {msg.role === 'error' && <div className="openai-panel__message-avatar openai-panel__message-avatar--error">!</div>}
            <div className="openai-panel__message-content">
              <pre className="openai-panel__message-text">{msg.content}</pre>
              {/* La misma accion que en Claude: los dos chats se comportan igual. */}
              {msg.role === 'assistant' && msg.content && <CopyButton value={msg.content} />}
            </div>
          </div>
        ))}

        {currentResponse && (
          <div className="openai-panel__message openai-panel__message--assistant openai-panel__message--streaming">
            <div className="openai-panel__message-avatar openai-panel__message-avatar--assistant"><OpenAIAvatar size={14} /></div>
            <div className="openai-panel__message-content">
              <pre className="openai-panel__message-text">{currentResponse}</pre>
              <div className="openai-panel__cursor" />
            </div>
          </div>
        )}

        {isRunning && !currentResponse && (
          <div className="openai-panel__thinking">
            <div className="openai-panel__thinking-dots"><span /><span /><span /></div>
            <span className="text-tertiary">{t('ai.thinkingChatGPT')}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="openai-panel__input-area">
        <div className="openai-panel__input-wrap">
          <textarea
            ref={inputRef}
            className="openai-panel__input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('ai.askChatGPT')}
            rows={1}
          />
          <div className="openai-panel__input-actions">
            {isRunning ? (
              <button className="btn btn--small btn--danger" onClick={onCancel}>■ {t('ai.stop')}</button>
            ) : (
              <button className="btn btn--small btn--primary openai-btn-send" onClick={onSend} disabled={!input.trim()}>
                {t('ai.send')} ↵
              </button>
            )}
          </div>
        </div>
        <p className="openai-panel__input-hint text-tertiary">{t('ai.inputHint')}</p>
      </div>
    </>
  );
}

export default function OpenAIPanel({ cwd }) {
  const { t } = useI18n();
  // Optimistic auth: assume authenticated if we have a cached status from a
  // previous session (stored as a lightweight flag in the electron store).
  // The real check runs in background and updates silently.
  const [status, setStatus] = useState({ authenticated: false, email: null });
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  // Comprobar el estado puede fallar; eso no es lo mismo que no estar conectado.
  const [statusError, setStatusError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginLog, setLoginLog] = useState([]);
  const [messages, setMessages] = useState([]);
  const [currentResponse, setCurrentResponse] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [input, setInput] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('gpt-5.4');
  const [reasoning, setReasoning] = useState('medium');
  const streamRef = useRef('');
  const activeRunRef = useRef(null);
  const projectPathRef = useRef(cwd);
  const inputRef = useRef(null);
  // Limpiar y cerrar sesion borran historial que no se puede recuperar.
  const [pendingAction, setPendingAction] = useState(null);
  const saveTimerRef = useRef(null);

  // ── Persistence helpers ──────────────────────────────────────────────────
  const storageKey = `chat:openai:${cwd || 'global'}`;

  const saveHistory = useCallback((msgs) => {
    if (!window.electronAPI?.store) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const toSave = limitChatMessages(msgs);
      window.electronAPI.store.set(storageKey, toSave);
    }, 1000);
  }, [storageKey]);

  const clearHistory = useCallback(() => {
    if (!window.electronAPI?.store) return;
    clearTimeout(saveTimerRef.current);
    window.electronAPI.store.delete(storageKey);
  }, [storageKey]);

  // ── Load persisted history on mount / project change ────────────────────
  useEffect(() => {
    if (!window.electronAPI?.store) return;
    let cancelled = false;
    setMessages([]);
    window.electronAPI.store.get(storageKey, []).then((saved) => {
      if (!cancelled && Array.isArray(saved) && saved.length > 0) {
        setMessages(limitChatMessages(saved));
      }
    });
    return () => { cancelled = true; };
  }, [storageKey]);

  useEffect(() => {
    const previous = projectPathRef.current;
    projectPathRef.current = cwd;
    if (previous && previous !== cwd) {
      window.electronAPI?.openai?.cancel(activeRunRef.current, previous);
      activeRunRef.current = null;
      streamRef.current = '';
      setCurrentResponse('');
      setIsRunning(false);
    }
  }, [cwd]);

  // ── Auth: optimistic load then background verify ─────────────────────────
  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI?.openai) return;
    setStatusError('');
    const { ok, data, error } = await callIpc(window.electronAPI.openai.getStatus);
    setIsAuthLoading(false);
    if (!ok || !data) {
      setStatusError(error || 'No se pudo comprobar el estado de la cuenta.');
      return;
    }
    setStatus(data);
    // Persist the auth flag so next launch can show chat immediately
    if (window.electronAPI?.store) {
      window.electronAPI.store.set('openai:authenticated', data.authenticated);
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    // Optimistically show chat if we were authenticated last session
    const runOptimistic = async () => {
      const wasAuthenticated = await window.electronAPI.store?.get('openai:authenticated', false);
      if (wasAuthenticated) {
        setStatus({ authenticated: true, email: 'OpenAI account' });
      }
      // Always verify in background regardless
      refreshStatus();
    };
    runOptimistic();
  }, [refreshStatus]);

  useEffect(() => {
    callIpc(window.electronAPI?.openai?.getModels).then(({ ok, data }) => {
      const availableModels = ok ? data?.models : null;
      if (!availableModels?.length) return;
      setModels(availableModels);
      const selected = availableModels.find((item) => item.id === data.defaultModel) || availableModels[0];
      setModel(selected.id);
      setReasoning(selected.defaultReasoning || 'medium');
    });
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.openai) return;
    const unsubs = [
      window.electronAPI.openai.onStarted(event => {
        if (event?.projectPath === projectPathRef.current) activeRunRef.current = event.runId;
      }),
      window.electronAPI.openai.onData(event => {
        if (event?.projectPath !== projectPathRef.current) return;
        if (activeRunRef.current != null && event.runId !== activeRunRef.current) return;
        activeRunRef.current = event.runId;
        streamRef.current = appendRendererStream(streamRef.current, event.text);
        setCurrentResponse(streamRef.current);
      }),
      window.electronAPI.openai.onComplete(({ runId, projectPath, output } = {}) => {
        if (projectPath !== projectPathRef.current || (activeRunRef.current != null && runId !== activeRunRef.current)) return;
        activeRunRef.current = null;
        setIsRunning(false);
        const finalContent = streamRef.current || output || '';
        if (finalContent) {
          setMessages(prev => {
            const next = limitChatMessages([...prev, { role: 'assistant', content: finalContent, timestamp: Date.now() }]);
            saveHistory(next);
            return next;
          });
        }
        setCurrentResponse('');
        streamRef.current = '';
      }),
      window.electronAPI.openai.onError(({ runId, projectPath, error } = {}) => {
        if (projectPath !== projectPathRef.current || (activeRunRef.current != null && runId !== activeRunRef.current)) return;
        activeRunRef.current = null;
        setIsRunning(false);
        setMessages(prev => limitChatMessages([...prev, { role: 'error', content: error, timestamp: Date.now() }]));
        setCurrentResponse('');
        streamRef.current = '';
      }),
      window.electronAPI.openai.onLoginProgress(({ type, text }) => {
        setLoginLog(prev => appendProgress(prev, { type, text }));
      }),
    ];
    return () => unsubs.forEach(u => u?.());
  }, [saveHistory]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setLoginLog([]);
    const result = await window.electronAPI.openai.login();
    setIsLoggingIn(false);
    if (result.success) {
        setLoginLog(appendProgress([], { type: 'info', text: t('ai.loginSuccess') }));
      await refreshStatus();
    } else {
      setLoginLog(appendProgress([], { type: 'error', text: result.error }));
    }
  };

  const handleLogout = async () => {
    await window.electronAPI.openai.logout();
    setMessages([]);
    clearHistory();
    if (window.electronAPI?.store) {
      window.electronAPI.store.set('openai:authenticated', false);
    }
    await refreshStatus();
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;
    const history = messages.filter(m => m.role !== 'error').map(m => ({ role: m.role, content: m.content }));
    const newMessages = limitChatMessages([...messages, { role: 'user', content: trimmed, timestamp: Date.now() }]);
    setMessages(newMessages);
    saveHistory(newMessages);
    setInput('');
    setIsRunning(true);
    setCurrentResponse('');
    streamRef.current = '';
    const run = await window.electronAPI.openai.sendPrompt(trimmed, history, model, reasoning, cwd);
    if (run?.success && run.projectPath === projectPathRef.current) activeRunRef.current = run.runId;
    else if (!run?.cancelled) setIsRunning(false);
  };

  const handleCancel = () => {
    window.electronAPI.openai.cancel(activeRunRef.current, projectPathRef.current);
    activeRunRef.current = null;
    setIsRunning(false);
    if (streamRef.current) {
      setMessages(prev => {
        const next = limitChatMessages([...prev, { role: 'assistant', content: `${streamRef.current}\n\n*[${t('ai.cancelledResponse')}]*`, timestamp: Date.now() }]);
        saveHistory(next);
        return next;
      });
      setCurrentResponse('');
      streamRef.current = '';
    }
  };

  const handleClear = () => {
    setMessages([]);
    setCurrentResponse('');
    streamRef.current = '';
    clearHistory();
  };

  useEffect(() => () => {
    clearTimeout(saveTimerRef.current);
    window.electronAPI?.openai?.cancel(activeRunRef.current, projectPathRef.current);
  }, []);

  return (
    <div className="openai-panel">
      <div className="openai-panel__header">
        <div className="openai-panel__header-left">
          <div className="openai-panel__avatar"><OpenAIAvatar /></div>
          <div className="openai-panel__header-info">
            <h2 className="openai-panel__title">ChatGPT</h2>
            <span className={`openai-panel__status ${status.authenticated ? 'openai-panel__status--available' : ''}`}>
              <span className={`status-dot ${status.authenticated ? 'status-dot--connected' : 'status-dot--disconnected'}`} />
              {status.authenticated ? `${t('ai.connected')} · ${status.email}` : t('ai.notConnected')}
            </span>
          </div>
        </div>
        <div className="openai-panel__header-actions">
          {status.authenticated && messages.length > 0 && (
            <button className="btn btn--small" onClick={() => setPendingAction('clear')}>{t('ai.clear')}</button>
          )}
          {status.authenticated && (
            <button className="btn btn--small btn--ghost" onClick={() => setPendingAction('logout')} title={t('ai.logout')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          )}
          <button className="btn btn--small btn--ghost" onClick={refreshStatus} title={t('ai.refresh')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
        </div>
      </div>

      <div className="openai-panel__body">
        {statusError && !status.authenticated ? (
          <div className="openai-setup-screen" role="alert">
            <h3>{t('ai.statusFailed')}</h3>
            <p className="text-secondary">{t('ai.statusFailedCopy')}</p>
            <pre className="openai-setup-screen__error">{statusError}</pre>
            <button className="btn btn--primary" onClick={refreshStatus} type="button">{t('ai.retry')}</button>
          </div>
        ) : !status.authenticated ? (
          <NotAuthScreen onLogin={handleLogin} isLoggingIn={isLoggingIn} loginLog={loginLog} />
        ) : (
          <ChatScreen
            email={status.email}
            messages={messages}
            currentResponse={currentResponse}
            isRunning={isRunning}
            input={input}
            setInput={setInput}
            onSend={handleSend}
            onCancel={handleCancel}
            onLogout={() => setPendingAction('logout')}
            inputRef={inputRef}
            model={model}
            setModel={setModel}
            models={models}
            reasoning={reasoning}
            setReasoning={setReasoning}
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
          if (action === 'logout') handleLogout(); else handleClear();
        }}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
