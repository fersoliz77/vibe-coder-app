# Projects and Dashboard

## Purpose

These surfaces handle project entry, project registration, and the default control-center view after a project is selected.

## Projects

### Primary Files

- `src/features/projects/ProjectList.jsx`
- `src/features/projects/ProjectList.css`
- `electron/services/projectManager.js`
- `electron/services/projectProvisioner.js`
- `electron/services/environmentManager.js`
- `src/features/projects/CreateProjectWizard.jsx`
- `src/features/setup/SetupCenter.jsx`
- `src/store/useAppStore.js`

### Responsibilities

- List known local projects from the registry
- Create complete web or mobile-suite projects through a guided wizard
- Import an existing folder and register it
- Open an existing project and update its last-opened timestamp
- Remove a project from the registry without deleting it from disk
- Surface global provider status before a project is entered
- Diagnose and install the Windows development environment
- Create and connect private GitHub, Vercel, Firebase, and Supabase resources

### Guided Creation

- Web projects support Next.js TypeScript and React Vite TypeScript.
- Mobile suites use one private repository with `web/` for Next.js and `mobile/` for Flutter Android.
- Vercel is always the web deployment provider and uses the authenticated personal scope.
- The backend choice is exclusive: Firebase Spark with Auth and Firestore, or Supabase Nano.
- Firebase Storage and Hosting are intentionally excluded; Vercel handles web hosting.
- New projects default to `Documents\Vibe Projects`, with a native folder picker to change the parent directory.
- Provider operations expose progress, support cancellation, and preserve partial local work without automatically deleting remote resources.

### Setup Center

- Detects Node.js, npm, Git, GitHub CLI, Vercel CLI, the selected backend CLI, Flutter, JDK 17, and Android SDK.
- Installs missing allowlisted tools only after one explicit user confirmation.
- Supabase CLI is bundled with the desktop application.
- Flutter is installed from the official stable repository when needed.
- The project list warns when required tools are missing, and Settings provides the permanent environment management surface.

### Project Registry Model

- `electron/services/projectManager.js` persists projects in `projects.json` under Electron `userData`
- Each project record contains `id`, `name`, `path`, `createdAt`, and `lastOpened`
- Duplicate imports are de-duplicated by path and instead refresh `lastOpened`
- Registered project paths are also used by guarded filesystem IPC as an allowlist boundary

### Persistence

- Project registry lives in the Electron user data folder.
- App store persists the current project and recent projects for quick resume.

### UI Behavior Notes

- `ProjectList.jsx` loads registered projects on mount through `window.electronAPI.projects.list()`.
- Creating uses short-lived main-process location grants. Importing is completed atomically by a native main-process dialog.
- Selecting a card updates `lastOpened` before switching into the workspace.
- Removing a card unregisters the project from the app but does not delete the folder from disk.

## Dashboard

### Primary Files

- `src/features/dashboard/Dashboard.jsx`
- `src/features/dashboard/Dashboard.css`
- `src/hooks/useServices.js`
- `src/features/services/GlobalServices.jsx`
- `src/features/services/ServiceCard.jsx`

### Responsibilities

- Show current project context
- Summarize service connectivity
- Provide quick actions into Terminal and Claude
- Trigger service checks

### Important Internal Behaviors

#### Landing Role

- Dashboard is the default landing view after project selection.
- It acts as a coordination layer rather than a deep workflow surface.
- The main quick actions route users into Terminal and Claude.

#### Service Status Summary

- `Dashboard.jsx` consumes the `useServices()` hook output.
- The sidebar uses `GlobalServices.jsx` to show high-level provider state.
- The main stat highlights how many services are currently connected.

#### Global vs Project Context

- Before a project is selected, service checks can still show global authentication status.
- After a project is selected, the dashboard refresh path passes `currentProject.path` so project-linked metadata can appear.
- `GlobalServices.jsx` shows project linkage details such as linked repo, branch, or deployment identifier when `inProject` is true.

### Notes

- Dashboard is the default landing view after project selection.
- It is intentionally lightweight and acts as a control center rather than a deep workflow surface.

## Known Maintenance Notes

- Project selection and app resume behavior should always be validated together because they span renderer state, store persistence, and the project registry.
- Service cards and dashboard summaries depend on CLI availability and may differ across local developer environments.
