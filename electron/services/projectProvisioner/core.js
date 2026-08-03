const path = require('path');

class ProvisioningError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProvisioningError';
    this.code = code;
    Object.assign(this, details);
  }
}

function normalizeForComparison(candidate) {
  const resolved = path.resolve(candidate);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sanitizeText(value) {
  let text = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  text = text.replace(/(password|secret|service[_ -]?role|access[_ -]?token|refresh[_ -]?token|api[_ -]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]');
  text = text.replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted]');
  text = text.replace(/\bsb_(?:secret|service_role)_[A-Za-z0-9_-]+\b/gi, '[redacted]');
  return text.slice(0, 500);
}

function publicError(error) {
  if (error?.code === 'CANCELLED' || error?.name === 'AbortError') {
    return { code: 'CANCELLED', message: 'Provisioning was cancelled.' };
  }
  if (error?.code === 'SUPABASE_QUOTA') {
    return {
      code: 'SUPABASE_QUOTA',
      provider: 'supabase',
      message: 'Supabase could not create another Nano project because this organization has reached its quota. Choose Firebase or upgrade the Supabase organization, then retry.',
      alternatives: ['firebase', 'supabase-upgrade'],
    };
  }
  return {
    code: error?.code || 'PROVISIONING_FAILED',
    message: sanitizeText(error?.publicMessage || error?.message || 'Project provisioning failed.'),
  };
}

function parseJsonOutput(output) {
  const text = String(output || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const closing = text[start] === '[' ? text.lastIndexOf(']') : text.lastIndexOf('}');
  if (closing <= start) return null;
  try {
    return JSON.parse(text.slice(start, closing + 1));
  } catch {
    return null;
  }
}

function findValue(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key) && (typeof child === 'string' || typeof child === 'number')) return String(child);
  }
  for (const child of Object.values(value)) {
    const found = findValue(child, keys);
    if (found) return found;
  }
  return null;
}

function writeJson(filePath, value, fsImpl) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  fsImpl.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function writeText(filePath, value, fsImpl) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  fsImpl.writeFileSync(filePath, value, { encoding: 'utf8', flag: 'wx' });
}

function clientEnvPath(projectPath, type) {
  return path.join(type === 'mobile-suite' ? path.join(projectPath, 'web') : projectPath, '.env.local');
}

function envPrefix(type) {
  return type === 'vite-react-ts' ? 'VITE_' : 'NEXT_PUBLIC_';
}

async function runRemoteCreation(descriptor, operation) {
  descriptor.status = 'attempting';
  descriptor.created = null;
  try {
    const result = await operation();
    descriptor.status = 'created';
    descriptor.created = true;
    return result;
  } catch (error) {
    descriptor.status = 'unknown';
    descriptor.created = null;
    throw error;
  }
}

module.exports = {
  ProvisioningError,
  clientEnvPath,
  envPrefix,
  findValue,
  normalizeForComparison,
  parseJsonOutput,
  publicError,
  runRemoteCreation,
  sanitizeText,
  writeJson,
  writeText,
};
