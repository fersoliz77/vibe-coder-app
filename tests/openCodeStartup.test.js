import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * El panel de OpenCode solo sabia si existia la terminal o no: cuando la
 * creacion fallaba, `openCodeTerminal` quedaba en null y el spinner giraba para
 * siempre. El error existia en el hook, pero nadie lo miraba.
 *
 * Y compartia `lastError` con las terminales comunes, asi que un fallo de otra
 * pestana se mostraba como si fuera de OpenCode.
 */

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('the OpenCode hook tracks its own error and its own startup', async () => {
  const hook = await read('../src/hooks/useTerminal.js');
  assert.match(hook, /openCodeError/, 'OpenCode necesita su propio error');
  assert.match(hook, /openCodeStarting/, 'y saber si esta arrancando');
  assert.match(hook, /clearOpenCodeError/);
  const body = hook.slice(
    hook.indexOf('const createOpenCodeTerminal'),
    hook.indexOf('const closeTerminal'),
  );
  assert.ok(body.length > 0, 'no se encontro el cuerpo de createOpenCodeTerminal');
  assert.match(body, /setOpenCodeError/);
  assert.doesNotMatch(
    body,
    /setLastError/,
    'el arranque de OpenCode no debe escribir en el error de las terminales comunes',
  );
});

test('a concurrent preload and click cannot launch two OpenCode sessions', async () => {
  const hook = await read('../src/hooks/useTerminal.js');
  assert.match(hook, /openCodeRequestRef/, 'hace falta una guarda contra el doble arranque');
});

test('the OpenCode panel renders failure and idle, not only the spinner', async () => {
  const panel = await read('../src/features/opencode/OpenCodePanel.jsx');
  assert.match(panel, /openCodeError/, 'el panel debe consumir el error');
  assert.match(panel, /opencode\.failedTitle/);
  assert.match(panel, /opencode\.retry/);
  assert.match(panel, /openCodeStarting/, 'el spinner solo cubre el arranque real');
});

test('a terminal whose shell failed shows the reason instead of an empty xterm', async () => {
  const panel = await read('../src/features/terminal/TerminalPanel.jsx');
  assert.match(panel, /terminal\.sessionFailed/, 'la sesion fallida debe explicarse');
  assert.match(panel, /terminals\.length > 0 && lastError/, 'un fallo con otras pestanas abiertas no puede quedar oculto');
});
