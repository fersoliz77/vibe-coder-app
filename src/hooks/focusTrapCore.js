/*
 * Logica pura del aislamiento de foco, separada del DOM para poder probarla.
 *
 * Un dialogo modal tapa el resto de la interfaz, pero el teclado y los
 * lectores de pantalla siguen alcanzando lo de atras si nadie los detiene.
 * Estas funciones deciden a donde va el foco en cada Tab.
 */

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Indice al que salta el foco cuando se presiona Tab dentro del dialogo.
 *
 * Devuelve null cuando el foco puede seguir su curso normal, y un indice
 * cuando hay que forzarlo para que no se escape del dialogo.
 *
 * @param {number} count cantidad de elementos enfocables
 * @param {number} current indice del elemento con foco, -1 si esta fuera
 * @param {boolean} shiftKey si Tab va hacia atras
 * @returns {number|null}
 */
export function nextFocusIndex(count, current, shiftKey) {
  if (count <= 0) return null;
  // El foco esta fuera del dialogo: se lo trae al extremo que corresponde.
  if (current < 0) return shiftKey ? count - 1 : 0;
  if (shiftKey && current === 0) return count - 1;
  if (!shiftKey && current === count - 1) return 0;
  return null;
}
