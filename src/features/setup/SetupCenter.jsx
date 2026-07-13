import { useEffect, useRef, useState } from 'react';
import './SetupCenter.css';

const BACKENDS = [
  { value: 'firebase', label: 'Firebase' },
  { value: 'supabase', label: 'Supabase' },
];

function StatusIcon({ installed, checking }) {
  if (checking) return <span className="setup-center__spinner" aria-hidden="true" />;
  return (
    <span className={`setup-center__status-icon ${installed ? 'is-ready' : 'is-missing'}`} aria-hidden="true">
      {installed ? '✓' : '!'}
    </span>
  );
}

function EnvironmentItem({ item, checking }) {
  return (
    <article className={`setup-center__item ${item?.installed ? 'is-ready' : 'is-missing'}`}>
      <StatusIcon installed={item?.installed} checking={checking} />
      <div className="setup-center__item-copy">
        <div className="setup-center__item-title">
          <strong>{item?.name || 'Componente'}</strong>
          <span className={`setup-center__requirement ${item?.required ? 'is-required' : ''}`}>
            {item?.required ? 'Requerido' : 'Opcional'}
          </span>
        </div>
        <p>{checking ? 'Comprobando...' : item?.installed ? item.version || 'Instalado' : item?.instruction || 'No instalado'}</p>
        {item?.path && <code title={item.path}>{item.path}</code>}
      </div>
    </article>
  );
}

