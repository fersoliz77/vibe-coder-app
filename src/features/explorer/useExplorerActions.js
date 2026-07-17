import { useCallback, useMemo, useState } from 'react';
import { getName, getParentDirectory, isStagedCode } from './explorerUtils';

export function useExplorerActions({
  t,
  project,
  selectedEntry,
  selectedPaths,
  setSelectedPaths,
  setSelectedEntry,
  refreshTree,
  loadGitStatus,
  remapPaths,
  openPreview,
  removeTabsForPaths,
  setRenamingPath,
  setRenamingValue,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [modalAction, setModalAction] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [clipboardEntry, setClipboardEntry] = useState(null);

  const openExternal = useCallback((filePath) => {
    window.electronAPI.fs.openFile(project.path, filePath);
  }, [project.path]);

  const revealFolder = useCallback((folderPath) => {
    window.electronAPI.fs.openFolder(project.path, folderPath);
  }, [project.path]);

  const openCreateAction = useCallback((type, node = null) => {
    const target = node || selectedEntry;
    const targetDir = target ? (target.isDirectory ? target.path : getParentDirectory(target.path)) : project.path;
    setModalAction({ type, targetDir, node: target });
    setContextMenu(null);
  }, [project.path, selectedEntry]);

  const openDeleteAction = useCallback((node) => {
    if (selectedPaths.length > 1 && selectedPaths.includes(node.path)) {
      setModalAction({ type: 'bulk-delete', count: selectedPaths.length });
    } else {
      setModalAction({ type: 'delete', node });
    }
    setContextMenu(null);
  }, [selectedPaths]);

  const submitInlineRename = useCallback(async (node, renamingPath, renamingValue, clearRename) => {
    const nextName = renamingValue.trim();
    if (!renamingPath || !nextName || nextName === node.name) {
      clearRename();
      return;
    }
    const result = await window.electronAPI.fs.renameEntry(project.path, node.path, nextName);
    if (!result.success) {
      setStatusMessage(result.error || t('explorer.renameFailed'));
      return;
    }
    remapPaths(result.oldPath, result.path);
    clearRename();
    await refreshTree();
    setStatusMessage(t('explorer.renamed'));
  }, [project.path, refreshTree, remapPaths, t]);

  const handleContextMenu = useCallback((event, node, selectNodeWithRoot) => {
    event.preventDefault();
    selectNodeWithRoot(node, event);
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  }, []);

  const handleRootContextMenu = useCallback((event) => {
    event.preventDefault();
    const node = { name: project.name, path: project.path, isDirectory: true, isRoot: true };
    setSelectedEntry(node);
    setSelectedPaths([project.path]);
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  }, [project.name, project.path, setSelectedEntry, setSelectedPaths]);

  const handleConfirmModal = useCallback(async (value) => {
    if (!modalAction) return;
    let result;

    if (modalAction.type === 'new-file') result = await window.electronAPI.fs.createFile(project.path, modalAction.targetDir, value);
    if (modalAction.type === 'new-folder') result = await window.electronAPI.fs.createFolder(project.path, modalAction.targetDir, value);
    if (modalAction.type === 'delete') result = await window.electronAPI.fs.deleteEntry(project.path, modalAction.node.path);
    if (modalAction.type === 'git-commit') result = await window.electronAPI.fs.gitCommit(project.path, value);
    if (modalAction.type === 'bulk-delete') {
      const results = await Promise.all(selectedPaths.map((targetPath) => window.electronAPI.fs.deleteEntry(project.path, targetPath)));
      result = { success: results.every((entry) => entry.success) };
    }

    if (!result?.success) {
      setStatusMessage(result?.error || t('explorer.actionFailed'));
      return;
    }

    if (modalAction.type === 'delete' || modalAction.type === 'bulk-delete') {
      const targets = modalAction.type === 'bulk-delete' ? selectedPaths : [modalAction.node.path];
      removeTabsForPaths(targets);
      setSelectedPaths([]);
      setSelectedEntry(null);
    }

    await refreshTree();
    setModalAction(null);
    setStatusMessage(
      modalAction.type === 'bulk-delete' ? t('explorer.deletedSelected') :
      modalAction.type === 'delete' ? t('explorer.deleted') :
      modalAction.type === 'git-commit' ? t('explorer.commitCreated') :
      t('explorer.created')
    );
    if (modalAction.type === 'new-file' && result.path) {
      await openPreview(result.path);
    }
  }, [modalAction, openPreview, project.path, refreshTree, removeTabsForPaths, selectedPaths, setSelectedEntry, setSelectedPaths, t]);

  const handleGitStageToggle = useCallback(async (entry) => {
    const absolutePath = `${project.path}\\${String(entry.path || '').replace(/\//g, '\\')}`;
    const result = isStagedCode(entry.code)
      ? await window.electronAPI.fs.gitUnstage(project.path, absolutePath)
      : await window.electronAPI.fs.gitStage(project.path, absolutePath);

    if (!result.success) {
      setStatusMessage(result.error || t('explorer.gitActionFailed'));
      return;
    }

    await loadGitStatus();
    setStatusMessage(isStagedCode(entry.code) ? t('explorer.unstaged', entry) : t('explorer.staged', entry));
  }, [loadGitStatus, project.path, t]);

  const openCommitAction = useCallback(() => {
    setModalAction({ type: 'git-commit' });
  }, []);

  const handleDropMove = useCallback(async (sourcePath, targetDir) => {
    if (!sourcePath || !targetDir) return;
    if (getParentDirectory(sourcePath) === targetDir) return;
    const result = await window.electronAPI.fs.moveEntry(project.path, sourcePath, targetDir);
    if (!result.success) {
      setStatusMessage(result.error || t('explorer.moveFailed'));
      return;
    }
    remapPaths(result.oldPath, result.path);
    await refreshTree();
    setStatusMessage(t('explorer.movedInto', { name: getName(result.oldPath), target: getName(targetDir) }));
  }, [project.path, refreshTree, remapPaths, t]);

  const handleCopyEntry = useCallback((node, mode = 'copy') => {
    setClipboardEntry({ path: node.path, name: node.name, mode, isDirectory: node.isDirectory });
    setContextMenu(null);
    setStatusMessage(t(mode === 'cut' ? 'explorer.cut' : 'explorer.copied', node));
  }, [t]);

  const handlePasteInto = useCallback(async (node) => {
    if (!clipboardEntry) return;
    const targetDir = node.isDirectory ? node.path : getParentDirectory(node.path);
    const result = clipboardEntry.mode === 'cut'
      ? await window.electronAPI.fs.moveEntry(project.path, clipboardEntry.path, targetDir)
      : await window.electronAPI.fs.copyEntry(project.path, clipboardEntry.path, targetDir);
    if (!result.success) {
      setStatusMessage(result.error || t('explorer.pasteFailed'));
      return;
    }
    if (clipboardEntry.mode === 'cut') {
      remapPaths(result.oldPath, result.path);
      setClipboardEntry(null);
    }
    await refreshTree();
    setStatusMessage(t(clipboardEntry.mode === 'cut' ? 'explorer.movedInto' : 'explorer.pastedInto', { name: clipboardEntry.name, target: getName(targetDir) }));
    setContextMenu(null);
  }, [clipboardEntry, project.path, refreshTree, remapPaths, t]);

  const handleDuplicateEntry = useCallback(async (node) => {
    const result = await window.electronAPI.fs.duplicateEntry(project.path, node.path);
    if (!result.success) {
      setStatusMessage(result.error || t('explorer.duplicateFailed'));
      return;
    }
    await refreshTree();
    setStatusMessage(t('explorer.duplicated', node));
    setContextMenu(null);
  }, [project.path, refreshTree, t]);

  const contextActions = useMemo(() => {
    if (!contextMenu?.node) return [];
    const node = contextMenu.node;
    return [
      { id: 'new-file', label: t('explorer.newFileMenu'), onClick: () => openCreateAction('new-file', node) },
      { id: 'new-folder', label: t('explorer.newFolderMenu'), onClick: () => openCreateAction('new-folder', node) },
      { id: 'rename', label: t('explorer.rename'), onClick: () => { setRenamingPath(node.path); setRenamingValue(node.name); setContextMenu(null); }, hidden: node.isRoot },
      { id: 'copy', label: t('explorer.copy'), onClick: () => handleCopyEntry(node, 'copy'), hidden: node.isRoot },
      { id: 'cut', label: t('explorer.cutLabel'), onClick: () => handleCopyEntry(node, 'cut'), hidden: node.isRoot },
      { id: 'paste', label: t('explorer.pasteInto'), onClick: () => handlePasteInto(node), disabled: !clipboardEntry },
      { id: 'duplicate', label: t('explorer.duplicate'), onClick: () => handleDuplicateEntry(node), hidden: node.isRoot },
      { id: 'reveal', label: t('explorer.openInExplorer'), onClick: () => revealFolder(node.isDirectory ? node.path : getParentDirectory(node.path)) },
      { id: 'open', label: t('explorer.openFile'), onClick: () => openExternal(node.path), hidden: node.isDirectory },
      { id: 'delete', label: selectedPaths.length > 1 && selectedPaths.includes(node.path) ? t('explorer.deleteSelectedCount', { count: selectedPaths.length }) : t('explorer.delete'), danger: true, onClick: () => openDeleteAction(node), hidden: node.isRoot && selectedPaths.length <= 1 },
    ].filter((item) => !item.hidden);
  }, [clipboardEntry, contextMenu, handleCopyEntry, handleDuplicateEntry, handlePasteInto, openCreateAction, openDeleteAction, openExternal, revealFolder, selectedPaths, setRenamingPath, setRenamingValue, t]);

  return {
    contextMenu,
    setContextMenu,
    modalAction,
    setModalAction,
    statusMessage,
    setStatusMessage,
    clipboardEntry,
    setClipboardEntry,
    openExternal,
    revealFolder,
    openCreateAction,
    openDeleteAction,
    submitInlineRename,
    handleContextMenu,
    handleRootContextMenu,
    handleConfirmModal,
    handleGitStageToggle,
    openCommitAction,
    handleDropMove,
    handleCopyEntry,
    handlePasteInto,
    handleDuplicateEntry,
    contextActions,
  };
}
