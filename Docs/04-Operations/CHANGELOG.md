# Changelog

## Unreleased

### Added

- Safe external-workspace analysis with bounded manifest discovery, multi-application detection, confidence evidence, and primary-target selection.
- External import review for monorepos and mixed stacks, with editing-only fallback when automatic preview is unavailable.
- Sidebar access to courses and learning progress through the trusted system-browser bridge.
- Dependency-free strict release manifest, relative checksum, bounded PE inspection, and installer-safe smoke tooling.
- Windows packaging no longer starts external development-tool installation; Setup Center retains explicit consent.
- Optional OpenCode agent with explicit installation consent and project-terminal launch.
- Independent OpenCode provider status for configured OAuth/API connections.
- Guided project creation for Next.js, React Vite, and Flutter Android plus Next.js mobile suites.
- Setup Center for Windows tool diagnosis and one-confirmation installation.
- Automatic private GitHub repository, personal Vercel project, production deployment, and backend provisioning.
- Firebase Spark Auth/Firestore and Supabase Nano client configuration.
- Bundled Supabase CLI and verified NSIS installer generation.
- Professional Docs folder structure with architecture and operations records.
- IDE-style Explorer with editor panes, Git integration, and advanced file operations.
- Filesystem guard layer for project-aware path validation.
- Basic automated tests for guarded filesystem path behavior.
- `Docs/00-Getting-Started/START_HERE.md` as a fast onboarding entrypoint.

### Changed

- Project creation and import now persist the same target-based workspace model for details, preview, and linked Vercel status.
- Project details now describe applications, stacks, backend, repository, deployment, Git state, dates, and local location instead of repeating learning progress.
- Private GitHub repository copy now explains who can access the generated repository.
- Agent terminals now close when switching projects, and OpenCode uses a main-process-resolved executable instead of shell lookup.
- Project import and registration now validate paths in the Electron main process.
- Windows packaging uses tested native prebuilds instead of requiring Visual Studio Build Tools.
- Project title and path presentation in the custom titlebar.
- Explorer interaction model now uses a custom pointer-based move system.
- Explorer internals are now split into focused UI modules and feature hooks instead of a mostly monolithic implementation.
- App shell state now uses persisted `useAppStore` wiring for current project and theme.

### Fixed

- Android SDK provisioning no longer tries to upgrade an existing Android Studio package through WinGet.
- Service checks now receive project context correctly.
- Claude panel prop wiring and multiple IPC cleanup issues.
- Folder move behavior now preserves visible nested contents without manual refresh.
- File mutations now reject out-of-project targets and unsafe path traversal attempts.
