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
- Chromium sandboxing is enabled for the main renderer.

## Renderer Sandbox And Process Isolation

The main renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and Chromium `sandbox: true`. Native modules such as `node-pty` stay in the main process and are reached only through the narrow API exposed by `electron/preload.js`, so sandboxing is compatible with terminal support.

Non-interactive subprocesses use `electron/services/subprocessEnv.js`. It starts from an allowlist of operating-system path and profile variables, adds only the selected provider's official authentication variables, and accepts command-specific values explicitly. The interactive terminal is intentionally separate and retains the user's shell environment.

Proxy, custom CA, SSH agent socket, and passive Git configuration variables are preserved. `GIT_SSH_COMMAND`, `GIT_ASKPASS`, and `SSH_ASKPASS` are deliberately excluded because Git executes their values as commands or programs; provider credential stores and `SSH_AUTH_SOCK` remain available without that execution surface.

Claude and Codex stream events include both `runId` and `projectPath`. Renderer consumers reject events that do not match the active run and project; project transitions cancel active runs before changing workspace state.
