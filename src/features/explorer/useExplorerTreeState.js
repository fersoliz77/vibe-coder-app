import { useCallback, useMemo, useRef, useState } from 'react';
import { getName, updatePathPrefix } from './explorerUtils';

export function useExplorerTreeState({ projectPath, loadDirectory }) {
  const [directoryCache, setDirectoryCache] = useState({});
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [renamingPath, setRenamingPath] = useState(null);
  const [renamingValue, setRenamingValue] = useState('');
  const hoverExpandTimerRef = useRef(null);

  const resetTreeState = useCallback((persisted) => {
    setExpandedPaths(new Set(persisted?.expandedPaths?.length ? persisted.expandedPaths : [projectPath]));
    setSelectedPaths([]);
    setSelectionAnchor(null);
    setSelectedEntry(null);
    setDirectoryCache({});
    setRenamingPath(null);
    setRenamingValue('');
  }, [projectPath]);

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
    return { collect: walk, paths };
  }, [directoryCache, expandedPaths]);

  const getVisiblePaths = useCallback((rootItems) => {
    const acc = [];
    const walk = (items) => {
      items.forEach((node) => {
        acc.push(node.path);
        if (node.isDirectory && expandedPaths.has(node.path)) {
          walk(directoryCache[node.path] || []);
        }
      });
    };
    walk(rootItems);
    return acc;
  }, [directoryCache, expandedPaths]);

  const selectNode = useCallback((node, event, rootItems) => {
    const nodePath = node.path;
    const allPaths = getVisiblePaths(rootItems);
    setSelectedEntry(node);

    if (event?.shiftKey && selectionAnchor) {
      const from = allPaths.indexOf(selectionAnchor);
      const to = allPaths.indexOf(nodePath);
      if (from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelectedPaths(allPaths.slice(start, end + 1));
        return;
      }
    }

    if (event?.ctrlKey || event?.metaKey) {
      setSelectedPaths((prev) => prev.includes(nodePath) ? prev.filter((value) => value !== nodePath) : [...prev, nodePath]);
      setSelectionAnchor(nodePath);
      return;
    }

    setSelectedPaths([nodePath]);
    setSelectionAnchor(nodePath);
  }, [getVisiblePaths, selectionAnchor]);

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

  const remapTreePaths = useCallback((oldPath, nextPath) => {
    setSelectedPaths((prev) => prev.map((value) => updatePathPrefix(value, oldPath, nextPath)));
    setSelectedEntry((prev) => prev ? { ...prev, path: updatePathPrefix(prev.path, oldPath, nextPath), name: getName(updatePathPrefix(prev.path, oldPath, nextPath)) } : prev);
    setDirectoryCache((prev) => {
      const next = {};
      Object.entries(prev).forEach(([cachePath, items]) => {
        const remappedCachePath = updatePathPrefix(cachePath, oldPath, nextPath);
        next[remappedCachePath] = items.map((item) => ({
          ...item,
          path: updatePathPrefix(item.path, oldPath, nextPath),
          children: item.children,
        }));
      });
      return next;
    });
    setExpandedPaths((prev) => {
      const next = new Set();
      prev.forEach((value) => next.add(updatePathPrefix(value, oldPath, nextPath)));
      return next;
    });
  }, []);

  return {
    directoryCache,
    setDirectoryCache,
    expandedPaths,
    setExpandedPaths,
    selectedPaths,
    setSelectedPaths,
    selectedEntry,
    setSelectedEntry,
    renamingPath,
    setRenamingPath,
    renamingValue,
    setRenamingValue,
    resetTreeState,
    selectNode,
    toggleDirectory,
    scheduleDirectoryExpand,
    clearDirectoryExpandSchedule,
    remapTreePaths,
  };
}
