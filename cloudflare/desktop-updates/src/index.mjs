const INSTALLER_PATTERN = /^Vibe-IDE-Code-Setup-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\.exe(?:\.blockmap)?$/;
const FORWARDED_HEADERS = [
  'accept-ranges',
  'content-disposition',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
];

function textResponse(status, message) {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function requestedAsset(request, channel) {
  const url = new URL(request.url);
  if (url.search || url.hash) return null;
  const prefix = `/${encodeURIComponent(channel)}/`;
  if (!url.pathname.startsWith(prefix)) return null;
  let name;
  try {
    name = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return null;
  }
  if (name === 'latest.yml') return { name, tag: null };
  const match = INSTALLER_PATTERN.exec(name);
  return match ? { name, tag: `v${match[1]}` } : null;
}

function bearerAuthorization(request) {
  const value = request.headers.get('Authorization') || '';
  return /^Bearer [^\s]{20,8192}$/.test(value) ? value : null;
}

function matchesSingleRange(requested, received) {
  const requestMatch = /^bytes=(\d+)-(\d+)$/.exec(requested);
  const responseMatch = /^bytes\s+(\d+)-(\d+)\/(?:\d+|\*)$/i.exec(received);
  return Boolean(requestMatch
    && responseMatch
    && requestMatch[1] === responseMatch[1]
    && requestMatch[2] === responseMatch[2]);
}

async function hasEntitlement(request, env, fetchImpl) {
  const authorization = bearerAuthorization(request);
  if (!authorization) return { allowed: false, status: 401 };
  const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/has_active_desktop_entitlement`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      apikey: env.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!response.ok) {
    await response.body?.cancel();
    return { allowed: false, status: response.status === 401 || response.status === 403 ? 401 : 503 };
  }
  let allowed = false;
  try {
    allowed = (await response.json()) === true;
  } catch {}
  return { allowed, status: allowed ? 200 : 403 };
}

function githubHeaders(env, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'User-Agent': 'vibe-desktop-updates-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubRelease(asset, env, fetchImpl) {
  const repository = encodeURI(env.GITHUB_REPOSITORY);
  const endpoint = asset.tag
    ? `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(asset.tag)}`
    : `https://api.github.com/repos/${repository}/releases/latest`;
  const response = await fetchImpl(endpoint, { headers: githubHeaders(env) });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const release = await response.json();
  if (!release || release.draft || release.prerelease || !Array.isArray(release.assets)) return null;
  if (asset.tag && release.tag_name !== asset.tag) return null;
  return release.assets.find((entry) => entry?.name === asset.name && typeof entry.url === 'string') || null;
}

async function fetchAsset(request, asset, env, fetchImpl) {
  const releaseAsset = await githubRelease(asset, env, fetchImpl);
  if (!releaseAsset) return textResponse(404, 'Update asset not found.');
  const range = request.headers.get('Range');
  const apiHeaders = githubHeaders(env, 'application/octet-stream');
  if (range) apiHeaders.Range = range;
  const apiResponse = await fetchImpl(releaseAsset.url, {
    method: request.method,
    headers: apiHeaders,
    redirect: 'manual',
  });
  let upstream = apiResponse;
  for (let redirects = 0; upstream.status >= 300 && upstream.status < 400; redirects += 1) {
    if (redirects >= 5) { await upstream.body?.cancel(); return textResponse(502, 'Update storage returned too many redirects.'); }
    const location = upstream.headers.get('Location');
    await upstream.body?.cancel();
    let redirectUrl;
    try { redirectUrl = new URL(location); } catch { return textResponse(502, 'Update storage returned an invalid redirect.'); }
    if (redirectUrl.protocol !== 'https:') return textResponse(502, 'Update storage returned an invalid redirect.');
    const redirectHeaders = { 'User-Agent': 'vibe-desktop-updates-worker' };
    if (range) redirectHeaders.Range = range;
    upstream = await fetchImpl(redirectUrl, { method: request.method, headers: redirectHeaders, redirect: 'manual' });
  }
  if (!upstream.ok && upstream.status !== 206) {
    await upstream.body?.cancel();
    return textResponse(502, 'Update storage is unavailable.');
  }
  if (range) {
    const contentType = upstream.headers.get('Content-Type') || '';
    const contentRange = upstream.headers.get('Content-Range') || '';
    const multiple = range.includes(',');
    const valid = upstream.status === 206 && (multiple
      ? /^multipart\/byteranges\s*;\s*boundary=.+/i.test(contentType)
      : matchesSingleRange(range, contentRange));
    if (!valid) { await upstream.body?.cancel(); return textResponse(502, 'Update storage returned an invalid range response.'); }
  }
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of FORWARDED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (asset.name === 'latest.yml') headers.set('Content-Type', 'text/yaml; charset=utf-8');
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return textResponse(405, 'Method not allowed.');
  if (!env?.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) {
    return textResponse(503, 'Update service is not configured.');
  }
  const asset = requestedAsset(request, env.UPDATE_CHANNEL || 'stable');
  if (!asset) return textResponse(404, 'Update asset not found.');
  let access;
  try {
    access = await hasEntitlement(request, env, fetchImpl);
  } catch {
    return textResponse(503, 'Update authorization is unavailable.');
  }
  if (!access.allowed) return textResponse(access.status, access.status === 403 ? 'Update access is not active.' : 'Update authorization failed.');
  try {
    return await fetchAsset(request, asset, env, fetchImpl);
  } catch {
    return textResponse(502, 'Update storage is unavailable.');
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
