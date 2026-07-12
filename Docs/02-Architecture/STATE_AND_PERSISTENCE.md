# State and Persistence

## Overview

The application uses a combination of React local state, Zustand stores, and Electron-backed persistence.

## State Layers

### React Local State

Used for view-local and interaction-specific concerns.

Examples:

- active UI view in `src/App.jsx`
- transient explorer drag state in `src/features/explorer/FileExplorer.jsx`
- streaming Claude response state in `src/hooks/useClaude.js`

### Zustand Stores

Used for application-level or project-scoped state that must survive component remounts.

#### App Store

File:

- `src/store/useAppStore.js`

Responsibilities:

- current project
- recent projects
- theme preference

Persistence target:

- Electron store API exposed through preload

The Explorer no longer uses a standalone Zustand store.

Explorer persistence is coordinated by feature hooks in:

- `src/features/explorer/useExplorerPersistence.js`
- `src/features/explorer/useExplorerTabs.js`
- `src/features/explorer/useExplorerTreeState.js`

Persisted Explorer fields still include:

- expanded tree paths
- selected paths
- open tab paths
- pane tab routing
- split view setting

Persistence target:

- store entries keyed by `fileExplorerState:<projectPath>`

## Persistent Data Sources

### Project Registry

File:

- `electron/services/projectManager.js`

Backed by:

- `projects.json` under Electron `userData`

### Key-Value App Store

File:

- `electron/ipc/storeManager.js`

Used by:

- `src/store/useAppStore.js`
- `src/features/explorer/useExplorerPersistence.js`

## Persistence Principles

- Persist only what helps resume work.
- Keep transient drag or hover state out of durable storage.
- Key explorer state by project path to avoid cross-project contamination.
- Keep orchestration state local to the Explorer feature unless it is truly app-wide.
