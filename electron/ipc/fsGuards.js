const path = require('path');
const fs = require('fs');

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
    throw new Error('Project path is not registered in Vibe IDE Code.');
  }

  if (normalizeForComparison(resolvedProjectPath) === normalizeForComparison(path.parse(resolvedProjectPath).root)) {
    throw new Error('A filesystem root cannot be used as a project.');
  }

  if (fs.existsSync(resolvedProjectPath)) {
    const projectStats = fs.lstatSync(resolvedProjectPath);
    if (projectStats.isSymbolicLink()) {
      throw new Error('A symbolic link or junction cannot be used as the project root.');
    }
  }

  return resolvedProjectPath;
}

function validateProjectCwd(projectPath, isProjectRegistered) {
  const projectRoot = resolveProjectRoot(projectPath, isProjectRegistered);
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error('Project path is not an existing directory.');
  }
  return projectRoot;
}

function assertNoLinkedPath(projectRoot, targetPath) {
  const relative = path.relative(projectRoot, targetPath);
  if (!relative) return;

  let currentPath = projectRoot;
  for (const segment of relative.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    let stats;
    try {
      stats = fs.lstatSync(currentPath);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new Error('Symbolic links and junctions are not allowed in project paths.');
    }
  }
}

function resolveProjectEntryPath(projectPath, targetPath, isProjectRegistered) {
  const projectRoot = resolveProjectRoot(projectPath, isProjectRegistered);
  const resolvedTargetPath = path.resolve(String(targetPath || ''));

  if (!isSubPath(projectRoot, resolvedTargetPath)) {
    throw new Error('Path is outside the active project.');
  }

  assertNoLinkedPath(projectRoot, resolvedTargetPath);

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

function assertNotProjectRoot(projectPath, targetPath) {
  if (normalizeForComparison(projectPath) === normalizeForComparison(targetPath)) {
    throw new Error('The project root cannot be modified or deleted.');
  }
}

module.exports = {
  assertSafeEntryName,
  assertNotProjectRoot,
  assertNoLinkedPath,
  getProjectRelativePath,
  isSubPath,
  resolveProjectChildPath,
  resolveProjectEntryPath,
  resolveProjectRoot,
  validateProjectCwd,
};
