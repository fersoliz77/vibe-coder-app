const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthService, buildLearningUrl } = require('../electron/auth/authService');

function createService({ accessToken = 'desktop-access-token' } = {}) {
  const service = Object.create(AuthService.prototype);
  service.config = {
    helpUrl: 'https://vibe-ide-coder.vercel.app',
    supabaseUrl: 'https://project.supabase.co',
    anonKey: 'anon',
  };
  service.record = accessToken ? { session: { access_token: accessToken } } : null;
  service.openedUrls = [];
  service.openExternal = async (url) => { service.openedUrls.push(url); };
  service.request = async () => ({ code: 'A'.repeat(43), expiresIn: 90 });
  return service;
}

test('learning handoff stays in main and opens only the trusted HTTPS origin', async () => {
  const service = createService();
  let request;
  service.request = async (...args) => {
    request = args;
    return { code: 'A'.repeat(43), expiresIn: 90 };
  };
  const result = await service.openLearning();
  assert.deepEqual(request, [
    '/functions/v1/learning-handoff',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer desktop-access-token' },
      body: JSON.stringify({ action: 'issue' }),
    },
  ]);
  assert.deepEqual(service.openedUrls, [`https://vibe-ide-coder.vercel.app/learn/handoff#code=${'A'.repeat(43)}`]);
  assert.deepEqual(result, { ok: true, handoff: true });
  assert.equal(JSON.stringify(result).includes('desktop-access-token'), false);
  assert.equal(JSON.stringify(result).includes('A'.repeat(43)), false);
});

test('learning falls back to the normal browser route without exposing failed handoffs', async () => {
  for (const service of [createService({ accessToken: null }), createService()]) {
    service.request = async () => { throw new Error('private backend response'); };
    const result = await service.openLearning();
    assert.deepEqual(result, { ok: true, handoff: false });
    assert.deepEqual(service.openedUrls, ['https://vibe-ide-coder.vercel.app/learn']);
  }
});

test('learning URL validation rejects insecure or credentialed origins', () => {
  assert.throws(() => buildLearningUrl('http://example.test'), (error) => error.code === 'AUTH_HELP_NOT_CONFIGURED');
  assert.throws(() => buildLearningUrl('https://user:pass@example.test'), (error) => error.code === 'AUTH_HELP_NOT_CONFIGURED');
});

test('external browser failures return a stable error without the target URL', async () => {
  const service = createService();
  service.openExternal = async () => { throw new Error('shell failure with private path'); };
  const result = await service.openLearning();
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'AUTH_LEARNING_OPEN_FAILED', message: 'The learning platform could not be opened.' },
  });
});
