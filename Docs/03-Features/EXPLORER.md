# Explorer Feature

## Purpose

The Explorer is a desktop file workspace inside the app. It supports navigation, preview, editing, creation, deletion, rename, copy, cut, paste, duplicate, Git awareness, split editor panes, and folder moves.

## Primary Files

- `src/features/explorer/FileExplorer.jsx`
- `src/features/explorer/FileExplorer.css`
- `src/features/explorer/CodeEditor.jsx`
- `src/features/explorer/ExplorerTree.jsx`
- `src/features/explorer/ExplorerWorkspace.jsx`
- `src/features/explorer/ExplorerGitPanel.jsx`
- `src/features/explorer/useExplorerPersistence.js`
- `src/features/explorer/useExplorerTabs.js`
- `src/features/explorer/useExplorerTreeState.js`
- `src/features/explorer/useExplorerActions.js`
- `electron/ipc/fileSystemManager.js`
- `electron/ipc/fsGuards.js`

## Key Capabilities

- Nested folder tree
- Selection and multi-selection
- Inline rename
- New file and new folder creation
- Delete and bulk delete
- Copy, cut, paste, duplicate
- Open file externally
- Preview and edit files internally
- Split view editor panes
- Git change visibility and commit actions
- Custom drag-to-move behavior for folders and files

## Important Internal Behaviors

### Tree State

- Expanded paths are tracked per project.
- Selected paths can contain multiple entries.
- Tree state persists across sessions.
- Selection, expansion, and rename state now live in `useExplorerTreeState.js`.

### Editor State

- Open tabs are tracked centrally.
- Each text tab has `savedContent` and `draftContent`.
- Dirty state is derived by comparing draft and saved values.
- Tab routing, split view, save, close, and reorder logic now live in `useExplorerTabs.js`.

### Drag and Move Model

- The explorer does not rely on browser-native HTML5 drag/drop anymore.
- It uses a custom pointer-driven flow.
- Drop target detection is resolved by hit-testing tree rows.
- Move execution is performed by `fs:move-entry` in the main process.
- Global pointer tracking is isolated in `useExplorerDragAndDrop.js`.

### Git Panel

- Git status is read through `git status --porcelain`.
- Stage and unstage are file-based actions.
- Commit is available from the panel when staged changes exist.
- Git UI is rendered by `ExplorerGitPanel.jsx`, while action execution lives in `useExplorerActions.js`.

### Security Boundaries

- Renderer file actions always pass the active project path into preload.
- Main-process filesystem handlers validate that targets stay inside a registered project root.
- Unsafe names and path traversal attempts are rejected before file mutations run.

## Known Maintenance Note

This is still the most behavior-dense feature in the app. The recent modular split reduces risk, but any change to selection, tree rendering, drag logic, editor pane routing, persistence, or guarded filesystem actions should still be tested carefully.
