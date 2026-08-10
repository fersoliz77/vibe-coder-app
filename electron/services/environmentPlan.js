const { INSTALL_ALLOWLIST, INSTALL_ORDER, normalizeOptions } = require('./environmentCatalog');

function getInstalledIds(environment) {
  const items = Array.isArray(environment?.items) ? environment.items : [];
  return new Set(items.filter((item) => item.installed).map((item) => item.id));
}

function buildInstallationPlan(options = {}, environment = { items: [] }) {
  const normalized = normalizeOptions(options);
  const installed = getInstalledIds(environment);
  const selected = new Set(['node', 'git', 'gh', 'vercel']);
  if (normalized.includeMobile) ['java', 'flutter'].forEach((id) => selected.add(id));
  if (normalized.backend === 'firebase') selected.add('firebase');

  // Reinstalling Node LTS is the allowlisted repair path when npm is missing.
  if (installed.has('node') && installed.has('npm')) selected.delete('node');
  for (const id of ['git', 'gh', 'vercel', 'java', 'flutter', 'firebase']) {
    if (installed.has(id)) selected.delete(id);
  }
  return INSTALL_ORDER.filter((id) => selected.has(id)).map((id) => INSTALL_ALLOWLIST[id]);
}

module.exports = { buildInstallationPlan };
