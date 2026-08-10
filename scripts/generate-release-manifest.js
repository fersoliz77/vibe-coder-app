const fs = require('node:fs');
const path = require('node:path');
const { sha256File, validateReleaseManifest } = require('./release-manifest');

function parseArgs(args, acceptedNames) {
  const options = {};
  const accepted = new Set(acceptedNames || [
    'installer', 'version', 'channel', 'url', 'minimum-backend', 'minimum-client',
    'published-at', 'output', 'checksum',
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key?.startsWith('--') || args[index + 1] === undefined) throw new Error(`invalid argument: ${key || '<empty>'}`);
    const name = key.slice(2);
    if (!accepted.has(name)) throw new Error(`unknown argument: ${key}`);
    if (Object.hasOwn(options, name)) throw new Error(`duplicate argument: ${key}`);
    options[name] = args[index + 1];
  }
  return options;
}

async function generateManifest(options) {
  const installerPath = path.resolve(options.installer || '');
  const stat = fs.statSync(installerPath);
  if (!stat.isFile()) throw new Error('installer must be an existing file');
  const packageVersion = require('../package.json').version;
  if (options.version !== packageVersion) throw new Error(`version must match package.json (${packageVersion})`);
  const expectedInstallerName = `Vibe-IDE-Code-Setup-${packageVersion}.exe`;
  if (path.basename(installerPath) !== expectedInstallerName) throw new Error(`installer must be named ${expectedInstallerName}`);
  const manifest = {
    version: options.version,
    channel: options.channel,
    url: options.url,
    sha256: await sha256File(installerPath),
    size: stat.size,
    compatibility: {
      minimumBackendVersion: options['minimum-backend'],
      minimumClientVersion: options['minimum-client'],
    },
    publishedAt: options['published-at'] || new Date().toISOString(),
  };
  const errors = validateReleaseManifest(manifest);
  if (errors.length) throw new Error(errors.join('\n'));

  const outputPath = path.resolve(options.output || path.join('temp', 'build', 'release-manifest.json'));
  const checksumPath = path.resolve(options.checksum || path.join(path.dirname(outputPath), `${expectedInstallerName}.sha256`));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(checksumPath), { recursive: true });
  const checksumTarget = path.relative(path.dirname(checksumPath), installerPath).replaceAll(path.sep, '/');
  if (!checksumTarget || path.isAbsolute(checksumTarget)) throw new Error('cannot create a relative checksum target');
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w' });
  fs.writeFileSync(checksumPath, `${manifest.sha256}  ${checksumTarget}\n`, { flag: 'w' });
  return { manifest, outputPath, checksumPath };
}

if (require.main === module) {
  generateManifest(parseArgs(process.argv.slice(2))).then(({ outputPath, checksumPath }) => {
    console.log(`Release manifest: ${outputPath}`);
    console.log(`SHA-256 file: ${checksumPath}`);
    console.log('Local files only; nothing was signed or published.');
  }).catch((error) => {
    console.error(`Cannot generate release manifest: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { generateManifest, parseArgs };
