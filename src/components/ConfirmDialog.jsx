import { useRef } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import './ConfirmDialog.css';

/**
 * Confirmacion para acciones que no se deshacen.
 *
 * Ademas de preguntar, aisla el foco mientras esta abierto (ver useFocusTrap).
 * El boton enfocado al abrir es el de cancelar: la accion destructiva no debe
 * dispararse por un Enter de mas.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  detail,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}) {
  const { t } = useI18n();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);

  useFocusTrap({ active: open, containerRef: dialogRef, onEscape: onCancel, initialFocusRef: cancelRef });

  if (!open) return null;

  return (
    <div className="confirm-dialog__backdrop" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 className="confirm-dialog__title" id="confirm-dialog-title">{title}</h3>
        <p className="confirm-dialog__text" id="confirm-dialog-description">{description}</p>
        {detail && <p className="confirm-dialog__detail">{detail}</p>}
        <div className="confirm-dialog__actions">
          <button ref={cancelRef} className="btn btn--small" type="button" onClick={onCancel}>
            {cancelLabel || t('common.cancel')}
          </button>
          <button
            className={`btn btn--small btn--${tone === 'danger' ? 'danger' : 'primary'}`}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
