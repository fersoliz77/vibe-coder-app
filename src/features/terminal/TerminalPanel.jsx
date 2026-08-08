import { useEffect, useRef, useCallback } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { tabAction, nextTabIndex } from '../../utils/tablist';
import { xtermTheme } from './xtermTheme';
import './TerminalPanel.css';

export default function TerminalPanel({
  terminals,
  activeTerminalId,
  setActiveTerminalId,
  createTerminal,
  closeTerminal,
  writeToTerminal,
  resizeTerminal,
  registerXterm,
  lastError,
  clearLastError,
  isDark = true,
}) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const xtermInstancesRef = useRef(new Map());
  const fitAddonsRef = useRef(new Map());
  const resizeObserversRef = useRef(new Map());

  // Create a terminal on first render if none exist
  useEffect(() => {
    if (terminals.length === 0 && !lastError) {
      createTerminal();
    }
  }, [createTerminal, terminals.length, lastError]);

  // Initialize xterm for active terminal
  useEffect(() => {
    if (!activeTerminalId || !containerRef.current) return;
    if (xtermInstancesRef.current.has(activeTerminalId)) return;

    // The DOM element may not be painted yet when the effect fires (React batches
    // state updates). We try immediately; if the element isn't there yet, we retry
    // on the next animation frame.
    const tryInit = () => {
      const containerId = `terminal-container-${activeTerminalId}`;
      const el = document.getElementById(containerId);
      if (!el) {
        requestAnimationFrame(() => {
          const el2 = document.getElementById(containerId);
          if (el2 && !xtermInstancesRef.current.has(activeTerminalId)) initTerminal(el2);
        });
        return;
      }
      initTerminal(el);
    };

    // Dynamically import xterm (works with Vite)
    const initTerminal = async (el) => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { WebLinksAddon } = await import('@xterm/addon-web-links');

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        const xterm = new Terminal({
          fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
          fontSize: 13,
          lineHeight: 1.4,
          cursorBlink: true,
          cursorStyle: 'bar',
          theme: xtermTheme(isDark),
        });

        xterm.loadAddon(fitAddon);
        xterm.loadAddon(webLinksAddon);
        xterm.open(el);

        // Import CSS
        await import('@xterm/xterm/css/xterm.css');

        // Fit after paint: rAF ensures the element is visible before measuring,
        // and the two timeouts handle slow transitions / first-open rendering.
        requestAnimationFrame(() => {
          try { fitAddon.fit(); } catch {}
          setTimeout(() => {
            try {
              fitAddon.fit();
              resizeTerminal(activeTerminalId, xterm.cols, xterm.rows);
            } catch {}
          }, 100);
          setTimeout(() => {
            try {
              fitAddon.fit();
              resizeTerminal(activeTerminalId, xterm.cols, xterm.rows);
            } catch {}
          }, 400);
        });

        // Forward input to PTY
        xterm.onData((data) => {
          writeToTerminal(activeTerminalId, data);
        });

        xtermInstancesRef.current.set(activeTerminalId, xterm);
        fitAddonsRef.current.set(activeTerminalId, fitAddon);
        registerXterm(activeTerminalId, xterm);

        // Handle resize
        const resizeObserver = new ResizeObserver(() => {
          try {
            fitAddon.fit();
            resizeTerminal(activeTerminalId, xterm.cols, xterm.rows);
          } catch {}
        });
        resizeObserver.observe(el);
        resizeObserversRef.current.set(activeTerminalId, resizeObserver);
      } catch (error) {
        console.error('Failed to initialize terminal:', error);
        // Fallback UI for browser mode
        el.replaceChildren();
        const fallback = document.createElement('div');
        fallback.className = 'terminal-panel__fallback';
        fallback.append('Terminal requires Electron runtime.', document.createElement('br'), 'Run with: ');
        const command = document.createElement('span');
        command.textContent = 'npm run dev:electron';
        fallback.append(command);
        el.append(fallback);
      }
    };

    tryInit();
  }, [activeTerminalId, terminals]);

  // Cambiar el tema no puede exigir cerrar y reabrir la terminal: xterm pinta
  // sobre canvas, asi que hay que repintarle la paleta a las que ya existen.
  useEffect(() => {
    const theme = xtermTheme(isDark);
    xtermInstancesRef.current.forEach((xterm) => {
      try { xterm.options.theme = theme; } catch { /* instancia ya descartada */ }
    });
  }, [isDark]);

  useEffect(() => {
    return () => {
      resizeObserversRef.current.forEach((observer) => observer.disconnect());
      xtermInstancesRef.current.forEach((xterm) => xterm.dispose());
      resizeObserversRef.current.clear();
      xtermInstancesRef.current.clear();
      fitAddonsRef.current.clear();
    };
  }, []);

  const handleNewTerminal = useCallback(() => {
    createTerminal();
  }, [createTerminal]);

  const handleCloseTab = useCallback((e, id) => {
    e.stopPropagation();
    const xterm = xtermInstancesRef.current.get(id);
    if (xterm) {
      xterm.dispose();
      xtermInstancesRef.current.delete(id);
      fitAddonsRef.current.delete(id);
    }
    const observer = resizeObserversRef.current.get(id);
    if (observer) {
      observer.disconnect();
      resizeObserversRef.current.delete(id);
    }
    closeTerminal(id);
  }, [closeTerminal]);

  const handleTabKeyDown = useCallback((event, id) => {
    const action = tabAction(event);
    if (!action) return;

    if (action === 'activate') {
      event.preventDefault();
      setActiveTerminalId(id);
      return;
    }
    if (action === 'close') {
      event.preventDefault();
      handleCloseTab(event, id);
      return;
    }

    const current = terminals.findIndex((term) => term.id === id);
    const target = nextTabIndex(action, current, terminals.length);
    if (target === null || target === current) return;
    event.preventDefault();
    // Al moverse el foco, la pestana enfocada pasa a ser la activa.
    setActiveTerminalId(terminals[target].id);
    event.currentTarget.parentElement
      ?.querySelectorAll('[role="tab"]')?.[target]
      ?.focus();
  }, [setActiveTerminalId, terminals, handleCloseTab]);

  return (
    <div className="terminal-panel">
      {/* Tab Bar */}
      <div className="terminal-panel__tabs">
        <div className="terminal-panel__tabs-list" role="tablist" aria-label={t('terminal.tabsLabel')}>
          {terminals.map((term) => (
            <div
              key={term.id}
              className={`terminal-panel__tab ${term.id === activeTerminalId ? 'terminal-panel__tab--active' : ''}`}
              onClick={() => setActiveTerminalId(term.id)}
              onKeyDown={(event) => handleTabKeyDown(event, term.id)}
              role="tab"
              id={`terminal-tab-${term.id}`}
              aria-selected={term.id === activeTerminalId}
              aria-controls={`terminal-container-${term.id}`}
              tabIndex={term.id === activeTerminalId ? 0 : -1}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span>{term.name}</span>
              {term.error && <span className="terminal-panel__tab-badge" title={term.error}>{t('terminal.failedTab')}</span>}
              <button
                className="terminal-panel__tab-close"
                onClick={(e) => handleCloseTab(e, term.id)}
                title={t('terminal.close')}
                type="button"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button className="terminal-panel__new-tab" onClick={handleNewTerminal} title={t('terminal.new')} type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Abrir una terminal nueva podia fallar sin que se viera nada: el error
          solo se mostraba cuando no habia ninguna abierta. */}
      {terminals.length > 0 && lastError && (
        <div className="terminal-panel__banner" role="alert">
          <span><strong>{t('terminal.failedTitle')}</strong> {lastError}</span>
          <div className="terminal-panel__banner-actions">
            <button className="btn btn--small" type="button" onClick={() => { clearLastError?.(); createTerminal(); }}>{t('terminal.retry')}</button>
            <button className="btn btn--small btn--ghost" type="button" onClick={() => clearLastError?.()}>{t('terminal.dismiss')}</button>
          </div>
        </div>
      )}

      {/* Terminal Container */}
      <div className="terminal-panel__content" ref={containerRef}>
        {terminals.map((term) => (
          term.error ? (
            // El shell no arranco: la pestana existe pero no hay PTY detras.
            // Antes se montaba un xterm vacio y parecia una terminal colgada.
            <div
              key={term.id}
              className="terminal-panel__instance terminal-panel__instance--error"
              role="tabpanel"
              aria-labelledby={`terminal-tab-${term.id}`}
              style={{ display: term.id === activeTerminalId ? 'flex' : 'none' }}
            >
              <div className="terminal-panel__empty terminal-panel__empty--error">
                <strong>{t('terminal.sessionFailed')}</strong>
                <p className="terminal-panel__error-detail">{term.error}</p>
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={() => { closeTerminal(term.id); clearLastError?.(); createTerminal(); }}
                >
                  {t('terminal.retry')}
                </button>
              </div>
            </div>
          ) : (
            <div
              key={term.id}
              id={`terminal-container-${term.id}`}
              className="terminal-panel__instance"
              role="tabpanel"
              aria-labelledby={`terminal-tab-${term.id}`}
              style={{ display: term.id === activeTerminalId ? 'block' : 'none' }}
            />
          )
        ))}
        {terminals.length === 0 && lastError && (
          <div className="terminal-panel__empty terminal-panel__empty--error" role="alert">
            <strong>{t('terminal.failedTitle')}</strong>
            <p className="terminal-panel__error-detail">{lastError}</p>
            <button
              className="btn btn--primary"
              onClick={() => { clearLastError?.(); createTerminal(); }}
              type="button"
            >
              {t('terminal.retry')}
            </button>
          </div>
        )}
        {terminals.length === 0 && !lastError && (
          <div className="terminal-panel__empty">
            <p className="text-secondary">{t('terminal.none')}</p>
            <button className="btn btn--primary" onClick={handleNewTerminal} type="button">
              {t('terminal.open')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
