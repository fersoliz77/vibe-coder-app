import { useEffect, useRef } from 'react';
import { getStorageKey, makeTab, makeTabManifest } from './explorerUtils';

export function useExplorerPersistence({
  projectId,
  projectPath,
  tabs,
  paneTabs,
  splitView,
  resetWorkspace,
  setTabs,
  setPaneTabs,
  loadPersistedFile,
}) {
  const hydratedProjectRef = useRef(null);
  const hydratedPathRef = useRef(null);
  const resetWorkspaceRef = useRef(resetWorkspace);
  resetWorkspaceRef.current = resetWorkspace;

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;

    const hydrate = async () => {
      const persisted = await window.electronAPI.store.get(getStorageKey(projectId), null);
      if (!cancelled) {
        hydratedProjectRef.current = persisted;
        resetWorkspaceRef.current(persisted);
        hydratedPathRef.current = projectPath;
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [projectId, projectPath]);

  useEffect(() => {
    if (!projectPath || hydratedPathRef.current !== projectPath) return;
    window.electronAPI.store.set(getStorageKey(projectId), makeTabManifest(tabs, paneTabs, splitView));
  }, [paneTabs, projectId, projectPath, splitView, tabs]);

  useEffect(() => {
    const pending = hydratedProjectRef.current;
    if (!projectPath || !pending) return;
    hydratedProjectRef.current = null;

    const paths = pending.version === 1 && Array.isArray(pending.tabs) ? pending.tabs : [];

    if (paths.length === 0) return;

    Promise.all(paths.map((relativePath) => loadPersistedFile(relativePath))).then((results) => {
      const validTabs = results.filter((result) => result.success).map(makeTab);
      const idForRelativePath = (relativePath) => validTabs.find((tab) => tab.relativePath === relativePath)?.id || null;
      setTabs(validTabs);
      setPaneTabs({
        primary: idForRelativePath(pending.panes?.primary) || validTabs[0]?.id || null,
        secondary: pending.splitView ? idForRelativePath(pending.panes?.secondary) : null,
      });
    }).catch(() => {});
  }, [loadPersistedFile, projectPath, setPaneTabs, setTabs]);
}
