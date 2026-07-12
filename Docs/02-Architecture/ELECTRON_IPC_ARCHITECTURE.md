# Electron and IPC Architecture

## Bootstrap

`electron/main.js` creates the main BrowserWindow and registers all managers after `app.whenReady()`.

## Preload Surface

`electron/preload.js` exposes grouped APIs to the renderer:

- `window.electronAPI.window`
- `window.electronAPI.dialog`
- `window.electronAPI.fs`
- `window.electronAPI.store`
- `window.electronAPI.projects`
- `window.electronAPI.services`
- `window.electronAPI.terminal`
- `window.electronAPI.claude`

## IPC Modules

### Window

- file: `electron/ipc/windowManager.js`
- manages minimize, maximize, close, maximized state

### Dialog

- file: `electron/ipc/dialogManager.js`
- opens and creates directories

### Store

- file: `electron/ipc/storeManager.js`
- key-value persistence for app and explorer state

### File System

- file: `electron/ipc/fileSystemManager.js`
- supporting guard layer: `electron/ipc/fsGuards.js`
- directory reads
- file preview reads
- write, create, delete, rename, copy, move
- project search
- Git status, stage, unstage, commit
- project-root validation and path-boundary enforcement

### Services

- file: `electron/services/serviceManager.js`
- connectivity checks and related CLI-backed logic

### Terminal

- file: `electron/services/terminalManager.js`
- terminal creation, write, resize, exit handling

### Claude

- file: `electron/services/claudeManager.js`
- Claude availability checks and prompt execution

### Projects

- file: `electron/services/projectManager.js`
- project initialization and project-specific workflows
- project registration checks used by guarded filesystem IPC

## Security Notes

- Renderer does not use direct Node integration.
- Context isolation is enabled.
- Preload acts as the only renderer bridge.
- Filesystem IPC now requires a registered project path and rejects out-of-project access.
- `electron/main.js` now explicitly enables `webSecurity` and disables insecure content loading.
- The app still runs with `sandbox: false` because of current desktop runtime constraints and should be reviewed again before a hardened production release.
