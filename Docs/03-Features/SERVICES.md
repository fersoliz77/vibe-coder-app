# Services Feature

## Purpose

The services feature shows authentication and project-link status for external developer providers used around the workspace.

## Primary Files

- `src/hooks/useServices.js`
- `src/features/services/GlobalServices.jsx`
- `src/features/services/GlobalServices.css`
- `src/features/services/ServiceCard.jsx`
- `src/features/services/ServiceCard.css`
- `electron/services/serviceManager.js`

## Key Capabilities

- Check global auth state for Vercel, Supabase, GitHub, Git, and Firebase
- Check project-linked state when a project path is available
- Refresh all services at once
- Refresh a single service card
- Surface account identity and project linkage in the renderer
- Provide login or logout command suggestions through IPC helpers

## Important Internal Behaviors

### Service Set

The current service set is:

- Vercel
- Firebase
- Supabase
- GitHub
- Git

The renderer initializes these services in `useServices.js` with `checking: true` and fills them with live data after the first check.

### Global vs Project-Aware Checks

- Global status can be checked without an active project path.
- Project-aware checks add metadata such as linked repository, branch, deployment project, or backend project id.
- `useServices(projectPath)` passes the active project path into preload when available.

### Polling Model

- `useServices.js` runs an immediate check on mount.
- It also runs a silent refresh every 5 minutes.
- Silent refreshes avoid forcing the visible checking state on every poll cycle.

### Main Process Detection Model

`electron/services/serviceManager.js` uses CLI commands and local project files to infer status.

Examples:

- Vercel: `vercel whoami` plus `.vercel/project.json`
- Supabase: `supabase orgs list` or `supabase projects list` plus `supabase/config.toml`
- GitHub: `gh auth status` plus git remotes
- Git: `git --version`, global email, and local branch state
- Firebase: `firebase login:list` or `firebase projects:list` plus `firebase.json` and `.firebaserc`

### Renderer Surfaces

- `GlobalServices.jsx` renders a compact list-oriented provider summary.
- `ServiceCard.jsx` renders a richer card view for single-service status and refresh actions.
- Dashboard and project entry flows may use different service surfaces depending on layout needs.

## Data Flow

1. Renderer calls `useServices(projectPath)`.
2. Hook requests `services:check-all` or `services:check` through preload.
3. Main process runs CLI checks and local file inspections.
4. Results return as normalized service objects.
5. Renderer updates list state and derived connected counts.

## Current Constraints

- Status accuracy depends on local CLI installation and shell environment.
- Some providers expose auth state more reliably than project-link state.
- Service checks are read-heavy and environment-specific, so results may vary across machines.
- Connect flows currently return suggested commands rather than fully owning login UX for every provider.

## Risk Notes

- CLI output formats can change and break parsing logic.
- Windows PATH differences are a common source of false negatives.
- Project-linked state can be misleading if local config files exist but auth is stale.

## Known Maintenance Note

Any change to provider parsing, polling cadence, project-path forwarding, or service UI assumptions should be validated against at least one real project on Windows.
