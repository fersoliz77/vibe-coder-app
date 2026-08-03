const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSubprocessEnv, isSensitiveEnvironmentKey } = require('../electron/services/subprocessEnv');

const source = {
  PATH: 'C:\\tools', HOME: 'C:\\Users\\person', APPDATA: 'C:\\Users\\person\\AppData',
  VIBE_INTERNAL_SECRET: 'vibe-secret', SUPABASE_ACCESS_TOKEN: 'supabase-secret',
  GITHUB_TOKEN: 'github-secret', OPENAI_API_KEY: 'openai-secret', RANDOM_VALUE: 'private',
  HTTPS_PROXY: 'http://proxy.local:8080', NO_PROXY: 'localhost', SSL_CERT_FILE: 'C:\\certs\\root.pem',
  NODE_EXTRA_CA_CERTS: 'C:\\certs\\extra.pem', SSH_AUTH_SOCK: '\\\\.\\pipe\\openssh-ssh-agent',
  GIT_AUTHOR_NAME: 'Developer', GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'malicious-command',
  GH_CONFIG_DIR: 'C:\\isolated\\github',
};

test('subprocess environment preserves runtime paths but drops inherited secrets', () => {
  const env = buildSubprocessEnv({ source });
  assert.equal(env.PATH, source.PATH);
  assert.equal(env.HOME, source.HOME);
  assert.equal(env.APPDATA, source.APPDATA);
  assert.equal(env.VIBE_INTERNAL_SECRET, undefined);
  assert.equal(env.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.RANDOM_VALUE, undefined);
  assert.equal(env.HTTPS_PROXY, source.HTTPS_PROXY);
  assert.equal(env.NO_PROXY, 'localhost');
  assert.equal(env.SSL_CERT_FILE, source.SSL_CERT_FILE);
  assert.equal(env.NODE_EXTRA_CA_CERTS, source.NODE_EXTRA_CA_CERTS);
  assert.equal(env.SSH_AUTH_SOCK, source.SSH_AUTH_SOCK);
  assert.equal(env.GIT_AUTHOR_NAME, 'Developer');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GH_CONFIG_DIR, source.GH_CONFIG_DIR);
  assert.equal(env.GIT_SSH_COMMAND, undefined);
});

test('validated Java and Android AVD homes are preserved while unusable paths are dropped', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-runtime-env-'));
  try {
    const javaHome = path.join(root, 'jdk-17');
    const avdHome = path.join(root, 'avd');
    fs.mkdirSync(path.join(javaHome, 'bin'), { recursive: true });
    fs.mkdirSync(avdHome);
    fs.writeFileSync(path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), '', { mode: 0o755 });

    const env = buildSubprocessEnv({ source: { JAVA_HOME: javaHome, ANDROID_AVD_HOME: avdHome } });
    assert.equal(env.JAVA_HOME, javaHome);
    assert.equal(env.ANDROID_AVD_HOME, avdHome);
    assert.equal(buildSubprocessEnv({ source: { JAVA_HOME: path.join(root, 'missing'), ANDROID_AVD_HOME: 'relative-avd' } }).JAVA_HOME, undefined);
    assert.equal(buildSubprocessEnv({ source: { JAVA_HOME: path.join(root, 'missing'), ANDROID_AVD_HOME: 'relative-avd' } }).ANDROID_AVD_HOME, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('only the selected provider receives its official environment auth', () => {
  const openai = buildSubprocessEnv({ source, provider: 'openai' });
  assert.equal(openai.OPENAI_API_KEY, 'openai-secret');
  assert.equal(openai.GITHUB_TOKEN, undefined);
  const github = buildSubprocessEnv({ source, provider: 'github' });
  assert.equal(github.GITHUB_TOKEN, 'github-secret');
  assert.equal(github.OPENAI_API_KEY, undefined);
});

test('explicit per-command values are accepted without inheriting unrelated tokens', () => {
  const env = buildSubprocessEnv({ source, provider: 'supabase', extra: { SUPABASE_DB_PASSWORD: 'explicit', ELECTRON_RUN_AS_NODE: '1' } });
  assert.equal(env.SUPABASE_ACCESS_TOKEN, 'supabase-secret');
  assert.equal(env.SUPABASE_DB_PASSWORD, 'explicit');
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
});

test('sensitive-key detector recognizes tokens and product namespaces', () => {
  assert.equal(isSensitiveEnvironmentKey('MY_API_KEY'), true);
  assert.equal(isSensitiveEnvironmentKey('VIBE_URL'), true);
  assert.equal(isSensitiveEnvironmentKey('PATH'), false);
});
