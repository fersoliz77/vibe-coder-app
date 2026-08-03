const { sanitize, sanitizeString } = require('../diagnostics/logger');

const ISSUE_CATEGORIES = new Set(['runtime', 'network', 'resource', 'responsive', 'accessibility']);
const ISSUE_SEVERITIES = new Set(['error', 'warning', 'info']);
const ISSUE_METADATA_KEYS = ['tag', 'id', 'name', 'text', 'url', 'method', 'resourceType', 'statusCode'];

function sanitizeLog(value, projectCwd = '') {
  let clean = String(value || '')
    .replace(/\x1B(?:\][^\x07]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r/g, '');
  if (projectCwd) clean = clean.split(projectCwd).join('[project]');
  return sanitizeString(clean, 8_000).trim();
}

function sanitizeIssue(input, projectCwd = '') {
  const safeInput = sanitize(input || {});
  const requestedCategory = safeInput?.category || safeInput?.kind;
  const category = ISSUE_CATEGORIES.has(requestedCategory) ? requestedCategory : 'runtime';
  const severity = ISSUE_SEVERITIES.has(safeInput?.severity) ? safeInput.severity : 'error';
  const metadata = {};

  for (const key of ISSUE_METADATA_KEYS) {
    const value = safeInput?.metadata?.[key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    let clean = sanitizeLog(value, projectCwd).slice(0, 240);
    if (key === 'url') {
      try {
        const parsed = new URL(clean);
        clean = `${parsed.origin}${parsed.pathname}`.slice(0, 240);
      } catch {}
    }
    metadata[key] = clean;
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    category,
    severity,
    message: sanitizeLog(safeInput?.message || 'Preview issue', projectCwd),
    metadata,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { sanitizeIssue, sanitizeLog };
