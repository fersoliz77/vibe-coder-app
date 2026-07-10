import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import './FileExplorer.css';

const CodeEditor = lazy(() => import('./CodeEditor'));

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

const STORAGE_PREFIX = 'fileExplorerState:';


function getExtension(name) {
  const parts = name.split('.');
  if (parts.length <= 1) return '';
  return parts.pop().toLowerCase();
}

function getFileMeta(name, isDirectory) {
  if (isDirectory) return { label: 'DIR', color: '#d9a441' };
  if (name === '.gitignore') return FILE_META.gitignore;
  if (name === '.env' || name.startsWith('.env.')) return FILE_META.env;
  return FILE_META[getExtension(name)] || FILE_META.default;
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

function getStorageKey(projectPath) {
  return `${STORAGE_PREFIX}${projectPath}`;
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

function TreeNode({
  node,
  depth,
  activePath,
  expandedPaths,
  loadDirectory,
  toggleDirectory,
  onSelectNode,
  onPreviewFile,
  onOpenExternal,
  onContextMenu,
  onDropMove,
  onDragStartPath,
  onDragEndPath,
  dropTargetPath,
  renamingPath,
  renamingValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}) {
  const [children, setChildren] = useState(node.children || []);
  const isOpen = expandedPaths.has(node.path);
  const meta = getFileMeta(node.name, node.isDirectory);

  useEffect(() => {
    setChildren(node.children || []);
  }, [node.children]);

  useEffect(() => {
    if (!node.isDirectory || !isOpen) return undefined;
    let cancelled = false;

    loadDirectory(node.path).then((items) => {
      if (!cancelled && items) setChildren(items);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, loadDirectory, node.isDirectory, node.path]);

  const handleClick = useCallback(() => {
    onSelectNode(node);
    if (node.isDirectory) {
      toggleDirectory(node.path);
      return;
    }
    onPreviewFile(node.path);
  }, [node, node.isDirectory, node.path, onPreviewFile, onSelectNode, toggleDirectory]);

  const handleDoubleClick = useCallback(() => {
    if (!node.isDirectory) onOpenExternal(node.path);
  }, [node.isDirectory, node.path, onOpenExternal]);

  const handleDragStart = useCallback((event) => {
    event.dataTransfer.setData('text/plain', node.path);
    event.dataTransfer.effectAllowed = 'move';
    onDragStartPath(node.path);
  }, [node.path, onDragStartPath]);

  const handleDragOver = useCallback((event) => {
    if (!node.isDirectory) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, [node.isDirectory]);

  const handleDrop = useCallback((event) => {
    if (!node.isDirectory) return;
    event.preventDefault();
    const sourcePath = event.dataTransfer.getData('text/plain');
    if (sourcePath) onDropMove(sourcePath, node.path);
  }, [node.isDirectory, node.path, onDropMove]);

  const paddingLeft = 10 + depth * 16;
  const isDropTarget = dropTargetPath === node.path;

  return (
    <div className="file-tree-node">
      <button
        className={`file-tree-item ${activePath === node.path ? 'file-tree-item--selected' : ''} ${isDropTarget ? 'file-tree-item--drop-target' : ''}`}
        style={{ paddingLeft: `${paddingLeft}px`, '--file-accent': meta.color }}
        type="button"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(event) => onContextMenu(event, node)}
        draggable={!node.isRoot}
        onDragStart={handleDragStart}
        onDragEnd={onDragEndPath}
        onDragOver={handleDragOver}
        onDragEnter={() => node.isDirectory && onDragStartPath(node.path, true)}
        onDragLeave={() => node.isDirectory && onDragStartPath(null, true)}
        onDrop={handleDrop}
        title={node.path}
      >
        <span className="file-tree-caret">{node.isDirectory ? (isOpen ? '⌄' : '›') : ''}</span>
        <span className={`file-tree-icon ${node.isDirectory ? 'file-tree-icon--folder' : ''}`}>
          {node.isDirectory ? (
            <svg viewBox="0 0 16 16" fill="currentColor" className={`folder-icon ${isOpen ? 'folder-icon--open' : ''}`}>
              <path d="M.5 3l.04.87a1.99 1.99 0 0 0-.342 1.311l.637 7A2 2 0 0 0 2.826 14H13.17a2 2 0 0 0 1.991-1.819l.637-7A2 2 0 0 0 13.81 3H9.828a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 6.172 1H2.5a2 2 0 0 0-2 2zm5.672-1a1 1 0 0 1 .707.293L7.586 3H2.19c-.24 0-.47.042-.683.12L1.5 2.98a1 1 0 0 1 1-.98h3.672z"/>
            </svg>
          ) : (
            <span className="file-badge">{meta.label}</span>
          )}
        </span>
        {renamingPath === node.path ? (
          <input
            className="file-tree-rename-input"
            value={renamingValue}
            onChange={(event) => onRenameChange(event.target.value)}
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
      </button>
      {node.isDirectory && isOpen && (
        <div className="file-tree-children">
          {children.length > 0 ? children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              expandedPaths={expandedPaths}
              loadDirectory={loadDirectory}
              toggleDirectory={toggleDirectory}
              onSelectNode={onSelectNode}
              onPreviewFile={onPreviewFile}
              onOpenExternal={onOpenExternal}
              onContextMenu={onContextMenu}
              onDropMove={onDropMove}
              onDragStartPath={onDragStartPath}
              onDragEndPath={onDragEndPath}
              dropTargetPath={dropTargetPath}
              renamingPath={renamingPath}
              renamingValue={renamingValue}
              onRenameChange={onRenameChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
            />
          )) : <div className="file-tree-empty" style={{ paddingLeft: `${paddingLeft + 26}px` }}>Empty folder</div>}
        </div>
      )}
    </div>
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

function ActionModal({ action, onClose, onConfirm }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!action) return;
    setValue(action.type === 'rename' ? action.node.name : '');
  }, [action]);

  if (!action) return null;

  const isDelete = action.type === 'delete';
  const titles = {
    'new-file': 'Create File',
    'new-folder': 'Create Folder',
    rename: 'Rename',
    delete: `Delete ${action.node?.isDirectory ? 'Folder' : 'File'}`,
  };

  return (
    <div className="file-modal-backdrop" onClick={onClose}>
      <div className="file-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="file-modal__title">{titles[action.type]}</h3>
        {isDelete ? (
          <p className="file-modal__text">This permanently deletes <strong>{action.node?.name}</strong>.</p>
        ) : (
          <>
            <p className="file-modal__text">{action.targetDir}</p>
            <input
              className="file-modal__input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={action.type === 'new-folder' ? 'components' : 'index.tsx'}
              autoFocus
            />
          </>
        )}
        <div className="file-modal__actions">
          <button className="btn btn--small" type="button" onClick={onClose}>Cancel</button>
          <button
            className={`btn btn--small ${isDelete ? 'btn--danger' : 'btn--primary'}`}
            type="button"
            onClick={() => onConfirm(value.trim())}
            disabled={!isDelete && !value.trim()}
          >
            {isDelete ? 'Delete' : action.type === 'rename' ? 'Rename' : 'Create'}
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

export default function FileExplorer({ project }) {
  const [rootItems, setRootItems] = useState([]);
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [selectedPath, setSelectedPath] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState(null);
  const [modalAction, setModalAction] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [dragSourcePath, setDragSourcePath] = useState(null);
  const [dropTargetPath, setDropTargetPath] = useState(null);
  const [clipboardEntry, setClipboardEntry] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ files: [], contentMatches: [] });
  const [isSearching, setIsSearching] = useState(false);
  const hydratedProjectRef = useRef(null);
  const [renamingPath, setRenamingPath] = useState(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [highlightedContent, setHighlightedContent] = useState('');
  const [savedHighlightedContent, setSavedHighlightedContent] = useState('');

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const activeTabDirty = activeTab?.type === 'text' && activeTab.draftContent !== activeTab.savedContent;
  const hasDirtyTabs = tabs.some((tab) => tab.type === 'text' && tab.draftContent !== tab.savedContent);
  const dirtyTabs = tabs.filter((tab) => tab.type === 'text' && tab.draftContent !== tab.savedContent);

  const loadDirectory = useCallback(async (dirPath) => {
    return window.electronAPI.fs.readDir(dirPath);
  }, []);

  const loadProjectTree = useCallback(async () => {
    if (!project?.path) return;
    setIsLoading(true);
    const items = await loadDirectory(project.path);
    setRootItems(items);
    setIsLoading(false);
  }, [loadDirectory, project?.path]);

  useEffect(() => {
    if (!project?.path) return;
    const storageKey = getStorageKey(project.path);
    const persisted = window.localStorage.getItem(storageKey);
    const parsed = persisted ? JSON.parse(persisted) : null;

    setExpandedPaths(new Set(parsed?.expandedPaths?.length ? parsed.expandedPaths : [project.path]));
    setSelectedPath(null);
    setSelectedEntry(null);
    setTabs([]);
    setActiveTabId(null);
    setStatusMessage('');
    setClipboardEntry(null);
    setSearchQuery('');
    setSearchResults({ files: [], contentMatches: [] });
    setRenamingPath(null);
    setRenamingValue('');
    setShowDiff(false);
    hydratedProjectRef.current = parsed;
    loadProjectTree();
  }, [loadProjectTree, project?.path]);

  useEffect(() => {
    if (!project?.path) return;
    const storageKey = getStorageKey(project.path);
    window.localStorage.setItem(storageKey, JSON.stringify({
      expandedPaths: Array.from(expandedPaths),
      openTabPaths: tabs.map((tab) => tab.path),
      activeTabId,
      selectedPath,
    }));
  }, [activeTabId, expandedPaths, project?.path, selectedPath, tabs]);

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
    const handler = (event) => {
      const target = event.target;
      const isTypingField = target instanceof HTMLElement && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.closest('.cm-editor')
      );

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (activeTabDirty) {
          window.requestAnimationFrame(() => {
            const button = document.querySelector('.file-explorer__save-btn');
            button?.click();
          });
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        document.querySelector('.file-explorer__search')?.focus();
        return;
      }

      if (isTypingField) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedEntry && !selectedEntry.isRoot) {
        event.preventDefault();
        setClipboardEntry({ path: selectedEntry.path, isDirectory: selectedEntry.isDirectory, name: selectedEntry.name, mode: 'copy' });
        setStatusMessage(`Copied ${selectedEntry.name}.`);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && selectedEntry && !selectedEntry.isRoot) {
        event.preventDefault();
        setClipboardEntry({ path: selectedEntry.path, isDirectory: selectedEntry.isDirectory, name: selectedEntry.name, mode: 'cut' });
        setStatusMessage(`Cut ${selectedEntry.name}.`);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && clipboardEntry) {
        event.preventDefault();
        const pasteTarget = selectedEntry || { path: project.path, isDirectory: true };
        const targetDir = pasteTarget.isDirectory ? pasteTarget.path : getParentDirectory(pasteTarget.path);
        handlePasteInto({ path: targetDir, isDirectory: true, name: getName(targetDir) });
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
  }, [activeTabDirty, clipboardEntry, handlePasteInto, project?.path, selectedEntry]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!hasDirtyTabs) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasDirtyTabs]);

  const refreshTree = useCallback(async () => {
    const root = await loadDirectory(project.path);
    setRootItems(root);
  }, [loadDirectory, project?.path]);

  const handleSelectNode = useCallback((node) => {
    setSelectedEntry(node);
    setSelectedPath(node.path);
  }, []);

  const toggleDirectory = useCallback((dirPath) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  const remapPaths = useCallback((oldPath, nextPath) => {
    setSelectedPath((prev) => updatePathPrefix(prev, oldPath, nextPath));
    setSelectedEntry((prev) => prev ? { ...prev, path: updatePathPrefix(prev.path, oldPath, nextPath), name: getName(updatePathPrefix(prev.path, oldPath, nextPath)) } : prev);
    setTabs((prev) => prev.map((tab) => {
      const remappedPath = updatePathPrefix(tab.path, oldPath, nextPath);
      if (remappedPath === tab.path) return tab;
      return { ...tab, id: remappedPath, path: remappedPath, name: getName(remappedPath) };
    }));
    setActiveTabId((prev) => updatePathPrefix(prev, oldPath, nextPath));
    setExpandedPaths((prev) => {
      const next = new Set();
      prev.forEach((value) => next.add(updatePathPrefix(value, oldPath, nextPath)));
      return next;
    });
    setClipboardEntry((prev) => prev ? { ...prev, path: updatePathPrefix(prev.path, oldPath, nextPath) } : prev);
  }, []);

  const openPreview = useCallback(async (filePath) => {
    setSelectedPath(filePath);
    setSelectedEntry({ path: filePath, name: getName(filePath), isDirectory: false });
    const result = await window.electronAPI.fs.readFile(filePath);
    if (!result.success) {
      setStatusMessage(result.error || 'Could not open file.');
      return;
    }

    setTabs((prev) => {
      const existing = prev.find((tab) => tab.id === result.path);
      if (existing) {
        return prev.map((tab) => tab.id === result.path
          ? { ...tab, ...makeTab(result), draftContent: tab.draftContent ?? result.content, savedContent: result.content }
          : tab);
      }
      return [...prev, makeTab(result)];
    });
    setActiveTabId(result.path);
    setStatusMessage('');
  }, []);

  useEffect(() => {
    const pendingState = hydratedProjectRef.current;
    if (!project?.path || !pendingState) return;

    hydratedProjectRef.current = null;
    const openTabPaths = pendingState.openTabPaths || [];
    if (pendingState.selectedPath) setSelectedPath(pendingState.selectedPath);

    if (openTabPaths.length > 0) {
      Promise.all(openTabPaths.map((tabPath) => window.electronAPI.fs.readFile(tabPath)))
        .then((results) => {
          const validTabs = results.filter((result) => result.success).map(makeTab);
          setTabs(validTabs);
          setActiveTabId(validTabs.some((tab) => tab.id === pendingState.activeTabId)
            ? pendingState.activeTabId
            : validTabs[0]?.id || null);
        })
        .catch(() => {});
    }
  }, [project?.path]);

  const openExternal = useCallback((filePath) => {
    window.electronAPI.fs.openFile(filePath);
  }, []);

  const revealFolder = useCallback((folderPath) => {
    window.electronAPI.fs.openFolder(folderPath);
  }, []);

  const openCreateAction = useCallback((type, node = null) => {
    const fallbackNode = node || selectedEntry;
    const targetDir = fallbackNode ? (fallbackNode.isDirectory ? fallbackNode.path : getParentDirectory(fallbackNode.path)) : project.path;
    setModalAction({ type, targetDir, node });
    setContextMenu(null);
  }, [project?.path, selectedEntry]);

  const openRenameAction = useCallback((node) => {
    setRenamingPath(node.path);
    setRenamingValue(node.name);
    setContextMenu(null);
  }, []);

  const openDeleteAction = useCallback((node) => {
    setModalAction({ type: 'delete', targetDir: getParentDirectory(node.path), node });
    setContextMenu(null);
  }, []);

  const handleContextMenu = useCallback((event, node) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  }, []);

  const handleRootContextMenu = useCallback((event) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, node: { name: project.name, path: project.path, isDirectory: true, isRoot: true } });
  }, [project?.name, project?.path]);

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
  }, [remapPaths, refreshTree, renamingPath, renamingValue]);

  const cancelInlineRename = useCallback(() => {
    setRenamingPath(null);
    setRenamingValue('');
  }, []);

  const handleConfirmModal = useCallback(async (value) => {
    if (!modalAction) return;
    let result;
    if (modalAction.type === 'new-file') result = await window.electronAPI.fs.createFile(modalAction.targetDir, value);
    if (modalAction.type === 'new-folder') result = await window.electronAPI.fs.createFolder(modalAction.targetDir, value);
    if (modalAction.type === 'rename') result = await window.electronAPI.fs.renameEntry(modalAction.node.path, value);
    if (modalAction.type === 'delete') result = await window.electronAPI.fs.deleteEntry(modalAction.node.path);

    if (!result?.success) {
      setStatusMessage(result?.error || 'Action failed.');
      return;
    }

    if (modalAction.type === 'rename') remapPaths(result.oldPath, result.path);

    if (modalAction.type === 'delete') {
      setTabs((prev) => prev.filter((tab) => !tab.path.startsWith(modalAction.node.path)));
      setActiveTabId((prev) => (prev && prev.startsWith(modalAction.node.path) ? null : prev));
      setSelectedPath((prev) => (prev && prev.startsWith(modalAction.node.path) ? null : prev));
      setSelectedEntry((prev) => (prev && prev.path.startsWith(modalAction.node.path) ? null : prev));
    }

    await refreshTree();
    setModalAction(null);
    setStatusMessage(modalAction.type === 'delete' ? 'Deleted successfully.' : modalAction.type === 'rename' ? 'Renamed successfully.' : 'Created successfully.');
    if (modalAction.type === 'new-file' && result.path) await openPreview(result.path);
  }, [modalAction, openPreview, refreshTree, remapPaths]);

  const saveActiveTab = useCallback(async () => {
    if (!activeTab || activeTab.type !== 'text') return;
    const result = await window.electronAPI.fs.writeFile(activeTab.path, activeTab.draftContent ?? '');
    if (!result.success) {
      setStatusMessage(result.error || 'Save failed.');
      return;
    }

    setTabs((prev) => prev.map((tab) => tab.id === activeTab.id ? { ...tab, savedContent: tab.draftContent, content: tab.draftContent } : tab));
    setStatusMessage('Saved.');
  }, [activeTab]);

  const handleDropMove = useCallback(async (sourcePath, targetDir) => {
    setDropTargetPath(null);
    setDragSourcePath(null);
    if (!sourcePath || !targetDir || getParentDirectory(sourcePath) === targetDir) return;

    const result = await window.electronAPI.fs.moveEntry(sourcePath, targetDir);
    if (!result.success) {
      setStatusMessage(result.error || 'Move failed.');
      return;
    }

    remapPaths(result.oldPath, result.path);
    await refreshTree();
    setStatusMessage(`Moved ${getName(result.oldPath)} into ${getName(targetDir)}.`);
  }, [refreshTree, remapPaths]);

  const handleCopyEntry = useCallback((node) => {
    setClipboardEntry({ path: node.path, isDirectory: node.isDirectory, name: node.name, mode: 'copy' });
    setContextMenu(null);
    setStatusMessage(`Copied ${node.name}.`);
  }, []);

  const handleCutEntry = useCallback((node) => {
    setClipboardEntry({ path: node.path, isDirectory: node.isDirectory, name: node.name, mode: 'cut' });
    setContextMenu(null);
    setStatusMessage(`Cut ${node.name}.`);
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
    setTabs((prev) => {
      const remaining = prev.filter((item) => item.id !== tabId);
      setActiveTabId((currentActive) => {
        if (currentActive !== tabId) return currentActive;
        return remaining[remaining.length - 1]?.id || null;
      });
      return remaining;
    });
  }, []);

  const closeTab = useCallback((tabId) => {
    const targetTab = tabs.find((tab) => tab.id === tabId);
    const isDirty = targetTab?.type === 'text' && targetTab.draftContent !== targetTab.savedContent;
    if (isDirty) {
      setConfirmState({
        message: `Close ${targetTab.name} without saving?`,
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
      { id: 'rename', label: 'Rename', onClick: () => openRenameAction(node), hidden: node.isRoot },
      { id: 'copy', label: 'Copy', onClick: () => handleCopyEntry(node), hidden: node.isRoot },
      { id: 'cut', label: 'Cut', onClick: () => handleCutEntry(node), hidden: node.isRoot },
      { id: 'paste', label: 'Paste Into', onClick: () => handlePasteInto(node), disabled: !clipboardEntry },
      { id: 'duplicate', label: 'Duplicate', onClick: () => handleDuplicateEntry(node), hidden: node.isRoot },
      { id: 'reveal', label: 'Open in Explorer', onClick: () => revealFolder(node.isDirectory ? node.path : getParentDirectory(node.path)) },
      { id: 'open', label: 'Open File', onClick: () => openExternal(node.path), hidden: node.isDirectory },
      { id: 'delete', label: 'Delete', danger: true, onClick: () => openDeleteAction(node), hidden: node.isRoot },
    ].filter((item) => !item.hidden);
  }, [clipboardEntry, contextMenu, handleCopyEntry, handleCutEntry, handleDuplicateEntry, handlePasteInto, openCreateAction, openDeleteAction, openExternal, openRenameAction, revealFolder]);

  useEffect(() => {
    if (!activeTab || activeTab.type !== 'text' || !showDiff) {
      setHighlightedContent('');
      setSavedHighlightedContent('');
      return;
    }

    let cancelled = false;
    import('../utils/highlightCode').then(({ highlightCode }) => {
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
          <input
            className="file-explorer__search"
            type="text"
            placeholder="Search files and content..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {clipboardEntry && <div className="file-explorer__clipboard">Clipboard ({clipboardEntry.mode}): {clipboardEntry.name}</div>}
          {dragSourcePath && <div className="file-explorer__drag-hint">Dragging: {getName(dragSourcePath)}</div>}
        </div>

        <div className="file-explorer__root" onContextMenu={handleRootContextMenu}>
          <button className="file-explorer__root-row" type="button" title={project.path} onClick={() => { setSelectedEntry({ name: project.name, path: project.path, isDirectory: true, isRoot: true }); setSelectedPath(project.path); toggleDirectory(project.path); }}>
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
              rootItems.map((item) => (
                <TreeNode
                  key={item.path}
                  node={item}
                  depth={0}
                  activePath={selectedPath}
                  expandedPaths={expandedPaths}
                  loadDirectory={loadDirectory}
                  toggleDirectory={toggleDirectory}
                  onSelectNode={handleSelectNode}
                  onPreviewFile={openPreview}
                  onOpenExternal={openExternal}
                  onContextMenu={handleContextMenu}
                  onDropMove={handleDropMove}
                  onDragStartPath={(path, isHoverOnly = false) => {
                    if (isHoverOnly) setDropTargetPath(path);
                    else setDragSourcePath(path);
                  }}
                  onDragEndPath={() => {
                    setDragSourcePath(null);
                    setDropTargetPath(null);
                  }}
                  dropTargetPath={dropTargetPath}
                  renamingPath={renamingPath}
                  renamingValue={renamingValue}
                  onRenameChange={setRenamingValue}
                  onRenameSubmit={submitInlineRename}
                  onRenameCancel={cancelInlineRename}
                />
              ))
            )}
          </div>
        </div>
      </aside>

      <section className="file-explorer__workspace">
        <div className="file-explorer__editor-shell">
          {dirtyTabs.length > 0 && (
            <div className="file-explorer__changes-bar">
              <span className="file-explorer__changes-title">Unsaved</span>
              <div className="file-explorer__changes-list">
                {dirtyTabs.map((tab) => (
                  <button key={`dirty:${tab.id}`} className="file-explorer__changes-item" type="button" onClick={() => setActiveTabId(tab.id)}>
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
                  onClick={() => setActiveTabId(tab.id)}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('application/tab-id', tab.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => reorderTabs(event.dataTransfer.getData('application/tab-id'), tab.id)}
                >
                  <span className="file-explorer__tab-name">{tab.name}</span>
                  {dirty && <span className="file-explorer__tab-dirty" />}
                  <button className="file-explorer__tab-close" type="button" onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}>×</button>
                </div>
              );
            })}
          </div>

          {!activeTab ? (
            <div className="file-explorer__workspace-card">
              <h2 className="file-explorer__workspace-title">Project Explorer</h2>
              <p className="file-explorer__workspace-text">Search inside files, copy and paste entries, duplicate files, drag items between folders, and edit text files with inline syntax highlighting.</p>
              <p className="file-explorer__workspace-path">{project.path}</p>
              {statusMessage && <p className="file-explorer__status">{statusMessage}</p>}
            </div>
          ) : (
            <div className="file-explorer__preview">
              <div className="file-explorer__preview-header">
                <div>
                  <h2 className="file-explorer__workspace-title">{activeTab.name}</h2>
                  <p className="file-explorer__workspace-path">{activeTab.path}</p>
                </div>
                <div className="file-explorer__preview-actions">
                  <span className="file-explorer__meta-pill">{activeTab.extension || 'no ext'}</span>
                  <span className="file-explorer__meta-pill">{formatBytes(activeTab.size)}</span>
                  {activeTab.type === 'text' && <button className="btn btn--small" type="button" onClick={() => setShowDiff((value) => !value)}>{showDiff ? 'Editor' : 'Diff'}</button>}
                  {activeTab.type === 'text' && <button className="btn btn--small btn--primary file-explorer__save-btn" type="button" onClick={saveActiveTab}>Save</button>}
                  <button className="btn btn--small" type="button" onClick={() => openExternal(activeTab.path)}>Open</button>
                  <button className="btn btn--small" type="button" onClick={() => revealFolder(getParentDirectory(activeTab.path))}>Reveal</button>
                </div>
              </div>
              <div className="file-explorer__preview-body">
                {activeTab.type === 'image' ? (
                  <div className="file-explorer__image-wrap">
                    <img className="file-explorer__image" src={activeTab.content} alt={activeTab.name} />
                  </div>
                ) : showDiff ? (
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
                      extension={activeTab.extension}
                      value={activeTab.draftContent ?? ''}
                      onChange={(value) => setTabs((prev) => prev.map((tab) => tab.id === activeTab.id ? { ...tab, draftContent: value } : tab))}
                    />
                  </Suspense>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {contextMenu && (
        <div className="file-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {contextActions.map((action) => (
            <button
              key={action.id}
              className={`file-context-menu__item ${action.danger ? 'file-context-menu__item--danger' : ''}`}
              type="button"
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      <ActionModal action={modalAction} onClose={() => setModalAction(null)} onConfirm={handleConfirmModal} />
      <ConfirmModal state={confirmState} onCancel={() => setConfirmState(null)} onConfirm={() => confirmState?.onConfirm?.()} />
    </div>
  );
}
