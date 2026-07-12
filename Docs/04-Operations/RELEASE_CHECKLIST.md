# Release Checklist

## Purpose

Use this checklist before packaging or shipping a meaningful build.

## Pre-Release Review

- confirm `Docs/04-Operations/CHANGELOG.md` is up to date
- confirm `Docs/04-Operations/WORK_LOG.md` includes the relevant work session
- confirm architecture or feature docs were updated if behavior changed

## Functional Validation

- verify project selection and project switching
- verify dashboard loads without runtime errors
- verify explorer operations that were touched in the release
- verify terminal creation and close flow
- verify Claude availability and prompt flow if relevant
- verify service checks if relevant

## Build Validation

```bash
npm run build
```

Expected outcome:

- build completes successfully
- no new fatal warnings or broken imports

## Packaging Validation

```bash
npm run package
```

Expected outcome:

- packaged output is generated in the configured release folder
- app opens correctly outside the dev flow if tested manually

## Desktop-Specific Validation

- custom titlebar controls work
- path opening actions work on Windows
- filesystem operations behave correctly on real local paths
- terminal integration still works with native dependencies

## Risk Review

Before release, specifically review these areas:

- explorer file moves and nested folder behavior
- store-backed persistence and project resume behavior
- Electron IPC changes
- native dependency assumptions
- Git action behavior inside the explorer

## Documentation Closeout

- update changelog
- update work log
- add ADR if an architectural decision was introduced

## Final Gate

Do not consider the release ready unless:

- build passes
- packaging passes
- affected workflows were manually validated
- documentation is current
