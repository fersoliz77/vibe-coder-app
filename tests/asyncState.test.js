import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ASYNC_STATES, failed, idle, loaded, loading, normalizeError, partial, runAsync } from '../src/utils/asyncState.js';

/*
 * Cada pantalla inventaba su propio "que esta pasando". Lo que mas dolia:
 * "todavia no cargo", "cargo y no hay nada" y "fallo" se veian todas igual,
 * es decir, en blanco.
 */

test('an empty collection is empty, never success', () => {
  assert.equal(loaded([]).state, ASYNC_STATES.EMPTY);
  assert.equal(loaded([{ id: 1 }]).state, ASYNC_STATES.SUCCESS);
});

test('a non-collection value is success even when it is falsy', () => {
  assert.equal(loaded(0).state, ASYNC_STATES.SUCCESS);
  assert.equal(loaded(null).state, ASYNC_STATES.SUCCESS);
});

test('the four other states carry what the screen needs to render', () => {
  assert.deepEqual(idle(), { state: 'idle', data: null, error: '' });
  assert.deepEqual(loading([1]), { state: 'loading', data: [1], error: '' });
  assert.deepEqual(failed(new Error('boom')), { state: 'error', data: null, error: 'boom' });
  assert.deepEqual(partial(['a'], 'half done'), { state: 'partial', data: ['a'], error: 'half done' });
});

test('errors normalize whatever they arrive as', () => {
  assert.equal(normalizeError(new Error('boom')), 'boom');
  assert.equal(normalizeError('boom'), 'boom');
  assert.equal(normalizeError(null, 'fallback'), 'fallback');
  assert.equal(normalizeError({}, 'fallback'), 'fallback', 'un objeto sin message no se imprime como [object Object]');
});

test('runAsync turns a rejection into a state instead of an unhandled throw', async () => {
  assert.equal((await runAsync(async () => ['a'])).state, ASYNC_STATES.SUCCESS);
  assert.equal((await runAsync(async () => [])).state, ASYNC_STATES.EMPTY);

  const result = await runAsync(async () => { throw new Error('sin permiso'); });
  assert.equal(result.state, ASYNC_STATES.ERROR);
  assert.equal(result.error, 'sin permiso');
});

test('runAsync falls back to a readable message when the failure has none', async () => {
  const result = await runAsync(async () => { throw {}; }, { fallbackError: 'no se pudo listar' });
  assert.equal(result.error, 'no se pudo listar');
});

test('the project list renders the four states instead of a blank screen', async () => {
  const list = await readFile(new URL('../src/features/projects/ProjectList.jsx', import.meta.url), 'utf8');
  for (const state of ['LOADING', 'ERROR', 'EMPTY', 'SUCCESS']) {
    assert.match(list, new RegExp(`ASYNC_STATES\\.${state}`), `falta el estado ${state}`);
  }
  assert.doesNotMatch(list, /catch \(e\) \{\s*console\.error\(e\);/, 'listar ya no puede fallar en silencio');
});

test('the create wizard uses the shared focus trap, not its own', async () => {
  const wizard = await readFile(new URL('../src/features/projects/CreateProjectWizard.jsx', import.meta.url), 'utf8');
  assert.match(wizard, /useFocusTrap\(\{ active: !confirming/);
  assert.match(wizard, /useFocusTrap\(\{ active: confirming/, 'la confirmacion es otra capa y necesita su propia trampa');
  assert.doesNotMatch(wizard, /document\.addEventListener\('keydown'/, 'la trampa escrita a mano tiene que haber desaparecido');
});
