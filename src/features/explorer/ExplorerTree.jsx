import { dragLog, getExtension, getFileMeta } from './explorerUtils';

function FileTypeIcon({ meta, extension }) {
  const ext = (extension || '').toLowerCase();

  if (ext === 'html' || ext === 'htm') {
    return (
      <svg viewBox="0 0 16 16" className="file-glyph file-glyph--html" aria-hidden="true">
        <path fill="currentColor" d="M3 1.75A1.75 1.75 0 0 1 4.75 0h4.19c.46 0 .9.183 1.226.509l2.325 2.325c.326.326.509.767.509 1.227v10.19A1.75 1.75 0 0 1 11.25 16h-6.5A1.75 1.75 0 0 1 3 14.25z" opacity=".22"/>
        <path fill="currentColor" d="M6.1 6.2 4.45 7.9l1.65 1.7.7-.72L5.86 7.9l.94-.98zm3.8 0-.7.72.94.98-.94.98.7.72 1.65-1.7zM7.6 10.4h.84l.96-5.1h-.84z"/>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" className="file-glyph" aria-hidden="true" style={{ color: meta.color }}>
      <path fill="currentColor" d="M3 1.75A1.75 1.75 0 0 1 4.75 0h4.19c.46 0 .9.183 1.226.509l2.325 2.325c.326.326.509.767.509 1.227v10.19A1.75 1.75 0 0 1 11.25 16h-6.5A1.75 1.75 0 0 1 3 14.25z" opacity=".22"/>
      <path fill="currentColor" d="M8.94 1.2v2.17c0 .72.58 1.3 1.3 1.3h2.16v-.64c0-.28-.11-.55-.31-.75L9.88 1.52a1.05 1.05 0 0 0-.74-.32z"/>
      <path fill="currentColor" d="M5.25 6.75h5.5v.9h-5.5zm0 2.15h5.5v.9h-5.5zm0 2.15h3.35v.9H5.25z"/>
    </svg>
  );
}

function SearchResults({ results, query, onOpen }) {
  const hasResults = results.files.length > 0 || results.contentMatches.length > 0;

  return (
    <div className="file-search-results">
      <div className="file-search-results__title">Results for "{query}"</div>
      {!hasResults && <div className="file-tree-empty-root">No matches found</div>}
      {results.files.length > 0 && (
        <div className="file-search-results__group">
          <div className="file-search-results__label">Files</div>
          {results.files.map((item) => (
            <button key={`file:${item.path}`} className="file-search-results__item" type="button" onClick={() => onOpen(item.path)}>
              <span className="file-search-results__name">{item.name}</span>
              <span className="file-search-results__path">{item.path}</span>
            </button>
          ))}
        </div>
      )}
      {results.contentMatches.length > 0 && (
        <div className="file-search-results__group">
          <div className="file-search-results__label">Content</div>
          {results.contentMatches.map((item) => (
            <button key={`content:${item.path}:${item.snippet}`} className="file-search-results__item" type="button" onClick={() => onOpen(item.path)}>
              <span className="file-search-results__name">{item.name}</span>
              <span className="file-search-results__snippet">{item.snippet}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TreeNode(props) {
  const {
    node,
    depth,
    expandedPaths,
    directoryCache,
    selectedPaths,
    dropTargetPath,
    renamingPath,
    renamingValue,
    onRenamingValueChange,
    onRenameSubmit,
    onRenameCancel,
    onSelectNode,
    onToggleDirectory,
    onOpenPreview,
    onOpenExternal,
    onContextMenu,
    onScheduleDirectoryExpand,
    onClearDirectoryExpandSchedule,
    onDragStartNode,
    isDragging,
  } = props;
  const meta = getFileMeta(node.name, node.isDirectory);
  const isSelected = selectedPaths.includes(node.path);
  const isExpanded = expandedPaths.has(node.path);
  const isDropTarget = dropTargetPath === node.path;
  const children = node.isDirectory ? (directoryCache[node.path] || []) : [];

  return (
    <div className="file-tree-node">
      <div
        className={`file-tree-item ${isSelected ? 'file-tree-item--selected' : ''} ${isDropTarget ? 'file-tree-item--drop-target' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px`, '--file-accent': meta.color }}
        role="button"
        tabIndex={0}
        title={node.path}
        data-testid="file-tree-item"
        data-node-path={node.path}
        data-node-directory={node.isDirectory ? 'true' : 'false'}
        onClick={(event) => {
          onSelectNode(node, event);
          if (node.isDirectory) onToggleDirectory(node.path);
          else onOpenPreview(node.path);
        }}
        onDoubleClick={() => !node.isDirectory && onOpenExternal(node.path)}
        onContextMenu={(event) => onContextMenu(event, node)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelectNode(node, event);
            if (node.isDirectory) onToggleDirectory(node.path);
            else onOpenPreview(node.path);
          }
        }}
        onMouseEnter={() => {
          if (isDragging && node.isDirectory) onScheduleDirectoryExpand(node.path);
        }}
        onMouseLeave={() => {
          if (isDragging) onClearDirectoryExpandSchedule();
        }}
      >
        {!node.isRoot && (
          <span
            className="file-tree-drag-handle"
            data-testid="file-tree-drag-handle"
            onMouseDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              dragLog('dragStart', { sourcePath: node.path, name: node.name, x: event.clientX, y: event.clientY });
              onDragStartNode(node, event.clientX, event.clientY);
            }}
            title="Drag to move"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5 3.25a1 1 0 1 1-2 0 1 1 0 0 1 2 0m0 4.75a1 1 0 1 1-2 0 1 1 0 0 1 2 0m0 4.75a1 1 0 1 1-2 0 1 1 0 0 1 2 0m8-9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0m0 4.75a1 1 0 1 1-2 0 1 1 0 0 1 2 0m0 4.75a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg>
          </span>
        )}
        <span className="file-tree-indent" style={{ width: `${Math.max(depth, 0) * 14}px` }} />
        <span className="file-tree-caret">{node.isDirectory ? (isExpanded ? '⌄' : '›') : ''}</span>
        <span className={`file-tree-icon ${node.isDirectory ? 'file-tree-icon--folder' : ''}`}>
          {node.isDirectory ? (
            <svg viewBox="0 0 16 16" fill="currentColor" className={`folder-icon ${isExpanded ? 'folder-icon--open' : ''}`}><path d="M.5 3l.04.87a1.99 1.99 0 0 0-.342 1.311l.637 7A2 2 0 0 0 2.826 14H13.17a2 2 0 0 0 1.991-1.819l.637-7A2 2 0 0 0 13.81 3H9.828a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 6.172 1H2.5a2 2 0 0 0-2 2zm5.672-1a1 1 0 0 1 .707.293L7.586 3H2.19c-.24 0-.47.042-.683.12L1.5 2.98a1 1 0 0 1 1-.98h3.672z"/></svg>
          ) : (
            <FileTypeIcon meta={meta} extension={getExtension(node.name)} />
          )}
        </span>
        {renamingPath === node.path ? (
          <input
            className="file-tree-rename-input"
            value={renamingValue}
            onChange={(event) => onRenamingValueChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onRenameSubmit(node);
              if (event.key === 'Escape') onRenameCancel();
            }}
            onBlur={() => onRenameSubmit(node)}
            autoFocus
          />
        ) : (
          <span className="file-tree-name">{node.name}</span>
        )}
      </div>
      {node.isDirectory && isExpanded && children.length > 0 && (
        <div className="file-tree-children">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              {...props}
              node={child}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExplorerTree({
  project,
  dropTargetPath,
  expandedPaths,
  selectedPaths,
  directoryCache,
  renamingPath,
  renamingValue,
  setSelectedEntry,
  setSelectedPaths,
  toggleDirectory,
  handleRootContextMenu,
  showSearch,
  isSearching,
  searchResults,
  searchQuery,
  openPreview,
  isLoading,
  rootItems,
  setRenamingValue,
  submitInlineRename,
  setRenamingPath,
  selectNode,
  openExternal,
  handleContextMenu,
  scheduleDirectoryExpand,
  clearDirectoryExpandSchedule,
  handleDragStartNode,
  dragState,
}) {
  return (
    <div className="file-explorer__root" onContextMenu={handleRootContextMenu}>
      <button
        className={`file-explorer__root-row ${dropTargetPath === project.path ? 'file-explorer__root-row--drop-target' : ''}`}
        type="button"
        title={project.path}
        data-node-path={project.path}
        data-node-directory="true"
        onClick={() => {
          setSelectedEntry({ name: project.name, path: project.path, isDirectory: true, isRoot: true });
          setSelectedPaths([project.path]);
          toggleDirectory(project.path);
        }}
      >
        <span className="file-explorer__root-caret">{expandedPaths.has(project.path) ? '⌄' : '›'}</span>
        <span className="file-explorer__root-name">{project.name}</span>
      </button>

      <div className="file-explorer__tree">
        {showSearch ? (
          isSearching ? <div className="file-tree-loading">Searching...</div> : <SearchResults results={searchResults} query={searchQuery} onOpen={openPreview} />
        ) : isLoading ? (
          <div className="file-tree-loading">Loading files...</div>
        ) : rootItems.length === 0 ? (
          <div className="file-tree-empty-root">Empty project folder</div>
        ) : (
          <div className="file-tree-list">
            {rootItems.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                expandedPaths={expandedPaths}
                directoryCache={directoryCache}
                selectedPaths={selectedPaths}
                dropTargetPath={dropTargetPath}
                renamingPath={renamingPath}
                renamingValue={renamingValue}
                onRenamingValueChange={setRenamingValue}
                onRenameSubmit={submitInlineRename}
                onRenameCancel={() => { setRenamingPath(null); setRenamingValue(''); }}
                onSelectNode={selectNode}
                onToggleDirectory={toggleDirectory}
                onOpenPreview={openPreview}
                onOpenExternal={openExternal}
                onContextMenu={handleContextMenu}
                onScheduleDirectoryExpand={scheduleDirectoryExpand}
                onClearDirectoryExpandSchedule={clearDirectoryExpandSchedule}
                onDragStartNode={handleDragStartNode}
                isDragging={Boolean(dragState)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
