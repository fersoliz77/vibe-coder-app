import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import './FileExplorer.css';

const CodeEditor = lazy(() => import('./CodeEditor'));

const STORAGE_PREFIX = 'fileExplorerState:';

const FILE_META = {
  js: { label: 'JS', color: '#f7df1e' },
  jsx: { label: 'JSX', color: '#61dafb' },
  ts: { label: 'TS', color: '#3178c6' },
  tsx: { label: 'TSX', color: '#4fc3f7' },
  json: { label: 'JSON', color: '#f5c542' },
  md: { label: 'MD', color: '#7fb3ff' },
  css: { label: 'CSS', color: '#42a5f5' },
  scss: { label: 'SCSS', color: '#f48fb1' },
  html: { label: 'HTML', color: '#ff8a65' },
  py: { label: 'PY', color: '#4fc08d' },
  sql: { label: 'SQL', color: '#ba68c8' },
  yml: { label: 'YML', color: '#ffb74d' },
  yaml: { label: 'YML', color: '#ffb74d' },
  toml: { label: 'CFG', color: '#ce93d8' },
  env: { label: 'ENV', color: '#8bc34a' },
  gitignore: { label: 'GIT', color: '#ef5350' },
  png: { label: 'IMG', color: '#26c6da' },
  jpg: { label: 'IMG', color: '#26c6da' },
  jpeg: { label: 'IMG', color: '#26c6da' },
  svg: { label: 'SVG', color: '#ffca28' },
  ico: { label: 'ICO', color: '#ffca28' },
  lock: { label: 'LOCK', color: '#b0bec5' },
  txt: { label: 'TXT', color: '#90a4ae' },
  sh: { label: 'SH', color: '#66bb6a' },
  bat: { label: 'BAT', color: '#66bb6a' },
  ps1: { label: 'PS', color: '#42a5f5' },
  default: { label: 'FILE', color: '#9aa5ce' },
};

function getStorageKey(projectPath) {
  return `${STORAGE_PREFIX}${projectPath}`;
}

function getExtension(name) {
  const parts = name.split('.');
  return parts.length <= 1 ? '' : parts.pop().toLowerCase();
}

function getFileMeta(name, isDirectory) {
  if (isDirectory) return { label: 'DIR', color: '#d9a441' };
  if (name === '.gitignore') return FILE_META.gitignore;
  if (name === '.env' || name.startsWith('.env.')) return FILE_META.env;
  return FILE_META[getExtension(name)] || FILE_META.default;
}

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

function getParentDirectory(filePath) {
  const normalized = filePath.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  parts.pop();
  return parts.join('\\');
}

function getName(filePath) {
  return filePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
}

