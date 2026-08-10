import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { getRemoteCleanupIdentifiers } from './remoteCleanup.mjs';
import './CreateProjectWizard.css';

const FALLBACK_LOCATION = 'Documents\\Vibe Projects';

function Icon({ name }) {
  const paths = {
    close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
    folder: <><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    mobile: <><rect width="12" height="20" x="6" y="2" rx="2" /><path d="M10 18h4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="m9 18 6-6-6-6" />,
    lock: <><rect width="16" height="11" x="4" y="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    cloud: <><path d="M17.5 19H7a5 5 0 1 1 1-9.9A7 7 0 0 1 21 12.5 3.5 3.5 0 0 1 17.5 19Z" /></>,
    alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>,
    spinner: <path d="M21 12a9 9 0 1 1-6.2-8.56" />,
  };

  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function toOptions(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (typeof item === 'string') return { value: item, label: item };
    return {
      value: item.id ?? item.value ?? item.slug ?? item.name ?? '',
      label: item.name ?? item.label ?? item.displayName ?? item.id ?? item.value ?? '',
    };
  }).filter((item) => item.value);
}

function normalizeOptions(raw = {}) {
  return {
    firebaseLocations: toOptions(raw.firebase?.locations ?? raw.firebaseLocations),
    supabaseOrganizations: toOptions(raw.supabase?.organizations ?? raw.supabaseOrganizations),
    supabaseRegions: toOptions(raw.supabase?.regions ?? raw.supabaseRegions),
    githubUser: raw.githubUser || '',
    vercelUser: raw.vercelUser || '',
    supabaseUser: raw.supabaseUser || '',
    firebaseUser: raw.firebaseUser || '',
  };
}

function makeSlug(name, limit = 48) {
  return name.toLowerCase().trim()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, limit);
}

function redact(value, secret) {
  const text = typeof value === 'string' ? value : '';
  return secret && text.includes(secret) ? text.split(secret).join('••••••••') : text;
}

