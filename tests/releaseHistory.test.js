const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getReleaseHistory } = require('../electron/services/releaseHistory');

/*
 * La barra lateral mostro "v1.0.0" hasta la 1.1.19. Un numero escrito a mano no
 * se entera de los releases, y era lo unico que el usuario ve de la version
 * mientras usa la app.
 */
test('the sidebar shows the installed version instead of a hand-written one', () => {
  const sidebar = fs.readFileSync(path.join(__dirname, '..', 'src', 'layouts', 'sidebar', 'Sidebar.jsx'), 'utf8');
  /* Sobre texto renderizado, no sobre el archivo entero: en SVG la `v` es un comando de path. */
  assert.doesNotMatch(sidebar, />\s*v\d+\.\d+\.\d+\s*</);
  assert.doesNotMatch(sidebar, /['"`]v\d+\.\d+\.\d+['"`]/);
  assert.match(sidebar, /updates\?\.getHistory\?\.\(\)/);
  assert.match(sidebar, /history\?\.currentVersion/);
  /* Sin version conocida no se inventa un numero: no se muestra nada. */
  assert.match(sidebar, /\{version && <button/);
});

/*
 * El numero de version es el lugar natural donde se pregunta si hay algo nuevo,
 * asi que buscar actualizaciones se hace desde ahi y no solo desde Configuracion.
 */
test('the version acts as the check-for-updates control and reports its own outcome', () => {
  const sidebar = fs.readFileSync(path.join(__dirname, '..', 'src', 'layouts', 'sidebar', 'Sidebar.jsx'), 'utf8');
  assert.match(sidebar, /onClick=\{checkForUpdates\}/);
  assert.match(sidebar, /window\.electronAPI\.updates\.check\(\)/);
  assert.match(sidebar, /aria-busy=\{checkState === 'checking'\}/);
  assert.match(sidebar, /sidebar__version-spinner/);
  /* Sin acceso vigente el chequeo no corre: no puede quedar girando para siempre. */
  assert.match(sidebar, /authState\?\.policy !== 'active'/);
  /* Un resultado siempre vuelve a un estado estable, nunca deja la ruedita colgada. */
  assert.match(sidebar, /clearTimeout\(checkTimerRef\.current\)/);
  assert.match(sidebar, /setCheckState\('idle'\)/);
  /* Cuando falla, la etiqueta accesible lleva el motivo real y no un "falló" que no dice nada. */
  assert.match(sidebar, /aria-label=\{checkState === 'error' && failureTitle \? failureTitle : checkLabel\}/);
  assert.match(sidebar, /settings\.updateErrors\.\$\{checkDetail\}/);
});

test('the newest release entry matches the version being shipped', () => {
  const packaged = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(getReleaseHistory()[0].version, packaged.version);
});

test('release history is bounded, ordered, and exposes only local display fields', () => {
  const history = getReleaseHistory();
  assert.ok(history.length > 0 && history.length <= 20);
  assert.deepEqual(Object.keys(history[0]).sort(), ['date', 'highlights', 'version']);
  assert.equal(history.every((release) => /^\d+\.\d+\.\d+$/.test(release.version)), true);
  assert.equal(history.every((release) => /^\d{4}-\d{2}-\d{2}$/.test(release.date)), true);
  assert.equal(history.every((release) => release.highlights.every((highlight) => typeof highlight.en === 'string' && typeof highlight.es === 'string')), true);
});

test('release history callers cannot mutate the shared catalog', () => {
  const first = getReleaseHistory();
  first[0].highlights[0].en = 'modified';
  assert.notEqual(getReleaseHistory()[0].highlights[0].en, 'modified');
});
