import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';

const COPY = {
  en: { loadingTitle: 'Opening Courses and Progress', loadingCopy: 'Preparing your secure learning session...', errorTitle: 'Courses and Progress needs attention', errorCopy: 'The learning platform could not be opened. Check your connection and try again.', retry: 'Try again' },
  es: { loadingTitle: 'Abriendo Cursos y progreso', loadingCopy: 'Preparando tu sesión segura de aprendizaje...', errorTitle: 'Cursos y progreso necesita atención', errorCopy: 'No se pudo abrir la plataforma de aprendizaje. Revisá tu conexión e intentá nuevamente.', retry: 'Intentar nuevamente' },
};

export default function LearningStatus() {
  const { language } = useI18n();
  const copy = COPY[language] || COPY.en;
  const [state, setState] = useState({ status: 'loading', error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const learning = window.electronAPI?.auth;
    let active = true;
    setState({ status: 'loading', error: null });
    const unsubscribe = learning?.onLearningStateChanged?.((next) => {
      if (active) setState(next);
    });
    learning?.openLearning?.().then((result) => {
      if (active && !result?.ok && !result?.cancelled) setState({ status: 'error', error: result?.error });
    }).catch(() => {
      if (active) setState({ status: 'error', error: null });
    });
    return () => {
      active = false;
      unsubscribe?.();
      learning?.closeLearning?.().catch(() => {});
    };
  }, [attempt]);

  const failed = state.status === 'error';
  return (
    <div className={`learning-placeholder${failed ? ' learning-placeholder--error' : ''}`} role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'}>
      <strong>{failed ? copy.errorTitle : copy.loadingTitle}</strong>
      {failed ? (
        <>
          <p>{copy.errorCopy}</p>
          <button className="btn btn--primary" type="button" onClick={() => setAttempt((current) => current + 1)}>{copy.retry}</button>
        </>
      ) : <p>{copy.loadingCopy}</p>}
    </div>
  );
}
