import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useI18n } from '../../i18n/I18nContext';

function Effect({ active, label }) {
  return <li className={active ? 'is-active' : ''}><span aria-hidden="true">{active ? '!' : '-'}</span>{label}</li>;
}

function elapsedTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function fileSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`;
}

const ACTION_COPY = {
  en: { diskTitle: 'Disk check', disk: (size) => `At least ${size} free is required.`, retry: 'Retry verification' },
  es: { diskTitle: 'Revisión de espacio', disk: (size) => `Se requieren al menos ${size} libres.`, retry: 'Reintentar verificación' },
};

export default function ActionConsentDialog({ preview, busy, progress, retry, error, copied, onApply, onRetry, onCancel, onCopy, onNavigate }) {
  const { language, t } = useI18n();
  const actionCopy = ACTION_COPY[language] || ACTION_COPY.en;
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const [confirmed, setConfirmed] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const action = preview?.action;
  useFocusTrap({ active: Boolean(preview), containerRef: dialogRef, onEscape: busy ? undefined : onCancel, initialFocusRef: cancelRef });

  useEffect(() => setConfirmed(false), [preview?.requirementId]);
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [busy]);
  if (!preview || !action) return null;
  const command = action.display?.tool && Array.isArray(action.display.args) ? [action.display.tool, ...action.display.args].join(' ') : null;

  return createPortal(
    <div className="requirement-consent__backdrop" onMouseDown={busy ? undefined : onCancel}>
      <section ref={dialogRef} className="requirement-consent" role="alertdialog" aria-modal="true" aria-labelledby="requirement-consent-title" aria-describedby="requirement-consent-description" onMouseDown={(event) => event.stopPropagation()}>
        <header><span>{t('requirements.consentEyebrow')}</span><h2 id="requirement-consent-title">{t(`requirements.actions.${action.actionType}.title`)}</h2><p id="requirement-consent-description">{t(`requirements.actions.${action.actionType}.copy`)}</p></header>
        {command && <div className="requirement-consent__command"><span>{t('requirements.exactCommand')}</span><code>{command}</code><small>{t('requirements.commandLocation', { path: action.display.cwd })}</small></div>}
        {action.display?.requiredFreeBytes && <div className="requirement-consent__disk"><strong>{actionCopy.diskTitle}</strong><span>{actionCopy.disk(fileSize(action.display.requiredFreeBytes))}</span></div>}
        {Array.isArray(action.display?.names) && action.display.names.length > 0 && <div className="requirement-consent__names"><span>{t('requirements.requiredNames')}</span><div>{action.display.names.map((name) => <code key={name}>{name}</code>)}</div></div>}
        <div className="requirement-consent__effects"><strong>{t('requirements.effectsTitle')}</strong><ul>
          <Effect active={action.effects.projectFilesMayChange} label={t('requirements.effects.projectFiles')} />
          <Effect active={action.effects.dependencyDirectoryMayChange} label={t('requirements.effects.dependencies')} />
          <Effect active={action.effects.temporaryCacheMayChange} label={t('requirements.effects.temporaryCache')} />
          <Effect active={action.effects.networkAccess} label={t('requirements.effects.network')} />
          <Effect active={action.effects.projectCodeMayExecute} label={t('requirements.effects.projectCode')} />
          <Effect active={action.effects.appMetadataChanges} label={t('requirements.effects.appMetadata')} />
        </ul></div>
        {action.warning && <div className="requirement-consent__warning"><strong>{t(`requirements.warnings.${action.warning}.title`)}</strong><p>{t(`requirements.warnings.${action.warning}.copy`)}</p></div>}
        {busy && progress && <div className="requirement-consent__progress" role="status" aria-live="polite">
          <div><strong>{t(`requirements.progress.${progress.stage}`)}</strong><span>{progress.percent}%</span></div>
          <div className="requirement-consent__progress-track" role="progressbar" aria-label={t('requirements.progressLabel')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div>
          <small>{t('requirements.elapsed', { time: elapsedTime(progress.startedAt ? clock - progress.startedAt : progress.elapsedMs || 0) })}{progress.estimate ? ` · ${t('requirements.estimatedDuration', { min: Math.ceil(progress.estimate.minSeconds / 60), max: Math.ceil(progress.estimate.maxSeconds / 60) })}` : ''}</small>
        </div>}
        {action.supported && <label className="requirement-consent__check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} /><span>{t('requirements.explicitConsent')}</span></label>}
        {error && <p className="requirement-consent__error" role="alert">{error}</p>}
        <footer>
          <button ref={cancelRef} className="vc-btn vc-btn--ghost" type="button" onClick={onCancel} disabled={busy}>{t('common.cancel')}</button>
          {!action.supported && action.copyable && <button className="vc-btn vc-btn--primary" type="button" onClick={onCopy}>{copied ? t('requirements.copied') : t('requirements.copyCommand')}</button>}
          {!action.supported && action.destination && <button className="vc-btn vc-btn--primary" type="button" onClick={() => onNavigate(action.destination)}>{t('requirements.openDestination')}</button>}
          {retry && <button className="vc-btn vc-btn--primary" type="button" onClick={onRetry} disabled={busy}>{actionCopy.retry}</button>}
          {action.supported && !retry && !error && <button className="vc-btn vc-btn--primary" type="button" onClick={onApply} disabled={!confirmed || busy} aria-busy={busy}>{busy ? t('requirements.applying') : t('requirements.applyThisAction')}</button>}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
