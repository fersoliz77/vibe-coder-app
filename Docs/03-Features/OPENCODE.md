# OpenCode Integration

## Purpose

OpenCode is an optional third AI agent alongside Claude Code and the direct OpenAI/Codex integration. It runs as its native terminal UI inside a project-scoped PTY.

## Primary Files

- `electron/services/openCodeManager.js`
- `electron/services/terminalManager.js`
- `src/features/opencode/OpenCodeSetupDialog.jsx`
- `src/components/icons/OpenCodeIcon.jsx`
- `src/hooks/useTerminal.js`
- `src/App.jsx`

## Installation Policy

- OpenCode is not bundled and is not part of Setup Center's project requirements.
- Detection never installs or updates software.
- The audited package is pinned to `opencode-ai@1.17.18` and installed globally through npm.
- Existing valid OpenCode installations are reused regardless of whether they came from npm, Chocolatey, Scoop, or another official Windows method.

There are two installation paths, and they consent differently. Describing only
the first one is what let the second one drift:

| Path | Entry point | Consent | Also installs |
| --- | --- | --- | --- |
| In-app | `opencode:install` IPC, from Setup Center or the OpenCode panel | Native Electron dialog naming the package | Nothing else |
| First-run bootstrap | `bootstrap:start`, from the installer window | The welcome screen enumerates both packages before the start button | `@anthropic-ai/claude-code` |

- On the in-app path, installing OpenCode does not install Claude Code or Codex.
- The bootstrap prepares the full environment in one pass, so it installs Claude
  Code as well. It must name both packages on the welcome screen before the user
  starts it; `tests/bootstrapConsent.test.js` enforces that.
- Neither path may install anything the user was not shown first.

## Launch Model

- The Sidebar and Dashboard expose OpenCode while a project is active.
- Electron resolves the trusted `opencode.exe` path in the main process.
- `terminal:create` accepts the allowlisted `opencode` mode and starts the executable directly in the registered project root.
- The renderer cannot provide an executable path or interpolate the project path into a shell command.
- OpenCode exits with its terminal tab; switching projects closes existing terminals so an agent cannot continue against the previous workspace.

## Authentication

- OpenCode owns its credentials in its normal local data directory.
- Vibe reads only the provider names returned by `opencode auth list`; raw credentials never cross IPC.
- Users connect providers with `/connect` inside OpenCode.
- ChatGPT Plus/Pro OAuth is supported by OpenCode without requiring a separate Codex installation.
- Claude Code and OpenAI/Codex authentication remain independent.

## Windows Notes

- Native Windows installation through npm is officially supported; OpenCode recommends WSL for its best overall Windows experience.
- The integrated native PTY prepends npm's global bin directory and provides the standard Git Bash path when available.
- Provider costs, model access, permissions, sessions, and updates remain the user's responsibility.
