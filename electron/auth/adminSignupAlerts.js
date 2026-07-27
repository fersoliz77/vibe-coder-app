const { createClient } = require('@supabase/supabase-js');
const { Notification, shell } = require('electron');

const ADMIN_ROLES = new Set(['owner', 'school_admin']);

class AdminSignupAlerts {
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
    const eligible = session
      && membership?.status === 'active'
      && membership?.schoolId
      && ADMIN_ROLES.has(membership.role);
    const identity = eligible ? `${session.userId}:${session.accessToken}:${membership.schoolId}` : null;
    if (identity === this.identity && this.channel) return;

    await this.disconnect();
    if (generation !== this.syncGeneration || !eligible) return;

    const client = this.createClient(session.supabaseUrl, session.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    await client.realtime.setAuth(session.accessToken);
    const channel = client
      .channel(`admin-signups:${membership.schoolId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'school_memberships',
        filter: `school_id=eq.${membership.schoolId}`,
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
    if (!row || row.role !== 'student' || row.status !== 'pending') return;
    let email = 'Un nuevo vibe coder';
    let whatsapp = '';
    try {
      const profiles = await this.authService.request(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(row.profile_id)}&select=email,whatsapp`,
        { headers: { Authorization: `Bearer ${session.accessToken}` } },
      );
      const profile = Array.isArray(profiles) ? profiles[0] : null;
      if (profile?.email) email = profile.email;
      if (profile?.whatsapp) whatsapp = profile.whatsapp;
    } catch {
      // Notify anyway with the generic copy above.
    }

    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: 'Nuevo vibe coder registrado',
      body: whatsapp ? `${email} · WhatsApp: ${whatsapp}` : email,
    });
    if (whatsapp) {
      notification.on('click', () => {
        shell.openExternal(`https://wa.me/${whatsapp.replace(/[^\d]/g, '')}`).catch(() => {});
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
