const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { KNOWN_SIGNALS, OBSERVED_CHANNELS, SignalsManager, observeChannels } = require('../electron/services/signalsManager');

/*
 * Reportar actividad no puede costarle nada al alumno.
 *
 * Estas pruebas fijan las tres promesas: que nunca falle hacia quien la llama,
 * que no mande mas de lo debido, y que el vocabulario siga coincidiendo con lo
 * que la base acepta -que es como esto se rompe en silencio-.
 */

function makeStore(initial = {}) {
  const data = { ...initial };
  return {
    get: (key) => data[key],
    set: (key, value) => { data[key] = value; },
    read: () => data,
  };
}

const SESSION = {
  supabaseUrl: 'https://proyecto.supabase.co',
  anonKey: 'anon',
  accessToken: 'token-del-alumno',
  userId: 'alumno-1',
};

const authenticated = { getRealtimeSession: () => SESSION };
const anonymous = { getRealtimeSession: () => null };
const ok = async () => ({ ok: true });

test('an unknown signal is never sent', async () => {
  let calls = 0;
  const manager = new SignalsManager({
    authService: authenticated,
    store: makeStore(),
    fetchImpl: async () => { calls += 1; return { ok: true }; },
  });
  assert.equal(await manager.record('inventada'), false);
  assert.equal(calls, 0, 'no deberia salir una llamada por una señal que la base rechazaria');
});

test('the same signal only travels once, even across restarts', async () => {
  const store = makeStore();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true }; };

  const first = new SignalsManager({ authService: authenticated, store, fetchImpl });
  assert.equal(await first.record('terminal-abierta'), true);
  assert.equal(await first.record('terminal-abierta'), false);
  assert.equal(calls, 1);

  // Un arranque nuevo lee lo ya reportado del almacen.
  const second = new SignalsManager({ authService: authenticated, store, fetchImpl });
  assert.equal(await second.record('terminal-abierta'), false);
  assert.equal(calls, 1, 'reabrir la aplicacion no deberia volver a reportar');
});

test('without a session nothing is sent and nothing breaks', async () => {
  let calls = 0;
  const manager = new SignalsManager({
    authService: anonymous,
    store: makeStore(),
    fetchImpl: async () => { calls += 1; return { ok: true }; },
  });
  assert.equal(await manager.record('terminal-abierta'), false);
  assert.equal(calls, 0);
});

test('a network failure never reaches the caller', async () => {
  const manager = new SignalsManager({
    authService: authenticated,
    store: makeStore(),
    fetchImpl: async () => { throw new Error('sin red'); },
  });
  assert.equal(await manager.record('terminal-abierta'), false);
});

test('a rejected request is not remembered, so it can be retried later', async () => {
  const store = makeStore();
  let ready = false;
  const fetchImpl = async () => ({ ok: ready });

  const manager = new SignalsManager({ authService: authenticated, store, fetchImpl });
  assert.equal(await manager.record('commit-hecho'), false, 'la tabla todavia no existe');

  ready = true;
  assert.equal(await manager.record('commit-hecho'), true, 'cuando la base responde, se reporta');
});

test('the request carries the signal and nothing else about the person', async () => {
  let seen = null;
  const manager = new SignalsManager({
    authService: authenticated,
    store: makeStore(),
    fetchImpl: async (url, options) => { seen = { url, options }; return { ok: true }; },
  });
  await manager.record('carpeta-creada');

  assert.ok(seen.url.endsWith('/rest/v1/rpc/record_student_signal'));
  assert.equal(seen.options.headers.Authorization, `Bearer ${SESSION.accessToken}`);
  assert.deepEqual(JSON.parse(seen.options.body), { input_signal: 'carpeta-creada' });
  // El cuerpo tiene exactamente una clave: nada de rutas, proyecto ni usuario.
  assert.deepEqual(Object.keys(JSON.parse(seen.options.body)), ['input_signal']);
});

test('signing out forgets what was reported', async () => {
  const store = makeStore();
  const manager = new SignalsManager({ authService: authenticated, store, fetchImpl: ok });
  await manager.record('panel-openai');
  manager.reset();
  assert.deepEqual(store.read().reportedSignals, []);
});

/*
 * El observador envuelve `ipcMain.handle` para reportar sin que los servicios se
 * enteren. Es la pieza con mas riesgo de todo esto -se mete en el camino de
 * cada respuesta-, asi que lo que sigue fija que sea transparente.
 */
function fakeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, listener) => handlers.set(channel, listener),
    invoke: (channel, ...args) => handlers.get(channel)(...args),
    has: (channel) => handlers.has(channel),
  };
}

function recordingManager() {
  const recorded = [];
  return { recorded, record: async (signal) => { recorded.push(signal); return true; } };
}

