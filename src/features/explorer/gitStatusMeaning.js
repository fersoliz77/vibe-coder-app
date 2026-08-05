/*
 * Traduce los codigos de estado de Git a algo que se entienda sin saber Git.
 *
 * El panel mostraba el codigo crudo de `git status --porcelain` (" M", "??",
 * "A ", "MM"). Para quien recien empieza son dos letras sin significado, y el
 * producto ensena a programar: el estado tiene que explicarse solo.
 *
 * El formato son dos caracteres, XY: X es lo que ya esta preparado para el
 * proximo commit y Y lo que cambio en el disco y todavia no se preparo.
 */

/** Significado de cada letra, por clave de traduccion. */
const LETTER = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'conflicted',
  T: 'typeChanged',
};

/**
 * Descompone un codigo de Git en algo mostrable.
 *
 * @param {string} code codigo de dos caracteres de `git status --porcelain`
 * @returns {{key: string, staged: boolean, unstaged: boolean, tone: string}}
 *   `key` es la clave de traduccion; `tone` agrupa el color del indicador.
 */
export function describeGitCode(code) {
  const value = String(code ?? '');
  const index = value[0] ?? ' ';
  const worktree = value[1] ?? ' ';

  if (index === '?' || worktree === '?') {
    return { key: 'untracked', staged: false, unstaged: true, tone: 'new' };
  }
  if (index === '!' || worktree === '!') {
    return { key: 'ignored', staged: false, unstaged: false, tone: 'muted' };
  }
  // Un conflicto tapa cualquier otra lectura: hay que resolverlo primero.
  if (index === 'U' || worktree === 'U') {
    return { key: 'conflicted', staged: false, unstaged: true, tone: 'danger' };
  }

  const staged = index !== ' ' && index !== '';
  const unstaged = worktree !== ' ' && worktree !== '';

  // Se nombra por el cambio mas reciente: lo que el usuario acaba de hacer.
  const letter = unstaged ? worktree : index;
  const key = LETTER[letter] || 'changed';

  let tone = 'changed';
  if (key === 'deleted') tone = 'danger';
  else if (key === 'added') tone = 'new';
  else if (staged && !unstaged) tone = 'staged';

  return { key, staged, unstaged, tone };
}

/**
 * Clave de traduccion para la frase completa que describe el estado.
 * Distingue lo ya preparado de lo que todavia no, que es la confusion
 * mas comun al empezar con Git.
 *
 * @param {{staged: boolean, unstaged: boolean, key: string}} meaning
 * @returns {string} clave dentro de `explorer.git`
 */
export function gitStageKey({ staged, unstaged, key }) {
  if (key === 'untracked') return 'untrackedHelp';
  if (key === 'conflicted') return 'conflictedHelp';
  if (staged && unstaged) return 'partiallyStagedHelp';
  if (staged) return 'stagedHelp';
  return 'unstagedHelp';
}
