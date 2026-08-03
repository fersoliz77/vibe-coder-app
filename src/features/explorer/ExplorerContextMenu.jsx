export function ExplorerContextMenu({ contextMenu, actions }) {
  if (!contextMenu) return null;

  return (
    <div className="file-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.stopPropagation()}>
      {actions.map((action) => (
        <button key={action.id} className={`file-context-menu__item ${action.danger ? 'file-context-menu__item--danger' : ''}`} type="button" disabled={action.disabled} onClick={(event) => { event.stopPropagation(); action.onClick(); }}>
          {action.label}
        </button>
      ))}
    </div>
  );
}
