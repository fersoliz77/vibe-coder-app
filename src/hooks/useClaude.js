import { useState, useCallback, useEffect, useRef } from 'react';
import { appendProgress, appendRendererStream, limitChatMessages } from '../utils/chatLimits.mjs';

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
  const activeRunRef = useRef(null);
  const projectPathRef = useRef(projectPath);

  const saveTimerRef = useRef(null);
  const storageKey = `chat:claude:${projectPath || 'global'}`;

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

  // Load history on mount or project change
  useEffect(() => {
    if (!window.electronAPI?.store) return;
    let cancelled = false;
    setMessages([]); // Clear current UI state first
    window.electronAPI.store.get(storageKey, []).then((saved) => {
      if (!cancelled && Array.isArray(saved) && saved.length > 0) {
        setMessages(limitChatMessages(saved));
      }
    });
    return () => { cancelled = true; };
  }, [storageKey]);

  useEffect(() => {
    const previous = projectPathRef.current;
    projectPathRef.current = projectPath;
    if (previous && previous !== projectPath) {
      window.electronAPI?.claude?.cancel(activeRunRef.current, previous);
      activeRunRef.current = null;
      streamRef.current = '';
      setCurrentResponse('');
      setIsRunning(false);
    }
  }, [projectPath]);

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
      const next = limitChatMessages([...prev, userMessage]);
      saveHistory(next);
      return next;
    });
    setIsRunning(true);
    setCurrentResponse('');
    streamRef.current = '';
    const run = await window.electronAPI.claude.sendPrompt(prompt, cwd || projectPath, model, history);
    if (run?.success && run.projectPath === projectPathRef.current) activeRunRef.current = run.runId;
    else if (!run?.success) setIsRunning(false);
  }, [projectPath, saveHistory, messages]);

  const cancel = useCallback(() => {
    if (!window.electronAPI?.claude) return;
    window.electronAPI.claude.cancel(activeRunRef.current, projectPathRef.current);
    activeRunRef.current = null;
    setIsRunning(false);
    if (streamRef.current) {
      setMessages((prev) => {
        const next = limitChatMessages([
          ...prev,
          { role: 'assistant', content: streamRef.current + '\n\n*[Cancelled]*', timestamp: Date.now() },
        ]);
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
      window.electronAPI.claude.onData((event) => {
        if (event?.projectPath !== projectPathRef.current) return;
        if (activeRunRef.current != null && event.runId !== activeRunRef.current) return;
        activeRunRef.current = event.runId;
        streamRef.current = appendRendererStream(streamRef.current, event.text);
        setCurrentResponse(streamRef.current);
      }),
      window.electronAPI.claude.onComplete(({ runId, projectPath: eventProjectPath, output } = {}) => {
        if (eventProjectPath !== projectPathRef.current || (activeRunRef.current != null && runId !== activeRunRef.current)) return;
        activeRunRef.current = null;
        setIsRunning(false);
        const finalContent = streamRef.current || output || '';
        if (finalContent) {
          setMessages((prev) => {
            const next = limitChatMessages([
              ...prev,
              { role: 'assistant', content: finalContent, timestamp: Date.now() },
            ]);
            saveHistory(next);
            return next;
          });
        }
        setCurrentResponse('');
        streamRef.current = '';
      }),
      window.electronAPI.claude.onError(({ runId, projectPath: eventProjectPath, error } = {}) => {
        if (eventProjectPath !== projectPathRef.current || (activeRunRef.current != null && runId !== activeRunRef.current)) return;
        activeRunRef.current = null;
        setIsRunning(false);
        setMessages((prev) => {
          const next = limitChatMessages([
            ...prev,
            { role: 'error', content: error, timestamp: Date.now() },
          ]);
          saveHistory(next);
          return next;
        });
        setCurrentResponse('');
        streamRef.current = '';
      }),
      window.electronAPI.claude.onInstallProgress(({ type, text }) => {
        setInstallLog((prev) => appendProgress(prev, { type, text }));
      }),
      window.electronAPI.claude.onLoginProgress(({ type, text }) => {
        setLoginLog((prev) => appendProgress(prev, { type, text }));
      }),
    ];

    return () => unsubs.forEach((u) => u?.());
  }, [saveHistory]);

  useEffect(() => () => {
    clearTimeout(saveTimerRef.current);
    if (activeRunRef.current != null) window.electronAPI?.claude?.cancel(activeRunRef.current, projectPathRef.current);
  }, []);

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
