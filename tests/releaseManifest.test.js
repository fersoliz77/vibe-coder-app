const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fixtures = require('./fixtures/release-manifests.json');
const packageJson = require('../package.json');
const { generateManifest } = require('../scripts/generate-release-manifest');
const {
  RFC3339_PATTERN,
  SEMVER_PATTERN,
  STABLE_SEMVER_PATTERN,
  URL_PATTERN,
  readManifest,
  validateReleaseManifest,
  verifyChecksumFile,
  verifyManifestArtifact,
} = require('../scripts/release-manifest');
const { inspectWindowsInstaller } = require('../scripts/verify-windows-installer');
const { validatePackagedAppPath } = require('../scripts/release-smoke');

function createPe(filePath, { machine = 'x64', overlayBytes = 0 } = {}) {
  const peOffset = 0x80;
  const optionalSize = machine === 'x64' ? 240 : 224;
  const optionalOffset = peOffset + 24;
  const sectionOffset = optionalOffset + optionalSize;
  const sizeOfHeaders = 0x400;
  const rawOffset = 0x400;
  const rawSize = 0x200;
  const pe = Buffer.alloc(rawOffset + rawSize + overlayBytes);
  pe.write('MZ', 0, 'ascii');
  pe.writeUInt32LE(peOffset, 0x3c);
  pe.write('PE\0\0', peOffset, 'ascii');
  pe.writeUInt16LE(machine === 'x64' ? 0x8664 : 0x014c, peOffset + 4);
  pe.writeUInt16LE(1, peOffset + 6);
  pe.writeUInt16LE(optionalSize, peOffset + 20);
  pe.writeUInt16LE(machine === 'x64' ? 0x20b : 0x10b, optionalOffset);
  pe.writeUInt16LE(2, optionalOffset + 68);
  pe.writeUInt32LE(sizeOfHeaders, optionalOffset + 60);
  pe.write('.text', sectionOffset, 'ascii');
  pe.writeUInt32LE(rawSize, sectionOffset + 16);
  pe.writeUInt32LE(rawOffset, sectionOffset + 20);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, pe);
}

test('release manifest contract accepts its fixture', () => {
  assert.deepEqual(validateReleaseManifest(fixtures.valid), []);
});

test('release manifest contract rejects invalid fields and unknown properties', () => {
  for (const fixture of fixtures.invalid) {
    const value = structuredClone(fixtures.valid);
    value[fixture.field] = fixture.value;
    assert.notEqual(validateReleaseManifest(value).length, 0, fixture.field);
  }
  assert.notEqual(validateReleaseManifest({ ...fixtures.valid, unexpected: true }).length, 0);
});

test('release policy uses strict SemVer, stable versions, restricted HTTPS executables, and canonical UTC RFC 3339', () => {
  for (const version of ['01.2.3', '1.2.3-01', '1.2.3-', '1.2']) {
    assert.notEqual(validateReleaseManifest({ ...fixtures.valid, version }).length, 0, version);
  }
  assert.notEqual(validateReleaseManifest({ ...fixtures.valid, channel: 'stable', version: '1.2.3-rc.1' }).length, 0);
  for (const url of [
    'https://localhost/setup.exe',
    'https://files.localhost/setup.exe',
    'https://user:pass@example.test/setup.exe',
    'https://releases.example.test/setup.zip',
  ]) assert.notEqual(validateReleaseManifest({ ...fixtures.valid, url }).length, 0, url);
  for (const publishedAt of ['2026-02-30T12:00:00Z', '2026-08-02T12:00:00+00:00', '2026-08-02T12:00:00.1234567890Z']) {
    assert.notEqual(validateReleaseManifest({ ...fixtures.valid, publishedAt }).length, 0, publishedAt);
  }
  assert.deepEqual(validateReleaseManifest({ ...fixtures.valid, publishedAt: '2026-08-02T12:00:00.123456789Z' }), []);
});

test('release URLs reject local address forms and reserve invalid placeholders for internal manifests', () => {
  for (const host of [
    '0.0.0.0', '10.0.0.1', '127.0.0.2', '127.0.0.1.', '169.254.1.1', '172.16.0.1', '192.168.1.1',
    'localhost.', '2130706433', '[::]', '[::1]', '[fc00::1]', '[fe80::1]', '[::ffff:127.0.0.1]',
  ]) {
    assert.notEqual(validateReleaseManifest({ ...fixtures.valid, url: `https://${host}/setup.exe` }).length, 0, host);
  }
  const placeholder = 'https://releases.example.invalid/setup.exe';
  assert.deepEqual(validateReleaseManifest({ ...fixtures.valid, channel: 'internal', url: placeholder }), []);
  assert.notEqual(validateReleaseManifest({ ...fixtures.valid, channel: 'pilot', url: placeholder }).length, 0);
  assert.notEqual(validateReleaseManifest({ ...fixtures.valid, channel: 'stable', url: placeholder }).length, 0);
});

