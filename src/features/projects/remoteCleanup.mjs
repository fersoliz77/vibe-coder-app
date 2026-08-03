const SAFE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;

function safeId(value) {
  const text = typeof value === 'string' ? value : '';
  return SAFE_ID.test(text) ? text : null;
}

function effectiveStatus(remote) {
  const statuses = [];
  const queue = Object.values(remote || {}).filter((value) => value && typeof value === 'object');
  while (queue.length) {
    const value = queue.shift();
    if (['attempting', 'created', 'unknown'].includes(value.status)) statuses.push(value.status);
    queue.push(...Object.values(value).filter((child) => child && typeof child === 'object'));
  }
  if (statuses.includes('unknown')) return 'unknown';
  if (statuses.includes('attempting')) return 'attempting';
  return ['attempting', 'created', 'unknown'].includes(remote?.status) ? remote.status : 'unknown';
}

export function getRemoteCleanupIdentifiers(remotes) {
  if (!remotes || typeof remotes !== 'object') return [];
  const identifiers = [];
  const githubOwner = safeId(remotes.github?.owner);
  const githubRepository = safeId(remotes.github?.repository);
  if (githubOwner && githubRepository) identifiers.push({ provider: 'GitHub', identifier: `${githubOwner}/${githubRepository}`, status: effectiveStatus(remotes.github) });

  const vercelAccount = safeId(remotes.vercel?.account);
  const vercelProject = safeId(remotes.vercel?.project);
  if (vercelAccount && vercelProject) identifiers.push({ provider: 'Vercel', identifier: `${vercelAccount}/${vercelProject}`, status: effectiveStatus(remotes.vercel) });

  const firebaseProject = safeId(remotes.firebase?.projectId);
  if (firebaseProject) identifiers.push({ provider: 'Firebase', identifier: firebaseProject, status: effectiveStatus(remotes.firebase) });

  const supabaseRef = safeId(remotes.supabase?.projectRef);
  const supabaseProject = safeId(remotes.supabase?.project);
  const supabaseOrganization = safeId(remotes.supabase?.organizationId);
  const supabaseIdentifier = supabaseRef || (supabaseOrganization && supabaseProject ? `${supabaseOrganization}/${supabaseProject}` : null);
  if (supabaseIdentifier) identifiers.push({ provider: 'Supabase', identifier: supabaseIdentifier, status: effectiveStatus(remotes.supabase) });
  return identifiers;
}
