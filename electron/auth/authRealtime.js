const { createClient } = require('@supabase/supabase-js');

class AuthRealtime {
  constructor(authService, onAccessChange, options = {}) {
    this.authService = authService;
    this.onAccessChange = onAccessChange;
    this.createClient = options.createClient || createClient;
    this.debounceMs = options.debounceMs ?? 150;
    this.client = null;
    this.channel = null;
    this.identity = null;
    this.syncGeneration = 0;
    this.changeTimer = null;
  }

  async sync() {
    const generation = ++this.syncGeneration;
    const session = this.authService.getRealtimeSession();
    const identity = session ? `${session.userId}:${session.accessToken}` : null;
    if (identity === this.identity && this.channel) return;

    await this.disconnect();
    if (generation !== this.syncGeneration || !session) return;

    const client = this.createClient(session.supabaseUrl, session.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    await client.realtime.setAuth(session.accessToken);
    const channel = client
      .channel(`desktop-access:${session.userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${session.userId}`,
      }, () => this.scheduleRevalidation())
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

  scheduleRevalidation() {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.onAccessChange();
    }, this.debounceMs);
    this.changeTimer.unref?.();
  }

  async disconnect() {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = null;
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

module.exports = { AuthRealtime };
