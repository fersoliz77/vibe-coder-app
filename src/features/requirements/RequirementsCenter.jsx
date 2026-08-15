import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import ActionConsentDialog from './ActionConsentDialog';
import './RequirementsCenter.css';

const STATUS_ORDER = { pending: 0, deferred: 1, dismissed: 2, completed: 3, superseded: 4 };
const ERROR_KEYS = {
  PROJECT_NOT_FOUND: 'project',
  REQUIREMENT_NOT_FOUND: 'changed', REQUIREMENT_NOT_PENDING: 'changed', ACTION_STALE: 'changed',
  ACTION_PRECONDITION_FAILED: 'manual', ACTION_NOT_SUPPORTED: 'manual', GUIDANCE_UNAVAILABLE: 'manual',
  ACTION_GRANT_INVALID: 'expired', ACTION_BUSY: 'busy', ACTION_FAILED: 'failed',
  ACTION_CANCELLED: 'cancelled', CANCELLED: 'cancelled', CLIPBOARD_UNAVAILABLE: 'clipboard', REQUIREMENTS_FAILED: 'generic',
  DISK_SPACE_LOW: 'disk', ACTION_VERIFY_FAILED: 'verify', ACTION_VERIFY_INCOMPLETE: 'incomplete',
};

function readableError(t, reason, fallbackKey) {
  return ERROR_KEYS[reason?.code] ? t(`requirements.errors.${ERROR_KEYS[reason.code]}`) : t(fallbackKey);
}

