# ADR-0003: Explorer Modular Hook Architecture

## Status

Accepted

## Date

2026-07-11

## Context

The Explorer had become the most behavior-dense feature in the app. Tree rendering, selection, persistence, drag logic, Git actions, clipboard actions, tabs, split panes, and editor flows were concentrated too heavily in a single implementation surface. That raised regression risk and made safe iteration slower.

## Decision

The Explorer is split into focused UI modules and feature-local hooks.

Core coordination remains in `src/features/explorer/FileExplorer.jsx`, while feature concerns are separated into dedicated units.

### Hook Boundaries

- `useExplorerTabs.js` owns tabs, panes, diff mode, save, close, and reorder behavior.
- `useExplorerTreeState.js` owns selection, expansion, rename state, and tree path remapping.
- `useExplorerActions.js` owns file actions, Git actions, clipboard behavior, context menu state, and modal-driven mutations.
- `useExplorerPersistence.js` owns project-scoped persistence hydration and writeback.
- `useExplorerDragAndDrop.js` owns global pointer tracking for move operations.
- `useExplorerKeyboardShortcuts.js` owns keyboard shortcut wiring.

### UI Boundaries

- `ExplorerTree.jsx` renders tree and search surfaces.
- `ExplorerWorkspace.jsx` renders tabs, panes, editor, and diff view.
- `ExplorerGitPanel.jsx` renders Git change UI.
- `ExplorerContextMenu.jsx` renders contextual actions.
- `ExplorerModals.jsx` renders create/delete/confirm modal flows.

## Consequences

### Positive

- Lower cognitive load per file.
- Safer future refactors in one Explorer subdomain at a time.
- Clearer testing targets for tree state, actions, and tab behavior.
- Better alignment with the feature-first frontend structure already adopted elsewhere.

### Negative

- More hook and prop wiring to keep consistent.
- Cross-cutting Explorer changes may now touch several files instead of one.

## Related Files

- `src/features/explorer/FileExplorer.jsx`
- `src/features/explorer/useExplorerTabs.js`
- `src/features/explorer/useExplorerTreeState.js`
- `src/features/explorer/useExplorerActions.js`
- `src/features/explorer/useExplorerPersistence.js`
- `src/features/explorer/ExplorerTree.jsx`
- `src/features/explorer/ExplorerWorkspace.jsx`
