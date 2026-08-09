import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import AppSplash from '../../components/AppSplash';
import { AuthProvider } from './AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { readAccessibility, saveAccessibility } from '../../utils/accessibility';
import { localizedAuthError } from './authErrorMessages';
import './AuthGate.css';

function AuthTitlebar() {
  const { t } = useI18n();
  return (
    <div className="titlebar">
      <div className="titlebar__brand"><div className="titlebar__logo">V</div><span className="titlebar__name">Vibe IDE Code</span></div>
      <div className="titlebar__controls">
        <button className="titlebar__btn" type="button" onClick={() => window.electronAPI.window.minimize()} title={t('common.minimize')} aria-label={t('common.minimize')}><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 8h10v1H3z" /></svg></button>
        <button className="titlebar__btn" type="button" onClick={() => window.electronAPI.window.maximize()} title={t('common.maximize')} aria-label={t('common.maximize')}><svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 3v10h10V3H3zm9 9H4V4h8v8z" /></svg></button>
        <button className="titlebar__btn titlebar__btn--close" type="button" onClick={() => window.electronAPI.window.close()} title={t('common.close')} aria-label={t('common.close')}><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 7.293l3.646-3.647.708.708L8.707 8l3.647 3.646-.708.708L8 8.707l-3.646 3.647-.708-.708L7.293 8 3.646 4.354l.708-.708L8 7.293z" /></svg></button>
      </div>
    </div>
  );
}

function AccessibilityControls() {
  const { t } = useI18n();
  const [accessibility, setAccessibility] = useState(readAccessibility);

  const toggle = (key) => {
    const next = { ...accessibility, [key]: !accessibility[key] };
    setAccessibility(next);
    saveAccessibility(next);
  };

  return (
    <div className="auth-accessibility" aria-label={t('auth.accessibilityOptions')}>
      <button type="button" onClick={() => toggle('highContrast')} aria-pressed={accessibility.highContrast} title={t('auth.highContrastHelp')}>
        {t('auth.highContrast')}
      </button>
      <button type="button" onClick={() => toggle('reducedMotion')} aria-pressed={accessibility.reducedMotion} title={t('auth.reduceMotionHelp')}>
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
      {state.error && <p className="auth-error" role="alert">{localizedAuthError(state.error, t)}</p>}
      <AccessibilityControls />
    </>
  );
}

