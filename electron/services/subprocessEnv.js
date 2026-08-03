const fs = require('fs');
const path = require('path');

const BASE_ENV_KEYS = new Set([
  'APPDATA', 'COMSPEC', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'LANG', 'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS', 'OS', 'PATH', 'PATHEXT', 'PROCESSOR_ARCHITECTURE',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'SYSTEMDRIVE',
  'SYSTEMROOT', 'TEMP', 'TMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR',
  'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS', 'SSH_AUTH_SOCK',
  'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_NAME', 'GIT_CEILING_DIRECTORIES', 'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_NAME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_HTTP_PROXY',
  'GIT_LFS_SKIP_SMUDGE', 'GIT_OPTIONAL_LOCKS', 'GIT_SSL_CAINFO', 'GIT_TERMINAL_PROMPT',
  'GH_CONFIG_DIR',
]);

// GIT_SSH_COMMAND, GIT_ASKPASS and SSH_ASKPASS are intentionally excluded:
// Git executes their values as programs/commands, so they are not passive configuration.

const PROVIDER_ENV_KEYS = {
  claude: new Set(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR']),
  openai: new Set(['OPENAI_API_KEY', 'CODEX_HOME']),
  github: new Set(['GH_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_TOKEN', 'GITHUB_TOKEN']),
  vercel: new Set(['VERCEL_TOKEN']),
  firebase: new Set(['FIREBASE_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS']),
  supabase: new Set(['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROFILE']),
};

const SENSITIVE_KEY = /(?:^|_)(?:API_?KEY|AUTH|CREDENTIAL|PASSWORD|SECRET|SERVICE_?ROLE|TOKEN)(?:_|$)/i;
const BLOCKED_NAMESPACE = /^(?:VIBE|SUPABASE|VERCEL|GITHUB|GH|FIREBASE|GOOGLE|OPENAI|ANTHROPIC|CLAUDE|CODEX)_/i;

function isBaseKey(key) {
  const upper = key.toUpperCase();
  return BASE_ENV_KEYS.has(upper) || upper.startsWith('LC_');
}

function isOperationalRuntimePath(key, value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return false;
  try {
    if (!fs.statSync(value).isDirectory()) return false;
    if (key === 'JAVA_HOME') {
      const executable = path.join(value, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
      if (!fs.statSync(executable).isFile()) return false;
      fs.accessSync(executable, fs.constants.X_OK);
      return true;
    }
    if (key === 'ANDROID_AVD_HOME') {
      fs.accessSync(value, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function buildSubprocessEnv({ source = process.env, provider = null, extra = {} } = {}) {
  const providerKeys = PROVIDER_ENV_KEYS[provider] || new Set();
  const env = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (value == null) continue;
    const upper = key.toUpperCase();
    if (isBaseKey(key) || providerKeys.has(upper) || isOperationalRuntimePath(upper, value)) env[key] = String(value);
  }
  for (const [key, value] of Object.entries(extra || {})) {
    if (value == null) delete env[key];
    else env[key] = String(value);
  }
  return env;
}

function isSensitiveEnvironmentKey(key) {
  return SENSITIVE_KEY.test(String(key)) || BLOCKED_NAMESPACE.test(String(key));
}

module.exports = { buildSubprocessEnv, isSensitiveEnvironmentKey };
