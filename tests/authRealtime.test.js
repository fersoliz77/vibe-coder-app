const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthRealtime } = require('../electron/auth/authRealtime');
const { StudentBroadcastAlerts } = require('../electron/auth/studentBroadcastAlerts');

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

test('subscribes only to the authenticated profile', async () => {
  const calls = {};
  const session = { supabaseUrl: 'https://example.supabase.co', anonKey: 'anon', accessToken: 'jwt', userId: 'student-id' };
  const realtime = new AuthRealtime(
    { getRealtimeSession: () => session },
    () => {},
    { createClient: () => createFakeClient(calls), debounceMs: 0 },
  );

  await realtime.sync();

  assert.equal(calls.token, 'jwt');
  assert.equal(calls.channelName, 'desktop-access:student-id');
  assert.equal(calls.filter.table, 'profiles');
  assert.equal(calls.filter.filter, 'id=eq.student-id');
  assert.equal(calls.subscribed, true);
  await realtime.stop();
});

test('profile events trigger one authoritative access revalidation', async () => {
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

test('broadcast alerts subscribe only for active students', async () => {
  const session = { supabaseUrl: 'url', anonKey: 'anon', accessToken: 'jwt', userId: 'profile-id' };
  const subscriptions = [];
  const createAlerts = (account) => new StudentBroadcastAlerts(
    { getRealtimeSession: () => session, getState: () => ({ account }) },
    { createClient: () => { const calls = {}; subscriptions.push(calls); return createFakeClient(calls); } },
  );

  const adminAlerts = createAlerts({ role: 'admin', status: 'active' });
  const inactiveStudentAlerts = createAlerts({ role: 'student', status: 'restricted' });
  await adminAlerts.sync();
  await inactiveStudentAlerts.sync();
  assert.equal(subscriptions.length, 0);

  const studentAlerts = createAlerts({ role: 'student', status: 'active' });
  await studentAlerts.sync();
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].filter.table, 'broadcast_recipients');
  assert.equal(subscriptions[0].filter.filter, 'profile_id=eq.profile-id');
  await studentAlerts.stop();
});
