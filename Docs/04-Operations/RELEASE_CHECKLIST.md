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
npm --offline run build
```

Expected outcome:

- build completes successfully
- no new fatal warnings or broken imports

## Packaging Validation

```bash
npm --offline run package
```

Expected outcome:

- packaged output is generated in the configured release folder
- app opens correctly outside the dev flow if tested manually
- packaging does not install or publish the generated NSIS artifact

## Local Artifact Gate

Follow `Docs/04-Operations/OFFLINE_RELEASE_PREPARATION.md` and record all of these results:

- [ ] installer and unpacked x64 app pass `npm run release:verify-installer -- <installer.exe> <win-unpacked/Vibe IDE Code.exe>`
- [ ] local manifest uses the contract in `release/release-manifest.schema.json`
- [ ] channel is exactly `internal`, `pilot`, or `stable`
- [ ] intended download URL is HTTPS and contains no credentials
- [ ] backend and client minimum compatibility versions were reviewed
- [ ] installer byte size and SHA-256 match the manifest
- [ ] checksum path resolves from `temp/build/` to the exact installer and validates independently
- [ ] `publishedAt` is reviewed as a proposed publication timestamp
- [ ] static `release:smoke` passes without running the installer
- [ ] optional unpacked-app smoke passes if the environment permits launching it
- [ ] evidence was generated under `temp/build/` from the final candidate

The PE check is structural only. It does not authenticate installer format, prove installation succeeds, or verify Authenticode trust. Certificate-table presence is reported only as `present/not-verified` or `absent`.

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
- local manifest, relative checksum, PE structure, x64 unpacked app, and smoke checks pass
- installer configuration contains no automatic external-tool installation

## Mandatory Pending Gates

An offline candidate is **not publishable** while any item below remains pending:

- [ ] **PENDING: Authenticode signing and certificate trust verification**
- [ ] **PENDING: updater implementation and security review**
- [ ] **PENDING: release publication approval and upload**
- [ ] **PENDING: final production URL and compatibility approval**

Do not implement automatic updates without an approved dependency and signing certificate. Do not silently install the NSIS package during release preparation.
