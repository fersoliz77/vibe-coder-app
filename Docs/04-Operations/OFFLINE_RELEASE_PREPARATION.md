# Offline Release Preparation

## Scope

This workflow prepares and checks a Windows release candidate using only an existing local dependency tree and installer. It does not contact a release service, publish an update, install the package, modify a database, run migrations, use Git, or sign binaries.

The local manifest is release-candidate evidence, not proof that a release was published. Its `publishedAt` value is the proposed publication timestamp and must be reviewed or regenerated at the real publication gate.

The current private publication and mandatory-update procedure is `Docs/04-Operations/PRIVATE_AUTO_UPDATES.md`. None of the commands in this document uploads the installer, blockmap, `latest.yml`, or any other object.

## Manifest Contract

The canonical JSON Schema is `release/release-manifest.schema.json`. Runtime validation is dependency-free in `scripts/release-manifest.js` and requires exactly these fields:

- `version`: strict SemVer application version; `stable` rejects prerelease versions
- `channel`: `internal`, `pilot`, or `stable`
- `url`: intended HTTPS `.exe` URL, including a private authenticated endpoint when applicable, with no credentials or localhost endpoint
- `sha256`: lowercase SHA-256 of the installer
- `size`: installer size in bytes, limited to JavaScript's safe integer range
- `compatibility.minimumBackendVersion`: oldest compatible backend version
- `compatibility.minimumClientVersion`: oldest compatible client version
- `publishedAt`: the accepted RFC 3339 subset: UTC `Z`, required seconds, optional 1-9 fractional digits, and no leap seconds

The updater does not consume this JSON evidence manifest. The implemented private updater consumes the signed release's `latest.yml`, installer, and blockmap according to `PRIVATE_AUTO_UPDATES.md`.

## Offline Package

Use the existing npm cache and `node_modules`; do not install or update dependencies:

```bash
npm --offline run package
```

Packaging still requires the existing local auth configuration inputs used by `scripts/generate-auth-config.js`. This command builds a Windows installer under `dist-electron/` and must not be interpreted as publication or signature approval.

The Windows installer installs only the packaged application. It no longer starts `--install-environment` or installs external development tools. External tools are outside the installer artifact and hash; users must open Setup Center in onboarding, select installation, review the confirmation, and explicitly consent before those tools are installed.

## Generate Local Evidence

Generate a manifest and checksum for an existing installer. Replace compatibility versions and the intended future HTTPS URL with reviewed values:

```bash
npm run release:manifest -- --installer "dist-electron/Vibe IDE Code Setup 1.0.0.exe" --version 1.0.0 --channel internal --url "https://releases.example.invalid/Vibe-IDE-Code-Setup-1.0.0.exe" --minimum-backend 1.0.0 --minimum-client 1.0.0 --output "temp/build/release-manifest.json" --checksum "temp/build/Vibe IDE Code Setup 1.0.0.exe.sha256"
```

The generator requires `version` to match both `package.json` and the exact installer name `Vibe IDE Code Setup <version>.exe`. It only reads that installer and writes local files. It creates `temp/build/` when needed; that directory is ignored because release evidence should be regenerated from the final artifact.

The `.sha256` file contains a path relative to its own location. From `temp/build/` it resolves to `../../dist-electron/Vibe IDE Code Setup <version>.exe`, so the record is unambiguous and independently resolvable. The SHA-256 covers only the installer bytes. It does not cover unpacked smoke files, external tools, future downloads, metadata, or publication infrastructure.

## Verification

Check bounded PE headers and sections, Windows GUI subsystem, expected installer name, installer size/overlay, and the x64 machine field of the unpacked application:

```bash
npm run release:verify-installer -- "dist-electron/Vibe IDE Code Setup 1.0.0.exe" "dist-electron/win-unpacked/Vibe IDE Code.exe"
```

This is not installer-format authentication, malware analysis, or signature verification. `authenticode: present/not-verified` means only that a bounded PE certificate-table entry exists; `absent` means no entry was found. Neither result establishes signer identity or trust.

Validate the contract, size, and SHA-256:

```bash
npm run release:validate -- "temp/build/release-manifest.json" "dist-electron/Vibe IDE Code Setup 1.0.0.exe" "temp/build/Vibe IDE Code Setup 1.0.0.exe.sha256"
```

Run the non-installing static smoke gate:

```bash
npm run release:smoke -- --manifest "temp/build/release-manifest.json" --installer "dist-electron/Vibe IDE Code Setup 1.0.0.exe"
```

Optionally exercise the existing hidden sandbox smoke against the unpacked app. `--app` accepts only `win-unpacked/Vibe IDE Code.exe`, rejects the installer itself and Setup/installer names, and checks that the unpacked executable is x64 before launch. It never launches the installer:

```bash
npm run release:smoke -- --manifest "temp/build/release-manifest.json" --installer "dist-electron/Vibe IDE Code Setup 1.0.0.exe" --app "dist-electron/win-unpacked/Vibe IDE Code.exe"
```

## Explicitly Pending

- **OUTSIDE THIS FLOW: update metadata signing.** These offline commands never sign `latest.yml`; the production workflow uses the free `UPDATE_SIGNING_PRIVATE_KEY`, and the app verifies it with its embedded public key. Windows Authenticode is intentionally not used in this initial no-cost stage.
- **OUTSIDE THIS FLOW: updater validation.** This workflow does not exercise private Storage, JWT/RLS, mandatory states, download, restart, or installation.
- **OUTSIDE THIS FLOW: release publication.** No command in this workflow uploads an installer, blockmap, `latest.yml`, or manifest.
- **PENDING: production URL and compatibility approval.** Placeholder values are not release approval.
- **PENDING: signed-install manual validation.** Do not silently install a candidate; use an approved disposable test environment when this gate is authorized.
