const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  UPDATE_KEY_ID,
  signUpdateInfo,
  verifySignedUpdateInfo,
} = require('../electron/services/updateSignature');

function metadata() {
  const sha512 = crypto.createHash('sha512').update('installer').digest('base64');
  return {
    version: '1.2.3',
    files: [{ url: 'Vibe-IDE-Code-Setup-1.2.3.exe', sha512, size: 9 }],
    path: 'Vibe-IDE-Code-Setup-1.2.3.exe',
    sha512,
    releaseDate: '2026-08-10T00:00:00.000Z',
  };
}

test('free Ed25519 signature authenticates exact update metadata', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const info = metadata();
  info.vibeKeyId = UPDATE_KEY_ID;
  info.vibeSignature = signUpdateInfo(info, privateKey);
  assert.equal(verifySignedUpdateInfo(info, publicKey), true);
  assert.equal(verifySignedUpdateInfo({ ...info, releaseDate: new Date(info.releaseDate) }, publicKey), true);

  info.files[0].size += 1;
  assert.equal(verifySignedUpdateInfo(info, publicKey), false);
});

test('unsigned, malformed, and differently signed metadata is rejected', () => {
  const first = crypto.generateKeyPairSync('ed25519');
  const second = crypto.generateKeyPairSync('ed25519');
  const info = metadata();
  assert.equal(verifySignedUpdateInfo(info, first.publicKey), false);
  info.vibeKeyId = UPDATE_KEY_ID;
  info.vibeSignature = signUpdateInfo(info, first.privateKey);
  assert.equal(verifySignedUpdateInfo(info, second.publicKey), false);
  info.vibeSignature = 'invalid';
  assert.equal(verifySignedUpdateInfo(info, first.publicKey), false);
});
