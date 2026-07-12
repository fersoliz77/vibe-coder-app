import { useEffect, useRef } from 'react';
import { getStorageKey, makeTab } from './explorerUtils';

export function useExplorerPersistence({
  projectPath,
  expandedPaths,
  selectedPaths,
  tabs,
  paneTabs,
  splitView,
  resetWorkspace,
  setExpandedPaths,
  setSelectedPaths,
  setTabs,
  setPaneTabs,
  loadFile,
}) {
  const hydratedProjectRef = useRef(null);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;

    const hydrate = async () => {
      const persisted = await window.electronAPI.store.get(getStorageKey(projectPath), null);
      if (!cancelled) {
        hydratedProjectRef.current = persisted;
        resetWorkspace(persisted);
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [projectPath, resetWorkspace]);

  useEffect(() => {
    if (!projectPath) return;
    window.electronAPI.store.set(getStorageKey(projectPath), {
      expandedPaths: Array.from(expandedPaths),
      selectedPaths,
      openTabPaths: tabs.map((tab) => tab.path),
      paneTabs,
      splitView,
    });
  }, [expandedPaths, paneTabs, projectPath, selectedPaths, splitView, tabs]);

  useEffect(() => {
    const pending = hydratedProjectRef.current;
    if (!projectPath || !pending) return;
    hydratedProjectRef.current = null;

    const paths = pending.openTabPaths || [];
    if (pending.selectedPaths?.length) {
      setSelectedPaths(pending.selectedPaths);
    }

    if (paths.length === 0) return;

    Promise.all(paths.map((filePath) => loadFile(filePath))).then((results) => {
      const validTabs = results.filter((result) => result.success).map(makeTab);
      setTabs(validTabs);
      setPaneTabs({
        primary: validTabs.some((tab) => tab.id === pending.paneTabs?.primary) ? pending.paneTabs.primary : validTabs[0]?.id || null,
        secondary: validTabs.some((tab) => tab.id === pending.paneTabs?.secondary) ? pending.paneTabs.secondary : null,
      });
      setExpandedPaths(new Set(pending.expandedPaths?.length ? pending.expandedPaths : [projectPath]));
    }).catch(() => {});
  }, [loadFile, projectPath, setExpandedPaths, setPaneTabs, setSelectedPaths, setTabs]);
}
