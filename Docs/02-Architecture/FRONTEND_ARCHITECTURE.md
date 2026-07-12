# Frontend Architecture

## Top-Level Shell

`src/App.jsx` is the UI coordinator.

Responsibilities:

- Boot app state from the store.
- Track active view.
- Wire titlebar actions.
- Pass project path into feature hooks.
- Render the selected workspace.
- Rehydrate current project and theme through `useAppStore`.

## Feature Structure

The frontend is organized by feature domain.

- `src/features/projects/` - project selection UI
- `src/features/dashboard/` - service overview and quick actions
- `src/features/explorer/` - explorer, editor, Git status, move/copy flows
- `src/features/terminal/` - terminal tabs and terminal UI
- `src/features/claude/` - Claude chat/prompt workspace
- `src/features/services/` - service cards and global service UI
- `src/layouts/sidebar/` - sidebar navigation

## Hooks

- `src/hooks/useServices.js` - service checks and connection state
- `src/hooks/useTerminal.js` - terminal lifecycle and IPC event handling
- `src/hooks/useClaude.js` - Claude lifecycle, streaming, and response state

### Explorer Feature Hooks

- `src/features/explorer/useExplorerTabs.js` - tabs, panes, save, close, reorder, diff mode
- `src/features/explorer/useExplorerTreeState.js` - tree selection, expansion, rename state
- `src/features/explorer/useExplorerActions.js` - file actions, Git actions, clipboard, context menu, modal flows
- `src/features/explorer/useExplorerPersistence.js` - per-project hydration and persistence writeback
- `src/features/explorer/useExplorerDragAndDrop.js` - pointer-driven move handling
- `src/features/explorer/useExplorerKeyboardShortcuts.js` - save/search/clipboard/rename shortcuts

## Stores

- `src/store/useAppStore.js` - current project, recents, theme

The Explorer no longer uses `src/store/useExplorerStore.js`.

Its persisted state is handled by feature-local hooks while durable app shell state stays in `useAppStore`.

## Explorer UI Modules

- `src/features/explorer/ExplorerTree.jsx`
- `src/features/explorer/ExplorerWorkspace.jsx`
- `src/features/explorer/ExplorerGitPanel.jsx`
- `src/features/explorer/ExplorerContextMenu.jsx`
- `src/features/explorer/ExplorerModals.jsx`

## Styling

- `src/styles/App.css`
- `src/styles/index.css`
- feature-local CSS files under `src/features/**`

## Current Frontend Conventions

- Feature-first component grouping.
- Hooks isolate side effects and IPC wiring.
- Store is used for cross-session persistence.
- Feature CSS remains colocated with components.
- Behavior-dense features should be split by responsibility before they become monolithic.
