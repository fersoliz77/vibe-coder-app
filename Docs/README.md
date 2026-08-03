# Vibe IDE Code Documentation

This folder is the implementation reference for the Windows desktop application. Cross-product decisions are canonical in `../../ecosystem/` at the workspace root.

## Goals

- Keep technical knowledge organized, durable, and easy to audit.
- Allow any engineer or AI agent to understand the codebase quickly.
- Record what changed, when it changed, and why it changed.
- Separate stable system documentation from day-to-day work logs.

## Folder Map

- `Docs/01-Product/` - purpose, scope, user flows, product context.
- `Docs/02-Architecture/` - system design, frontend structure, Electron/IPC design.
- `Docs/03-Features/` - detailed behavior of major modules.
- `Docs/04-Operations/` - work log, changelog, maintenance procedures.
- `Docs/99-Governance/` - documentation rules and handoff standards.

## Reading Order

1. `Docs/00-Getting-Started/START_HERE.md`
2. `Docs/01-Product/PROJECT_OVERVIEW.md`
3. `Docs/02-Architecture/SYSTEM_ARCHITECTURE.md`
4. `Docs/02-Architecture/FRONTEND_ARCHITECTURE.md`
5. `Docs/02-Architecture/ELECTRON_IPC_ARCHITECTURE.md`
6. `Docs/03-Features/EXPLORER.md`
7. `Docs/04-Operations/WORK_LOG.md`

## Important Supporting Docs

- `Docs/02-Architecture/ARCHITECTURE_INDEX.md`
- `Docs/01-Product/ROADMAP.md`
- `Docs/02-Architecture/STATE_AND_PERSISTENCE.md`
- `Docs/02-Architecture/ADR-0001-EXPLORER-DRAG-MODEL.md`
- `Docs/02-Architecture/ADR-0002-FEATURE-FIRST-FRONTEND-STRUCTURE.md`
- `Docs/02-Architecture/ADR-0003-EXPLORER-MODULAR-HOOK-ARCHITECTURE.md`
- `Docs/04-Operations/DEVELOPER_WORKFLOWS.md`
- `Docs/04-Operations/TESTING_GUIDE.md`
- `Docs/04-Operations/RELEASE_CHECKLIST.md`
- `Docs/04-Operations/OFFLINE_RELEASE_PREPARATION.md`
- `Docs/04-Operations/DEBUGGING_GUIDE.md`
- `Docs/04-Operations/DOCS_AUDIT_2026-07-11.md`
- `Docs/99-Governance/AI_HANDOFF_CHECKLIST.md`

## Feature Docs With Current Detail Level

- `Docs/03-Features/EXPLORER.md`
- `Docs/03-Features/SERVICES.md`
- `Docs/03-Features/TERMINAL.md`
- `Docs/03-Features/CLAUDE.md`
- `Docs/03-Features/PROJECTS_AND_DASHBOARD.md`
- `Docs/03-Features/OPENCODE.md`

`Docs/03-Features/SERVICES_TERMINAL_CLAUDE.md` remains only as a legacy overview and should not be treated as the main implementation reference.

## Maintenance Rules

- Update feature docs when behavior changes.
- Add a dated entry to `Docs/04-Operations/WORK_LOG.md` for meaningful implementation work.
- Add a release-facing summary to `Docs/04-Operations/CHANGELOG.md` when user-visible behavior changes.
- Prefer plain, explicit wording over short or clever notes.
- Document why a decision was made, not only what changed.

## Current Baseline

This documentation set reflects the current Electron + React application structure, including global platform account authentication, seven-day offline access, restricted mode, the hardened project-aware filesystem bridge, modular Explorer, terminal integration, user-connected AI providers, services dashboard, Windows environment setup, guided cloud project provisioning, and store-backed project persistence. Desktop productive access remains limited to an active student with a valid lease; the web-only instructor role does not receive desktop access.
