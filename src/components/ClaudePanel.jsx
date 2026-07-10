import { useState, useRef, useEffect } from 'react';
import './ClaudePanel.css';

export default function ClaudePanel({
  isAvailable,
  isRunning,
  messages,
  currentResponse,
  sendPrompt,
  cancel,
  clear,
  checkAvailability,
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentResponse]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;
    sendPrompt(trimmed);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="claude-panel">
      {/* Header */}
      <div className="claude-panel__header">
        <div className="claude-panel__header-left">
          <div className="claude-panel__avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
              <path d="M6 10a6 6 0 0 0 12 0" />
              <path d="M12 16v4" />
              <path d="M8 22h8" />
            </svg>
          </div>
          <div className="claude-panel__header-info">
            <h2 className="claude-panel__title">Claude Code</h2>
            <span className={`claude-panel__status ${isAvailable ? 'claude-panel__status--available' : ''}`}>
              <span className={`status-dot ${isAvailable ? 'status-dot--connected' : 'status-dot--disconnected'}`} />
              {isAvailable ? 'Available' : 'CLI not found'}
            </span>
          </div>
        </div>
        <div className="claude-panel__header-actions">
          {messages.length > 0 && (
            <button className="btn btn--small" onClick={clear}>
              Clear
            </button>
          )}
          {!isAvailable && (
            <button className="btn btn--small btn--primary" onClick={checkAvailability}>
              Retry
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="claude-panel__messages">
        {messages.length === 0 && !currentResponse && (
          <div className="claude-panel__welcome">
            <div className="claude-panel__welcome-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
                <path d="M6 10a6 6 0 0 0 12 0" />
                <path d="M12 16v4" />
                <path d="M8 22h8" />
                <circle cx="9" cy="7" r="0.8" fill="currentColor" />
                <circle cx="15" cy="7" r="0.8" fill="currentColor" />
              </svg>
            </div>
            <h3 className="claude-panel__welcome-title">Claude Code Assistant</h3>
            <p className="claude-panel__welcome-desc text-secondary">
              {isAvailable
                ? 'Send a prompt to start coding with AI. Claude will help you write, debug, and refactor code.'
                : 'Claude CLI is not installed. Install it with: npm install -g @anthropic-ai/claude-code'}
            </p>
            {isAvailable && (
              <div className="claude-panel__suggestions">
                {['Create a React component', 'Debug this error', 'Explain this code', 'Write unit tests'].map((suggestion) => (
                  <button
                    key={suggestion}
                    className="claude-panel__suggestion btn btn--small"
                    onClick={() => {
                      setInput(suggestion);
                      inputRef.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`claude-panel__message claude-panel__message--${msg.role}`}>
            {msg.role === 'user' && (
              <div className="claude-panel__message-avatar claude-panel__message-avatar--user">U</div>
            )}
            {msg.role === 'assistant' && (
              <div className="claude-panel__message-avatar claude-panel__message-avatar--assistant">C</div>
            )}
            {msg.role === 'error' && (
              <div className="claude-panel__message-avatar claude-panel__message-avatar--error">!</div>
            )}
            <div className="claude-panel__message-content">
              <pre className="claude-panel__message-text">{msg.content}</pre>
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {currentResponse && (
          <div className="claude-panel__message claude-panel__message--assistant claude-panel__message--streaming">
            <div className="claude-panel__message-avatar claude-panel__message-avatar--assistant">C</div>
            <div className="claude-panel__message-content">
              <pre className="claude-panel__message-text">{currentResponse}</pre>
              <div className="claude-panel__cursor" />
            </div>
          </div>
        )}

        {isRunning && !currentResponse && (
          <div className="claude-panel__thinking">
            <div className="claude-panel__thinking-dots">
              <span /><span /><span />
            </div>
            <span className="text-tertiary">Claude is thinking...</span>
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
            placeholder={isAvailable ? 'Ask Claude anything...' : 'Claude CLI not available'}
            disabled={!isAvailable}
            rows={1}
          />
          <div className="claude-panel__input-actions">
            {isRunning ? (
              <button className="btn btn--small btn--danger" onClick={cancel}>
                ■ Stop
              </button>
            ) : (
              <button
                className="btn btn--small btn--primary"
                onClick={handleSend}
                disabled={!input.trim() || !isAvailable}
              >
                Send ↵
              </button>
            )}
          </div>
        </div>
        <p className="claude-panel__input-hint text-tertiary">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
