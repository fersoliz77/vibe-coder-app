const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('yaml');
const { Upload } = require('tus-js-client');
const { verifySignedUpdateInfo } = require('../electron/services/updateSignature');

const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

function parseLatestMetadata(source, { verifySignature = verifySignedUpdateInfo } = {}) {
  let document;
  try {
    document = parse(source);
  } catch {
    throw new Error('latest.yml is not valid YAML');
  }
  const version = document?.version;
  const remoteInstaller = document?.path;
  if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('latest.yml has an invalid stable version');
  }
  if (!remoteInstaller || path.basename(remoteInstaller) !== remoteInstaller || !remoteInstaller.endsWith('.exe')) {
    throw new Error('latest.yml has an unsafe installer path');
  }
  const file = Array.isArray(document.files)
    ? document.files.find((entry) => entry?.url === remoteInstaller)
    : null;
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1) throw new Error('latest.yml has invalid file metadata');
  if (document.sha512 !== file.sha512 || document.path !== file.url) throw new Error('latest.yml top-level metadata does not match its file');
  let decodedHash;
  try { decodedHash = Buffer.from(file.sha512, 'base64'); } catch {}
  if (!decodedHash || decodedHash.length !== 64 || decodedHash.toString('base64') !== file.sha512) {
    throw new Error('latest.yml has an invalid SHA-512');
  }
  if (typeof document.releaseDate !== 'string' || !Number.isFinite(Date.parse(document.releaseDate))) {
    throw new Error('latest.yml has an invalid release date');
  }
  if (!verifySignature(document)) throw new Error('latest.yml does not have a valid Vibe update signature');
  return { version, remoteInstaller, sha512: file.sha512, size: file.size };
}

function sha512File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(filePath).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('base64')));
  });
}

async function releaseFiles(outputDirectory, metadata) {
  if (metadata.version !== require('../package.json').version) throw new Error('latest.yml version does not match package.json');
  const localInstaller = `Vibe-IDE-Code-Setup-${metadata.version}.exe`;
  if (metadata.remoteInstaller !== `Vibe-IDE-Code-Setup-${metadata.version}.exe`) throw new Error('latest.yml installer name is not canonical');
  const files = [
    { local: path.join(outputDirectory, localInstaller), remote: metadata.remoteInstaller, contentType: 'application/vnd.microsoft.portable-executable', cacheControl: '31536000, immutable', mutable: false },
    { local: path.join(outputDirectory, `${localInstaller}.blockmap`), remote: `${metadata.remoteInstaller}.blockmap`, contentType: 'application/octet-stream', cacheControl: '31536000, immutable', mutable: false },
    { local: path.join(outputDirectory, 'latest.yml'), remote: 'latest.yml', contentType: 'text/yaml; charset=utf-8', cacheControl: 'no-store', mutable: true },
  ];
  for (const file of files) {
    if (!fs.statSync(file.local).isFile()) throw new Error(`release artifact is missing: ${file.local}`);
  }
  const installerStat = fs.statSync(files[0].local);
  if (installerStat.size !== metadata.size) throw new Error('latest.yml installer size does not match the local artifact');
  if (await sha512File(files[0].local) !== metadata.sha512) throw new Error('latest.yml SHA-512 does not match the local artifact');
  if (fs.statSync(files[1].local).size < 1) throw new Error('release blockmap is empty');
  return files;
}

function resumableEndpoint(supabaseUrl) {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith('.supabase.co')) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, '.storage.supabase.co');
  }
  url.pathname = '/storage/v1/upload/resumable';
  return url.toString();
}

function uploadResumableFile({ supabaseUrl, serviceRoleKey, bucket, channel, file, UploadClass = Upload }) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file.local);
    const upload = new UploadClass(stream, {
      endpoint: resumableEndpoint(supabaseUrl),
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: TUS_CHUNK_SIZE,
      metadata: {
        bucketName: bucket,
        objectName: `${channel}/${file.remote}`,
        contentType: file.contentType,
        cacheControl: file.cacheControl,
      },
      onError(error) {
        stream.destroy();
        const status = error?.originalResponse?.getStatus?.();
        reject(new Error(`resumable upload failed for ${file.remote}${status ? `: HTTP ${status}` : ''}`));
      },
      onSuccess() {
        stream.destroy();
        resolve();
      },
    });
    upload.start();
  });
}

async function uploadFile({ supabaseUrl, serviceRoleKey, bucket, channel, file, fetchImpl = fetch, UploadClass = Upload }) {
  if (!file.mutable) {
    return uploadResumableFile({ supabaseUrl, serviceRoleKey, bucket, channel, file, UploadClass });
  }
  const objectUrl = [bucket, channel, file.remote]
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const response = await fetchImpl(`${supabaseUrl}/storage/v1/object/${objectUrl}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': file.contentType,
      'Cache-Control': file.cacheControl,
      'x-upsert': file.mutable ? 'true' : 'false',
    },
    body: fs.createReadStream(file.local),
    duplex: 'half',
  });
  if (!response.ok) throw new Error(`upload failed for ${file.remote}: HTTP ${response.status}`);
}

async function publishRelease({
  supabaseUrl = process.env.VIBE_SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  bucket = process.env.VIBE_UPDATE_BUCKET || 'desktop-releases',
  channel = process.env.VIBE_UPDATE_CHANNEL || 'stable',
  outputDirectory = path.resolve('dist-electron'),
  fetchImpl = fetch,
  UploadClass = Upload,
  verifySignature = verifySignedUpdateInfo,
} = {}) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error('VIBE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) throw new Error('VIBE_SUPABASE_URL must be a credential-free HTTPS URL');
  const normalizedUrl = parsedUrl.toString().replace(/\/$/, '');
  const metadata = parseLatestMetadata(fs.readFileSync(path.join(outputDirectory, 'latest.yml'), 'utf8'), { verifySignature });
  const files = await releaseFiles(outputDirectory, metadata);

  // Publish immutable binaries first. latest.yml is the activation switch and
  // must be uploaded last so clients never observe an incomplete release.
  for (const file of files) {
    await uploadFile({ supabaseUrl: normalizedUrl, serviceRoleKey, bucket, channel, file, fetchImpl, UploadClass });
    console.log(`Published ${bucket}/${channel}/${file.remote}`);
  }
  return { version: metadata.version, files: files.map((file) => file.remote) };
}

if (require.main === module) {
  publishRelease().catch((error) => {
    console.error(`Release publication failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseLatestMetadata,
  publishRelease,
  releaseFiles,
  resumableEndpoint,
  sha512File,
  uploadFile,
  uploadResumableFile,
};
