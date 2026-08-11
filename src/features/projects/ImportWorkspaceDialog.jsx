import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useI18n } from '../../i18n/I18nContext';
import './ImportWorkspaceDialog.css';

const CONFIDENCE_KEYS = { high: 'highConfidence', strong: 'strongConfidence', medium: 'mediumConfidence', low: 'lowConfidence' };
const SECTIONS = ['audit', 'structure', 'setup'];

function StatusMark({ status }) {
  return <span className={`import-status import-status--${status}`} aria-hidden="true" />;
}

export default function ImportWorkspaceDialog({ selection, onCancel, onImported, onChooseAnother }) {
  const { t } = useI18n();
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const tabsRef = useRef(null);
  const delayedCancelRef = useRef(null);
  const analysisStarted = useRef(false);
  const [phase, setPhase] = useState('analyzing');
  const [section, setSection] = useState('audit');
  const [analysis, setAnalysis] = useState(null);
  const [plan, setPlan] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [retryable, setRetryable] = useState(false);
  const [canReturnToReview, setCanReturnToReview] = useState(false);
  const busy = ['analyzing', 'planning', 'importing'].includes(phase);
  const locked = phase === 'importing';

  useFocusTrap({ active: Boolean(selection), containerRef: dialogRef, onEscape: locked ? undefined : onCancel, initialFocusRef: titleRef });

  useEffect(() => {
    if (delayedCancelRef.current) clearTimeout(delayedCancelRef.current);
    const root = document.getElementById('root');
    if (root) { root.inert = true; root.setAttribute('aria-hidden', 'true'); }
    return () => {
      delayedCancelRef.current = setTimeout(() => window.electronAPI.projects.cancelImport(selection.id).catch(() => {}), 0);
      if (root) { root.inert = false; root.removeAttribute('aria-hidden'); }
    };
  }, [selection.id]);

  const acceptAnalysis = (result) => {
    setAnalysis(result);
    setPlan(null);
    setSelectedTargetId(result.recommendedTargetId || '');
    setAcknowledged(!result.projectAssessment?.requiresAcknowledgement);
    setSection('audit');
    setPhase('review');
  };

  const analyze = () => {
    setError('');
    setCanReturnToReview(false);
    setPhase('analyzing');
    window.electronAPI.projects.analyzeImport(selection.id)
      .then(acceptAnalysis)
      .catch((reason) => { setRetryable(true); setError(reason?.message || t('importWorkspace.analysisFailed')); setPhase('error'); });
  };

  useEffect(() => {
    if (!selection || analysisStarted.current) return;
    analysisStarted.current = true;
    analyze();
  }, [selection]);

  const close = () => {
    if (locked) return;
    window.electronAPI.projects.cancelImport(selection.id).catch(() => {});
    onCancel();
  };

  const preparePlan = async () => {
    if (!selectedTargetId || phase !== 'review') return;
    setPhase('planning');
    setRetryable(false);
    setCanReturnToReview(false);
    setError('');
    try {
      const result = await window.electronAPI.projects.planImport(selection.id, {
        primaryTargetId: selectedTargetId,
        acknowledgeLowConfidence: acknowledged,
      });
      setPlan(result);
      setPhase('plan');
    } catch (reason) {
      setRetryable(true);
      setCanReturnToReview(true);
      setError(reason?.message || t('importWorkspace.planFailed'));
      setPhase('error');
    }
  };

  const confirm = async () => {
    if (!plan?.planId || phase !== 'plan') return;
    setPhase('importing');
    setCanReturnToReview(false);
    setError('');
    try {
      const result = await window.electronAPI.projects.confirmImport(selection.id, plan.planId);
      onImported(result.project);
    } catch (reason) {
      setRetryable(true);
      setError(reason?.message || t('importWorkspace.importFailed'));
      setPhase('error');
    }
  };

  const readiness = analysis?.readiness;
  const assessment = analysis?.projectAssessment;
  const selectedTarget = analysis?.targets.find((target) => target.id === selectedTargetId);
  const canPlan = phase === 'review' && selectedTargetId && (!assessment?.requiresAcknowledgement || acknowledged);
  const handleSectionKeyDown = (event) => {
    const current = SECTIONS.indexOf(section);
    let next = null;
    if (event.key === 'ArrowRight') next = (current + 1) % SECTIONS.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + SECTIONS.length) % SECTIONS.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = SECTIONS.length - 1;
    if (next === null) return;
    event.preventDefault();
    setSection(SECTIONS[next]);
    requestAnimationFrame(() => tabsRef.current?.querySelectorAll('[role="tab"]')[next]?.focus());
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
        {phase === 'planning' && <div className="import-workspace__loading" role="status" aria-live="polite"><span className="import-workspace__spinner" /><h3>{t('importWorkspace.preparingPlan')}</h3><p>{t('importWorkspace.preparingPlanCopy')}</p></div>}

        {phase === 'review' && analysis && <div className="import-workspace__review">
          <div className="import-workspace__assessment">
            <div className={`import-workspace__score import-workspace__score--${assessment.classification}`}><strong>{assessment.score}</strong><span>/ 100</span></div>
            <div><span>{t('importWorkspace.assessment')}</span><h3>{t(`importWorkspace.classifications.${assessment.classification}`)}</h3><p>{t(`importWorkspace.readiness.${readiness.status}`)}</p></div>
            <span className={`import-workspace__readiness import-workspace__readiness--${readiness.status}`}>{t(`importWorkspace.readinessLabels.${readiness.status}`)}</span>
          </div>

          <div ref={tabsRef} className="import-workspace__tabs" role="tablist" aria-label={t('importWorkspace.reviewSections')} onKeyDown={handleSectionKeyDown}>
            {SECTIONS.map((item) => <button key={item} id={`import-workspace-tab-${item}`} type="button" role="tab" tabIndex={section === item ? 0 : -1} aria-selected={section === item} aria-controls={`import-workspace-panel-${item}`} className={section === item ? 'is-active' : ''} onClick={() => setSection(item)}>{t(`importWorkspace.sections.${item}`)}</button>)}
          </div>

          {section === 'audit' && <div id="import-workspace-panel-audit" className="import-workspace__panel" role="tabpanel" aria-labelledby="import-workspace-tab-audit">
            <div className="import-workspace__summary">
              <div><span>{t('importWorkspace.layout')}</span><strong>{t(`importWorkspace.layouts.${analysis.layout}`)}</strong></div>
              <div><span>{t('importWorkspace.detectedApps')}</span><strong>{analysis.targets.length}</strong></div>
              <div><span>{t('importWorkspace.packageManagers')}</span><strong>{analysis.packageManagers.join(', ') || t('importWorkspace.noneDetected')}</strong></div>
            </div>
            <div className="import-workspace__checks">
              {readiness.checks.map((check) => <div key={check.id}><StatusMark status={check.status} /><span><strong>{t(`importWorkspace.checks.${check.id}`)}</strong><small>{t(`importWorkspace.checkStatuses.${check.status}`, { count: check.count || 0 })}</small></span></div>)}
            </div>
            {assessment.requiresAcknowledgement && <label className="import-workspace__acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span><strong>{t('importWorkspace.confirmFolder')}</strong><small>{t('importWorkspace.confirmFolderCopy')}</small></span></label>}
            {analysis.warnings.length > 0 && <div className="import-workspace__warnings"><strong>{t('importWorkspace.partialAnalysis')}</strong><p>{t('importWorkspace.partialAnalysisCopy')}</p></div>}
          </div>}

          {section === 'structure' && <div id="import-workspace-panel-structure" className="import-workspace__panel" role="tabpanel" aria-labelledby="import-workspace-tab-structure">
            <fieldset className="import-workspace__targets">
              <legend>{t('importWorkspace.primaryTarget')}</legend>
              <p>{t('importWorkspace.primaryTargetCopy')}</p>
              {analysis.targets.map((target) => <label key={target.id} className={`import-target ${selectedTargetId === target.id ? 'is-selected' : ''}`}>
                <input type="radio" name="primary-target" value={target.id} checked={selectedTargetId === target.id} onChange={() => setSelectedTargetId(target.id)} />
                <span className="import-target__marker" />
                <span className="import-target__body"><span className="import-target__heading"><strong>{target.name}</strong><em>{t(`importWorkspace.${CONFIDENCE_KEYS[target.confidence] || 'lowConfidence'}`)}</em></span><code>{target.relativePath}</code><span>{target.framework || target.kind} · {target.language || t('importWorkspace.languageUnknown')}</span><small>{target.capabilities.webPreview ? t('importWorkspace.webPreviewReady') : target.capabilities.androidPreview ? t('importWorkspace.androidPreviewReady') : t('importWorkspace.editingOnly')}</small></span>
              </label>)}
            </fieldset>
            {(analysis.workspaceSignals.length > 0 || analysis.services.length > 0) && <div className="import-workspace__signals"><span>{t('importWorkspace.detectedTools')}</span><p>{[...analysis.workspaceSignals, ...analysis.services].join(' · ')}</p></div>}
          </div>}

          {section === 'setup' && <div id="import-workspace-panel-setup" className="import-workspace__panel" role="tabpanel" aria-labelledby="import-workspace-tab-setup">
            <div className="import-workspace__inventory">
              <article><span>{t('importWorkspace.dependencies')}</span><strong>{analysis.dependencies.reduce((total, item) => total + item.groups.reduce((count, group) => count + group.count, 0), 0)}</strong><p>{analysis.dependencies.some((item) => item.installState === 'install-needed') ? t('importWorkspace.dependenciesMissing') : t('importWorkspace.dependenciesReady')}</p></article>
              <article><span>{t('importWorkspace.scripts')}</span><strong>{analysis.scripts.length}</strong><p>{analysis.scripts.slice(0, 6).map((item) => item.name).join(' · ') || t('importWorkspace.noneDetected')}</p></article>
              <article><span>{t('importWorkspace.environment')}</span><strong>{analysis.environment.names.length}</strong><p>{analysis.environment.names.slice(0, 6).map((item) => item.name).join(' · ') || t('importWorkspace.noneDetected')}</p></article>
              <article><span>{t('importWorkspace.runtimes')}</span><strong>{analysis.runtimes.length}</strong><p>{analysis.runtimes.map((item) => item.runtime).filter((value, index, values) => values.indexOf(value) === index).join(' · ') || t('importWorkspace.noneDetected')}</p></article>
            </div>
            <div className="import-workspace__facts">
              <div><span>{t('importWorkspace.gitRepository')}</span><strong>{analysis.git.detected ? t('importWorkspace.detected') : t('importWorkspace.notDetected')}</strong></div>
              <div><span>{t('importWorkspace.integrations')}</span><strong>{analysis.integrations.map((item) => item.name).join(', ') || t('importWorkspace.noneDetected')}</strong></div>
              <div><span>{t('importWorkspace.preview')}</span><strong>{selectedTarget?.capabilities.webPreview || selectedTarget?.capabilities.androidPreview ? t('importWorkspace.managed') : t('importWorkspace.manual')}</strong></div>
            </div>
            {readiness.recommendations.length > 0 && <div className="import-workspace__recommendations"><strong>{t('importWorkspace.nextActions')}</strong><ul>{readiness.recommendations.map((item) => <li key={item}>{t(`importWorkspace.recommendations.${item}`)}</li>)}</ul></div>}
          </div>}
        </div>}

        {(phase === 'plan' || phase === 'importing') && plan && <div className="import-workspace__review import-workspace__plan">
          <div className="import-workspace__plan-heading"><span>{t('importWorkspace.planEyebrow')}</span><h3>{t('importWorkspace.planTitle')}</h3><p>{t('importWorkspace.planCopy')}</p></div>
          <div className="import-workspace__operations">{plan.operations.map((operation) => <article key={operation.id}><StatusMark status="ready" /><div><strong>{t(`importWorkspace.operations.${operation.type}.title`)}</strong><p>{t(`importWorkspace.operations.${operation.type}.copy`)}</p></div><span>{t('importWorkspace.localOnly')}</span></article>)}</div>
          <div className="import-workspace__guarantees"><strong>{t('importWorkspace.guaranteesTitle')}</strong><span>{t('importWorkspace.noSourceChanges')}</span><span>{t('importWorkspace.noCommands')}</span><span>{t('importWorkspace.noSecrets')}</span></div>
        </div>}

        {phase === 'error' && <div className="vc-state vc-state--error import-workspace__error" role="alert"><strong className="vc-state__title">{t('importWorkspace.problem')}</strong><p>{error}</p></div>}

        <footer className="import-workspace__footer">
          <p aria-live="polite">{phase === 'importing' ? t('importWorkspace.importingStatus') : phase === 'plan' ? t('importWorkspace.planFooter') : t('importWorkspace.footerCopy')}</p>
          <div>
            {(phase === 'review' || phase === 'error') && <button className="vc-btn vc-btn--ghost" type="button" onClick={onChooseAnother}>{t('importWorkspace.chooseAnother')}</button>}
            {phase === 'plan' && <button className="vc-btn vc-btn--ghost" type="button" onClick={() => setPhase('review')}>{t('common.back')}</button>}
            {phase === 'error' && canReturnToReview && <button className="vc-btn vc-btn--ghost" type="button" onClick={() => setPhase('review')}>{t('common.back')}</button>}
            {phase === 'error' && retryable && <button className="vc-btn vc-btn--ghost" type="button" onClick={analyze}>{t('projects.retry')}</button>}
            <button className="vc-btn vc-btn--ghost" type="button" onClick={close} disabled={locked}>{t('common.cancel')}</button>
            {phase === 'review' && <button className="vc-btn vc-btn--primary" type="button" onClick={preparePlan} disabled={!canPlan}>{t('importWorkspace.reviewPlan')}</button>}
            {(phase === 'plan' || phase === 'importing') && <button className="vc-btn vc-btn--primary" type="button" onClick={confirm} disabled={phase !== 'plan'} aria-busy={phase === 'importing'}>{phase === 'importing' ? t('importWorkspace.importing') : t('importWorkspace.applyPlan')}</button>}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
