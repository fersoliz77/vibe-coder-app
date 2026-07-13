import { useState, useRef, useEffect, useCallback } from 'react';
import './OpenAIPanel.css';

const REASONING_LABELS = {
  low: 'Low · rápido',
  medium: 'Medium · equilibrado',
  high: 'High · profundo',
  xhigh: 'XHigh · muy profundo',
  max: 'Max · máximo',
  ultra: 'Ultra · delegación automática',
};

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
  return (
    <div className="openai-setup-screen">
      <div className="openai-setup-screen__icon">
        <OpenAIAvatar size={48} />
      </div>
      <h2 className="openai-setup-screen__title">Conectá tu cuenta de OpenAI</h2>
      <p className="openai-setup-screen__desc">
        Iniciá sesión mediante el flujo oficial de OpenAI. Codex administra la sesión localmente; Vibe IDE Code no almacena tokens ni incluye créditos de IA.
      </p>

      <div className="openai-setup-screen__steps">
        {['Abrí la autenticación oficial de OpenAI', 'Iniciá sesión con tu cuenta', 'Autorizá Codex', 'Volvé a Vibe IDE Code'].map((step, i) => (
          <div key={i} className="openai-setup-screen__step">
            <span className="openai-setup-screen__step-num">{i + 1}</span>
            <span>{step}</span>
          </div>
        ))}
      </div>

      {isLoggingIn ? (
        <div className="openai-setup-screen__installing">
          <div className="openai-spinner" />
          <span>Esperando autenticación en el navegador…</span>
        </div>
      ) : (
        <button className="btn btn--primary btn--large openai-btn" onClick={onLogin}>
          <OpenAIAvatar size={18} />
          Conectar con OpenAI
        </button>
      )}

      <ProgressLog entries={loginLog} />
    </div>
  );
}

