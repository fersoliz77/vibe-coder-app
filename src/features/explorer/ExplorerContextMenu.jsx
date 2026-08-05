import { useCallback, useEffect, useRef } from 'react';
import { menuAction, nextMenuIndex } from './menuKeyboard';

/**
 * Menu contextual del explorador.
 *
 * Ademas de abrirse con clic derecho, se abre con la tecla Menu o Shift+F10
 * sobre la fila enfocada. Mientras esta abierto el foco vive adentro: las
 * flechas recorren las opciones habilitadas, Escape cierra y el foco vuelve
 * a la fila que lo abrio.
 */
export function ExplorerContextMenu({ contextMenu, actions, onClose }) {
  const menuRef = useRef(null);
  const restoreFocusRef = useRef(null);

  const enabled = actions.map((action) => !action.disabled);

  const focusItem = useCallback((index) => {
    const items = menuRef.current?.querySelectorAll('[role="menuitem"]');
    items?.[index]?.focus();
  }, []);

  useEffect(() => {
    if (!contextMenu) return undefined;
    restoreFocusRef.current = document.activeElement;

    // La primera opcion habilitada recibe el foco al abrir.
    const first = nextMenuIndex('first', -1, enabled);
    if (first !== null) focusItem(first);

    return () => {
      const target = restoreFocusRef.current;
      if (target && typeof target.focus === 'function' && document.contains(target)) {
        target.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu]);

  const handleKeyDown = useCallback((event) => {
    const action = menuAction(event);
    if (!action) return;

    if (action === 'close') {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (action === 'activate') {
      event.preventDefault();
      event.target.click();
      return;
    }

    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    const current = items.indexOf(document.activeElement);
    const target = nextMenuIndex(action, current, enabled);
    if (target === null) return;
    event.preventDefault();
    focusItem(target);
  }, [enabled, focusItem, onClose]);

  if (!contextMenu) return null;

  return (
    <div
      ref={menuRef}
      className="file-context-menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      role="menu"
      aria-label={contextMenu.node?.name}
      onKeyDown={handleKeyDown}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          className={`file-context-menu__item ${action.danger ? 'file-context-menu__item--danger' : ''}`}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={action.disabled}
          onClick={(event) => { event.stopPropagation(); action.onClick(); }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