export default function SetupCenter({ compact = false, initialMobile = false, initialBackend = 'firebase' }) {
  const checkSequence = useRef(0);
  const [includeMobile, setIncludeMobile] = useState(initialMobile);
  const [backend, setBackend] = useState(initialBackend);
  const [environment, setEnvironment] = useState(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const [log, setLog] = useState([]);
  const [openCode, setOpenCode] = useState({ loading: true, installing: false, status: null, error: '', progress: '' });

  const api = typeof window !== 'undefined' ? window.electronAPI?.setup : null;
  const options = { includeMobile, backend };

  const check = async () => {
    const sequence = ++checkSequence.current;
    if (!api?.check) {
      setChecking(false);
      setError('La API de configuración no está disponible en esta ejecución.');
      return;
    }
    setChecking(true);
    setError('');
    try {
      const result = await api.check(options);
      if (sequence !== checkSequence.current) return;
      setEnvironment(result);
      if (!result.supported) setError(result.error || 'Plataforma no compatible.');
    } catch (checkError) {
      if (sequence !== checkSequence.current) return;
      setError(checkError?.message || 'No se pudo comprobar el entorno.');
    } finally {
      if (sequence === checkSequence.current) setChecking(false);
    }
  };

  useEffect(() => {
    check();
  }, [includeMobile, backend]);

  const checkOpenCode = async () => {
    if (!window.electronAPI?.opencode?.getStatus) {
      setOpenCode({ loading: false, installing: false, status: null, error: 'OpenCode no está disponible en esta ejecución.', progress: '' });
      return;
    }
    setOpenCode((current) => ({ ...current, loading: true, error: '', progress: '' }));
    try {
      const status = await window.electronAPI.opencode.getStatus();
      setOpenCode({ loading: false, installing: false, status, error: '', progress: '' });
    } catch (error) {
      setOpenCode({ loading: false, installing: false, status: null, error: error?.message || 'No se pudo comprobar OpenCode.', progress: '' });
    }
  };

  useEffect(() => {
    checkOpenCode();
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.opencode?.onInstallProgress) return undefined;
    return window.electronAPI.opencode.onInstallProgress((event) => {
      setOpenCode((current) => current.installing
        ? { ...current, progress: event?.message || current.progress }
        : current);
    });
  }, []);

  useEffect(() => {
    if (!api?.onProgress) return undefined;
    return api.onProgress((event) => {
      setProgress(event);
      if (event?.message) setLog((current) => [...current.slice(-7), event.message]);
    });
  }, [api]);

  const install = async () => {
    setConfirming(false);
    setInstalling(true);
    setError('');
    setLog([]);
    try {
      const result = await api.install(options);
      if (!result.success && !result.cancelled) setError(result.error || 'Algunos componentes no pudieron instalarse. Revisa el progreso.');
      if (result.environment) setEnvironment(result.environment);
      else await check();
    } catch (installError) {
      setError(installError?.message || 'No se pudo instalar el entorno.');
    } finally {
      setInstalling(false);
    }
  };

  const cancel = async () => {
    try { await api?.cancel?.(); } catch {}
  };

  const installOpenCode = async () => {
    if (!window.electronAPI?.opencode?.install) return;
    setOpenCode((current) => ({ ...current, installing: true, error: '', progress: 'Comprobando instalación de OpenCode…' }));
    try {
      const result = await window.electronAPI.opencode.install();
      if (!result?.success && !result?.cancelled) throw new Error(result?.error || 'No se pudo instalar OpenCode.');
      if (result?.status) {
        setOpenCode({ loading: false, installing: false, status: result.status, error: '', progress: '' });
      } else {
        await checkOpenCode();
      }
    } catch (error) {
      setOpenCode((current) => ({ ...current, installing: false, error: error?.message || 'No se pudo instalar OpenCode.', progress: '' }));
    }
  };

  const items = environment?.items || [];
  const required = items.filter((item) => item.required);
  const optional = items.filter((item) => !item.required);
  const percentage = progress?.total ? Math.round((Math.max(0, progress.current - (progress.type === 'step-start' ? 1 : 0)) / progress.total) * 100) : 0;

  return (
    <section className={`setup-center ${compact ? 'setup-center--compact' : ''}`} aria-labelledby="setup-center-title">
      <header className="setup-center__header">
        <div>
          <span className="setup-center__eyebrow">Entorno local</span>
          <h2 id="setup-center-title">Centro de configuración</h2>
          <p>Prepara las herramientas de desarrollo con una instalación controlada para Windows.</p>
        </div>
        <div className="setup-center__score" aria-label={`${environment?.summary?.installed || 0} componentes listos`}>
          <strong>{environment?.summary?.installed || 0}</strong>
          <span>de {items.length || '—'} listos</span>
        </div>
      </header>

      <div className="setup-center__controls">
        <label>
          <span>Backend</span>
          <select value={backend} disabled={installing} onChange={(event) => setBackend(event.target.value)}>
            {BACKENDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="setup-center__mobile-toggle">
          <input type="checkbox" checked={includeMobile} disabled={installing} onChange={(event) => setIncludeMobile(event.target.checked)} />
          <span><strong>Desarrollo móvil</strong><small>Flutter, JDK 17 y Android SDK</small></span>
        </label>
        <button className="setup-center__button is-secondary" type="button" disabled={checking || installing} onClick={check}>
          {checking ? 'Comprobando...' : 'Volver a comprobar'}
        </button>
      </div>

      {error && <div className="setup-center__notice is-error" role="alert">{error}</div>}

      <div className="setup-center__groups" aria-busy={checking}>
        <div className="setup-center__group">
          <div className="setup-center__group-heading"><h3>Requeridos</h3><span>{required.filter((item) => item.installed).length}/{required.length}</span></div>
          <div className="setup-center__items">
            {required.map((item) => <EnvironmentItem key={item.id} item={item} checking={checking} />)}
            {!required.length && checking && <EnvironmentItem checking />}
          </div>
        </div>
        {optional.length > 0 && (
          <div className="setup-center__group">
            <div className="setup-center__group-heading"><h3>Opcionales</h3><span>{optional.filter((item) => item.installed).length}/{optional.length}</span></div>
            <div className="setup-center__items">{optional.map((item) => <EnvironmentItem key={item.id} item={item} checking={checking} />)}</div>
          </div>
        )}
      </div>

      <section className="setup-center__agent-card" aria-labelledby="setup-opencode-title">
        <div className="setup-center__agent-copy">
          <span className="setup-center__eyebrow">Agente priorizado</span>
          <h3 id="setup-opencode-title">OpenCode</h3>
          <p>Debe quedar operativo desde el primer inicio. Se descarga solo si falta y no instala Claude Code ni Codex.</p>
        </div>
        <div className="setup-center__agent-status">
          <strong>{openCode.loading ? 'Comprobando…' : openCode.status?.usable ? `Listo · ${openCode.status.version || 'instalado'}` : openCode.status?.installed ? 'Instalación detectada · requiere reparación' : 'No instalado'}</strong>
          <span>{openCode.loading ? 'Verificando el ejecutable oficial.' : openCode.status?.authenticated ? `Proveedores: ${openCode.status.providers.join(', ')}` : 'Conecta proveedores dentro de OpenCode con /connect.'}</span>
          {openCode.progress && <small>{openCode.progress}</small>}
          {openCode.error && <small className="setup-center__agent-error">{openCode.error}</small>}
        </div>
        <div className="setup-center__agent-actions">
          <button className="setup-center__button is-secondary" type="button" disabled={openCode.loading || openCode.installing} onClick={checkOpenCode}>Revisar</button>
          <button className="setup-center__button is-primary" type="button" disabled={openCode.loading || openCode.installing} onClick={installOpenCode}>{openCode.installing ? 'Instalando…' : openCode.status?.usable ? 'Reinstalar' : 'Instalar OpenCode'}</button>
        </div>
      </section>

      {installing && (
        <div className="setup-center__progress" role="status" aria-live="polite">
          <div className="setup-center__progress-copy"><strong>{progress?.label || 'Preparando instalación'}</strong><span>{progress?.message || 'Comprobando requisitos...'}</span></div>
          <div className="setup-center__progress-track"><span style={{ width: `${percentage}%` }} /></div>
          {log.length > 0 && <div className="setup-center__log">{log.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}</div>}
        </div>
      )}

      <footer className="setup-center__footer">
        <div>
          <strong>{environment?.summary?.requiredMissing ? `${environment.summary.requiredMissing} requisitos pendientes` : 'Requisitos principales listos'}</strong>
          <span>Vercel siempre se incluye. Las instalaciones se ejecutan una por una y se pueden cancelar.</span>
        </div>
        {installing ? (
          <button className="setup-center__button is-danger" type="button" onClick={cancel}>Cancelar</button>
        ) : (
          <button className="setup-center__button is-primary" type="button" disabled={checking || !api?.install || environment?.supported === false} onClick={() => setConfirming(true)}>Instalar todo</button>
        )}
      </footer>

      {confirming && (
        <div className="setup-center__dialog-backdrop" role="presentation" onMouseDown={() => setConfirming(false)}>
          <div className="setup-center__dialog" role="dialog" aria-modal="true" aria-labelledby="setup-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="setup-center__dialog-mark" aria-hidden="true">→</span>
            <h3 id="setup-confirm-title">Confirmar instalación conjunta</h3>
            <p>Se instalarán secuencialmente todos los componentes seleccionados que falten. Windows puede solicitar permisos de administrador.</p>
            <div className="setup-center__dialog-summary"><span>Backend: <strong>{BACKENDS.find((entry) => entry.value === backend)?.label}</strong></span><span>Móvil: <strong>{includeMobile ? 'Incluido' : 'No incluido'}</strong></span></div>
            <div className="setup-center__dialog-actions">
              <button className="setup-center__button is-secondary" type="button" onClick={() => setConfirming(false)}>Volver</button>
              <button className="setup-center__button is-primary" type="button" onClick={install}>Confirmar e instalar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
