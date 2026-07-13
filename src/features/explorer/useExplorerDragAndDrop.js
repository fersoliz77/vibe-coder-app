import { useEffect } from 'react';
import { dragLog } from './explorerUtils';

export function useExplorerDragAndDrop({
  dragState,
  dropTargetPath,
  setDragState,
  setDropTargetPath,
  clearDirectoryExpandSchedule,
  handleDropMove,
  onScheduleTarget,
}) {
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
      setDragState(null);
      if (dropTargetPath) {
        handleDropMove(dragState.sourcePath, dropTargetPath);
      }
      setDropTargetPath(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [clearDirectoryExpandSchedule, dragState, dropTargetPath, handleDropMove, onScheduleTarget, setDragState, setDropTargetPath]);
}
