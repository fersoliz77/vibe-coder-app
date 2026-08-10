const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseLatestMetadata, publishRelease } = require('../scripts/publish-supabase-release');
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

test('private publication uploads metadata last and never places credentials in URLs', async (t) => {
  const outputDirectory = createReleaseFixture();
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));
  const requests = [];
  const fetchImpl = async (url, options) => {
    for await (const _chunk of options.body) {}
    requests.push({ url, headers: options.headers });
    return { ok: true, status: 200 };
  };

  const result = await publishRelease({
    supabaseUrl: 'https://project.supabase.co',
    serviceRoleKey: 'server-secret',
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
  assert.equal(requests.at(-1).url.endsWith('/desktop-releases/stable/latest.yml'), true);
  assert.equal(requests.every((request) => !request.url.includes('server-secret')), true);
  assert.equal(requests.every((request) => request.headers.Authorization === 'Bearer server-secret'), true);
  assert.deepEqual(requests.map((request) => request.headers['x-upsert']), ['false', 'false', 'true']);
});

test('a collision aborts before metadata can be activated', async (t) => {
  const outputDirectory = createReleaseFixture();
  t.after(() => fs.rmSync(outputDirectory, { recursive: true, force: true }));
  let requests = 0;
  const fetchImpl = async (_url, options) => {
    for await (const _chunk of options.body) {}
    requests += 1;
    return { ok: false, status: 409 };
  };
  await assert.rejects(publishRelease({
    supabaseUrl: 'https://project.supabase.co', serviceRoleKey: 'secret', outputDirectory, fetchImpl, verifySignature: () => true,
  }), /HTTP 409/);
  assert.equal(requests, 1);
});
