# Release Checklist

## Purpose

Use this checklist before packaging or shipping a meaningful build.

Private Windows publication and mandatory-update operations follow `Docs/04-Operations/PRIVATE_AUTO_UPDATES.md`. The offline preparation document is evidence-only and never publishes.

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
- private updater state transitions, Supabase entitlement/RLS, and authenticated artifact access
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
- `latest.yml` has a valid Ed25519 signature produced by `UPDATE_SIGNING_PRIVATE_KEY`
- installer size and SHA-512 exactly match the signed metadata
- the initial Windows `Unknown publisher` warning is documented for this no-cost stage

## Private Publication Gate

Before pushing or manually dispatching a release tag:

- [ ] Supabase migrations `20260809120000` and `20260809130000` are deployed and verified as described in `PRIVATE_AUTO_UPDATES.md`
- [ ] tag is exactly `vX.Y.Z` and matches `package.json`
- [ ] required GitHub `production` secrets and environment approval are available
- [ ] target account has effective `active` desktop entitlement and the bucket remains private
- [ ] workflow uploads installer, blockmap, and `latest.yml` in that order
- [ ] real signed-update validation and a forward-only rollback version are planned
- [ ] `1.0.0` users are covered by the manual `1.1.3` bootstrap; Storage publication alone cannot update them

Do not publish from the offline preparation flow or manually upload `latest.yml` ahead of its versioned artifacts. A rollback must be a new higher version, never a downgrade or a moved tag.
