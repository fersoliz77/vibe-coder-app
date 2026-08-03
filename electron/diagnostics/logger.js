const os = require('os');

const DEFAULT_CAPACITY = 200;
const MAX_STRING_LENGTH = 500;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const AUTHORIZATION = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi;
const COOKIE_HEADER = /\b(?:set-cookie|cookie)\s*:\s*[^\r\n]+/gi;
const JSON_SECRET = /("(?:access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|(?:set[_-]?)?cookie|password|secret|api[_-]?key|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|supabase[_-]?(?:anon|service[_-]?role)[_-]?key|prompt|code|content)"\s*:\s*)"(?:\\.|[^"\\])*"/gi;
const SINGLE_QUOTED_SECRET = /('(?:access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|(?:set[_-]?)?cookie|password|secret|api[_-]?key|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|supabase[_-]?(?:anon|service[_-]?role)[_-]?key|prompt|code|content)'\s*:\s*)'(?:\\.|[^'\\])*'/gi;
const ASSIGNED_SECRET = /\b(token|(?:access|refresh|id)[_-]?token|password|secret|api[_-]?key|authorization|cookie|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|supabase[_-]?(?:anon|service[_-]?role)[_-]?key)\s*[=:]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi;
const TOKEN_VALUE = /\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?|sk-[A-Za-z0-9_-]{12,}|gh[opusr]_[A-Za-z0-9]{12,})\b/g;
const WINDOWS_PATH = /(?:[A-Za-z]:\\|\\\\)[^\r\n"'<>|,;]+/g;
const UNIX_USER_PATH = /\/(?:Users|home)\/[^/\r\n]+(?:\/[^\r\n"'<>]*)?/g;

function isSensitiveKey(key) {
  const normalized = String(key).replace(/[-_]/g, '').toLowerCase();
  if (/(authorization|cookie|credential|password|secret|token|apikey|prompt|email)/.test(normalized)) return true;
  return ['code', 'content', 'source', 'output', 'stdout', 'stderr', 'history', 'path', 'cwd', 'directory', 'folder', 'file'].includes(normalized)
    || /(path|directory|folder|filename)$/.test(normalized);
}

function sanitizeString(value, maxLength = MAX_STRING_LENGTH) {
  const limit = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : MAX_STRING_LENGTH;
  return String(value)
    .replace(JSON_SECRET, '$1"[redacted]"')
    .replace(SINGLE_QUOTED_SECRET, "$1'[redacted]'")
    .replace(AUTHORIZATION, '[redacted]')
    .replace(COOKIE_HEADER, 'cookie: [redacted]')
    .replace(ASSIGNED_SECRET, '$1=[redacted]')
    .replace(TOKEN_VALUE, '[redacted]')
    .replace(EMAIL, '[email]')
    .replace(WINDOWS_PATH, '[path]')
    .replace(UNIX_USER_PATH, '[path]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, limit);
}

function sanitize(value, seen = new WeakSet()) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value !== 'object') return sanitizeString(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitize(entry, seen));
  const clean = {};
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    if (isSensitiveKey(key)) {
      clean[key] = '[redacted]';
      continue;
    }
    clean[key] = sanitize(entry, seen);
  }
  return clean;
}

function classifyError(error, fallback = 'unexpected') {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_-]{1,80}$/i.test(error.code) ? error.code : null;
  const name = typeof error?.name === 'string' && /^[A-Za-z]+Error$/.test(error.name) ? error.name : 'Error';
  return { category: fallback, name, ...(code ? { errorCode: code } : {}) };
}

function recordUnhandledRejection(logger, reason) {
  logger.log('main', 'uncaught-error', classifyError(reason, 'unhandled-rejection'));
  throw reason instanceof Error ? reason : new Error('Unhandled promise rejection');
}

function createDiagnosticsLogger({ capacity = DEFAULT_CAPACITY, now = () => new Date() } = {}) {
  const limit = Math.max(1, Math.min(1_000, Math.floor(Number(capacity) || DEFAULT_CAPACITY)));
  const events = new Array(limit);
  const states = {};
  let sequence = 0;
  let nextIndex = 0;
  let eventCount = 0;

  return {
    log(area, event, details = {}) {
      const entry = sanitize({
        sequence: ++sequence,
        timestamp: now().toISOString(),
        area,
        event,
        details,
      });
      events[nextIndex] = entry;
      nextIndex = (nextIndex + 1) % limit;
      eventCount = Math.min(eventCount + 1, limit);
      return entry;
    },
    setState(name, state) {
      states[sanitizeString(name)] = sanitize(state);
    },
    getEvents() {
      const ordered = [];
      const start = (nextIndex - eventCount + limit) % limit;
      for (let index = 0; index < eventCount; index += 1) ordered.push(events[(start + index) % limit]);
      return sanitize(ordered);
    },
    getStates() {
      return sanitize(states);
    },
    capacity: limit,
  };
}

const diagnostics = createDiagnosticsLogger();

module.exports = { DEFAULT_CAPACITY, classifyError, createDiagnosticsLogger, diagnostics, recordUnhandledRejection, sanitize, sanitizeString };
