const test = require('node:test');
const assert = require('node:assert/strict');

const env = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  GITHUB_TOKEN: 'github-secret',
  GITHUB_REPOSITORY: 'owner/private-repo',
  UPDATE_CHANNEL: 'stable',
};

async function worker() {
  return import('../cloudflare/desktop-updates/src/index.mjs');
}

test('worker rejects malformed paths before authorization or GitHub access', async () => {
  const { handleRequest } = await worker();
  let calls = 0;
  const response = await handleRequest(new Request('https://updates.example/stable/../secret', {
    headers: { Authorization: `Bearer ${'a'.repeat(20)}` },
  }), env, async () => { calls += 1; });
  assert.equal(response.status, 404);
  assert.equal(calls, 0);
});

test('worker denies inactive users without contacting GitHub', async () => {
  const { handleRequest } = await worker();
  const calls = [];
  const response = await handleRequest(new Request('https://updates.example/stable/latest.yml', {
    headers: { Authorization: `Bearer ${'a'.repeat(20)}` },
  }), env, async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response('false', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /has_active_desktop_entitlement$/);
  assert.equal(calls[0].options.headers.apikey, 'anon-key');
});

test('worker streams latest metadata for entitled users without leaking the GitHub token', async () => {
  const { handleRequest } = await worker();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, options });
    if (href.includes('has_active_desktop_entitlement')) return Response.json(true);
    if (href.endsWith('/releases/latest')) {
      return Response.json({
        tag_name: 'v1.2.3', draft: false, prerelease: false,
        assets: [{ name: 'latest.yml', url: 'https://api.github.com/assets/1' }],
      });
    }
    if (href === 'https://api.github.com/assets/1') {
      return new Response(null, { status: 302, headers: { Location: 'https://objects.example/signed-metadata' } });
    }
    if (href === 'https://objects.example/signed-metadata') {
      return new Response('version: 1.2.3\n', { headers: { 'Content-Length': '15' } });
    }
    throw new Error(`Unexpected request: ${href}`);
  };
  const response = await handleRequest(new Request('https://updates.example/stable/latest.yml', {
    headers: { Authorization: `Bearer ${'a'.repeat(20)}` },
  }), env, fetchImpl);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/yaml; charset=utf-8');
  assert.equal(await response.text(), 'version: 1.2.3\n');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer github-secret');
  assert.equal(Object.hasOwn(calls[3].options.headers, 'Authorization'), false);
});

test('worker resolves versioned installers by immutable tag and preserves byte ranges', async () => {
  const { handleRequest } = await worker();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, options });
    if (href.includes('has_active_desktop_entitlement')) return Response.json(true);
    if (href.endsWith('/releases/tags/v1.2.3')) {
      return Response.json({
        tag_name: 'v1.2.3', draft: false, prerelease: false,
        assets: [{ name: 'Vibe-IDE-Code-Setup-1.2.3.exe', url: 'https://api.github.com/assets/2' }],
      });
    }
    if (href === 'https://api.github.com/assets/2') {
      return new Response(null, { status: 302, headers: { Location: 'https://objects.example/signed-installer' } });
    }
    if (href === 'https://objects.example/signed-installer') {
      return new Response('bytes', { status: 206, headers: { 'Content-Range': 'bytes 0-4/100', 'Accept-Ranges': 'bytes' } });
    }
    throw new Error(`Unexpected request: ${href}`);
  };
  const response = await handleRequest(new Request('https://updates.example/stable/Vibe-IDE-Code-Setup-1.2.3.exe', {
    headers: { Authorization: `Bearer ${'a'.repeat(20)}`, Range: 'bytes=0-4' },
  }), env, fetchImpl);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-4/100');
  assert.equal(calls[2].options.headers.Range, 'bytes=0-4');
  assert.equal(calls[3].options.headers.Range, 'bytes=0-4');
});