function ChoiceCard({ checked, description, icon, name, onChange, title, value, badge }) {
  return (
    <label className={`cpw-choice ${checked ? 'is-selected' : ''}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} />
      <span className="cpw-choice__icon"><Icon name={icon} /></span>
      <span className="cpw-choice__body">
        <span className="cpw-choice__heading"><strong>{title}</strong>{badge && <small>{badge}</small>}</span>
        <span>{description}</span>
      </span>
      <span className="cpw-choice__check"><Icon name="check" /></span>
    </label>
  );
}

function FixedService({ icon, title, detail }) {
  const { t } = useI18n();
  return <div className="cpw-fixed-service"><span><Icon name={icon} /></span><div><strong>{title}</strong><small>{detail}</small></div><em>{t('createProject.included')}</em></div>;
}

export default function CreateProjectWizard({ onClose, onCreated }) {
  const { t } = useI18n();
  const steps = ['type', 'project', 'stack', 'backend', 'configuration', 'review', 'creation'].map((key) => t(`createProject.steps.${key}`));
  const radioId = useId();
  const dialogRef = useRef(null);
  const confirmRef = useRef(null);
  const titleRef = useRef(null);
  const openerRef = useRef(document.activeElement);
  const passwordRef = useRef('');
  const mountedRef = useRef(true);
  const cancelRequestedRef = useRef(false);

  const [step, setStep] = useState(0);
  const [projectType, setProjectType] = useState('web');
  const [name, setName] = useState('');
  const [location, setLocation] = useState(FALLBACK_LOCATION);
  const [locationGrant, setLocationGrant] = useState('');
  const [webStack, setWebStack] = useState('next-ts');
  const [backend, setBackend] = useState('supabase');
  const [firebaseProjectId, setFirebaseProjectId] = useState('');
  const [firebaseIdEdited, setFirebaseIdEdited] = useState(false);
  const [firebaseLocation, setFirebaseLocation] = useState('');
  const [supabaseOrganization, setSupabaseOrganization] = useState('');
  const [supabaseRegion, setSupabaseRegion] = useState('');
  const [databasePassword, setDatabasePassword] = useState('');
  const [options, setOptions] = useState({ firebaseLocations: [], supabaseOrganizations: [], supabaseRegions: [], githubUser: '', vercelUser: '', supabaseUser: '', firebaseUser: '' });
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [setupError, setSetupError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [runState, setRunState] = useState('idle');
  const [progress, setProgress] = useState([]);
  const [percent, setPercent] = useState(0);
  const [result, setResult] = useState(null);
  const [canceling, setCanceling] = useState(false);

  passwordRef.current = databasePassword;

  const api = window.electronAPI?.projectCreation;
  const isRunning = runState === 'running';

  useEffect(() => {
    mountedRef.current = true;
    const loadSetup = async () => {
      if (!api) {
        setSetupError(t('createProject.unavailable'));
        setLoadingSetup(false);
        return;
      }

      const [locationResult, optionsResult] = await Promise.allSettled([
        api.getDefaultLocation(),
        api.getOptions(),
      ]);
      if (!mountedRef.current) return;

      if (locationResult.status === 'fulfilled' && locationResult.value) {
        setLocation(FALLBACK_LOCATION);
        setLocationGrant(locationResult.value.token || locationResult.value.id || '');
      }
      if (optionsResult.status === 'fulfilled') {
        const nextOptions = normalizeOptions(optionsResult.value);
        setOptions(nextOptions);
        setFirebaseLocation(nextOptions.firebaseLocations[0]?.value || 'us-central1');
        setSupabaseOrganization(nextOptions.supabaseOrganizations[0]?.value || '');
        setSupabaseRegion(nextOptions.supabaseRegions[0]?.value || '');
      } else {
        setSetupError(t('createProject.loadOptionsFailed'));
      }
      setLoadingSetup(false);
    };

    loadSetup();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!api?.onProgress) return undefined;
    const unsubscribe = api.onProgress((update = {}) => {
      if (!mountedRef.current) return;
      const message = redact(update.message ?? update.detail ?? update.label, passwordRef.current);
      const updatePercent = Number(update.percent ?? update.progress);
      if (Number.isFinite(updatePercent)) setPercent(Math.max(0, Math.min(100, updatePercent)));
      if (message) {
        setProgress((items) => [...items, {
          id: `${Date.now()}-${items.length}`,
          message,
          status: update.status || 'active',
        }].slice(-12));
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
  }, [step, confirming, runState, loadingSetup]);

  useEffect(() => () => openerRef.current?.focus?.(), []);

  const requestClose = useCallback(() => {
    if (!isRunning) onClose?.();
  }, [isRunning, onClose]);

  /*
   * El asistente tenia su propia trampa de foco, escrita a mano y colgada de
   * `document`. Existiendo useFocusTrap —que ya esta probado y es el que usan
   * los demas dialogos— tener dos implementaciones significaba que un arreglo
   * en una no llegaba a la otra.
   *
   * Son dos capas reales, asi que son dos trampas: mientras la confirmacion
   * esta abierta el foco vive dentro de ella, no del asistente.
   */
  const closeConfirm = useCallback(() => setConfirming(false), []);
  useFocusTrap({ active: !confirming, containerRef: dialogRef, onEscape: requestClose, initialFocusRef: titleRef });
  useFocusTrap({ active: confirming, containerRef: confirmRef, onEscape: closeConfirm, initialFocusRef: titleRef });

  const updateName = (value) => {
    setName(value);
    if (!firebaseIdEdited) setFirebaseProjectId(makeSlug(value, 30));
  };

  const chooseLocation = async () => {
    if (!api?.chooseLocation) return;
    setChoosingLocation(true);
    setFieldError('');
    try {
      const selected = await api.chooseLocation();
      const token = selected?.token || selected?.id;
      if (token) {
        setLocation(t('createProject.authorizedLocation'));
        setLocationGrant(token);
      }
    } catch (error) {
      setFieldError(redact(error?.message, passwordRef.current) || t('createProject.selectLocationFailed'));
    } finally {
      if (mountedRef.current) setChoosingLocation(false);
    }
  };

  const validateStep = () => {
    if (step === 1) {
      if (!name.trim()) return t('createProject.nameRequired');
      if (/[<>:"/\\|?*]/.test(name)) return t('createProject.invalidName');
      const slug = makeSlug(name);
      if (slug.length < 2 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug)) return t('createProject.invalidWindowsName');
      if (!location.trim()) return t('createProject.locationRequired');
      if (!locationGrant) return t('createProject.authorizeLocation');
    }
    if (step === 4 && backend === 'firebase') {
      if (!/^[a-z](?:[a-z0-9-]{4,28}[a-z0-9])$/.test(firebaseProjectId)) return t('createProject.invalidProjectId');
      if (!firebaseLocation.trim()) return t('createProject.firebaseLocationRequired');
    }
    if (step === 4 && backend === 'supabase') {
      if (!supabaseOrganization.trim()) return t('createProject.supabaseOrganizationRequired');
      if (!supabaseRegion.trim()) return t('createProject.supabaseRegionRequired');
      if (databasePassword.length < 12) return t('createProject.passwordRequired');
    }
    if (step === 5 && missingProviders.length > 0) return t('createProject.connectServices');
    return '';
  };

  const goNext = () => {
    const error = validateStep();
    setFieldError(error);
    if (!error) setStep((current) => Math.min(current + 1, 5));
  };

  const goBack = () => {
    setFieldError('');
    setStep((current) => Math.max(current - 1, 0));
  };

  const buildRequest = () => ({
    type: projectType === 'mobile-suite' ? 'mobile-suite' : webStack === 'next-ts' ? 'next-ts' : 'vite-react-ts',
    name: name.trim(),
    location,
    stack: projectType === 'mobile-suite'
      ? { web: 'next-typescript', mobile: 'flutter-android', folders: { web: 'web', mobile: 'mobile' } }
      : { web: webStack === 'next-ts' ? 'next-typescript' : 'react-vite-typescript' },
    backend,
    ...(backend === 'firebase' ? { firebase: {
          projectId: firebaseProjectId,
          location: firebaseLocation,
          services: { auth: true, firestore: true, storage: false, hosting: false },
        } } : { supabase: {
          organizationId: supabaseOrganization,
          region: supabaseRegion,
          password: databasePassword,
          createNewProject: true,
        } }),
    repository: { visibility: 'private' },
    deployment: { provider: 'vercel', scope: 'personal' },
  });

  const provision = async () => {
    setConfirming(false);
    setStep(6);
    setRunState('running');
    setProgress([{ id: 'start', message: t('createProject.preparingProject'), status: 'active' }]);
    setPercent(2);
    setResult(null);
    cancelRequestedRef.current = false;
    try {
      const response = await api.provision(buildRequest(), locationGrant);
      if (!mountedRef.current) return;
      const partial = response?.status === 'partial' || (response?.status === 'failed' && response?.project) || response?.partial === true || response?.failures?.length > 0;
      const succeeded = response?.status === 'completed' || response?.success === true;
      const cancelled = response?.status === 'cancelled';
      setResult(response || {});
      setPercent(100);
      setRunState(cancelled ? 'cancelled' : partial ? 'partial' : succeeded ? 'success' : 'error');
      if (response?.project) onCreated?.(response || {});
    } catch (error) {
      if (!mountedRef.current) return;
      const cancelled = cancelRequestedRef.current || error?.code === 'CANCELLED';
      setResult({ message: redact(error?.message, passwordRef.current) || (cancelled ? t('createProject.creationCancelled') : t('createProject.createFailed')) });
      setRunState(cancelled ? 'cancelled' : 'error');
    }
  };

  const cancelProvision = async () => {
    if (!api?.cancel || canceling) return;
    cancelRequestedRef.current = true;
    setCanceling(true);
    try {
      await api.cancel();
    } catch (error) {
      if (mountedRef.current) setProgress((items) => [...items, { id: 'cancel-error', message: redact(error?.message, passwordRef.current) || t('createProject.cancelFailed'), status: 'error' }]);
    } finally {
      if (mountedRef.current) setCanceling(false);
    }
  };

  const missingProviders = [
    options.githubUser ? null : 'github',
    options.vercelUser ? null : 'vercel',
    backend === 'supabase' ? (options.supabaseUser ? null : 'supabase') : (options.firebaseUser ? null : 'firebase'),
  ].filter(Boolean);

  const renderStep = () => {
    if (step === 0) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>{t('createProject.step', { number: 1 })}</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">{t('createProject.chooseTitle')}</h2><p>{t('createProject.chooseCopy')}</p></div>
        <div className="cpw-choice-grid cpw-choice-grid--large">
          <ChoiceCard name={`${radioId}-type`} value="web" checked={projectType === 'web'} onChange={() => setProjectType('web')} icon="globe" title={t('createProject.webApp')} description={t('createProject.webAppCopy')} />
          <ChoiceCard name={`${radioId}-type`} value="mobile-suite" checked={projectType === 'mobile-suite'} onChange={() => { setProjectType('mobile-suite'); setWebStack('next-ts'); }} icon="mobile" title={t('createProject.mobileSuite')} badge={t('createProject.webAndroid')} description={t('createProject.mobileSuiteCopy')} />
        </div>

        {/* Los requisitos se comunicaban recien en el paso 6, despues de que ya
            hubieras elegido stack, backend y contrasena de base. Se anticipan:
            el asistente sigue teniendo los mismos pasos y las mismas
            exigencias, pero ahora sabes desde el principio si vas a llegar. */}
        <div className={`cpw-requirements${missingProviders.length ? ' cpw-requirements--pending' : ''}`}>
          <strong>{t(missingProviders.length ? 'createProject.requirementsTitle' : 'createProject.requirementsReadyTitle')}</strong>
          <ul>
            <li className={options.githubUser ? 'is-ready' : ''}>
              GitHub — {options.githubUser ? t('createProject.connectedAs', { user: options.githubUser }) : t('createProject.githubDisconnected')}
            </li>
            <li className={options.vercelUser ? 'is-ready' : ''}>
              Vercel — {options.vercelUser ? t('createProject.connectedAs', { user: options.vercelUser }) : t('createProject.accountDisconnected')}
            </li>
            <li className={options.supabaseUser ? 'is-ready' : ''}>
              Supabase — {options.supabaseUser ? t('createProject.connectedAs', { user: options.supabaseUser }) : t(backend === 'supabase' ? 'createProject.accountDisconnected' : 'createProject.optionalNotConnected')}
            </li>
            <li className={options.firebaseUser ? 'is-ready' : ''}>
              Firebase — {options.firebaseUser ? t('createProject.connectedAs', { user: options.firebaseUser }) : t(backend === 'firebase' ? 'createProject.accountDisconnected' : 'createProject.optionalNotConnected')}
            </li>
          </ul>
          {missingProviders.length > 0 && <p>{t('createProject.requirementsPending')}</p>}
        </div>
      </section>
    );

    if (step === 1) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>{t('createProject.step', { number: 2 })}</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">{t('createProject.nameLocation')}</h2><p>{t('createProject.nameLocationCopy')}</p></div>
        <div className="cpw-form">
          <label className="cpw-field"><span>{t('createProject.projectName')}</span><input autoFocus value={name} onChange={(event) => updateName(event.target.value)} placeholder={t('createProject.projectNamePlaceholder')} autoComplete="off" /></label>
          <div className="cpw-field"><span>{t('createProject.location')}</span><div className="cpw-location"><span title={location}><Icon name="folder" />{location}</span><button type="button" onClick={chooseLocation} disabled={choosingLocation || !api}>{choosingLocation ? t('createProject.opening') : t('createProject.change')}</button></div><small>{t('createProject.projectSavedAt')} <strong>{location}{location.endsWith('\\') || location.endsWith('/') ? '' : '\\'}{makeSlug(name) || t('createProject.projectFolderPlaceholder')}</strong></small></div>
        </div>
      </section>
    );

    if (step === 2) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>{t('createProject.step', { number: 3 })}</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">{t('createProject.stackTitle')}</h2><p>{projectType === 'mobile-suite' ? t('createProject.mobileSuiteStackCopy') : t('createProject.stackCopy')}</p></div>
        {projectType === 'web' ? <div className="cpw-choice-grid">
          <ChoiceCard name={`${radioId}-stack`} value="next-ts" checked={webStack === 'next-ts'} onChange={() => setWebStack('next-ts')} icon="globe" title={t('createProject.nextStack')} badge={t('createProject.recommended')} description={t('createProject.nextStackCopy')} />
          <ChoiceCard name={`${radioId}-stack`} value="vite-ts" checked={webStack === 'vite-ts'} onChange={() => setWebStack('vite-ts')} icon="cloud" title={t('createProject.viteStack')} description={t('createProject.viteStackCopy')} />
        </div> : <div className="cpw-suite-map"><div><span className="cpw-suite-map__folder">web/</span><strong>{t('createProject.nextStack')}</strong><small>{t('createProject.webApp')}</small></div><span className="cpw-suite-map__line" /><div><span className="cpw-suite-map__folder">mobile/</span><strong>{t('createProject.flutterAndroid')}</strong><small>{t('createProject.mobileApp')}</small></div></div>}
      </section>
    );

    if (step === 3) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>{t('createProject.step', { number: 4 })}</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">{t('createProject.backendTitle')}</h2><p>{t('createProject.backendCopy')}</p></div>
        <div className="cpw-choice-grid">
          <ChoiceCard name={`${radioId}-backend`} value="supabase" checked={backend === 'supabase'} onChange={() => setBackend('supabase')} icon="cloud" title="Supabase" description={t('createProject.supabaseCopy')} />
          <ChoiceCard name={`${radioId}-backend`} value="firebase" checked={backend === 'firebase'} onChange={() => setBackend('firebase')} icon="cloud" title="Firebase" description={t('createProject.firebaseCopy')} />
        </div>
      </section>
    );

    if (step === 4 && backend === 'firebase') return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>{t('createProject.step', { number: 5 })}</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">{t('createProject.configureFirebase')}</h2><p>{t('createProject.firebaseSetupCopy')}</p></div>
        <div className="cpw-service-row"><FixedService icon="lock" title="Authentication" detail={t('createProject.authManualStep')} /><FixedService icon="cloud" title="Cloud Firestore" detail={t('createProject.enabled')} /></div>
        <p className="cpw-service-note"><Icon name="alert" /> {t('createProject.firebaseExcludedServices')}</p>
        <div className="cpw-form cpw-form--columns">
          <label className="cpw-field"><span>{t('createProject.projectId')}</span><input value={firebaseProjectId} onChange={(event) => { setFirebaseIdEdited(true); setFirebaseProjectId(event.target.value.toLowerCase()); }} placeholder={t('createProject.projectIdPlaceholder')} autoComplete="off" /><small>{t('createProject.projectIdFixed')}</small></label>
          <label className="cpw-field"><span>{t('createProject.resourceLocation')}</span><input value={firebaseLocation} onChange={(event) => setFirebaseLocation(event.target.value)} list={`${radioId}-firebase-locations`} placeholder="us-central1" /><datalist id={`${radioId}-firebase-locations`}>{options.firebaseLocations.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</datalist><small>{t('createProject.closestRegion')}</small></label>
        </div>
      </section>
    );

    if (step === 4) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>{t('createProject.step', { number: 5 })}</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">{t('createProject.configureSupabase')}</h2><p>{t('createProject.supabaseSetupCopy')}</p></div>
        <div className="cpw-new-project"><Icon name="check" /><div><strong>{t('createProject.createNewProject')}</strong><small>{t('createProject.supabaseProjectDetail')}</small></div></div>
        <div className="cpw-form cpw-form--columns">
          <label className="cpw-field"><span>{t('createProject.organization')}</span><input value={supabaseOrganization} onChange={(event) => setSupabaseOrganization(event.target.value)} list={`${radioId}-supabase-orgs`} placeholder={t('createProject.selectOrganization')} /><datalist id={`${radioId}-supabase-orgs`}>{options.supabaseOrganizations.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</datalist></label>
          <label className="cpw-field"><span>{t('createProject.region')}</span><input value={supabaseRegion} onChange={(event) => setSupabaseRegion(event.target.value)} list={`${radioId}-supabase-regions`} placeholder={t('createProject.selectRegion')} /><datalist id={`${radioId}-supabase-regions`}>{options.supabaseRegions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</datalist></label>
          <label className="cpw-field cpw-field--wide"><span>{t('createProject.databasePassword')}</span><input type="password" value={databasePassword} onChange={(event) => setDatabasePassword(event.target.value)} placeholder={t('createProject.passwordPlaceholder')} autoComplete="new-password" /><small>{t('createProject.passwordCopy')}</small></label>
        </div>
      </section>
    );

    if (step === 5) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>{t('createProject.step', { number: 6 })}</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">{t('createProject.reviewTitle')}</h2><p>{t('createProject.reviewCopy')}</p></div>
        <div className="cpw-review">
          <div><span>{t('createProject.project')}</span><strong>{name}</strong><small title={location}>{location}</small></div>
          <div><span>{t('createProject.typeAndStack')}</span><strong>{projectType === 'mobile-suite' ? t('createProject.mobileSuite') : t('createProject.webApp')}</strong><small>{projectType === 'mobile-suite' ? t('createProject.mobileSuiteStack') : webStack === 'next-ts' ? t('createProject.nextStack') : t('createProject.viteStack')}</small></div>
          <div><span>{t('createProject.backend')}</span><strong>{backend === 'firebase' ? 'Firebase' : 'Supabase'}</strong><small>{backend === 'firebase' ? `${firebaseProjectId} · ${firebaseLocation}` : `${supabaseOrganization} · ${supabaseRegion}`}</small></div>
           <div><span>{t('createProject.delivery')}</span><strong>{t('createProject.githubRepository')} · {t('createProject.privateRepository')} · {options.githubUser || t('createProject.githubDisconnected')}</strong><small>{t('createProject.privateRepositoryCopy')} · Vercel · {options.vercelUser || t('createProject.accountDisconnected')}</small></div>
        </div>
        <div className="cpw-review-note"><Icon name="lock" /><p><strong>{t('createProject.protectedCredentials')}</strong><span>{t('createProject.protectedCredentialsCopy')}</span></p></div>
      </section>
    );

    const manualSteps = Array.isArray(result?.remotes?.firebase?.manualSteps) ? result.remotes.firebase.manualSteps : [];
    const cleanupIdentifiers = result?.manualCleanupRequired ? getRemoteCleanupIdentifiers(result.remotes) : [];
    const responseSteps = manualSteps.length
      ? manualSteps.map((entry) => ({ ...entry, status: 'manual' }))
      : Array.isArray(result?.steps)
      ? result.steps
      : Array.isArray(result?.results)
        ? result.results
        : Array.isArray(result?.failures)
          ? result.failures.map((failure) => ({ ...(typeof failure === 'object' ? failure : { message: failure }), status: 'error' }))
          : [];
    const finalTitle = runState === 'success' ? t('createProject.projectCreated') : runState === 'partial' ? t('createProject.projectPartiallyCreated') : runState === 'cancelled' ? t('createProject.creationCancelledTitle') : t('createProject.creationIncomplete');
    return (
      <section className="cpw-step cpw-progress" aria-labelledby="cpw-step-title">
        <div className={`cpw-result-icon cpw-result-icon--${runState}`}><Icon name={isRunning ? 'spinner' : runState === 'success' ? 'check' : 'alert'} /></div>
        <div className="cpw-step__intro cpw-step__intro--center"><span>{t('createProject.step', { number: 7 })}</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">{isRunning ? t('createProject.creatingProject') : finalTitle}</h2><p>{isRunning ? t('createProject.creationProgressCopy') : redact(result?.message, passwordRef.current) || (runState === 'partial' ? t('createProject.partialCreationCopy') : runState === 'success' ? t('createProject.successCreationCopy') : t('createProject.incompleteCreationCopy'))}</p></div>
        <div className="cpw-progressbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent} aria-label={t('createProject.creationProgress')}><span style={{ width: `${percent}%` }} /></div>
        <div className="cpw-progress-log" aria-live="polite">
          {(responseSteps.length ? responseSteps : progress).map((entry, index) => {
            const item = entry && typeof entry === 'object' ? entry : { message: String(entry || '') };
             return <div key={item.id || item.name || index} className={`cpw-progress-item cpw-progress-item--${item.status || 'complete'}`}><span><Icon name={item.status === 'error' || item.status === 'failed' ? 'alert' : (item.status === 'active' || item.status === 'running') && isRunning ? 'spinner' : 'check'} /></span><p><strong>{redact(item.name || item.label, passwordRef.current)}</strong>{redact(item.message || item.detail, passwordRef.current)}</p></div>;
          })}
        </div>
        {result?.manualCleanupRequired && <div className="cpw-cleanup-warning" role="alert"><Icon name="alert" /><div><strong>{t('createProject.remoteCleanupTitle')}</strong><p>{t('createProject.remoteCleanupCopy')}</p>{cleanupIdentifiers.length > 0 && <ul>{cleanupIdentifiers.map((entry) => <li key={`${entry.provider}-${entry.identifier}`}><span>{entry.provider}</span><code>{entry.identifier}</code><em>{t(`createProject.remoteStatus.${entry.status}`)}</em></li>)}</ul>}</div></div>}
        {!isRunning && (result?.project?.path || result?.path || result?.repository?.url || result?.deployment?.url) && <div className="cpw-result-links">{(result.project?.path || result.path) && <span><small>{t('createProject.folder')}</small><strong>{result.project?.path || result.path}</strong></span>}{result.repository?.url && <span><small>{t('createProject.repository')}</small><strong>{result.repository.url}</strong></span>}{result.deployment?.url && <span><small>Vercel</small><strong>{result.deployment.url}</strong></span>}</div>}
      </section>
    );
  };

  return (
    <div className="cpw-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div className="cpw-dialog" role="dialog" aria-modal="true" aria-label={t('createProject.createProject')} ref={dialogRef}>
        <header className="cpw-header"><div className="cpw-brand"><span>V</span><div><strong>{t('createProject.newProject')}</strong><small>{t('createProject.guidedSetup')}</small></div></div><button type="button" className="cpw-close" onClick={requestClose} disabled={isRunning} aria-label={t('createProject.closeWizard')}><Icon name="close" /></button></header>
        <div className="cpw-layout">
          <nav className="cpw-steps" aria-label={t('createProject.wizardProgress')}><ol>{steps.map((label, index) => <li key={label} className={index === step ? 'is-current' : index < step ? 'is-complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Icon name="check" /> : index + 1}</span><em>{label}</em></li>)}</ol><div className="cpw-fixed-summary"><Icon name="lock" /><p><strong>{t('createProject.githubRepository')} · {t('createProject.privateRepository')}</strong><small>{t('createProject.privateRepositoryCopy')}</small></p></div></nav>
          <main className="cpw-content">{loadingSetup ? <div className="cpw-loading" role="status"><Icon name="spinner" /><p>{t('createProject.preparingWizard')}</p></div> : renderStep()}</main>
        </div>
        {setupError && <div className="cpw-banner" role="status"><Icon name="alert" />{setupError}</div>}
        {fieldError && <div className="cpw-error" role="alert"><Icon name="alert" />{fieldError}</div>}
        {!loadingSetup && <footer className="cpw-footer"><span>{step < 6 ? t('createProject.stepCount', { current: step + 1, total: 6 }) : isRunning ? t('createProject.creationInProgress') : t('createProject.processComplete')}</span><div>{step > 0 && step < 6 && <button type="button" className="cpw-button cpw-button--secondary" onClick={goBack}>{t('createProject.back')}</button>}{step < 5 && <button type="button" className="cpw-button cpw-button--primary" onClick={goNext} disabled={!api}>{t('createProject.continue')} <Icon name="arrow" /></button>}{step === 5 && <button type="button" className="cpw-button cpw-button--primary" onClick={() => setConfirming(true)} disabled={!api}>{t('createProject.createProject')}</button>}{isRunning && <button type="button" className="cpw-button cpw-button--danger" onClick={cancelProvision} disabled={canceling}>{canceling ? t('createProject.cancelling') : t('createProject.cancelCreation')}</button>}{step === 6 && !isRunning && <button type="button" className="cpw-button cpw-button--primary" onClick={requestClose}>{t('createProject.close')}</button>}</div></footer>}
        {confirming && <div className="cpw-confirm-layer"><div className="cpw-confirm" ref={confirmRef} role="alertdialog" aria-modal="true" aria-labelledby="cpw-confirm-title" aria-describedby="cpw-confirm-description"><span className="cpw-confirm__icon"><Icon name="cloud" /></span><h3 id="cpw-confirm-title" ref={titleRef} tabIndex="-1">{t('createProject.confirmTitle', { name })}</h3><p id="cpw-confirm-description">{t('createProject.confirmCopy', { backend: backend === 'firebase' ? 'Firebase' : 'Supabase' })}</p><div><button type="button" className="cpw-button cpw-button--secondary" onClick={() => setConfirming(false)}>{t('createProject.back')}</button><button type="button" className="cpw-button cpw-button--primary" onClick={provision}>{t('createProject.confirmAndCreate')}</button></div></div></div>}
      </div>
    </div>
  );
}
