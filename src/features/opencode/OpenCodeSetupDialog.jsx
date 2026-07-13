import { useEffect, useRef } from 'react';
import './OpenCodeSetupDialog.css';

export default function OpenCodeSetupDialog({ state, onClose, onInstall }) {
  const installButtonRef = useRef(null);

  useEffect(() => {
    installButtonRef.current?.focus();
  }, [state.phase]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && state.phase !== 'installing') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [state.phase, onClose]);

  const checking = state.phase === 'checking';
  const installing = state.phase === 'installing';

  return (
    <div className="opencode-setup__backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !installing) onClose(); }}>
      <section className="opencode-setup" role="dialog" aria-modal="true" aria-labelledby="opencode-setup-title">
        <button className="opencode-setup__close" type="button" onClick={onClose} disabled={installing} aria-label="Cerrar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
        <div className="opencode-setup__mark" aria-hidden="true"><span>O</span><i>/</i></div>
        <p className="opencode-setup__eyebrow">Agente opcional</p>
        <h2 id="opencode-setup-title">Agregar OpenCode</h2>
        <p className="opencode-setup__copy">
          OpenCode se ejecuta dentro de la terminal del proyecto y administra sus propios proveedores. Esta instalación no descarga Claude Code ni Codex.
        </p>

        <div className="opencode-setup__package">
          <div><span>Paquete oficial auditado</span><strong>opencode-ai · 1.17.18</strong></div>
          <code>npm install -g opencode-ai@1.17.18</code>
        </div>

        {checking && <div className="opencode-setup__status" role="status"><span className="opencode-setup__spinner" />Comprobando instalación…</div>}
        {installing && <div className="opencode-setup__status" role="status"><span className="opencode-setup__spinner" />{state.progress || 'Instalando únicamente OpenCode…'}</div>}
        {state.error && <div className="opencode-setup__error" role="alert">{state.error}</div>}

        {!checking && !installing && <p className="opencode-setup__notice">La confirmación final se mostrará en un diálogo seguro de Windows. Los modelos y credenciales se conectan después desde <code>/connect</code>.</p>}

        <footer>
          <button type="button" className="btn" onClick={onClose} disabled={installing}>Cancelar</button>
          <button ref={installButtonRef} type="button" className="btn btn--primary" onClick={onInstall} disabled={checking || installing}>
            {installing ? 'Instalando…' : 'Instalar y abrir'}
          </button>
        </footer>
      </section>
    </div>
  );
}
