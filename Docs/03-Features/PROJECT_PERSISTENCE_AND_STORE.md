# Project Persistence and Store Workflows

## Purpose

This document explains how the app resumes state between sessions.

## App Store Flow

File:

- `src/store/useAppStore.js`

### Stored Values

- `currentProject`
- `recentProjects`
- `theme`

### Initialization Flow

1. `src/App.jsx` calls `init()`.
2. Store requests persisted keys through preload.
3. Renderer state is hydrated before normal interaction continues.

## Explorer Store Flow

File:

- `src/store/useExplorerStore.js`

### Stored Values Per Project

- expanded tree paths
- selected tree paths
- open file tab paths
- pane tab assignments
- split view mode

### Keying Strategy

- Each project stores explorer state under a key derived from its absolute project path.

## Operational Rule

When behavior that affects resume state changes, both implementation and documentation should be updated together.
