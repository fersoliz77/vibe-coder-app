const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
 * Los mensajes de error del explorador se anuncian en una region `assertive`
 * para que interrumpan, y los de exito en una `polite` para que esperen. Eso
 * solo funciona si cada fallo declara su severidad al llamar.
 *
 * Es facil agregar un `setStatusMessage(result.error || ...)` nuevo y olvidar
 * el segundo argumento: el error quedaria anunciado como si fuera una
 * confirmacion, detras de todo lo que el lector tenga en cola.
 */

const EXPLORER_DIR = path.join(__dirname, '..', 'src', 'features', 'explorer');

function explorerSources() {
  return fs.readdirSync(EXPLORER_DIR)
    .filter((name) => /\.jsx?$/.test(name))
    .map((name) => ({ name, source: fs.readFileSync(path.join(EXPLORER_DIR, name), 'utf8') }));
}

test('every failure message declares itself as an error', () => {
  // Reconoce el patron de fallo: viene de result.error o de una clave *Failed.
  // Se lee hasta el punto y coma, porque el argumento contiene sus propios
  // parentesis: setStatusMessage(result.error || t('explorer.moveFailed'), 'error');
  const failure = /setStatusMessage\([^;]*?\);/g;
  const looksLikeFailure = (call) => /result\??\.error/.test(call) || /[Ff]ailed'/.test(call);
  const offenders = [];

  for (const { name, source } of explorerSources()) {
    for (const match of source.matchAll(failure)) {
      if (looksLikeFailure(match[0]) && !match[0].includes("'error'")) {
        offenders.push(`${name}: ${match[0].replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'estos fallos se anunciarian como confirmaciones');
});

test('the status hook defaults to the polite tone', () => {
  const source = fs.readFileSync(path.join(EXPLORER_DIR, 'useStatusMessage.js'), 'utf8');
  assert.match(source, /tone = 'info'/, 'el tono por defecto debe ser info');
});

test('there is exactly one polite and one assertive region', () => {
  const source = fs.readFileSync(path.join(EXPLORER_DIR, 'FileExplorer.jsx'), 'utf8');
  const polite = source.match(/aria-live="polite"/g) || [];
  const assertive = source.match(/aria-live="assertive"/g) || [];
  assert.equal(polite.length, 1, 'una sola region polite, o el mensaje se anuncia repetido');
  assert.equal(assertive.length, 1, 'una sola region assertive');
});

test('the visible messages do not announce themselves as well', () => {
  const source = fs.readFileSync(path.join(EXPLORER_DIR, 'ExplorerWorkspace.jsx'), 'utf8');
  const visible = source.match(/className=\{`file-explorer__status[^}]*\}/g) || [];
  assert.ok(visible.length > 0, 'no se encontro el mensaje visible');
  for (const match of visible) {
    const tag = source.slice(source.indexOf(match), source.indexOf(match) + 400);
    assert.match(tag, /aria-hidden="true"/, 'el mensaje visible se anunciaria por duplicado');
  }
});
