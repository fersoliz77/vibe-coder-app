/*
 * Que quedo realmente listo al terminar el onboarding.
 *
 * La pantalla final decia "todo listo" siempre: el avance nunca dependio del
 * estado de los agentes —y esta bien que no dependa, porque la app funciona
 * igual— pero el resultado no se resumia en ningun lado. Si OpenCode fallaba o
 * Claude seguia instalandose, el usuario se enteraba mucho despues.
 *
 * Esto no bloquea nada: solo describe. La instalacion automatica y el boton
 * para empezar a crear siguen exactamente igual.
 */

export const SETUP_STATES = Object.freeze({ READY: 'ready', PENDING: 'pending', MISSING: 'missing' });

function agentState({ working, ok }) {
  if (working) return SETUP_STATES.PENDING;
  return ok ? SETUP_STATES.READY : SETUP_STATES.MISSING;
}

/**
 * @param {{environment: any, openCode: any, claudeStatus: any, codexReady: boolean|null}} input
 * @returns {{items: {id: string, name: string, state: string, detail: string, required: boolean}[],
 *            pending: any[], missing: any[], readyCount: number, complete: boolean}}
 */
export function summarizeSetup({ environment, openCode, claudeStatus, codexReady } = {}) {
  const items = (environment?.items ?? []).map((item) => ({
    id: item.id ?? item.name,
    name: item.name ?? item.id,
    state: item.installed ? SETUP_STATES.READY : SETUP_STATES.MISSING,
    detail: item.error || '',
    required: item.required !== false,
  }));

  items.push({
    id: 'opencode',
    name: 'OpenCode',
    state: agentState({
      working: Boolean(openCode?.loading || openCode?.installing),
      ok: Boolean(openCode?.status?.usable || openCode?.status?.installed),
    }),
    detail: openCode?.error || '',
    required: false,
  });

  items.push({
    id: 'claude',
    name: 'Claude Code',
    state: agentState({
      working: Boolean(claudeStatus?.loading || claudeStatus?.installing),
      ok: Boolean(claudeStatus?.installed),
    }),
    detail: '',
    required: false,
  });

  items.push({
    id: 'codex',
    name: 'ChatGPT (Codex)',
    state: codexReady === null || codexReady === undefined
      ? SETUP_STATES.PENDING
      : codexReady ? SETUP_STATES.READY : SETUP_STATES.MISSING,
    detail: '',
    required: false,
  });

  const pending = items.filter((item) => item.state === SETUP_STATES.PENDING);
  const missing = items.filter((item) => item.state === SETUP_STATES.MISSING);

  return {
    items,
    pending,
    missing,
    readyCount: items.filter((item) => item.state === SETUP_STATES.READY).length,
    complete: pending.length === 0 && missing.length === 0,
  };
}
