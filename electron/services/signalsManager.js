/*
 * Señales de actividad del alumno.
 *
 * Una leccion del curso puede declarar que alguno de sus chequeos se confirma
 * solo: "¿abriste la terminal?" tiene respuesta objetiva y esta aplicacion es la
 * unica que la conoce. Aca se reporta ese hecho a la base compartida, y la
 * leccion lo lee cuando el alumno la abre.
 *
 * Por que no se le habla directo a la leccion: la vista de aprendizaje es un
 * navegador aislado a proposito -sesion propia, sandbox, sin script puente-. La
 * base ya es de los dos productos, asi que no hace falta abrir nada nuevo.
 *
 * Que se manda: el nombre de la señal y nada mas. No hay rutas, ni nombres de
 * archivo, ni contenido, ni prompts, ni comandos. Esta aplicacion trabaja sobre
 * el codigo de la persona y nada de eso tiene por que salir de su computadora.
 *
 * Que pasa si falla: nada. Reportar es opcional; trabajar no. Sin sesion, sin
 * red, o con la tabla todavia sin crear, se descarta en silencio y el chequeo
 * queda para tildar a mano, que es como funciono siempre.
 */

/*
 * Vocabulario cerrado. Tiene que coincidir con el `check` de la tabla
 * student_signals: una señal que la base no acepta se rechaza y ese chequeo no
 * se confirma nunca, sin que nadie se entere. Lo verifica
 * tests/signalsManager.test.js contra el SQL del otro producto.
 */
const KNOWN_SIGNALS = Object.freeze([
  'node-instalado',
  'git-instalado',
  'ia-conectada',
  'proyecto-creado',
  'archivo-abierto',
  'carpeta-creada',
  'busqueda-usada',
  'terminal-abierta',
  'cambios-vistos',
  'commit-hecho',
  'ia-conversacion',
  'ia-seguimiento',
  'panel-openai',
  'panel-opencode',
  'configuracion-recorrida',
  'supabase-conectado',
  'vercel-conectado',
  'github-conectado',
  'vista-previa-abierta',
]);

const STORE_KEY = 'reportedSignals';
const REQUEST_TIMEOUT_MS = 6000;

class SignalsManager {
  constructor({ authService, store, fetchImpl = fetch } = {}) {
    this.authService = authService;
    this.store = store;
    this.fetchImpl = fetchImpl;
    /*
     * Lo ya reportado vive en el almacen local, no solo en memoria: sin eso, cada
     * arranque volveria a mandar las mismas señales. La base las descarta por
     * clave repetida, pero hacer una llamada de red para que la ignoren es
     * trabajo tirado y ruido en los registros.
     */
    this.reported = new Set(this.readReported());
  }

  readReported() {
    try {
      const stored = this.store?.get?.(STORE_KEY);
      return Array.isArray(stored) ? stored.filter((value) => typeof value === 'string') : [];
    } catch {
      return [];
    }
  }

  persistReported() {
    try {
      this.store?.set?.(STORE_KEY, [...this.reported]);
    } catch {
      /* Si el almacen no acepta la escritura, se reintentara en el proximo arranque. */
    }
  }

  /**
   * Reporta que el alumno hizo algo, una sola vez.
   *
   * Devuelve si se registro recien. No lanza nunca: quien llama esta en medio de
   * abrir una terminal o guardar un archivo, y eso no puede fallar por una
   * metrica.
   */
  async record(signal) {
    if (!KNOWN_SIGNALS.includes(signal)) return false;
    if (this.reported.has(signal)) return false;

    const session = this.authService?.getRealtimeSession?.();
    if (!session?.accessToken) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timer.unref?.();

    try {
      const response = await this.fetchImpl(`${session.supabaseUrl}/rest/v1/rpc/record_student_signal`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          apikey: session.anonKey,
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input_signal: signal }),
      });
      if (!response.ok) return false;
      this.reported.add(signal);
      this.persistReported();
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Al cerrar sesion se olvida lo reportado: la proxima cuenta empieza limpia. */
  reset() {
    this.reported.clear();
    this.persistReported();
  }
}

function setupSignalsHandlers(ipcMain, manager) {
  ipcMain.handle('signals:record', async (_event, signal) => {
    await manager.record(signal);
    // Siempre se responde bien: el renderer no tiene nada que hacer con un fallo
    // de reporte, y devolverle un error solo lo tentaria a mostrarlo.
    return { ok: true };
  });
}

/*
 * Estos manejadores no lanzan cuando algo sale mal: devuelven
 * `{ success: false, error }`. Sin este filtro, intentar crear una carpeta que
 * ya existe contaria como carpeta creada, y el alumno veria un chequeo
 * confirmado por algo que no le funciono.
 */
const succeeded = (result) => result?.success !== false;

/*
 * Acciones que ya pasan por el proceso principal y que una leccion puede querer
 * confirmar. `when` se ajusta cuando el hecho no es la llamada sino su
 * resultado: pedir el estado de Git no prueba nada, ver que hay cambios si.
 */
const OBSERVED_CHANNELS = Object.freeze({
  'fs:create-folder': { signal: 'carpeta-creada', when: succeeded },
  'fs:read-file': { signal: 'archivo-abierto', when: succeeded },
  'fs:git-commit': { signal: 'commit-hecho', when: succeeded },
  'terminal:create': { signal: 'terminal-abierta', when: succeeded },
  'projects:provision': { signal: 'proyecto-creado', when: succeeded },

  // La leccion pregunta si la busqueda ENCONTRO la palabra, no si se busco.
  'fs:search': {
    signal: 'busqueda-usada',
    when: (result) => succeeded(result)
      && ((result?.contentMatches?.length ?? 0) > 0 || (result?.files?.length ?? 0) > 0),
  },

  // Idem: el chequeo es haber visto un archivo modificado, no abrir el panel.
  'fs:git-status': {
    signal: 'cambios-vistos',
    when: (result) => succeeded(result) && (result?.entries?.length ?? 0) > 0,
  },
});

/**
 * Observa los canales de arriba sin tocar quien los implementa.
 *
 * Se instala ANTES de que los servicios registren sus manejadores: envuelve
 * `ipcMain.handle` una sola vez, en un lugar, en vez de repartir llamadas de
 * reporte por ocho archivos que despues alguien olvida actualizar.
 *
 * Tres reglas para que esto no pueda romper nada:
 *  - El resultado del manejador original se devuelve tal cual, siempre.
 *  - Un error del manejador se propaga sin tocar, y no se reporta nada.
 *  - El reporte se dispara sin esperarlo y con su propio catch: nada de lo que
 *    pase aca puede demorar ni ensuciar la respuesta que espera el renderer.
 */
function observeChannels(ipcMain, manager, channels = OBSERVED_CHANNELS) {
  const original = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    const observed = channels[channel];
    if (!observed) return original(channel, listener);

    return original(channel, async (...args) => {
      const result = await listener(...args);
      try {
        if (!observed.when || observed.when(result)) {
          Promise.resolve(manager.record(observed.signal)).catch(() => {});
        }
      } catch {
        /* Observar jamas puede alterar lo que se responde. */
      }
      return result;
    });
  };
  return () => { ipcMain.handle = original; };
}

module.exports = { KNOWN_SIGNALS, OBSERVED_CHANNELS, SignalsManager, observeChannels, setupSignalsHandlers };
