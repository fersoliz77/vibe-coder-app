const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthService, buildLearningUrl } = require('../electron/auth/authService');

function createService({ accessToken = 'desktop-access-token' } = {}) {
  const service = Object.create(AuthService.prototype);
  service.config = {
    helpUrl: 'https://vibe-ide-code.vercel.app',
    supabaseUrl: 'https://project.supabase.co',
    anonKey: 'anon',
  };
  service.record = accessToken ? { session: { access_token: accessToken } } : null;
  service.request = async () => ({ code: 'A'.repeat(43), expiresIn: 90 });
  return service;
}

test('learning handoff is prepared in main for only the trusted HTTPS origin', async () => {
  const service = createService();
  let request;
  service.request = async (...args) => {
    request = args;
    return { code: 'A'.repeat(43), expiresIn: 90 };
  };
  const result = await service.prepareLearning();
  assert.deepEqual(request, [
    '/functions/v1/learning-handoff',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer desktop-access-token' },
      body: JSON.stringify({ action: 'issue' }),
    },
  ]);
  assert.deepEqual(result, {
    target: `https://vibe-ide-code.vercel.app/learn/handoff#code=${'A'.repeat(43)}`,
    handoff: true,
  });
  assert.equal(JSON.stringify(result).includes('desktop-access-token'), false);
});

test('learning falls back to the normal browser route without exposing failed handoffs', async () => {
  for (const service of [createService({ accessToken: null }), createService()]) {
    service.request = async () => { throw new Error('private backend response'); };
    const result = await service.prepareLearning();
    assert.deepEqual(result, { target: 'https://vibe-ide-code.vercel.app/learn', handoff: false });
  }
});

test('learning URL validation rejects insecure or credentialed origins', () => {
  assert.throws(() => buildLearningUrl('http://example.test'), (error) => error.code === 'AUTH_HELP_NOT_CONFIGURED');
  assert.throws(() => buildLearningUrl('https://user:pass@example.test'), (error) => error.code === 'AUTH_HELP_NOT_CONFIGURED');
});
