const test = require('node:test');
const assert = require('node:assert/strict');

test('remote cleanup identifiers expose only allowlisted provider identifiers', async () => {
  const { getRemoteCleanupIdentifiers } = await import('../src/features/projects/remoteCleanup.mjs');
  const root = 'C:\\Users\\person\\secret-project';
  const result = getRemoteCleanupIdentifiers({
    github: { owner: 'safe-owner', repository: 'safe-repo', status: 'unknown', cwd: root },
    vercel: { account: 'safe-account', project: 'safe-project', status: 'created', url: 'https://secret.example' },
    firebase: { projectId: 'safe-firebase', status: 'created', resources: { webApp: { status: 'unknown' } } },
    supabase: { organizationId: 'safe-org', project: 'safe-supabase', status: 'attempting', password: 'never-show' },
  });
  assert.deepEqual(result, [
    { provider: 'GitHub', identifier: 'safe-owner/safe-repo', status: 'unknown' },
    { provider: 'Vercel', identifier: 'safe-account/safe-project', status: 'created' },
    { provider: 'Firebase', identifier: 'safe-firebase', status: 'unknown' },
    { provider: 'Supabase', identifier: 'safe-org/safe-supabase', status: 'attempting' },
  ]);
  assert.equal(JSON.stringify(result).includes(root), false);
  assert.equal(JSON.stringify(result).includes('never-show'), false);
  assert.equal(JSON.stringify(result).includes('secret.example'), false);
});

test('remote cleanup identifiers reject unsafe provider values', async () => {
  const { getRemoteCleanupIdentifiers } = await import('../src/features/projects/remoteCleanup.mjs');
  assert.deepEqual(getRemoteCleanupIdentifiers({
    github: { owner: '..\\secret', repository: 'repo', status: 'unknown' },
    firebase: { projectId: 'id/with/path', status: 'unknown' },
    supabase: { projectRef: 'token value', status: 'unknown' },
  }), []);
});
