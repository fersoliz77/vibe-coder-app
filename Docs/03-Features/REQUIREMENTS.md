# Requirements Center

## Purpose

The Requirements Center analyzes an imported workspace after onboarding and presents optional remediation actions. Analysis is read-only. No command, file modification, or network access occurs until the user reviews and confirms one specific action.

## User Flow

1. Import and analyze a workspace.
2. Open Requirements from the sidebar, dashboard, or project list.
3. Review detected applications, missing dependencies, evidence, and limitations.
4. Preview one available action and its expected disk requirement.
5. Confirm that action in the consent dialog.
6. Follow staged progress or cancel the running process.

There is no bulk apply operation. Each action requires a separate review and grant.

## Security Boundaries

- Workspace analysis reads bounded manifests and lockfiles only.
- Renderer-facing IPC returns minimal public project and requirement contracts.
- Grants expire after five minutes and use a single-use 256-bit confirmation nonce.
- The main process hashes and revalidates relevant files immediately before execution.
- Managed dependency installation requires a validated npm lockfile.
- The only managed install command is `npm ci --ignore-scripts --no-audit --no-fund` with `shell: false` and isolated npm configuration.
- A workspace `.npmrc` disables managed installation rather than allowing private configuration to affect execution.
- Verification retry cannot execute another command or repeat installation.

## Recovery

Project registry writes retain a last-known-good backup. Invalid records are normalized when safe, while corrupt registries are preserved separately and recovered from backup when possible. The application reports repaired, recovered, or unavailable state through a dismissible global notice without exposing local paths.

## Main Components

- `electron/services/requirementsManager.js`: requirement state, grants, execution, progress, cancellation, disk checks, and verification retry.
- `electron/services/projectContracts.js`: persisted-record validation and public IPC contracts.
- `electron/services/projectManager.js`: registry persistence, backup, repair, and recovery.
- `src/features/requirements/RequirementsCenter.jsx`: review and action status UI.
- `src/features/requirements/ActionConsentDialog.jsx`: per-action consent and execution progress.
