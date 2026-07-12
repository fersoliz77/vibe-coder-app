# ADR-0002: Feature-First Frontend Structure

## Status

Accepted

## Date

2026-07-10

## Context

The project contains multiple distinct workspaces and desktop-specific behaviors. Grouping files only by type would make feature reasoning harder over time.

## Decision

The frontend is organized primarily by feature domain under `src/features/`, with supporting `layouts`, `hooks`, `store`, `styles`, and `utils` directories.

## Consequences

### Positive

- Easier onboarding for feature work.
- Better locality between UI and feature-specific styles.
- More maintainable mental model for both humans and AI agents.

### Negative

- Some shared concerns still need cross-feature coordination.
- Stores and hooks still require careful boundary discipline.

## Related Files

- `src/App.jsx`
- `src/features/`
- `src/hooks/`
- `src/store/`
