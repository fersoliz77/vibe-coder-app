import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import OpenCodeIcon from '../../components/icons/OpenCodeIcon';
import './OpenCodePanel.css';

export default function OpenCodePanel({ activeView, project, terminalHook }) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const xtermInstanceRef = useRef(null);
  const fitAddonRef = useRef(null);
  const resizeObserverRef = useRef(null);

  const {
    openCodeTerminal,
    registerXterm,
    writeToTerminal,
    resizeTerminal,
    openCodeError,
    openCodeStarting,
    createOpenCodeTerminal,
    clearOpenCodeError,
  } = terminalHook;
  const terminalId = openCodeTerminal?.id;

  const retry = () => {
    clearOpenCodeError?.();
    createOpenCodeTerminal?.();
  };

  // Initialize xterm when openCodeTerminal is available
  useEffect(() => {
    if (!terminalId || !containerRef.current) return;
    if (xtermInstanceRef.current) return; // already initialized

    const initTerminal = async () => {
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
          theme: {
            background: '#0d1117',
            foreground: '#e6edf3',
            cursor: '#58a6ff',
            selectionBackground: 'rgba(56, 139, 253, 0.3)',
            black: '#0d1117',
            red: '#ff7b72',
            green: '#3fb950',
            yellow: '#d29922',
            blue: '#58a6ff',
            magenta: '#bc8cff',
            cyan: '#39d353',
            white: '#e6edf3',
            brightBlack: '#484f58',
            brightRed: '#ffa198',
            brightGreen: '#56d364',
            brightYellow: '#e3b341',
            brightBlue: '#79c0ff',
            brightMagenta: '#d2a8ff',
            brightCyan: '#56d364',
            brightWhite: '#f0f6fc',
          },
        });

        xterm.loadAddon(fitAddon);
        xterm.loadAddon(webLinksAddon);
        xterm.open(containerRef.current);

        await import('@xterm/xterm/css/xterm.css');

        xterm.onData((data) => {
          writeToTerminal(terminalId, data);
        });

        xtermInstanceRef.current = xterm;
        fitAddonRef.current = fitAddon;
        registerXterm(terminalId, xterm);

        // Fit after initial load
        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
            resizeTerminal(terminalId, xterm.cols, xterm.rows);
          } catch {}
        });

        const resizeObserver = new ResizeObserver(() => {
          try {
            fitAddon.fit();
            resizeTerminal(terminalId, xterm.cols, xterm.rows);
          } catch {}
        });
        resizeObserver.observe(containerRef.current);
        resizeObserverRef.current = resizeObserver;

      } catch (error) {
        console.error('Failed to initialize OpenCode terminal:', error);
      }
    };

    initTerminal();
  }, [terminalId, registerXterm, writeToTerminal, resizeTerminal]);

  // Handle panel visibility transitions (fit terminal when it is shown)
  useEffect(() => {
    if (activeView === 'opencode' && fitAddonRef.current && xtermInstanceRef.current && terminalId) {
      // Small timeout to let display: block take effect in layout
      setTimeout(() => {
        try {
          fitAddonRef.current.fit();
          const xterm = xtermInstanceRef.current;
          resizeTerminal(terminalId, xterm.cols, xterm.rows);
        } catch {}
      }, 50);
    }
  }, [activeView, terminalId, resizeTerminal]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (xtermInstanceRef.current) {
        xtermInstanceRef.current.dispose();
      }
    };
  }, []);

  return (
    <div className="opencode-panel">
      <div className="opencode-panel__header">
        <div className="opencode-panel__title">
          <OpenCodeIcon size={16} />
          <span>{t('opencode.terminal')}</span>
          <span className="opencode-panel__badge">{t('opencode.preloaded')}</span>
        </div>
      </div>
      <div className="opencode-panel__content">
        {/* El spinner solo cubre el arranque real. Si la creacion falla se dice
            por que y se ofrece reintentar: antes la vista se activaba igual y
            este panel giraba para siempre porque nadie miraba el error. */}
        {terminalId && <div className="opencode-panel__terminal-container" ref={containerRef} />}
        {!terminalId && openCodeError && (
          <div className="opencode-panel__failure" role="alert">
            <strong>{t('opencode.failedTitle')}</strong>
            <p className="opencode-panel__failure-detail">{openCodeError}</p>
            <button className="btn btn--primary" type="button" onClick={retry}>{t('opencode.retry')}</button>
          </div>
        )}
        {!terminalId && !openCodeError && openCodeStarting && (
          <div className="opencode-panel__loading" role="status">
            <div className="opencode-panel__spinner" />
            <span>{t('opencode.starting')}</span>
          </div>
        )}
        {!terminalId && !openCodeError && !openCodeStarting && (
          <div className="opencode-panel__failure">
            <p className="opencode-panel__failure-detail">{t('opencode.idle')}</p>
            <button className="btn btn--primary" type="button" onClick={retry}>{t('opencode.start')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
