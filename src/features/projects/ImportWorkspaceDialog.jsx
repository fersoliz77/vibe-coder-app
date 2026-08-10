import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useI18n } from '../../i18n/I18nContext';
import './ImportWorkspaceDialog.css';

const CONFIDENCE_KEYS = { high: 'highConfidence', strong: 'strongConfidence', medium: 'mediumConfidence', low: 'lowConfidence' };

export default function ImportWorkspaceDialog({ selection, onCancel, onImported, onChooseAnother }) {
  const { t } = useI18n();
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const analysisStarted = useRef(false);
  const [phase, setPhase] = useState('analyzing');
  const [analysis, setAnalysis] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [error, setError] = useState('');
  const [retryable, setRetryable] = useState(false);
  const busy = phase === 'analyzing' || phase === 'importing';
  const locked = phase === 'importing';

  useFocusTrap({ active: Boolean(selection), containerRef: dialogRef, onEscape: locked ? undefined : onCancel, initialFocusRef: titleRef });

  useEffect(() => {
    const root = document.getElementById('root');
    if (root) { root.inert = true; root.setAttribute('aria-hidden', 'true'); }
    return () => {
      window.electronAPI.projects.cancelImport(selection.id).catch(() => {});
      if (root) { root.inert = false; root.removeAttribute('aria-hidden'); }
    };
  }, [selection.id]);

  useEffect(() => {
    if (!selection || analysisStarted.current) return;
    analysisStarted.current = true;
    window.electronAPI.projects.analyzeImport(selection.id)
      .then((result) => {
        setAnalysis(result);
        setSelectedTargetId(result.recommendedTargetId || '');
        setPhase('review');
      })
      .catch((reason) => { setRetryable(true); setError(reason?.message || t('importWorkspace.analysisFailed')); setPhase('error'); });
  }, [selection, t]);

  const close = () => {
    if (locked) return;
    window.electronAPI.projects.cancelImport(selection.id).catch(() => {});
    onCancel();
  };

  const confirm = async () => {
    if (!selectedTargetId || phase !== 'review') return;
    setPhase('importing');
    setRetryable(false);
    setError('');
    try {
      const result = await window.electronAPI.projects.confirmImport(selection.id, selectedTargetId);
      onImported(result.project);
    } catch (reason) {
      setRetryable(false);
      setError(reason?.message || t('importWorkspace.importFailed'));
      setPhase('error');
    }
  };

  const retry = () => {
    analysisStarted.current = false;
    setError('');
    setPhase('analyzing');
    window.electronAPI.projects.analyzeImport(selection.id)
      .then((result) => { setAnalysis(result); setSelectedTargetId(result.recommendedTargetId || ''); setPhase('review'); })
      .catch((reason) => { setRetryable(true); setError(reason?.message || t('importWorkspace.analysisFailed')); setPhase('error'); });
  };

  return createPortal(
    <div className="vc-overlay import-workspace__overlay" onMouseDown={locked ? undefined : close}>
      <section ref={dialogRef} className="vc-modal import-workspace" role="dialog" aria-modal="true" aria-labelledby="import-workspace-title" aria-describedby="import-workspace-description" aria-busy={busy} onMouseDown={(event) => event.stopPropagation()}>
        <header className="import-workspace__header">
          <div><span>{t('importWorkspace.eyebrow')}</span><h2 id="import-workspace-title" ref={titleRef} tabIndex="-1">{t('importWorkspace.title')}</h2><p id="import-workspace-description">{t('importWorkspace.description')}</p></div>
          <button className="vc-btn vc-btn--ghost vc-btn--icon" type="button" onClick={close} disabled={locked} aria-label={t('common.close')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
        </header>

        <div className="import-workspace__source"><span>{selection.name}</span><code title={selection.path}>{selection.path}</code><small>{t('importWorkspace.readOnly')}</small></div>

        {phase === 'analyzing' && <div className="import-workspace__loading" role="status" aria-live="polite"><span className="import-workspace__spinner" /><h3>{t('importWorkspace.analyzing')}</h3><p>{t('importWorkspace.analyzingCopy')}</p></div>}

        {(phase === 'review' || phase === 'importing') && analysis && <div className="import-workspace__review">
          <div className="import-workspace__summary">
            <div><span>{t('importWorkspace.layout')}</span><strong>{t(`importWorkspace.layouts.${analysis.layout}`)}</strong></div>
            <div><span>{t('importWorkspace.detectedApps')}</span><strong>{analysis.targets.length}</strong></div>
            <div><span>{t('importWorkspace.packageManagers')}</span><strong>{analysis.packageManagers.join(', ') || t('importWorkspace.noneDetected')}</strong></div>
          </div>
          <fieldset className="import-workspace__targets" disabled={phase === 'importing'}>
            <legend>{t('importWorkspace.primaryTarget')}</legend>
            <p>{t('importWorkspace.primaryTargetCopy')}</p>
            {analysis.targets.map((target) => <label key={target.id} className={`import-target ${selectedTargetId === target.id ? 'is-selected' : ''}`}>
              <input type="radio" name="primary-target" value={target.id} checked={selectedTargetId === target.id} onChange={() => setSelectedTargetId(target.id)} />
              <span className="import-target__marker" />
              <span className="import-target__body"><span className="import-target__heading"><strong>{target.name}</strong><em>{t(`importWorkspace.${CONFIDENCE_KEYS[target.confidence] || 'lowConfidence'}`)}</em></span><code>{target.relativePath}</code><span>{target.framework || target.kind} · {target.language || t('importWorkspace.languageUnknown')}</span><small>{target.capabilities.webPreview ? t('importWorkspace.webPreviewReady') : target.capabilities.androidPreview ? t('importWorkspace.androidPreviewReady') : t('importWorkspace.editingOnly')}</small></span>
            </label>)}
          </fieldset>
          {(analysis.workspaceSignals.length > 0 || analysis.services.length > 0) && <div className="import-workspace__signals"><span>{t('importWorkspace.detectedTools')}</span><p>{[...analysis.workspaceSignals, ...analysis.services].join(' · ')}</p></div>}
          {analysis.warnings.length > 0 && <div className="import-workspace__warnings"><strong>{t('importWorkspace.partialAnalysis')}</strong><p>{t('importWorkspace.partialAnalysisCopy')}</p></div>}
        </div>}

        {phase === 'error' && <div className="vc-state vc-state--error import-workspace__error" role="alert"><strong className="vc-state__title">{t('importWorkspace.problem')}</strong><p>{error}</p></div>}

        <footer className="import-workspace__footer">
          <p aria-live="polite">{phase === 'importing' ? t('importWorkspace.importingStatus') : t('importWorkspace.footerCopy')}</p>
          <div>
            <button className="vc-btn vc-btn--ghost" type="button" onClick={onChooseAnother} disabled={locked}>{t('importWorkspace.chooseAnother')}</button>
            {phase === 'error' && retryable && <button className="vc-btn vc-btn--ghost" type="button" onClick={retry}>{t('projects.retry')}</button>}
            <button className="vc-btn vc-btn--ghost" type="button" onClick={close} disabled={locked}>{t('common.cancel')}</button>
            <button className="vc-btn vc-btn--primary" type="button" onClick={confirm} disabled={phase !== 'review' || !selectedTargetId} aria-busy={phase === 'importing'}>{phase === 'importing' ? t('importWorkspace.importing') : t('importWorkspace.import')}</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
