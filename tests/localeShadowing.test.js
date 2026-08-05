const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
 * El diccionario se arma en varios pasos con Object.assign. Asignar un grupo
 * entero (`{ ai: {...} }`) en vez de fusionarlo reemplaza el objeto y borra en
 * silencio todas las claves definidas antes: la interfaz muestra "ai.clear" en
 * vez del texto. Ya paso con `ai`, y dejo 24 claves inalcanzables.
 *
 * Estos tests verifican el resultado, no la forma del codigo: recorren lo que
 * el codigo realmente pide y comprueban que exista en los dos idiomas.
 */

const SRC_DIR = path.join(__dirname, '..', 'src');
const LOCALES_PATH = path.join(SRC_DIR, 'i18n', 'locales.js');

/* Claves que son listas, no textos: se usan con .map en la interfaz. */
const ARRAY_KEYS = new Set(['ai.claudeLoginSteps', 'ai.openaiLoginSteps']);

async function loadDictionaries() {
  const source = fs.readFileSync(LOCALES_PATH, 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const { dictionaries } = await import(moduleUrl);
  return dictionaries;
}

function collectUsedKeys() {
  const keys = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.jsx?$/.test(entry.name)) {
        for (const [, key] of fs.readFileSync(full, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
          keys.add(key);
        }
      }
    }
  };
  walk(SRC_DIR);
  return keys;
}

const resolve = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);

test('every key the interface asks for resolves in both languages', async () => {
  const dictionaries = await loadDictionaries();
  const used = collectUsedKeys();
  assert.ok(used.size > 400, `se esperaban muchas claves, se encontraron ${used.size}`);

  const missing = [];
  for (const key of used) {
    for (const locale of ['en', 'es']) {
      const value = resolve(dictionaries[locale], key);
      const ok = ARRAY_KEYS.has(key) ? Array.isArray(value) : typeof value === 'string';
      if (!ok) missing.push(`${locale}.${key}`);
    }
  }
  assert.deepEqual(missing, [], 'estas claves se mostrarian crudas en pantalla');
});

test('the keys the confirmation dialogs need are present', async () => {
  const dictionaries = await loadDictionaries();
  const required = [
    'ai.clearTitle', 'ai.clearCopy', 'ai.clearConfirm',
    'ai.logoutTitle', 'ai.logoutCopy', 'ai.logoutConfirm',
    'ai.statusFailed', 'ai.statusFailedCopy', 'ai.retry',
    'projects.removeTitle', 'projects.removeCopy', 'projects.removeDetail', 'projects.removeConfirm',
    'terminal.failedTitle', 'terminal.retry',
    'common.cancel', 'common.confirm',
  ];
  for (const locale of ['en', 'es']) {
    for (const key of required) {
      assert.equal(typeof resolve(dictionaries[locale], key), 'string', `falta ${locale}.${key}`);
    }
  }
});

test('both languages expose exactly the same keys', async () => {
  const dictionaries = await loadDictionaries();
  const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  ));
  const en = new Set(flatten(dictionaries.en));
  const es = new Set(flatten(dictionaries.es));
  assert.deepEqual([...en].filter((key) => !es.has(key)), [], 'claves sin traducir al espanol');
  assert.deepEqual([...es].filter((key) => !en.has(key)), [], 'claves sin traducir al ingles');
});
