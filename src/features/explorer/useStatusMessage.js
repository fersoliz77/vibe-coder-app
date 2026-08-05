import { useCallback, useState } from 'react';

/*
 * Mensaje de resultado del explorador, con su severidad.
 *
 * Antes era un string suelto: confirmaciones y errores se anunciaban igual,
 * esperando a que el lector de pantalla terminara lo que estuviera diciendo.
 * Un "no se pudo mover" que llega despues de otras tres frases llega tarde.
 *
 * El tono decide como se anuncia: `error` interrumpe, el resto espera.
 */

/** @typedef {'info'|'error'} StatusTone */

export function useStatusMessage() {
  const [status, setStatus] = useState({ text: '', tone: 'info' });

  /**
   * @param {string} text mensaje a mostrar; vacio lo limpia
   * @param {StatusTone} [tone] severidad
   */
  const setStatusMessage = useCallback((text, tone = 'info') => {
    setStatus({ text: text ?? '', tone });
  }, []);

  return {
    statusMessage: status.text,
    statusTone: status.tone,
    setStatusMessage,
  };
}
