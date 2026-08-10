const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse } = require('yaml');
const { verifySignedUpdateInfo } = require('../electron/services/updateSignature');

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
  if (metadata.remoteInstaller !== localInstaller) throw new Error('latest.yml installer name is not canonical');
  const files = [
    { local: path.join(outputDirectory, localInstaller), remote: localInstaller, contentType: 'application/vnd.microsoft.portable-executable' },
    { local: path.join(outputDirectory, `${localInstaller}.blockmap`), remote: `${localInstaller}.blockmap`, contentType: 'application/octet-stream' },
    { local: path.join(outputDirectory, 'latest.yml'), remote: 'latest.yml', contentType: 'text/yaml; charset=utf-8' },
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

function githubHeaders(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'User-Agent': 'vibe-desktop-release-publisher',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function uploadAsset({ repository, releaseId, token, file, fetchImpl }) {
  const size = fs.statSync(file.local).size;
  const response = await fetchImpl(`https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(file.remote)}`, {
    method: 'POST',
    headers: {
      ...githubHeaders(token, 'application/vnd.github+json'),
      'Content-Type': file.contentType,
      'Content-Length': String(size),
    },
    body: fs.createReadStream(file.local),
    duplex: 'half',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`GitHub asset upload failed for ${file.remote}: HTTP ${response.status}`);
  }
  await response.body?.cancel();
}

async function publishRelease({
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  tag = process.env.RELEASE_TAG,
  outputDirectory = path.resolve('dist-electron'),
  fetchImpl = fetch,
  verifySignature = verifySignedUpdateInfo,
} = {}) {
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY is invalid');
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const metadata = parseLatestMetadata(fs.readFileSync(path.join(outputDirectory, 'latest.yml'), 'utf8'), { verifySignature });
  const expectedTag = `v${metadata.version}`;
  if ((tag || expectedTag) !== expectedTag) throw new Error('release tag does not match latest.yml');
  const releaseTag = tag || expectedTag;
  const files = await releaseFiles(outputDirectory, metadata);
  const apiBase = `https://api.github.com/repos/${repository}/releases`;
  const existing = await fetchImpl(`${apiBase}/tags/${encodeURIComponent(releaseTag)}`, {
    headers: githubHeaders(token),
  });
  if (existing.status !== 404) {
    await existing.body?.cancel();
    throw new Error(existing.ok ? `GitHub release already exists for ${releaseTag}` : `GitHub release lookup failed: HTTP ${existing.status}`);
  }
  await existing.body?.cancel();
  const created = await fetchImpl(apiBase, {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: releaseTag,
      name: `Vibe IDE Code ${metadata.version}`,
      body: 'Private desktop release. Access is mediated by the authenticated update gateway.',
      draft: true,
      prerelease: false,
      generate_release_notes: false,
    }),
  });
  if (!created.ok) {
    await created.body?.cancel();
    throw new Error(`GitHub draft release creation failed: HTTP ${created.status}`);
  }
  const draft = await created.json();
  if (!Number.isSafeInteger(draft?.id) || draft.id < 1) throw new Error('GitHub returned an invalid draft release');
  for (const file of files) {
    await uploadAsset({ repository, releaseId: draft.id, token, file, fetchImpl });
    console.log(`Uploaded private release asset ${file.remote}`);
  }
  const activated = await fetchImpl(`${apiBase}/${draft.id}`, {
    method: 'PATCH',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: false, make_latest: 'true' }),
  });
  if (!activated.ok) {
    await activated.body?.cancel();
    throw new Error(`GitHub release activation failed: HTTP ${activated.status}`);
  }
  const release = await activated.json();
  return { version: metadata.version, tag: releaseTag, releaseUrl: release.html_url || null, files: files.map((file) => file.remote) };
}

if (require.main === module) {
  publishRelease().then((release) => {
    console.log(`Activated private GitHub release ${release.tag}.`);
  }).catch((error) => {
    console.error(`Release publication failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseLatestMetadata, publishRelease, releaseFiles, sha512File, uploadAsset };
