export const STORAGE_PREFIX = 'fileExplorerTabs:';

export const FILE_META = {
  js: { label: 'JS', color: '#f7df1e' },
  jsx: { label: 'JSX', color: '#61dafb' },
  ts: { label: 'TS', color: '#3178c6' },
  tsx: { label: 'TSX', color: '#4fc3f7' },
  json: { label: 'JSON', color: '#f5c542' },
  md: { label: 'MD', color: '#7fb3ff' },
  css: { label: 'CSS', color: '#42a5f5' },
  scss: { label: 'SCSS', color: '#f48fb1' },
  html: { label: 'HTML', color: '#ff8a65' },
  py: { label: 'PY', color: '#4fc08d' },
  sql: { label: 'SQL', color: '#ba68c8' },
  yml: { label: 'YML', color: '#ffb74d' },
  yaml: { label: 'YML', color: '#ffb74d' },
  toml: { label: 'CFG', color: '#ce93d8' },
  env: { label: 'ENV', color: '#8bc34a' },
  gitignore: { label: 'GIT', color: '#ef5350' },
  png: { label: 'IMG', color: '#26c6da' },
  jpg: { label: 'IMG', color: '#26c6da' },
  jpeg: { label: 'IMG', color: '#26c6da' },
  svg: { label: 'SVG', color: '#ffca28' },
  ico: { label: 'ICO', color: '#ffca28' },
  lock: { label: 'LOCK', color: '#b0bec5' },
  txt: { label: 'TXT', color: '#90a4ae' },
  sh: { label: 'SH', color: '#66bb6a' },
  bat: { label: 'BAT', color: '#66bb6a' },
  ps1: { label: 'PS', color: '#42a5f5' },
  default: { label: 'FILE', color: '#9aa5ce' },
};

export function getStorageKey(projectId) {
  return `${STORAGE_PREFIX}${projectId}`;
}

export function getExtension(name) {
  const parts = String(name || '').split('.');
  return parts.length <= 1 ? '' : parts.pop().toLowerCase();
}

export function getFileMeta(name, isDirectory) {
  if (isDirectory) return { label: 'DIR', color: '#d9a441' };
  if (name === '.gitignore') return FILE_META.gitignore;
  if (name === '.env' || String(name || '').startsWith('.env.')) return FILE_META.env;
  return FILE_META[getExtension(name)] || FILE_META.default;
}

export function getParentDirectory(filePath) {
  const normalized = String(filePath || '').replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  parts.pop();
  return parts.join('\\');
}

export function getName(filePath) {
  return String(filePath || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
}

export function formatBytes(size) {
  if (!size && size !== 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function makeTab(file) {
  return {
    id: file.path,
    name: file.name,
    path: file.path,
    relativePath: file.relativePath,
    type: file.type,
    extension: file.extension,
    size: file.size,
    savedContent: file.type === 'text' ? file.content : null,
    draftContent: file.type === 'text' ? file.content : null,
    content: file.content,
  };
}

export function makeTabManifest(tabs, paneTabs, splitView) {
  const paths = tabs.map((tab) => tab.relativePath).filter(Boolean);
  const relativeForId = (id) => tabs.find((tab) => tab.id === id)?.relativePath || null;
  return {
    version: 1,
    tabs: paths,
    panes: { primary: relativeForId(paneTabs.primary), secondary: splitView ? relativeForId(paneTabs.secondary) : null },
    splitView: Boolean(splitView),
  };
}

export function updatePathPrefix(value, oldPath, nextPath) {
  if (!value) return value;
  if (value === oldPath) return nextPath;
  if (value.startsWith(`${oldPath}\\`) || value.startsWith(`${oldPath}/`)) {
    return `${nextPath}${value.slice(oldPath.length)}`;
  }
  return value;
}

export function toAbsoluteProjectPath(projectPath, relativePath) {
  return `${projectPath}\\${String(relativePath || '').replace(/\//g, '\\')}`;
}

export function isStagedCode(code) {
  const value = String(code || '');
  return value[0] && value[0] !== ' ' && value[0] !== '?';
}

export function dragLog(event, payload = {}) {
  if (typeof window !== 'undefined') {
    window.__lastExplorerDnDLogs = window.__lastExplorerDnDLogs || [];
    window.__lastExplorerDnDLogs.push({ event, payload, at: Date.now() });
    if (window.__lastExplorerDnDLogs.length > 50) {
      window.__lastExplorerDnDLogs = window.__lastExplorerDnDLogs.slice(-50);
    }
  }
}
