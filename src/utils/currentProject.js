const PROJECT_FIELDS = ['id', 'name', 'path', 'type', 'backend', 'repositoryVisibility', 'provisioningStatus', 'origin', 'registeredAt', 'createdAt', 'lastOpened', 'primaryTargetId'];

export function normalizeCurrentProject(project) {
  if (!project || typeof project !== 'object' || typeof project.id !== 'string' || typeof project.name !== 'string' || typeof project.path !== 'string') return null;
  const normalized = {};
  for (const key of PROJECT_FIELDS) if (project[key] !== undefined) normalized[key] = project[key];
  if (project.workspace && typeof project.workspace === 'object') {
    normalized.workspace = {
      analyzedAt: Number.isFinite(project.workspace.analyzedAt) ? project.workspace.analyzedAt : null,
      targets: Array.isArray(project.workspace.targets) ? project.workspace.targets.slice(0, 256).map((target) => ({
        id: target.id,
        name: target.name,
        kind: target.kind,
        framework: target.framework || null,
        technologies: Array.isArray(target.technologies) ? target.technologies.slice(0, 16) : [],
      })) : [],
    };
  }
  if (project.requirements && typeof project.requirements === 'object') {
    normalized.requirements = {
      items: Array.isArray(project.requirements.items) ? project.requirements.items.slice(0, 100).map((item) => ({
        id: item.id,
        type: item.type,
        status: item.status,
        severity: item.severity,
        relativePath: item.relativePath,
        detail: {
          count: Number.isSafeInteger(item.detail?.count) ? item.detail.count : 0,
          names: Array.isArray(item.detail?.names) ? item.detail.names.slice(0, 100) : [],
        },
      })) : [],
    };
  }
  return normalized;
}

export function applyCurrentProjectPatch(project, projectId, patch) {
  if (!project || project.id !== projectId || !patch || typeof patch !== 'object') return null;
  return normalizeCurrentProject({
    ...project,
    primaryTargetId: patch.primaryTargetId ?? project.primaryTargetId,
    workspace: patch.workspace ?? project.workspace,
    requirements: patch.requirements ?? project.requirements,
  });
}
