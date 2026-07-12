# Roadmap

## Purpose

This roadmap tracks medium-term product and engineering direction. It is intentionally higher level than the dated work log.

## Near Term

### 1. Explorer Hardening

- Continue validating drag and move behavior on complex folder structures.
- Add richer move feedback and stronger empty/error states.
- Improve large-project handling if tree size becomes a performance issue.

### 2. Documentation Maturity

- Expand feature docs for projects, dashboard, services, terminal, and Claude.
- Add decision records for major architecture choices.
- Keep dated work logs current after every significant session.

### 3. Git Workflow Maturity

- Expand the in-app Git panel beyond status and commit.
- Consider staged diff inspection and safer workflow affordances.

## Mid Term

### 1. Editor Experience

- Improve CodeMirror loading strategy.
- Add more advanced editor ergonomics and workflow polish.
- Evaluate whether split view should become more powerful.

### 2. Reliability and Test Coverage

- Add automated coverage for high-risk flows.
- Focus on explorer movement, Git actions, project persistence, and IPC boundaries.

### 3. Production Hardening

- Revisit Electron security posture.
- Review packaging, runtime assumptions, and Windows environment handling.

## Long Term

- Position the app as a stronger AI-assisted local coding workspace.
- Reduce manual setup friction around services and developer tooling.
- Standardize operator workflows so the app behaves predictably for both humans and AI agents.
