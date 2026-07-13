import { useEffect, useId, useRef, useState } from 'react';
import './CreateProjectWizard.css';

const FALLBACK_LOCATION = 'Documents\\Vibe Projects';
const STEPS = ['Tipo', 'Proyecto', 'Stack', 'Backend', 'Configuración', 'Revisión', 'Creación'];

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
  return <div className="cpw-fixed-service"><span><Icon name={icon} /></span><div><strong>{title}</strong><small>{detail}</small></div><em>Incluido</em></div>;
}

export default function CreateProjectWizard({ onClose, onCreated }) {
  const radioId = useId();
  const dialogRef = useRef(null);
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
  const [backend, setBackend] = useState('firebase');
  const [firebaseProjectId, setFirebaseProjectId] = useState('');
  const [firebaseIdEdited, setFirebaseIdEdited] = useState(false);
  const [firebaseLocation, setFirebaseLocation] = useState('');
  const [supabaseOrganization, setSupabaseOrganization] = useState('');
  const [supabaseRegion, setSupabaseRegion] = useState('');
  const [databasePassword, setDatabasePassword] = useState('');
  const [options, setOptions] = useState({ firebaseLocations: [], supabaseOrganizations: [], supabaseRegions: [], githubUser: '', vercelUser: '' });
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
        setSetupError('La creación de proyectos no está disponible en esta versión de la aplicación.');
        setLoadingSetup(false);
        return;
      }

      const [locationResult, optionsResult] = await Promise.allSettled([
        api.getDefaultLocation(),
        api.getOptions(),
      ]);
      if (!mountedRef.current) return;

      if (locationResult.status === 'fulfilled' && locationResult.value) {
        setLocation(typeof locationResult.value === 'string' ? locationResult.value : locationResult.value.path || FALLBACK_LOCATION);
        setLocationGrant(locationResult.value.token || locationResult.value.id || '');
      }
      if (optionsResult.status === 'fulfilled') {
        const nextOptions = normalizeOptions(optionsResult.value);
        setOptions(nextOptions);
        setFirebaseLocation(nextOptions.firebaseLocations[0]?.value || 'us-central1');
        setSupabaseOrganization(nextOptions.supabaseOrganizations[0]?.value || '');
        setSupabaseRegion(nextOptions.supabaseRegions[0]?.value || '');
      } else {
        setSetupError('No se pudieron cargar todas las opciones. Puedes reintentar abriendo el asistente de nuevo.');
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

  const requestClose = () => {
    if (!isRunning) onClose?.();
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (confirming) setConfirming(false);
        else requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusRoot = confirming ? dialogRef.current.querySelector('.cpw-confirm') : dialogRef.current;
      const focusable = [...focusRoot.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirming, isRunning]);

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
      const path = typeof selected === 'string' ? selected : selected?.path;
      if (path) {
        setLocation(path);
        setLocationGrant(selected.token || selected.id || '');
      }
    } catch (error) {
      setFieldError(redact(error?.message, passwordRef.current) || 'No se pudo seleccionar la ubicación.');
    } finally {
      if (mountedRef.current) setChoosingLocation(false);
    }
  };

  const validateStep = () => {
    if (step === 1) {
      if (!name.trim()) return 'Escribe un nombre para el proyecto.';
      if (/[<>:"/\\|?*]/.test(name)) return 'El nombre contiene caracteres no válidos para una carpeta.';
      const slug = makeSlug(name);
      if (slug.length < 2 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug)) return 'El nombre no produce una carpeta válida para Windows.';
      if (!location.trim()) return 'Selecciona una ubicación para el proyecto.';
      if (!locationGrant) return 'Vuelve a seleccionar la ubicación para autorizar la creación.';
    }
    if (step === 4 && backend === 'firebase') {
      if (!/^[a-z][a-z0-9-]{4,29}$/.test(firebaseProjectId)) return 'El Project ID debe tener entre 5 y 30 caracteres, empezar por una letra y usar solo minúsculas, números o guiones.';
      if (!firebaseLocation.trim()) return 'Selecciona una ubicación de Firebase.';
    }
    if (step === 4 && backend === 'supabase') {
      if (!supabaseOrganization.trim()) return 'Selecciona una organización de Supabase.';
      if (!supabaseRegion.trim()) return 'Selecciona una región de Supabase.';
      if (databasePassword.length < 12) return 'La contraseña de base de datos debe tener al menos 12 caracteres.';
    }
    if (step === 5 && (!options.githubUser || !options.vercelUser)) return 'Conecta GitHub CLI y Vercel CLI desde Settings antes de crear el proyecto.';
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
    setProgress([{ id: 'start', message: 'Preparando el proyecto…', status: 'active' }]);
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
      setResult({ message: redact(error?.message, passwordRef.current) || (cancelled ? 'Creación cancelada.' : 'No se pudo crear el proyecto.') });
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
      if (mountedRef.current) setProgress((items) => [...items, { id: 'cancel-error', message: redact(error?.message, passwordRef.current) || 'No se pudo solicitar la cancelación.', status: 'error' }]);
    } finally {
      if (mountedRef.current) setCanceling(false);
    }
  };

  const renderStep = () => {
    if (step === 0) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>Paso 1</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">¿Qué quieres construir?</h2><p>Elige la estructura inicial. Podrás trabajar en todo el código desde el mismo workspace.</p></div>
        <div className="cpw-choice-grid cpw-choice-grid--large">
          <ChoiceCard name={`${radioId}-type`} value="web" checked={projectType === 'web'} onChange={() => setProjectType('web')} icon="globe" title="Aplicación web" description="Un proyecto web moderno, listo para desarrollar y desplegar." />
          <ChoiceCard name={`${radioId}-type`} value="mobile-suite" checked={projectType === 'mobile-suite'} onChange={() => { setProjectType('mobile-suite'); setWebStack('next-ts'); }} icon="mobile" title="Mobile suite" badge="Web + Android" description="Next.js para web y Flutter para Android en un único repositorio." />
        </div>
      </section>
    );

    if (step === 1) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>Paso 2</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">Nombre y ubicación</h2><p>Crearemos una carpeta nueva sin modificar otros proyectos.</p></div>
        <div className="cpw-form">
          <label className="cpw-field"><span>Nombre del proyecto</span><input autoFocus value={name} onChange={(event) => updateName(event.target.value)} placeholder="mi-nueva-app" autoComplete="off" /></label>
          <div className="cpw-field"><span>Ubicación</span><div className="cpw-location"><span title={location}><Icon name="folder" />{location}</span><button type="button" onClick={chooseLocation} disabled={choosingLocation || !api}>{choosingLocation ? 'Abriendo…' : 'Cambiar'}</button></div><small>El proyecto se guardará en <strong>{location}{location.endsWith('\\') || location.endsWith('/') ? '' : '\\'}{makeSlug(name) || 'nombre-del-proyecto'}</strong></small></div>
        </div>
      </section>
    );

    if (step === 2) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>Paso 3</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">Stack de desarrollo</h2><p>{projectType === 'mobile-suite' ? 'La suite mantiene web y Android claramente separados.' : 'Selecciona la base del frontend.'}</p></div>
        {projectType === 'web' ? <div className="cpw-choice-grid">
          <ChoiceCard name={`${radioId}-stack`} value="next-ts" checked={webStack === 'next-ts'} onChange={() => setWebStack('next-ts')} icon="globe" title="Next.js + TypeScript" badge="Recomendado" description="App Router, renderizado híbrido y ecosistema de Vercel." />
          <ChoiceCard name={`${radioId}-stack`} value="vite-ts" checked={webStack === 'vite-ts'} onChange={() => setWebStack('vite-ts')} icon="cloud" title="React + Vite + TypeScript" description="SPA ligera con servidor de desarrollo ultrarrápido." />
        </div> : <div className="cpw-suite-map"><div><span className="cpw-suite-map__folder">web/</span><strong>Next.js + TypeScript</strong><small>Aplicación web</small></div><span className="cpw-suite-map__line" /><div><span className="cpw-suite-map__folder">mobile/</span><strong>Flutter · Android</strong><small>Aplicación móvil</small></div></div>}
      </section>
    );

    if (step === 3) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>Paso 4</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">Backend administrado</h2><p>Conecta autenticación y datos con infraestructura lista para producción.</p></div>
        <div className="cpw-choice-grid">
          <ChoiceCard name={`${radioId}-backend`} value="firebase" checked={backend === 'firebase'} onChange={() => setBackend('firebase')} icon="cloud" title="Firebase" description="Authentication y Firestore configurados desde el inicio." />
          <ChoiceCard name={`${radioId}-backend`} value="supabase" checked={backend === 'supabase'} onChange={() => setBackend('supabase')} icon="cloud" title="Supabase" description="Postgres administrado dentro de tu organización." />
        </div>
      </section>
    );

    if (step === 4 && backend === 'firebase') return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>Paso 5</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">Configurar Firebase</h2><p>Se habilitarán solo los servicios necesarios para comenzar.</p></div>
        <div className="cpw-service-row"><FixedService icon="lock" title="Authentication" detail="Habilitado" /><FixedService icon="cloud" title="Cloud Firestore" detail="Habilitado" /></div>
        <p className="cpw-service-note"><Icon name="alert" /> Storage y Hosting no se habilitarán.</p>
        <div className="cpw-form cpw-form--columns">
          <label className="cpw-field"><span>Project ID</span><input value={firebaseProjectId} onChange={(event) => { setFirebaseIdEdited(true); setFirebaseProjectId(event.target.value.toLowerCase()); }} placeholder="mi-proyecto" autoComplete="off" /><small>No podrá cambiarse después.</small></label>
          <label className="cpw-field"><span>Ubicación de recursos</span><input value={firebaseLocation} onChange={(event) => setFirebaseLocation(event.target.value)} list={`${radioId}-firebase-locations`} placeholder="us-central1" /><datalist id={`${radioId}-firebase-locations`}>{options.firebaseLocations.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</datalist><small>Elige la región más cercana.</small></label>
        </div>
      </section>
    );

    if (step === 4) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>Paso 5</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">Configurar Supabase</h2><p>Se creará un proyecto nuevo de Supabase para esta aplicación.</p></div>
        <div className="cpw-new-project"><Icon name="check" /><div><strong>Crear proyecto nuevo</strong><small>Base de datos Postgres y API del proyecto</small></div></div>
        <div className="cpw-form cpw-form--columns">
          <label className="cpw-field"><span>Organización</span><input value={supabaseOrganization} onChange={(event) => setSupabaseOrganization(event.target.value)} list={`${radioId}-supabase-orgs`} placeholder="Selecciona una organización" /><datalist id={`${radioId}-supabase-orgs`}>{options.supabaseOrganizations.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</datalist></label>
          <label className="cpw-field"><span>Región</span><input value={supabaseRegion} onChange={(event) => setSupabaseRegion(event.target.value)} list={`${radioId}-supabase-regions`} placeholder="Selecciona una región" /><datalist id={`${radioId}-supabase-regions`}>{options.supabaseRegions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</datalist></label>
          <label className="cpw-field cpw-field--wide"><span>Contraseña de la base de datos</span><input type="password" value={databasePassword} onChange={(event) => setDatabasePassword(event.target.value)} placeholder="Mínimo 12 caracteres" autoComplete="new-password" /><small>Se enviará directamente durante la creación. Nunca aparecerá en el resumen ni en el registro de progreso.</small></label>
        </div>
      </section>
    );

    if (step === 5) return (
      <section className="cpw-step" aria-labelledby="cpw-step-title">
        <div className="cpw-step__intro"><span>Paso 6</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">Revisa antes de crear</h2><p>Vibe configurará el código, los servicios y las conexiones en una sola operación.</p></div>
        <div className="cpw-review">
          <div><span>Proyecto</span><strong>{name}</strong><small title={location}>{location}</small></div>
          <div><span>Tipo y stack</span><strong>{projectType === 'mobile-suite' ? 'Mobile suite' : 'Aplicación web'}</strong><small>{projectType === 'mobile-suite' ? 'web/ Next.js TS · mobile/ Flutter Android' : webStack === 'next-ts' ? 'Next.js + TypeScript' : 'React + Vite + TypeScript'}</small></div>
          <div><span>Backend</span><strong>{backend === 'firebase' ? 'Firebase' : 'Supabase'}</strong><small>{backend === 'firebase' ? `${firebaseProjectId} · ${firebaseLocation}` : `${supabaseOrganization} · ${supabaseRegion}`}</small></div>
           <div><span>Entrega</span><strong>Repositorio privado · {options.githubUser || 'GitHub sin conectar'}</strong><small>Vercel · {options.vercelUser || 'cuenta sin conectar'}</small></div>
        </div>
        <div className="cpw-review-note"><Icon name="lock" /><p><strong>Credenciales protegidas</strong><span>Los secretos no se muestran en este resumen ni en el progreso.</span></p></div>
      </section>
    );

    const responseSteps = Array.isArray(result?.steps)
      ? result.steps
      : Array.isArray(result?.results)
        ? result.results
        : Array.isArray(result?.failures)
          ? result.failures.map((failure) => ({ ...(typeof failure === 'object' ? failure : { message: failure }), status: 'error' }))
          : [];
    const finalTitle = runState === 'success' ? 'Proyecto creado' : runState === 'partial' ? 'Proyecto creado parcialmente' : runState === 'cancelled' ? 'Creación cancelada' : 'No se pudo completar';
    return (
      <section className="cpw-step cpw-progress" aria-labelledby="cpw-step-title">
        <div className={`cpw-result-icon cpw-result-icon--${runState}`}><Icon name={isRunning ? 'spinner' : runState === 'success' ? 'check' : 'alert'} /></div>
        <div className="cpw-step__intro cpw-step__intro--center"><span>Paso 7</span><h2 id="cpw-step-title" ref={titleRef} tabIndex="-1">{isRunning ? 'Creando tu proyecto' : finalTitle}</h2><p>{isRunning ? 'Puedes seguir el avance de cada recurso. No cierres la aplicación.' : redact(result?.message, passwordRef.current) || (runState === 'partial' ? 'La base del proyecto está disponible, pero una o más integraciones requieren atención.' : runState === 'success' ? 'El proyecto y sus servicios están listos.' : 'Puedes volver atrás para revisar la configuración.')}</p></div>
        <div className="cpw-progressbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent} aria-label="Progreso de creación"><span style={{ width: `${percent}%` }} /></div>
        <div className="cpw-progress-log" aria-live="polite">
          {(responseSteps.length ? responseSteps : progress).map((entry, index) => {
            const item = entry && typeof entry === 'object' ? entry : { message: String(entry || '') };
             return <div key={item.id || item.name || index} className={`cpw-progress-item cpw-progress-item--${item.status || 'complete'}`}><span><Icon name={item.status === 'error' || item.status === 'failed' ? 'alert' : (item.status === 'active' || item.status === 'running') && isRunning ? 'spinner' : 'check'} /></span><p><strong>{redact(item.name || item.label, passwordRef.current)}</strong>{redact(item.message || item.detail, passwordRef.current)}</p></div>;
          })}
        </div>
        {!isRunning && (result?.project?.path || result?.path || result?.repository?.url || result?.deployment?.url) && <div className="cpw-result-links">{(result.project?.path || result.path) && <span><small>Carpeta</small><strong>{result.project?.path || result.path}</strong></span>}{result.repository?.url && <span><small>Repositorio</small><strong>{result.repository.url}</strong></span>}{result.deployment?.url && <span><small>Vercel</small><strong>{result.deployment.url}</strong></span>}</div>}
      </section>
    );
  };

  return (
    <div className="cpw-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div className="cpw-dialog" role="dialog" aria-modal="true" aria-label="Crear proyecto" ref={dialogRef}>
        <header className="cpw-header"><div className="cpw-brand"><span>V</span><div><strong>Nuevo proyecto</strong><small>Configuración guiada</small></div></div><button type="button" className="cpw-close" onClick={requestClose} disabled={isRunning} aria-label="Cerrar asistente"><Icon name="close" /></button></header>
        <div className="cpw-layout">
          <nav className="cpw-steps" aria-label="Progreso del asistente"><ol>{STEPS.map((label, index) => <li key={label} className={index === step ? 'is-current' : index < step ? 'is-complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Icon name="check" /> : index + 1}</span><em>{label}</em></li>)}</ol><div className="cpw-fixed-summary"><Icon name="lock" /><p><strong>Repositorio privado</strong><small>Vercel personal incluido</small></p></div></nav>
          <main className="cpw-content">{loadingSetup ? <div className="cpw-loading" role="status"><Icon name="spinner" /><p>Preparando el asistente…</p></div> : renderStep()}</main>
        </div>
        {setupError && <div className="cpw-banner" role="status"><Icon name="alert" />{setupError}</div>}
        {fieldError && <div className="cpw-error" role="alert"><Icon name="alert" />{fieldError}</div>}
        {!loadingSetup && <footer className="cpw-footer"><span>{step < 6 ? `${step + 1} de 6` : isRunning ? 'Creación en curso' : 'Proceso finalizado'}</span><div>{step > 0 && step < 6 && <button type="button" className="cpw-button cpw-button--secondary" onClick={goBack}>Atrás</button>}{step < 5 && <button type="button" className="cpw-button cpw-button--primary" onClick={goNext} disabled={!api}>Continuar <Icon name="arrow" /></button>}{step === 5 && <button type="button" className="cpw-button cpw-button--primary" onClick={() => setConfirming(true)} disabled={!api}>Crear proyecto</button>}{isRunning && <button type="button" className="cpw-button cpw-button--danger" onClick={cancelProvision} disabled={canceling}>{canceling ? 'Cancelando…' : 'Cancelar creación'}</button>}{step === 6 && !isRunning && <button type="button" className="cpw-button cpw-button--primary" onClick={requestClose}>Cerrar</button>}</div></footer>}
        {confirming && <div className="cpw-confirm-layer"><div className="cpw-confirm" role="alertdialog" aria-modal="true" aria-labelledby="cpw-confirm-title" aria-describedby="cpw-confirm-description"><span className="cpw-confirm__icon"><Icon name="cloud" /></span><h3 id="cpw-confirm-title" ref={titleRef} tabIndex="-1">¿Crear {name}?</h3><p id="cpw-confirm-description">Se crearán archivos locales y recursos nuevos en {backend === 'firebase' ? 'Firebase' : 'Supabase'}, GitHub y Vercel.</p><div><button type="button" className="cpw-button cpw-button--secondary" onClick={() => setConfirming(false)}>Volver</button><button type="button" className="cpw-button cpw-button--primary" onClick={provision}>Confirmar y crear</button></div></div></div>}
      </div>
    </div>
  );
}