test('an observed channel returns exactly what its handler returned', async () => {
  const ipcMain = fakeIpcMain();
  const manager = recordingManager();
  observeChannels(ipcMain, manager);

  ipcMain.handle('fs:create-folder', async () => ({ ok: true, created: 'demo' }));
  const result = await ipcMain.invoke('fs:create-folder');

  assert.deepEqual(result, { ok: true, created: 'demo' }, 'la respuesta no puede cambiar');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(manager.recorded, ['carpeta-creada']);
});

test('a channel nobody watches passes through untouched', async () => {
  const ipcMain = fakeIpcMain();
  const manager = recordingManager();
  observeChannels(ipcMain, manager);

  ipcMain.handle('fs:read-dir', async () => ['a', 'b']);
  assert.deepEqual(await ipcMain.invoke('fs:read-dir'), ['a', 'b']);
  assert.deepEqual(manager.recorded, []);
});

test('when the handler fails, the error propagates and nothing is reported', async () => {
  const ipcMain = fakeIpcMain();
  const manager = recordingManager();
  observeChannels(ipcMain, manager);

  ipcMain.handle('fs:git-commit', async () => { throw new Error('sin cambios que confirmar'); });
  await assert.rejects(() => ipcMain.invoke('fs:git-commit'), /sin cambios que confirmar/);
  assert.deepEqual(manager.recorded, [], 'un commit que fallo no es un commit hecho');
});

test('a reporting failure never reaches the caller', async () => {
  const ipcMain = fakeIpcMain();
  const exploding = { record: async () => { throw new Error('reporte roto'); } };
  observeChannels(ipcMain, exploding);

  ipcMain.handle('terminal:create', async () => ({ id: 'term-1' }));
  assert.deepEqual(await ipcMain.invoke('terminal:create'), { id: 'term-1' });
});

test('git status only counts when there really are changes to see', async () => {
  const ipcMain = fakeIpcMain();
  const manager = recordingManager();
  observeChannels(ipcMain, manager);

  let entries = [];
  ipcMain.handle('fs:git-status', async () => ({ success: true, entries }));

  await ipcMain.invoke('fs:git-status');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(manager.recorded, [], 'un proyecto sin cambios no prueba que el alumno los vio');

  entries = [{ path: 'index.html' }];
  await ipcMain.invoke('fs:git-status');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(manager.recorded, ['cambios-vistos']);
});

test('an action that failed is not an action that happened', async () => {
  /*
   * Estos manejadores devuelven `{ success: false }` en vez de lanzar. Sin el
   * filtro, intentar crear una carpeta que ya existe contaria como creada y el
   * alumno veria confirmado un chequeo por algo que no le funciono.
   */
  const ipcMain = fakeIpcMain();
  const manager = recordingManager();
  observeChannels(ipcMain, manager);

  ipcMain.handle('fs:create-folder', async () => ({ success: false, error: 'ya existe' }));
  ipcMain.handle('fs:git-commit', async () => ({ success: false, error: 'falta el mensaje' }));

  await ipcMain.invoke('fs:create-folder');
  await ipcMain.invoke('fs:git-commit');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(manager.recorded, []);
});

test('a search that found nothing is not a search that worked', async () => {
  const ipcMain = fakeIpcMain();
  const manager = recordingManager();
  observeChannels(ipcMain, manager);

  ipcMain.handle('fs:search', async () => ({ success: true, files: [], contentMatches: [] }));
  await ipcMain.invoke('fs:search');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(manager.recorded, [], 'la leccion pregunta si la busqueda encontro la palabra');

  ipcMain.handle('fs:search', async () => ({ success: true, files: [], contentMatches: [{ path: 'a.md' }] }));
  await ipcMain.invoke('fs:search');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(manager.recorded, ['busqueda-usada']);
});

test('every observed channel maps to a signal the database accepts', () => {
  for (const [channel, observed] of Object.entries(OBSERVED_CHANNELS)) {
    assert.ok(
      KNOWN_SIGNALS.includes(observed.signal),
      `${channel} reporta "${observed.signal}", que no esta en el vocabulario`,
    );
  }
});

test('the vocabulary matches exactly what the database accepts', () => {
  /*
   * El otro producto define la tabla. Si las dos listas se separan, una leccion
   * puede pedir una señal que esta aplicacion nunca manda -o al reves-, y en los
   * dos casos el chequeo no se confirma jamas sin que nada falle.
   */
  const migration = path.join(
    __dirname, '..', '..', 'vibe coder web', 'supabase', 'migrations',
    '20260814160000_student_signals.sql',
  );
  if (!fs.existsSync(migration)) {
    // En CI cada repositorio se clona solo; sin el hermano al lado no hay nada que comparar.
    return;
  }

  const sql = fs.readFileSync(migration, 'utf8');
  const block = sql.slice(sql.indexOf('signal in ('), sql.indexOf('first_seen_at'));
  const accepted = [...block.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]).sort();

  assert.deepEqual([...KNOWN_SIGNALS].sort(), accepted);
});
