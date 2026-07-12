# Changelog

## Unreleased

### Added

- Professional Docs folder structure with architecture and operations records.
- IDE-style Explorer with editor panes, Git integration, and advanced file operations.
- Filesystem guard layer for project-aware path validation.
- Basic automated tests for guarded filesystem path behavior.
- `Docs/00-Getting-Started/START_HERE.md` as a fast onboarding entrypoint.

### Changed

- Project title and path presentation in the custom titlebar.
- Explorer interaction model now uses a custom pointer-based move system.
- Explorer internals are now split into focused UI modules and feature hooks instead of a mostly monolithic implementation.
- App shell state now uses persisted `useAppStore` wiring for current project and theme.

### Fixed

- Service checks now receive project context correctly.
- Claude panel prop wiring and multiple IPC cleanup issues.
- Folder move behavior now preserves visible nested contents without manual refresh.
- File mutations now reject out-of-project targets and unsafe path traversal attempts.
