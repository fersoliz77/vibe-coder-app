const os = require('os');
const path = require('path');
const { ProvisioningError, normalizeForComparison } = require('./core');

const GRANT_TTL_MS = 10 * 60 * 1000;
const PROJECT_TYPES = new Set(['next-ts', 'vite-react-ts', 'mobile-suite']);
const BACKENDS = new Set(['none', 'firebase', 'supabase']);
const SUPABASE_REGIONS = new Set([
  'ap-east-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-south-1', 'ap-southeast-1',
  'ap-southeast-2', 'ca-central-1', 'eu-central-1', 'eu-central-2', 'eu-north-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'sa-east-1', 'us-east-1', 'us-east-2',
  'us-west-1', 'us-west-2',
]);
const FIREBASE_LOCATIONS = new Set([
  'nam5', 'eur3', 'asia-south1', 'asia-southeast1', 'australia-southeast1',
]);
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const FORBIDDEN_REQUEST_KEYS = new Set(['args', 'argv', 'command', 'commands', 'cliArgs', 'shell']);

function getDefaultProjectsRoot() {
  return path.join(os.homedir(), 'Documents', 'Vibe Projects');
}

function assertWindows(platform) {
  if (platform !== 'win32') {
    throw new ProvisioningError('UNSUPPORTED_PLATFORM', 'Project provisioning is supported on Windows only.');
  }
}

function assertRealParent(parentPath, fsImpl) {
  if (typeof parentPath !== 'string' || !parentPath.trim() || parentPath.includes('\0')) {
    throw new ProvisioningError('INVALID_LOCATION', 'Choose a valid parent folder.');
  }
  const resolved = path.resolve(parentPath);
  const root = path.parse(resolved).root;
  if (normalizeForComparison(resolved) === normalizeForComparison(root)) {
    throw new ProvisioningError('INVALID_LOCATION', 'A drive root cannot be used as a project location.');
  }
  let stat;
  try {
    stat = fsImpl.lstatSync(resolved);
  } catch {
    throw new ProvisioningError('INVALID_LOCATION', 'The selected parent folder does not exist.');
  }
  if (!stat.isDirectory()) throw new ProvisioningError('INVALID_LOCATION', 'The selected location is not a folder.');
  if (stat.isSymbolicLink()) {
    throw new ProvisioningError('INVALID_LOCATION', 'Junctions and symbolic links cannot be project locations.');
  }
  try {
    if (fsImpl.realpathSync.native) fsImpl.realpathSync.native(resolved);
    else fsImpl.realpathSync(resolved);
  } catch {
    throw new ProvisioningError('INVALID_LOCATION', 'The selected parent folder cannot be resolved.');
  }
  // Ancestors may be canonicalized by Windows (for example on hosted runners or redirected
  // Documents folders). The selected directory itself was checked with lstat above.
  return resolved;
}

function slugifyProjectName(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProvisioningError('INVALID_NAME', 'Enter a project name.');
  }
  const slug = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-')
    .slice(0, 48).replace(/-+$/g, '');
  if (slug.length < 2 || RESERVED_WINDOWS_NAMES.test(slug) || /[. ]$/.test(slug)) {
    throw new ProvisioningError('INVALID_NAME', 'The project name does not produce a safe Windows slug.');
  }
  return slug;
}

function getProvisioningOptions() {
  return {
    projectTypes: [
      { id: 'next-ts', label: 'Next.js + TypeScript' },
      { id: 'vite-react-ts', label: 'Vite + React + TypeScript' },
      { id: 'mobile-suite', label: 'Next.js web + Flutter Android (Kotlin)' },
    ],
    backends: [
      { id: 'none', label: 'No backend' },
      { id: 'firebase', label: 'Firebase (Spark)' },
      { id: 'supabase', label: 'Supabase (Nano)' },
    ],
    supabaseRegions: [...SUPABASE_REGIONS].sort(),
    firebaseLocations: [...FIREBASE_LOCATIONS].sort(),
    defaultProjectsRoot: getDefaultProjectsRoot(),
  };
}

