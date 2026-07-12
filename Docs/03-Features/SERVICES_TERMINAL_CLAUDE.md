# Services, Terminal, and Claude

## Status

This file is now a legacy overview only.

Use the dedicated feature documents for current implementation detail:

- `Docs/03-Features/TERMINAL.md`
- `Docs/03-Features/CLAUDE.md`
- `Docs/03-Features/PROJECTS_AND_DASHBOARD.md`

The service-specific behavior in this file is intentionally summarized and should not be treated as the main source of truth.

## Services

Relevant files:

- `src/hooks/useServices.js`
- `src/features/dashboard/Dashboard.jsx`
- `src/features/services/*`
- `electron/services/serviceManager.js`

Responsibilities:

- Check service status per project
- Refresh all or individual service checks
- Surface connectivity state in the dashboard

## Terminal

Relevant files:

- `src/hooks/useTerminal.js`
- `src/features/terminal/TerminalPanel.jsx`
- `electron/services/terminalManager.js`

Responsibilities:

- Create terminal sessions bound to the current project path
- Stream terminal data to xterm
- Track active tabs and close behavior

## Claude

Relevant files:

- `src/hooks/useClaude.js`
- `src/features/claude/ClaudePanel.jsx`
- `electron/services/claudeManager.js`

Responsibilities:

- Check CLI availability
- Send prompts from the current workspace
- Stream output into the renderer
- Track running state and completion state
