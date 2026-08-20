# Changelog

## Unreleased

### Added

- Preview for a folder that only holds `index.html`: Vibe serves it itself, without running any project code, which is the first project almost every student writes.
- A plain answer to how a project starts. When Vibe cannot start it, the real command from the project's own manifest is shown instead of a message about a missing managed profile.
- Recognition that a folder holds several unrelated projects rather than one, so choosing the wrong folder says so instead of offering to open fifteen products as if they were parts of one.
- Jupyter notebooks, R, Arduino and Astro sources are recognised as projects.
- File-level stack detection, so a project is read even with no declared dependencies: language from its sources, web from an `index.html`, backend from an entry point that starts a server, and databases from schema, migration, and SQLite files.
- Projects with no manifest at all are now recognised from their sources instead of being reported as an unknown folder, while code confined to helper folders does not turn a documentation repository into an application.
- The sidebar version is now a control: it shows the installed version and checks for updates on click, with its own spinner and outcome.
- Progress and cancellation for every workspace analysis, including project reanalysis and the analysis that runs before an approved requirement action.
- Plain-language product summary when importing an external folder, grouping manifests into products with the platforms detected inside each one.
- Live analysis progress during external import, with cancellation that stops the scan instead of leaving it running.
- Course signals reported from the desktop application so a lesson can confirm its own steps.
- Project search and persistent favorites keyed only by project ID.
- Safe Preview repair resolved in the main process from a project ID, with serialized managed-process restart.
- Versioned editor-tab restoration using validated project-relative paths without drafts or file contents.
- In-place Courses retry and local version history in Settings.
- Post-onboarding Requirements Center with per-action review, explicit consent, progress reporting, and safe cancellation.
- Read-only workspace requirement detection for npm workspaces, pnpm workspaces, nested applications, and hoisted dependencies.
- Recoverable project-registry backups with a dismissible application-level recovery notice.
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

- Importing a folder is one confirmed action instead of a four-step wizard: the setup plan is prepared automatically and shown with the result, and the full analysis moved behind a disclosure.
- External workspace analysis runs to completion instead of stopping at a fixed time budget; the remaining limits guard against pathological folders rather than latency.
- Electron and React Native applications are reported by the platform they actually run on instead of being reported as web.
- The project list is loaded lazily to keep the initial bundle within its budget.
- Legacy editor persistence containing absolute paths is removed during configuration migration.
- Renderer project data now uses minimal public contracts instead of persisted main-process records.
- Managed dependency installation is limited to validated lockfiles and `npm ci --ignore-scripts --no-audit --no-fund` with an isolated npm configuration.
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

- Preview no longer requires the development script to read exactly `vite` or `next dev`. The script is now read as a command, so `next dev --turbopack` (what `create-next-app` generates today), `vite --host`, Create React App, Astro, Nuxt, Angular, SvelteKit, Vue CLI, Gatsby, Remix, webpack and Parcel all start from the same button. Chained scripts are still refused, because there is no way to know which command the added arguments would reach.
- A project Vibe cannot start on its own no longer becomes a requirement that can never be completed. Its action declared itself unsupported, so the review button led nowhere while the sidebar kept a badge the student could not clear.
- Repository and deployment are no longer shown as pending on a project that was opened from disk and never provisioned. A local point-of-sale application owed nobody a GitHub link.
- Preview failures now say what happened in the student's own language -- libraries not installed, port already taken, code that does not compile -- instead of forwarding a raw npm line or one generic retry message.
- A project deduced only from loose source files is now reported as code rather than as a backend. A first Java class or C exercise was being described with an architecture nobody wrote.
- A skipped symbolic link no longer counts as an incomplete analysis. Opening an ordinary Windows user folder produces dozens of them, and each one downgraded readiness and showed a partial-analysis warning when nothing had been missed.
- The native platform folders Flutter and React Native generate are no longer read as separate applications. A single Flutter app produced nine, and its generated `CMakeLists.txt` and `web/index.html` made it report backend and web platforms it does not have.
- Update checks no longer fail for the first minutes after launch. The offline lease keeps access active with an already-stale token, which the updater sent as-is; a rejected token is now refreshed once and the check retried, instead of failing until the periodic revalidation happened to renew it.
- Each refusal from the update service is now reported as what it is — expired session, inactive subscription, missing asset, unavailable store or service — instead of one message telling everyone to try again, which is the one thing that cannot help most of those cases.
- The support report now carries update state and transitions. It previously recorded only differential-download events, so it was empty for the failure it exists to diagnose.
- A private package that starts with `npm start` is no longer classified as a shared library. `private: true` means the opposite of a library — it is what applications declare — and only `dev` counted as a run script, so an application starting with `start` was reported as a library and its folder as having no application at all.
- The sidebar no longer shows a hand-written version that stayed at the first release while the application had already shipped many others.
- Embedded Courses and Progress now uses the canonical learning origin, and packaging rejects mismatched learning domains.
- Dependency actions now check free disk space before execution and retry only post-install verification when verification is inconclusive.
- Corrupt or oversized project registries are repaired or recovered without exposing internal paths or errors to the renderer.
- Android SDK provisioning no longer tries to upgrade an existing Android Studio package through WinGet.
- Service checks now receive project context correctly.
- Claude panel prop wiring and multiple IPC cleanup issues.
- Folder move behavior now preserves visible nested contents without manual refresh.
- File mutations now reject out-of-project targets and unsafe path traversal attempts.