test('JSON Schema and runtime expose the same patterns and safe integer limit', () => {
  const schema = require('../release/release-manifest.schema.json');
  assert.equal(schema.properties.version.pattern, SEMVER_PATTERN);
  assert.equal(schema.properties.url.pattern, URL_PATTERN);
  assert.equal(schema.properties.publishedAt.pattern, RFC3339_PATTERN);
  assert.equal(schema.properties.size.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(schema.allOf[0].then.properties.version.pattern, STABLE_SEMVER_PATTERN);
  assert.equal(schema.properties.compatibility.properties.minimumBackendVersion.pattern, SEMVER_PATTERN);
  assert.equal(schema.properties.compatibility.properties.minimumClientVersion.pattern, SEMVER_PATTERN);
  assert.deepEqual(schema.allOf[1].if.properties.channel.enum, ['pilot', 'stable']);
  assert.match(schema.allOf[1].then.properties.url.not.pattern, /Invalid|\[Ii\]/i);
});

test('local generator binds package and artifact versions and writes a verifiable relative checksum', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-release-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installerName = `Vibe-IDE-Code-Setup-${packageJson.version}.exe`;
  const installerPath = path.join(root, 'dist-electron', installerName);
  const outputPath = path.join(root, 'temp', 'build', 'release-manifest.json');
  const checksumPath = path.join(root, 'temp', 'build', `${installerName}.sha256`);
  fs.mkdirSync(path.dirname(installerPath), { recursive: true });
  fs.writeFileSync(installerPath, 'offline installer fixture');
  const result = await generateManifest({
    installer: installerPath,
    output: outputPath,
    checksum: checksumPath,
    version: packageJson.version,
    channel: 'internal',
    url: `https://releases.example.test/Vibe-IDE-Code-Setup-${packageJson.version}.exe`,
    'minimum-backend': '1.0.0',
    'minimum-client': '1.0.0',
    'published-at': '2026-08-02T12:00:00.000Z',
  });
  assert.deepEqual(await verifyManifestArtifact(readManifest(outputPath), installerPath), []);
  assert.deepEqual(await verifyChecksumFile(checksumPath, installerPath), []);
  assert.equal(fs.readFileSync(checksumPath, 'utf8'), `${result.manifest.sha256}  ../../dist-electron/${installerName}\n`);
  await assert.rejects(generateManifest({ ...result.manifest, installer: installerPath, version: '9.9.9' }), /match package\.json/);
});

test('Windows artifact verifier checks bounded PE overlay and x64 unpacked app without claiming format trust', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pe-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installerPath = path.join(root, `Vibe-IDE-Code-Setup-${packageJson.version}.exe`);
  const appPath = path.join(root, 'win-unpacked', 'Vibe IDE Code.exe');
  createPe(installerPath, { machine: 'x86', overlayBytes: 1024 * 1024 });
  createPe(appPath, { machine: 'x64' });
  const result = inspectWindowsInstaller(installerPath, appPath);
  assert.equal(result.installer.overlayBytes, 1024 * 1024);
  assert.equal(result.installer.authenticode, 'absent');
  assert.equal(result.unpackedApp.machine, 'x64');
  assert.equal(Object.hasOwn(result.installer, 'nsis'), false);
  assert.equal(Object.hasOwn(result.installer, 'signed'), false);
});

test('release smoke path guard rejects installer and Setup paths before execution', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-smoke-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installerPath = path.join(root, `Vibe-IDE-Code-Setup-${packageJson.version}.exe`);
  const otherSetupPath = path.join(root, 'win-unpacked', 'Other Setup.exe');
  fs.mkdirSync(path.dirname(otherSetupPath), { recursive: true });
  fs.writeFileSync(installerPath, 'installer');
  fs.writeFileSync(otherSetupPath, 'installer');
  assert.throws(() => validatePackagedAppPath(installerPath, installerPath), /cannot be the installer/);
  assert.throws(() => validatePackagedAppPath(otherSetupPath, installerPath), /Setup or installer/);
});

test('release smoke path guard rejects a hard link to the installer', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-smoke-link-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installerPath = path.join(root, `Vibe-IDE-Code-Setup-${packageJson.version}.exe`);
  const appPath = path.join(root, 'win-unpacked', 'Vibe IDE Code.exe');
  fs.mkdirSync(path.dirname(appPath), { recursive: true });
  fs.writeFileSync(installerPath, 'installer');
  fs.linkSync(installerPath, appPath);
  assert.throws(() => validatePackagedAppPath(appPath, installerPath), /hard link to the installer/);
});

test('packaging cannot automatically execute environment installation', () => {
  const packageConfig = require('../package.json');
  const setupCenter = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'setup', 'SetupCenter.jsx'), 'utf8');
  assert.equal(Object.hasOwn(packageConfig.build.nsis, 'include'), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'build', 'installer.nsh')), false);
  assert.match(setupCenter, /onClick=\{\(\) => setConfirming\(true\)\}/);
  assert.match(setupCenter, /confirming &&/);
  assert.match(setupCenter, /onClick=\{install\}/);
});

test('packaging generates the latest.yml expected by the private stable feed', () => {
  const packageConfig = require('../package.json');
  assert.equal(packageConfig.build.publish[0].provider, 'generic');
  assert.equal(Object.hasOwn(packageConfig.build.publish[0], 'channel'), false);
  assert.equal(packageConfig.build.nsis.artifactName, 'Vibe-IDE-Code-Setup-${version}.${ext}');
});
