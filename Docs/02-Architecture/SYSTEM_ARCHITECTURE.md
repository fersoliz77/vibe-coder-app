# System Architecture

## High-Level Model

The application is split into three main layers:

1. Renderer layer
2. Secure preload bridge
3. Electron main process

## Renderer Layer

The renderer is a React application responsible for UI composition, local interaction state, and calling the exposed Electron APIs.

Key files:

- `src/App.jsx`
- `src/features/**/*`
- `src/hooks/*`
- `src/store/*`

Important current renderer patterns:

- App shell persistence is centralized in `src/store/useAppStore.js`.
- Explorer behavior is coordinated by feature-local hooks rather than a dedicated global store.
- High-risk desktop features are routed through preload with explicit project context.

## Preload Bridge

The preload layer exposes a constrained `window.electronAPI` interface. It isolates the renderer from direct Node.js access while still allowing filesystem, window, terminal, Claude, services, and persistence actions.

Key file:

- `electron/preload.js`

Important current preload rule:

- Filesystem calls now require the active `projectPath` to be passed from the renderer.

## Main Process

The main process creates the BrowserWindow, loads the app, and registers all IPC modules.

Key file:

- `electron/main.js`

It delegates responsibilities to focused modules:

- `electron/ipc/windowManager.js`
- `electron/ipc/dialogManager.js`
- `electron/ipc/fileSystemManager.js`
- `electron/ipc/fsGuards.js`
- `electron/ipc/storeManager.js`
- `electron/services/projectManager.js`
- `electron/services/serviceManager.js`
- `electron/services/terminalManager.js`
- `electron/services/claudeManager.js`

## Data Flow

- UI event happens in React.
- React calls `window.electronAPI.*`.
- Preload forwards the call through IPC.
- Electron main process validates project context and executes the operation.
- Result returns to the renderer and updates UI state.

## Persistence Model

- App-level state is persisted via the store API.
- Explorer state is keyed by project path.
- Recent projects and current project are persisted across launches.
- Explorer persistence is hydrated by feature hooks instead of a standalone Explorer store.

## Architectural Strengths

- Clear Electron boundary.
- Focused IPC modules.
- Feature-oriented frontend structure.
- Store-backed session persistence.
- Safer filesystem mutation boundary for project-scoped operations.
- More modular Explorer internals with clearer ownership lines.

## Current Risk Areas

- The explorer is still one of the most complex parts of the app and needs careful regression testing after UI logic changes.
- CodeMirror chunk size is large and may need deeper code splitting later.
- Git and filesystem operations depend on local environment consistency and should be validated on real Windows paths.
- `sandbox: false` is still present for runtime compatibility and remains a future hardening topic.
