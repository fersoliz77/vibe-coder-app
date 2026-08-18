# Work Log

This log records implementation history in chronological order. Each entry should capture the date, scope, and why the work mattered.

---

## 2026-08-16

### Scope

- Fixed update checks failing for the first minutes after every launch.
- Made the update service's refusals distinguishable, and made the support report cover updates.
- Prepared desktop release `1.1.22`.

### Key Changes

- Refreshed the session once and retried when the update feed rejects the token. The offline lease deliberately keeps the policy active without network, but `getUpdateCredentials()` handed the updater the stored access token unchecked, so every launch had a window where checks failed until the five-minute revalidation renewed it. Diagnosed from a live Worker tail: the first successful `latest.yml` landed at 21:07:06 for a session that started at 21:02:10.
- Classified the feed failure by its HTTP status instead of collapsing everything into `UPDATE_CHECK_FAILED`, and gave each code its own text. Retrying cannot fix an inactive subscription, and the previous copy told the user to do exactly that.
- Recorded update state and transitions in diagnostics. The report previously logged only differential-download events, which happen after the point where checks actually fail, so it was empty for the case it exists to diagnose.

### Validation

- `npm run check` with 426 passing tests.
- Four new update-manager tests: refresh-and-retry, a token still rejected after refreshing, one assertion per refusal status, and the diagnostics state and transition.
- Verified the release chain end to end against the live Worker: entitlement, GitHub resolution, and ranged installer download all returned Ok.

---

## 2026-08-15 (stack detection)

### Scope

- Made workspace analysis read a project even when it declares no dependencies.
- Fixed an inverted rule that reported applications as shared libraries.
- Prepared desktop release `1.1.21`.

### Key Changes

- Corrected the library rule: `private: true` is what an application declares, not a library, and only `dev` counted as a run script. A local POS that starts with `npm start` was classified as a library, which left its folder reported as having no application. A package is now a library only when it declares a publishable entry point and no run script, and a manifest declaring `workspaces` is workspace scaffolding rather than a product.
- Added a file-evidence layer collected during the existing directory walk, with no second pass: language counts by extension, `index.html` as a web signal, and schema, migration, and SQLite files as database signals.
- Read a bounded number of entry points to tell a loose script from a server, matching only static patterns and never executing project code.
- Synthesised a target from file evidence when a folder has no manifest at all, so a plain HTML page or a Python script is a project instead of an unknown folder.
- Excluded code confined to helper folders from that synthesis, after a documentation repository with five maintenance scripts was reported as an application.

### Validation

- `npm run check` with 422 passing tests.
- Six new analyzer tests covering the private-package rule, publishable libraries, manifest-less projects, language-only projects, file-based database evidence, and the documentation-repository case.
- Verified against three real folders: a dependency-free POS, a two-product workspace, and a documentation repository.

---

## 2026-08-15 (later)

### Scope

- Fixed the sidebar version, which had stayed at the first release while the application had shipped eighteen more.
- Turned that version into the check-for-updates control.
- Prepared desktop release `1.1.20`.

### Key Changes

- Read the installed version from `app.getVersion()` through the existing update-history channel, the same source the Settings release list already used, instead of a literal in the component.
- Moved the version styling out of inline styles, which bypassed the typographic scale and were invisible to the literal gate.
- Made the version a button that checks for updates, with its own spinner, a stable outcome for up-to-date and failed checks, and no check at all without active access, so the spinner can never hang.
- Left the available-update path to the existing mandatory gate, which already takes over the screen on a state change.

### Validation

- `npm run check` with 416 passing tests.
- Added tests that fail if the version is hand-written again or if the control loses its busy state, accessible label, or access guard.

---

## 2026-08-15

### Scope

- Extended analysis progress and cancellation to the five call paths that had inherited the longer scan without feedback.
- Reduced external folder import from a four-step wizard to one confirmed action.
- Prepared desktop release `1.1.19`.

### Key Changes

- Added a shared scan-reporting helper in the requirements manager so reanalysis, the pre-action analysis, and verification all report the folder being read and can be stopped; reanalysis previously discarded its result on cancel while the scan kept running.
- Gave the pre-action analysis its own `analyzing` stage, which previously ran before the first reported stage and left the screen blank.
- Exposed `requirements:cancel-analysis` so reanalysis has an exit, and routed its progress away from the action consent dialog.
- Kept project provisioning's analysis cancellable, except on the recovery path where the folder already exists and must still be registered.
- Removed the separate plan step from import: the plan asks for no new decision, so it is prepared automatically when the application is chosen and shown next to the result. The main-process contract is unchanged, and changing the selected application re-plans before anything can be confirmed.
- Moved the score, readiness checks, structure, and setup map behind a labelled disclosure, keeping the tablist and its keyboard navigation intact.
- Made product cards the selection when more than one application exists, and removed the choice entirely when there is only one.

### Validation

- `npm run check` with 413 passing tests.
- Token, font, literal, breakpoint, accessibility, contrast, design-system, build, and bundle-budget checks passed.
- Eight dead locale keys from the removed plan step were pruned.

---

## 2026-08-14

### Scope

- Made external folder import answer what the folder contains before asking the user to decide.
- Removed the latency budget from workspace analysis and replaced it with reported progress.
- Added course signals reported from the desktop application.
- Prepared desktop release `1.1.18`.

### Key Changes

- Grouped detected manifests into products by product folder, treating monorepo containers (`apps/`, `packages/`) as holders of one product per child, and derived each product's platforms, technologies, and runnable target.
- Reported Electron as desktop plus web and React Native as mobile, deriving platforms from declared shells instead of the target kind, which keeps already-persisted target IDs stable.
- Replaced the 2500 ms scan cutoff with limits that guard against pathological folders, so a normal folder is analyzed completely instead of returning a partial result.
- Emitted bounded scan progress over `projects:import-progress` through the same public contract as the analysis, and made cancelling the dialog abort the scan instead of leaving it running.
- Resolved each declared dependency once per manifest instead of walking `node_modules` twice.

### Validation

- `npm run check` with 410 passing tests, run three consecutive times.
- Token, font, literal, breakpoint, accessibility, contrast, design-system, build, and bundle-budget checks passed.
- Product grouping verified against a real multi-product folder, and progress verified end to end on the same folder.

---

## 2026-08-12

### Scope

- Added project search, favorites, safe Preview repair, and secure editor-tab restoration.
- Added recoverable Courses loading and a local release history.
- Prepared desktop release `1.1.17`.

### Key Changes

- Persisted favorites as bounded project IDs and kept project filtering local and accessible.
- Added a main-process Preview repair operation that resolves only registered project IDs, serializes transitions, and waits for managed process termination before restart.
- Replaced absolute editor-state persistence with a versioned manifest of validated relative paths and re-read every restored file from disk.
- Removed legacy absolute-path editor records and lazy-loaded the project list to reduce the initial bundle.

### Validation

- `npm run check` with 384 passing tests.
- Token, font, literal, accessibility, contrast, design-system, build, and bundle-budget checks passed.
- `git diff --check` passed.

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
