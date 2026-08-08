import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizeSetup } from '../src/utils/setupSummary.js';

/*
 * El onboarding declaraba "Todo listo" aunque un agente hubiera fallado o
 * siguiera instalandose. El avance sigue sin depender de eso —la app funciona
 * igual—, pero el resultado tiene que decirse.
 */

const READY = {
  environment: { items: [{ id: 'node', name: 'Node.js', installed: true, required: true }] },
  openCode: { loading: false, installing: false, status: { usable: true } },
  claudeStatus: { loading: false, installing: false, installed: true },
  codexReady: true,
};

test('everything installed reports a complete setup', () => {
  const summary = summarizeSetup(READY);
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.missing, []);
  assert.deepEqual(summary.pending, []);
  assert.equal(summary.readyCount, 4);
});

test('a failed agent keeps the setup from being complete and carries its reason', () => {
  const summary = summarizeSetup({
    ...READY,
    openCode: { loading: false, installing: false, status: null, error: 'No se pudo descargar el paquete.' },
  });
  assert.equal(summary.complete, false);
  assert.equal(summary.missing.length, 1);
  assert.equal(summary.missing[0].id, 'opencode');
  assert.equal(summary.missing[0].detail, 'No se pudo descargar el paquete.');
});

test('an agent still installing is pending, not missing and not ready', () => {
  const summary = summarizeSetup({ ...READY, claudeStatus: { installing: true, installed: false } });
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.missing, []);
  assert.equal(summary.pending[0].id, 'claude');
});

test('a missing required tool from the environment is reported too', () => {
  const summary = summarizeSetup({
    ...READY,
    environment: { items: [{ id: 'git', name: 'Git', installed: false, required: true }] },
  });
  assert.equal(summary.complete, false);
  assert.equal(summary.missing[0].id, 'git');
  assert.equal(summary.missing[0].required, true);
});

test('codex not yet checked counts as pending, never as ready', () => {
  assert.equal(summarizeSetup({ ...READY, codexReady: null }).pending[0].id, 'codex');
});

test('the final screen stops claiming success when something is pending', async () => {
  const wizard = await readFile(new URL('../src/features/setup/OnboardingWizard.jsx', import.meta.url), 'utf8');
  assert.match(wizard, /summarizeSetup/, 'la pantalla final debe usar el resumen real');
  assert.match(wizard, /complete \? t\('onboarding\.doneTitle'\) : t\('onboarding\.donePartialTitle'\)/);
});
