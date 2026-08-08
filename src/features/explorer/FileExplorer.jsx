import { forwardRef, useState, useEffect, useCallback, useImperativeHandle, useMemo } from 'react';
import { useStatusMessage } from './useStatusMessage';
import './FileExplorer.css';
import { ExplorerContextMenu } from './ExplorerContextMenu';
import { ExplorerGitPanel } from './ExplorerGitPanel';
import { ActionModal, ConfirmModal } from './ExplorerModals';
import { ExplorerTree } from './ExplorerTree';
import { useExplorerPersistence } from './useExplorerPersistence';
import { useExplorerDragAndDrop } from './useExplorerDragAndDrop';
import { useExplorerKeyboardShortcuts } from './useExplorerKeyboardShortcuts';
import { ExplorerWorkspace, prefetchCodeEditor } from './ExplorerWorkspace';
import { isStagedCode } from './explorerUtils';
import { useExplorerActions } from './useExplorerActions';
import { useExplorerTabs } from './useExplorerTabs';
import { useExplorerTreeState } from './useExplorerTreeState';
import { useI18n } from '../../i18n/I18nContext';
import { resolveDirtyTabTransition } from './dirtyTabTransition.mjs';

const FileExplorer = forwardRef(function FileExplorer({ project }, ref) {
  const { t } = useI18n();
  const [rootItems, setRootItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dragState, setDragState] = useState(null);
  const [dropTargetPath, setDropTargetPath] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ files: [], contentMatches: [] });
  const [isSearching, setIsSearching] = useState(false);
  const [highlightedContent, setHighlightedContent] = useState('');
  const [savedHighlightedContent, setSavedHighlightedContent] = useState('');
  const [gitStatus, setGitStatus] = useState([]);
  const [gitStatusError, setGitStatusError] = useState('');
  const {
    statusMessage: tabStatusMessage,
    statusTone: tabStatusTone,
    setStatusMessage: setTabStatusMessage,
  } = useStatusMessage();

  const loadFile = useCallback((filePath) => {
    return window.electronAPI.fs.readFile(project.path, filePath);
  }, [project.path]);

  const loadDirectory = useCallback(async (dirPath) => {
    const items = await window.electronAPI.fs.readDir(project.path, dirPath);
    treeState.setDirectoryCache((prev) => ({ ...prev, [dirPath]: items }));
    return items;
  }, [project.path]);

  const treeState = useExplorerTreeState({ projectPath: project.path, loadDirectory });

  const loadGitStatus = useCallback(async () => {
    if (!project?.path) return;
    const result = await window.electronAPI.fs.gitStatus(project.path);
    if (!result.success) {
      setGitStatus([]);
      setGitStatusError(result.error || t('explorer.noRepository'));
      return;
    }
    setGitStatus(result.entries || []);
    setGitStatusError('');
  }, [project?.path, t]);

  const tabsState = useExplorerTabs({
    projectPath: project.path,
    loadFile,
    loadGitStatus,
    setStatusMessage: setTabStatusMessage,
    t,
  });

  useImperativeHandle(ref, () => ({
    async prepareToLeave() {
      if (!tabsState.hasDirtyTabs) return true;
      const choice = await window.electronAPI.dialog.confirmDirtyTabs(tabsState.dirtyTabs.map((tab) => tab.name));
      return resolveDirtyTabTransition(choice, { save: tabsState.saveDirtyTabs, discard: tabsState.discardDirtyTabs });
    },
  }), [tabsState.dirtyTabs, tabsState.discardDirtyTabs, tabsState.hasDirtyTabs, tabsState.saveDirtyTabs]);

  const remapPaths = useCallback((oldPath, nextPath) => {
    treeState.remapTreePaths(oldPath, nextPath);
    tabsState.remapTabPaths(oldPath, nextPath);
  }, [tabsState, treeState]);

  const refreshTree = useCallback(async () => {
    if (!project?.path) return;
    const root = await loadDirectory(project.path);
    setRootItems(root);
    await Promise.all(Array.from(treeState.expandedPaths).filter((entryPath) => entryPath !== project.path).map((entryPath) => loadDirectory(entryPath)));
    await loadGitStatus();
  }, [loadDirectory, loadGitStatus, project?.path, treeState.expandedPaths]);

  const actions = useExplorerActions({
    t,
    project,
    selectedEntry: treeState.selectedEntry,
    selectedPaths: treeState.selectedPaths,
    setSelectedPaths: treeState.setSelectedPaths,
    setSelectedEntry: treeState.setSelectedEntry,
    refreshTree,
    loadGitStatus,
    remapPaths,
    openPreview: (path) => tabsState.openPreview(path, treeState.setSelectedPaths, treeState.setSelectedEntry),
    removeTabsForPaths: tabsState.removeTabsForPaths,
    setRenamingPath: treeState.setRenamingPath,
    setRenamingValue: treeState.setRenamingValue,
  });

  useEffect(() => {
    if (!project?.path) return;
    let cancelled = false;

    const initWorkspace = async () => {
      setIsLoading(true);
      loadDirectory(project.path).then((items) => {
        if (cancelled) return;
        setRootItems(items);
        setIsLoading(false);
        loadGitStatus();
      });
    };

    initWorkspace();
    return () => {
      cancelled = true;
    };
  }, [loadDirectory, loadGitStatus, project?.path]);

  const resetWorkspace = useCallback((persisted) => {
    treeState.resetTreeState(persisted);
    tabsState.resetTabsState(persisted);
    actions.setContextMenu(null);
    actions.setModalAction(null);
    actions.setStatusMessage('');
    setTabStatusMessage('');
    setDragState(null);
    setDropTargetPath(null);
    actions.setClipboardEntry(null);
    setSearchQuery('');
    setSearchResults({ files: [], contentMatches: [] });
    setIsSearching(false);
    setHighlightedContent('');
    setSavedHighlightedContent('');
  }, [actions, tabsState, treeState]);

  useExplorerPersistence({
    projectPath: project?.path,
    expandedPaths: treeState.expandedPaths,
    selectedPaths: treeState.selectedPaths,
    tabs: tabsState.tabs,
    paneTabs: tabsState.paneTabs,
    splitView: tabsState.splitView,
    resetWorkspace,
    setExpandedPaths: treeState.setExpandedPaths,
    setSelectedPaths: treeState.setSelectedPaths,
    setTabs: tabsState.setTabs,
    setPaneTabs: tabsState.setPaneTabs,
    loadFile,
  });

  useEffect(() => { prefetchCodeEditor(); }, []);

  useEffect(() => {
    if (!actions.contextMenu) return undefined;
    const close = () => actions.setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [actions]);

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
    if (!tabsState.activeTab || tabsState.activeTab.type !== 'text' || !tabsState.showDiff) {
      setHighlightedContent('');
      setSavedHighlightedContent('');
      return;
    }
    let cancelled = false;
    import('../../utils/highlightCode').then(({ highlightCode }) => {
      if (cancelled) return;
      setHighlightedContent(highlightCode(tabsState.activeTab.draftContent ?? '', tabsState.activeTab.extension));
      setSavedHighlightedContent(highlightCode(tabsState.activeTab.savedContent ?? '', tabsState.activeTab.extension));
    }).catch(() => {
      if (cancelled) return;
      setHighlightedContent(tabsState.activeTab.draftContent ?? '');
      setSavedHighlightedContent(tabsState.activeTab.savedContent ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [tabsState.activeTab, tabsState.showDiff]);

  const onScheduleTarget = useCallback((targetPath) => {
    setDropTargetPath(targetPath);
    treeState.scheduleDirectoryExpand(targetPath);
  }, [treeState]);

  const handleDragStartNode = useCallback((node, x, y) => {
    setDragState({ sourcePath: node.path, name: node.name, x, y });
  }, []);

  useExplorerDragAndDrop({
    dragState,
    dropTargetPath,
    setDragState,
    setDropTargetPath,
    clearDirectoryExpandSchedule: treeState.clearDirectoryExpandSchedule,
    handleDropMove: actions.handleDropMove,
    onScheduleTarget,
  });

  useExplorerKeyboardShortcuts({
    t,
    activeTabDirty: tabsState.activeTabDirty,
    clipboardEntry: actions.clipboardEntry,
    setClipboardEntry: actions.setClipboardEntry,
    setStatusMessage: actions.setStatusMessage,
    selectedPaths: treeState.selectedPaths,
    selectedEntry: treeState.selectedEntry,
    projectPath: project?.path,
    handlePasteInto: actions.handlePasteInto,
    setRenamingPath: treeState.setRenamingPath,
    setRenamingValue: treeState.setRenamingValue,
  });

  // Los mensajes de acciones y los de pestanas comparten una sola voz.
  // El de acciones tiene prioridad: es el que responde a lo que acabas de hacer.
  const currentStatus = actions.statusMessage || tabStatusMessage || '';
  const currentTone = actions.statusMessage ? actions.statusTone : tabStatusTone;

  const stagedEntries = useMemo(() => gitStatus.filter((entry) => isStagedCode(entry.code)), [gitStatus]);
  const showSearch = searchQuery.trim().length >= 2;
  const openPreview = useCallback((path) => tabsState.openPreview(path, treeState.setSelectedPaths, treeState.setSelectedEntry), [tabsState, treeState.setSelectedEntry, treeState.setSelectedPaths]);
  const selectNodeWithRoot = useCallback((node, event) => treeState.selectNode(node, event, rootItems), [rootItems, treeState]);
  const submitInlineRename = useCallback((node) => actions.submitInlineRename(node, treeState.renamingPath, treeState.renamingValue, () => {
    treeState.setRenamingPath(null);
    treeState.setRenamingValue('');
  }), [actions, treeState]);

  return (
    <div className="file-explorer">
      {/*
        Dos regiones vivas, no una: `aria-live` no se puede cambiar en caliente
        de forma confiable, asi que el mensaje va a la que corresponde segun su
        severidad. Un error interrumpe; una confirmacion espera su turno.

        Ambas estan montadas siempre, aunque esten vacias: si aparecieran recien
        con el primer mensaje, el lector de pantalla se perderia ese anuncio.
        Los mensajes visibles quedan aria-hidden para no anunciarse dos veces.
      */}
      <p className="sr-only" role="status" aria-live="polite">
        {currentTone === 'error' ? '' : currentStatus}
      </p>
      <p className="sr-only" role="alert" aria-live="assertive">
        {currentTone === 'error' ? currentStatus : ''}
      </p>

      <aside className="file-explorer__sidebar">
        <div className="file-explorer__header">
          <span className="file-explorer__eyebrow">{t('explorer.title')}</span>
          <div className="file-explorer__actions">
            <button className="file-explorer__icon-btn" type="button" title={t('explorer.newFile')} aria-label={t('explorer.newFile')} onClick={() => actions.openCreateAction('new-file')}>
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.5 1.75a.75.75 0 0 0-1.5 0v5h-5a.75.75 0 0 0 0 1.5h5v5a.75.75 0 0 0 1.5 0v-5h5a.75.75 0 0 0 0-1.5h-5v-5z"/></svg>
            </button>
            <button className="file-explorer__icon-btn" type="button" title={t('explorer.newFolder')} aria-label={t('explorer.newFolder')} onClick={() => actions.openCreateAction('new-folder')}>
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 2A1.75 1.75 0 0 0 0 3.75v6.5C0 11.216.784 12 1.75 12h5.5a.75.75 0 0 0 0-1.5h-5.5a.25.25 0 0 1-.25-.25v-6.5A.25.25 0 0 1 1.75 3.5h2.534a.25.25 0 0 1 .177.073l1.216 1.216A1.75 1.75 0 0 0 6.914 5.3H10.25a.25.25 0 0 1 .25.25V7a.75.75 0 0 0 1.5 0V5.55A1.75 1.75 0 0 0 10.25 3.8H6.914a.25.25 0 0 1-.177-.073L5.52 2.51A1.75 1.75 0 0 0 4.284 2H1.75z"/><path d="M12.25 8.5a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5H13v1.5a.75.75 0 0 1-1.5 0V12.25H10a.75.75 0 0 1 0-1.5h1.5v-1.5a.75.75 0 0 1 .75-.75z"/></svg>
            </button>
            <button className="file-explorer__icon-btn" type="button" title={t('explorer.refreshTree')} aria-label={t('explorer.refreshTree')} onClick={refreshTree}>
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.917.5.5 0 1 0-.908.418A4 4 0 1 1 8 4c1.226 0 2.324.55 3.058 1.416H9.5a.5.5 0 0 0 0 1H12a.5.5 0 0 0 .5-.5V3.5a.5.5 0 0 0-1 0v1.163A4.982 4.982 0 0 0 8 3z"/></svg>
            </button>
            <button className="file-explorer__icon-btn" type="button" title={t('explorer.openProjectFolder')} aria-label={t('explorer.openProjectFolder')} onClick={() => actions.revealFolder(project.path)}>
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 3A1.75 1.75 0 0 0 0 4.75v6.5C0 12.216.784 13 1.75 13h8.5A1.75 1.75 0 0 0 12 11.25V5.5h2.793l-2.147 2.146a.5.5 0 1 0 .708.708l3-3a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L14.793 4.5H12v-.75A1.75 1.75 0 0 0 10.25 2h-3.5L5.646.896A1.75 1.75 0 0 0 4.409.25H1.75z"/></svg>
            </button>
          </div>
        </div>

        <div className="file-explorer__search-wrap">
          <input
            className="file-explorer__search"
            type="search"
            aria-label={t('explorer.search')}
            placeholder={t('explorer.search')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape' && searchQuery) { event.stopPropagation(); setSearchQuery(''); } }}
          />
          {/* Salir de la busqueda exigia borrar letra por letra. */}
          {searchQuery && (
            <button
              type="button"
              className="file-explorer__search-clear"
              aria-label={t('explorer.clearSearch')}
              title={t('explorer.clearSearch')}
              onClick={() => setSearchQuery('')}
            >
              &times;
            </button>
          )}
          {actions.clipboardEntry && <div className="file-explorer__clipboard">{t('explorer.clipboard', actions.clipboardEntry)}</div>}
          {dragState && <div className="file-explorer__drag-hint">{t('explorer.dragging', dragState)}</div>}
          {treeState.selectedPaths.length > 1 && <div className="file-explorer__multi-count">{t('explorer.selected', { count: treeState.selectedPaths.length })}</div>}
        </div>

        <ExplorerTree
          project={project}
          onDeleteNode={actions.openDeleteAction}
          onContextMenuKey={(event, node) => actions.handleContextMenu(event, node, selectNodeWithRoot)}
          dropTargetPath={dropTargetPath}
          expandedPaths={treeState.expandedPaths}
          selectedPaths={treeState.selectedPaths}
          directoryCache={treeState.directoryCache}
          renamingPath={treeState.renamingPath}
          renamingValue={treeState.renamingValue}
          setSelectedEntry={treeState.setSelectedEntry}
          setSelectedPaths={treeState.setSelectedPaths}
          toggleDirectory={treeState.toggleDirectory}
          handleRootContextMenu={actions.handleRootContextMenu}
          showSearch={showSearch}
          isSearching={isSearching}
          searchResults={searchResults}
          searchQuery={searchQuery}
          openPreview={openPreview}
          isLoading={isLoading}
          rootItems={rootItems}
          setRenamingValue={treeState.setRenamingValue}
          submitInlineRename={submitInlineRename}
          setRenamingPath={treeState.setRenamingPath}
          selectNode={selectNodeWithRoot}
          openExternal={actions.openExternal}
          handleContextMenu={(event, node) => actions.handleContextMenu(event, node, selectNodeWithRoot)}
          scheduleDirectoryExpand={treeState.scheduleDirectoryExpand}
          clearDirectoryExpandSchedule={treeState.clearDirectoryExpandSchedule}
          handleDragStartNode={handleDragStartNode}
          dragState={dragState}
        />

        <ExplorerGitPanel
          gitStatus={gitStatus}
          gitStatusError={gitStatusError}
          stagedEntries={stagedEntries}
          loadGitStatus={loadGitStatus}
          openCommitAction={actions.openCommitAction}
          openPreview={openPreview}
          handleGitStageToggle={actions.handleGitStageToggle}
          projectPath={project.path}
        />
      </aside>

      <ExplorerWorkspace
        dirtyTabs={tabsState.dirtyTabs}
        activePane={tabsState.activePane}
        setPaneTabs={tabsState.setPaneTabs}
        tabs={tabsState.tabs}
        activeTabId={tabsState.activeTabId}
        closeTab={tabsState.closeTab}
        reorderTabs={tabsState.reorderTabs}
        moveTabBy={tabsState.moveTabBy}
        splitView={tabsState.splitView}
        setSplitView={tabsState.setSplitView}
        activeTab={tabsState.activeTab}
        projectPath={project.path}
        statusMessage={currentStatus}
        statusTone={currentTone}
        paneTabs={tabsState.paneTabs}
        setActivePane={tabsState.setActivePane}
        showDiff={tabsState.showDiff}
        setShowDiff={tabsState.setShowDiff}
        saveActiveTab={tabsState.saveActiveTab}
        openExternal={actions.openExternal}
        revealFolder={actions.revealFolder}
        savedHighlightedContent={savedHighlightedContent}
        highlightedContent={highlightedContent}
        setTabs={tabsState.setTabs}
      />

      <ExplorerContextMenu
        contextMenu={actions.contextMenu}
        actions={actions.contextActions}
        onClose={() => actions.setContextMenu(null)}
      />
      <ActionModal action={actions.modalAction} onClose={() => actions.setModalAction(null)} onConfirm={actions.handleConfirmModal} />
      <ConfirmModal state={tabsState.confirmState} onCancel={() => tabsState.setConfirmState(null)} onConfirm={() => tabsState.confirmState?.onConfirm?.()} />
      {dragState && (
        <div className="file-explorer__drag-overlay" style={{ left: dragState.x + 14, top: dragState.y + 14 }}>
          {t('explorer.moving', dragState)}
        </div>
      )}
    </div>
  );
});

export default FileExplorer;
