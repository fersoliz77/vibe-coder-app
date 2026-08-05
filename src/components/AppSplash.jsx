import { useEffect, useState } from 'react';
import './AppSplash.css';

/*
 * Pantalla de arranque del escritorio.
 *
 * Antes se devolvia `null` mientras se leia la bandera de onboarding: la
 * ventana quedaba vacia, sin marca ni progreso. Si el proceso principal no
 * respondia, ese vacio no terminaba nunca y no habia forma de salir.
 *
 * El texto por defecto no usa el diccionario porque el idioma todavia puede
 * no estar resuelto en este punto; se toma del idioma del sistema. Quien ya
 * tenga traducciones disponibles puede pasar su propio `message`.
 */

const SLOW_AFTER_MS = 8000;

const COPY = {
  es: {
    loading: 'Preparando tu espacio de trabajo...',
    slowTitle: 'El espacio de trabajo esta tardando en abrir',
    slowCopy: 'Podes esperar un momento mas o reiniciar la ventana.',
    retry: 'Reiniciar ventana',
  },
  en: {
    loading: 'Preparing your workspace...',
    slowTitle: 'The workspace is taking a while to open',
    slowCopy: 'You can wait a moment longer or reload the window.',
    retry: 'Reload window',
  },
};

export default function AppSplash({ message }) {
  const [isSlow, setIsSlow] = useState(false);
  const lang = typeof navigator !== 'undefined' && navigator.language?.startsWith('en') ? 'en' : 'es';
  const copy = COPY[lang];

  useEffect(() => {
    const timer = setTimeout(() => setIsSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="app-splash" role="status" aria-live="polite" aria-busy={!isSlow}>
      <div className="app-splash__brand">
        <span className="app-splash__mark" aria-hidden="true">V</span>
        <span className="app-splash__name">Vibe IDE Code</span>
      </div>

      {isSlow ? (
        <div className="app-splash__slow">
          <strong>{copy.slowTitle}</strong>
          <p>{copy.slowCopy}</p>
          <button className="btn btn--primary" type="button" onClick={() => window.location.reload()}>
            {copy.retry}
          </button>
        </div>
      ) : (
        <>
          <div className="app-splash__track"><span className="app-splash__bar" /></div>
          <p className="app-splash__hint">{message || copy.loading}</p>
        </>
      )}
    </div>
  );
}
