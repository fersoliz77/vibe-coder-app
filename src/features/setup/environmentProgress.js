const TERMINAL_TYPES = new Set(['complete', 'error', 'cancelled']);

export function isEnvironmentInstallTerminal(progress) {
  return TERMINAL_TYPES.has(progress?.type);
}

export function getEnvironmentInstallPercent(progress) {
  const reported = String(progress?.message || '').match(/(?:^|\D)(100|[1-9]?\d)%/);
  if (reported) return Number(reported[1]);
  if (!progress?.total) return null;
  const completed = Math.max(0, progress.current - (progress.type === 'step-start' ? 1 : 0));
  return Math.min(100, Math.round((completed / progress.total) * 100));
}

export function getEnvironmentInstallStatus(progress) {
  if (progress?.type === 'complete') return progress.success ? 'completed' : 'error';
  if (progress?.type === 'error') return 'error';
  if (progress?.type === 'cancelled') return 'cancelled';
  return 'installing';
}
