const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateProjectCwd, isSubPath } = require('../ipc/fsGuards');
const { classifyWebScript } = require('./previewCommands');

const SCHEMA_VERSION = 3;
/*
 * Estos limites eran un presupuesto de latencia: 2500 ms y 5000 entradas para
 * que el dialogo contestara rapido. El efecto real era el contrario al buscado.
 * La carpeta de este mismo repo tarda ~900 ms en caliente y pasaba los 2500 ms
 * en frio, asi que volvia con "analisis parcial" sin haber terminado de mirarla
 * y quien importaba decidia sobre datos incompletos, que es peor que esperar.
 *
 * El analisis ahora tarda lo que tenga que tardar y avisa mientras corre. Lo
 * que queda son topes contra carpetas patologicas -- una raiz de disco entera,
 * un arbol ciclico -- no un presupuesto de latencia. Cuando uno de estos salta
 * es una anomalia real y el aviso de resultado parcial significa algo.
 */
const DEFAULT_LIMITS = Object.freeze({ maxDepth: 10, maxEntries: 200000, maxFiles: 4000, maxBytes: 64 * 1024 * 1024, maxFileBytes: 256 * 1024, timeoutMs: 120000 });
const PROGRESS_INTERVAL_MS = 120;
const IGNORED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', '.next', '.nuxt', '.output', '.svelte-kit', '.angular',
  '.cache', '.parcel-cache', '.turbo', '.nx', 'dist', 'out', 'build', 'coverage', 'target', 'bin', 'obj', '.gradle',
  '.idea', '.vscode', '__pycache__', '.pytest_cache', '.mypy_cache', '.tox', '.nox', '.venv', 'venv', 'site-packages',
  'vendor', '.bundle', 'Pods', 'DerivedData', '.dart_tool', '.pub-cache', '.terraform',
]);
const EXACT_MANIFESTS = new Set([
  'package.json', 'pubspec.yaml', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'go.work', 'pom.xml', 'composer.json',
  'Gemfile', 'settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts', 'Package.swift',
  'CMakeLists.txt', 'mix.exs', 'deno.json', 'deno.jsonc', 'build.zig', 'pnpm-workspace.yaml',
]);
const FRAMEWORKS = new Map([
  ['next', ['Next.js', 'web']], ['nuxt', ['Nuxt', 'web']], ['@angular/core', ['Angular', 'web']],
  ['@sveltejs/kit', ['SvelteKit', 'web']], ['astro', ['Astro', 'web']], ['gatsby', ['Gatsby', 'web']],
  ['@remix-run/react', ['Remix', 'web']], ['@builder.io/qwik', ['Qwik', 'web']], ['vue', ['Vue', 'web']],
  ['react', ['React', 'web']], ['svelte', ['Svelte', 'web']], ['@nestjs/core', ['NestJS', 'service']],
  ['express', ['Express', 'service']], ['fastify', ['Fastify', 'service']], ['hono', ['Hono', 'service']],
  ['electron', ['Electron', 'desktop']], ['@tauri-apps/api', ['Tauri', 'desktop']],
  /*
   * Van al final a proposito: `react` ya paso antes y fijo el kind en `web`.
   * Estas entradas no lo cambian (mover el kind cambiaria el id del target y
   * los proyectos ya importados guardan ese id), pero si dejan el shell
   * declarado en `technologies`, que es de donde el agrupado por producto saca
   * la plataforma real.
   */
  ['react-native', ['React Native', 'mobile']], ['expo', ['Expo', 'mobile']], ['@capacitor/core', ['Capacitor', 'mobile']],
]);
const BACKEND_PACKAGES = new Map([
  ['@supabase/supabase-js', 'Supabase'], ['firebase', 'Firebase'], ['prisma', 'Prisma'], ['@prisma/client', 'Prisma'],
  ['drizzle-orm', 'Drizzle'], ['mongoose', 'MongoDB'], ['pg', 'PostgreSQL'], ['mysql2', 'MySQL'], ['redis', 'Redis'],
]);
const LOCKFILES = Object.freeze({ 'package-lock.json': 'npm', 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lock': 'bun', 'bun.lockb': 'bun' });
const ENV_FILE = /^\.env(?:\.(?:example|sample|template|local|development|production|test))?$/i;
const ENV_REFERENCE_FILE = /\.(?:js|jsx|ts|tsx|mjs|cjs|vue|svelte)$/i;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{1,127}$/;
const SCRIPT_NAME = /^[A-Za-z0-9:_-]{1,80}$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const STRUCTURAL_MARKERS = new Set(['.git', 'node_modules', 'pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json', 'firebase.json', 'vercel.json', '.vercel', 'Dockerfile', 'compose.yaml', 'docker-compose.yml', 'supabase', 'prisma']);

/*
 * Un manifiesto no es un producto.
 *
 * El analisis encuentra targets: un package.json es un target, un pubspec.yaml
 * es otro. Pero una carpeta con `mi-app/web` y `mi-app/movil` no tiene dos
 * productos, tiene uno que corre en dos plataformas, y quien importa la
 * carpeta necesita leer eso y no una lista plana de manifiestos.
 *
 * El agrupado es por carpeta de producto: el primer segmento de la ruta, salvo
 * que sea un contenedor de monorepo (`apps/`, `packages/`), donde cada hijo es
 * su propio producto. Es la convencion real de estos repos y se puede
 * comprobar leyendo rutas, sin ejecutar nada del proyecto.
 */
const PRODUCT_CONTAINERS = new Set(['apps', 'packages', 'services', 'sites', 'examples', 'projects', 'clients', 'servers', 'functions', 'workspaces']);
const PLATFORM_BY_KIND = new Map([
  ['web', 'web'], ['flutter', 'mobile'], ['android', 'mobile'], ['apple', 'mobile'], ['swift', 'mobile'], ['dart', 'mobile'],
  ['desktop', 'desktop'], ['service', 'backend'], ['python', 'backend'], ['go', 'backend'], ['jvm', 'backend'],
  ['php', 'backend'], ['ruby', 'backend'], ['elixir', 'backend'], ['dotnet', 'backend'], ['rust', 'backend'], ['native', 'backend'],
]);
/*
 * Hasta aca todo el stack se deducia de las dependencias declaradas. Un
 * proyecto sin dependencias -- un servidor con `node:http`, una pagina con
 * index.html, un script de Python -- no tenia nada que buscar en esos mapas y
 * salia como "JavaScript" a secas, o directamente como carpeta sin aplicacion.
 *
 * Esta capa lee lo que hay en el disco: extensiones, archivos marcadores y los
 * entry points. Sigue siendo analisis estatico, sin ejecutar nada del proyecto.
 */
const LANGUAGE_BY_EXTENSION = new Map([
  ['.js', 'JavaScript'], ['.mjs', 'JavaScript'], ['.cjs', 'JavaScript'], ['.jsx', 'JavaScript'],
  ['.ts', 'TypeScript'], ['.tsx', 'TypeScript'], ['.vue', 'Vue'], ['.svelte', 'Svelte'],
  ['.py', 'Python'], ['.go', 'Go'], ['.rs', 'Rust'], ['.rb', 'Ruby'], ['.php', 'PHP'],
  ['.java', 'Java'], ['.kt', 'Kotlin'], ['.kts', 'Kotlin'], ['.cs', 'C#'], ['.swift', 'Swift'],
  ['.dart', 'Dart'], ['.ex', 'Elixir'], ['.exs', 'Elixir'], ['.lua', 'Lua'],
  ['.c', 'C'], ['.h', 'C'], ['.cpp', 'C++'], ['.cc', 'C++'], ['.hpp', 'C++'],
  ['.sh', 'Shell'], ['.ps1', 'PowerShell'], ['.sql', 'SQL'], ['.html', 'HTML'], ['.css', 'CSS'],
  ['.scss', 'CSS'], ['.sass', 'CSS'], ['.less', 'CSS'],
]);
/* Lenguajes de presentacion y datos: acompañan a un stack pero no lo definen solos. */
const SUPPORTING_LANGUAGES = new Set(['HTML', 'CSS', 'SQL', 'Shell', 'PowerShell']);
const DATABASE_BY_MARKER = new Map([
  ['schema.prisma', 'Prisma'], ['prisma', 'Prisma'], ['supabase', 'Supabase'], ['migrations', 'SQL migrations'],
  ['knexfile.js', 'Knex'], ['sequelize', 'Sequelize'], ['alembic.ini', 'Alembic'],
]);
const DATABASE_BY_EXTENSION = new Map([
  ['.sqlite', 'SQLite'], ['.sqlite3', 'SQLite'], ['.db', 'SQLite'], ['.sql', 'SQL'],
]);
/* Nombres de entry point que vale la pena abrir para confirmar si algo levanta un servidor. */
const ENTRY_FILE_NAMES = ['server.mjs', 'server.js', 'server.ts', 'index.mjs', 'index.js', 'index.ts', 'app.js', 'app.mjs', 'main.js', 'main.py', 'app.py', 'server.py', 'main.go'];
const SERVER_SIGNALS = [
  [/\bfrom\s+["']node:http2?["']|require\(["']node:?https?["']\)/, 'HTTP server'],
  [/\bcreateServer\s*\(/, 'HTTP server'],
  [/\.listen\s*\(/, 'HTTP server'],
  [/\bfrom\s+["']express["']|require\(["']express["']\)/, 'Express'],
  [/\bfrom\s+["']fastify["']|require\(["']fastify["']\)/, 'Fastify'],
  [/\bfastapi\b|\bFastAPI\(/, 'FastAPI'],
  [/\bflask\b|\bFlask\(/, 'Flask'],
  [/\bhttp\.ListenAndServe\b/, 'HTTP server'],
];
const NATIVE_PROCESS_SIGNAL = /\bfrom\s+["']node:child_process["']|require\(["']child_process["']\)|\bsubprocess\.(?:run|Popen)\b/;
const MAX_ENTRY_FILES = 8;
const MAX_ENTRY_SCAN_BYTES = 96 * 1024;
/*
 * Codigo dentro de estas carpetas es herramienta, no producto. Un repositorio
 * de documentacion con cinco scripts de mantenimiento no es una aplicacion, y
 * sin esta distincion cualquier carpeta con un `.js` suelto pasaba a serlo.
 */
const HELPER_DIRECTORIES = new Set(['scripts', 'tools', 'bin', 'docs', 'doc', 'examples', 'example', 'samples', 'test', 'tests', '__tests__', 'spec', 'specs', 'fixtures', 'e2e', 'benchmark', 'benchmarks']);

function isHelperDirectory(relativeDirectory) {
  if (relativeDirectory === '.') return false;
  return relativeDirectory.split('/').some((segment) => HELPER_DIRECTORIES.has(segment.toLowerCase()));
}

const PLATFORM_BY_TECHNOLOGY = new Map([
  ['Electron', 'desktop'], ['Tauri', 'desktop'], ['React Native', 'mobile'], ['Expo', 'mobile'], ['Capacitor', 'mobile'],
]);
const PLATFORM_ORDER = ['web', 'mobile', 'desktop', 'backend', 'code', 'library'];
const CONFIDENCE_RANK = { high: 0, strong: 1, medium: 2, low: 3 };

const toRelative = (root, target) => path.relative(root, target).split(path.sep).join('/') || '.';
const targetId = (kind, relativePath) => `${kind}-${crypto.createHash('sha1').update(`${kind}:${relativePath}`).digest('hex').slice(0, 10)}`;
const unique = (values) => [...new Set(values.filter(Boolean))];

function normalizeWorkspacePatterns(value) {
  const source = Array.isArray(value) ? value : (value && Array.isArray(value.packages) ? value.packages : []);
  return source.map((item) => String(item || '').trim().replace(/^['"]|['"]$/g, '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''))
    .filter((item) => item.length > 0 && item.length <= 240 && !path.posix.isAbsolute(item.replace(/^!/, '')) && !item.replace(/^!/, '').split('/').includes('..'))
    .slice(0, 100);
}

function parsePnpmWorkspacePatterns(content) {
  const inline = content.match(/^packages\s*:\s*\[([^\]]*)\]/m)?.[1];
  if (inline !== undefined) return normalizeWorkspacePatterns(inline.split(','));
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => /^packages\s*:\s*$/.test(line.trim()));
  if (start < 0) return [];
  const patterns = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim()) break;
    const match = line.match(/^\s+-\s+(.+?)\s*(?:#.*)?$/);
    if (match) patterns.push(match[1]);
  }
  return normalizeWorkspacePatterns(patterns);
}

function globPatternMatches(pattern, relativePath) {
  let expression = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') { expression += '.*'; index += 1; }
    else if (character === '*') expression += '[^/]*';
    else if (character === '?') expression += '[^/]';
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`^${expression}$`).test(relativePath);
}

function workspaceDefinitionMatches(definition, packagePath) {
  const relative = definition.rootPath === '.' ? packagePath : path.posix.relative(definition.rootPath, packagePath);
  if (!relative || relative === '.' || relative.startsWith('../')) return false;
  const positives = definition.patterns.filter((pattern) => !pattern.startsWith('!'));
  const exclusions = definition.patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
  return positives.some((pattern) => globPatternMatches(pattern, relative)) && !exclusions.some((pattern) => globPatternMatches(pattern, relative));
}

function resolvedDependencyRoot(root, directory, packageName) {
  let current = directory;
  while (isSubPath(root, current)) {
    if (fs.existsSync(path.join(current, 'node_modules', ...packageName.split('/'), 'package.json'))) return toRelative(root, path.join(current, 'node_modules'));
    if (current === root) break;
    current = path.dirname(current);
  }
  return null;
}

function scriptCategory(name) {
  if (/^(dev|serve|watch)$/.test(name)) return 'development';
  if (/^(start|preview)$/.test(name)) return 'start';
  if (/^(build|compile|bundle)/.test(name)) return 'build';
  if (/^(test|spec)(:|$)/.test(name)) return 'test';
  if (/^lint(:|$)/.test(name)) return 'lint';
  if (/^format(:|$)/.test(name)) return 'format';
  if (/^(deploy|release)(:|$)/.test(name)) return 'deploy';
  return 'other';
}

function addEnvironmentName(environmentNames, name, source, kind) {
  if (!ENV_NAME.test(name)) return;
  const current = environmentNames.get(name) || { name, sources: [] };
  if (!current.sources.some((item) => item.path === source && item.kind === kind)) current.sources.push({ path: source, kind });
  environmentNames.set(name, current);
}

function inspectEnvironmentContent(environmentNames, content, source, kind) {
  if (kind === 'code-reference') {
    const patterns = [/\bprocess\.env\.([A-Z_][A-Z0-9_]*)/g, /\bimport\.meta\.env\.([A-Z_][A-Z0-9_]*)/g];
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) addEnvironmentName(environmentNames, match[1], source, kind);
    }
    return;
  }
  for (const line of content.split(/\r?\n/, 500)) {
    if (line.length > 1024) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
    if (match) addEnvironmentName(environmentNames, match[1], source, kind);
  }
}

async function inspectEnvironmentFile(environmentNames, filePath, source, kind) {
  let prefix = '';
  let ignoreRemainder = false;
  const reset = () => { prefix = ''; ignoreRemainder = false; };
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 4096 })) {
    for (const byte of chunk) {
      if (byte === 10) { reset(); continue; }
      if (ignoreRemainder || byte === 13) continue;
      if (byte === 61) {
        const match = prefix.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*$/);
        if (match) addEnvironmentName(environmentNames, match[1], source, kind);
        ignoreRemainder = true;
        continue;
      }
      if (prefix.length < 160) prefix += String.fromCharCode(byte);
      else ignoreRemainder = true;
    }
  }
}

function publicEnvironment(environmentNames) {
  const names = [...environmentNames.values()]
    .map((entry) => ({
      ...entry,
      sources: entry.sources.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind)),
      required: entry.sources.some((source) => source.kind === 'example'),
      configuredLocally: entry.sources.some((source) => source.kind === 'local-env'),
      publicClientVariable: /^(?:VITE_|NEXT_PUBLIC_|PUBLIC_|EXPO_PUBLIC_)/.test(entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { names: names.slice(0, 200), valuesStored: false, valuesReturned: false };
}

function assessProject({ targets, workspaceSignals, packageManagers, git, warnings }) {
  const concreteTargets = targets.filter((item) => item.kind !== 'generic');
  let score = 0;
  if (concreteTargets.length) score += 55;
  if (concreteTargets.some((item) => ['high', 'strong'].includes(item.confidence))) score += 20;
  if (packageManagers.length) score += 10;
  if (workspaceSignals.length) score += 10;
  if (git.detected) score += 5;
  if (warnings.some((warning) => warning.code === 'MALFORMED_MANIFEST')) score = Math.max(score, 20);
  score = Math.min(100, score);
  const classification = score >= 50 ? 'project' : score >= 25 ? 'probable-project' : 'folder';
  return {
    classification,
    score,
    importAllowed: true,
    requiresAcknowledgement: classification !== 'project',
    reasons: [
      concreteTargets.length ? { code: 'MANIFESTS_FOUND', tone: 'positive', count: concreteTargets.length } : { code: 'NO_MANIFESTS', tone: 'warning', count: 0 },
      git.detected ? { code: 'GIT_FOUND', tone: 'positive', count: 1 } : { code: 'NO_GIT', tone: 'neutral', count: 0 },
      workspaceSignals.length ? { code: 'WORKSPACE_FOUND', tone: 'positive', count: workspaceSignals.length } : null,
    ].filter(Boolean),
  };
}

function buildReadiness({ assessment, targets, dependencies, environment, warnings, complete }) {
  const supportedPreview = targets.some((item) => item.capabilities.webPreview || item.capabilities.androidPreview);
  const installNeeded = dependencies.some((item) => item.installState === 'install-needed');
  const missingEnvironment = environment.names.filter((item) => item.required && !item.configuredLocally).map((item) => item.name);
  const checks = [
    { id: 'project', status: assessment.classification === 'project' ? 'ready' : 'attention' },
    { id: 'target', status: targets.some((item) => item.kind !== 'generic') ? 'ready' : 'attention' },
    { id: 'dependencies', status: installNeeded ? 'action' : 'ready' },
    { id: 'environment', status: missingEnvironment.length ? 'action' : 'ready', count: missingEnvironment.length },
    { id: 'preview', status: supportedPreview ? 'ready' : 'optional' },
    { id: 'analysis', status: complete && !warnings.length ? 'ready' : 'attention' },
  ];
  let status = 'ready';
  if (assessment.classification === 'folder') status = 'not-a-project';
  else if (installNeeded || missingEnvironment.length) status = 'configuration-needed';
  else if (!supportedPreview || warnings.length || !complete || assessment.classification !== 'project') status = 'ready-with-warnings';
  return {
    status,
    checks,
    missingEnvironment,
    recommendations: unique([
      installNeeded ? 'INSTALL_DEPENDENCIES' : null,
      missingEnvironment.length ? 'CONFIGURE_ENVIRONMENT' : null,
      !supportedPreview ? 'REVIEW_PREVIEW' : null,
      !complete ? 'REVIEW_PARTIAL_SCAN' : null,
      assessment.classification !== 'project' ? 'CONFIRM_PROJECT_ROOT' : null,
    ]),
  };
}

function target({ root, directory, kind, role = 'application', name, framework, language, confidence, evidence, technologies = [], capabilities = {}, previewProfile = null, fileSignals = {} }) {
  const relativePath = toRelative(root, directory);
  return {
    id: targetId(kind, relativePath),
    name: String(name || path.basename(directory)).slice(0, 100),
    relativePath,
    kind,
    role,
    framework: framework || null,
    language: language || null,
    confidence,
    evidence: unique(evidence).slice(0, 8),
    technologies: unique(technologies).slice(0, 16),
    capabilities: { explorer: true, terminal: true, webPreview: false, androidPreview: false, ...capabilities },
    previewProfile,
    fileSignals: { web: false, backend: false, ...fileSignals },
  };
}

function packageTarget(root, directory, parsed, relativeManifest) {
  const dependencies = { ...parsed.dependencies, ...parsed.devDependencies, ...parsed.peerDependencies, ...parsed.optionalDependencies };
  const technologies = [];
  let framework = null;
  let kind = 'javascript';
  /*
   * Esta regla estaba al reves. `private: true` significa "no publicar en npm",
   * que es justamente lo que declara una aplicacion; una libreria es lo que si
   * se publica. Y solo miraba `dev`, ignorando `start`, el script mas comun de
   * Node: un POS que arranca con `npm start` quedaba clasificado como libreria
   * y por lo tanto la carpeta figuraba sin ninguna aplicacion.
   *
   * Lo que de verdad describe a un paquete publicable es tener punto de entrada
   * declarado (`main`, `module`, `exports`, `types`) y ningun script que lo
   * levante.
   */
  const runnableScript = ['dev', 'start', 'serve'].some((name) => typeof parsed.scripts?.[name] === 'string');
  const publishableEntry = ['main', 'module', 'exports', 'types', 'bin'].some((field) => parsed[field] !== undefined);
  /* Declarar `workspaces` describe la raiz que agrupa a otros, no un producto. */
  let role = parsed.workspaces ? 'workspace-root' : (!runnableScript && publishableEntry ? 'package' : 'application');
  /* Un script que corre un archivo con node levanta un proceso: es backend aunque no haya ninguna dependencia declarada. */
  const nodeEntryScript = ['start', 'dev', 'serve'].some((name) => /^node\s+\S+/.test(String(parsed.scripts?.[name] || '').trim()));
  for (const [dependency, [label, detectedKind]] of FRAMEWORKS) {
    if (!Object.hasOwn(dependencies, dependency)) continue;
    technologies.push(label);
    if (!framework || detectedKind !== 'web') framework = label;
    if (detectedKind === 'web') { kind = 'web'; role = 'application'; framework ||= label; }
    else if (kind !== 'web') { kind = detectedKind; framework ||= label; }
  }
  for (const [dependency, label] of BACKEND_PACKAGES) if (Object.hasOwn(dependencies, dependency)) technologies.push(label);
  if (Object.hasOwn(dependencies, 'typescript') || fs.existsSync(path.join(directory, 'tsconfig.json'))) technologies.push('TypeScript');
  else technologies.push('JavaScript');
  if (Object.hasOwn(dependencies, 'vite')) technologies.push('Vite');
  const previewProfile = classifyWebScript(parsed);
  const evidence = [relativeManifest];
  if (framework) evidence.push(`dependency:${framework}`);
  if (parsed.scripts?.dev) evidence.push(previewProfile ? `supported-dev-script:${previewProfile}` : 'dev-script-present');
  return target({
    root, directory, kind, role, name: parsed.name, framework, language: technologies.includes('TypeScript') ? 'TypeScript' : 'JavaScript',
    confidence: framework ? (previewProfile ? 'high' : 'strong') : 'medium', evidence, technologies,
    capabilities: { webPreview: Boolean(previewProfile) }, previewProfile,
    fileSignals: { web: false, backend: nodeEntryScript },
  });
}

function textTarget(root, directory, fileName, content) {
  const evidence = [toRelative(root, path.join(directory, fileName))];
  if (fileName === 'pubspec.yaml') {
    const flutter = /^\s*flutter\s*:\s*$/m.test(content) || /sdk\s*:\s*flutter/m.test(content);
    const name = content.match(/^name\s*:\s*([^\s#]+)/m)?.[1];
    return target({ root, directory, kind: flutter ? 'flutter' : 'dart', name, framework: flutter ? 'Flutter' : 'Dart', language: 'Dart', confidence: flutter ? 'high' : 'strong', evidence, technologies: flutter ? ['Flutter', 'Dart'] : ['Dart'], capabilities: { androidPreview: flutter && fs.existsSync(path.join(directory, 'android')) } });
  }
  if (fileName === 'pyproject.toml') {
    const framework = /django/i.test(content) ? 'Django' : /fastapi/i.test(content) ? 'FastAPI' : /flask/i.test(content) ? 'Flask' : 'Python';
    return target({ root, directory, kind: 'python', role: framework === 'Python' ? 'package' : 'service', framework, language: 'Python', confidence: 'strong', evidence, technologies: [framework, 'Python'] });
  }
  if (fileName === 'Cargo.toml') return target({ root, directory, kind: 'rust', framework: 'Cargo', language: 'Rust', confidence: 'strong', evidence, technologies: ['Rust', 'Cargo'] });
  if (fileName === 'go.mod') return target({ root, directory, kind: 'go', framework: 'Go modules', language: 'Go', confidence: 'strong', evidence, technologies: ['Go'] });
  if (fileName === 'pom.xml') return target({ root, directory, kind: 'jvm', framework: /spring-boot/i.test(content) ? 'Spring Boot' : 'Maven', language: /kotlin/i.test(content) ? 'Kotlin' : 'Java', confidence: 'strong', evidence, technologies: [/spring-boot/i.test(content) ? 'Spring Boot' : 'Maven'] });
  if (fileName === 'composer.json') return target({ root, directory, kind: 'php', framework: /laravel/i.test(content) ? 'Laravel' : /symfony/i.test(content) ? 'Symfony' : 'Composer', language: 'PHP', confidence: 'strong', evidence, technologies: ['PHP'] });
  if (fileName === 'Gemfile') return target({ root, directory, kind: 'ruby', framework: /rails/i.test(content) ? 'Rails' : 'Ruby', language: 'Ruby', confidence: 'strong', evidence, technologies: ['Ruby'] });
  if (fileName === 'Package.swift') return target({ root, directory, kind: 'swift', framework: 'Swift Package Manager', language: 'Swift', confidence: 'strong', evidence, technologies: ['Swift'] });
  if (fileName === 'CMakeLists.txt') return target({ root, directory, kind: 'native', framework: 'CMake', language: 'C/C++', confidence: 'strong', evidence, technologies: ['CMake', 'C/C++'] });
  if (fileName === 'mix.exs') return target({ root, directory, kind: 'elixir', framework: /phoenix/i.test(content) ? 'Phoenix' : 'Mix', language: 'Elixir', confidence: 'strong', evidence, technologies: ['Elixir'] });
  if (fileName === 'deno.json' || fileName === 'deno.jsonc') return target({ root, directory, kind: 'javascript', framework: 'Deno', language: 'TypeScript', confidence: 'strong', evidence, technologies: ['Deno', 'TypeScript'] });
  if (fileName === 'build.zig') return target({ root, directory, kind: 'native', framework: 'Zig build', language: 'Zig', confidence: 'strong', evidence, technologies: ['Zig'] });
  if (/\.csproj$/i.test(fileName)) return target({ root, directory, kind: 'dotnet', framework: /Microsoft\.NET\.Sdk\.Web/i.test(content) ? 'ASP.NET Core' : '.NET', language: 'C#', confidence: 'high', evidence, technologies: ['.NET', 'C#'] });
  if (/settings\.gradle(?:\.kts)?$/i.test(fileName)) {
    const android = fs.existsSync(path.join(directory, 'app', 'src', 'main', 'AndroidManifest.xml')) || /com\.android\./i.test(content);
    return target({ root, directory, kind: android ? 'android' : 'jvm', framework: android ? 'Android' : 'Gradle', language: /kotlin/i.test(content) || fileName.endsWith('.kts') ? 'Kotlin' : 'Java', confidence: android ? 'high' : 'strong', evidence, technologies: [android ? 'Android' : 'Gradle'] });
  }
  return null;
}

/*
 * La evidencia se guarda por directorio y despues se suma hacia arriba, asi un
 * target en `apps/web` ve lo suyo y la raiz ve todo, sin recorrer dos veces.
 */
function recordEvidence(evidence, relativeDirectory) {
  const current = evidence.get(relativeDirectory) || { languages: new Map(), databases: new Set(), markers: new Set(), entries: [] };
  evidence.set(relativeDirectory, current);
  return current;
}

function aggregateEvidence(evidence, relativePath) {
  const languages = new Map();
  const databases = new Set();
  const markers = new Set();
  const entries = [];
  for (const [directory, found] of evidence) {
    if (relativePath !== '.' && directory !== relativePath && !directory.startsWith(`${relativePath}/`)) continue;
    for (const [language, count] of found.languages) languages.set(language, (languages.get(language) || 0) + count);
    for (const database of found.databases) databases.add(database);
    for (const marker of found.markers) markers.add(marker);
    for (const entry of found.entries) entries.push(entry);
  }
  const ranked = [...languages.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    languages: ranked.map(([language]) => language),
    /* El lenguaje principal es el mas frecuente que no sea de acompañamiento: HTML y CSS no definen un stack por si solos. */
    primaryLanguage: ranked.find(([language]) => !SUPPORTING_LANGUAGES.has(language))?.[0] || ranked[0]?.[0] || null,
    databases: [...databases],
    markers,
    entries,
  };
}

function productRootOf(relativePath) {
  if (relativePath === '.') return '.';
  const segments = relativePath.split('/');
  if (segments.length > 1 && PRODUCT_CONTAINERS.has(segments[0].toLowerCase())) return segments.slice(0, 2).join('/');
  return segments[0];
}

/*
 * Un target puede correr en mas de una plataforma y el kind solo guarda una.
 * Electron es interfaz web dentro de una carcasa de escritorio, asi que declara
 * las dos; React Native comparte las dependencias de React pero no abre en un
 * navegador, asi que declara solo movil.
 */
function platformsOf(item) {
  if (item.role === 'package' || item.role === 'workspace-root') return ['library'];
  const base = PLATFORM_BY_KIND.get(item.kind) || 'code';
  const shells = unique(item.technologies.map((technology) => PLATFORM_BY_TECHNOLOGY.get(technology)));
  if (shells.includes('mobile')) return ['mobile'];
  const platforms = [];
  if (shells.includes('desktop')) platforms.push('desktop');
  if (item.fileSignals?.web) platforms.push('web');
  if (item.fileSignals?.backend) platforms.push('backend');
  /* `code` es lo que queda cuando no se sabe nada mejor: no vale la pena decirlo si los archivos ya dijeron algo. */
  if (!platforms.length || base !== 'code') platforms.push(base);
  return unique(platforms);
}

const KIND_BY_LANGUAGE = new Map([
  ['Python', 'python'], ['Go', 'go'], ['Rust', 'rust'], ['Ruby', 'ruby'], ['PHP', 'php'],
  ['Java', 'jvm'], ['Kotlin', 'jvm'], ['C#', 'dotnet'], ['Swift', 'swift'], ['Dart', 'dart'],
  ['Elixir', 'elixir'], ['C', 'native'], ['C++', 'native'],
]);

/*
 * Un proyecto puede no tener manifiesto y ser perfectamente real: una pagina con
 * index.html, un script de Python, un binario de Go. Antes esas carpetas salian
 * como "generic" y por lo tanto sin ninguna aplicacion.
 */
function synthesizeTarget(root, found) {
  if (!found.primaryLanguage && !found.markers.has('index.html')) return null;
  const web = found.markers.has('index.html');
  const kind = web ? 'web' : KIND_BY_LANGUAGE.get(found.primaryLanguage) || 'javascript';
  return target({
    root,
    directory: root,
    kind,
    name: path.basename(root),
    framework: null,
    language: found.primaryLanguage,
    confidence: 'low',
    evidence: [],
    technologies: found.languages,
    fileSignals: { web, backend: false },
  });
}

function enrichTarget(item, found, serverFindings) {
  const signals = serverFindings.get(item.relativePath) || { technologies: [], backend: false };
  item.language = item.language || found.primaryLanguage;
  item.fileSignals = {
    web: item.fileSignals.web || found.markers.has('index.html'),
    backend: item.fileSignals.backend || signals.backend,
  };
  item.technologies = unique([...item.technologies, ...signals.technologies, ...found.databases, ...found.languages]).slice(0, 16);
  return item;
}

/*
 * Abrir el entry point es lo unico que distingue "un archivo .js" de "un
 * servidor HTTP". Se lee un puñado, acotado por cantidad y por bytes, y solo se
 * buscan patrones: nunca se ejecuta nada.
 */
async function scanEntryFiles(targets, evidence, limits) {
  const findings = new Map();
  let read = 0;
  for (const item of targets) {
    const found = aggregateEvidence(evidence, item.relativePath);
    const technologies = [];
    let backend = false;
    for (const entry of found.entries) {
      if (read >= MAX_ENTRY_FILES) break;
      if (entry.size > limits.maxFileBytes) continue;
      let content;
      try { content = await fs.promises.readFile(entry.path, 'utf8'); } catch { continue; }
      read += 1;
      const scanned = content.slice(0, MAX_ENTRY_SCAN_BYTES);
      for (const [pattern, label] of SERVER_SIGNALS) {
        if (!pattern.test(scanned)) continue;
        technologies.push(label);
        backend = true;
      }
      if (NATIVE_PROCESS_SIGNAL.test(scanned)) technologies.push('Native processes');
    }
    if (technologies.length || backend) findings.set(item.relativePath, { technologies: unique(technologies), backend });
  }
  return findings;
}

function runnableFirst(a, b) {
  const runnable = (item) => Number(item.capabilities.webPreview || item.capabilities.androidPreview);
  return runnable(b) - runnable(a)
    || (CONFIDENCE_RANK[a.confidence] ?? 9) - (CONFIDENCE_RANK[b.confidence] ?? 9)
    || a.relativePath.localeCompare(b.relativePath);
}

function buildProducts(root, targets) {
  const groups = new Map();
  for (const item of targets) {
    if (item.kind === 'generic') continue;
    const relativePath = productRootOf(item.relativePath);
    const members = groups.get(relativePath) || [];
    members.push(item);
    groups.set(relativePath, members);
  }
  return [...groups.entries()].map(([relativePath, members]) => {
    const ordered = [...members].sort(runnableFirst);
    const anchor = ordered.find((item) => item.relativePath === relativePath);
    const platforms = PLATFORM_ORDER.filter((platform) => members.some((item) => platformsOf(item).includes(platform)));
    return {
      id: targetId('product', relativePath),
      name: String(anchor?.name || (relativePath === '.' ? path.basename(root) : path.posix.basename(relativePath))).slice(0, 100),
      relativePath,
      role: members.some((item) => item.role === 'application') ? 'application' : 'library',
      platforms,
      technologies: unique(members.flatMap((item) => [item.framework, ...item.technologies])).slice(0, 12),
      targetIds: ordered.map((item) => item.id),
      primaryTargetId: ordered[0].id,
      previewable: members.some((item) => item.capabilities.webPreview || item.capabilities.androidPreview),
    };
  }).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function analyzeWorkspace(projectPath, { onProgress = null, shouldAbort = null, ...customLimits } = {}) {
  const root = validateProjectCwd(projectPath);
  const limits = { ...DEFAULT_LIMITS, ...customLimits };
  const startedAt = Date.now();
  const queue = [{ directory: root, depth: 0 }];
  const targets = [];
  const warnings = [];
  const workspaceSignals = [];
  const packageManagers = new Set();
  const services = new Set();
  const scripts = [];
  const dependencies = [];
  const packageRecords = [];
  const workspaceDefinitions = [];
  const runtimes = [];
  const lockfiles = [];
  const environmentNames = new Map();
  const evidence = new Map();
  const gitRoots = [];
  const fingerprintEntries = [];
  let environmentFilesRead = 0;
  let entriesVisited = 0;
  let filesRead = 0;
  let bytesRead = 0;
  let complete = true;
  const markScanLimit = () => {
    complete = false;
    if (!warnings.some((warning) => warning.code === 'SCAN_LIMIT')) warnings.push({ code: 'SCAN_LIMIT', message: 'Analysis reached its safety limit and returned partial results.' });
  };
  const limitReached = () => Date.now() - startedAt > limits.timeoutMs || entriesVisited >= limits.maxEntries || filesRead >= limits.maxFiles || bytesRead >= limits.maxBytes;

  /*
   * Esperar sin saber que pasa se siente mas largo que esperar viendo avanzar.
   * El progreso sale cada 120 ms y ademas cada vez que aparece una aplicacion,
   * que es el unico evento que le importa a quien mira.
   */
  const foundNames = [];
  let lastProgressAt = 0;
  const emitProgress = (phase, directory, force = false) => {
    if (typeof onProgress !== 'function') return;
    const at = Date.now();
    if (!force && at - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = at;
    onProgress({
      phase,
      directory: directory === null ? null : toRelative(root, directory),
      entriesVisited,
      filesRead,
      found: foundNames.slice(-12),
      foundCount: foundNames.length,
      elapsedMs: at - startedAt,
    });
  };
  const recordFound = (detected, directory) => {
    foundNames.push(detected.name);
    emitProgress('scanning', directory, true);
  };
  const abortIfCancelled = () => {
    if (typeof shouldAbort !== 'function' || !shouldAbort()) return;
    const error = new Error('The workspace analysis was cancelled.');
    error.code = 'ANALYSIS_CANCELLED';
    throw error;
  };

  emitProgress('scanning', root, true);
  while (queue.length) {
    abortIfCancelled();
    if (limitReached()) { markScanLimit(); break; }
    const { directory, depth } = queue.shift();
    emitProgress('scanning', directory);
    const entries = [];
    let truncatedDirectory = false;
    try {
      const handle = await fs.promises.opendir(directory);
      for await (const entry of handle) {
        if (entries.length >= limits.maxEntries - entriesVisited) { truncatedDirectory = true; break; }
        entries.push(entry);
      }
    }
    catch { warnings.push({ code: 'ACCESS_DENIED', path: toRelative(root, directory), message: 'A directory could not be inspected.' }); continue; }
    if (truncatedDirectory) { markScanLimit(); queue.length = 0; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const names = new Set(entries.map((entry) => entry.name));
    for (const [fileName, manager] of Object.entries(LOCKFILES)) {
      if (!names.has(fileName)) continue;
      packageManagers.add(manager);
      lockfiles.push({ manager, path: toRelative(root, path.join(directory, fileName)) });
    }
    if (names.has('turbo.json')) workspaceSignals.push('Turborepo');
    if (names.has('nx.json')) workspaceSignals.push('Nx');
    if (names.has('lerna.json')) workspaceSignals.push('Lerna');
    if (names.has('firebase.json')) services.add('Firebase');
    if (names.has('vercel.json') || names.has('.vercel')) services.add('Vercel');
    if (names.has('Dockerfile') || names.has('compose.yaml') || names.has('docker-compose.yml')) services.add('Docker');
    if (names.has('supabase')) services.add('Supabase');
    if (names.has('prisma')) services.add('Prisma');
    if (names.has('.git')) gitRoots.push(toRelative(root, directory));

    for (const entry of entries) {
      if (limitReached()) { markScanLimit(); queue.length = 0; break; }
      entriesVisited += 1;
      if (entriesVisited % 512 === 0) abortIfCancelled();
      const absolute = path.join(directory, entry.name);
      if (!isSubPath(root, absolute)) continue;
      let stats;
      try { stats = await fs.promises.lstat(absolute); } catch { continue; }
      if (stats.isSymbolicLink()) { warnings.push({ code: 'LINK_SKIPPED', path: toRelative(root, absolute), message: 'A linked path was skipped.' }); continue; }
      if (STRUCTURAL_MARKERS.has(entry.name) || Object.hasOwn(LOCKFILES, entry.name)) {
        fingerprintEntries.push(`${toRelative(root, absolute)}:${stats.isDirectory() ? 'directory' : stats.size}:${Math.trunc(stats.mtimeMs)}`);
      }
      if (stats.isDirectory()) {
        const directoryDatabase = DATABASE_BY_MARKER.get(entry.name);
        if (directoryDatabase) recordEvidence(evidence, toRelative(root, directory)).databases.add(directoryDatabase);
        if (/\.xcodeproj$/i.test(entry.name)) {
          const detected = target({ root, directory, kind: 'apple', framework: 'Xcode', language: 'Swift / Objective-C', confidence: 'strong', evidence: [toRelative(root, absolute)], technologies: ['Xcode', 'Apple platforms'] });
          targets.push(detected);
          recordFound(detected, directory);
        }
        if (depth < limits.maxDepth && !IGNORED_DIRECTORIES.has(entry.name)) queue.push({ directory: absolute, depth: depth + 1 });
        continue;
      }
      const relativeFile = toRelative(root, absolute);
      /* Evidencia de archivo: se toma de las entradas que el recorrido ya visita, sin abrir nada todavia. */
      const extension = path.extname(entry.name).toLowerCase();
      const language = LANGUAGE_BY_EXTENSION.get(extension);
      const database = DATABASE_BY_EXTENSION.get(extension) || DATABASE_BY_MARKER.get(entry.name);
      const evidenceDirectory = toRelative(root, directory);
      if (!isHelperDirectory(evidenceDirectory) && (language || database || ENTRY_FILE_NAMES.includes(entry.name) || entry.name === 'index.html')) {
        const found = recordEvidence(evidence, evidenceDirectory);
        if (language) found.languages.set(language, (found.languages.get(language) || 0) + 1);
        if (database) found.databases.add(database);
        if (entry.name === 'index.html') found.markers.add('index.html');
        if (ENTRY_FILE_NAMES.includes(entry.name)) found.entries.push({ path: absolute, relativePath: relativeFile, size: stats.size });
      }
      const candidate = EXACT_MANIFESTS.has(entry.name) || /\.(?:csproj|sln)$/i.test(entry.name);
      const environmentKind = ENV_FILE.test(entry.name)
        ? (/\.(?:example|sample|template)$/i.test(entry.name) ? 'example' : 'local-env')
        : (ENV_REFERENCE_FILE.test(entry.name) ? 'code-reference' : null);
      const inspectEnvironment = environmentKind && environmentFilesRead < 64 && stats.size <= Math.min(limits.maxFileBytes, 128 * 1024);
      if (!candidate && !inspectEnvironment) continue;
      if (stats.size > limits.maxFileBytes) continue;
      if (filesRead >= limits.maxFiles || bytesRead + stats.size > limits.maxBytes) { markScanLimit(); queue.length = 0; break; }
      if (inspectEnvironment && environmentKind !== 'code-reference' && !candidate) {
        try { await inspectEnvironmentFile(environmentNames, absolute, relativeFile, environmentKind); } catch { continue; }
        filesRead += 1;
        environmentFilesRead += 1;
        bytesRead += stats.size;
        fingerprintEntries.push(`${relativeFile}:${stats.size}:${Math.trunc(stats.mtimeMs)}`);
        continue;
      }
      let content;
      try { content = await fs.promises.readFile(absolute, 'utf8'); } catch { continue; }
      filesRead += 1;
      bytesRead += Buffer.byteLength(content);
      fingerprintEntries.push(`${relativeFile}:${stats.size}:${Math.trunc(stats.mtimeMs)}`);
      if (inspectEnvironment) {
        environmentFilesRead += 1;
        inspectEnvironmentContent(environmentNames, content, relativeFile, environmentKind);
      }
      if (!candidate) continue;
      fingerprintEntries.push(`${relativeFile}:sha256:${crypto.createHash('sha256').update(content).digest('hex')}`);
      if (entry.name === 'package.json') {
        try {
          const parsed = JSON.parse(content);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
          const detectedTarget = packageTarget(root, directory, parsed, relativeFile);
          const packageManagerDeclaration = typeof parsed.packageManager === 'string' ? parsed.packageManager : null;
           if (packageManagerDeclaration) {
            const [manager, version] = packageManagerDeclaration.split('@');
            if (PACKAGE_MANAGERS.has(manager)) {
              packageManagers.add(manager);
              runtimes.push({ id: `package-manager:${detectedTarget.id}`, targetId: detectedTarget.id, runtime: manager, declaredRange: /^\d[0-9A-Za-z.+-]{0,39}$/.test(version || '') ? version : null, source: relativeFile, requiredFor: ['dependencies'] });
           }
          const declaredWorkspacePatterns = normalizeWorkspacePatterns(parsed.workspaces);
          if (declaredWorkspacePatterns.length) {
            workspaceSignals.push('JavaScript workspace');
            workspaceDefinitions.push({ rootPath: toRelative(root, directory), patterns: declaredWorkspacePatterns, managerHint: null, source: relativeFile });
          }
          }
          if (typeof parsed.engines?.node === 'string') runtimes.push({ id: `node:${detectedTarget.id}`, targetId: detectedTarget.id, runtime: 'node', declaredRange: parsed.engines.node.slice(0, 80), source: relativeFile, requiredFor: ['dependencies', 'preview', 'build'] });
          if (parsed.workspaces) workspaceSignals.push('JavaScript workspace');
          targets.push(detectedTarget);
          recordFound(detectedTarget, directory);
          const previewProfile = classifyWebScript(parsed);
          for (const name of Object.keys(parsed.scripts || {}).filter((name) => SCRIPT_NAME.test(name)).sort().slice(0, 80)) {
            scripts.push({ targetId: detectedTarget.id, ecosystem: 'npm', name: name.slice(0, 80), category: scriptCategory(name), executableByIde: name === 'dev' && Boolean(previewProfile), managedPreviewProfile: name === 'dev' ? previewProfile : null });
          }
          const groups = [
            ['runtime', parsed.dependencies], ['development', parsed.devDependencies], ['peer', parsed.peerDependencies], ['optional', parsed.optionalDependencies],
          ].map(([name, values]) => {
            const packageNames = Object.keys(values || {}).filter((packageName) => PACKAGE_NAME.test(packageName)).sort();
            return { name, packageNames: packageNames.slice(0, 100), count: packageNames.length };
          }).filter((group) => group.count);
          packageRecords.push({
            targetId: detectedTarget.id,
            directory,
            relativePath: toRelative(root, directory),
            ecosystem: 'npm',
            groups,
            requiredPackageNames: unique([
              ...Object.keys(parsed.dependencies || {}),
              ...Object.keys(parsed.devDependencies || {}),
            ].filter((packageName) => PACKAGE_NAME.test(packageName))),
            manager: PACKAGE_MANAGERS.has(packageManagerDeclaration?.split('@')[0]) ? packageManagerDeclaration.split('@')[0] : null,
            managerVersion: PACKAGE_MANAGERS.has(packageManagerDeclaration?.split('@')[0]) ? packageManagerDeclaration.split('@')[1]?.slice(0, 40) || null : null,
          });
        } catch { warnings.push({ code: 'MALFORMED_MANIFEST', path: toRelative(root, absolute), message: 'A package.json file is malformed.' }); }
      } else if (entry.name === 'pnpm-workspace.yaml') {
        const patterns = parsePnpmWorkspacePatterns(content);
        if (patterns.length) {
          packageManagers.add('pnpm');
          workspaceSignals.push('pnpm workspace');
          workspaceDefinitions.push({ rootPath: toRelative(root, directory), patterns, managerHint: 'pnpm', source: relativeFile });
        }
      } else {
        const detected = textTarget(root, directory, entry.name, content);
        if (detected) {
          targets.push(detected);
          recordFound(detected, directory);
          if (entry.name === 'pubspec.yaml') {
            const declaredRange = content.match(/^\s*sdk\s*:\s*['"]?([^'"\r\n#]+)/m)?.[1]?.trim().slice(0, 80) || null;
            runtimes.push({ id: `dart:${detected.id}`, targetId: detected.id, runtime: detected.kind === 'flutter' ? 'flutter' : 'dart', declaredRange, source: relativeFile, requiredFor: ['dependencies', 'preview', 'build'] });
          }
        }
      }
    }
  }

  emitProgress('summarizing', null, true);
  /* Sin ningun manifiesto todavia puede haber un proyecto real: lo dicen los archivos. */
  if (!targets.length) {
    const synthesized = synthesizeTarget(root, aggregateEvidence(evidence, '.'));
    if (synthesized) targets.push(synthesized);
  }
  const deduplicated = [...new Map(targets.map((item) => [`${item.kind}:${item.relativePath}`, item])).values()]
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath) || a.kind.localeCompare(b.kind));
  const serverFindings = await scanEntryFiles(deduplicated, evidence, limits);
  for (const item of deduplicated) enrichTarget(item, aggregateEvidence(evidence, item.relativePath), serverFindings);
  for (const item of deduplicated) {
    for (const technology of item.technologies) if (['Supabase', 'Firebase', 'Prisma'].includes(technology)) services.add(technology);
  }
  if (!deduplicated.length) deduplicated.push(target({ root, directory: root, kind: 'generic', role: 'workspace-root', name: path.basename(root), framework: 'Generic workspace', confidence: 'low', evidence: [], technologies: [] }));
  const supported = deduplicated.filter((item) => item.capabilities.webPreview || item.capabilities.androidPreview);
  const recommended = supported.find((item) => item.relativePath === 'web') || supported.find((item) => item.relativePath === '.') || supported[0] || deduplicated[0];
  const layout = deduplicated.length > 1 || workspaceSignals.length ? 'workspace' : deduplicated[0].kind === 'generic' ? 'unknown' : 'single';
  /* Los productos son una lectura de `deduplicated`, no una entrada nueva: quedan fuera del fingerprint para no invalidar los workspaces ya guardados. */
  const products = buildProducts(root, deduplicated);
  const git = {
    detected: gitRoots.length > 0,
    repositoryKind: gitRoots.length ? 'normal' : 'none',
    roots: unique(gitRoots).sort(),
    branch: null,
    dirty: null,
    remote: { present: null, provider: null },
  };
  const packageManagerList = unique([...packageManagers]).sort();
  const workspaceSignalList = unique(workspaceSignals);
  const serviceList = unique([...services]).sort();
  const integrations = serviceList.map((name) => ({ id: name.toLowerCase(), name, detected: true, state: 'marker-found' }));
  const roots = deduplicated.map((item) => ({ id: `root-${item.id}`, targetId: item.id, relativePath: item.relativePath, type: item.role, name: item.name, manifestPaths: item.evidence.filter((value) => !value.includes(':')) }));
  const sortedScripts = scripts.sort((a, b) => a.targetId.localeCompare(b.targetId) || a.name.localeCompare(b.name));
  const sortedRuntimes = runtimes.sort((a, b) => a.id.localeCompare(b.id));
  const sortedLockfiles = lockfiles.sort((a, b) => a.path.localeCompare(b.path));
  const mergedDefinitions = [...workspaceDefinitions.reduce((definitions, definition) => {
    const current = definitions.get(definition.rootPath) || { rootPath: definition.rootPath, patterns: [], managerHint: null, sources: [] };
    current.patterns = unique([...current.patterns, ...definition.patterns]);
    current.managerHint = definition.managerHint || current.managerHint;
    current.sources.push(definition.source);
    definitions.set(definition.rootPath, current);
    return definitions;
  }, new Map()).values()];
  const recordsByPath = new Map(packageRecords.map((record) => [record.relativePath, record]));
  for (const record of packageRecords) {
    const matchingDefinitions = mergedDefinitions.filter((definition) => workspaceDefinitionMatches(definition, record.relativePath))
      .sort((left, right) => right.rootPath.split('/').length - left.rootPath.split('/').length);
    const ownDefinition = mergedDefinitions.find((definition) => definition.rootPath === record.relativePath);
    const owner = matchingDefinitions[0] || ownDefinition || null;
    const scopePath = owner?.rootPath || record.relativePath;
    const scopeRecord = recordsByPath.get(scopePath);
    const scopeLockfiles = sortedLockfiles.filter((item) => path.posix.dirname(item.path) === scopePath);
    const lockManagers = unique(scopeLockfiles.map((item) => item.manager));
    const declaredManager = owner?.managerHint || scopeRecord?.manager || null;
    const manager = declaredManager || (lockManagers.length === 1 ? lockManagers[0] : null);
    if (declaredManager && lockManagers.length && !lockManagers.includes(declaredManager)) warnings.push({ code: 'PACKAGE_MANAGER_CONFLICT', path: scopePath, message: 'Package manager declarations and lockfiles conflict.' });
    const lockfile = manager ? scopeLockfiles.find((item) => item.manager === manager)?.path || null : null;
    /* Una sola resolucion por paquete: antes se recorria el arbol de node_modules dos veces por manifiesto, y con el tope de archivos ya subido eso se nota. */
    const resolutions = record.requiredPackageNames.map((packageName) => resolvedDependencyRoot(root, record.directory, packageName));
    const resolvedNodeModules = unique(resolutions);
    dependencies.push({
      targetId: record.targetId,
      ecosystem: record.ecosystem,
      groups: record.groups,
      lockfiles: scopeLockfiles.map((item) => item.path),
      installScope: {
        relativePath: scopePath,
        workspaceRoot: owner?.rootPath || null,
        isWorkspaceMember: Boolean(owner && owner.rootPath !== record.relativePath),
        manager,
        managerVersion: scopeRecord?.managerVersion || null,
        lockfile,
      },
      resolvedNodeModules,
      installState: !record.requiredPackageNames.length ? 'not-required' : resolutions.every(Boolean) ? 'appears-installed' : 'install-needed',
    });
  }
  const environment = publicEnvironment(environmentNames);
  const projectAssessment = assessProject({ targets: deduplicated, workspaceSignals: workspaceSignalList, packageManagers: packageManagerList, git, warnings });
  const readiness = buildReadiness({ assessment: projectAssessment, targets: deduplicated, dependencies, environment, warnings, complete });
  const decisionProfile = {
    layout, complete, packageManagers: packageManagerList, packageManagerDetails: sortedLockfiles, workspaceSignals: workspaceSignalList,
    services: serviceList, integrations, targets: deduplicated, roots, scripts: sortedScripts, dependencies, environment, git, runtimes: sortedRuntimes,
    workspaceDefinitions: mergedDefinitions, warnings: warnings.map(({ code, path: warningPath }) => ({ code, path: warningPath || null })), evidence: fingerprintEntries.sort(),
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(decisionProfile)).digest('hex');
  return {
    schemaVersion: SCHEMA_VERSION,
    analyzedAt: Date.now(),
    name: path.basename(root),
    layout,
    complete,
    fingerprint,
    projectAssessment,
    readiness,
    packageManagers: packageManagerList,
    packageManagerDetails: sortedLockfiles,
    workspaceSignals: workspaceSignalList,
    services: serviceList,
    integrations,
    targets: deduplicated,
    products,
    roots,
    scripts: sortedScripts,
    dependencies,
    environment,
    git,
    runtimes: sortedRuntimes,
    recommendedTargetId: recommended.id,
    warnings,
    stats: { entriesVisited, filesRead, bytesRead, durationMs: Date.now() - startedAt },
  };
}

module.exports = { DEFAULT_LIMITS, IGNORED_DIRECTORIES, SCHEMA_VERSION, analyzeWorkspace };
