# ADR-0001: Explorer Drag Model

## Status

Accepted

## Date

2026-07-10

## Context

The Explorer needed reliable move behavior inside an Electron + React application. Earlier attempts based on browser-native HTML5 drag/drop were unstable in the actual desktop runtime and failed to produce dependable target detection.

## Decision

The Explorer uses a custom pointer-driven move model instead of relying on browser-native drag/drop.

## Consequences

### Positive

- More predictable behavior in Electron.
- Better control over target detection and debug logging.
- Easier adaptation for future visual feedback improvements.

### Negative

- More custom logic to maintain.
- Requires explicit testing after changes to tree rendering.

## Related Files

- `src/features/explorer/FileExplorer.jsx`
- `electron/ipc/fileSystemManager.js`
