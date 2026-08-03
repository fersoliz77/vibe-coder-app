const path = require('path');
const { ProvisioningError, parseJsonOutput, runRemoteCreation } = require('./core');
const { runReadCommand } = require('./commandRunner');
const { getProvisioningOptions } = require('./validation');

async function getRuntimeOptions(runner) {
  const options = getProvisioningOptions();
  try {
    const organizations = parseJsonOutput((await runReadCommand(runner, 'supabase', ['orgs', 'list', '--output', 'json'])).stdout);
    options.supabaseOrganizations = Array.isArray(organizations)
      ? organizations.map((organization) => ({
          id: organization.id || organization.slug,
          name: organization.name || organization.slug || organization.id,
        })).filter((organization) => organization.id)
      : [];
  } catch {
    options.supabaseOrganizations = [];
  }
  try {
    options.githubUser = (await runReadCommand(runner, 'gh', ['api', 'user', '--jq', '.login'])).stdout.trim() || null;
  } catch {
    options.githubUser = null;
  }
  try {
    options.vercelUser = (await runReadCommand(runner, 'vercel', ['whoami'])).stdout.trim().split(/\s/)[0] || null;
  } catch {
    options.vercelUser = null;
  }
  return options;
}

async function preflightProviders({ job, request, projectPath, invoke }) {
  await invoke(job, 'gh', ['auth', 'status', '--active'], projectPath, 'remote');
  const githubUser = (await invoke(job, 'gh', ['api', 'user', '--jq', '.login'], projectPath, 'remote')).stdout.trim().split(/\s/)[0];
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(githubUser)) {
    throw new ProvisioningError('GITHUB_ACCOUNT_INVALID', 'GitHub CLI did not return a valid active account.');
  }
  const vercelUser = (await invoke(job, 'vercel', ['whoami'], projectPath, 'remote')).stdout.trim().split(/\s/)[0];
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/.test(vercelUser)) {
    throw new ProvisioningError('VERCEL_ACCOUNT_INVALID', 'Vercel CLI did not return a valid personal account.');
  }
  const gitName = await invoke(job, 'git', ['config', '--get', 'user.name'], projectPath);
  const gitEmail = await invoke(job, 'git', ['config', '--get', 'user.email'], projectPath);
  if (!gitName.stdout.trim() || !gitEmail.stdout.trim()) {
    throw new ProvisioningError('GIT_IDENTITY_MISSING', 'Configure your Git name and email before creating a project.');
  }
  if (request.backend === 'firebase') await invoke(job, 'firebase', ['login:list', '--json'], projectPath, 'remote');
  if (request.backend === 'supabase') {
    const organizations = parseJsonOutput((await invoke(job, 'supabase', ['orgs', 'list', '--output', 'json'], projectPath, 'remote')).stdout);
    const available = Array.isArray(organizations) && organizations.some((organization) => (
      organization?.id === request.supabase.organizationId || organization?.slug === request.supabase.organizationId
    ));
    if (!available) {
      throw new ProvisioningError('SUPABASE_ORG_UNAVAILABLE', 'The selected Supabase organization is not available to the active account.');
    }
  }
  return { githubUser, vercelUser };
}

async function publishGitHub({ job, request, state, accounts, invoke }) {
  state.remoteCreationAttempted = true;
  const github = {
    owner: accounts.githubUser,
    repository: request.slug,
    private: true,
    url: `https://github.com/${accounts.githubUser}/${request.slug}`,
    status: 'attempting',
    created: null,
  };
  state.remotes.github = github;
  await runRemoteCreation(github, () => invoke(job, 'gh', ['repo', 'create', request.slug, '--private', '--source', '.', '--remote', 'origin'], state.projectPath, 'remote'));
  await invoke(job, 'git', ['push', '--set-upstream', 'origin', 'main'], state.projectPath, 'remote');
  github.pushed = true;
}

async function deployVercel({ job, request, state, accounts, invoke }) {
  const cwd = request.type === 'mobile-suite' ? path.join(state.projectPath, 'web') : state.projectPath;
  state.remoteCreationAttempted = true;
  const vercel = { account: accounts.vercelUser, project: request.slug, status: 'attempting', created: null, linked: false };
  state.remotes.vercel = vercel;
  await runRemoteCreation(vercel, () => invoke(job, 'vercel', ['project', 'add', request.slug, '--scope', accounts.vercelUser, '--non-interactive'], cwd, 'remote'));
  await invoke(job, 'vercel', ['link', '--yes', '--project', request.slug, '--scope', accounts.vercelUser, '--non-interactive'], cwd, 'remote');
  vercel.linked = true;
  const gitConnection = { repository: `${state.remotes.github.owner}/${state.remotes.github.repository}`, status: 'attempting', created: null };
  vercel.gitConnection = gitConnection;
  await runRemoteCreation(gitConnection, () => invoke(job, 'vercel', ['git', 'connect', `${state.remotes.github.url}.git`, '--yes', '--scope', accounts.vercelUser, '--non-interactive'], cwd, 'remote'));
  vercel.environmentVariables = [];
  for (const [key, value] of Object.entries(state.publicEnv || {})) {
    for (const environment of ['production', 'preview', 'development']) {
      const variable = { key, environment, status: 'attempting', created: null };
      vercel.environmentVariables.push(variable);
      await runRemoteCreation(variable, () => invoke(job, 'vercel', ['env', 'add', key, environment, '--value', value, '--yes', '--scope', accounts.vercelUser], cwd, 'remote'));
    }
  }
  const deployment = { environment: 'production', project: request.slug, status: 'attempting', created: null };
  vercel.deployment = deployment;
  const deploymentResult = await runRemoteCreation(deployment, () => invoke(job, 'vercel', ['deploy', '--prod', '--yes', '--scope', accounts.vercelUser, '--non-interactive'], cwd, 'remote'));
  const deploymentUrl = deploymentResult.stdout.match(/https:\/\/[^\s]+/)?.[0];
  if (!deploymentUrl) throw new ProvisioningError('VERCEL_DEPLOYMENT_INVALID', 'Vercel did not return the production deployment URL.');
  vercel.url = deploymentUrl;
  vercel.deployed = true;
}

module.exports = { deployVercel, getRuntimeOptions, preflightProviders, publishGitHub };
