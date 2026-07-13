const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthRealtime } = require('../electron/auth/authRealtime');

function createFakeClient(calls) {
  const channel = {
    on(_type, filter, callback) {
      calls.filter = filter;
      calls.callback = callback;
      return this;
    },
    subscribe() {
      calls.subscribed = true;
      return this;
    },
  };
  return {
    realtime: {
      setAuth(token) { calls.token = token; },
      disconnect() { calls.disconnected = true; },
    },
    channel(name) { calls.channelName = name; return channel; },
    async removeChannel(value) { calls.removed = value; },
  };
}

test('subscribes only to the authenticated student membership', async () => {
  const calls = {};
  const session = { supabaseUrl: 'https://example.supabase.co', anonKey: 'anon', accessToken: 'jwt', userId: 'student-id' };
  const realtime = new AuthRealtime(
    { getRealtimeSession: () => session },
    () => {},
    { createClient: () => createFakeClient(calls), debounceMs: 0 },
  );

  await realtime.sync();

  assert.equal(calls.token, 'jwt');
  assert.equal(calls.channelName, 'desktop-membership:student-id');
  assert.equal(calls.filter.filter, 'profile_id=eq.student-id');
  assert.equal(calls.subscribed, true);
  await realtime.stop();
});

test('membership events trigger one authoritative revalidation', async () => {
  const calls = {};
  let validations = 0;
  const realtime = new AuthRealtime(
    { getRealtimeSession: () => ({ supabaseUrl: 'url', anonKey: 'anon', accessToken: 'jwt', userId: 'student-id' }) },
    () => { validations += 1; },
    { createClient: () => createFakeClient(calls), debounceMs: 5 },
  );
  await realtime.sync();

  calls.callback();
  calls.callback();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(validations, 1);
  await realtime.stop();
});
