const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseLatestMetadata, publishRelease } = require('../scripts/publish-github-release');
const packageVersion = require('../package.json').version;

function createReleaseFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-release-'));
  const version = packageVersion;
  const localName = `Vibe-IDE-Code-Setup-${version}.exe`;
  const installer = Buffer.from('installer');
  const sha512 = crypto.createHash('sha512').update(installer).digest('base64');
  fs.writeFileSync(path.join(root, localName), installer);
  fs.writeFileSync(path.join(root, `${localName}.blockmap`), 'blockmap');
  fs.writeFileSync(path.join(root, 'latest.yml'), [
    `version: ${version}`,
    'files:',
    `  - url: Vibe-IDE-Code-Setup-${version}.exe`,
    `    sha512: ${sha512}`,
    `    size: ${installer.length}`,
    `path: Vibe-IDE-Code-Setup-${version}.exe`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-08-09T00:00:00.000Z'",
    '',
  ].join('\n'));
  return root;
}

test('latest metadata accepts only a stable version and a basename executable', () => {
  const outputDirectory = createReleaseFixture();
  const source = fs.readFileSync(path.join(outputDirectory, 'latest.yml'), 'utf8');
  assert.throws(() => parseLatestMetadata(source), /signature/);
  const metadata = parseLatestMetadata(source, { verifySignature: () => true });
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  assert.equal(metadata.version, packageVersion);
  assert.equal(metadata.remoteInstaller, `Vibe-IDE-Code-Setup-${packageVersion}.exe`);
  assert.throws(() => parseLatestMetadata('version: 1.2.3-beta\npath: app.exe\n'));
  assert.throws(() => parseLatestMetadata('version: 1.2.3\npath: ../app.exe\n'));
  assert.throws(() => parseLatestMetadata('version: 1.2.3\npath: app.exe\nfiles: []\n'));
});

test('private publication uploads all assets to a draft before activation', async (t) => {
  const outputDirectory = createReleaseFixture();
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));
  const requests = [];
  const fetchImpl = async (url, options) => {
    const href = String(url);
    if (options?.body && typeof options.body !== 'string') for await (const _chunk of options.body) {}
    requests.push({ url: href, options });
    if (href.endsWith(`/releases/tags/v${packageVersion}`)) return new Response(null, { status: 404 });
    if (href.endsWith('/releases') && options.method === 'POST') return Response.json({ id: 42 }, { status: 201 });
    if (href.includes('uploads.github.com')) return Response.json({ id: requests.length }, { status: 201 });
    if (href.endsWith('/releases/42') && options.method === 'PATCH') return Response.json({ html_url: 'https://github.com/private/release' });
    throw new Error(`Unexpected request: ${href}`);
  };

  const result = await publishRelease({
    repository: 'owner/private-repo',
    token: 'github-secret',
    tag: `v${packageVersion}`,
    outputDirectory,
    fetchImpl,
    verifySignature: () => true,
  });

  assert.equal(result.version, packageVersion);
  assert.deepEqual(result.files, [
    `Vibe-IDE-Code-Setup-${packageVersion}.exe`,
    `Vibe-IDE-Code-Setup-${packageVersion}.exe.blockmap`,
    'latest.yml',
  ]);
  assert.equal(result.releaseUrl, 'https://github.com/private/release');
  assert.deepEqual(requests.slice(2, 5).map((request) => new URL(request.url).searchParams.get('name')), result.files);
  assert.equal(requests.at(-1).options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { draft: false, make_latest: 'true' });
  assert.equal(requests.every((request) => !request.url.includes('github-secret')), true);
  assert.equal(requests.every((request) => request.options.headers.Authorization === 'Bearer github-secret'), true);
});

test('a collision aborts before metadata can be activated', async (t) => {
  const outputDirectory = createReleaseFixture();
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return Response.json({ id: 1 });
  };
  await assert.rejects(publishRelease({
    repository: 'owner/private-repo', token: 'secret', outputDirectory, fetchImpl, verifySignature: () => true,
  }), /already exists/);
  assert.equal(requests, 1);
});