function formatBytes(size) {
  if (!size && size !== 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function makeTab(file) {
  return {
    id: file.path,
    name: file.name,
    path: file.path,
    type: file.type,
    extension: file.extension,
    size: file.size,
    savedContent: file.type === 'text' ? file.content : null,
    draftContent: file.type === 'text' ? file.content : null,
    content: file.content,
  };
}

function updatePathPrefix(value, oldPath, nextPath) {
  if (!value) return value;
  if (value === oldPath) return nextPath;
  if (value.startsWith(`${oldPath}\\`) || value.startsWith(`${oldPath}/`)) {
    return `${nextPath}${value.slice(oldPath.length)}`;
  }
  return value;
}

function toAbsoluteProjectPath(projectPath, relativePath) {
  return `${projectPath}\${String(relativePath || '').replace(/\//g, '\\')}`;
}

function isStagedCode(code) {
  const value = String(code || '');
  return value[0] && value[0] !== ' ' && value[0] !== '?';
}

function dragLog(event, payload = {}) {
  if (typeof window !== 'undefined') {
    window.__lastExplorerDnDLogs = window.__lastExplorerDnDLogs || [];
    window.__lastExplorerDnDLogs.push({ event, payload, at: Date.now() });
    if (window.__lastExplorerDnDLogs.length > 50) {
      window.__lastExplorerDnDLogs = window.__lastExplorerDnDLogs.slice(-50);
    }
  }
  console.log(`[explorer:dnd] ${event}`, payload);
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

function ActionModal({ action, onClose, onConfirm }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!action) return;
    setValue('');
  }, [action]);

  if (!action) return null;

  const isDelete = action.type === 'delete';
  const isBulkDelete = action.type === 'bulk-delete';
  const isCommit = action.type === 'git-commit';
  const titles = {
    'new-file': 'Create File',
    'new-folder': 'Create Folder',
    delete: `Delete ${action.node?.isDirectory ? 'Folder' : 'File'}`,
    'bulk-delete': 'Delete Selected Items',
    'git-commit': 'Create Commit',
  };

  return (
    <div className="file-modal-backdrop" onClick={onClose}>
      <div className="file-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="file-modal__title">{titles[action.type]}</h3>
        {isDelete || isBulkDelete ? (
          <p className="file-modal__text">
            {isBulkDelete ? `This permanently deletes ${action.count} selected items.` : <>This permanently deletes <strong>{action.node?.name}</strong>.</>}
          </p>
        ) : (
          <>
            <p className="file-modal__text">{isCommit ? 'Write a commit message for the staged changes.' : action.targetDir}</p>
            <input
              className="file-modal__input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={isCommit ? 'feat: update project files' : action.type === 'new-folder' ? 'components' : 'index.tsx'}
              autoFocus
            />
          </>
        )}
        <div className="file-modal__actions">
          <button className="btn btn--small" type="button" onClick={onClose}>Cancel</button>
          <button className={`btn btn--small ${(isDelete || isBulkDelete) ? 'btn--danger' : 'btn--primary'}`} type="button" onClick={() => onConfirm(value.trim())} disabled={!isDelete && !isBulkDelete && !value.trim()}>
            {(isDelete || isBulkDelete) ? 'Delete' : isCommit ? 'Commit' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ state, onCancel, onConfirm }) {
  if (!state) return null;

  return (
    <div className="file-modal-backdrop" onClick={onCancel}>
      <div className="file-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="file-modal__title">Unsaved Changes</h3>
        <p className="file-modal__text">{state.message}</p>
        <div className="file-modal__actions">
          <button className="btn btn--small" type="button" onClick={onCancel}>Keep Editing</button>
          <button className="btn btn--small btn--danger" type="button" onClick={onConfirm}>Discard</button>
        </div>
      </div>
    </div>
  );
}

function Pane({ title, active, onActivate, children }) {
  return (
    <section className={`file-explorer__pane ${active ? 'file-explorer__pane--active' : ''}`} onClick={onActivate}>
      <header className="file-explorer__pane-head">{title}</header>
      <div className="file-explorer__pane-body">{children}</div>
    </section>
  );
}

function TreeNode({
  node,
  depth,
  project,
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
  onDropMove,
  onScheduleDirectoryExpand,
  onClearDirectoryExpandSchedule,
  onDragStartNode,
  isDragging,
}) {
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
              node={child}
              depth={depth + 1}
              project={project}
              expandedPaths={expandedPaths}
              directoryCache={directoryCache}
              selectedPaths={selectedPaths}
              dropTargetPath={dropTargetPath}
              renamingPath={renamingPath}
              renamingValue={renamingValue}
              onRenamingValueChange={onRenamingValueChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onSelectNode={onSelectNode}
              onToggleDirectory={onToggleDirectory}
              onOpenPreview={onOpenPreview}
              onOpenExternal={onOpenExternal}
              onContextMenu={onContextMenu}
              onDropMove={onDropMove}
              onScheduleDirectoryExpand={onScheduleDirectoryExpand}
              onClearDirectoryExpandSchedule={onClearDirectoryExpandSchedule}
              onDragStartNode={onDragStartNode}
              isDragging={isDragging}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileExplorer({ project }) {
  const [rootItems, setRootItems] = useState([]);
  const [directoryCache, setDirectoryCache] = useState({});
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [paneTabs, setPaneTabs] = useState({ primary: null, secondary: null });
  const [activePane, setActivePane] = useState('primary');
  const [splitView, setSplitView] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState(null);
  const [modalAction, setModalAction] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [dragState, setDragState] = useState(null);
  const [dropTargetPath, setDropTargetPath] = useState(null);
  const [clipboardEntry, setClipboardEntry] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ files: [], contentMatches: [] });
  const [isSearching, setIsSearching] = useState(false);
  const [renamingPath, setRenamingPath] = useState(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [highlightedContent, setHighlightedContent] = useState('');
  const [savedHighlightedContent, setSavedHighlightedContent] = useState('');
  const [gitStatus, setGitStatus] = useState([]);
  const [gitStatusError, setGitStatusError] = useState('');
  const hydratedProjectRef = useRef(null);
  const hoverExpandTimerRef = useRef(null);

  const activeTabId = paneTabs[activePane];
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const dirtyTabs = tabs.filter((tab) => tab.type === 'text' && tab.draftContent !== tab.savedContent);
  const activeTabDirty = activeTab?.type === 'text' && activeTab.draftContent !== activeTab.savedContent;
  const hasDirtyTabs = dirtyTabs.length > 0;

  const loadDirectory = useCallback(async (dirPath) => {
    const items = await window.electronAPI.fs.readDir(dirPath);
    setDirectoryCache((prev) => ({ ...prev, [dirPath]: items }));
    return items;
  }, []);

  const loadGitStatus = useCallback(async () => {
    if (!project?.path) return;
    const result = await window.electronAPI.fs.gitStatus(project.path);
    if (!result.success) {
      setGitStatus([]);
      setGitStatusError(result.error || 'No git repository detected.');
      return;
    }
    setGitStatus(result.entries || []);
    setGitStatusError('');
  }, [project?.path]);

  const refreshTree = useCallback(async () => {
    if (!project?.path) return;
    const root = await loadDirectory(project.path);
    setRootItems(root);
    await Promise.all(Array.from(expandedPaths).filter((path) => path !== project.path).map((path) => loadDirectory(path)));
    await loadGitStatus();
  }, [expandedPaths, loadDirectory, loadGitStatus, project?.path]);

  useEffect(() => {
    if (!project?.path) return;
    const persisted = window.localStorage.getItem(getStorageKey(project.path));
    const parsed = persisted ? JSON.parse(persisted) : null;

    setExpandedPaths(new Set(parsed?.expandedPaths?.length ? parsed.expandedPaths : [project.path]));
    setSelectedPaths([]);
    setSelectionAnchor(null);
    setSelectedEntry(null);
    setTabs([]);
    setPaneTabs({ primary: null, secondary: null });
    setActivePane('primary');
    setSplitView(Boolean(parsed?.splitView));
    setContextMenu(null);
    setModalAction(null);
    setConfirmState(null);
    setStatusMessage('');
    setClipboardEntry(null);
    setSearchQuery('');
    setSearchResults({ files: [], contentMatches: [] });
    setRenamingPath(null);
    setRenamingValue('');
    setShowDiff(false);
    setHighlightedContent('');
    setSavedHighlightedContent('');
    setDirectoryCache({});
    hydratedProjectRef.current = parsed;

    setIsLoading(true);
    loadDirectory(project.path).then((items) => {
      setRootItems(items);
      setIsLoading(false);
      loadGitStatus();
    });
  }, [loadDirectory, loadGitStatus, project?.path]);

  useEffect(() => {
    if (!project?.path) return;
    window.localStorage.setItem(getStorageKey(project.path), JSON.stringify({
      expandedPaths: Array.from(expandedPaths),
      selectedPaths,
      openTabPaths: tabs.map((tab) => tab.path),
      paneTabs,
      splitView,
    }));
  }, [expandedPaths, paneTabs, project?.path, selectedPaths, splitView, tabs]);

  useEffect(() => {
    const pending = hydratedProjectRef.current;
    if (!project?.path || !pending) return;
    hydratedProjectRef.current = null;

    const paths = pending.openTabPaths || [];
    if (pending.selectedPaths?.length) setSelectedPaths(pending.selectedPaths);

    if (paths.length > 0) {
      Promise.all(paths.map((path) => window.electronAPI.fs.readFile(path))).then((results) => {
        const validTabs = results.filter((result) => result.success).map(makeTab);
        setTabs(validTabs);
        setPaneTabs({
          primary: validTabs.some((tab) => tab.id === pending.paneTabs?.primary) ? pending.paneTabs.primary : validTabs[0]?.id || null,
          secondary: validTabs.some((tab) => tab.id === pending.paneTabs?.secondary) ? pending.paneTabs.secondary : null,
        });
      }).catch(() => {});
    }
  }, [project?.path]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  useEffect(() => {
    if (!project?.path || searchQuery.trim().length < 2) {
      setSearchResults({ files: [], contentMatches: [] });
      setIsSearching(false);
      return undefined;
    }

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      const result = await window.electronAPI.fs.search(project.path, searchQuery);
      setSearchResults(result.success ? { files: result.files, contentMatches: result.contentMatches } : { files: [], contentMatches: [] });
      setIsSearching(false);
    }, 220);

    return () => clearTimeout(timeoutId);
  }, [project?.path, searchQuery]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!hasDirtyTabs) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasDirtyTabs]);

  useEffect(() => {
    if (!activeTab || activeTab.type !== 'text' || !showDiff) {
      setHighlightedContent('');
      setSavedHighlightedContent('');
      return;
    }
    let cancelled = false;
    import('../../utils/highlightCode').then(({ highlightCode }) => {
      if (cancelled) return;
      setHighlightedContent(highlightCode(activeTab.draftContent ?? '', activeTab.extension));
      setSavedHighlightedContent(highlightCode(activeTab.savedContent ?? '', activeTab.extension));
    }).catch(() => {
      if (cancelled) return;
      setHighlightedContent(activeTab.draftContent ?? '');
      setSavedHighlightedContent(activeTab.savedContent ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, showDiff]);

  const visiblePaths = useMemo(() => {
    const paths = [];
    const walk = (items) => {
      items.forEach((node) => {
        paths.push(node.path);
        if (node.isDirectory && expandedPaths.has(node.path)) {
          walk(directoryCache[node.path] || []);
        }
      });
    };
    walk(rootItems);
    return paths;
  }, [directoryCache, expandedPaths, rootItems]);

  const remapPaths = useCallback((oldPath, nextPath) => {
    setSelectedPaths((prev) => prev.map((value) => updatePathPrefix(value, oldPath, nextPath)));
    setSelectedEntry((prev) => prev ? { ...prev, path: updatePathPrefix(prev.path, oldPath, nextPath), name: getName(updatePathPrefix(prev.path, oldPath, nextPath)) } : prev);
    setTabs((prev) => prev.map((tab) => {
      const remappedPath = updatePathPrefix(tab.path, oldPath, nextPath);
      return remappedPath === tab.path ? tab : { ...tab, id: remappedPath, path: remappedPath, name: getName(remappedPath) };
    }));
    setPaneTabs((prev) => ({
      primary: updatePathPrefix(prev.primary, oldPath, nextPath),
      secondary: updatePathPrefix(prev.secondary, oldPath, nextPath),
    }));
    setExpandedPaths((prev) => {
      const next = new Set();
      prev.forEach((value) => next.add(updatePathPrefix(value, oldPath, nextPath)));
      return next;
    });
    setClipboardEntry((prev) => prev ? { ...prev, path: updatePathPrefix(prev.path, oldPath, nextPath), name: getName(updatePathPrefix(prev.path, oldPath, nextPath)) } : prev);
  }, []);

  const selectNode = useCallback((node, event) => {
    const path = node.path;
    setSelectedEntry(node);

    if (event?.shiftKey && selectionAnchor) {
      const allPaths = visiblePaths;
      const from = allPaths.indexOf(selectionAnchor);
      const to = allPaths.indexOf(path);
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelectedPaths(allPaths.slice(start, end + 1));
        return;
      }
    }

    if (event?.ctrlKey || event?.metaKey) {
      setSelectedPaths((prev) => prev.includes(path) ? prev.filter((value) => value !== path) : [...prev, path]);
      setSelectionAnchor(path);
      return;
    }

    setSelectedPaths([path]);
    setSelectionAnchor(path);
  }, [selectionAnchor, visiblePaths]);

  const toggleDirectory = useCallback(async (dirPath) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
    if (!directoryCache[dirPath]) {
      await loadDirectory(dirPath);
    }
  }, [directoryCache, loadDirectory]);

  const scheduleDirectoryExpand = useCallback((dirPath) => {
    if (!dirPath || expandedPaths.has(dirPath)) return;
    clearTimeout(hoverExpandTimerRef.current);
    hoverExpandTimerRef.current = setTimeout(() => {
      toggleDirectory(dirPath);
    }, 550);
  }, [expandedPaths, toggleDirectory]);

  const clearDirectoryExpandSchedule = useCallback(() => {
    clearTimeout(hoverExpandTimerRef.current);
    hoverExpandTimerRef.current = null;
  }, []);

  const onScheduleTarget = useCallback((targetPath) => {
    setDropTargetPath(targetPath);
    scheduleDirectoryExpand(targetPath);
  }, [scheduleDirectoryExpand]);

  const handleDragStartNode = useCallback((node, x, y) => {
    setDragState({ sourcePath: node.path, name: node.name, x, y });
  }, []);

  const openPreview = useCallback(async (filePath) => {
    setSelectedPaths([filePath]);
    setSelectedEntry({ path: filePath, name: getName(filePath), isDirectory: false });
    const result = await window.electronAPI.fs.readFile(filePath);
    if (!result.success) {
      setStatusMessage(result.error || 'Could not open file.');
      return;
    }

    setTabs((prev) => {
      const existing = prev.find((tab) => tab.id === result.path);
      if (existing) {
        return prev.map((tab) => tab.id === result.path ? { ...tab, ...makeTab(result), draftContent: tab.draftContent ?? result.content, savedContent: result.content } : tab);
      }
      return [...prev, makeTab(result)];
    });
    setPaneTabs((prev) => ({ ...prev, [activePane]: result.path }));
    setStatusMessage('');
  }, [activePane]);

  const openExternal = useCallback((filePath) => {
    window.electronAPI.fs.openFile(filePath);
  }, []);

  const revealFolder = useCallback((folderPath) => {
    window.electronAPI.fs.openFolder(folderPath);
  }, []);

  const openCreateAction = useCallback((type, node = null) => {
    const target = node || selectedEntry;
    const targetDir = target ? (target.isDirectory ? target.path : getParentDirectory(target.path)) : project.path;
    setModalAction({ type, targetDir, node: target });
    setContextMenu(null);
  }, [project?.path, selectedEntry]);

  const openDeleteAction = useCallback((node) => {
    if (selectedPaths.length > 1 && selectedPaths.includes(node.path)) {
      setModalAction({ type: 'bulk-delete', count: selectedPaths.length });
    } else {
      setModalAction({ type: 'delete', node });
    }
    setContextMenu(null);
  }, [selectedPaths]);

  const submitInlineRename = useCallback(async (node) => {
    const nextName = renamingValue.trim();
    if (!renamingPath || !nextName || nextName === node.name) {
      setRenamingPath(null);
      setRenamingValue('');
      return;
    }
    const result = await window.electronAPI.fs.renameEntry(node.path, nextName);
    if (!result.success) {
      setStatusMessage(result.error || 'Rename failed.');
      return;
    }
    remapPaths(result.oldPath, result.path);
    setRenamingPath(null);
    setRenamingValue('');
    await refreshTree();
    setStatusMessage('Renamed successfully.');
  }, [refreshTree, remapPaths, renamingPath, renamingValue]);

  const handleContextMenu = useCallback((event, node) => {
    event.preventDefault();
    selectNode(node);
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  }, [selectNode]);

  const handleRootContextMenu = useCallback((event) => {
    event.preventDefault();
    const node = { name: project.name, path: project.path, isDirectory: true, isRoot: true };
    setSelectedEntry(node);
    setSelectedPaths([project.path]);
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  }, [project?.name, project?.path]);

  const handleConfirmModal = useCallback(async (value) => {
    if (!modalAction) return;
    let result;

    if (modalAction.type === 'new-file') result = await window.electronAPI.fs.createFile(modalAction.targetDir, value);
    if (modalAction.type === 'new-folder') result = await window.electronAPI.fs.createFolder(modalAction.targetDir, value);
    if (modalAction.type === 'delete') result = await window.electronAPI.fs.deleteEntry(modalAction.node.path);
    if (modalAction.type === 'git-commit') result = await window.electronAPI.fs.gitCommit(project.path, value);
    if (modalAction.type === 'bulk-delete') {
      const results = await Promise.all(selectedPaths.map((path) => window.electronAPI.fs.deleteEntry(path)));
      result = { success: results.every((entry) => entry.success) };
    }

    if (!result?.success) {
      setStatusMessage(result?.error || 'Action failed.');
      return;
    }

    if (modalAction.type === 'delete' || modalAction.type === 'bulk-delete') {
      const targets = modalAction.type === 'bulk-delete' ? selectedPaths : [modalAction.node.path];
      setTabs((prev) => prev.filter((tab) => !targets.some((path) => tab.path.startsWith(path))));
      setSelectedPaths([]);
      setSelectedEntry(null);
      setPaneTabs((prev) => ({
        primary: targets.some((path) => prev.primary?.startsWith(path)) ? null : prev.primary,
        secondary: targets.some((path) => prev.secondary?.startsWith(path)) ? null : prev.secondary,
      }));
    }

    await refreshTree();
    setModalAction(null);
    setStatusMessage(
      modalAction.type === 'bulk-delete' ? 'Deleted selected items.' :
      modalAction.type === 'delete' ? 'Deleted successfully.' :
      modalAction.type === 'git-commit' ? 'Commit created successfully.' :
      'Created successfully.'
    );
    if (modalAction.type === 'new-file' && result.path) {
      await openPreview(result.path);
    }
  }, [modalAction, openPreview, project.path, refreshTree, selectedPaths]);

  const handleGitStageToggle = useCallback(async (entry) => {
    const absolutePath = toAbsoluteProjectPath(project.path, entry.path);
    const result = isStagedCode(entry.code)
      ? await window.electronAPI.fs.gitUnstage(project.path, absolutePath)
      : await window.electronAPI.fs.gitStage(project.path, absolutePath);

    if (!result.success) {
      setStatusMessage(result.error || 'Git action failed.');
      return;
    }

    await loadGitStatus();
    setStatusMessage(isStagedCode(entry.code) ? `Unstaged ${entry.path}.` : `Staged ${entry.path}.`);
  }, [loadGitStatus, project.path]);

  const openCommitAction = useCallback(() => {
    setModalAction({ type: 'git-commit' });
  }, []);

  const stagedEntries = useMemo(() => gitStatus.filter((entry) => isStagedCode(entry.code)), [gitStatus]);

  const saveActiveTab = useCallback(async () => {
    if (!activeTab || activeTab.type !== 'text') return;
    const result = await window.electronAPI.fs.writeFile(activeTab.path, activeTab.draftContent ?? '');
    if (!result.success) {
      setStatusMessage(result.error || 'Save failed.');
      return;
    }
    setTabs((prev) => prev.map((tab) => tab.id === activeTab.id ? { ...tab, savedContent: tab.draftContent, content: tab.draftContent } : tab));
    setStatusMessage('Saved.');
    await loadGitStatus();
  }, [activeTab, loadGitStatus]);

  const handleDropMove = useCallback(async (sourcePath, targetDir) => {
    dragLog('handleDropMove:start', { sourcePath, targetDir });
    setDropTargetPath(null);
    setDragState(null);
    if (!sourcePath || !targetDir) {
      dragLog('handleDropMove:missing-data', { sourcePath, targetDir });
      return;
    }
    if (getParentDirectory(sourcePath) === targetDir) {
      dragLog('handleDropMove:same-parent', { sourcePath, targetDir });
      return;
    }
    const result = await window.electronAPI.fs.moveEntry(sourcePath, targetDir);
    dragLog('handleDropMove:result', result);
    if (!result.success) {
      setStatusMessage(result.error || 'Move failed.');
      return;
    }
    remapPaths(result.oldPath, result.path);
    await refreshTree();
    setStatusMessage(`Moved ${getName(result.oldPath)} into ${getName(targetDir)}.`);
  }, [refreshTree, remapPaths]);

  useEffect(() => {
    if (!dragState) return undefined;

    const handleMouseMove = (event) => {
      setDragState((current) => (current ? { ...current, x: event.clientX, y: event.clientY } : current));

      const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-node-path]');
      if (!hovered) {
        if (dropTargetPath !== null) {
          dragLog('hoverTarget:clear');
          setDropTargetPath(null);
          clearDirectoryExpandSchedule();
        }
        return;
      }

      const targetPath = hovered.getAttribute('data-node-path');
      const isDirectory = hovered.getAttribute('data-node-directory') === 'true';
      if (!isDirectory || !targetPath || targetPath === dragState.sourcePath) {
        if (dropTargetPath !== null) {
          dragLog('hoverTarget:invalid', { targetPath, isDirectory });
          setDropTargetPath(null);
          clearDirectoryExpandSchedule();
        }
        return;
      }

      if (dropTargetPath !== targetPath) {
        dragLog('hoverTarget:set', { targetPath });
        setDropTargetPath(targetPath);
        onScheduleTarget(targetPath);
      }
    };

    const handleMouseUp = () => {
      dragLog('dragEnd', { sourcePath: dragState.sourcePath, targetPath: dropTargetPath });
      clearDirectoryExpandSchedule();
      if (dropTargetPath) {
        handleDropMove(dragState.sourcePath, dropTargetPath);
      } else {
        setDragState(null);
      }
      setDropTargetPath(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [clearDirectoryExpandSchedule, dragState, dropTargetPath, handleDropMove, onScheduleTarget]);

  const handleCopyEntry = useCallback((node, mode = 'copy') => {
    setClipboardEntry({ path: node.path, name: node.name, mode, isDirectory: node.isDirectory });
    setContextMenu(null);
    setStatusMessage(`${mode === 'cut' ? 'Cut' : 'Copied'} ${node.name}.`);
  }, []);

  const handlePasteInto = useCallback(async (node) => {
    if (!clipboardEntry) return;
    const targetDir = node.isDirectory ? node.path : getParentDirectory(node.path);
    const result = clipboardEntry.mode === 'cut'
      ? await window.electronAPI.fs.moveEntry(clipboardEntry.path, targetDir)
      : await window.electronAPI.fs.copyEntry(clipboardEntry.path, targetDir);
    if (!result.success) {
      setStatusMessage(result.error || 'Paste failed.');
      return;
    }
    if (clipboardEntry.mode === 'cut') {
      remapPaths(result.oldPath, result.path);
      setClipboardEntry(null);
    }
    await refreshTree();
    setStatusMessage(`${clipboardEntry.mode === 'cut' ? 'Moved' : 'Pasted'} ${clipboardEntry.name} into ${getName(targetDir)}.`);
    setContextMenu(null);
  }, [clipboardEntry, refreshTree, remapPaths]);

  useEffect(() => {
    const handler = (event) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest('.cm-editor'));

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (activeTabDirty) document.querySelector('.file-explorer__save-btn')?.click();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        document.querySelector('.file-explorer__search')?.focus();
        return;
      }

      if (isTyping) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedPaths.length > 0) {
        event.preventDefault();
        const path = selectedPaths[0];
        setClipboardEntry({ path, name: getName(path), mode: 'copy' });
        setStatusMessage(`Copied ${getName(path)}.`);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && selectedPaths.length > 0) {
        event.preventDefault();
        const path = selectedPaths[0];
        setClipboardEntry({ path, name: getName(path), mode: 'cut' });
        setStatusMessage(`Cut ${getName(path)}.`);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && clipboardEntry) {
        event.preventDefault();
        const targetPath = selectedEntry?.isDirectory ? selectedEntry.path : selectedEntry?.path ? getParentDirectory(selectedEntry.path) : project.path;
        handlePasteInto({ path: targetPath, isDirectory: true, name: getName(targetPath) });
        return;
      }

      if (event.key === 'F2' && selectedEntry && !selectedEntry.isRoot) {
        event.preventDefault();
        setRenamingPath(selectedEntry.path);
        setRenamingValue(selectedEntry.name);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabDirty, clipboardEntry, handlePasteInto, project?.path, selectedEntry, selectedPaths]);

  const handleDuplicateEntry = useCallback(async (node) => {
    const result = await window.electronAPI.fs.duplicateEntry(node.path);
    if (!result.success) {
      setStatusMessage(result.error || 'Duplicate failed.');
      return;
    }
    await refreshTree();
    setStatusMessage(`Duplicated ${node.name}.`);
    setContextMenu(null);
  }, [refreshTree]);

  const closeTabImmediate = useCallback((tabId) => {
    setTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    setPaneTabs((prev) => ({
      primary: prev.primary === tabId ? null : prev.primary,
      secondary: prev.secondary === tabId ? null : prev.secondary,
    }));
  }, []);

  const closeTab = useCallback((tabId) => {
    const target = tabs.find((tab) => tab.id === tabId);
    const dirty = target?.type === 'text' && target.draftContent !== target.savedContent;
    if (dirty) {
      setConfirmState({
        message: `Close ${target.name} without saving?`,
        onConfirm: () => {
          closeTabImmediate(tabId);
          setConfirmState(null);
        },
      });
      return;
    }
    closeTabImmediate(tabId);
  }, [closeTabImmediate, tabs]);

  const reorderTabs = useCallback((draggedId, targetId) => {
    if (!draggedId || !targetId || draggedId === targetId) return;
    setTabs((prev) => {
      const next = [...prev];
      const from = next.findIndex((tab) => tab.id === draggedId);
      const to = next.findIndex((tab) => tab.id === targetId);
      if (from === -1 || to === -1) return prev;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const contextActions = useMemo(() => {
    if (!contextMenu?.node) return [];
    const node = contextMenu.node;
    return [
      { id: 'new-file', label: 'New File', onClick: () => openCreateAction('new-file', node) },
      { id: 'new-folder', label: 'New Folder', onClick: () => openCreateAction('new-folder', node) },
      { id: 'rename', label: 'Rename', onClick: () => { setRenamingPath(node.path); setRenamingValue(node.name); setContextMenu(null); }, hidden: node.isRoot },
      { id: 'copy', label: 'Copy', onClick: () => handleCopyEntry(node, 'copy'), hidden: node.isRoot },
      { id: 'cut', label: 'Cut', onClick: () => handleCopyEntry(node, 'cut'), hidden: node.isRoot },
      { id: 'paste', label: 'Paste Into', onClick: () => handlePasteInto(node), disabled: !clipboardEntry },
      { id: 'duplicate', label: 'Duplicate', onClick: () => handleDuplicateEntry(node), hidden: node.isRoot },
      { id: 'reveal', label: 'Open in Explorer', onClick: () => revealFolder(node.isDirectory ? node.path : getParentDirectory(node.path)) },
      { id: 'open', label: 'Open File', onClick: () => openExternal(node.path), hidden: node.isDirectory },
      { id: 'delete', label: selectedPaths.length > 1 && selectedPaths.includes(node.path) ? `Delete ${selectedPaths.length} Selected` : 'Delete', danger: true, onClick: () => openDeleteAction(node), hidden: node.isRoot && selectedPaths.length <= 1 },
    ].filter((item) => !item.hidden);
  }, [clipboardEntry, contextMenu, handleCopyEntry, handleDuplicateEntry, handlePasteInto, openCreateAction, openDeleteAction, openExternal, revealFolder, selectedPaths]);

  const showSearch = searchQuery.trim().length >= 2;

  return (
    <div className="file-explorer">
      <aside className="file-explorer__sidebar">
        <div className="file-explorer__header">
          <span className="file-explorer__eyebrow">Explorer</span>
          <div className="file-explorer__actions">
            <button className="file-explorer__icon-btn" type="button" title="New file in selected folder" onClick={() => openCreateAction('new-file')}>
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.5 1.75a.75.75 0 0 0-1.5 0v5h-5a.75.75 0 0 0 0 1.5h5v5a.75.75 0 0 0 1.5 0v-5h5a.75.75 0 0 0 0-1.5h-5v-5z"/></svg>
            </button>
            <button className="file-explorer__icon-btn" type="button" title="New folder in selected folder" onClick={() => openCreateAction('new-folder')}>
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 2A1.75 1.75 0 0 0 0 3.75v6.5C0 11.216.784 12 1.75 12h5.5a.75.75 0 0 0 0-1.5h-5.5a.25.25 0 0 1-.25-.25v-6.5A.25.25 0 0 1 1.75 3.5h2.534a.25.25 0 0 1 .177.073l1.216 1.216A1.75 1.75 0 0 0 6.914 5.3H10.25a.25.25 0 0 1 .25.25V7a.75.75 0 0 0 1.5 0V5.55A1.75 1.75 0 0 0 10.25 3.8H6.914a.25.25 0 0 1-.177-.073L5.52 2.51A1.75 1.75 0 0 0 4.284 2H1.75z"/><path d="M12.25 8.5a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5H13v1.5a.75.75 0 0 1-1.5 0V12.25H10a.75.75 0 0 1 0-1.5h1.5v-1.5a.75.75 0 0 1 .75-.75z"/></svg>
            </button>
            <button className="file-explorer__icon-btn" type="button" title="Refresh tree" onClick={refreshTree}>
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.917.5.5 0 1 0-.908.418A4 4 0 1 1 8 4c1.226 0 2.324.55 3.058 1.416H9.5a.5.5 0 0 0 0 1H12a.5.5 0 0 0 .5-.5V3.5a.5.5 0 0 0-1 0v1.163A4.982 4.982 0 0 0 8 3z"/></svg>
            </button>
            <button className="file-explorer__icon-btn" type="button" title="Open project folder" onClick={() => revealFolder(project.path)}>
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 3A1.75 1.75 0 0 0 0 4.75v6.5C0 12.216.784 13 1.75 13h8.5A1.75 1.75 0 0 0 12 11.25V5.5h2.793l-2.147 2.146a.5.5 0 1 0 .708.708l3-3a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L14.793 4.5H12v-.75A1.75 1.75 0 0 0 10.25 2h-3.5L5.646.896A1.75 1.75 0 0 0 4.409.25H1.75z"/></svg>
            </button>
          </div>
        </div>

        <div className="file-explorer__search-wrap">
          <input className="file-explorer__search" type="text" placeholder="Search files and content..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          {clipboardEntry && <div className="file-explorer__clipboard">Clipboard ({clipboardEntry.mode}): {clipboardEntry.name}</div>}
          {dragState && <div className="file-explorer__drag-hint">Dragging: {dragState.name}</div>}
          {selectedPaths.length > 1 && <div className="file-explorer__multi-count">{selectedPaths.length} selected</div>}
        </div>

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
                    project={project}
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
                    onDropMove={handleDropMove}
                    onScheduleDirectoryExpand={(path) => {
                      setDropTargetPath(path);
                      scheduleDirectoryExpand(path);
                    }}
                    onClearDirectoryExpandSchedule={() => {
                      clearDirectoryExpandSchedule();
                      setDropTargetPath(null);
                    }}
                    onDragStartNode={handleDragStartNode}
                    isDragging={Boolean(dragState)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="file-explorer__git-panel">
          <div className="file-explorer__git-header">
            <div className="file-explorer__git-title">Changes</div>
            <div className="file-explorer__git-actions">
              <button className="file-explorer__git-btn" type="button" onClick={loadGitStatus}>Refresh</button>
              <button className="file-explorer__git-btn" type="button" onClick={openCommitAction} disabled={stagedEntries.length === 0}>Commit</button>
            </div>
          </div>
          {gitStatusError ? (
            <div className="file-explorer__git-empty">{gitStatusError}</div>
          ) : gitStatus.length === 0 ? (
            <div className="file-explorer__git-empty">Working tree clean</div>
          ) : (
            <div className="file-explorer__git-list">
              {gitStatus.slice(0, 40).map((entry) => (
                <div key={`${entry.code}:${entry.path}`} className="file-explorer__git-row">
                  <button className="file-explorer__git-item" type="button" onClick={() => openPreview(toAbsoluteProjectPath(project.path, entry.path))}>
                    <span className="file-explorer__git-code">{entry.code}</span>
                    <span className="file-explorer__git-path">{entry.path}</span>
                  </button>
                  <button className="file-explorer__git-btn" type="button" onClick={() => handleGitStageToggle(entry)}>
                    {isStagedCode(entry.code) ? 'Unstage' : 'Stage'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="file-explorer__workspace">
        <div className="file-explorer__editor-shell">
          {dirtyTabs.length > 0 && (
            <div className="file-explorer__changes-bar">
              <span className="file-explorer__changes-title">Unsaved</span>
              <div className="file-explorer__changes-list">
                {dirtyTabs.map((tab) => (
                  <button key={`dirty:${tab.id}`} className="file-explorer__changes-item" type="button" onClick={() => setPaneTabs((prev) => ({ ...prev, [activePane]: tab.id }))}>
                    {tab.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="file-explorer__tabs">
            {tabs.length === 0 ? (
              <div className="file-explorer__tabs-empty">No file open</div>
            ) : tabs.map((tab) => {
              const dirty = tab.type === 'text' && tab.draftContent !== tab.savedContent;
              return (
                <div
                  key={tab.id}
                  className={`file-explorer__tab ${tab.id === activeTabId ? 'file-explorer__tab--active' : ''}`}
                  onClick={() => setPaneTabs((prev) => ({ ...prev, [activePane]: tab.id }))}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('application/tab-id', tab.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => reorderTabs(event.dataTransfer.getData('application/tab-id'), tab.id)}
                >
                  <span className="file-explorer__tab-name">{tab.name}</span>
                  {dirty && <span className="file-explorer__tab-dirty" />}
                  <button className="file-explorer__tab-close" type="button" onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}>x</button>
                </div>
              );
            })}
            <button className="file-explorer__split-toggle" type="button" onClick={() => setSplitView((value) => !value)}>{splitView ? 'Single' : 'Split'}</button>
          </div>

          {!activeTab && !splitView ? (
            <div className="file-explorer__workspace-card">
              <h2 className="file-explorer__workspace-title">Project Explorer</h2>
              <p className="file-explorer__workspace-text">Virtualized tree, multi-select, Git changes, split editor, drag-and-drop tabs, and full project file actions are all active now.</p>
              <p className="file-explorer__workspace-path">{project.path}</p>
              {statusMessage && <p className="file-explorer__status">{statusMessage}</p>}
            </div>
          ) : (
            <div className={`file-explorer__panes ${splitView ? 'file-explorer__panes--split' : ''}`}>
              {['primary', ...(splitView ? ['secondary'] : [])].map((paneKey) => {
                const paneTab = tabs.find((tab) => tab.id === paneTabs[paneKey]) || null;
                return (
                  <Pane key={paneKey} title={paneKey === 'primary' ? 'Primary' : 'Secondary'} active={activePane === paneKey} onActivate={() => setActivePane(paneKey)}>
                    {!paneTab ? (
                      <div className="file-explorer__workspace-card file-explorer__workspace-card--empty">
                        <p className="file-explorer__workspace-text">Select a file to open it in the {paneKey} pane.</p>
                        {statusMessage && paneKey === 'primary' && <p className="file-explorer__status">{statusMessage}</p>}
                      </div>
                    ) : (
                      <div className="file-explorer__preview">
                        <div className="file-explorer__preview-header">
                          <div>
                            <h2 className="file-explorer__workspace-title">{paneTab.name}</h2>
                            <p className="file-explorer__workspace-path">{paneTab.path}</p>
                          </div>
                          <div className="file-explorer__preview-actions">
                            <span className="file-explorer__meta-pill">{paneTab.extension || 'no ext'}</span>
                            <span className="file-explorer__meta-pill">{formatBytes(paneTab.size)}</span>
                            {paneTab.type === 'text' && paneKey === activePane && <button className="btn btn--small" type="button" onClick={() => setShowDiff((value) => !value)}>{showDiff ? 'Editor' : 'Diff'}</button>}
                            {paneTab.type === 'text' && paneKey === activePane && <button className="btn btn--small btn--primary file-explorer__save-btn" type="button" onClick={saveActiveTab}>Save</button>}
                            <button className="btn btn--small" type="button" onClick={() => openExternal(paneTab.path)}>Open</button>
                            <button className="btn btn--small" type="button" onClick={() => revealFolder(getParentDirectory(paneTab.path))}>Reveal</button>
                          </div>
                        </div>
                        <div className="file-explorer__preview-body">
                          {paneTab.type === 'image' ? (
                            <div className="file-explorer__image-wrap"><img className="file-explorer__image" src={paneTab.content} alt={paneTab.name} /></div>
                          ) : showDiff && paneKey === activePane ? (
                            <div className="file-explorer__diff">
                              <section className="file-explorer__diff-pane">
                                <header className="file-explorer__diff-head">Saved</header>
                                <pre className="file-explorer__diff-code language-code" dangerouslySetInnerHTML={{ __html: savedHighlightedContent }} />
                              </section>
                              <section className="file-explorer__diff-pane">
                                <header className="file-explorer__diff-head">Current</header>
                                <pre className="file-explorer__diff-code language-code" dangerouslySetInnerHTML={{ __html: highlightedContent }} />
                              </section>
                            </div>
                          ) : (
                            <Suspense fallback={<div className="file-tree-loading">Loading editor...</div>}>
                              <CodeEditor
                                extension={paneTab.extension}
                                value={paneTab.draftContent ?? ''}
                                onChange={(value) => setTabs((prev) => prev.map((tab) => tab.id === paneTab.id ? { ...tab, draftContent: value } : tab))}
                              />
                            </Suspense>
                          )}
                        </div>
                      </div>
                    )}
                  </Pane>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {contextMenu && (
        <div className="file-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {contextActions.map((action) => (
            <button key={action.id} className={`file-context-menu__item ${action.danger ? 'file-context-menu__item--danger' : ''}`} type="button" disabled={action.disabled} onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      )}

      <ActionModal action={modalAction} onClose={() => setModalAction(null)} onConfirm={handleConfirmModal} />
      <ConfirmModal state={confirmState} onCancel={() => setConfirmState(null)} onConfirm={() => confirmState?.onConfirm?.()} />
      {dragState && (
        <div className="file-explorer__drag-overlay" style={{ left: dragState.x + 14, top: dragState.y + 14 }}>
          Moving {dragState.name}
        </div>
      )}
    </div>
  );
}
