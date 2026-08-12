import { useCallback, useMemo, useState } from 'react';
import { getName, makeTab } from './explorerUtils';

export function useExplorerTabs({ projectPath, loadFile, loadGitStatus, setStatusMessage, t }) {
  const [tabs, setTabs] = useState([]);
  const [paneTabs, setPaneTabs] = useState({ primary: null, secondary: null });
  const [activePane, setActivePane] = useState('primary');
  const [splitView, setSplitView] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [showDiff, setShowDiff] = useState(false);

  const activeTabId = paneTabs[activePane];
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const dirtyTabs = tabs.filter((tab) => tab.type === 'text' && tab.draftContent !== tab.savedContent);
  const activeTabDirty = activeTab?.type === 'text' && activeTab.draftContent !== activeTab.savedContent;
  const hasDirtyTabs = dirtyTabs.length > 0;

  const resetTabsState = useCallback((persisted) => {
    setTabs([]);
    setPaneTabs({ primary: null, secondary: null });
    setActivePane('primary');
    setSplitView(Boolean(persisted?.splitView));
    setConfirmState(null);
    setShowDiff(false);
  }, []);

  const openPreview = useCallback(async (filePath, setSelectedPaths, setSelectedEntry) => {
    setSelectedPaths?.([filePath]);
    setSelectedEntry?.({ path: filePath, name: getName(filePath), isDirectory: false });
    const result = await loadFile(filePath);
    if (!result.success) {
      setStatusMessage(result.error || t('explorer.openFileFailed'), 'error');
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
  }, [activePane, loadFile, setStatusMessage, t]);

  const saveActiveTab = useCallback(async () => {
    if (!activeTab || activeTab.type !== 'text') return;
    const result = await window.electronAPI.fs.writeFile(projectPath, activeTab.path, activeTab.draftContent ?? '');
    if (!result.success) {
      setStatusMessage(result.error || t('explorer.saveFailed'), 'error');
      return;
    }
    setTabs((prev) => prev.map((tab) => tab.id === activeTab.id ? { ...tab, savedContent: tab.draftContent, content: tab.draftContent } : tab));
    setStatusMessage(t('explorer.savedStatus'));
    await loadGitStatus();
  }, [activeTab, loadGitStatus, projectPath, setStatusMessage, t]);

  const saveDirtyTabs = useCallback(async () => {
    for (const tab of dirtyTabs) {
      const result = await window.electronAPI.fs.writeFile(projectPath, tab.path, tab.draftContent ?? '');
      if (!result.success) {
        setStatusMessage(result.error || t('explorer.saveFailed'), 'error');
        return false;
      }
    }
    setTabs((prev) => prev.map((tab) => tab.type === 'text' && tab.draftContent !== tab.savedContent
      ? { ...tab, savedContent: tab.draftContent, content: tab.draftContent }
      : tab));
    await loadGitStatus();
    return true;
  }, [dirtyTabs, loadGitStatus, projectPath, setStatusMessage, t]);

  const discardDirtyTabs = useCallback(() => {
    setTabs((prev) => prev.map((tab) => tab.type === 'text' && tab.draftContent !== tab.savedContent
      ? { ...tab, draftContent: tab.savedContent, content: tab.savedContent }
      : tab));
  }, []);

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
        message: t('explorer.closeWithoutSaving', target),
        onConfirm: () => {
          closeTabImmediate(tabId);
          setConfirmState(null);
        },
      });
      return;
    }
    closeTabImmediate(tabId);
  }, [closeTabImmediate, tabs, t]);

  // Mueve una pestana un lugar. Es el equivalente por teclado del arrastre,
  // que hasta ahora solo existia con mouse.
  const moveTabBy = useCallback((tabId, direction) => {
    setTabs((prev) => {
      const from = prev.findIndex((tab) => tab.id === tabId);
      const to = from + direction;
      if (from === -1 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

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

  const removeTabsForPaths = useCallback((targets) => {
    setTabs((prev) => prev.filter((tab) => !targets.some((targetPath) => tab.path.startsWith(targetPath))));
    setPaneTabs((prev) => ({
      primary: targets.some((targetPath) => prev.primary?.startsWith(targetPath)) ? null : prev.primary,
      secondary: targets.some((targetPath) => prev.secondary?.startsWith(targetPath)) ? null : prev.secondary,
    }));
  }, []);

  const remapTabPaths = useCallback((oldPath, nextPath) => {
    const toRelativePath = (filePath) => {
      const root = String(projectPath).replace(/[\\/]+$/, '');
      const normalized = String(filePath);
      if (!normalized.toLowerCase().startsWith(`${root.toLowerCase()}\\`) && !normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return null;
      return normalized.slice(root.length + 1).replace(/\\/g, '/');
    };
    setTabs((prev) => prev.map((tab) => {
      if (tab.path === oldPath) {
        return { ...tab, id: nextPath, path: nextPath, relativePath: toRelativePath(nextPath), name: getName(nextPath) };
      }
      if (tab.path.startsWith(`${oldPath}\\`) || tab.path.startsWith(`${oldPath}/`)) {
        const remappedPath = `${nextPath}${tab.path.slice(oldPath.length)}`;
        return { ...tab, id: remappedPath, path: remappedPath, relativePath: toRelativePath(remappedPath), name: getName(remappedPath) };
      }
      return tab;
    }));
    setPaneTabs((prev) => ({
      primary: prev.primary === oldPath || prev.primary?.startsWith(`${oldPath}\\`) || prev.primary?.startsWith(`${oldPath}/`) ? `${nextPath}${prev.primary.slice(oldPath.length)}` : prev.primary,
      secondary: prev.secondary === oldPath || prev.secondary?.startsWith(`${oldPath}\\`) || prev.secondary?.startsWith(`${oldPath}/`) ? `${nextPath}${prev.secondary.slice(oldPath.length)}` : prev.secondary,
    }));
  }, [projectPath]);

  return {
    tabs,
    setTabs,
    paneTabs,
    setPaneTabs,
    activePane,
    setActivePane,
    splitView,
    setSplitView,
    confirmState,
    setConfirmState,
    showDiff,
    setShowDiff,
    activeTabId,
    activeTab,
    dirtyTabs,
    activeTabDirty,
    hasDirtyTabs,
    resetTabsState,
    openPreview,
    saveActiveTab,
    saveDirtyTabs,
    discardDirtyTabs,
    closeTab,
    reorderTabs,
    moveTabBy,
    removeTabsForPaths,
    remapTabPaths,
  };
}
