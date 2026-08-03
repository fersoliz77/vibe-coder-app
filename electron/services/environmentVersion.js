const VERSION_PATTERNS = Object.freeze({
  node: /(?:^|\s)v(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i,
  npm: /(?:^|\s)(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?:\s|$)/,
  git: /git version\s+([^\s]+)/i,
  gh: /gh version\s+([^\s]+)/i,
  vercel: /(?:vercel(?: cli)?\s+)?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i,
  firebase: /(?:firebase(?: cli)?\s+)?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i,
  supabase: /(?:supabase(?: cli)?\s+)?v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i,
  flutter: /flutter\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i,
  java: /(?:openjdk|java|javac)\s+(?:version\s+)?["']?(\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?)/i,
});
const DEFAULT_VERSION_PATTERN = /(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i;

function stripAnsi(value) {
  return String(value || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
}

function parseVersionOutput(tool, output) {
  const clean = stripAnsi(output).replace(/\r/g, '');
  if (!clean) return null;
  const match = clean.match(VERSION_PATTERNS[tool] || DEFAULT_VERSION_PATTERN);
  return match ? match[1] : null;
}

module.exports = { parseVersionOutput, stripAnsi };
