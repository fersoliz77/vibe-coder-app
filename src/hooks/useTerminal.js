import { useState, useCallback, useRef, useEffect } from 'react';

export function useTerminal(projectPath) {
  const [terminals, setTerminals] = useState([]);
  const [activeTerminalId, setActiveTerminalId] = useState(null);
  const xtermRefs = useRef(new Map());

  const createTerminal = useCallback(async (options = {}) => {
    if (!window.electronAPI?.terminal) {
      // Browser fallback
      const id = `mock-${Date.now()}`;
      const newTerm = { id, name: `Terminal ${terminals.length + 1}`, error: 'Electron not available' };
      setTerminals((prev) => [...prev, newTerm]);
      setActiveTerminalId(id);
      return newTerm;
    }

    const mergedOptions = { cwd: projectPath, ...options };
    const result = await window.electronAPI.terminal.create(mergedOptions);
    const newTerm = {
      id: result.id,
      name: `Terminal ${terminals.length + 1}`,
      shell: result.shell,
      error: result.error,
    };
    setTerminals((prev) => [...prev, newTerm]);
    setActiveTerminalId(result.id);
    return newTerm;
  }, [terminals.length, projectPath]);

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
      closeTerminal(id);
    });

    return () => {
      unsubscribeData?.();
      unsubscribeExit?.();
    };
  }, [closeTerminal]);

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
  };
}
