const { createClient } = require('@supabase/supabase-js');
const { Notification, shell } = require('electron');

class AdminSignupAlerts {
  constructor(authService, options = {}) {
    this.authService = authService;
    this.createClient = options.createClient || createClient;
    this.Notification = options.Notification || Notification;
    this.shell = options.shell || shell;
    this.client = null;
    this.channel = null;
    this.identity = null;
    this.syncGeneration = 0;
  }

  async sync() {
    const generation = ++this.syncGeneration;
    const session = this.authService.getRealtimeSession();
    const account = this.authService.getState().account;
    const eligible = session && account?.role === 'admin' && account?.status === 'active';
    const identity = eligible ? `${session.userId}:${session.accessToken}` : null;
    if (identity === this.identity && this.channel) return;

    await this.disconnect();
    if (generation !== this.syncGeneration || !eligible) return;

    const client = this.createClient(session.supabaseUrl, session.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    await client.realtime.setAuth(session.accessToken);
    const channel = client
      .channel(`admin-signups:${session.userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'profiles',
        filter: 'role=eq.student',
      }, (payload) => this.handleInsert(payload, session))
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

  async handleInsert(payload, session) {
    const row = payload?.new;
    if (!row?.id || row.role !== 'student' || row.status !== 'pending') return;

    let email = 'Nueva cuenta pendiente';
    let whatsapp = '';
    try {
      const profiles = await this.authService.request(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(row.id)}&select=email,whatsapp`,
        { headers: { Authorization: `Bearer ${session.accessToken}` } },
      );
      const profile = Array.isArray(profiles) ? profiles[0] : null;
      if (profile?.email) email = profile.email;
      if (profile?.whatsapp) whatsapp = profile.whatsapp;
    } catch {
      // RLS may hide contact data; the signup event can still be reported generically.
    }

    if (!this.Notification.isSupported()) return;
    const notification = new this.Notification({
      title: 'Nueva cuenta registrada',
      body: whatsapp ? `${email} - WhatsApp: ${whatsapp}` : email,
    });
    if (whatsapp) {
      notification.on('click', () => {
        this.shell.openExternal(`https://wa.me/${whatsapp.replace(/[^\d]/g, '')}`).catch(() => {});
      });
    }
    notification.show();
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

module.exports = { AdminSignupAlerts };