function ChatScreen({ email, messages, currentResponse, isRunning, input, setInput, onSend, onCancel, onLogout, inputRef, model, setModel, models, reasoning, setReasoning }) {
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
            <h3 className="openai-panel__welcome-title">ChatGPT Assistant</h3>
            <p className="openai-panel__welcome-desc text-secondary">
              Conectado como <strong>{email}</strong>. ¡Preguntá lo que quieras!
            </p>
            <div className="openai-panel__model-selector">
              <label>Modelo
                <select value={model} onChange={(event) => {
                  const nextModel = models.find((item) => item.id === event.target.value);
                  setModel(event.target.value);
                  setReasoning(nextModel?.defaultReasoning || 'medium');
                }}>
                  {models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>Razonamiento
                <select value={reasoning} onChange={(event) => setReasoning(event.target.value)}>
                  {(models.find((item) => item.id === model)?.reasoningLevels || ['medium']).map((level) => <option key={level} value={level}>{REASONING_LABELS[level] || level}</option>)}
                </select>
              </label>
              <small>{models.find((item) => item.id === model)?.description}</small>
            </div>
            <div className="openai-panel__suggestions">
              {['Creá un componente React', 'Revisá este código', 'Explicá este error', 'Escribí tests'].map(s => (
                <button key={s} className="openai-panel__suggestion btn btn--small" onClick={() => { setInput(s); inputRef.current?.focus(); }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`openai-panel__message openai-panel__message--${msg.role}`}>
            {msg.role === 'user' && <div className="openai-panel__message-avatar openai-panel__message-avatar--user">Tú</div>}
            {msg.role === 'assistant' && <div className="openai-panel__message-avatar openai-panel__message-avatar--assistant"><OpenAIAvatar size={14} /></div>}
            {msg.role === 'error' && <div className="openai-panel__message-avatar openai-panel__message-avatar--error">!</div>}
            <div className="openai-panel__message-content">
              <pre className="openai-panel__message-text">{msg.content}</pre>
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
            <span className="text-tertiary">ChatGPT está pensando…</span>
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
            placeholder="Preguntale algo a ChatGPT…"
            rows={1}
          />
          <div className="openai-panel__input-actions">
            {isRunning ? (
              <button className="btn btn--small btn--danger" onClick={onCancel}>■ Stop</button>
            ) : (
              <button className="btn btn--small btn--primary openai-btn-send" onClick={onSend} disabled={!input.trim()}>
                Enviar ↵
              </button>
            )}
          </div>
        </div>
        <p className="openai-panel__input-hint text-tertiary">Enter para enviar · Shift+Enter para nueva línea</p>
      </div>
    </>
  );
}

export default function OpenAIPanel({ cwd }) {
  const [status, setStatus] = useState({ authenticated: false, email: null });
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
  const inputRef = useRef(null);

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI?.openai) return;
    const s = await window.electronAPI.openai.getStatus();
    setStatus(s);
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    window.electronAPI?.openai?.getModels().then(({ models: availableModels, defaultModel }) => {
      if (!availableModels?.length) return;
      setModels(availableModels);
      const selected = availableModels.find((item) => item.id === defaultModel) || availableModels[0];
      setModel(selected.id);
      setReasoning(selected.defaultReasoning || 'medium');
    });
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.openai) return;
    const unsubs = [
      window.electronAPI.openai.onData(data => {
        streamRef.current += data;
        setCurrentResponse(streamRef.current);
      }),
      window.electronAPI.openai.onComplete(({ output } = {}) => {
        setIsRunning(false);
        const finalContent = streamRef.current || output || '';
        if (finalContent) {
          setMessages(prev => [...prev, { role: 'assistant', content: finalContent, timestamp: Date.now() }]);
        }
        setCurrentResponse('');
        streamRef.current = '';
      }),
      window.electronAPI.openai.onError(error => {
        setIsRunning(false);
        setMessages(prev => [...prev, { role: 'error', content: error, timestamp: Date.now() }]);
        setCurrentResponse('');
        streamRef.current = '';
      }),
      window.electronAPI.openai.onLoginProgress(({ type, text }) => {
        setLoginLog(prev => [...prev, { type, text }]);
      }),
    ];
    return () => unsubs.forEach(u => u?.());
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setLoginLog([]);
    const result = await window.electronAPI.openai.login();
    setIsLoggingIn(false);
    if (result.success) {
      setLoginLog([{ type: 'info', text: 'Cuenta OpenAI conectada correctamente.' }]);
      await refreshStatus();
    } else {
      setLoginLog([{ type: 'error', text: result.error }]);
    }
  };

  const handleLogout = async () => {
    await window.electronAPI.openai.logout();
    setMessages([]);
    await refreshStatus();
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;
    const history = messages.filter(m => m.role !== 'error').map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: 'user', content: trimmed, timestamp: Date.now() }]);
    setInput('');
    setIsRunning(true);
    setCurrentResponse('');
    streamRef.current = '';
    await window.electronAPI.openai.sendPrompt(trimmed, history, model, reasoning, cwd);
  };

  const handleCancel = () => {
    window.electronAPI.openai.cancel();
    setIsRunning(false);
    if (streamRef.current) {
      setMessages(prev => [...prev, { role: 'assistant', content: streamRef.current + '\n\n*[Cancelado]*', timestamp: Date.now() }]);
      setCurrentResponse('');
      streamRef.current = '';
    }
  };

  return (
    <div className="openai-panel">
      <div className="openai-panel__header">
        <div className="openai-panel__header-left">
          <div className="openai-panel__avatar"><OpenAIAvatar /></div>
          <div className="openai-panel__header-info">
            <h2 className="openai-panel__title">ChatGPT</h2>
            <span className={`openai-panel__status ${status.authenticated ? 'openai-panel__status--available' : ''}`}>
              <span className={`status-dot ${status.authenticated ? 'status-dot--connected' : 'status-dot--disconnected'}`} />
              {status.authenticated ? `Conectado · ${status.email}` : 'No conectado'}
            </span>
          </div>
        </div>
        <div className="openai-panel__header-actions">
          {status.authenticated && messages.length > 0 && (
            <button className="btn btn--small" onClick={() => { setMessages([]); setCurrentResponse(''); streamRef.current = ''; }}>Limpiar</button>
          )}
          {status.authenticated && (
            <button className="btn btn--small btn--ghost" onClick={handleLogout} title="Cerrar sesión">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          )}
          <button className="btn btn--small btn--ghost" onClick={refreshStatus} title="Actualizar estado">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
        </div>
      </div>

      <div className="openai-panel__body">
        {!status.authenticated ? (
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
            onLogout={handleLogout}
            inputRef={inputRef}
            model={model}
            setModel={setModel}
            models={models}
            reasoning={reasoning}
            setReasoning={setReasoning}
          />
        )}
      </div>
    </div>
  );
}
