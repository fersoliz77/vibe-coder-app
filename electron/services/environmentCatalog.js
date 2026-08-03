const os = require('os');
const path = require('path');

const SUPPORTED_BACKENDS = Object.freeze(['firebase', 'supabase']);
const SUPABASE_INSTRUCTION = 'Instala Supabase CLI siguiendo la guía oficial: https://supabase.com/docs/guides/local-development/cli/getting-started. Después, vuelve a comprobar el entorno.';
const WINGET_ARGS = Object.freeze([
  'install',
  '--exact',
  '--silent',
  '--accept-package-agreements',
  '--accept-source-agreements',
  '--disable-interactivity',
]);

const INSTALL_ALLOWLIST = Object.freeze({
  node: Object.freeze({ id: 'node', label: 'Node.js LTS', file: 'winget.exe', args: Object.freeze([...WINGET_ARGS, '--id', 'OpenJS.NodeJS.LTS']) }),
  git: Object.freeze({ id: 'git', label: 'Git', file: 'winget.exe', args: Object.freeze([...WINGET_ARGS, '--id', 'Git.Git']) }),
  gh: Object.freeze({ id: 'gh', label: 'GitHub CLI', file: 'winget.exe', args: Object.freeze([...WINGET_ARGS, '--id', 'GitHub.cli']) }),
  java: Object.freeze({ id: 'java', label: 'JDK 17', file: 'winget.exe', args: Object.freeze([...WINGET_ARGS, '--id', 'EclipseAdoptium.Temurin.17.JDK']) }),
  'android-sdk': Object.freeze({ id: 'android-sdk', label: 'Android Studio y Android SDK', file: 'winget.exe', args: Object.freeze([...WINGET_ARGS, '--id', 'Google.AndroidStudio']) }),
  flutter: Object.freeze({
    id: 'flutter',
    label: 'Flutter',
    file: 'git',
    args: Object.freeze([
      'clone', '--branch', 'stable', '--depth', '1',
      'https://github.com/flutter/flutter.git',
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'flutter'),
    ]),
  }),
  vercel: Object.freeze({ id: 'vercel', label: 'Vercel CLI', file: 'npm', args: Object.freeze(['install', '--global', 'vercel']) }),
  firebase: Object.freeze({ id: 'firebase', label: 'Firebase CLI', file: 'npm', args: Object.freeze(['install', '--global', 'firebase-tools']) }),
});

const INSTALL_ORDER = Object.freeze(['node', 'git', 'gh', 'java', 'android-sdk', 'flutter', 'vercel', 'firebase']);
const ITEM_CATALOG = Object.freeze({
  node: Object.freeze({ name: 'Node.js', category: 'core', required: true, installable: true }),
  npm: Object.freeze({ name: 'npm', category: 'core', required: true, installable: true }),
  git: Object.freeze({ name: 'Git', category: 'core', required: true, installable: true }),
  gh: Object.freeze({ name: 'GitHub CLI', category: 'tools', required: true, installable: true }),
  vercel: Object.freeze({ name: 'Vercel CLI', category: 'deployment', required: true, installable: true }),
  firebase: Object.freeze({ name: 'Firebase CLI', category: 'backend', installable: true }),
  supabase: Object.freeze({ name: 'Supabase CLI', category: 'backend', installable: false }),
  flutter: Object.freeze({ name: 'Flutter', category: 'mobile', required: true, installable: true }),
  java: Object.freeze({ name: 'JDK 17', category: 'mobile', required: true, installable: true }),
  'android-sdk': Object.freeze({ name: 'Android SDK', category: 'mobile', required: true, installable: true }),
});

function normalizeOptions(options = {}) {
  if (!options || typeof options !== 'object') options = {};
  const backend = options.backend == null ? 'firebase' : String(options.backend).toLowerCase();
  if (!SUPPORTED_BACKENDS.includes(backend)) {
    throw new TypeError(`Backend no soportado. Usa uno de: ${SUPPORTED_BACKENDS.join(', ')}.`);
  }
  return { includeMobile: options.includeMobile === true, backend };
}

function itemMetadata(id, options) {
  const metadata = ITEM_CATALOG[id];
  if (id === 'firebase' || id === 'supabase') return { id, ...metadata, required: options.backend === id };
  return { id, ...metadata };
}

module.exports = { INSTALL_ALLOWLIST, INSTALL_ORDER, SUPABASE_INSTRUCTION, itemMetadata, normalizeOptions };