function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new ProvisioningError('INVALID_REQUEST', 'A project provisioning request is required.');
  }
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (Object.hasOwn(request, key)) {
      throw new ProvisioningError('UNSAFE_ARGUMENTS', 'Custom commands and CLI arguments are not accepted.');
    }
  }
  const requestedType = request.type;
  const type = requestedType === 'web'
    ? (request.stack?.web === 'react-vite-typescript' ? 'vite-react-ts' : 'next-ts')
    : requestedType;
  if (!PROJECT_TYPES.has(type)) throw new ProvisioningError('INVALID_PROJECT_TYPE', 'Choose a supported project type.');
  if (Array.isArray(request.backend) || (request.firebase && request.supabase)) {
    throw new ProvisioningError('INVALID_BACKEND', 'Choose Firebase or Supabase, never both.');
  }
  let backend = request.backend || 'none';
  if (!request.backend && request.firebase) backend = 'firebase';
  if (!request.backend && request.supabase) backend = 'supabase';
  if (!BACKENDS.has(backend)) throw new ProvisioningError('INVALID_BACKEND', 'Choose Firebase, Supabase, or no backend.');
  if ((backend === 'firebase' && request.supabase) || (backend === 'supabase' && request.firebase)) {
    throw new ProvisioningError('INVALID_BACKEND', 'Choose Firebase or Supabase, never both.');
  }
  const name = request.name ?? request.projectName;
  const slug = slugifyProjectName(name);
  const normalized = { name: String(name).trim(), slug, type, backend };
  if (backend === 'supabase') {
    const config = typeof request.supabase === 'object' ? request.supabase : request.backendConfig || {};
    const organizationId = config.organizationId ?? request.supabaseOrganizationId;
    const region = config.region ?? request.supabaseRegion;
    const password = config.password ?? config.databasePassword ?? request.supabasePassword;
    if (typeof organizationId !== 'string' || !/^[A-Za-z0-9_-]{3,80}$/.test(organizationId)) {
      throw new ProvisioningError('INVALID_SUPABASE_ORG', 'Choose a valid Supabase organization.');
    }
    if (!SUPABASE_REGIONS.has(region)) throw new ProvisioningError('INVALID_SUPABASE_REGION', 'Choose a supported Supabase region.');
    if (typeof password !== 'string' || password.length < 12 || password.length > 128 || /[\r\n\0]/.test(password)) {
      throw new ProvisioningError('INVALID_DATABASE_PASSWORD', 'Use a database password between 12 and 128 characters without control characters.');
    }
    normalized.supabase = { organizationId, region, password };
  }
  if (backend === 'firebase') {
    const config = typeof request.firebase === 'object' ? request.firebase : request.backendConfig || {};
    const location = config.location ?? request.firebaseLocation ?? 'nam5';
    const projectId = config.projectId || slug;
    if (!/^[a-z](?:[a-z0-9-]{4,28}[a-z0-9])$/.test(projectId)) {
      throw new ProvisioningError('INVALID_FIREBASE_PROJECT', 'Choose a valid globally unique Firebase project ID.');
    }
    if (!FIREBASE_LOCATIONS.has(location)) throw new ProvisioningError('INVALID_FIREBASE_LOCATION', 'Choose a supported Firestore location.');
    normalized.firebase = { location, projectId };
  }
  return normalized;
}

function createGrantStore({ fsImpl, platform, now, randomUUID }) {
  const grants = new Map();
  return {
    create(parentPath) {
      assertWindows(platform);
      const resolved = assertRealParent(parentPath, fsImpl);
      const token = randomUUID();
      const expiresAt = now() + GRANT_TTL_MS;
      grants.set(token, { parentPath: resolved, expiresAt });
      return Object.freeze({ id: token, token, expiresAt });
    },
    consume(locationGrant) {
      const token = typeof locationGrant === 'string' ? locationGrant : locationGrant?.token || locationGrant?.id;
      if (typeof token !== 'string' || !token) {
        throw new ProvisioningError('INVALID_LOCATION_GRANT', 'Choose a project location again.');
      }
      const grant = grants.get(token);
      grants.delete(token);
      if (!grant || grant.expiresAt <= now()) {
        throw new ProvisioningError('EXPIRED_LOCATION_GRANT', 'The location permission expired. Choose the folder again.');
      }
      return assertRealParent(grant.parentPath, fsImpl);
    },
  };
}

module.exports = {
  assertRealParent,
  assertWindows,
  createGrantStore,
  getDefaultProjectsRoot,
  getProvisioningOptions,
  slugifyProjectName,
  validateRequest,
};
