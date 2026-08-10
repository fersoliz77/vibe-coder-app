const fs = require('fs');
const path = require('path');

try {
  const envPath = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

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
  accessRpc: process.env.VIBE_SUPABASE_MEMBERSHIP_RPC || 'get_desktop_access',
  helpUrl: process.env.VIBE_AUTH_HELP_URL || null,
  updateBucket: process.env.VIBE_UPDATE_BUCKET || 'desktop-releases',
  updateChannel: process.env.VIBE_UPDATE_CHANNEL || 'stable',
}, null, 2));
