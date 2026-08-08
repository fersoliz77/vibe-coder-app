/*
 * Un solo contrato para "que esta pasando".
 *
 * Cada pantalla inventaba el suyo: una usaba `loading` con `null` cuando
 * fallaba, otra dejaba la lista vacia, otra escribia el error en la consola.
 * El resultado era que dos situaciones distintas —"todavia no cargo" y "cargo y
 * no hay nada"— se veian iguales, y una tercera, "fallo", no se veia nunca.
 *
 * Los seis estados son los que aparecen de verdad en el producto. `partial`
 * existe porque las operaciones largas (crear un proyecto, instalar agentes)
 * pueden terminar a medias: eso no es exito ni error.
 */

export const ASYNC_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  EMPTY: 'empty',
  ERROR: 'error',
  PARTIAL: 'partial',
});

export const idle = () => ({ state: ASYNC_STATES.IDLE, data: null, error: '' });
export const loading = (data = null) => ({ state: ASYNC_STATES.LOADING, data, error: '' });
export const failed = (error) => ({ state: ASYNC_STATES.ERROR, data: null, error: normalizeError(error) });
export const partial = (data, error) => ({ state: ASYNC_STATES.PARTIAL, data, error: normalizeError(error) });

/**
 * Exito. Una coleccion vacia es `empty`, no `success`: son dos pantallas
 * distintas y confundirlas es lo que hacia que un fallo pareciera un vacio.
 */
export function loaded(data) {
  const isEmptyCollection = Array.isArray(data) && data.length === 0;
  return { state: isEmptyCollection ? ASYNC_STATES.EMPTY : ASYNC_STATES.SUCCESS, data, error: '' };
}

/** El texto de un error, venga como Error, como string o como nada. */
export function normalizeError(error, fallback = '') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || fallback;
}

/**
 * Corre una promesa y devuelve el estado resultante, sin try/catch repetido en
 * cada pantalla. Nunca lanza: un fallo es un estado, no una excepcion suelta.
 */
export async function runAsync(work, { fallbackError = '' } = {}) {
  try {
    return loaded(await work());
  } catch (error) {
    return failed(normalizeError(error, fallbackError));
  }
}

export const isBusy = (result) => result?.state === ASYNC_STATES.LOADING;
export const hasError = (result) => result?.state === ASYNC_STATES.ERROR || result?.state === ASYNC_STATES.PARTIAL;
export const isEmpty = (result) => result?.state === ASYNC_STATES.EMPTY;
