# Work Log

This log records implementation history in chronological order. Each entry should capture the date, scope, and why the work mattered.

---

## 2026-08-11

### Scope

- Added a separate Requirements Center after workspace onboarding.
- Hardened project persistence and renderer-facing project contracts.
- Added safe, individually consented dependency remediation.

### Key Changes

- Corrected the packaged learning URL and added a shared canonical-origin policy plus a release-time mismatch gate.
- Added read-only requirement derivation for nested applications, npm and pnpm workspaces, lockfile ownership, and hoisted dependencies.
- Added short-lived single-use grants for reviewed actions and restricted managed execution to `npm ci --ignore-scripts --no-audit --no-fund` without lifecycle scripts or shell invocation.
- Added disk-space preflight, staged progress, safe cancellation, and verification-only retry after a completed install.
- Added bounded project-registry validation, backups, automatic repair and recovery, and a global recovery notice.
- Reduced renderer and persisted-store project data to explicit public contracts that exclude private configuration and analysis internals.

### Validation

- `npm run check` with 375 passing tests.
- Token, font, literal, accessibility, contrast, design-system, build, and bundle-budget checks passed.
- `git diff --check` passed.

---

## 2026-08-10

### Scope

- Added safe analysis and guided import for projects created outside Vibe IDE Code.
- Unified provisioned and imported projects under a target-based workspace model.
- Replaced project-mode learning progress with operational project details.
- Added direct sidebar access to the learning platform.

### Key Changes

- Added bounded static detection for common web, mobile, backend, native, and monorepo manifests without executing project code or reading environment files.
- Added expiring import grants, target confirmation, confidence labels, partial-analysis warnings, and generic-workspace fallback.
- Added target-aware preview and Vercel-link discovery for applications inside nested workspace folders.
- Added responsive, focus-trapped import review UI with lazy-loaded JavaScript and CSS.
- Added the trusted `auth:open-learning` bridge to open `/learn` in the operating system's default browser.
- Persisted stack, privacy, deployment, workspace, and primary-target metadata for newly created projects.

### Validation

- `npm run check` with 333 passing tests.
- Token, literal, accessibility, contrast, design-system, build, and bundle-budget checks passed.
- `git diff --check` passed.

---

## 2026-07-13

### Scope

- Added Windows environment setup and guided full-stack project creation.
- Added web and Flutter Android project templates optimized for Vercel.
- Automated GitHub, Vercel, Firebase, and Supabase provisioning.
- Restored working Windows packaging and generated an NSIS installer.

### Key Changes

- Added optional OpenCode `1.17.18` detection, native installation consent, provider status, and direct PTY launch.
- Kept OpenCode out of the installer and Setup Center requirements so it is downloaded only when requested.
- Added a main-process terminal mode that prevents project-local command hijacking.
- Added `environmentManager.js`, `projectProvisioner.js`, Setup Center, and Create Project Wizard.
- Added temporary location grants, cancellable subprocess tracking, sanitized progress, and partial-failure recovery.
- Bundled the official Supabase CLI and reused native `node-pty` prebuilds during packaging.
- Added 16 environment/provisioning tests without creating cloud resources.

### Validation

- `npm run check` with 45 passing tests.
- `npm audit --omit=dev` with zero vulnerabilities.
- `npm run package:dir` and packaged executable smoke test.
- `npm run package` produced `dist-electron/Vibe IDE Code Setup 1.0.0.exe`.
- Real OpenCode `1.17.18` status detected OpenAI and Anthropic without exposing credentials.

---

## 2026-07-11

### Scope

- Hardened Electron filesystem IPC.
- Reconnected app-level persisted state.
- Added test and validation commands.
- Modularized the Explorer into focused hooks and UI modules.

### Key Changes

- Added guarded filesystem path utilities in `electron/ipc/fsGuards.js`.
- Reworked `electron/ipc/fileSystemManager.js` so file operations validate project registration and path boundaries.
- Updated `electron/preload.js` so renderer filesystem calls always pass project context.
- Added project registration lookup support in `electron/services/projectManager.js`.
- Enabled stronger BrowserWindow web security settings in `electron/main.js`.
- Activated persisted app shell state in `src/store/useAppStore.js` and wired `src/App.jsx` to use it.
- Added `.gitignore`, `npm test`, and `npm run check`.
- Added filesystem guard tests in `tests/fsGuards.test.js`.
- Extracted Explorer helpers into `src/features/explorer/explorerUtils.js` and persistence into `src/features/explorer/useExplorerPersistence.js`.
- Split the Explorer UI into `ExplorerTree.jsx`, `ExplorerWorkspace.jsx`, `ExplorerGitPanel.jsx`, `ExplorerContextMenu.jsx`, and `ExplorerModals.jsx`.
- Split Explorer behavior into `useExplorerTabs.js`, `useExplorerTreeState.js`, `useExplorerActions.js`, `useExplorerDragAndDrop.js`, and `useExplorerKeyboardShortcuts.js`.
- Removed the old dedicated Explorer Zustand store in favor of feature-local hook coordination.

### Why It Matters

- Filesystem actions are now much safer and more predictable for a desktop IDE workflow.
- The Explorer is no longer a single monolithic implementation surface, which lowers regression risk and makes future improvements faster.
- The app now has a clearer baseline for automated validation and architectural growth.

### Validation

- `npm test`
- `npm run build`
- `npm run check`

### Follow-Up Notes

- Add direct unit coverage for `useExplorerActions.js` and related hook behavior.
- Split the `CodeEditor` frontend chunk further when performance work begins.

---

## 2026-07-10

### Scope

- Stabilized Electron/React wiring across the app.
- Reworked explorer interactions and file management behavior.
- Improved titlebar project presentation and project path actions.
- Added integrated documentation foundation.

### Key Changes

- Fixed renderer-to-component wiring for Claude and dashboard actions.
- Fixed preload argument forwarding for project-aware service checks.
- Added cleanup for IPC listeners in multiple hooks.
- Reorganized frontend feature structure under `src/features/` and supporting layout/store folders.
- Expanded filesystem operations to support create, read, write, delete, rename, copy, move, duplicate, search, and Git flows.
- Upgraded the Explorer into a multi-pane IDE-style workspace.
- Replaced unreliable native tree drag/drop with a custom pointer-driven move flow.
- Added Git status, stage, unstage, and commit support in the Explorer.
- Added split editor view, dirty tab handling, inline rename, and improved tree visuals.

### Why It Matters

- The application is now significantly more stable and coherent as a desktop workflow tool.
- The Explorer is now a central productivity surface rather than a simple file list.
- Documentation now has a dedicated professional home and can scale with the codebase.

### Follow-Up Notes

- Continue adding dated entries for meaningful feature work.
- Prefer adding one well-written entry per working session rather than many tiny notes.

---

## 2026-07-10 - Documentation Expansion

### Scope

- Expanded project documentation into a more complete senior-level knowledge system.

### Key Changes

- Added roadmap documentation.
- Added architecture decision records.
- Added state and persistence documentation.
- Added deeper feature documentation for projects, dashboard, terminal, Claude, and persistence behavior.
- Added workflow and template documents for future maintenance.
- Added an AI handoff checklist for consistent context transfer.

### Why It Matters

- The Docs folder is now usable as both an engineering handbook and an AI operating context package.
- Future contributors can extend the system without inventing a new structure.

### Follow-Up Notes

- Continue documenting any major feature that grows beyond straightforward UI behavior.