function Login({ state, onState }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(state.error);
  // El acceso con Google termina en otra aplicacion. Sin registrar esa espera,
  // la ventana volvia a verse ociosa apenas se abria el navegador, como si el
  // clic no hubiera hecho nada.
  const [googleWait, setGoogleWait] = useState(null);

  useEffect(() => {
    setError(state.error || null);
  }, [state.error]);

  // La solicitud vive 10 minutos del lado del proceso principal; pasado ese
  // plazo el enlace ya no sirve y hay que decirlo, no seguir esperando.
  useEffect(() => {
    if (googleWait !== 'waiting') return undefined;
    const timer = setTimeout(() => setGoogleWait('expired'), 10 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [googleWait]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy('password');
    setError(null);
    try {
      const result = await window.electronAPI.auth.login(email.trim(), password);
      setError(result.error || null);
      onState(result.state);
    } catch {
      setError({ code: 'AUTH_UNEXPECTED', message: t('auth.signInFailed') });
    } finally {
      setBusy('');
    }
  };

  const google = async () => {
    setBusy('google');
    setError(null);
    try {
      const result = await window.electronAPI.auth.google();
      setError(result.error || null);
      onState(result.state);
      // `pending` significa que el navegador se abrio y falta que el usuario
      // confirme alli. La espera queda visible hasta que vuelva el resultado.
      setGoogleWait(result.ok && result.pending ? 'waiting' : null);
    } catch {
      setError({ code: 'AUTH_UNEXPECTED', message: t('auth.signInFailed') });
      setGoogleWait(null);
    } finally {
      setBusy('');
    }
  };

  // Mientras se espera al navegador, la tarjeta muestra solo eso: dejar el
  // formulario detras invitaria a reintentar por otro camino y romper el flujo.
  if (googleWait) {
    const expired = googleWait === 'expired';
    return (
      <div className="auth-page">
        <AuthTitlebar />
        <div className="auth-page__glow" />
        <main className="auth-card auth-card--waiting" aria-labelledby="google-wait-title">
          <div className="auth-mark">V</div>
          <p className="auth-eyebrow">Vibe IDE Code</p>
          <h1 id="google-wait-title">{expired ? t('auth.googleExpiredTitle') : t('auth.googleWaitingTitle')}</h1>
          <p className="auth-copy" role="status" aria-live="polite">
            {expired ? t('auth.googleExpiredCopy') : t('auth.googleWaitingCopy')}
          </p>
          {!expired && (
            <>
              <div className="auth-wait-bar" aria-hidden="true"><span /></div>
              <p className="auth-wait-hint">{t('auth.googleWaitingHint')}</p>
            </>
          )}
          <button
            type="button"
            className="auth-button auth-button--primary auth-button--wide"
            disabled={Boolean(busy)}
            onClick={() => { setGoogleWait(null); google(); }}
          >
            {expired ? t('auth.googleRetry') : t('auth.googleReopen')}
          </button>
          <button
            type="button"
            className="auth-button auth-button--wide"
            onClick={() => { setGoogleWait(null); setError(null); }}
          >
            {t('auth.googleCancelWait')}
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <AuthTitlebar />
      <div className="auth-page__glow" />
      <main className="auth-card" aria-labelledby="login-title">
        <div className="auth-mark">V</div>
        <p className="auth-eyebrow">Vibe IDE Code</p>
        <h1 id="login-title">{t('auth.platformAccess')}</h1>
        <p className="auth-copy">{t('auth.signInCopy')}</p>
        <button type="button" className="auth-button auth-button--google auth-button--wide" onClick={google} disabled={Boolean(busy) || !state.configurationReady}>
          <span className="auth-google-mark" aria-hidden="true">G</span>
          {busy === 'google' ? t('auth.openingGoogle') : t('auth.continueWithGoogle')}
        </button>
        <div className="auth-separator"><span>{t('auth.orEmail')}</span></div>
        <form onSubmit={submit}>
          <label>{t('auth.email')}<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>{t('auth.password')}<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="auth-error" role="alert">{localizedAuthError(error, t)}</p>}
          <button className="auth-button auth-button--primary auth-button--wide" disabled={Boolean(busy) || !state.configurationReady} type="submit">
            {busy === 'password' ? t('auth.signingIn') : t('auth.signIn')}
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
  const deniedCopy = state.account?.role === 'admin'
    ? t('auth.adminDesktopWebOnly')
    : state.account?.role === 'instructor'
      ? t('auth.instructorDesktopWebOnly')
      : t('auth.deniedCopy');
  return (
    <div className="auth-page">
      <AuthTitlebar />
      <main className="auth-card" aria-labelledby="denied-title">
        <div className="auth-mark">V</div>
        <p className="auth-eyebrow">{state.account?.status ? t(`accountStatuses.${state.account.status}`) : t('auth.accessExpired')}</p>
        <h1 id="denied-title">{t('auth.accessUnavailable')}</h1>
        <p className="auth-copy">{deniedCopy}</p>
        <AuthActions state={state} onState={onState} busy={busy} setBusy={setBusy} />
      </main>
    </div>
  );
}

function RestrictedOverlay({ state, onState }) {
  const { t, formatDate } = useI18n();
  const overlayRef = useRef(null);
  const [busy, setBusy] = useState('');

  // No lleva Escape a proposito: esta pantalla bloquea el acceso y no hay
  // nada valido detras a lo que volver. Solo se aisla el foco para que el
  // teclado no siga recorriendo el workspace tapado.
  useFocusTrap({ active: true, containerRef: overlayRef });
  const [supportMessage, setSupportMessage] = useState('');
  const status = state.account?.status;
  const exportDiagnostics = async () => {
    setBusy('diagnostics');
    setSupportMessage('');
    try {
      const result = await window.electronAPI.diagnostics.exportReport();
      if (result.exported) setSupportMessage(t('settings.diagnosticsExported'));
    } catch {
      setSupportMessage(t('settings.diagnosticsFailed'));
    } finally {
      setBusy('');
    }
  };
  return (
    <div ref={overlayRef} className="restricted-overlay" role="dialog" aria-modal="true" aria-labelledby="restricted-title">
      <section className="restricted-card">
        <span className="restricted-card__status">{state.restrictionReason === 'OFFLINE_LEASE_EXPIRED' ? t('auth.offlineValidationExpired') : (status ? t(`accountStatuses.${status}`) : t('auth.restricted'))}</span>
        <h1 id="restricted-title">{t('auth.restrictedAccount')}</h1>
        <p>{t('auth.restrictedCopy')}</p>
        {state.leaseExpiresAt && <p className="restricted-card__lease">{t('auth.offlineAccessUntil', { date: formatDate(state.leaseExpiresAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
        <AuthActions state={state} onState={onState} busy={busy} setBusy={setBusy} />
        <div className="restricted-support">
          <button type="button" className="auth-button" onClick={exportDiagnostics} disabled={Boolean(busy)}>{busy === 'diagnostics' ? t('settings.exportingDiagnostics') : t('settings.exportDiagnostics')}</button>
          <small>{t('settings.restrictedSupportCopy')}</small>
          {supportMessage && <span role="status">{supportMessage}</span>}
        </div>
      </section>
    </div>
  );
}

export default function AuthGate({ children }) {
  const { t } = useI18n();
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState('');

  const refreshState = async () => {
    try {
      const nextState = await window.electronAPI.auth.getState();
      setState(nextState);
      setLoadError('');
    } catch (error) {
      setLoadError(error?.message || t('auth.accessUnavailable'));
    }
  };

  const runAuthAction = async (action) => {
    const result = await window.electronAPI.auth[action]();
    const nextState = result.state || result;
    setState(nextState);
    return nextState;
  };

  useEffect(() => {
    refreshState();
    const unsubscribe = window.electronAPI.auth.onStateChanged(setState);
    const leaseCheck = window.setInterval(() => { refreshState(); }, 60_000);
    return () => {
      unsubscribe();
      window.clearInterval(leaseCheck);
    };
  }, []);

  if (!state) return <AppSplash message={t('auth.checkingAccountAccess')} error={loadError} onRetry={refreshState} />;

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
