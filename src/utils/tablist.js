/*
 * Teclado de las barras de pestanas, segun el patron `tablist` de WAI-ARIA.
 *
 * Las pestanas del editor eran `<div>` sin rol ni tabIndex: no se llegaba a
 * ellas con el teclado. Las de la terminal eran `role="button"` con tabIndex
 * en cada una, asi que Tab las recorria de a una en vez de tratarlas como un
 * grupo. En ninguna de las dos se podia reordenar sin arrastrar con el mouse.
 *
 * Este modulo decide que hacer con cada tecla. No toca el DOM.
 */

/**
 * @typedef {'previous'|'next'|'first'|'last'|'activate'|'close'|'moveLeft'|'moveRight'} TabAction
 */

/**
 * Accion que corresponde a una tecla dentro de una barra de pestanas.
 *
 * Con Ctrl o Meta, las flechas mueven la pestana en vez de cambiar de una a
 * otra: es el reemplazo por teclado del arrastre con mouse.
 *
 * @param {object} options
 * @param {string} options.key tecla presionada
 * @param {boolean} [options.ctrlKey]
 * @param {boolean} [options.metaKey]
 * @param {boolean} [options.shiftKey]
 * @returns {TabAction|null} null si la tecla no le corresponde a la barra
 */
export function tabAction({ key, ctrlKey = false, metaKey = false, shiftKey = false }) {
  const reordering = ctrlKey || metaKey;

  switch (key) {
    case 'ArrowLeft':
      return reordering ? 'moveLeft' : 'previous';
    case 'ArrowRight':
      return reordering ? 'moveRight' : 'next';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Enter':
    case ' ':
      return 'activate';
    case 'Delete':
    case 'Backspace':
      // Shift+Delete se deja pasar: suele estar tomado por el sistema.
      return shiftKey ? null : 'close';
    default:
      return null;
  }
}

/**
 * Indice destino al cambiar de pestana.
 *
 * A diferencia del arbol de archivos, aca el recorrido si da la vuelta: es
 * el comportamiento que define el patron y la lista suele ser corta.
 *
 * @param {TabAction} action
 * @param {number} current
 * @param {number} count
 * @returns {number|null} indice destino, o null si la accion no mueve el foco
 */
export function nextTabIndex(action, current, count) {
  if (count <= 0) return null;
  switch (action) {
    case 'previous':
      return (current - 1 + count) % count;
    case 'next':
      return (current + 1) % count;
    case 'first':
      return 0;
    case 'last':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Lista reordenada al mover una pestana un lugar.
 *
 * Mover no da la vuelta: en el extremo, la pestana se queda donde esta. Que
 * salte al otro lado del grupo se siente como si se hubiera perdido.
 *
 * @template T
 * @param {T[]} items
 * @param {number} from indice de la pestana que se mueve
 * @param {-1|1} direction
 * @returns {{items: T[], index: number}} lista resultante y nuevo indice
 */
export function moveTab(items, from, direction) {
  const to = from + direction;
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return { items, index: from };
  }
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return { items: next, index: to };
}
