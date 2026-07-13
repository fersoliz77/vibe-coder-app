import { useEffect, useState } from 'react';
import { AuthProvider } from './AuthContext';
import './AuthGate.css';

function AuthTitlebar() {
  return (
    <div className="titlebar">
      <div className="titlebar__brand"><div className="titlebar__logo">V</div><span className="titlebar__name">Vibe IDE Code</span></div>
      <div className="titlebar__controls">
        <button className="titlebar__btn" type="button" onClick={() => window.electronAPI.window.minimize()} title="Minimize"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 8h10v1H3z" /></svg></button>
        <button className="titlebar__btn" type="button" onClick={() => window.electronAPI.window.maximize()} title="Maximize"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3v10h10V3H3zm9 9H4V4h8v8z" /></svg></button>
        <button className="titlebar__btn titlebar__btn--close" type="button" onClick={() => window.electronAPI.window.close()} title="Close"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 7.293l3.646-3.647.708.708L8.707 8l3.647 3.646-.708.708L8 8.707l-3.646 3.647-.708-.708L7.293 8 3.646 4.354l.708-.708L8 7.293z" /></svg></button>
      </div>
    </div>
  );
}

function AccessibilityControls() {
  const [highContrast, setHighContrast] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const toggle = (className, value, setter) => {
    document.body.classList.toggle(className, !value);
    setter(!value);
  };

  return (
    <div className="auth-accessibility" aria-label="Accessibility options">
      <button type="button" onClick={() => toggle('high-contrast', highContrast, setHighContrast)} aria-pressed={highContrast}>
        High contrast
      </button>
      <button type="button" onClick={() => toggle('reduced-motion', reducedMotion, setReducedMotion)} aria-pressed={reducedMotion}>
        Reduce motion
      </button>
    </div>
  );
}

function AuthActions({ state, onState, busy, setBusy }) {
  const run = async (action) => {
    setBusy(action);
    try {
      const result = await window.electronAPI.auth[action]();
      onState(result.state || result);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="auth-actions">
        <button type="button" className="auth-button auth-button--primary" onClick={() => run('revalidate')} disabled={Boolean(busy)}>
          {busy === 'revalidate' ? 'Checking...' : 'Revalidate access'}
        </button>
        <button type="button" className="auth-button" onClick={() => run('logout')} disabled={Boolean(busy)}>Log out</button>
        <button type="button" className="auth-button" onClick={() => window.electronAPI.auth.openHelp()}>Help</button>
      </div>
      {state.error && <p className="auth-error" role="alert">{state.error.message}</p>}
      <AccessibilityControls />
    </>
  );
}

function Login({ state, onState }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(state.error);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    const result = await window.electronAPI.auth.login(email.trim(), password);
    setBusy(false);
    setError(result.error || null);
    onState(result.state);
  };

  return (
    <div className="auth-page">
      <AuthTitlebar />
      <div className="auth-page__glow" />
      <main className="auth-card" aria-labelledby="login-title">
        <div className="auth-mark">V</div>
        <p className="auth-eyebrow">Vibe IDE Code</p>
        <h1 id="login-title">School access</h1>
        <p className="auth-copy">Sign in with the account assigned by your school.</p>
        <form onSubmit={submit}>
          <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="auth-error" role="alert"><strong>{error.code}</strong><br />{error.message}</p>}
          <button className="auth-button auth-button--primary auth-button--wide" disabled={busy || !state.configurationReady} type="submit">
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <button type="button" className="auth-help" onClick={() => window.electronAPI.auth.openHelp()}>Need help?</button>
        <AccessibilityControls />
      </main>
    </div>
  );
}

function Denied({ state, onState }) {
  const [busy, setBusy] = useState('');
  return (
    <div className="auth-page">
      <AuthTitlebar />
      <main className="auth-card" aria-labelledby="denied-title">
        <div className="auth-mark">V</div>
        <p className="auth-eyebrow">{state.membership?.status || 'access expired'}</p>
        <h1 id="denied-title">Access unavailable</h1>
        <p className="auth-copy">This account cannot open the workspace. Revalidate your school membership or contact support.</p>
        <AuthActions state={state} onState={onState} busy={busy} setBusy={setBusy} />
      </main>
    </div>
  );
}

function RestrictedOverlay({ state, onState }) {
  const [busy, setBusy] = useState('');
  const status = state.membership?.status;
  return (
    <div className="restricted-overlay" role="dialog" aria-modal="true" aria-labelledby="restricted-title">
      <section className="restricted-card">
        <span className="restricted-card__status">{state.restrictionReason === 'OFFLINE_LEASE_EXPIRED' ? 'Validación offline vencida' : (status || 'restricted')}</span>
        <h1 id="restricted-title">Cuenta restringida</h1>
        <p>El espacio de trabajo permanece visible, pero todas las acciones productivas están deshabilitadas hasta que la escuela reactive y valide el acceso.</p>
        {state.leaseExpiresAt && <p className="restricted-card__lease">Offline access valid until {new Date(state.leaseExpiresAt).toLocaleString()}</p>}
        <AuthActions state={state} onState={onState} busy={busy} setBusy={setBusy} />
      </section>
    </div>
  );
}

export default function AuthGate({ children }) {
  const [state, setState] = useState(null);

  const runAuthAction = async (action) => {
    const result = await window.electronAPI.auth[action]();
    const nextState = result.state || result;
    setState(nextState);
    return nextState;
  };

  useEffect(() => {
    window.electronAPI.auth.getState().then(setState);
    const unsubscribe = window.electronAPI.auth.onStateChanged(setState);
    const leaseCheck = window.setInterval(() => window.electronAPI.auth.getState().then(setState), 60_000);
    return () => {
      unsubscribe();
      window.clearInterval(leaseCheck);
    };
  }, []);

  if (!state) return <div className="auth-loading">Checking school access...</div>;

  const content = !state.authenticated
    ? <Login state={state} onState={setState} />
    : state.policy === 'active'
      ? children
      : state.policy === 'restricted'
        ? <>{children}<RestrictedOverlay state={state} onState={setState} /></>
        : <Denied state={state} onState={setState} />;

  return (
    <AuthProvider value={{ state, setState, revalidate: () => runAuthAction('revalidate'), logout: () => runAuthAction('logout') }}>
      {content}
    </AuthProvider>
  );
}
