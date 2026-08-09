import { lazy, Suspense, useCallback } from 'react';
import { tabAction, nextTabIndex } from '../../utils/tablist';
import { ExplorerPane } from './ExplorerPane';
import { formatBytes, getParentDirectory } from './explorerUtils';
import { useI18n } from '../../i18n/I18nContext';

const loadCodeEditor = () => import('./CodeEditor');
const CodeEditor = lazy(loadCodeEditor);

/*
 * El editor es el modulo mas pesado de la app (~690 kB). Antes se cargaba
 * recien al apretar un boton "Editor", asi que abrir un archivo no costaba
 * nada... pero tampoco dejaba escribir.
 *
 * Ahora los archivos abren escribibles, asi que la carga se adelanta al
 * momento en que el explorador aparece en pantalla: para cuando elegis un
 * archivo, el editor ya esta listo y no se ve ningun salto.
 *
 * Es solo un empujon: si el archivo llega antes, Suspense muestra el estado
 * de carga como siempre.
 */
export function prefetchCodeEditor() {
  loadCodeEditor().catch(() => {
    // Si falla, Suspense lo reintenta al abrir el primer archivo.
  });
}

export function ExplorerWorkspace({
  isDark,
  dirtyTabs,
  activePane,
  setPaneTabs,
  tabs,
  activeTabId,
  closeTab,
  reorderTabs,
  moveTabBy,
  splitView,
  setSplitView,
  activeTab,
  projectPath,
  statusMessage,
  statusTone,
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
  const { t } = useI18n();

  const handleTabsKeyDown = useCallback((event) => {
    const row = event.target.closest?.('[role="tab"]');
    if (!row) return;
    const tabId = row.dataset.tabId;
    const action = tabAction(event);
    if (!action) return;

    if (action === 'activate') {
      event.preventDefault();
      setPaneTabs((prev) => ({ ...prev, [activePane]: tabId }));
      return;
    }
    if (action === 'close') {
      event.preventDefault();
      closeTab(tabId);
      return;
    }
    // Ctrl/Cmd + flecha reordena, en lugar de cambiar de pestana.
    if (action === 'moveLeft' || action === 'moveRight') {
      event.preventDefault();
      moveTabBy?.(tabId, action === 'moveLeft' ? -1 : 1);
      return;
    }

    const current = tabs.findIndex((tab) => tab.id === tabId);
    const target = nextTabIndex(action, current, tabs.length);
    if (target === null || target === current) return;
    event.preventDefault();
    setPaneTabs((prev) => ({ ...prev, [activePane]: tabs[target].id }));
    event.currentTarget.querySelectorAll('[role="tab"]')?.[target]?.focus();
  }, [tabs, activePane, setPaneTabs, closeTab, moveTabBy]);
  return (
    <section className="file-explorer__workspace">
      <div className="file-explorer__editor-shell">
        {dirtyTabs.length > 0 && (
          <div className="file-explorer__changes-bar">
            <span className="file-explorer__changes-title">{t('explorer.unsaved')}</span>
            <div className="file-explorer__changes-list">
              {dirtyTabs.map((tab) => (
                <button key={`dirty:${tab.id}`} className="file-explorer__changes-item" type="button" onClick={() => setPaneTabs((prev) => ({ ...prev, [activePane]: tab.id }))}>
                  {tab.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div
          className="file-explorer__tabs"
          role="tablist"
          aria-label={t('explorer.openFilesTabs')}
          onKeyDown={handleTabsKeyDown}
        >
          {tabs.length === 0 ? (
            <div className="file-explorer__tabs-empty">{t('explorer.noFileOpen')}</div>
          ) : tabs.map((tab) => {
            const dirty = tab.type === 'text' && tab.draftContent !== tab.savedContent;
            return (
              <div
                key={tab.id}
                className={`file-explorer__tab ${tab.id === activeTabId ? 'file-explorer__tab--active' : ''}`}
                role="tab"
                aria-selected={tab.id === activeTabId}
                data-tab-id={tab.id}
                tabIndex={tab.id === activeTabId ? 0 : -1}
                title={dirty ? t('explorer.unsaved') : tab.name}
                onClick={() => setPaneTabs((prev) => ({ ...prev, [activePane]: tab.id }))}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('application/tab-id', tab.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => reorderTabs(event.dataTransfer.getData('application/tab-id'), tab.id)}
              >
                <span className="file-explorer__tab-name">{tab.name}</span>
                {dirty && <span className="file-explorer__tab-dirty" role="img" aria-label={t('explorer.unsaved')} />}
                <button className="file-explorer__tab-close" type="button" tabIndex={-1} aria-label={t('explorer.closeTab', { name: tab.name })} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}>x</button>
              </div>
            );
          })}
          <button className="file-explorer__split-toggle" type="button" onClick={() => setSplitView((value) => !value)}>{splitView ? t('explorer.single') : t('explorer.split')}</button>
        </div>

        {!activeTab && !splitView ? (
          <div className="file-explorer__workspace-card">
            <h2 className="file-explorer__workspace-title">{t('explorer.projectExplorer')}</h2>
            <p className="file-explorer__workspace-text">{t('explorer.workspaceCopy')}</p>
            <p className="file-explorer__workspace-path">{projectPath}</p>
            {statusMessage && <p className={`file-explorer__status ${statusTone === 'error' ? 'file-explorer__status--error' : ''}`} aria-hidden="true">{statusMessage}</p>}
          </div>
        ) : (
          <div className={`file-explorer__panes ${splitView ? 'file-explorer__panes--split' : ''}`}>
            {['primary', ...(splitView ? ['secondary'] : [])].map((paneKey) => {
              const paneTab = tabs.find((tab) => tab.id === paneTabs[paneKey]) || null;
              return (
                <ExplorerPane key={paneKey} title={paneKey === 'primary' ? t('explorer.primary') : t('explorer.secondary')} active={activePane === paneKey} onActivate={() => setActivePane(paneKey)}>
                  {!paneTab ? (
                    <div className="file-explorer__workspace-card file-explorer__workspace-card--empty">
                      <p className="file-explorer__workspace-text">{t('explorer.selectFilePane', { pane: paneKey === 'primary' ? t('explorer.primary').toLowerCase() : t('explorer.secondary').toLowerCase() })}</p>
                      {statusMessage && paneKey === 'primary' && <p className={`file-explorer__status ${statusTone === 'error' ? 'file-explorer__status--error' : ''}`} aria-hidden="true">{statusMessage}</p>}
                    </div>
                  ) : (
                    <div className="file-explorer__preview">
                      <div className="file-explorer__preview-header">
                        <div>
                          <h2 className="file-explorer__workspace-title">{paneTab.name}</h2>
                          <p className="file-explorer__workspace-path">{paneTab.path}</p>
                        </div>
                        <div className="file-explorer__preview-actions">
                          <span className="file-explorer__meta-pill">{paneTab.extension || t('explorer.noExtension')}</span>
                          <span className="file-explorer__meta-pill">{formatBytes(paneTab.size)}</span>
                          {paneTab.type === 'text' && paneKey === activePane && <button className="btn btn--small" type="button" onClick={() => setShowDiff((value) => !value)}>{showDiff ? t('explorer.editor') : t('explorer.diff')}</button>}
                          {paneTab.type === 'text' && paneKey === activePane && (
                            <button
                              className="btn btn--small btn--primary file-explorer__save-btn"
                              type="button"
                              onClick={saveActiveTab}
                              disabled={paneTab.draftContent === paneTab.savedContent}
                            >
                              {t('explorer.save')}
                            </button>
                          )}
                          <button className="btn btn--small" type="button" onClick={() => openExternal(paneTab.path)}>{t('explorer.open')}</button>
                          <button className="btn btn--small" type="button" onClick={() => revealFolder(getParentDirectory(paneTab.path))}>{t('explorer.reveal')}</button>
                        </div>
                      </div>
                      <div className="file-explorer__preview-body">
                        {paneTab.type === 'image' ? (
                          <div className="file-explorer__image-wrap"><img className="file-explorer__image" src={paneTab.content} alt={paneTab.name} /></div>
                        ) : showDiff && paneKey === activePane ? (
                          <div className="file-explorer__diff">
                            <section className="file-explorer__diff-pane">
                              <header className="file-explorer__diff-head">{t('explorer.saved')}</header>
                              <pre className="file-explorer__diff-code language-code" dangerouslySetInnerHTML={{ __html: savedHighlightedContent }} />
                            </section>
                            <section className="file-explorer__diff-pane">
                              <header className="file-explorer__diff-head">{t('explorer.current')}</header>
                              <pre className="file-explorer__diff-code language-code" dangerouslySetInnerHTML={{ __html: highlightedContent }} />
                            </section>
                          </div>
                        ) : (
                          <Suspense fallback={<div className="file-tree-loading">{t('explorer.loadingEditor')}</div>}>
                            <CodeEditor
                              isDark={isDark}
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