export default function RequirementsCenter({ project, onProjectPatch, onOpenPreview, onOpenSettings }) {
  const { t, formatDate } = useI18n();
  const [requirements, setRequirements] = useState(project.requirements || null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [copied, setCopied] = useState(false);
  const [actionProgress, setActionProgress] = useState(null);
  const [scanProgress, setScanProgress] = useState(null);
  const [actionRetry, setActionRetry] = useState(null);

  useEffect(() => {
    if (!window.electronAPI?.requirements?.onProgress) return undefined;
    return window.electronAPI.requirements.onProgress((progress) => {
      if (progress?.projectId !== project.id) return;
      /* Reanalizar emite por el mismo canal pero no pertenece a ninguna accion: no puede alimentar el dialogo de consentimiento. */
      if (progress.stage === 'analyzing' && !progress.requirementId) setScanProgress(progress.scan || null);
      else setActionProgress(progress);
    });
  }, [project.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    window.electronAPI.requirements.list(project.id)
      .then(async (result) => { if (active && result.projectId === project.id) { setRequirements(result.projectPatch.requirements); await onProjectPatch(result.projectId, result.projectPatch); } })
      .catch((reason) => { if (active) setError(readableError(t, reason, 'requirements.loadFailed')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project.id]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setScanProgress(null);
    setError('');
    try {
      const result = await window.electronAPI.requirements.refresh(project.id);
      if (result.projectId !== project.id) return;
      setRequirements(result.projectPatch.requirements);
      await onProjectPatch(result.projectId, result.projectPatch);
    } catch (reason) {
      /* Cancelar es una decision del usuario, no una falla que haya que reportarle como error. */
      if (reason?.code !== 'ACTION_CANCELLED') setError(readableError(t, reason, 'requirements.refreshFailed'));
    } finally {
      setRefreshing(false);
      setScanProgress(null);
    }
  };

  const cancelRefresh = async () => {
    if (!refreshing || !window.electronAPI?.requirements?.cancelAnalysis) return;
    await window.electronAPI.requirements.cancelAnalysis(project.id).catch(() => {});
  };

  const review = async (item) => {
    setActionError('');
    setCopied(false);
    setActionProgress(null);
    setActionRetry(null);
    try {
      setPreview(await window.electronAPI.requirements.preview(project.id, item.id));
    } catch (reason) {
      setError(readableError(t, reason, 'requirements.previewFailed'));
    }
  };

  const closePreview = () => {
    if (applying) return;
    if (preview?.grantId) window.electronAPI.requirements.cancel(preview.grantId).catch(() => {});
    if (actionRetry?.id) window.electronAPI.requirements.cancel(actionRetry.id).catch(() => {});
    setPreview(null);
    setActionError('');
    setActionProgress(null);
    setActionRetry(null);
  };

  const apply = async () => {
    if (!preview?.grantId || !preview?.confirmationNonce || applying) return;
    setApplying(true);
    setActionProgress({ projectId: project.id, requirementId: preview.requirementId, stage: 'starting', percent: 0, startedAt: Date.now(), estimate: preview.action.actionType === 'INSTALL_NPM_DEPENDENCIES' ? { minSeconds: 60, maxSeconds: 300 } : null });
    setActionError('');
    setActionRetry(null);
    try {
      const result = await window.electronAPI.requirements.apply(preview.grantId, preview.confirmationNonce);
      if (result.projectId !== project.id) return;
      setRequirements(result.projectPatch.requirements);
      await onProjectPatch(result.projectId, result.projectPatch);
      setPreview(null);
      setActionProgress(null);
    } catch (reason) {
      setActionError(readableError(t, reason, 'requirements.applyFailed'));
      setActionRetry(reason?.retry || null);
    } finally {
      setApplying(false);
    }
  };

  const retryVerification = async () => {
    if (!actionRetry?.id || applying) return;
    setApplying(true);
    setActionError('');
    setActionProgress({ projectId: project.id, requirementId: preview.requirementId, stage: 'verifying', percent: 70, startedAt: Date.now(), estimate: null });
    try {
      const result = await window.electronAPI.requirements.retry(actionRetry.id);
      if (result.projectId !== project.id) return;
      setRequirements(result.projectPatch.requirements);
      await onProjectPatch(result.projectId, result.projectPatch);
      setPreview(null);
      setActionRetry(null);
      setActionProgress(null);
    } catch (reason) {
      setActionError(readableError(t, reason, 'requirements.applyFailed'));
      setActionRetry(reason?.retry || null);
    } finally {
      setApplying(false);
    }
  };

  const copyGuidance = async () => {
    try {
      await window.electronAPI.requirements.copyGuidance(project.id, preview.requirementId);
      setCopied(true);
    } catch (reason) {
      setActionError(readableError(t, reason, 'requirements.copyFailed'));
    }
  };

  const navigate = (destination) => {
    closePreview();
    if (destination === 'preview') onOpenPreview();
    else onOpenSettings();
  };

  const items = [...(requirements?.items || [])].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.type.localeCompare(b.type));
  const pending = items.filter((item) => item.status === 'pending');
  const blocking = pending.filter((item) => item.severity === 'blocking').length;

  return (
    <div className="requirements-center">
      <header className="requirements-header">
        <div><span>{t('requirements.eyebrow')}</span><h1>{t('requirements.title')}</h1><p>{t('requirements.description')}</p></div>
        <div className="requirements-header__analysis">
          {refreshing
            ? <button className="vc-btn vc-btn--secondary" type="button" onClick={cancelRefresh}>{t('requirements.cancelAnalysis')}</button>
            : <button className="vc-btn vc-btn--secondary" type="button" onClick={refresh}>{t('requirements.refresh')}</button>}
          {refreshing && <p className="requirements-header__scan" role="status"><span className="requirements-header__scan-dot" aria-hidden="true" />{t('requirements.refreshing')}<small aria-live="off">{scanProgress ? t('requirements.scanDetail', { count: scanProgress.entriesVisited, found: scanProgress.foundCount }) : ''}</small></p>}
        </div>
      </header>
      <section className="requirements-assurance"><span aria-hidden="true">R</span><div><strong>{t('requirements.readOnlyTitle')}</strong><p>{t('requirements.readOnlyCopy')}</p></div></section>
      <div className="requirements-summary">
        <article><span>{t('requirements.pending')}</span><strong>{pending.length}</strong></article>
        <article><span>{t('requirements.blocking')}</span><strong>{blocking}</strong></article>
        <article><span>{t('requirements.lastAnalysis')}</span><strong>{project.workspace?.analyzedAt ? formatDate(project.workspace.analyzedAt, { dateStyle: 'medium', timeStyle: 'short' }) : t('requirements.notAvailable')}</strong></article>
      </div>
      {error && <div className="vc-state vc-state--error requirements-error" role="alert"><strong>{t('requirements.problem')}</strong><p>{error}</p></div>}
      {loading ? <div className="requirements-loading" role="status">{t('requirements.loading')}</div> : items.length === 0 ? <div className="requirements-empty"><strong>{t('requirements.emptyTitle')}</strong><p>{t('requirements.emptyCopy')}</p></div> : <section className="requirements-list" aria-label={t('requirements.listLabel')}>
        {items.map((item) => <article key={item.id} className={`requirement-card is-${item.status}`}>
          <div className={`requirement-card__icon is-${item.severity}`} aria-hidden="true">{item.status === 'completed' ? '+' : item.severity === 'blocking' ? '!' : 'i'}</div>
          <div className="requirement-card__body"><div><span>{t(`requirements.severity.${item.severity}`)}</span><h2>{t(`requirements.types.${item.type}.title`)}</h2></div><p>{t(`requirements.types.${item.type}.copy`, { count: item.detail?.count || 0, path: item.relativePath })}</p>{item.type === 'CONFIGURE_ENVIRONMENT' && <div className="requirement-card__names">{item.detail.names.slice(0, 8).map((name) => <code key={name}>{name}</code>)}</div>}<small>{t(`requirements.status.${item.status}`)}</small></div>
          {item.status === 'pending' && <button className="vc-btn vc-btn--secondary" type="button" onClick={() => review(item)}>{t('requirements.reviewAction')}</button>}
        </article>)}
      </section>}
      <ActionConsentDialog preview={preview} busy={applying} progress={actionProgress} retry={actionRetry} error={actionError} copied={copied} onApply={apply} onRetry={retryVerification} onCancel={closePreview} onCopy={copyGuidance} onNavigate={navigate} />
    </div>
  );
}
