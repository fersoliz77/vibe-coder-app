export function ExplorerContextMenu({ contextMenu, actions }) {
  if (!contextMenu) return null;

  return (
    <div className="file-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
      {actions.map((action) => (
        <button key={action.id} className={`file-context-menu__item ${action.danger ? 'file-context-menu__item--danger' : ''}`} type="button" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </div>
  );
}
