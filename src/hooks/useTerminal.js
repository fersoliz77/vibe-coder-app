import { useState, useCallback, useRef, useEffect } from 'react';
import { callIpc } from '../utils/callIpc';

export function useTerminal(projectPath) {
  const [terminals, setTerminals] = useState([]);
  const [activeTerminalId, setActiveTerminalId] = useState(null);
  const xtermRefs = useRef(new Map());

  const [openCodeTerminal, setOpenCodeTerminal] = useState(null);
  // Ultimo fallo al abrir una terminal. Sin esto, el panel mostraba el mismo
  // vacio que cuando todavia no abriste ninguna.
  const [lastError, setLastError] = useState('');

  const createTerminal = useCallback(async (options = {}) => {
    if (!window.electronAPI?.terminal) {
      // Browser fallback
      const id = `mock-${Date.now()}`;
      const newTerm = { id, name: `Terminal ${terminals.length + 1}`, error: 'Electron not available' };
      setTerminals((prev) => [...prev, newTerm]);
      setActiveTerminalId(id);
      return newTerm;
    }

    const { name, ...terminalOptions } = options;
    const mergedOptions = { cwd: projectPath, ...terminalOptions };
    setLastError('');
    const { ok, data: result, error } = await callIpc(window.electronAPI.terminal.create, mergedOptions);

    if (!ok || !result?.id) {
      setLastError(error || 'No se pudo abrir la terminal.');
      return null;
    }

    // La terminal existe pero el shell puede haber fallado al arrancar.
    if (result.error) setLastError(result.error);

    const newTerm = {
      id: result.id,
      name: name || `Terminal ${terminals.length + 1}`,
      shell: result.shell,
      error: result.error,
    };
    setTerminals((prev) => [...prev, newTerm]);
    setActiveTerminalId(result.id);
    return newTerm;
  }, [terminals.length, projectPath]);

  const createOpenCodeTerminal = useCallback(async () => {
    if (!window.electronAPI?.terminal) return null;
    if (openCodeTerminal) return openCodeTerminal;

    const { ok, data: result, error } = await callIpc(window.electronAPI.terminal.create, {
      cwd: projectPath,
      name: 'OpenCode',
      mode: 'opencode'
    });

    if (!ok || !result?.id || result.error) {
      setLastError(result?.error || error || 'No se pudo abrir OpenCode.');
      return null;
    }

    const newTerm = {
      id: result.id,
      name: 'OpenCode',
      shell: result.shell,
      error: result.error,
    };
    setOpenCodeTerminal(newTerm);
    return newTerm;
  }, [openCodeTerminal, projectPath]);

  const closeTerminal = useCallback((id) => {
    if (window.electronAPI?.terminal) {
      window.electronAPI.terminal.destroy(id);
    }
    xtermRefs.current.delete(id);
    setTerminals((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (activeTerminalId === id && filtered.length > 0) {
        setActiveTerminalId(filtered[filtered.length - 1].id);
      } else if (filtered.length === 0) {
        setActiveTerminalId(null);
      }
      return filtered;
    });
  }, [activeTerminalId]);

  const writeToTerminal = useCallback((id, data) => {
    if (window.electronAPI?.terminal) {
      window.electronAPI.terminal.write(id, data);
    }
  }, []);

  const resizeTerminal = useCallback((id, cols, rows) => {
    if (window.electronAPI?.terminal) {
      window.electronAPI.terminal.resize(id, cols, rows);
    }
  }, []);

  const registerXterm = useCallback((id, xtermInstance) => {
    xtermRefs.current.set(id, xtermInstance);
  }, []);

  const closeAllTerminals = useCallback(() => {
    for (const terminal of terminals) {
      window.electronAPI?.terminal?.destroy(terminal.id);
      xtermRefs.current.delete(terminal.id);
    }
    setTerminals([]);
    setActiveTerminalId(null);

    if (openCodeTerminal) {
      window.electronAPI?.terminal?.destroy(openCodeTerminal.id);
      xtermRefs.current.delete(openCodeTerminal.id);
      setOpenCodeTerminal(null);
    }
  }, [terminals, openCodeTerminal]);

  const getXterm = useCallback((id) => {
    return xtermRefs.current.get(id);
  }, []);

  // Listen for terminal data from main process
  useEffect(() => {
    if (!window.electronAPI?.terminal) return;

    const unsubscribeData = window.electronAPI.terminal.onData((id, data) => {
      const xterm = xtermRefs.current.get(id);
      if (xterm) xterm.write(data);
    });

    const unsubscribeExit = window.electronAPI.terminal.onExit((id) => {
      if (openCodeTerminal && id === openCodeTerminal.id) {
        setOpenCodeTerminal(null);
      } else {
        closeTerminal(id);
      }
    });

    return () => {
      unsubscribeData?.();
      unsubscribeExit?.();
    };
  }, [closeTerminal, openCodeTerminal]);

  return {
    terminals,
    activeTerminalId,
    setActiveTerminalId,
    createTerminal,
    closeTerminal,
    writeToTerminal,
    resizeTerminal,
    registerXterm,
    getXterm,
    closeAllTerminals,
    openCodeTerminal,
    createOpenCodeTerminal,
    lastError,
    clearLastError: () => setLastError(''),
  };
}
