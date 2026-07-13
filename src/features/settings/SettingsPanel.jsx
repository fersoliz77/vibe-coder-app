import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import SetupCenter from '../setup/SetupCenter';
import './SettingsPanel.css';

const ACCESSIBILITY_KEY = 'vibe-accessibility';

function readAccessibility() {
  try {
    return { highContrast: false, reducedMotion: false, ...JSON.parse(localStorage.getItem(ACCESSIBILITY_KEY) || '{}') };
  } catch {
    return { highContrast: false, reducedMotion: false };
  }
}

function ProviderStatus({ name, detail, connected, loading }) {
  return (
    <div className="settings-provider">
      <span className={`status-dot ${loading ? 'status-dot--checking' : connected ? 'status-dot--connected' : 'status-dot--disconnected'}`} />
      <div>
        <strong>{name}</strong>
        <span>{loading ? 'Comprobando...' : detail}</span>
      </div>
    </div>
  );
}

export default function SettingsPanel({ theme, onSetTheme }) {
  const { state, revalidate, logout } = useAuth();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [accessibility, setAccessibility] = useState(readAccessibility);
  const [providers, setProviders] = useState({ loading: true, claude: null, openai: null, error: '' });

  const refreshProviders = async () => {
    setProviders((current) => ({ ...current, loading: true, error: '' }));
    try {
      const [claude, openai] = await Promise.all([
        window.electronAPI.claude.getStatus(),
        window.electronAPI.openai.getStatus(),
      ]);
      setProviders({ loading: false, claude, openai, error: '' });
    } catch {
      setProviders({ loading: false, claude: null, openai: null, error: 'Estado no disponible con el acceso actual.' });
    }
  };

  useEffect(() => {
    refreshProviders();
  }, []);

  useEffect(() => {
    localStorage.setItem(ACCESSIBILITY_KEY, JSON.stringify(accessibility));
    document.body.classList.toggle('high-contrast', accessibility.highContrast);
    document.body.classList.toggle('reduced-motion', accessibility.reducedMotion);
  }, [accessibility]);

  const runAccountAction = async (action) => {
    setBusy(action);
    setMessage('');
    try {
      await (action === 'revalidate' ? revalidate() : logout());
      if (action === 'revalidate') setMessage('Acceso revalidado correctamente.');
    } catch (error) {
      setMessage(error?.message || 'No se pudo completar la acción.');
    } finally {
      setBusy('');
    }
  };

  const membership = state.membership || {};
  const lease = state.leaseExpiresAt ? new Date(state.leaseExpiresAt) : null;

  return (
    <div className="settings-panel">
      <header className="settings-header">
        <div><p className="settings-eyebrow">Preferencias</p><h1>Settings</h1></div>
        <p>Cuenta, experiencia local y proveedores de IA.</p>
      </header>

      <div className="settings-grid">
        <section className="settings-card settings-card--wide">
          <div className="settings-card__heading"><div><span>Identidad</span><h2>Cuenta y acceso escolar</h2></div><span className={`settings-pill settings-pill--${state.policy}`}>{state.policy}</span></div>
          <dl className="settings-details">
            <div><dt>Email</dt><dd>{state.user?.email || 'No disponible'}</dd></div>
            <div><dt>Escuela</dt><dd>{membership.schoolName || membership.schoolId || 'No asignada'}</dd></div>
            <div><dt>Membresía</dt><dd>{membership.status || 'Sin estado'}</dd></div>
            <div><dt>Plan</dt><dd>{membership.planName || 'Sin plan asignado'}</dd></div>
            <div><dt>Progreso</dt><dd>{membership.completedLessons || 0}/{membership.totalLessons || 0} lecciones · {Math.round(membership.progressPercentage || 0)}%</dd></div>
            <div><dt>Lease offline</dt><dd>{lease ? lease.toLocaleString() : 'No disponible'}</dd></div>
          </dl>
          <div className="settings-actions">
            <button className="btn btn--primary" type="button" disabled={Boolean(busy)} onClick={() => runAccountAction('revalidate')}>{busy === 'revalidate' ? 'Revalidando...' : 'Revalidar acceso'}</button>
            <button className="btn btn--danger" type="button" disabled={Boolean(busy)} onClick={() => runAccountAction('logout')}>{busy === 'logout' ? 'Cerrando...' : 'Cerrar sesión'}</button>
            {message && <span className="settings-message" role="status">{message}</span>}
          </div>
        </section>

        <section className="settings-card settings-card--wide settings-card--setup">
          <SetupCenter compact />
        </section>

        <section className="settings-card">
          <div className="settings-card__heading"><div><span>Interfaz</span><h2>Apariencia</h2></div></div>
          <p className="settings-copy">Usa el tema existente en todo el workspace.</p>
          <div className="settings-segmented" aria-label="Tema visual">
            {['dark', 'light'].map((option) => <button type="button" key={option} className={theme === option ? 'is-active' : ''} aria-pressed={theme === option} onClick={() => onSetTheme(option)}>{option === 'dark' ? 'Oscuro' : 'Claro'}</button>)}
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card__heading"><div><span>Local</span><h2>Accesibilidad</h2></div></div>
          <p className="settings-copy">Estas preferencias se guardan únicamente en este dispositivo.</p>
          <label className="settings-toggle"><span><strong>Alto contraste</strong><small>Refuerza texto y bordes.</small></span><input type="checkbox" checked={accessibility.highContrast} onChange={(event) => setAccessibility((value) => ({ ...value, highContrast: event.target.checked }))} /></label>
          <label className="settings-toggle"><span><strong>Reducir movimiento</strong><small>Desactiva animaciones y transiciones.</small></span><input type="checkbox" checked={accessibility.reducedMotion} onChange={(event) => setAccessibility((value) => ({ ...value, reducedMotion: event.target.checked }))} /></label>
        </section>

        <section className="settings-card settings-card--wide">
          <div className="settings-card__heading"><div><span>BYOAI</span><h2>Tus modelos, tus cuentas</h2></div><button className="btn btn--small" type="button" disabled={providers.loading} onClick={refreshProviders}>Actualizar estados</button></div>
          <p className="settings-copy">Vibe IDE Code se conecta a las instalaciones locales de Claude Code y OpenAI Codex. La autenticación, el modelo elegido, los costos y los límites pertenecen a tu cuenta con cada proveedor. Vibe IDE Code no solicita ni almacena tokens.</p>
          <div className="settings-providers">
            <ProviderStatus name="Claude Code" loading={providers.loading} connected={providers.claude?.authenticated} detail={!providers.claude?.installed ? 'CLI no instalada' : providers.claude?.authenticated ? `Conectado${providers.claude.version ? ` · ${providers.claude.version}` : ''}` : 'Instalado, sin autenticar'} />
            <ProviderStatus name="OpenAI · Codex" loading={providers.loading} connected={providers.openai?.authenticated} detail={providers.openai?.authenticated ? `Conectado · ${providers.openai.email || 'cuenta OpenAI'}` : 'No conectado'} />
          </div>
          {providers.error && <p className="settings-provider-error" role="status">{providers.error}</p>}
        </section>
      </div>
    </div>
  );
}
