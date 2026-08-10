const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateProjectCwd, isSubPath } = require('../ipc/fsGuards');
const { classifyWebScript } = require('./previewCommands');

const SCHEMA_VERSION = 1;
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
  'CMakeLists.txt', 'mix.exs', 'deno.json', 'deno.jsonc', 'build.zig',
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

const toRelative = (root, target) => path.relative(root, target).split(path.sep).join('/') || '.';
const targetId = (kind, relativePath) => `${kind}-${crypto.createHash('sha1').update(`${kind}:${relativePath}`).digest('hex').slice(0, 10)}`;
const unique = (values) => [...new Set(values.filter(Boolean))];

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
  let entriesVisited = 0;
  let filesRead = 0;
  let bytesRead = 0;
  let complete = true;

  while (queue.length) {
    if (Date.now() - startedAt > limits.timeoutMs || entriesVisited >= limits.maxEntries || filesRead >= limits.maxFiles || bytesRead >= limits.maxBytes) {
      complete = false;
      warnings.push({ code: 'SCAN_LIMIT', message: 'Analysis reached its safety limit and returned partial results.' });
      break;
    }
    const { directory, depth } = queue.shift();
    let entries;
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch { warnings.push({ code: 'ACCESS_DENIED', path: toRelative(root, directory), message: 'A directory could not be inspected.' }); continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const names = new Set(entries.map((entry) => entry.name));
    if (names.has('pnpm-lock.yaml')) packageManagers.add('pnpm');
    if (names.has('yarn.lock')) packageManagers.add('yarn');
    if (names.has('bun.lock') || names.has('bun.lockb')) packageManagers.add('bun');
    if (names.has('package-lock.json')) packageManagers.add('npm');
    if (names.has('pnpm-workspace.yaml')) workspaceSignals.push('pnpm workspace');
    if (names.has('turbo.json')) workspaceSignals.push('Turborepo');
    if (names.has('nx.json')) workspaceSignals.push('Nx');
    if (names.has('lerna.json')) workspaceSignals.push('Lerna');
    if (names.has('firebase.json')) services.add('Firebase');
    if (names.has('vercel.json') || names.has('.vercel')) services.add('Vercel');
    if (names.has('Dockerfile') || names.has('compose.yaml') || names.has('docker-compose.yml')) services.add('Docker');
    if (names.has('supabase')) services.add('Supabase');
    if (names.has('prisma')) services.add('Prisma');

    for (const entry of entries) {
      entriesVisited += 1;
      const absolute = path.join(directory, entry.name);
      if (!isSubPath(root, absolute)) continue;
      let stats;
      try { stats = await fs.promises.lstat(absolute); } catch { continue; }
      if (stats.isSymbolicLink()) { warnings.push({ code: 'LINK_SKIPPED', path: toRelative(root, absolute), message: 'A linked path was skipped.' }); continue; }
      if (stats.isDirectory()) {
        if (/\.xcodeproj$/i.test(entry.name)) targets.push(target({ root, directory, kind: 'apple', framework: 'Xcode', language: 'Swift / Objective-C', confidence: 'strong', evidence: [toRelative(root, absolute)], technologies: ['Xcode', 'Apple platforms'] }));
        if (depth < limits.maxDepth && !IGNORED_DIRECTORIES.has(entry.name)) queue.push({ directory: absolute, depth: depth + 1 });
        continue;
      }
      const candidate = EXACT_MANIFESTS.has(entry.name) || /\.(?:csproj|sln)$/i.test(entry.name);
      if (!candidate || stats.size > limits.maxFileBytes || filesRead >= limits.maxFiles || bytesRead + stats.size > limits.maxBytes) continue;
      let content;
      try { content = await fs.promises.readFile(absolute, 'utf8'); } catch { continue; }
      filesRead += 1;
      bytesRead += Buffer.byteLength(content);
      if (entry.name === 'package.json') {
        try {
          const parsed = JSON.parse(content);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
          if (parsed.packageManager) packageManagers.add(String(parsed.packageManager).split('@')[0]);
          if (parsed.workspaces) workspaceSignals.push('JavaScript workspace');
          targets.push(packageTarget(root, directory, parsed, toRelative(root, absolute)));
        } catch { warnings.push({ code: 'MALFORMED_MANIFEST', path: toRelative(root, absolute), message: 'A package.json file is malformed.' }); }
      } else {
        const detected = textTarget(root, directory, entry.name, content);
        if (detected) targets.push(detected);
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
  return {
    schemaVersion: SCHEMA_VERSION,
    analyzedAt: Date.now(),
    name: path.basename(root),
    layout,
    complete,
    packageManagers: unique([...packageManagers]),
    workspaceSignals: unique(workspaceSignals),
    services: unique([...services]),
    targets: deduplicated,
    recommendedTargetId: recommended.id,
    warnings,
    stats: { entriesVisited, filesRead, bytesRead, durationMs: Date.now() - startedAt },
  };
}

module.exports = { DEFAULT_LIMITS, IGNORED_DIRECTORIES, SCHEMA_VERSION, analyzeWorkspace };
