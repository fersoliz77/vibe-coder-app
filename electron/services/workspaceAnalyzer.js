const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateProjectCwd, isSubPath } = require('../ipc/fsGuards');
const { classifyWebScript } = require('./previewCommands');

const SCHEMA_VERSION = 3;
const DEFAULT_LIMITS = Object.freeze({ maxDepth: 6, maxEntries: 5000, maxFiles: 256, maxBytes: 4 * 1024 * 1024, maxFileBytes: 256 * 1024, timeoutMs: 2500 });
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

function target({ root, directory, kind, role = 'application', name, framework, language, confidence, evidence, technologies = [], capabilities = {}, previewProfile = null }) {
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
  };
}

function packageTarget(root, directory, parsed, relativeManifest) {
  const dependencies = { ...parsed.dependencies, ...parsed.devDependencies, ...parsed.peerDependencies, ...parsed.optionalDependencies };
  const technologies = [];
  let framework = null;
  let kind = 'javascript';
  let role = parsed.private === true && !parsed.scripts?.dev ? 'package' : 'application';
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

async function analyzeWorkspace(projectPath, customLimits = {}) {
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

  while (queue.length) {
    if (limitReached()) { markScanLimit(); break; }
    const { directory, depth } = queue.shift();
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
      const absolute = path.join(directory, entry.name);
      if (!isSubPath(root, absolute)) continue;
      let stats;
      try { stats = await fs.promises.lstat(absolute); } catch { continue; }
      if (stats.isSymbolicLink()) { warnings.push({ code: 'LINK_SKIPPED', path: toRelative(root, absolute), message: 'A linked path was skipped.' }); continue; }
      if (STRUCTURAL_MARKERS.has(entry.name) || Object.hasOwn(LOCKFILES, entry.name)) {
        fingerprintEntries.push(`${toRelative(root, absolute)}:${stats.isDirectory() ? 'directory' : stats.size}:${Math.trunc(stats.mtimeMs)}`);
      }
      if (stats.isDirectory()) {
        if (/\.xcodeproj$/i.test(entry.name)) targets.push(target({ root, directory, kind: 'apple', framework: 'Xcode', language: 'Swift / Objective-C', confidence: 'strong', evidence: [toRelative(root, absolute)], technologies: ['Xcode', 'Apple platforms'] }));
        if (depth < limits.maxDepth && !IGNORED_DIRECTORIES.has(entry.name)) queue.push({ directory: absolute, depth: depth + 1 });
        continue;
      }
      const relativeFile = toRelative(root, absolute);
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
          if (entry.name === 'pubspec.yaml') {
            const declaredRange = content.match(/^\s*sdk\s*:\s*['"]?([^'"\r\n#]+)/m)?.[1]?.trim().slice(0, 80) || null;
            runtimes.push({ id: `dart:${detected.id}`, targetId: detected.id, runtime: detected.kind === 'flutter' ? 'flutter' : 'dart', declaredRange, source: relativeFile, requiredFor: ['dependencies', 'preview', 'build'] });
          }
        }
      }
    }
  }

  const deduplicated = [...new Map(targets.map((item) => [`${item.kind}:${item.relativePath}`, item])).values()]
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath) || a.kind.localeCompare(b.kind));
  for (const item of deduplicated) {
    for (const technology of item.technologies) if (['Supabase', 'Firebase', 'Prisma'].includes(technology)) services.add(technology);
  }
  if (!deduplicated.length) deduplicated.push(target({ root, directory: root, kind: 'generic', role: 'workspace-root', name: path.basename(root), framework: 'Generic workspace', confidence: 'low', evidence: [], technologies: [] }));
  const supported = deduplicated.filter((item) => item.capabilities.webPreview || item.capabilities.androidPreview);
  const recommended = supported.find((item) => item.relativePath === 'web') || supported.find((item) => item.relativePath === '.') || supported[0] || deduplicated[0];
  const layout = deduplicated.length > 1 || workspaceSignals.length ? 'workspace' : deduplicated[0].kind === 'generic' ? 'unknown' : 'single';
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
    const resolvedNodeModules = unique(record.requiredPackageNames.map((packageName) => resolvedDependencyRoot(root, record.directory, packageName)));
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
      installState: !record.requiredPackageNames.length ? 'not-required' : record.requiredPackageNames.every((packageName) => resolvedDependencyRoot(root, record.directory, packageName)) ? 'appears-installed' : 'install-needed',
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
