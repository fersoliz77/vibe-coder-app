import { useEffect, useState } from 'react';

export function ActionModal({ action, onClose, onConfirm }) {
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
    'new-file': 'Create File',
    'new-folder': 'Create Folder',
    delete: `Delete ${action.node?.isDirectory ? 'Folder' : 'File'}`,
    'bulk-delete': 'Delete Selected Items',
    'git-commit': 'Create Commit',
  };

  return (
    <div className="file-modal-backdrop" onClick={onClose}>
      <div className="file-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="file-modal__title">{titles[action.type]}</h3>
        {isDelete || isBulkDelete ? (
          <p className="file-modal__text">
            {isBulkDelete ? `This permanently deletes ${action.count} selected items.` : <>This permanently deletes <strong>{action.node?.name}</strong>.</>}
          </p>
        ) : (
          <>
            <p className="file-modal__text">{isCommit ? 'Write a commit message for the staged changes.' : action.targetDir}</p>
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
          <button className="btn btn--small" type="button" onClick={onClose}>Cancel</button>
          <button className={`btn btn--small ${(isDelete || isBulkDelete) ? 'btn--danger' : 'btn--primary'}`} type="button" onClick={() => onConfirm(value.trim())} disabled={!isDelete && !isBulkDelete && !value.trim()}>
            {(isDelete || isBulkDelete) ? 'Delete' : isCommit ? 'Commit' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmModal({ state, onCancel, onConfirm }) {
  if (!state) return null;

  return (
    <div className="file-modal-backdrop" onClick={onCancel}>
      <div className="file-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="file-modal__title">Unsaved Changes</h3>
        <p className="file-modal__text">{state.message}</p>
        <div className="file-modal__actions">
          <button className="btn btn--small" type="button" onClick={onCancel}>Keep Editing</button>
          <button className="btn btn--small btn--danger" type="button" onClick={onConfirm}>Discard</button>
        </div>
      </div>
    </div>
  );
}
