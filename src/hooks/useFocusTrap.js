import { useEffect } from 'react';
import { FOCUSABLE_SELECTOR, nextFocusIndex } from './focusTrapCore';

/**
 * Aisla el foco dentro de un dialogo mientras esta abierto.
 *
 * Mientras `active` es verdadero: Tab no puede salir del dialogo, Escape lo
 * cierra, y al cerrarse el foco vuelve al control que lo abrio. El primer
 * elemento enfocable recibe el foco al abrir, salvo que se indique otro.
 *
 * @param {object} options
 * @param {boolean} options.active si el dialogo esta abierto
 * @param {import('react').RefObject<HTMLElement>} options.containerRef contenedor del dialogo
 * @param {Function} [options.onEscape] que hacer al presionar Escape
 * @param {import('react').RefObject<HTMLElement>} [options.initialFocusRef] a que enfocar al abrir
 */
export function useFocusTrap({ active, containerRef, onEscape, initialFocusRef }) {
  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const previouslyFocused = document.activeElement;

    const visibleFocusable = () => Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((node) => node.offsetParent !== null || node === document.activeElement);

    const target = initialFocusRef?.current || visibleFocusable()[0] || container;
    target.focus?.();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const nodes = visibleFocusable();
      const index = nextFocusIndex(nodes.length, nodes.indexOf(document.activeElement), event.shiftKey);
      if (index === null) return;
      event.preventDefault();
      nodes[index].focus();
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef, onEscape, initialFocusRef]);
}

export default useFocusTrap;
