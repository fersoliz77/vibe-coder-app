import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * useClaude hook — manages the full Claude CLI lifecycle:
 *   - Status detection (installed / authenticated)
 *   - Installation
 *   - Login (browser OAuth)
 *   - Sending prompts and streaming responses
 */
export function useClaude(projectPath) {
  const [status, setStatus] = useState({
    installed: false,
    authenticated: false,
    path: null,
    version: null,
    loading: true,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [installLog, setInstallLog] = useState([]);
  const [loginLog, setLoginLog] = useState([]);
  const [messages, setMessages] = useState([]);
  const [currentResponse, setCurrentResponse] = useState('');
  const streamRef = useRef('');

  const saveTimerRef = useRef(null);
  const storageKey = `chat:claude:${projectPath || 'global'}`;

  const saveHistory = useCallback((msgs) => {
    if (!window.electronAPI?.store) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const toSave = msgs.slice(-50);
      window.electronAPI.store.set(storageKey, toSave);
    }, 1000);
  }, [storageKey]);

  const clearHistory = useCallback(() => {
    if (!window.electronAPI?.store) return;
    clearTimeout(saveTimerRef.current);
    window.electronAPI.store.delete(storageKey);
  }, [storageKey]);

  // Load history on mount or project change
  useEffect(() => {
    if (!window.electronAPI?.store) return;
    setMessages([]); // Clear current UI state first
    window.electronAPI.store.get(storageKey, []).then((saved) => {
      if (Array.isArray(saved) && saved.length > 0) {
        setMessages(saved);
      }
    });
  }, [storageKey]);

  // ─── Status ───────────────────────────────────────────────────────────────

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI?.claude) return;
    setStatus((prev) => ({ ...prev, loading: true }));
    const result = await window.electronAPI.claude.getStatus();
    setStatus({ ...result, loading: false });
    return result;
  }, []);

  // ─── Install ──────────────────────────────────────────────────────────────

  const install = useCallback(async () => {
    if (!window.electronAPI?.claude) return;
    setIsInstalling(true);
    setInstallLog([]);
    const result = await window.electronAPI.claude.install();
    setIsInstalling(false);
    if (result.success) {
      setStatus({ ...result.status, loading: false });
    }
    return result;
  }, []);

  // ─── Login ────────────────────────────────────────────────────────────────

  const login = useCallback(async () => {
    if (!window.electronAPI?.claude) return;
    setIsLoggingIn(true);
    setLoginLog([]);
    const result = await window.electronAPI.claude.login();
    setIsLoggingIn(false);
    if (result.success) {
      await refreshStatus();
    }
    return result;
  }, [refreshStatus]);

  // ─── Logout ───────────────────────────────────────────────────────────────

  const logout = useCallback(async () => {
    if (!window.electronAPI?.claude) return;
    await window.electronAPI.claude.logout();
    setMessages([]);
    clearHistory();
    await refreshStatus();
  }, [refreshStatus, clearHistory]);

  // ─── Chat ─────────────────────────────────────────────────────────────────

  const sendPrompt = useCallback(async (prompt, cwd, model) => {
    if (!window.electronAPI?.claude) return;
    const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    const userMessage = { role: 'user', content: prompt, timestamp: Date.now() };
    setMessages((prev) => {
      const next = [...prev, userMessage];
      saveHistory(next);
      return next;
    });
    setIsRunning(true);
    setCurrentResponse('');
    streamRef.current = '';
    await window.electronAPI.claude.sendPrompt(prompt, cwd || projectPath, model, history);
  }, [projectPath, saveHistory, messages]);

  const cancel = useCallback(() => {
    if (!window.electronAPI?.claude) return;
    window.electronAPI.claude.cancel();
    setIsRunning(false);
    if (streamRef.current) {
      setMessages((prev) => {
        const next = [
          ...prev,
          { role: 'assistant', content: streamRef.current + '\n\n*[Cancelled]*', timestamp: Date.now() },
        ];
        saveHistory(next);
        return next;
      });
      setCurrentResponse('');
      streamRef.current = '';
    }
  }, [saveHistory]);

  const clear = useCallback(() => {
    setMessages([]);
    setCurrentResponse('');
    streamRef.current = '';
    clearHistory();
  }, [clearHistory]);

  useEffect(() => {
    if (!window.electronAPI?.claude) return;

    const unsubs = [
      window.electronAPI.claude.onData((data) => {
        streamRef.current += data;
        setCurrentResponse(streamRef.current);
      }),
      window.electronAPI.claude.onComplete(({ output } = {}) => {
        setIsRunning(false);
        const finalContent = streamRef.current || output || '';
        if (finalContent) {
          setMessages((prev) => {
            const next = [
              ...prev,
              { role: 'assistant', content: finalContent, timestamp: Date.now() },
            ];
            saveHistory(next);
            return next;
          });
        }
        setCurrentResponse('');
        streamRef.current = '';
      }),
      window.electronAPI.claude.onError((error) => {
        setIsRunning(false);
        setMessages((prev) => {
          const next = [
            ...prev,
            { role: 'error', content: error, timestamp: Date.now() },
          ];
          saveHistory(next);
          return next;
        });
        setCurrentResponse('');
        streamRef.current = '';
      }),
      window.electronAPI.claude.onInstallProgress(({ type, text }) => {
        setInstallLog((prev) => [...prev, { type, text }]);
      }),
      window.electronAPI.claude.onLoginProgress(({ type, text }) => {
        setLoginLog((prev) => [...prev, { type, text }]);
      }),
    ];

    return () => unsubs.forEach((u) => u?.());
  }, [saveHistory]);

  // Initial status check
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Derived convenience flags
  const isAvailable = status.installed && status.authenticated;

  return {
    // Status
    status,
    isAvailable,
    refreshStatus,
    // Auth lifecycle
    install,
    login,
    logout,
    isInstalling,
    isLoggingIn,
    installLog,
    loginLog,
    // Chat
    isRunning,
    messages,
    currentResponse,
    sendPrompt,
    cancel,
    clear,
    // Legacy compat
    checkAvailability: refreshStatus,
  };
}
