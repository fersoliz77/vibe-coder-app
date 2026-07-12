# Claude Feature

## Purpose

The Claude feature provides an AI interaction panel scoped to the current project workspace.

## Primary Files

- `src/hooks/useClaude.js`
- `src/features/claude/ClaudePanel.jsx`
- `src/features/claude/ClaudePanel.css`
- `electron/services/claudeManager.js`

## Key Capabilities

- Detect whether Claude Code CLI is installed
- Detect whether the current CLI is authenticated
- Install Claude Code CLI from inside the app
- Launch browser-based login flow for Anthropic authentication
- Send prompts scoped to the active project working directory
- Stream assistant output progressively into the renderer
- Cancel active runs and preserve partial output in the conversation

## Behavior

- Detects whether the Claude CLI is installed.
- Sends prompts from the renderer to the Electron main process.
- Runs Claude as a subprocess with a cleaned environment.
- Streams stdout and stderr into the renderer.
- Tracks in-progress output until completion or cancellation.

## Important Internal Behaviors

### Status Model

- `src/hooks/useClaude.js` tracks `installed`, `authenticated`, `path`, `version`, and `loading` status fields.
- `electron/services/claudeManager.js` resolves CLI presence with `where claude` on Windows or `which claude` on Unix-like systems.
- Authentication is inferred through `claude config list` output.

### Setup States

- If Claude is not installed, the panel shows an install workflow.
- If installed but not authenticated, the panel shows a login workflow.
- If authenticated, the panel switches into full chat mode.

### Conversation Model

- User messages are appended immediately.
- Streaming assistant text is held in temporary response state.
- On completion, the final assistant response is committed to message history.
- On cancel, the partial response is saved with a cancelled marker.
- Errors are appended as explicit `error` messages in the conversation.

### Main Process Execution Model

- Only one active Claude subprocess is supported at a time.
- Starting a new prompt kills any previously active process.
- Prompt execution uses `claude --print <prompt>` with the active project path as `cwd` when available.
- The manager clears Electron-specific environment variables before launching CLI commands.

### Progress Streaming

- Install progress is emitted as `claude:install-progress`.
- Login progress is emitted as `claude:login-progress`.
- Prompt output is emitted as `claude:data`.
- Completion and error states are emitted separately so renderer state can finalize correctly.

## Current Constraints

- The feature depends on a local Claude CLI installation outside the bundled app.
- Authentication state is derived from CLI behavior rather than a dedicated SDK session.
- Only one active Claude run is supported per app instance at a time.
- Prompt history is currently in-memory and is not persisted across app restarts.

## Risk Notes

- This feature depends on a local Claude CLI installation.
- Environment issues or CLI path discovery problems can block execution.
- Long-running prompts and cancellation flows should be tested carefully because they span renderer, preload, and subprocess boundaries.

## Known Maintenance Note

Any change to CLI detection, auth flow, progress streaming, cancellation, or subprocess environment handling should be validated in the actual Electron runtime.
