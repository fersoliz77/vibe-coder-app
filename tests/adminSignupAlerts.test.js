const test = require('node:test');
const assert = require('node:assert/strict');
const { AdminSignupAlerts } = require('../electron/auth/adminSignupAlerts');

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

test('admin signup alerts subscribe globally only for active admins', async () => {
  const session = { supabaseUrl: 'url', anonKey: 'anon', accessToken: 'jwt', userId: 'admin-id' };
  const subscriptions = [];
  const createAlerts = (account) => new AdminSignupAlerts(
    { getRealtimeSession: () => session, getState: () => ({ account }) },
    { createClient: () => { const calls = {}; subscriptions.push(calls); return createFakeClient(calls); } },
  );

  await createAlerts({ role: 'student', status: 'active' }).sync();
  await createAlerts({ role: 'admin', status: 'restricted' }).sync();
  assert.equal(subscriptions.length, 0);

  const alerts = createAlerts({ role: 'admin', status: 'active' });
  await alerts.sync();
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].channelName, 'admin-signups:admin-id');
  assert.deepEqual(subscriptions[0].filter, {
    event: 'INSERT',
    schema: 'public',
    table: 'profiles',
    filter: 'role=eq.student',
  });
  assert.equal(subscriptions[0].subscribed, true);
  await alerts.stop();
});

test('admin signup alerts validate pending students and fetch contact data with RLS', async () => {
  const requests = [];
  const notifications = [];
  class FakeNotification {
    static isSupported() { return true; }
    constructor(options) {
      this.options = options;
      notifications.push(this);
    }
    on(event, callback) { this[event] = callback; }
    show() { this.shown = true; }
  }
  const authService = {
    async request(pathname, options) {
      requests.push({ pathname, options });
      return [{ email: 'student@example.com', whatsapp: '+54 11 5555-0000' }];
    },
  };
  const opened = [];
  const alerts = new AdminSignupAlerts(authService, {
    Notification: FakeNotification,
    shell: { async openExternal(url) { opened.push(url); } },
  });
  const session = { accessToken: 'admin-jwt' };

  await alerts.handleInsert({ new: { id: 'ignored', role: 'admin', status: 'pending' } }, session);
  await alerts.handleInsert({ new: { id: 'ignored', role: 'student', status: 'active' } }, session);
  assert.equal(requests.length, 0);

  await alerts.handleInsert({ new: { id: 'student/id', role: 'student', status: 'pending' } }, session);
  assert.deepEqual(requests, [{
    pathname: '/rest/v1/profiles?id=eq.student%2Fid&select=email,whatsapp',
    options: { headers: { Authorization: 'Bearer admin-jwt' } },
  }]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].options.body, 'student@example.com - WhatsApp: +54 11 5555-0000');
  assert.equal(notifications[0].shown, true);

  await notifications[0].click();
  assert.deepEqual(opened, ['https://wa.me/541155550000']);
});
