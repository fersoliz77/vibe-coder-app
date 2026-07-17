import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';

export function ActionModal({ action, onClose, onConfirm }) {
  const { t } = useI18n();
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!action) return;
    setValue('');
  }, [action]);

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
      <div className="file-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="file-modal__title">{titles[action.type]}</h3>
        {isDelete || isBulkDelete ? (
          <p className="file-modal__text">
            {isBulkDelete ? t('explorer.deleteSelectedCopy', { count: action.count }) : t('explorer.deleteCopy', { name: action.node?.name })}
          </p>
        ) : (
          <>
            <p className="file-modal__text">{isCommit ? t('explorer.commitCopy') : action.targetDir}</p>
            <input
              className="file-modal__input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={isCommit ? 'feat: update project files' : action.type === 'new-folder' ? 'components' : 'index.tsx'}
              autoFocus
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
  if (!state) return null;

  return (
    <div className="file-modal-backdrop" onClick={onCancel}>
      <div className="file-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="file-modal__title">{t('explorer.unsavedChanges')}</h3>
        <p className="file-modal__text">{state.message}</p>
        <div className="file-modal__actions">
          <button className="btn btn--small" type="button" onClick={onCancel}>{t('explorer.keepEditing')}</button>
          <button className="btn btn--small btn--danger" type="button" onClick={onConfirm}>{t('explorer.discard')}</button>
        </div>
      </div>
    </div>
  );
}
