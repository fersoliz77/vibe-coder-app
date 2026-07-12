# Developer Workflows

## Start the App in Development

```bash
npm run dev:electron
```

## Build the Renderer

```bash
npm run build
```

## Run Automated Baseline Checks

```bash
npm test
npm run check
```

## Package the Application

```bash
npm run package
```

## Rebuild Native Modules

```bash
npm run rebuild
```

## Recommended Work Session Flow

1. Open the app in Electron development mode.
2. Select or create a project.
3. Validate the relevant feature in the real desktop shell.
4. Run `npm test` for baseline guard coverage.
5. Run `npm run build` or `npm run check` before considering the session stable.
6. Update docs after meaningful behavior changes.
7. Add a dated note to `WORK_LOG.md`.
8. Update `CHANGELOG.md` if the behavior is user-visible.

## Safe Workflow for Explorer Changes

1. Identify which Explorer layer is changing before editing code.
2. Prefer changing one layer first: tree state, tabs, actions, persistence, drag logic, or keyboard shortcuts.
3. Keep renderer UI concerns in the Explorer UI modules and move behavior into the feature hooks when possible.
4. If a file operation changes, verify both renderer behavior and guarded main-process execution.
5. Re-run at least the Explorer regression checklist in `TESTING_GUIDE.md`.

## Explorer Ownership Map

- `src/features/explorer/FileExplorer.jsx` - feature composition and cross-hook coordination
- `src/features/explorer/useExplorerTreeState.js` - selection, expansion, rename state
- `src/features/explorer/useExplorerTabs.js` - tabs, panes, save, dirty state, diff mode
- `src/features/explorer/useExplorerActions.js` - file actions, Git actions, clipboard, modals, context menu
- `src/features/explorer/useExplorerPersistence.js` - project-scoped state hydration and writeback
- `src/features/explorer/useExplorerDragAndDrop.js` - pointer-driven move tracking
- `src/features/explorer/useExplorerKeyboardShortcuts.js` - keyboard shortcuts
- `electron/ipc/fileSystemManager.js` and `electron/ipc/fsGuards.js` - enforced filesystem mutation boundary

## High-Risk Areas to Test After Changes

- Explorer tree operations
- Explorer hook coordination and persistence restore
- Drag and move logic
- Git actions in explorer
- Terminal creation and close behavior
- Claude prompt execution and cancellation
- Service connectivity checks
- Project resume and persisted state restoration
