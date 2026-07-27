const { createClient } = require('@supabase/supabase-js');
const { Notification } = require('electron');

class StudentBroadcastAlerts {
  constructor(authService, options = {}) {
    this.authService = authService;
    this.createClient = options.createClient || createClient;
    this.client = null;
    this.channel = null;
    this.identity = null;
    this.syncGeneration = 0;
  }

  async sync() {
    const generation = ++this.syncGeneration;
    const session = this.authService.getRealtimeSession();
    const membership = this.authService.getState().membership;
    const eligible = session && membership?.status === 'active';
    const identity = eligible ? `${session.userId}:${session.accessToken}` : null;
    if (identity === this.identity && this.channel) return;

    await this.disconnect();
    if (generation !== this.syncGeneration || !eligible) return;

    const client = this.createClient(session.supabaseUrl, session.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    await client.realtime.setAuth(session.accessToken);
    const channel = client
      .channel(`broadcast-recipient:${session.userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'broadcast_recipients',
        filter: `profile_id=eq.${session.userId}`,
      }, (payload) => this.handleInsert(payload))
      .subscribe();

    if (generation !== this.syncGeneration) {
      await client.removeChannel(channel);
      client.realtime.disconnect();
      return;
    }
    this.client = client;
    this.channel = channel;
    this.identity = identity;
  }

  handleInsert(payload) {
    const row = payload?.new;
    if (!row?.title || !Notification.isSupported()) return;
    new Notification({ title: row.title, body: row.body || '' }).show();
  }

  async disconnect() {
    const client = this.client;
    const channel = this.channel;
    this.client = null;
    this.channel = null;
    this.identity = null;
    if (!client) return;
    if (channel) await client.removeChannel(channel).catch(() => {});
    client.realtime.disconnect();
  }

  async stop() {
    this.syncGeneration += 1;
    await this.disconnect();
  }
}

module.exports = { StudentBroadcastAlerts };
