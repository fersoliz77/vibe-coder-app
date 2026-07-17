import { useEffect } from 'react';
import { getName, getParentDirectory } from './explorerUtils';

export function useExplorerKeyboardShortcuts({
  t,
  activeTabDirty,
  clipboardEntry,
  setClipboardEntry,
  setStatusMessage,
  selectedPaths,
  selectedEntry,
  projectPath,
  handlePasteInto,
  setRenamingPath,
  setRenamingValue,
}) {
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
        setStatusMessage(t('explorer.copied', { name: getName(path) }));
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && selectedPaths.length > 0) {
        event.preventDefault();
        const path = selectedPaths[0];
        setClipboardEntry({ path, name: getName(path), mode: 'cut' });
        setStatusMessage(t('explorer.cut', { name: getName(path) }));
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && clipboardEntry) {
        event.preventDefault();
        const targetPath = selectedEntry?.isDirectory ? selectedEntry.path : selectedEntry?.path ? getParentDirectory(selectedEntry.path) : projectPath;
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
  }, [activeTabDirty, clipboardEntry, handlePasteInto, projectPath, selectedEntry, selectedPaths, setClipboardEntry, setRenamingPath, setRenamingValue, setStatusMessage, t]);
}
