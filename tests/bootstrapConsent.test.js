const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
 * El instalador no puede instalar nada que no haya mostrado antes.
 *
 * Hay dos caminos de instalacion y consienten distinto. El de la aplicacion
 * pasa por un dialogo nativo que nombra el paquete. El del primer arranque no:
 * `bootstrap:start` llama directo a los managers, y ahi la unica autorizacion
 * es el boton de la pantalla de bienvenida.
 *
 * Ese boton solo vale como consentimiento si la pantalla dice que se instala.
 * Durante un tiempo no lo decia, y ademas instalaba Claude Code, que la
 * documentacion prometia no tocar.
 *
 * Esta prueba lee los paquetes del codigo que los instala, no de una lista
 * escrita a mano: si manana el bootstrap agrega un tercer agente, falla hasta
 * que la pantalla lo nombre.
 */

const ELECTRON = path.join(__dirname, '..', 'electron');
const read = (...segments) => fs.readFileSync(path.join(ELECTRON, ...segments), 'utf8');

const bootstrapUi = read('bootstrap.js');
const main = read('main.js');

/** Paquetes npm que instalan los managers que el bootstrap invoca. */
function packagesInstalledByBootstrap() {
  const packages = new Map();

  const openCode = read('services', 'openCodeManager.js');
  const name = openCode.match(/const PACKAGE_NAME = '([^']+)'/);
  const version = openCode.match(/const INSTALL_PACKAGE = `\$\{PACKAGE_NAME\}@([^`]+)`/);
  assert.ok(name && version, 'no se pudo leer el paquete de OpenCode');
  packages.set('installOpenCode', `${name[1]}@${version[1]}`);

  const claude = read('services', 'claudeManager.js');
  const claudePackage = claude.match(/'install',\s*'--global',\s*'([^']+)'/);
  assert.ok(claudePackage, 'no se pudo leer el paquete de Claude Code');
  packages.set('installClaudeCode', claudePackage[1]);

  return packages;
}

/** Textos de la pantalla de bienvenida, por idioma. */
function welcomeCopy() {
  const languages = {};
  for (const [, code, body] of bootstrapUi.matchAll(/^\s{2}(en|es): \{(.+)\},$/gm)) {
    languages[code] = body;
  }
  assert.deepEqual(Object.keys(languages).sort(), ['en', 'es'], 'faltan idiomas en el instalador');
  return languages;
}

test('el bootstrap instala exactamente los agentes que se conocen', () => {
  const packages = packagesInstalledByBootstrap();
  for (const caller of packages.keys()) {
    assert.match(main, new RegExp(`await ${caller}\\(`), `main.js ya no invoca ${caller}: revisa esta prueba`);
  }

  // Cualquier install --global nuevo en el arranque tiene que pasar por aca.
  const installers = [...main.matchAll(/await (install[A-Za-z]+)\(/g)].map((match) => match[1]);
  const unknown = installers.filter((caller) => !packages.has(caller) && caller !== 'installAllEnvironment');
  assert.deepEqual(unknown, [], `el bootstrap instala algo que esta prueba no conoce: ${unknown.join(', ')}`);
});

test('la pantalla de bienvenida nombra cada paquete que se va a instalar', () => {
  const packages = [...packagesInstalledByBootstrap().values()];
  const languages = welcomeCopy();

  for (const [language, body] of Object.entries(languages)) {
    for (const packageName of packages) {
      assert.ok(
        body.includes(packageName),
        `el instalador en "${language}" no nombra ${packageName} antes de instalarlo`,
      );
    }
  }
});

test('ese texto se muestra de verdad, y antes del boton', () => {
  assert.match(
    bootstrapUi,
    /\$\('welcome-points'\)\.replaceChildren\([^)]*t\.installs/,
    'el texto de instalacion existe pero no se renderiza en la bienvenida',
  );

  const points = bootstrapUi.indexOf("$('welcome-points')");
  const start = bootstrapUi.indexOf("$('start').textContent");
  assert.ok(points !== -1 && start !== -1 && points < start, 'la lista debe pintarse antes que el boton');
});

test('el camino dentro de la aplicacion sigue pidiendo dialogo nativo', () => {
  const openCode = read('services', 'openCodeManager.js');
  const handler = openCode.slice(openCode.indexOf("ipcMain.handle('opencode:install'"));
  const confirm = handler.indexOf('dialog.showMessageBox');
  const install = handler.indexOf('return installOpenCode(');
  assert.ok(confirm !== -1, 'el IPC de instalacion perdio su dialogo de confirmacion');
  assert.ok(confirm < install, 'el dialogo debe resolverse antes de instalar');
  assert.match(handler, /confirmation\.response !== 1/, 'cancelar debe abortar la instalacion');
});
