# Start Here

## What Changed Recently

As of 2026-07-11, the app has a stronger internal base than the earlier docs implied.

- Explorer logic is now split across focused UI modules and hooks.
- File system IPC is now project-aware and guarded against path traversal and out-of-project access.
- App-level project and theme persistence are active through `src/store/useAppStore.js`.
- Basic automated tests now exist for filesystem guard rules.

## Best First Reading Order

1. `Docs/README.md`
2. `Docs/02-Architecture/ELECTRON_IPC_ARCHITECTURE.md`
3. `Docs/02-Architecture/STATE_AND_PERSISTENCE.md`
4. `Docs/03-Features/EXPLORER.md`
5. `Docs/04-Operations/WORK_LOG.md`

## Code Entry Points

- App shell: `src/App.jsx`
- Electron main: `electron/main.js`
- Preload bridge: `electron/preload.js`
- Explorer container: `src/features/explorer/FileExplorer.jsx`
- Filesystem IPC: `electron/ipc/fileSystemManager.js`
- Filesystem guards: `electron/ipc/fsGuards.js`

## Explorer Structure Today

- `src/features/explorer/FileExplorer.jsx` orchestrates the feature.
- `src/features/explorer/ExplorerTree.jsx` renders the tree and search results.
- `src/features/explorer/ExplorerWorkspace.jsx` renders tabs, panes, editor, and diff view.
- `src/features/explorer/ExplorerGitPanel.jsx` handles Git status UI.
- `src/features/explorer/useExplorerTabs.js` owns tab and pane behavior.
- `src/features/explorer/useExplorerTreeState.js` owns selection, expansion, and rename state.
- `src/features/explorer/useExplorerActions.js` owns file actions, Git actions, clipboard, and context menu flows.

## Quick Validation Commands

```bash
npm run dev:electron
npm test
npm run build
```

## Current Caveat

The app is in a much better structural state, but `CodeEditor` is still the largest frontend chunk and should be split further later.
