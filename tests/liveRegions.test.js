const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
 * Las superficies que cambian de estado solas —el explorador tras una accion,
 * la vista previa mientras arranca un servidor— necesitan una region viva o el
 * cambio no se anuncia nunca.
 *
 * Hay dos reglas faciles de romper sin darse cuenta:
 *
 *  1. La region tiene que estar montada siempre. Si se renderiza recien con el
 *     primer mensaje (`{mensaje && <p aria-live>}`), el lector se pierde justo
 *     ese anuncio.
 *  2. Una sola de cada tipo. Dos regiones polite con el mismo texto lo
 *     anuncian dos veces.
 */

const SRC = path.join(__dirname, '..', 'src');

const SURFACES = [
  path.join(SRC, 'features', 'explorer', 'FileExplorer.jsx'),
  path.join(SRC, 'features', 'preview', 'PreviewCenter.jsx'),
];

test('each surface has exactly one polite and one assertive region', () => {
  for (const file of SURFACES) {
    const source = fs.readFileSync(file, 'utf8');
    const name = path.basename(file);
    const polite = source.match(/aria-live="polite"/g) || [];
    const assertive = source.match(/aria-live="assertive"/g) || [];
    assert.equal(polite.length, 1, `${name}: se esperaba una sola region polite`);
    assert.equal(assertive.length, 1, `${name}: se esperaba una sola region assertive`);
  }
});

test('the regions are always mounted, not rendered with their first message', () => {
  for (const file of SURFACES) {
    const source = fs.readFileSync(file, 'utf8');
    const name = path.basename(file);
    // Un `&&` justo antes de la etiqueta delataria un montaje condicional.
    for (const match of source.matchAll(/(.{0,80})<p className="sr-only"/g)) {
      assert.ok(
        !/&&\s*$/.test(match[1]),
        `${name}: la region viva se monta condicionalmente y se perderia el primer anuncio`,
      );
    }
  }
});

test('polite and assertive never hold the message at the same time', () => {
  for (const file of SURFACES) {
    const source = fs.readFileSync(file, 'utf8');
    const name = path.basename(file);
    // Cada region decide por el mismo ternario, invertido entre una y otra.
    const politeBlock = source.slice(source.indexOf('aria-live="polite"'));
    const assertiveBlock = source.slice(source.indexOf('aria-live="assertive"'));
    assert.match(politeBlock.slice(0, 160), /\?\s*''\s*:/, `${name}: polite deberia vaciarse ante un error`);
    assert.match(assertiveBlock.slice(0, 160), /\?[^:]+:\s*''/, `${name}: assertive deberia vaciarse sin error`);
  }
});

test('the sr-only class exists so the regions stay out of sight but announced', () => {
  const tokens = fs.readFileSync(path.join(SRC, 'styles', 'tokens.css'), 'utf8');
  assert.match(tokens, /\.sr-only\s*\{/, 'falta la clase .sr-only');
  const block = tokens.slice(tokens.indexOf('.sr-only'), tokens.indexOf('.sr-only') + 300);
  // display:none o visibility:hidden lo sacarian tambien del anuncio.
  assert.ok(!/display:\s*none/.test(block), '.sr-only no debe usar display:none');
  assert.ok(!/visibility:\s*hidden/.test(block), '.sr-only no debe usar visibility:hidden');
});
