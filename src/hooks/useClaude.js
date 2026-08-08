import { useState, useCallback, useEffect, useRef } from 'react';
import { appendProgress, appendRendererStream, limitChatMessages } from '../utils/chatLimits.mjs';
import { callIpc } from '../utils/callIpc';

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
    error: '',
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

  useEffect(() => {
    const previous = projectPathRef.current;
    projectPathRef.current = projectPath;
    if (previous && previous !== projectPath) {
      window.electronAPI?.claude?.cancel(activeRunRef.current, previous);
      activeRunRef.current = null;
      streamRef.current = '';
      setCurrentResponse('');
      setMessages([]);
      setIsRunning(false);
    }
  }, [projectPath]);

  // ─── Status ───────────────────────────────────────────────────────────────

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI?.claude) {
      setStatus((prev) => ({ ...prev, loading: false, error: 'Claude no esta disponible en esta ejecucion.' }));
      return null;
    }
    setStatus((prev) => ({ ...prev, loading: true, error: '' }));
    const { ok, data: result, error } = await callIpc(window.electronAPI.claude.getStatus);
    if (!ok) {
      // La consulta fallo: el estado real es desconocido, no "no instalado".
      setStatus((prev) => ({ ...prev, loading: false, error }));
      return null;
    }
    setStatus({ ...result, loading: false, error: '' });
    return result;
  }, []);

  // ─── Install ──────────────────────────────────────────────────────────────

  const install = useCallback(async () => {
    if (!window.electronAPI?.claude) return null;
    setIsInstalling(true);
    setInstallLog([]);
    const { ok, data: result, error } = await callIpc(window.electronAPI.claude.install);
    setIsInstalling(false);
    if (!ok) {
      setStatus((prev) => ({ ...prev, loading: false, error }));
      return { success: false, error };
    }
    if (result?.success) {
      setStatus({ ...result.status, loading: false, error: '' });
    }
    return result;
  }, []);

  // ─── Login ────────────────────────────────────────────────────────────────

  const login = useCallback(async () => {
    if (!window.electronAPI?.claude) return null;
    setIsLoggingIn(true);
    setLoginLog([]);
    try {
      const { ok, data: result, error } = await callIpc(window.electronAPI.claude.login);
      if (!ok) {
        setStatus((prev) => ({ ...prev, error }));
        return { success: false, error };
      }
      if (result?.success) await refreshStatus();
      return result;
    } finally {
      setIsLoggingIn(false);
    }
  }, [refreshStatus]);

  // ─── Logout ───────────────────────────────────────────────────────────────

  const logout = useCallback(async () => {
    if (!window.electronAPI?.claude) return;
    const { ok, error } = await callIpc(window.electronAPI.claude.logout);
    if (!ok) {
      setStatus((prev) => ({ ...prev, error }));
      return;
    }
    setMessages([]);
    await refreshStatus();
  }, [refreshStatus]);

  // ─── Chat ─────────────────────────────────────────────────────────────────

  const sendPrompt = useCallback(async (prompt, cwd, model) => {
    if (!window.electronAPI?.claude) return;
    const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    const userMessage = { role: 'user', content: prompt, timestamp: Date.now() };
    setMessages((prev) => {
      const next = limitChatMessages([...prev, userMessage]);
      return next;
    });
    setIsRunning(true);
    setCurrentResponse('');
    streamRef.current = '';
    try {
      const run = await window.electronAPI.claude.sendPrompt(prompt, cwd || projectPath, model, history);
      if (run?.success && run.projectPath === projectPathRef.current) activeRunRef.current = run.runId;
      else setIsRunning(false);
    } catch (error) {
      setMessages((prev) => limitChatMessages([...prev, { role: 'error', content: error?.message || 'No se pudo iniciar la respuesta.', timestamp: Date.now() }]));
      setIsRunning(false);
    }
  }, [projectPath, messages]);

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
        return next;
      });
      setCurrentResponse('');
      streamRef.current = '';
    }
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setCurrentResponse('');
    streamRef.current = '';
  }, []);

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
  }, []);

  useEffect(() => () => {
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
