# AI Handoff Checklist

Use this checklist before handing the project to another AI or asking a new AI to continue work.

## Minimum Context Package

- `Docs/README.md`
- `Docs/01-Product/PROJECT_OVERVIEW.md`
- `Docs/02-Architecture/SYSTEM_ARCHITECTURE.md`
- Relevant feature doc under `Docs/03-Features/`
- Latest entries in `Docs/04-Operations/WORK_LOG.md`

## Required Questions the Docs Should Answer

- What is the app?
- Which files own the feature in question?
- How does the renderer talk to Electron?
- What persistence layers exist?
- What changed recently?
- What areas are risky?

## Session Closeout Rule

Before ending a significant implementation session:

- update feature docs if behavior changed
- append a dated work log entry
- update changelog if users will notice the change
- add or update an ADR if an architectural decision was made
