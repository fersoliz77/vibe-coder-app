# Terminal Feature

## Purpose

The terminal feature provides project-scoped shell access inside the app.

## Primary Files

- `src/hooks/useTerminal.js`
- `src/features/terminal/TerminalPanel.jsx`
- `src/features/terminal/TerminalPanel.css`
- `electron/services/terminalManager.js`

## Key Capabilities

- Create one or more terminal tabs inside the active project
- Scope terminal working directory to the current project by default
- Stream PTY output into xterm instances in the renderer
- Resize PTY sessions when terminal containers change size
- Close terminal sessions and keep active tab routing coherent
- Fall back to a renderer-visible error state when `node-pty` is unavailable

## Behavior

- Creates terminal sessions through Electron IPC.
- Uses `node-pty` when available.
- Streams output events back to the renderer.
- Maintains tab state and active terminal selection.

## Important Internal Behaviors

### Renderer Hook State

- `src/hooks/useTerminal.js` owns terminal tab metadata in React state.
- Terminal tabs are not currently persisted across app restarts.
- A placeholder terminal entry is created when Electron or PTY support is unavailable.

### Panel Lifecycle

- `src/features/terminal/TerminalPanel.jsx` auto-creates one terminal on first mount when none exist.
- xterm, fit addon, and web-links addon are loaded dynamically.
- Each terminal DOM container gets its own xterm instance, fit addon, and resize observer.

### Main Process PTY Model

- `electron/services/terminalManager.js` keeps PTY processes in an in-memory `Map`.
- A new terminal receives a generated id such as `term-1`.
- The default shell comes from `COMSPEC` on Windows or `SHELL` on Unix-like systems.
- PTY output is pushed back to the renderer with `terminal:data` events.

### Resize and Close Behavior

- Renderer resize observers call `terminal:resize` through preload.
- Closing a terminal disposes the renderer xterm instance and kills the PTY session in the main process.
- Exit events from the PTY trigger renderer cleanup through `terminal:exit`.

## Data Flow

1. Renderer requests terminal creation.
2. Electron creates a PTY process.
3. PTY output is streamed to renderer.
4. Renderer writes output into xterm.
5. Close and resize events are sent back through IPC.

## Fallback

If `node-pty` is unavailable, the renderer still creates a placeholder terminal state with an explanatory error.

## Current Constraints

- Terminal sessions are runtime-only and are not restored after app restart.
- Shell startup behavior depends on the local machine environment.
- PTY creation assumes the requested project path is valid and available on disk.

## Risk Notes

- Native PTY dependencies are platform-sensitive.
- Packaging and local environment issues can affect terminal availability.
- Terminal lifecycle bugs can hide in cleanup behavior across rapid open/close cycles.

## Known Maintenance Note

Any change to terminal creation, event subscription, resize handling, or xterm disposal should be tested in the real Electron shell on Windows.
