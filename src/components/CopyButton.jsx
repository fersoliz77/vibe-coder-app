import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';

/*
 * Copiar la respuesta de un agente.
 *
 * Los paneles de IA mostraban el texto y nada mas: para llevarse una respuesta
 * al editor habia que seleccionarla a mano dentro de un <pre> con scroll. Es la
 * accion mas repetida de todo el chat y no existia.
 */
export default function CopyButton({ value, label, className = '' }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(0);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value ?? '');
      setCopied(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin portapapeles el texto sigue en pantalla y se puede seleccionar.
    }
  };

  return (
    <button
      type="button"
      className={`copy-button${copied ? ' is-copied' : ''}${className ? ` ${className}` : ''}`}
      onClick={copy}
      aria-label={label || t('ai.copyMessage')}
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
      <span>{copied ? t('ai.copied') : t('ai.copy')}</span>
    </button>
  );
}
