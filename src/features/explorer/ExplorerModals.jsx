import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export function ActionModal({ action, onClose, onConfirm }) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const dialogRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!action) return;
    setValue('');
  }, [action]);

  useFocusTrap({
    active: Boolean(action),
    containerRef: dialogRef,
    onEscape: onClose,
    initialFocusRef: inputRef,
  });

  if (!action) return null;

  const isDelete = action.type === 'delete';
  const isBulkDelete = action.type === 'bulk-delete';
  const isCommit = action.type === 'git-commit';
  const titles = {
    'new-file': t('explorer.createFile'),
    'new-folder': t('explorer.createFolder'),
    delete: action.node?.isDirectory ? t('explorer.deleteFolder') : t('explorer.deleteFile'),
    'bulk-delete': t('explorer.deleteSelected'),
    'git-commit': t('explorer.createCommit'),
  };

  return (
    <div className="file-modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="file-modal"
        role={(isDelete || isBulkDelete) ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="file-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="file-modal__title" id="file-modal-title">{titles[action.type]}</h3>
        {isDelete || isBulkDelete ? (
          <p className="file-modal__text">
            {isBulkDelete ? t('explorer.deleteSelectedCopy', { count: action.count }) : t('explorer.deleteCopy', { name: action.node?.name })}
          </p>
        ) : (
          <>
            <p className="file-modal__text">{isCommit ? t('explorer.commitCopy') : action.targetDir}</p>
            <input
              ref={inputRef}
              className="file-modal__input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={isCommit ? 'feat: update project files' : action.type === 'new-folder' ? 'components' : 'index.tsx'}
            />
          </>
        )}
        <div className="file-modal__actions">
          <button className="btn btn--small" type="button" onClick={onClose}>{t('explorer.cancel')}</button>
          <button className={`btn btn--small ${(isDelete || isBulkDelete) ? 'btn--danger' : 'btn--primary'}`} type="button" onClick={() => onConfirm(value.trim())} disabled={!isDelete && !isBulkDelete && !value.trim()}>
            {(isDelete || isBulkDelete) ? t('explorer.delete') : isCommit ? t('explorer.commit') : t('explorer.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmModal({ state, onCancel, onConfirm }) {
  const { t } = useI18n();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);

  // Enfoca "seguir editando": descartar cambios no debe salir por inercia.
  useFocusTrap({
    active: Boolean(state),
    containerRef: dialogRef,
    onEscape: onCancel,
    initialFocusRef: cancelRef,
  });

  if (!state) return null;

  return (
    <div className="file-modal-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="file-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-description"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="file-modal__title" id="confirm-modal-title">{t('explorer.unsavedChanges')}</h3>
        <p className="file-modal__text" id="confirm-modal-description">{state.message}</p>
        <div className="file-modal__actions">
          <button ref={cancelRef} className="btn btn--small" type="button" onClick={onCancel}>{t('explorer.keepEditing')}</button>
          <button className="btn btn--small btn--danger" type="button" onClick={onConfirm}>{t('explorer.discard')}</button>
        </div>
      </div>
    </div>
  );
}
