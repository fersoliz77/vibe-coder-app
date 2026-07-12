import { lazy, Suspense } from 'react';
import { ExplorerPane } from './ExplorerPane';
import { formatBytes, getParentDirectory } from './explorerUtils';

const CodeEditor = lazy(() => import('./CodeEditor'));

export function ExplorerWorkspace({
  dirtyTabs,
  activePane,
  setPaneTabs,
  tabs,
  activeTabId,
  closeTab,
  reorderTabs,
  splitView,
  setSplitView,
  activeTab,
  projectPath,
  statusMessage,
  paneTabs,
  setActivePane,
  showDiff,
  setShowDiff,
  saveActiveTab,
  openExternal,
  revealFolder,
  savedHighlightedContent,
  highlightedContent,
  setTabs,
}) {
  return (
    <section className="file-explorer__workspace">
      <div className="file-explorer__editor-shell">
        {dirtyTabs.length > 0 && (
          <div className="file-explorer__changes-bar">
            <span className="file-explorer__changes-title">Unsaved</span>
            <div className="file-explorer__changes-list">
              {dirtyTabs.map((tab) => (
                <button key={`dirty:${tab.id}`} className="file-explorer__changes-item" type="button" onClick={() => setPaneTabs((prev) => ({ ...prev, [activePane]: tab.id }))}>
                  {tab.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="file-explorer__tabs">
          {tabs.length === 0 ? (
            <div className="file-explorer__tabs-empty">No file open</div>
          ) : tabs.map((tab) => {
            const dirty = tab.type === 'text' && tab.draftContent !== tab.savedContent;
            return (
              <div
                key={tab.id}
                className={`file-explorer__tab ${tab.id === activeTabId ? 'file-explorer__tab--active' : ''}`}
                onClick={() => setPaneTabs((prev) => ({ ...prev, [activePane]: tab.id }))}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('application/tab-id', tab.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => reorderTabs(event.dataTransfer.getData('application/tab-id'), tab.id)}
              >
                <span className="file-explorer__tab-name">{tab.name}</span>
                {dirty && <span className="file-explorer__tab-dirty" />}
                <button className="file-explorer__tab-close" type="button" onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}>x</button>
              </div>
            );
          })}
          <button className="file-explorer__split-toggle" type="button" onClick={() => setSplitView((value) => !value)}>{splitView ? 'Single' : 'Split'}</button>
        </div>

        {!activeTab && !splitView ? (
          <div className="file-explorer__workspace-card">
            <h2 className="file-explorer__workspace-title">Project Explorer</h2>
            <p className="file-explorer__workspace-text">Virtualized tree, multi-select, Git changes, split editor, drag-and-drop tabs, and full project file actions are all active now.</p>
            <p className="file-explorer__workspace-path">{projectPath}</p>
            {statusMessage && <p className="file-explorer__status">{statusMessage}</p>}
          </div>
        ) : (
          <div className={`file-explorer__panes ${splitView ? 'file-explorer__panes--split' : ''}`}>
            {['primary', ...(splitView ? ['secondary'] : [])].map((paneKey) => {
              const paneTab = tabs.find((tab) => tab.id === paneTabs[paneKey]) || null;
              return (
                <ExplorerPane key={paneKey} title={paneKey === 'primary' ? 'Primary' : 'Secondary'} active={activePane === paneKey} onActivate={() => setActivePane(paneKey)}>
                  {!paneTab ? (
                    <div className="file-explorer__workspace-card file-explorer__workspace-card--empty">
                      <p className="file-explorer__workspace-text">Select a file to open it in the {paneKey} pane.</p>
                      {statusMessage && paneKey === 'primary' && <p className="file-explorer__status">{statusMessage}</p>}
                    </div>
                  ) : (
                    <div className="file-explorer__preview">
                      <div className="file-explorer__preview-header">
                        <div>
                          <h2 className="file-explorer__workspace-title">{paneTab.name}</h2>
                          <p className="file-explorer__workspace-path">{paneTab.path}</p>
                        </div>
                        <div className="file-explorer__preview-actions">
                          <span className="file-explorer__meta-pill">{paneTab.extension || 'no ext'}</span>
                          <span className="file-explorer__meta-pill">{formatBytes(paneTab.size)}</span>
                          {paneTab.type === 'text' && paneKey === activePane && <button className="btn btn--small" type="button" onClick={() => setShowDiff((value) => !value)}>{showDiff ? 'Editor' : 'Diff'}</button>}
                          {paneTab.type === 'text' && paneKey === activePane && <button className="btn btn--small btn--primary file-explorer__save-btn" type="button" onClick={saveActiveTab}>Save</button>}
                          <button className="btn btn--small" type="button" onClick={() => openExternal(paneTab.path)}>Open</button>
                          <button className="btn btn--small" type="button" onClick={() => revealFolder(getParentDirectory(paneTab.path))}>Reveal</button>
                        </div>
                      </div>
                      <div className="file-explorer__preview-body">
                        {paneTab.type === 'image' ? (
                          <div className="file-explorer__image-wrap"><img className="file-explorer__image" src={paneTab.content} alt={paneTab.name} /></div>
                        ) : showDiff && paneKey === activePane ? (
                          <div className="file-explorer__diff">
                            <section className="file-explorer__diff-pane">
                              <header className="file-explorer__diff-head">Saved</header>
                              <pre className="file-explorer__diff-code language-code" dangerouslySetInnerHTML={{ __html: savedHighlightedContent }} />
                            </section>
                            <section className="file-explorer__diff-pane">
                              <header className="file-explorer__diff-head">Current</header>
                              <pre className="file-explorer__diff-code language-code" dangerouslySetInnerHTML={{ __html: highlightedContent }} />
                            </section>
                          </div>
                        ) : (
                          <Suspense fallback={<div className="file-tree-loading">Loading editor...</div>}>
                            <CodeEditor
                              extension={paneTab.extension}
                              value={paneTab.draftContent ?? ''}
                              onChange={(value) => setTabs((prev) => prev.map((tab) => tab.id === paneTab.id ? { ...tab, draftContent: value } : tab))}
                            />
                          </Suspense>
                        )}
                      </div>
                    </div>
                  )}
                </ExplorerPane>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
