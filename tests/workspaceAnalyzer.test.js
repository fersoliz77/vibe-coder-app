const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { analyzeWorkspace } = require('../electron/services/workspaceAnalyzer');

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-workspace-'));
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test('detects multiple web and Flutter applications without executing project code', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ private: true, workspaces: ['apps/*'], packageManager: 'pnpm@9.0.0' }));
    write(root, 'turbo.json', '{}');
    write(root, 'apps/admin/package.json', JSON.stringify({ name: 'admin', scripts: { dev: 'next dev' }, dependencies: { next: '15.0.0', react: '19.0.0' }, devDependencies: { typescript: '5.0.0' } }));
    write(root, 'apps/store/package.json', JSON.stringify({ name: 'store', scripts: { dev: 'vite' }, dependencies: { react: '19.0.0' }, devDependencies: { vite: '6.0.0' } }));
    write(root, 'apps/mobile/pubspec.yaml', 'name: mobile\ndependencies:\n  flutter:\n    sdk: flutter\n');
    write(root, 'apps/mobile/android/.keep', '');
    const result = await analyzeWorkspace(root);
    assert.equal(result.layout, 'workspace');
    assert.equal(result.targets.length, 4);
    assert.equal(result.targets.find((target) => target.name === 'admin').framework, 'Next.js');
    assert.equal(result.targets.find((target) => target.name === 'store').capabilities.webPreview, true);
    assert.equal(result.targets.find((target) => target.name === 'mobile').capabilities.androidPreview, true);
    assert.deepEqual(result.packageManagers, ['pnpm']);
    assert.ok(result.workspaceSignals.includes('Turborepo'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('groups monorepo manifests into one product per application', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ private: true, workspaces: ['apps/*'] }));
    write(root, 'apps/admin/package.json', JSON.stringify({ name: 'admin', scripts: { dev: 'next dev' }, dependencies: { next: '15.0.0', react: '19.0.0' } }));
    write(root, 'apps/mobile/pubspec.yaml', 'name: mobile\ndependencies:\n  flutter:\n    sdk: flutter\n');
    const result = await analyzeWorkspace(root);
    const applications = result.products.filter((product) => product.role === 'application');
    assert.deepEqual(applications.map((product) => product.relativePath), ['apps/admin', 'apps/mobile']);
    assert.deepEqual(applications.find((product) => product.name === 'admin').platforms, ['web']);
    assert.deepEqual(applications.find((product) => product.name === 'mobile').platforms, ['mobile']);
    /* La raiz privada sin script de desarrollo es andamiaje del workspace, no un producto. */
    assert.deepEqual(result.products.filter((product) => product.role === 'library').map((product) => product.relativePath), ['.']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('one product folder holding a web app and a Flutter app reports both platforms', async () => {
  const root = fixture();
  try {
    write(root, 'mi-app/web/package.json', JSON.stringify({ name: 'mi-app-web', scripts: { dev: 'vite' }, dependencies: { react: '19.0.0' }, devDependencies: { vite: '6.0.0' } }));
    write(root, 'mi-app/movil/pubspec.yaml', 'name: mi_app_movil\ndependencies:\n  flutter:\n    sdk: flutter\n');
    const result = await analyzeWorkspace(root);
    assert.equal(result.products.length, 1);
    const [product] = result.products;
    assert.equal(product.name, 'mi-app');
    assert.equal(product.relativePath, 'mi-app');
    assert.deepEqual(product.platforms, ['web', 'mobile']);
    assert.equal(product.targetIds.length, 2);
    assert.equal(product.previewable, true);
    assert.ok(product.technologies.includes('Flutter'));
    assert.ok(product.technologies.includes('React'));
    /* El target primario del producto es el que se puede previsualizar. */
    assert.equal(result.targets.find((target) => target.id === product.primaryTargetId).capabilities.webPreview, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a folder without application manifests reports no products', async () => {
  const root = fixture();
  try {
    write(root, 'README.md', '# Solo notas');
    write(root, 'docs/guia.md', '# Guia');
    const result = await analyzeWorkspace(root);
    assert.deepEqual(result.products, []);
    assert.equal(result.targets[0].kind, 'generic');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a single application at the root is one product named after its manifest', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ name: 'tienda', scripts: { dev: 'vite' }, dependencies: { react: '19.0.0', electron: '43.0.0' }, devDependencies: { vite: '6.0.0' } }));
    const result = await analyzeWorkspace(root);
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0].name, 'tienda');
    assert.equal(result.products[0].relativePath, '.');
    assert.equal(result.products[0].role, 'application');
    /* Electron es una carcasa de escritorio sobre una interfaz web: son las dos plataformas, no una. */
    assert.deepEqual(result.products[0].platforms, ['web', 'desktop']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a React Native app is mobile even though it depends on React', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ name: 'movil', scripts: { start: 'expo start' }, dependencies: { react: '19.0.0', 'react-native': '0.76.0', expo: '52.0.0' } }));
    const result = await analyzeWorkspace(root);
    assert.deepEqual(result.products[0].platforms, ['mobile']);
    assert.ok(result.products[0].technologies.includes('React Native'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reports progress while scanning and names each application as it appears', async () => {
  const root = fixture();
  try {
    write(root, 'apps/admin/package.json', JSON.stringify({ name: 'admin', scripts: { dev: 'vite' }, dependencies: { react: '19.0.0' } }));
    write(root, 'apps/mobile/pubspec.yaml', 'name: mobile\ndependencies:\n  flutter:\n    sdk: flutter\n');
    const events = [];
    const result = await analyzeWorkspace(root, { onProgress: (event) => events.push(event) });
    assert.ok(events.length >= 3);
    assert.ok(events.every((event) => ['scanning', 'summarizing'].includes(event.phase)));
    assert.equal(events.at(-1).phase, 'summarizing');
    /* Cada aplicacion detectada fuerza un evento, sin esperar al proximo intervalo. */
    assert.deepEqual(events.at(-1).found, ['admin', 'mobile']);
    assert.equal(events.at(-1).foundCount, 2);
    assert.ok(events.every((event) => event.directory === null || !path.isAbsolute(event.directory)));
    assert.ok(events.at(-1).entriesVisited > 0 && events.at(-1).entriesVisited <= result.stats.entriesVisited);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a cancelled analysis stops the scan instead of finishing it in the background', async () => {
  const root = fixture();
  try {
    for (let index = 0; index < 40; index += 1) write(root, `apps/app-${index}/package.json`, JSON.stringify({ name: `app-${index}` }));
    let scanned = 0;
    await assert.rejects(
      analyzeWorkspace(root, { onProgress: () => { scanned += 1; }, shouldAbort: () => scanned >= 1 }),
      (error) => error.code === 'ANALYSIS_CANCELLED',
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a normal folder is analyzed completely instead of being cut short by a latency budget', async () => {
  const root = fixture();
  try {
    for (let index = 0; index < 60; index += 1) {
      write(root, `apps/app-${index}/package.json`, JSON.stringify({ name: `app-${index}`, dependencies: { react: '19.0.0' } }));
      write(root, `apps/app-${index}/src/config.js`, 'export const url = import.meta.env.VITE_URL;');
    }
    const result = await analyzeWorkspace(root);
    assert.equal(result.complete, true);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.products.filter((product) => product.role === 'application').length, 60);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

/*
 * `private: true` significa "no publicar en npm", que es lo que declara una
 * aplicacion. La regla estaba al reves y clasificaba como libreria a cualquier
 * app que arrancara con `npm start`, dejando la carpeta sin ninguna aplicacion.
 */
test('a private package that starts with npm start is an application, not a library', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ name: 'facturador', private: true, scripts: { start: 'node server.mjs' }, engines: { node: '>=18' } }));
    write(root, 'server.mjs', 'import { createServer } from "node:http";\nimport { spawn } from "node:child_process";\ncreateServer(() => {}).listen(4174);\n');
    write(root, 'index.html', '<!doctype html><script type="module" src="app.js"></script>');
    write(root, 'app.js', 'export const start = () => {};');
    const result = await analyzeWorkspace(root);
    const [product] = result.products;
    assert.equal(product.role, 'application');
    /* Sin una sola dependencia declarada: el stack sale de los archivos. */
    assert.deepEqual(product.platforms, ['web', 'backend']);
    assert.ok(product.technologies.includes('HTTP server'));
    assert.ok(product.technologies.includes('Native processes'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a publishable package with no run script is still a library', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ name: 'utils', main: 'index.js', types: 'index.d.ts' }));
    write(root, 'index.js', 'module.exports = {};');
    const result = await analyzeWorkspace(root);
    assert.equal(result.products[0].role, 'library');
    assert.deepEqual(result.products[0].platforms, ['library']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a project without any manifest is still read from its files', async () => {
  const root = fixture();
  try {
    write(root, 'index.html', '<!doctype html><link rel="stylesheet" href="styles.css">');
    write(root, 'styles.css', 'body { margin: 0; }');
    write(root, 'app.js', 'document.title = "hola";');
    const result = await analyzeWorkspace(root);
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0].role, 'application');
    assert.deepEqual(result.products[0].platforms, ['web']);
    assert.ok(result.targets[0].technologies.includes('HTML'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a language with no manifest and no html is reported by its sources', async () => {
  const root = fixture();
  try {
    write(root, 'main.py', 'print("hola")');
    write(root, 'lib/helpers.py', 'def x(): return 1');
    const result = await analyzeWorkspace(root);
    assert.equal(result.products.length, 1);
    assert.equal(result.targets[0].language, 'Python');
    /* Un script suelto es codigo: sin manifiesto ni servidor detectado, llamarlo backend le inventa una arquitectura. */
    assert.deepEqual(result.products[0].platforms, ['code']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

/*
 * Un repositorio de documentacion con scripts de mantenimiento no es una
 * aplicacion. Sin esta distincion, cualquier carpeta con un `.js` suelto lo era.
 */
test('code that only lives in helper folders does not make a docs repository an application', async () => {
  const root = fixture();
  try {
    for (let index = 0; index < 12; index += 1) write(root, `docs/nota-${index}.md`, '# Nota');
    write(root, 'README.md', '# Documentacion');
    write(root, 'scripts/check-parity.mjs', 'export const check = () => true;');
    write(root, 'scripts/deploy.ps1', 'Write-Output "deploy"');
    const result = await analyzeWorkspace(root);
    assert.deepEqual(result.products, []);
    assert.equal(result.projectAssessment.classification, 'folder');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

/*
 * Flutter escribe solo los proyectos nativos de cada plataforma. Leidos por
 * separado parecian aplicaciones distintas: una sola app producia nueve, y sus
 * CMakeLists de linux y windows la hacian figurar con backend.
 */
test('the native folders Flutter generates are part of the app, not separate applications', async () => {
  const root = fixture();
  try {
    write(root, 'pubspec.yaml', 'name: courier\ndependencies:\n  flutter:\n    sdk: flutter\n');
    write(root, 'lib/main.dart', 'void main() {}');
    write(root, 'android/settings.gradle', "include ':app'\n");
    write(root, 'android/app/src/main/AndroidManifest.xml', '<manifest />');
    write(root, 'ios/Runner.xcodeproj/project.pbxproj', '// generated');
    write(root, 'macos/Runner.xcodeproj/project.pbxproj', '// generated');
    write(root, 'linux/CMakeLists.txt', 'cmake_minimum_required(VERSION 3.10)');
    write(root, 'windows/CMakeLists.txt', 'cmake_minimum_required(VERSION 3.14)');
    write(root, 'linux/flutter/generated_plugin_registrant.cc', '// generated');
    write(root, 'web/index.html', '<!doctype html>');
    const result = await analyzeWorkspace(root);
    assert.equal(result.targets.length, 1);
    assert.equal(result.targets[0].kind, 'flutter');
    assert.equal(result.products.length, 1);
    /* Ni backend por los CMakeLists ni web por el index.html del andamiaje. */
    assert.deepEqual(result.products[0].platforms, ['mobile']);
    assert.deepEqual(result.products[0].technologies, ['Flutter', 'Dart']);
    assert.equal(result.targets[0].capabilities.androidPreview, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a real Android project next to a Flutter app is still its own application', async () => {
  const root = fixture();
  try {
    write(root, 'movil/pubspec.yaml', 'name: movil\ndependencies:\n  flutter:\n    sdk: flutter\n');
    write(root, 'movil/android/settings.gradle', "include ':app'\n");
    /* Fuera del arbol de la app Flutter, `android/` no es andamiaje de nadie. */
    write(root, 'nativa/settings.gradle', "include ':app'\n");
    write(root, 'nativa/app/src/main/AndroidManifest.xml', '<manifest />');
    const result = await analyzeWorkspace(root);
    assert.deepEqual(result.products.map((product) => product.relativePath).sort(), ['movil', 'nativa']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

/*
 * Casos que llegan de un curso, no de un repositorio concreto.
 */
test('a notebook folder is a project, not an empty folder', async () => {
  const root = fixture();
  try {
    write(root, 'analisis.ipynb', '{"cells":[],"nbformat":4}');
    write(root, 'datos.csv', 'columna,valor');
    const result = await analyzeWorkspace(root);
    assert.equal(result.products.length, 1);
    assert.equal(result.targets[0].language, 'Jupyter');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a first Java or C exercise is code, never a backend', async () => {
  for (const [file, contents] of [['Main.java', 'public class Main {}'], ['main.c', 'int main(){return 0;}']]) {
    const root = fixture();
    try {
      write(root, file, contents);
      const result = await analyzeWorkspace(root);
      assert.deepEqual(result.products[0].platforms, ['code'], file);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('a detected server still reports backend even without any manifest', async () => {
  const root = fixture();
  try {
    write(root, 'app.py', 'from flask import Flask');
    write(root, 'requirements.txt', 'flask');
    const result = await analyzeWorkspace(root);
    assert.deepEqual(result.products[0].platforms, ['backend']);
    assert.ok(result.products[0].technologies.includes('Flask'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

/*
 * Saltear un enlace es la guarda funcionando. En Windows aparecen decenas al
 * abrir cualquier carpeta de usuario y degradaban el estado sin motivo.
 */
test('a skipped link is not an incomplete analysis', async () => {
  const root = fixture();
  const outside = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ name: 'app', scripts: { dev: 'vite' }, dependencies: { react: '19' } }));
    write(root, 'node_modules/react/package.json', JSON.stringify({ name: 'react' }));
    try { fs.symlinkSync(outside, path.join(root, 'enlace'), 'junction'); } catch {}
    const result = await analyzeWorkspace(root);
    if (!result.warnings.some((warning) => warning.code === 'LINK_SKIPPED')) return;
    assert.equal(result.analysisIncomplete, false);
    assert.equal(result.readiness.checks.find((check) => check.id === 'analysis').status, 'ready');
    assert.ok(!result.readiness.recommendations.includes('REVIEW_PARTIAL_SCAN'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('a folder holding unrelated projects is reported as such, and a curated one is not', async () => {
  const loose = fixture();
  const curated = fixture();
  try {
    for (const roots of [loose, curated]) {
      for (let index = 0; index < 6; index += 1) {
        write(roots, `proyecto-${index}/package.json`, JSON.stringify({ name: `proyecto-${index}`, scripts: { dev: 'vite' }, dependencies: { react: '19' } }));
      }
    }
    /* Configuracion compartida en la raiz: alguien armo este conjunto a proposito. */
    write(curated, 'firebase.json', '{}');
    assert.equal((await analyzeWorkspace(loose)).looseProjects, true);
    assert.equal((await analyzeWorkspace(curated)).looseProjects, false);
  } finally { fs.rmSync(loose, { recursive: true, force: true }); fs.rmSync(curated, { recursive: true, force: true }); }
});

test('a single project is never reported as a folder of loose projects', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ name: 'app', scripts: { dev: 'vite' }, dependencies: { react: '19' } }));
    const result = await analyzeWorkspace(root);
    assert.equal(result.looseProjects, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('database evidence is reported from files, not only from dependencies', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ name: 'api', scripts: { start: 'node server.js' } }));
    write(root, 'server.js', 'const http = require("node:http"); http.createServer(() => {}).listen(3000);');
    write(root, 'database/schema.sql', 'create table ventas (id integer primary key);');
    write(root, 'datos.sqlite', '');
    const result = await analyzeWorkspace(root);
    const technologies = result.products[0].technologies;
    assert.ok(technologies.includes('SQL'));
    assert.ok(technologies.includes('SQLite'));
    assert.ok(result.products[0].platforms.includes('backend'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('recognizes backend, deployment, and container markers without reading secrets', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ name: 'api', dependencies: { express: '5', '@supabase/supabase-js': '2' } }));
    write(root, 'firebase.json', '{}');
    write(root, 'vercel.json', '{}');
    write(root, 'Dockerfile', 'FROM node:22');
    write(root, '.env', 'SECRET=do-not-read');
    const result = await analyzeWorkspace(root);
    assert.ok(result.services.includes('Firebase'));
    assert.ok(result.services.includes('Vercel'));
    assert.ok(result.services.includes('Docker'));
    assert.doesNotMatch(JSON.stringify(result), /do-not-read/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('returns a generic usable workspace for unknown folders', async () => {
  const root = fixture();
  try {
    write(root, 'README.md', '# Existing project');
    const result = await analyzeWorkspace(root);
    assert.equal(result.layout, 'unknown');
    assert.equal(result.targets[0].kind, 'generic');
    assert.equal(result.targets[0].capabilities.terminal, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('malformed manifests and linked paths produce bounded warnings', async () => {
  const root = fixture();
  const outside = fixture();
  try {
    write(root, 'package.json', '{bad json');
    try { fs.symlinkSync(outside, path.join(root, 'linked'), 'junction'); } catch {}
    const result = await analyzeWorkspace(root);
    assert.ok(result.warnings.some((warning) => warning.code === 'MALFORMED_MANIFEST'));
    if (fs.existsSync(path.join(root, 'linked'))) assert.ok(result.warnings.some((warning) => warning.code === 'LINK_SKIPPED'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('scan limits return deterministic partial results instead of failing', async () => {
  const root = fixture();
  try {
    for (let index = 0; index < 20; index += 1) write(root, `apps/app-${index}/package.json`, JSON.stringify({ name: `app-${index}` }));
    const result = await analyzeWorkspace(root, { maxEntries: 5 });
    assert.equal(result.complete, false);
    assert.ok(result.stats.entriesVisited <= 5);
    assert.ok(result.warnings.some((warning) => warning.code === 'SCAN_LIMIT'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('audits readiness without returning environment values or script bodies', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({
      name: 'reviewed-app',
      packageManager: 'pnpm@9.12.0',
      engines: { node: '>=22' },
      scripts: { dev: 'vite --host 0.0.0.0', build: 'secret-build-command', test: 'node --test' },
      dependencies: { react: '19.0.0' },
      devDependencies: { vite: '6.0.0', typescript: '5.0.0' },
    }));
    write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9');
    write(root, '.env.example', 'VITE_API_URL=https://example.invalid\nPRIVATE_TOKEN=example-secret');
    write(root, '.env.local', 'VITE_API_URL=https://real.invalid\nPRIVATE_TOKEN=real-secret');
    write(root, 'src/config.ts', 'export const url = import.meta.env.VITE_API_URL; const key = process.env.SERVER_KEY;');
    fs.mkdirSync(path.join(root, '.git'));

    const result = await analyzeWorkspace(root);
    const serialized = JSON.stringify(result);
    assert.equal(result.schemaVersion, 3);
    assert.equal(result.projectAssessment.classification, 'project');
    assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(result.git.detected, true);
    assert.ok(result.scripts.some((script) => script.name === 'build' && script.category === 'build'));
    assert.ok(result.dependencies[0].groups.some((group) => group.packageNames.includes('react')));
    assert.ok(result.environment.names.some((item) => item.name === 'SERVER_KEY'));
    assert.equal(result.environment.names.find((item) => item.name === 'VITE_API_URL').configuredLocally, true);
    assert.equal(result.environment.valuesStored, false);
    assert.equal(result.environment.valuesReturned, false);
    assert.ok(result.runtimes.some((item) => item.runtime === 'node' && item.declaredRange === '>=22'));
    assert.doesNotMatch(serialized, /real-secret|example-secret|secret-build-command|https:\/\/real\.invalid/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('npm workspace members share one explicit root install scope', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ private: true, workspaces: ['apps/*'], packageManager: 'npm@11.0.0' }));
    write(root, 'package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {} }));
    write(root, 'apps/admin/package.json', JSON.stringify({ name: 'admin', dependencies: { react: '19' } }));
    write(root, 'apps/store/package.json', JSON.stringify({ name: 'store', dependencies: { vue: '3' } }));
    const result = await analyzeWorkspace(root);
    const members = result.dependencies.filter((item) => item.installState === 'install-needed' && item.installScope.isWorkspaceMember);
    assert.equal(members.length, 2);
    assert.ok(members.every((item) => item.installScope.relativePath === '.' && item.installScope.manager === 'npm' && item.installScope.lockfile === 'package-lock.json'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an unrelated root lockfile is not assigned to a nested standalone app', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ name: 'root' }));
    write(root, 'package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {} }));
    write(root, 'apps/standalone/package.json', JSON.stringify({ name: 'standalone', dependencies: { react: '19' } }));
    const result = await analyzeWorkspace(root);
    const standalone = result.dependencies.find((item) => result.targets.find((target) => target.id === item.targetId)?.name === 'standalone');
    assert.equal(standalone.installScope.relativePath, 'apps/standalone');
    assert.equal(standalone.installScope.manager, null);
    assert.equal(standalone.installScope.lockfile, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('hoisted root modules satisfy workspace member dependencies', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ private: true, workspaces: { packages: ['apps/*'] } }));
    write(root, 'package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {} }));
    write(root, 'apps/web/package.json', JSON.stringify({ name: 'web', dependencies: { react: '19' } }));
    write(root, 'node_modules/react/package.json', JSON.stringify({ name: 'react', version: '19.0.0' }));
    const result = await analyzeWorkspace(root);
    const web = result.dependencies.find((item) => result.targets.find((target) => target.id === item.targetId)?.name === 'web');
    assert.equal(web.installState, 'appears-installed');
    assert.deepEqual(web.resolvedNodeModules, ['node_modules']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pnpm workspace patterns and exclusions choose the correct install owners', async () => {
  const root = fixture();
  try {
    write(root, 'package.json', JSON.stringify({ private: true }));
    write(root, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - '!apps/legacy'\n");
    write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9');
    write(root, 'apps/web/package.json', JSON.stringify({ name: 'web', dependencies: { react: '19' } }));
    write(root, 'apps/legacy/package.json', JSON.stringify({ name: 'legacy', dependencies: { vue: '3' } }));
    write(root, 'apps/legacy/package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {} }));
    const result = await analyzeWorkspace(root);
    const byName = (name) => result.dependencies.find((item) => result.targets.find((target) => target.id === item.targetId)?.name === name);
    assert.equal(byName('web').installScope.relativePath, '.');
    assert.equal(byName('web').installScope.manager, 'pnpm');
    assert.equal(byName('legacy').installScope.relativePath, 'apps/legacy');
    assert.equal(byName('legacy').installScope.manager, 'npm');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('decision fingerprint changes when a preview capability appears', async () => {
  const root = fixture();
  try {
    write(root, 'pubspec.yaml', 'name: mobile\ndependencies:\n  flutter:\n    sdk: flutter\n');
    const before = await analyzeWorkspace(root);
    assert.equal(before.targets[0].capabilities.androidPreview, false);
    write(root, 'android/.keep', '');
    const after = await analyzeWorkspace(root);
    assert.equal(after.targets[0].capabilities.androidPreview, true);
    assert.notEqual(after.fingerprint, before.fingerprint);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unknown folders require explicit confirmation and manifest changes invalidate the fingerprint', async () => {
  const root = fixture();
  try {
    write(root, 'README.md', '# Notes');
    const unknown = await analyzeWorkspace(root);
    assert.equal(unknown.projectAssessment.classification, 'folder');
    assert.equal(unknown.projectAssessment.requiresAcknowledgement, true);
    assert.equal(unknown.readiness.status, 'not-a-project');

    write(root, 'package.json', JSON.stringify({ name: 'now-a-project', dependencies: { react: '19' } }));
    const detected = await analyzeWorkspace(root);
    assert.notEqual(detected.fingerprint, unknown.fingerprint);
    assert.equal(detected.projectAssessment.classification, 'project');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
