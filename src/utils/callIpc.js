/*
 * Toda llamada al proceso principal puede fallar: el canal se cae, el handler
 * tira, la ventana se recarga a mitad de camino. Cuando eso pasaba, el `await`
 * rechazaba y la linea que apagaba el estado de carga nunca se ejecutaba: el
 * panel quedaba girando para siempre o mostrando un vacio que parecia normal.
 *
 * `callIpc` convierte cualquier fallo en un resultado que siempre se puede
 * mostrar, para que ninguna superficie quede colgada sin explicacion.
 */

/** Extrae un mensaje legible del ruido que Electron agrega a los errores de IPC. */
export function normalizeIpcError(error) {
  if (!error) return 'Error desconocido';
  const raw = typeof error === 'string' ? error : (error.message || String(error));
  // Electron antepone "Error invoking remote method 'canal': Error: ..."
  const unwrapped = raw.replace(/^Error invoking remote method '[^']*':\s*/, '');
  return unwrapped.replace(/^(?:Error|UnhandledError):\s*/, '').trim() || 'Error desconocido';
}

/**
 * Ejecuta una llamada IPC sin dejar que un rechazo escape.
 *
 * @param {Function} fn funcion de window.electronAPI a invocar
 * @param {...unknown} args argumentos de esa funcion
 * @returns {Promise<{ok: boolean, data: unknown, error: string}>}
 */
export async function callIpc(fn, ...args) {
  if (typeof fn !== 'function') {
    return { ok: false, data: null, error: 'La accion no esta disponible en esta ejecucion.' };
  }
  try {
    const data = await fn(...args);
    // Un handler puede responder con { success: false, error } en vez de tirar.
    if (data && typeof data === 'object' && data.success === false && data.error) {
      return { ok: false, data, error: normalizeIpcError(data.error) };
    }
    return { ok: true, data: data ?? null, error: '' };
  } catch (error) {
    return { ok: false, data: null, error: normalizeIpcError(error) };
  }
}
