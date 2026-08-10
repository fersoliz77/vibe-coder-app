const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('yaml');
const { signMetadata } = require('../scripts/sign-update-metadata');
const { verifySignedUpdateInfo } = require('../electron/services/updateSignature');

test('release metadata is signed, survives YAML serialization, and verifies again', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-signed-update-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const metadataPath = path.join(directory, 'latest.yml');
  const sha512 = crypto.createHash('sha512').update('installer').digest('base64');
  fs.writeFileSync(metadataPath, [
    'version: 1.2.3',
    'files:',
    '  - url: Vibe-IDE-Code-Setup-1.2.3.exe',
    `    sha512: ${sha512}`,
    '    size: 9',
    'path: Vibe-IDE-Code-Setup-1.2.3.exe',
    `sha512: ${sha512}`,
    "releaseDate: '2026-08-10T00:00:00.000Z'",
    '',
  ].join('\n'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  signMetadata({ metadataPath, privateKey, publicKey });
  const serialized = parse(fs.readFileSync(metadataPath, 'utf8'));
  assert.equal(verifySignedUpdateInfo(serialized, publicKey), true);
});

test('metadata signing rejects a private key that does not match the configured public key', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-wrong-update-key-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = crypto.generateKeyPairSync('ed25519');
  const second = crypto.generateKeyPairSync('ed25519');
  assert.throws(() => signMetadata({
    metadataPath: path.join(directory, 'unused.yml'),
    privateKey: first.privateKey,
    publicKey: second.publicKey,
  }), /does not match/);
});
