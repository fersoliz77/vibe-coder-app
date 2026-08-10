const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parse, stringify } = require('yaml');
const {
  PUBLIC_KEY_PATH,
  UPDATE_KEY_ID,
  signUpdateInfo,
  signedUpdateFields,
  verifySignedUpdateInfo,
} = require('../electron/services/updateSignature');

function signMetadata({
  metadataPath = path.resolve('dist-electron', 'latest.yml'),
  privateKey = process.env.UPDATE_SIGNING_PRIVATE_KEY,
  publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8'),
} = {}) {
  if (!privateKey) throw new Error('UPDATE_SIGNING_PRIVATE_KEY is required');
  const configuredPublicKeyObject = publicKey?.type === 'public' ? publicKey : crypto.createPublicKey(publicKey);
  const configuredPublicKey = configuredPublicKeyObject
    .export({ type: 'spki', format: 'der' });
  const derivedPublicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  if (!crypto.timingSafeEqual(configuredPublicKey, derivedPublicKey)) {
    throw new Error('Update signing key does not match the public key embedded in the app');
  }
  const updateInfo = parse(fs.readFileSync(metadataPath, 'utf8'));
  signedUpdateFields(updateInfo);
  updateInfo.vibeKeyId = UPDATE_KEY_ID;
  updateInfo.vibeSignature = signUpdateInfo(updateInfo, privateKey);
  if (!verifySignedUpdateInfo(updateInfo, publicKey)) throw new Error('Generated update signature could not be verified');
  fs.writeFileSync(metadataPath, stringify(updateInfo), 'utf8');
  return updateInfo;
}

if (require.main === module) {
  try {
    const info = signMetadata();
    console.log(`Signed update metadata for ${info.version} with ${info.vibeKeyId}.`);
  } catch (error) {
    console.error(`Cannot sign update metadata: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { signMetadata };
