const MAX_AI_CHUNK_LENGTH = 64 * 1024;
const MAX_AI_RESPONSE_LENGTH = 1024 * 1024;
const MAX_AI_INPUT_LENGTH = 512 * 1024;
const TRUNCATION_MARKER = '\n[truncated]';

function truncateText(value, limit) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
}

function appendBounded(current, chunk, limit = MAX_AI_RESPONSE_LENGTH) {
  const existing = String(current || '');
  if (existing.endsWith(TRUNCATION_MARKER)) return { value: existing, delta: '', truncated: true };
  if (existing.length >= limit) {
    const value = `${existing.slice(0, Math.max(0, limit - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
    return { value, delta: TRUNCATION_MARKER, truncated: true };
  }
  const incoming = truncateText(chunk, MAX_AI_CHUNK_LENGTH);
  const remaining = limit - existing.length;
  if (incoming.length <= remaining && !incoming.endsWith(TRUNCATION_MARKER)) {
    return { value: existing + incoming, delta: incoming, truncated: false };
  }
  const delta = `${incoming.slice(0, Math.max(0, remaining - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`;
  return { value: existing + delta, delta, truncated: true };
}

module.exports = { MAX_AI_CHUNK_LENGTH, MAX_AI_INPUT_LENGTH, MAX_AI_RESPONSE_LENGTH, TRUNCATION_MARKER, appendBounded, truncateText };
