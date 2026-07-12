const path = require('path');

function normalizeForComparison(targetPath) {
  const resolved = path.resolve(String(targetPath || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSubPath(parentPath, targetPath) {
  const parent = normalizeForComparison(parentPath);
  const target = normalizeForComparison(targetPath);

  if (parent === target) return true;
  const relative = path.relative(parent, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveProjectRoot(projectPath, isProjectRegistered) {
  const resolvedProjectPath = path.resolve(String(projectPath || ''));

  if (!resolvedProjectPath || resolvedProjectPath === path.resolve('.')) {
    throw new Error('A valid project path is required.');
  }

  if (typeof isProjectRegistered === 'function' && !isProjectRegistered(resolvedProjectPath)) {
    throw new Error('Project path is not registered in Vibe Coder.');
  }

  return resolvedProjectPath;
}

function resolveProjectEntryPath(projectPath, targetPath, isProjectRegistered) {
  const projectRoot = resolveProjectRoot(projectPath, isProjectRegistered);
  const resolvedTargetPath = path.resolve(String(targetPath || ''));

  if (!isSubPath(projectRoot, resolvedTargetPath)) {
    throw new Error('Path is outside the active project.');
  }

  return { projectRoot, resolvedTargetPath };
}

function resolveProjectChildPath(projectPath, parentDir, entryName, isProjectRegistered) {
  assertSafeEntryName(entryName);
  const { resolvedTargetPath: resolvedParentDir } = resolveProjectEntryPath(projectPath, parentDir, isProjectRegistered);
  const resolvedChildPath = path.resolve(resolvedParentDir, entryName);

  if (!isSubPath(projectPath, resolvedChildPath)) {
    throw new Error('New path would be outside the active project.');
  }

  return { projectRoot: path.resolve(projectPath), resolvedParentDir, resolvedChildPath };
}

function assertSafeEntryName(entryName) {
  const value = String(entryName || '').trim();

  if (!value) {
    throw new Error('A name is required.');
  }

  if (value === '.' || value === '..') {
    throw new Error('Relative path segments are not allowed.');
  }

  if (/[\\/]/.test(value)) {
    throw new Error('Names cannot contain path separators.');
  }

  return value;
}

function getProjectRelativePath(projectPath, targetPath) {
  const relativePath = path.relative(path.resolve(projectPath), path.resolve(targetPath));

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Path is outside the active project.');
  }

  return relativePath;
}

module.exports = {
  assertSafeEntryName,
  getProjectRelativePath,
  isSubPath,
  resolveProjectChildPath,
  resolveProjectEntryPath,
  resolveProjectRoot,
};
