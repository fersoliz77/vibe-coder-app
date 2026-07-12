# Debugging Guide

## Purpose

This guide explains how to debug the application effectively across renderer, preload, IPC, and Electron main process boundaries.

## Debugging Layers

### Renderer

Use the browser devtools attached to the Electron window.

Look here for:

- React runtime errors
- failed event flows
- component state issues
- custom debug logs such as explorer drag logs

### Main Process

Use the terminal that launched Electron.

Look here for:

- filesystem errors
- Git command failures
- terminal process issues
- Claude subprocess issues
- IPC-side logging

### Preload / IPC Boundary

Use both renderer and main logs together.

Typical pattern:

- renderer shows action trigger
- main shows actual execution or failure reason

## Common Commands

### Start Electron in development

```bash
npm run dev:electron
```

### Build check

```bash
npm run build
```

## High-Value Debug Areas

### Explorer

Relevant files:

- `src/features/explorer/FileExplorer.jsx`
- `src/features/explorer/useExplorerTreeState.js`
- `src/features/explorer/useExplorerTabs.js`
- `src/features/explorer/useExplorerActions.js`
- `src/features/explorer/useExplorerPersistence.js`
- `electron/ipc/fileSystemManager.js`
- `electron/ipc/fsGuards.js`

What to inspect:

- move source and target paths
- cached directory state after operations
- selected and expanded path state
- restored pane tab routing after project reopen
- context menu and modal action state
- renderer drag logs
- main-process move logs
- path rejection errors for invalid or out-of-project operations

### Terminal

Relevant files:

- `src/hooks/useTerminal.js`
- `electron/services/terminalManager.js`

What to inspect:

- `node-pty` availability
- terminal creation response
- onData and onExit behavior

### Claude

Relevant files:

- `src/hooks/useClaude.js`
- `electron/services/claudeManager.js`

What to inspect:

- CLI availability result
- subprocess spawn failures
- stdout and stderr streaming

### Services

Relevant files:

- `src/hooks/useServices.js`
- `electron/services/serviceManager.js`

What to inspect:

- project path forwarding
- CLI command output and stderr
- Windows path assumptions

## Logging Rule

When adding temporary debug logs:

- prefix them clearly by subsystem
- include the key path or identifier
- remove or reduce noisy logs once the issue is solved unless they provide lasting operational value

## Useful Existing Log Prefixes

- `[explorer:dnd]`
- `[fs:move-entry]`

## Incident Note Template

When a bug is hard to diagnose, write down:

- exact trigger steps
- renderer logs
- main-process logs
- observed result
- expected result
- root cause after fix
