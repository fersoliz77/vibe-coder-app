const path = require('node:path');
const { readManifest, validateReleaseManifest, verifyChecksumFile, verifyManifestArtifact } = require('./release-manifest');

async function main([manifestArg, installerArg, checksumArg]) {
  if (!manifestArg) throw new Error('usage: node scripts/validate-release-manifest.js <manifest.json> [installer.exe] [installer.sha256]');
  const manifest = readManifest(manifestArg);
  const errors = installerArg
    ? await verifyManifestArtifact(manifest, path.resolve(installerArg))
    : validateReleaseManifest(manifest);
  if (checksumArg) errors.push(...await verifyChecksumFile(checksumArg, installerArg));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(checksumArg ? 'Manifest, installer hash, and relative checksum file are valid.' : installerArg ? 'Manifest and installer hash are valid.' : 'Release manifest is valid.');
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Release validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
