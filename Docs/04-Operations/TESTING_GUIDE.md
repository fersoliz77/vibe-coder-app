# Testing Guide

## Purpose

This guide defines how to validate the application with a practical, repeatable workflow.

## Current Testing Reality

The project currently relies on:

- `npm test` for filesystem boundaries, authentication and access policy, Electron security contracts, subprocess and AI lifecycle behavior, diagnostics, persistence, provisioning, release manifests, and related regressions
- production renderer build validation
- local packaging and bounded release-candidate checks when delivery behavior is affected
- manual Electron verification for interactions that require the packaged shell or operating-system integration
- targeted runtime debugging
- Playwright-assisted checks when explicitly requested

The suite size is intentionally not recorded here because it changes with implementation. A dated verification record may report the exact count observed in that session.

## Minimum Verification Standard

Before considering a meaningful feature change complete, validate:

1. project selection flow
2. dashboard rendering
3. explorer behavior related to the change
4. terminal or Claude behavior if impacted
5. `npm test`
6. `npm run build`

## Core Commands

### Start development app

```bash
npm run dev:electron
```

### Build renderer

```bash
npm run build
```

### Run current automated tests

```bash
npm test
```

### Run baseline validation bundle

```bash
npm run check
```

### Package app

```bash
npm --offline run package
```

### Verify an offline release candidate

Use the dependency-free commands documented in `OFFLINE_RELEASE_PREPARATION.md`:

```bash
npm run release:verify-installer -- <installer.exe> <win-unpacked/Vibe IDE Code.exe>
npm run release:validate -- <release-manifest.json> <installer.exe> <installer.sha256>
npm run release:smoke -- --manifest <release-manifest.json> --installer <installer.exe>
```

These checks do not install, sign, publish, or enable updates. Passing them establishes only local installer-byte integrity and basic PE structure; it does not validate installer format or Authenticode trust. External development tools are not part of the installer hash and are installed only from Setup Center after explicit consent.

## Manual Regression Checklist

### Project Flow

- open existing project
- create or add a new project path
- switch between projects
- confirm titlebar project metadata updates correctly

### Explorer Flow

- expand and collapse nested folders
- switch projects and confirm explorer state stays scoped per project
- open files in editor
- restore prior explorer session and confirm open tabs rehydrate correctly
- edit and save text files
- close dirty tabs and confirm unsaved warning behavior
- create files and folders in root and subfolders
- rename files and folders
- delete single and multiple items
- copy, cut, paste, duplicate
- move files and folders, including move to root
- confirm moved folders still show nested content immediately
- confirm out-of-project file mutations are impossible through normal UI flows
- check Git panel render and actions
- toggle stage and unstage on multiple changed files
- create a commit from the Explorer when staged changes exist

### Explorer Hook Risk Checklist

When a change touches the modular Explorer internals, verify the affected layer directly:

- `useExplorerTreeState.js` - selection range, multi-select, expand/collapse, inline rename
- `useExplorerTabs.js` - open/close tabs, split view, save flow, dirty state, tab reorder
- `useExplorerActions.js` - create/delete/rename/move/copy/paste/duplicate, Git actions, context menu actions
- `useExplorerPersistence.js` - tab restore, selected paths restore, split view restore
- `useExplorerDragAndDrop.js` - pointer tracking and drop target behavior
- `useExplorerKeyboardShortcuts.js` - save, search, copy, cut, paste, rename shortcuts

### Terminal Flow

- open a terminal
- create a second terminal tab
- run a command
- close tabs and verify active tab behavior

### Claude Flow

- verify CLI detection state
- send a prompt
- observe streaming output
- cancel an active run

### Services Flow

- refresh all services
- refresh a single service
- confirm project-aware results render correctly

## Playwright Usage Rule

Playwright should only be used when explicitly requested.

That rule exists to avoid unnecessary automation runs and to keep the default workflow lightweight.

## Recommended Session Pattern

1. run `npm run dev:electron`
2. reproduce the target behavior in the actual desktop shell
3. apply fix or feature change
4. re-run manual verification for the affected area
5. run `npm test`
6. run `npm run build`
7. update docs and work log

## Failure Documentation Rule

When a bug is reproduced and fixed, capture:

- how it was triggered
- affected files
- root cause
- validation steps used to confirm the fix
