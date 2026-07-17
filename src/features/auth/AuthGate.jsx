import { useEffect, useState } from 'react';
import { AuthProvider } from './AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import './AuthGate.css';

function AuthTitlebar() {
  const { t } = useI18n();
  return (
    <div className="titlebar">
      <div className="titlebar__brand"><div className="titlebar__logo">V</div><span className="titlebar__name">Vibe IDE Code</span></div>
      <div className="titlebar__controls">
        <button className="titlebar__btn" type="button" onClick={() => window.electronAPI.window.minimize()} title={t('common.minimize')}><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 8h10v1H3z" /></svg></button>
        <button className="titlebar__btn" type="button" onClick={() => window.electronAPI.window.maximize()} title={t('common.maximize')}><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3v10h10V3H3zm9 9H4V4h8v8z" /></svg></button>
        <button className="titlebar__btn titlebar__btn--close" type="button" onClick={() => window.electronAPI.window.close()} title={t('common.close')}><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 7.293l3.646-3.647.708.708L8.707 8l3.647 3.646-.708.708L8 8.707l-3.646 3.647-.708-.708L7.293 8 3.646 4.354l.708-.708L8 7.293z" /></svg></button>
      </div>
    </div>
  );
}

function AccessibilityControls() {
  const { t } = useI18n();
  const [highContrast, setHighContrast] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const toggle = (className, value, setter) => {
    document.body.classList.toggle(className, !value);
    setter(!value);
  };

  return (
    <div className="auth-accessibility" aria-label={t('auth.accessibilityOptions')}>
      <button type="button" onClick={() => toggle('high-contrast', highContrast, setHighContrast)} aria-pressed={highContrast}>
        {t('auth.highContrast')}
      </button>
      <button type="button" onClick={() => toggle('reduced-motion', reducedMotion, setReducedMotion)} aria-pressed={reducedMotion}>
        {t('auth.reduceMotion')}
      </button>
    </div>
  );
}

function AuthActions({ state, onState, busy, setBusy }) {
  const { t } = useI18n();
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
          {busy === 'revalidate' ? t('auth.checking') : t('auth.revalidate')}
        </button>
        <button type="button" className="auth-button" onClick={() => run('logout')} disabled={Boolean(busy)}>{t('auth.logout')}</button>
        <button type="button" className="auth-button" onClick={() => window.electronAPI.auth.openHelp()}>{t('auth.help')}</button>
      </div>
      {state.error && <p className="auth-error" role="alert">{state.error.message}</p>}
      <AccessibilityControls />
    </>
  );
}

function Login({ state, onState }) {
  const { t } = useI18n();
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
        <h1 id="login-title">{t('auth.schoolAccess')}</h1>
        <p className="auth-copy">{t('auth.signInCopy')}</p>
        <form onSubmit={submit}>
          <label>{t('auth.email')}<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>{t('auth.password')}<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="auth-error" role="alert"><strong>{error.code}</strong><br />{error.message}</p>}
          <button className="auth-button auth-button--primary auth-button--wide" disabled={busy || !state.configurationReady} type="submit">
            {busy ? t('auth.signingIn') : t('auth.signIn')}
          </button>
        </form>
        <button type="button" className="auth-help" onClick={() => window.electronAPI.auth.openHelp()}>{t('auth.needHelp')}</button>
        <AccessibilityControls />
      </main>
    </div>
  );
}

function Denied({ state, onState }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState('');
  return (
    <div className="auth-page">
      <AuthTitlebar />
      <main className="auth-card" aria-labelledby="denied-title">
        <div className="auth-mark">V</div>
        <p className="auth-eyebrow">{state.membership?.status || t('auth.accessExpired')}</p>
        <h1 id="denied-title">{t('auth.accessUnavailable')}</h1>
        <p className="auth-copy">{t('auth.deniedCopy')}</p>
        <AuthActions state={state} onState={onState} busy={busy} setBusy={setBusy} />
      </main>
    </div>
  );
}

function RestrictedOverlay({ state, onState }) {
  const { t, formatDate } = useI18n();
  const [busy, setBusy] = useState('');
  const status = state.membership?.status;
  return (
    <div className="restricted-overlay" role="dialog" aria-modal="true" aria-labelledby="restricted-title">
      <section className="restricted-card">
        <span className="restricted-card__status">{state.restrictionReason === 'OFFLINE_LEASE_EXPIRED' ? t('auth.offlineValidationExpired') : (status || t('auth.restricted'))}</span>
        <h1 id="restricted-title">{t('auth.restrictedAccount')}</h1>
        <p>{t('auth.restrictedCopy')}</p>
        {state.leaseExpiresAt && <p className="restricted-card__lease">{t('auth.offlineAccessUntil', { date: formatDate(state.leaseExpiresAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
        <AuthActions state={state} onState={onState} busy={busy} setBusy={setBusy} />
      </section>
    </div>
  );
}

export default function AuthGate({ children }) {
  const { t } = useI18n();
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

  if (!state) return <div className="auth-loading">{t('auth.checkingSchoolAccess')}</div>;

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
