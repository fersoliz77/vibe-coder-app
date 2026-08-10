const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UPDATE_KEY_ID = 'vibe-update-ed25519-v1';
const PUBLIC_KEY_PATH = path.join(__dirname, '..', 'update-signing-public-key.pem');

function stableVersion(value) {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
}

function signedUpdateFields(updateInfo) {
  const version = updateInfo?.version;
  const installerPath = updateInfo?.path;
  const releaseDate = updateInfo?.releaseDate instanceof Date
    ? updateInfo.releaseDate.toISOString()
    : updateInfo?.releaseDate;
  const file = Array.isArray(updateInfo?.files)
    ? updateInfo.files.find((entry) => entry?.url === installerPath)
    : null;
  if (!stableVersion(version)
    || typeof installerPath !== 'string'
    || path.basename(installerPath) !== installerPath
    || !installerPath.endsWith('.exe')
    || !file
    || typeof file.sha512 !== 'string'
    || !Number.isSafeInteger(file.size)
    || file.size < 1
    || updateInfo.sha512 !== file.sha512
    || typeof releaseDate !== 'string'
    || !Number.isFinite(Date.parse(releaseDate))) {
    throw new Error('Update metadata is incomplete or invalid.');
  }
  const decodedHash = Buffer.from(file.sha512, 'base64');
  if (decodedHash.length !== 64 || decodedHash.toString('base64') !== file.sha512) {
    throw new Error('Update metadata has an invalid SHA-512.');
  }
  return {
    version,
    path: installerPath,
    sha512: file.sha512,
    size: file.size,
    releaseDate,
  };
}

function signaturePayload(updateInfo) {
  return Buffer.from(JSON.stringify(signedUpdateFields(updateInfo)), 'utf8');
}

function signUpdateInfo(updateInfo, privateKey) {
  return crypto.sign(null, signaturePayload(updateInfo), privateKey).toString('base64');
}

function verifySignedUpdateInfo(updateInfo, publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8')) {
  if (updateInfo?.vibeKeyId !== UPDATE_KEY_ID || typeof updateInfo?.vibeSignature !== 'string') return false;
  const signature = Buffer.from(updateInfo.vibeSignature, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== updateInfo.vibeSignature) return false;
  try {
    return crypto.verify(null, signaturePayload(updateInfo), publicKey, signature);
  } catch {
    return false;
  }
}

module.exports = {
  PUBLIC_KEY_PATH,
  UPDATE_KEY_ID,
  signUpdateInfo,
  signaturePayload,
  signedUpdateFields,
  verifySignedUpdateInfo,
};
