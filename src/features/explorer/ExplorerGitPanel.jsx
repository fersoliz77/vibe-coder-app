import { isStagedCode, toAbsoluteProjectPath } from './explorerUtils';

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
  return (
    <div className="file-explorer__git-panel">
      <div className="file-explorer__git-header">
        <div className="file-explorer__git-title">Changes</div>
        <div className="file-explorer__git-actions">
          <button className="file-explorer__git-btn" type="button" onClick={loadGitStatus}>Refresh</button>
          <button className="file-explorer__git-btn" type="button" onClick={openCommitAction} disabled={stagedEntries.length === 0}>Commit</button>
        </div>
      </div>
      {gitStatusError ? (
        <div className="file-explorer__git-empty">{gitStatusError}</div>
      ) : gitStatus.length === 0 ? (
        <div className="file-explorer__git-empty">Working tree clean</div>
      ) : (
        <div className="file-explorer__git-list">
          {gitStatus.slice(0, 40).map((entry) => (
            <div key={`${entry.code}:${entry.path}`} className="file-explorer__git-row">
              <button className="file-explorer__git-item" type="button" onClick={() => openPreview(toAbsoluteProjectPath(projectPath, entry.path))}>
                <span className="file-explorer__git-code">{entry.code}</span>
                <span className="file-explorer__git-path">{entry.path}</span>
              </button>
              <button className="file-explorer__git-btn" type="button" onClick={() => handleGitStageToggle(entry)}>
                {isStagedCode(entry.code) ? 'Unstage' : 'Stage'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
