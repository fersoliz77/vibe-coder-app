export function ExplorerPane({ title, active, onActivate, children }) {
  return (
    <section className={`file-explorer__pane ${active ? 'file-explorer__pane--active' : ''}`} onClick={onActivate}>
      <header className="file-explorer__pane-head">{title}</header>
      <div className="file-explorer__pane-body">{children}</div>
    </section>
  );
}
