export const VIEWS = {
  PROJECTS: 'projects',
  DASHBOARD: 'dashboard',
  FILES: 'files',
  TERMINAL: 'terminal',
  CLAUDE: 'claude',
  OPENAI: 'openai',
  SETTINGS: 'settings',
  OPENCODE: 'opencode',
  PREVIEW: 'preview',
  LEARNING: 'learning',
  REQUIREMENTS: 'requirements',
};

/** Vistas que solo tienen sentido con un proyecto abierto. */
export const PROJECT_VIEWS = Object.freeze([
  VIEWS.DASHBOARD, VIEWS.FILES, VIEWS.TERMINAL,
  VIEWS.CLAUDE, VIEWS.OPENAI, VIEWS.PREVIEW, VIEWS.REQUIREMENTS,
]);

/*
 * Decide con que vista arranca la sesion a partir de la ultima guardada.
 *
 * OPENCODE queda deliberadamente fuera: entrar en esa vista dispara la
 * instalacion del agente, y arrancar la app instalando algo que nadie pidio
 * en esta sesion es justo lo que hay que evitar. Se cae al panel del proyecto.
 *
 * @param {unknown} saved     vista guardada en la sesion anterior
 * @param {boolean} hasProject si hay un proyecto restaurado
 * @returns {string} una vista siempre valida
 */
export function restoreView(saved, hasProject) {
  const known = Object.values(VIEWS).includes(saved);
  if (!known || saved === VIEWS.OPENCODE || saved === VIEWS.LEARNING) {
    return hasProject ? VIEWS.DASHBOARD : VIEWS.PROJECTS;
  }
  if (PROJECT_VIEWS.includes(saved) && !hasProject) {
    return VIEWS.PROJECTS;
  }
  return saved;
}
