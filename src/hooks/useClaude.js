import { useState, useCallback, useEffect, useRef } from 'react';

export function useClaude(projectPath) {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] = useState([]);
  const [currentResponse, setCurrentResponse] = useState('');
  const streamRef = useRef('');

  // Check if Claude CLI is available
  const checkAvailability = useCallback(async () => {
    if (!window.electronAPI?.claude) {
      setIsAvailable(false);
      return false;
    }
    const result = await window.electronAPI.claude.checkAvailability();
    setIsAvailable(result.available);
    return result.available;
  }, []);

  // Send a prompt to Claude
  const sendPrompt = useCallback(async (prompt, cwd) => {
    if (!window.electronAPI?.claude) return;

    const userMessage = { role: 'user', content: prompt, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMessage]);
    setIsRunning(true);
    setCurrentResponse('');
    streamRef.current = '';

    await window.electronAPI.claude.sendPrompt(prompt, cwd || projectPath);
  }, [projectPath]);

  // Cancel the current generation
  const cancel = useCallback(() => {
    if (!window.electronAPI?.claude) return;
    window.electronAPI.claude.cancel();
    setIsRunning(false);

    if (streamRef.current) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: streamRef.current + '\n\n*[Cancelled]*', timestamp: Date.now() },
      ]);
      setCurrentResponse('');
      streamRef.current = '';
    }
  }, []);

  // Clear conversation
  const clear = useCallback(() => {
    setMessages([]);
    setCurrentResponse('');
    streamRef.current = '';
  }, []);

  // Listen for Claude events
  useEffect(() => {
    if (!window.electronAPI?.claude) return;

    const unsubscribeData = window.electronAPI.claude.onData((data) => {
      streamRef.current += data;
      setCurrentResponse(streamRef.current);
    });

    const unsubscribeComplete = window.electronAPI.claude.onComplete(() => {
      setIsRunning(false);
      if (streamRef.current) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: streamRef.current, timestamp: Date.now() },
        ]);
      }
      setCurrentResponse('');
      streamRef.current = '';
    });

    const unsubscribeError = window.electronAPI.claude.onError((error) => {
      setIsRunning(false);
      setMessages((prev) => [
        ...prev,
        { role: 'error', content: error, timestamp: Date.now() },
      ]);
      setCurrentResponse('');
      streamRef.current = '';
    });

    return () => {
      unsubscribeData?.();
      unsubscribeComplete?.();
      unsubscribeError?.();
    };
  }, []);

  // Check availability on mount
  useEffect(() => {
    checkAvailability();
  }, [checkAvailability]);

  return {
    isAvailable,
    isRunning,
    messages,
    currentResponse,
    sendPrompt,
    cancel,
    clear,
    checkAvailability,
  };
}
