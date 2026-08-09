/*
 * Teclado del arbol de archivos, segun el patron `tree` de WAI-ARIA.
 *
 * Antes cada fila era un `role="button"` con `tabIndex={0}`: Tab recorria uno
 * por uno los cientos de archivos del proyecto y no habia forma de plegar,
 * desplegar ni saltar entre niveles sin el mouse.
 *
 * Este modulo decide que hacer con cada tecla. No toca el DOM: devuelve una
 * accion que el componente traduce a movimiento o cambio de estado.
 *
 * Las teclas que abren el menu contextual no viven aca: son del patron `menu`
 * y las resuelve `menuKeyboard`. El componente consulta ese modulo primero.
 */

/**
 * @typedef {'next'|'previous'|'first'|'last'|'expand'|'collapse'|'enterChild'|'goToParent'|'activate'|'delete'} TreeAction
 */

/**
 * Accion que corresponde a una tecla sobre un nodo del arbol.
 *
 * Derecha e izquierda dependen del nodo: sobre una carpeta plegada, derecha
 * la despliega; ya desplegada, entra al primer hijo. Izquierda pliega la
 * carpeta abierta y, si ya esta plegada o es un archivo, sube al padre.
 *
 * @param {object} options
 * @param {string} options.key tecla presionada
 * @param {boolean} options.isDirectory si el nodo es una carpeta
 * @param {boolean} options.isExpanded si la carpeta esta desplegada
 * @param {boolean} [options.hasChildren] si la carpeta tiene hijos visibles
 * @param {boolean} [options.shiftKey] si Shift esta presionado
 * @returns {TreeAction|null} null si la tecla no le corresponde al arbol
 */
export function treeAction({ key, isDirectory, isExpanded, hasChildren = true, shiftKey = false }) {
  if (key === 'Delete' && shiftKey) return null;
  switch (key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'previous';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'ArrowRight':
      if (!isDirectory) return null;
      if (!isExpanded) return 'expand';
      return hasChildren ? 'enterChild' : null;
    case 'ArrowLeft':
      if (isDirectory && isExpanded) return 'collapse';
      return 'goToParent';
    case 'Enter':
    case ' ':
      return 'activate';
    case 'Delete':
      // Shift+Suprimir se deja pasar: suele estar tomado por el sistema.
      return 'delete';
    default:
      return null;
  }
}

/**
 * Indice destino dentro de las filas visibles del arbol.
 *
 * El recorrido no da la vuelta: en el primer nodo, subir no salta al ultimo.
 * En un arbol largo ese salto desorienta mas de lo que ayuda.
 *
 * @param {TreeAction} action
 * @param {number} current indice actual
 * @param {number} count cantidad de filas visibles
 * @returns {number|null} indice destino, o null si la accion no mueve el foco
 */
export function nextIndex(action, current, count) {
  if (count <= 0) return null;
  switch (action) {
    case 'next':
    case 'enterChild':
      return Math.min(current + 1, count - 1);
    case 'previous':
      return Math.max(current - 1, 0);
    case 'first':
      return 0;
    case 'last':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Indice del nodo padre: la fila anterior mas cercana con menor profundidad.
 *
 * @param {number[]} levels profundidad de cada fila visible, en orden
 * @param {number} current indice actual
 * @returns {number|null} indice del padre, o null si esta en la raiz
 */
export function parentIndex(levels, current) {
  const level = levels[current];
  if (level === undefined || level <= 0) return null;
  for (let i = current - 1; i >= 0; i -= 1) {
    if (levels[i] < level) return i;
  }
  return null;
}
