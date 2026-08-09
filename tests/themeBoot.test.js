const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/*
 * El tema antes del primer pintado.
 *
 * La capa de tokens define el oscuro en `:root`, asi que cualquier retraso en
 * aplicar el claro se ve como un parpadeo. En el escritorio el retraso era
 * grande: el tema vive en la configuracion local y solo se lee por IPC.
 *
 * `public/theme-boot.js` resuelve el tema de forma sincrona en el `head`. Como
 * duplica la logica de preferencia que ya tiene la aplicacion, lo que hay que
 * proteger es que las dos no se separen: si divergen, el parpadeo vuelve, o
 * peor, arranca con un tema y salta al otro.
 *
 * No se analiza el fuente: se ejecuta el script contra un DOM falso.
 */

const BOOT = path.join(__dirname, '..', 'public', 'theme-boot.js');
const source = fs.readFileSync(BOOT, 'utf8');

/** Corre theme-boot en un entorno controlado y devuelve lo que le hizo al DOM. */
function runBoot({ stored = null, prefersLight = false, noStorage = false, noMatchMedia = false } = {}) {
  const classes = new Set();
  const root = {
    dataset: {},
    style: {},
    classList: {
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
    },
  };

  const sandbox = {
    document: { documentElement: root },
    localStorage: {
      getItem(key) {
        if (noStorage) throw new Error('storage blocked');
        return key === 'vibe-theme' ? stored : null;
      },
    },
  };
  // El script usa `window.matchMedia` y `localStorage` pelado: el mismo objeto
  // hace de global y de window, como en un navegador.
  sandbox.window = sandbox;
  if (!noMatchMedia) {
    sandbox.matchMedia = (query) => ({ matches: query.includes('light') ? prefersLight : !prefersLight });
  }

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { theme: root.dataset.theme, colorScheme: root.style.colorScheme, classes };
}

test('la eleccion guardada gana sobre la preferencia del sistema', () => {
  const light = runBoot({ stored: 'light', prefersLight: false });
  assert.equal(light.theme, 'light');

  const dark = runBoot({ stored: 'dark', prefersLight: true });
  assert.equal(dark.theme, 'dark');
});

test('sin eleccion guardada se sigue al sistema', () => {
  assert.equal(runBoot({ prefersLight: true }).theme, 'light');
  assert.equal(runBoot({ prefersLight: false }).theme, 'dark');
});

test('un valor invalido en el almacenamiento no se cree', () => {
  assert.equal(runBoot({ stored: 'sepia', prefersLight: true }).theme, 'light');
  assert.equal(runBoot({ stored: '', prefersLight: false }).theme, 'dark');
});

test('el oscuro es el ultimo recurso, no el primero', () => {
  // Sin almacenamiento y sin matchMedia no hay de donde sacar la preferencia.
  assert.equal(runBoot({ noStorage: true, noMatchMedia: true }).theme, 'dark');
  // Con el almacenamiento bloqueado todavia se puede preguntar al sistema.
  assert.equal(runBoot({ noStorage: true, prefersLight: true }).theme, 'light');
});

test('deja el documento listo para la capa de tokens', () => {
  const light = runBoot({ stored: 'light' });
  assert.equal(light.theme, 'light', 'data-theme es lo que leen los tokens');
  assert.equal(light.colorScheme, 'light', 'sin color-scheme los controles nativos quedan del otro tema');
  assert.ok(light.classes.has('light-mode'), 'la web todavia mira light-mode');
  assert.ok(light.classes.has('light-theme'), 'el escritorio todavia mira light-theme');

  const dark = runBoot({ stored: 'dark' });
  assert.equal(dark.classes.size, 0, 'en oscuro no debe quedar ninguna clase de claro');
});

test('theme-boot y la aplicacion resuelven la misma preferencia', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'theme.js'), 'utf8');

  const bootKey = source.match(/STORAGE_KEY = '([^']+)'/);
  const runtimeKey = runtime.match(/BOOT_THEME_KEY = '([^']+)'/);
  assert.ok(bootKey && runtimeKey, 'no se pudo leer la clave de almacenamiento de ambos lados');
  assert.equal(
    bootKey[1],
    runtimeKey[1],
    'theme-boot y la aplicacion usan claves distintas: el arranque leeria algo que nadie escribe',
  );

  assert.match(
    runtime,
    /localStorage\?\.setItem\(BOOT_THEME_KEY/,
    'la aplicacion debe reflejar el tema al almacenamiento o theme-boot no tiene que leer en el proximo arranque',
  );
});

test('el documento carga theme-boot antes que el bundle', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const boot = html.indexOf('theme-boot.js');
  const bundle = html.indexOf('src/main.jsx');
  assert.notEqual(boot, -1, 'index.html no carga theme-boot');
  assert.ok(boot < bundle, 'theme-boot tiene que ejecutarse antes que el bundle');
  assert.doesNotMatch(
    html.slice(boot - 120, boot + 40),
    /\b(defer|async|type="module")/,
    'theme-boot no puede diferirse: dejaria de correr antes del primer pintado',
  );
});
