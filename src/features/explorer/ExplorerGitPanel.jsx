import { isStagedCode, toAbsoluteProjectPath } from './explorerUtils';
import { describeGitCode, gitStageKey } from './gitStatusMeaning';
import { useI18n } from '../../i18n/I18nContext';

export function ExplorerGitPanel({
  gitStatus,
  gitStatusError,
  stagedEntries,
  loadGitStatus,
  openCommitAction,
  openPreview,
  handleGitStageToggle,
  projectPath,
}) {
  const { t } = useI18n();
  return (
    <div className="file-explorer__git-panel">
      <div className="file-explorer__git-header">
        <div className="file-explorer__git-title">{t('explorer.changes')}</div>
        <div className="file-explorer__git-actions">
          <button className="file-explorer__git-btn" type="button" onClick={loadGitStatus}>{t('services.refresh')}</button>
          <button className="file-explorer__git-btn" type="button" onClick={openCommitAction} disabled={stagedEntries.length === 0}>{t('explorer.commit')}</button>
        </div>
      </div>
      {gitStatusError ? (
        <div className="file-explorer__git-empty">{gitStatusError}</div>
      ) : gitStatus.length === 0 ? (
        <div className="file-explorer__git-empty">{t('explorer.workingTreeClean')}</div>
      ) : (
        <div className="file-explorer__git-list">
          {gitStatus.slice(0, 40).map((entry) => {
            const meaning = describeGitCode(entry.code);
            const label = t(`explorer.git.${meaning.key}`);
            const help = t(`explorer.git.${gitStageKey(meaning)}`);
            return (
              <div key={`${entry.code}:${entry.path}`} className="file-explorer__git-row">
                <button
                  className="file-explorer__git-item"
                  type="button"
                  /* El codigo crudo queda a mano para quien ya sabe Git. */
                  title={`${label} — ${help} (${entry.code.trim() || entry.code})`}
                  onClick={() => openPreview(toAbsoluteProjectPath(projectPath, entry.path))}
                >
                  <span className={`file-explorer__git-code file-explorer__git-code--${meaning.tone}`}>
                    {label}
                  </span>
                  <span className="file-explorer__git-path">{entry.path}</span>
                </button>
                <button className="file-explorer__git-btn" type="button" onClick={() => handleGitStageToggle(entry)}>
                  {isStagedCode(entry.code) ? t('explorer.unstage') : t('explorer.stage')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
