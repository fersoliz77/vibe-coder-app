import { useState, useEffect, useCallback, useRef } from 'react';

const POLL_INTERVAL = 30000; // 30 seconds

export function useServices(projectPath) {
  const [services, setServices] = useState([
    { id: 'vercel', name: 'Vercel', connected: false, user: null, details: {}, checking: true },
    { id: 'firebase', name: 'Firebase', connected: false, user: null, details: {}, checking: true },
    { id: 'supabase', name: 'Supabase', connected: false, user: null, details: {}, checking: true },
    { id: 'github', name: 'GitHub', connected: false, user: null, details: {}, checking: true },
    { id: 'git', name: 'Git (Local)', connected: false, user: null, details: {}, checking: true },
  ]);
  const intervalRef = useRef(null);

  const checkAll = useCallback(async (pathOverride) => {
    const p = pathOverride || projectPath || null;
    
    setServices((prev) => prev.map((s) => ({ ...s, checking: true })));

    try {
      const results = await window.electronAPI.services.checkAll(p);
      setServices(
        results.map((r) => ({
          ...r,
          checking: false,
        }))
      );
    } catch (error) {
      console.error('Failed to check services:', error);
      setServices((prev) =>
        prev.map((s) => ({ ...s, checking: false }))
      );
    }
  }, [projectPath]);

  const checkOne = useCallback(async (serviceName, pathOverride) => {
    const p = pathOverride || projectPath || null;

    setServices((prev) =>
      prev.map((s) => (s.id === serviceName ? { ...s, checking: true } : s))
    );

    try {
      const result = await window.electronAPI.services.check(serviceName, p);
      setServices((prev) =>
        prev.map((s) =>
          s.id === serviceName ? { ...result, checking: false } : s
        )
      );
    } catch (error) {
      setServices((prev) =>
        prev.map((s) =>
          s.id === serviceName ? { ...s, checking: false } : s
        )
      );
    }
  }, [projectPath]);

  const connect = useCallback(async (serviceName) => {
    if (!window.electronAPI?.services || !projectPath) return null;
    const result = await window.electronAPI.services.connect(serviceName, projectPath);
    return result;
  }, [projectPath]);

  const disconnect = useCallback(async (serviceName) => {
    if (!window.electronAPI?.services || !projectPath) return;
    await window.electronAPI.services.disconnect(serviceName, projectPath);
    await checkOne(serviceName);
  }, [checkOne, projectPath]);

  useEffect(() => {
    checkAll();
    intervalRef.current = setInterval(checkAll, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [checkAll]);

  const connectedCount = services.filter((s) => s.connected).length;

  return { services, checkAll, checkOne, connect, disconnect, connectedCount };
}
