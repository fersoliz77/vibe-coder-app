const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.VIBE_SUPABASE_URL?.replace(/\/$/, '');
const anonKey = process.env.VIBE_SUPABASE_ANON_KEY;
if (!supabaseUrl || !anonKey) {
  console.error('VIBE_SUPABASE_URL and VIBE_SUPABASE_ANON_KEY are required to package Vibe IDE Code.');
  process.exit(1);
}

const target = path.join(__dirname, '..', 'electron', 'auth', 'runtime-config.json');
fs.writeFileSync(target, JSON.stringify({
  supabaseUrl,
  anonKey,
  membershipRpc: process.env.VIBE_SUPABASE_MEMBERSHIP_RPC || 'get_desktop_access',
  helpUrl: process.env.VIBE_AUTH_HELP_URL || null,
}, null, 2));
