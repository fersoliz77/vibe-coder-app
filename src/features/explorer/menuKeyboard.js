/*
 * Teclado del menu contextual del explorador, segun el patron `menu` de
 * WAI-ARIA.
 *
 * El menu solo se abria con clic derecho y sus opciones eran botones sueltos:
 * no habia forma de abrirlo, recorrerlo ni cerrarlo sin mouse.
 *
 * Este modulo decide que hacer con cada tecla. No toca el DOM.
 */

/** @typedef {'next'|'previous'|'first'|'last'|'activate'|'close'} MenuAction */

/** Teclas que abren el menu sobre el elemento enfocado. */
export function opensMenu({ key, shiftKey = false }) {
  // ContextMenu es la tecla dedicada; Shift+F10 es el equivalente historico
  // que sigue vigente en Windows y en varios lectores de pantalla.
  return key === 'ContextMenu' || (shiftKey && key === 'F10');
}

/**
 * Accion que corresponde a una tecla dentro del menu abierto.
 *
 * @param {object} options
 * @param {string} options.key
 * @returns {MenuAction|null} null si la tecla no le corresponde al menu
 */
export function menuAction({ key }) {
  switch (key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'previous';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Enter':
    case ' ':
      return 'activate';
    case 'Escape':
    case 'Tab':
      // Tab tambien cierra: un menu contextual no forma parte del recorrido
      // normal de la pagina, y dejarlo abierto detras seria peor.
      return 'close';
    default:
      return null;
  }
}

/**
 * Indice de la siguiente opcion habilitada.
 *
 * Saltea las deshabilitadas: detenerse en una opcion que no hace nada deja al
 * usuario sin saber si el menu respondio. El recorrido da la vuelta, como
 * define el patron.
 *
 * @param {MenuAction} action
 * @param {number} current indice actual, -1 si todavia no hay ninguno
 * @param {boolean[]} enabled estado de cada opcion, en orden
 * @returns {number|null} indice destino, o null si no hay ninguna habilitada
 */
export function nextMenuIndex(action, current, enabled) {
  const count = enabled.length;
  if (count === 0 || !enabled.some(Boolean)) return null;

  const step = (from, direction) => {
    let index = from;
    for (let i = 0; i < count; i += 1) {
      index = (index + direction + count) % count;
      if (enabled[index]) return index;
    }
    return null;
  };

  switch (action) {
    case 'next':
      return step(current, 1);
    case 'previous':
      return step(current < 0 ? 0 : current, -1);
    case 'first':
      return enabled[0] ? 0 : step(0, 1);
    case 'last':
      return enabled[count - 1] ? count - 1 : step(count - 1, -1);
    default:
      return null;
  }
}
