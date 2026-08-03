const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProvisioningError, clientEnvPath, envPrefix, findValue, parseJsonOutput, runRemoteCreation, writeText } = require('./core');

function normalizeWindowsCredential(value) {
  const direct = String(value || '').trim();
  if (/^sbp_[A-Za-z0-9_-]+$/.test(direct)) return direct;
  const bytes = [];
  for (let index = 0; index < direct.length; index += 1) {
    const code = direct.charCodeAt(index);
    bytes.push(code & 0xff);
    const high = (code >> 8) & 0xff;
    if (high) bytes.push(high);
  }
  return Buffer.from(bytes).toString('utf8').trim();
}

function readSupabaseAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  try {
    const { Entry, findCredentials } = require('@napi-rs/keyring');
    for (const account of ['supabase', 'access-token']) {
      try {
        const plain = new Entry('Supabase CLI', account).getPassword();
        if (plain) return normalizeWindowsCredential(plain);
      } catch {}
      try {
        const credential = findCredentials('Supabase CLI', `Supabase CLI:${account}`).find((item) => item.account === account);
        if (credential?.password) return normalizeWindowsCredential(credential.password);
      } catch {}
    }
  } catch {}
  try {
    return fs.readFileSync(path.join(os.homedir(), '.supabase', 'access-token'), 'utf8').trim();
  } catch {
    throw new ProvisioningError('SUPABASE_LOGIN_REQUIRED', 'Sign in to Supabase from Settings before creating a project.');
  }
}

async function createSupabaseProjectViaApi(config, fetchImpl = fetch) {
  const accessToken = readSupabaseAccessToken();
  const response = await fetchImpl('https://api.supabase.com/v1/projects', {
    method: 'POST',
    signal: config.signal,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: config.name,
      organization_id: config.organizationId,
      region: config.region,
      db_pass: config.password,
      desired_instance_size: 'nano',
    }),
  });
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (config.signal?.aborted || error?.name === 'AbortError') throw error;
    payload = {};
  }
  if (!response.ok) {
    const message = JSON.stringify(payload);
    if (response.status === 402 || response.status === 429 || /quota|project limit|free project|billing/i.test(message)) {
      throw new ProvisioningError('SUPABASE_QUOTA', 'Supabase project quota reached.');
    }
    throw new ProvisioningError('SUPABASE_CREATE_FAILED', 'Supabase could not create the project.', {
      publicMessage: 'Supabase could not create the project. Check the organization, free-tier availability, and account access, then retry.',
    });
  }
  return payload;
}

function findSupabaseClientKey(payload) {
  const queue = [payload];
  let anon = null;
  while (queue.length) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const name = String(value.name || value.type || '').toLowerCase();
    const key = value.api_key || value.apiKey || value.key || value.value;
    if (typeof key === 'string' && (name.includes('publishable') || name === 'anon')) {
      if (name.includes('publishable')) return { key, type: 'publishable' };
      anon = { key, type: 'anon' };
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return anon;
}

async function configureSupabase({ job, request, state, invoke, projectCreator, fsImpl }) {
  state.remoteCreationAttempted = true;
  const supabase = {
    organizationId: request.supabase.organizationId,
    project: request.slug,
    region: request.supabase.region,
    size: 'nano',
    status: 'attempting',
    created: null,
  };
  state.remotes.supabase = supabase;
  const created = await runRemoteCreation(supabase, () => projectCreator({
    name: request.slug,
    organizationId: request.supabase.organizationId,
    region: request.supabase.region,
    password: request.supabase.password,
    signal: job.controller.signal,
  }));
  const projectRef = findValue(created, ['ref', 'id', 'project_ref']);
  if (!projectRef || !/^[a-z0-9]{8,40}$/i.test(projectRef)) {
    throw new ProvisioningError('SUPABASE_RESPONSE_INVALID', 'Supabase did not return a valid project reference.');
  }
  const projectUrl = findValue(created, ['url', 'api_url']) || `https://${projectRef}.supabase.co`;
  supabase.projectRef = projectRef;
  supabase.projectUrl = projectUrl;
  const keysResult = await invoke(job, 'supabase', [
    'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json',
  ], state.projectPath, 'remote');
  const clientKey = findSupabaseClientKey(parseJsonOutput(keysResult.stdout));
  if (!clientKey) throw new ProvisioningError('SUPABASE_CLIENT_KEY_MISSING', 'Supabase did not return a publishable or anon client key.');

  const prefix = envPrefix(request.type);
  const keyName = clientKey.type === 'publishable' ? 'SUPABASE_PUBLISHABLE_KEY' : 'SUPABASE_ANON_KEY';
  writeText(clientEnvPath(state.projectPath, request.type), [
    `${prefix}SUPABASE_URL=${projectUrl}`,
    `${prefix}${keyName}=${clientKey.key}`,
    '',
  ].join('\n'), fsImpl);
  state.publicEnv = {
    [`${prefix}SUPABASE_URL`]: projectUrl,
    [`${prefix}${keyName}`]: clientKey.key,
  };
  await invoke(job, 'supabase', ['init'], state.projectPath, 'remote');
  await invoke(job, 'supabase', ['link', '--project-ref', projectRef, '--yes'], state.projectPath, 'remote', {
    SUPABASE_DB_PASSWORD: request.supabase.password,
  });
  supabase.clientKeyType = clientKey.type;
  supabase.linked = true;
}

module.exports = {
  configureSupabase,
  createSupabaseProjectViaApi,
  findSupabaseClientKey,
  normalizeWindowsCredential,
};
