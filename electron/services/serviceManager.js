const { execFile } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execFileAsync = util.promisify(execFile);
const os = require('os');
const { validateProjectCwd } = require('../ipc/fsGuards');
const { buildSubprocessEnv } = require('./subprocessEnv');

/**
 * Service Manager — Checks connection status for Vercel, Supabase, GitHub, Git, Firebase
 * by calling their respective CLIs.
 */

// Inject common CLI paths so Electron can find npm-global binaries
const npmGlobalBin = path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
const ghCliPath = 'C:\\Program Files\\GitHub CLI';
const extraPath = [npmGlobalBin, ghCliPath, process.env.PATH].filter(Boolean).join(path.delimiter);

// On Windows, use .cmd wrappers for npm-installed CLIs
// gh is NOT an npm package — it lives in C:\Program Files\GitHub CLI\gh.exe
const isWin = process.platform === 'win32';
const CLI = {
  supabase: isWin ? 'supabase.cmd' : 'supabase',
  vercel:   isWin ? 'vercel.cmd'   : 'vercel',
  firebase: isWin ? 'firebase.cmd' : 'firebase',
  gh:       'gh',   // found via extraPath above
  git:      'git',
};

const NPM_CLI_ENTRY = {
  supabase: path.join(npmGlobalBin, 'node_modules', 'supabase', 'dist', 'supabase.js'),
  vercel: path.join(npmGlobalBin, 'node_modules', 'vercel', 'dist', 'index.js'),
  firebase: path.join(npmGlobalBin, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'),
};

const SUPABASE_NATIVE_ENTRY = path.join(
  npmGlobalBin,
  'node_modules',
  'supabase',
  'node_modules',
  `@supabase/cli-windows-${process.arch}`,
  'bin',
  'supabase.exe',
);

async function runCommand(file, args = [], cwd, extraEnv = {}, provider = null) {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: 20000,
      cwd,
      windowsHide: true,
      env: buildSubprocessEnv({ provider: provider === 'gh' ? 'github' : provider, extra: { PATH: extraPath, FORCE_COLOR: '0', ...extraEnv } }),
    });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    // execAsync throws on non-zero exit BUT still has stdout/stderr
    return {
      success: false,
      stdout: (error.stdout || '').trim(),
      stderr: (error.stderr || error.message || '').trim(),
      code: error.code,
    };
  }
}

function resolveCliInvocation(name, pathExists = fs.existsSync) {
  if (!Object.hasOwn(CLI, name)) {
    return null;
  }
  if (isWin && name === 'supabase' && pathExists(SUPABASE_NATIVE_ENTRY)) {
    return { file: SUPABASE_NATIVE_ENTRY, argsPrefix: [], extraEnv: {} };
  }
  const npmEntry = isWin ? NPM_CLI_ENTRY[name] : null;
  if (npmEntry && pathExists(npmEntry)) {
    return { file: process.execPath, argsPrefix: [npmEntry], extraEnv: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { file: CLI[name], argsPrefix: [], extraEnv: {} };
}

function runCli(name, args = [], cwd) {
  const invocation = resolveCliInvocation(name);
  if (!invocation) return Promise.resolve({ success: false, stdout: '', stderr: 'Unknown CLI' });
  return runCommand(invocation.file, [...invocation.argsPrefix, ...args], cwd, invocation.extraEnv, name);
}

async function checkVercel(projectPath, cliRunner = runCli) {
  // Always get global state first
  const res = await cliRunner('vercel', ['whoami']);
  const globalConnected = res.success && res.stdout.length > 0 && !res.stdout.toLowerCase().includes('error');
  const user = globalConnected ? res.stdout.split('\n')[0].trim() : null;

  if (!projectPath) {
    return { id: 'vercel', name: 'Vercel', connected: globalConnected, authenticated: globalConnected, user, checking: false };
  }
  
  const vercelDir = path.join(projectPath, '.vercel');
  const isLinked = fs.existsSync(vercelDir);
  let vercelProject = null;
  if (isLinked) {
    try {
      const pjson = path.join(vercelDir, 'project.json');
      if (fs.existsSync(pjson)) {
        const data = JSON.parse(fs.readFileSync(pjson, 'utf8'));
        vercelProject = data.projectName || data.projectId || null;
      }
    } catch (e) {}
  }
  return {
    id: 'vercel', name: 'Vercel', connected: globalConnected && isLinked,
    authenticated: globalConnected,
    user, // Display global account name
    project: vercelProject,
    projectLinked: isLinked,
    details: {
      platform: 'Vercel',
      type: 'Deployment',
      ...(!globalConnected && { error: res.stderr || 'Run: vercel login' }),
      ...(globalConnected && !isLinked && { projectNotice: 'Run: vercel link' }),
    },
  };
}

async function checkSupabase(projectPath, cliRunner = runCli) {
  // Always get global state first
  const orgsRes = await cliRunner('supabase', ['orgs', 'list', '--output', 'json']);
  let globalConnected = false;
  let user = null;

  if (orgsRes.stdout) {
    try {
      const match = orgsRes.stdout.match(/\[[\s\S]*\]/);
      if (match) {
        const data = JSON.parse(match[0]);
        if (Array.isArray(data) && data.length > 0) {
          globalConnected = true;
          user = data[0].name;
        }
      }
    } catch (e) {}
  }

  if (!globalConnected) {
    const projRes = await cliRunner('supabase', ['projects', 'list', '--output', 'json']);
    if (projRes.stdout) {
      try {
        const match = projRes.stdout.match(/\[[\s\S]*\]/);
        if (match) {
          const data = JSON.parse(match[0]);
          if (Array.isArray(data)) {
            globalConnected = true;
            user = 'Logged in';
          }
        }
      } catch (e) {}
    }
  }

  if (!projectPath) {
    return { id: 'supabase', name: 'Supabase', connected: globalConnected, authenticated: globalConnected, user, checking: false };
  }

  // Keep account authentication separate from project initialization/linking.
  const configPath = path.join(projectPath, 'supabase', 'config.toml');
  const projectRefPath = path.join(projectPath, 'supabase', '.temp', 'project-ref');
  const isInitialized = fs.existsSync(configPath);
  const isLinked = fs.existsSync(projectRefPath);
  let projectName = null;
  if (isLinked) {
    try { projectName = fs.readFileSync(projectRefPath, 'utf8').trim() || null; } catch (e) {}
  } else if (isInitialized) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      const m = content.match(/project_id\s*=\s*"([^"]+)"/);
      if (m) projectName = m[1];
    } catch (e) {}
  }
  return {
    id: 'supabase', name: 'Supabase', connected: globalConnected && isLinked,
    authenticated: globalConnected,
    user, // Display global account name
    project: projectName,
    projectLinked: isLinked,
    details: {
      platform: 'Supabase',
      type: 'Backend',
      initialized: isInitialized,
      ...(!globalConnected && { error: orgsRes.stderr || 'Run: supabase login' }),
      ...(globalConnected && !isLinked && { projectNotice: isInitialized ? 'Run: supabase link' : 'Run: supabase init' }),
    },
  };
}

async function checkGitHub(projectPath) {
  // Always get global state first
  const res = await runCli('gh', ['auth', 'status']);
  const output = res.stdout + ' ' + res.stderr;
  const match = output.match(/account\s+(\S+)/i);
  const globalConnected = res.success || output.includes('Logged in');
  const user = match ? match[1] : (globalConnected ? 'Logged in' : null);

  if (!projectPath) {
    return { id: 'github', name: 'GitHub', connected: globalConnected, authenticated: globalConnected, user, checking: false };
  }

  const isGit = fs.existsSync(path.join(projectPath, '.git'));
  if (!isGit) return { id: 'github', name: 'GitHub', connected: false, authenticated: globalConnected, projectLinked: false, user, details: { error: 'Not a git repository' }};
  
  const result = await runCli('git', ['remote', '-v'], projectPath);
  const isLinked = result.success && result.stdout.includes('github.com');
  
  let repoName = null;
  if (isLinked) {
    const repoMatch = result.stdout.match(/github\.com[:/]([^/]+\/[^\s.]+)/);
    if (repoMatch) repoName = repoMatch[1].replace(/\.git$/, '');
  }
  
  return {
    id: 'github', name: 'GitHub', connected: globalConnected && isLinked,
    authenticated: globalConnected,
    user, // Display global account name
    project: repoName,
    projectLinked: isLinked,
    details: isLinked ? { platform: 'GitHub', type: 'Repository' } : { error: 'Run: git remote add origin' },
  };
}

async function checkGit(projectPath) {
  // Always get global state first
  const versionRes = await runCli('git', ['--version']);
  const globalConnected = versionRes.success && versionRes.stdout.includes('git version');
  let user = null;
  if (globalConnected) {
    const emailRes = await runCli('git', ['config', '--global', 'user.email']);
    user = emailRes.success && emailRes.stdout.length > 0 ? emailRes.stdout.trim() : 'Installed';
  }

  if (!projectPath) {
    return { id: 'git', name: 'Git', connected: globalConnected, authenticated: globalConnected, user, checking: false };
  }

  const isGit = fs.existsSync(path.join(projectPath, '.git'));
  let branch = null;
  if (isGit) {
    const branchRes = await runCli('git', ['branch', '--show-current'], projectPath);
    if (branchRes.success && branchRes.stdout) branch = branchRes.stdout.trim();
  }
  return {
    id: 'git', name: 'Git', connected: globalConnected && isGit,
    authenticated: globalConnected,
    user, // Display global account name
    project: branch ? `branch: ${branch}` : null,
    projectLinked: isGit,
    details: isGit ? { platform: 'Git', type: 'Local Tool' } : { error: 'Run: git init' },
  };
}

async function checkFirebase(projectPath) {
  // Always get global state first
  const res = await runCli('firebase', ['login:list']);
  let globalConnected = false;
  let user = null;
  if (res.success) {
    const match = res.stdout.match(/Logged in as\s+(\S+)/i);
    if (match) {
      globalConnected = true;
      user = match[1];
    } else if (res.stdout.includes('@')) {
      const emailMatch = res.stdout.match(/[\w.-]+@[\w.-]+\.\w+/);
      if (emailMatch) { globalConnected = true; user = emailMatch[0]; }
    }
  }
  if (!globalConnected) {
    const fallback = await runCli('firebase', ['projects:list']);
    if (fallback.success && fallback.stdout.includes('project(s) total')) {
      globalConnected = true;
      user = 'Logged in';
    }
  }

  if (!projectPath) {
    return { id: 'firebase', name: 'Firebase', connected: globalConnected, authenticated: globalConnected, user, checking: false };
  }

  const firebasercPath = path.join(projectPath, '.firebaserc');
  const isLinked = fs.existsSync(path.join(projectPath, 'firebase.json')) || fs.existsSync(firebasercPath);
  
  let projectName = null;
  if (fs.existsSync(firebasercPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(firebasercPath, 'utf8'));
      projectName = data?.projects?.default || null;
    } catch (e) {}
  }
  
  return {
    id: 'firebase', name: 'Firebase', connected: globalConnected && isLinked,
    authenticated: globalConnected,
    user, // Display global account name
    project: projectName,
    projectLinked: isLinked,
    details: isLinked ? { platform: 'Firebase', type: 'Backend' } : { error: 'Run: firebase init' },
  };
}

async function checkVercelProject(projectPath) {
  // Read .vercel/project.json to get the linked project name
  const projectJsonPath = path.join(projectPath, '.vercel', 'project.json');
  if (!fs.existsSync(projectJsonPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
    return data?.projectId ? (data.projectName || data.projectId) : null;
  } catch (e) {
    return null;
  }
}

const checkers = {
  vercel: checkVercel,
  supabase: checkSupabase,
  github: checkGitHub,
  git: checkGit,
  firebase: checkFirebase,
};

function setupServiceHandlers(ipcMain, diagnostics) {
  const { isProjectRegistered } = require('./projectManager');
  const recordError = (service, operation, category) => diagnostics?.log('service', 'error', { service, operation, category });
  ipcMain.handle('services:check-all', async (_, projectPath) => {
    const EXPECTED_IDS = ['vercel', 'supabase', 'github', 'git', 'firebase'];
    if (projectPath) {
      try {
        projectPath = validateProjectCwd(projectPath, isProjectRegistered);
      } catch (error) {
        recordError('all', 'check', 'invalid-project');
        return EXPECTED_IDS.map((id) => ({ id, name: id, connected: false, details: { error: error.message } }));
      }
    }
    const results = await Promise.allSettled([
      checkVercel(projectPath),
      checkSupabase(projectPath),
      checkGitHub(projectPath),
      checkGit(projectPath),
      checkFirebase(projectPath),
    ]);
    const statuses = results.map((r, i) => {
      if (r.status === 'fulfilled') {
        if (r.value?.details?.error) recordError(EXPECTED_IDS[i], 'check', 'provider-unavailable');
        return r.value;
      }
      recordError(EXPECTED_IDS[i], 'check', 'unexpected');
      return {
        id: EXPECTED_IDS[i],
        name: EXPECTED_IDS[i],
        connected: false,
        user: null,
        checking: false,
        details: { error: r.reason?.message },
      };
    });
    diagnostics?.setState('services', {
      checked: statuses.length,
      connected: statuses.filter((status) => status.connected).length,
      errors: statuses.filter((status) => status.details?.error).length,
    });
    return statuses;
  });

  ipcMain.handle('services:check', async (_, serviceName, projectPath) => {
    if (!projectPath) return { error: 'No project path' };
    try {
      projectPath = validateProjectCwd(projectPath, isProjectRegistered);
    } catch (error) {
      recordError(serviceName, 'check', 'invalid-project');
      return { error: error.message };
    }
    const checker = checkers[serviceName];
    if (!checker) {
      recordError('unknown', 'check', 'unsupported-service');
      return { error: `Unknown service: ${serviceName}` };
    }
    const status = await checker(projectPath);
    if (status?.details?.error || status?.error) recordError(serviceName, 'check', 'provider-unavailable');
    return status;
  });

  ipcMain.handle('services:connect', async (_, serviceName) => {
    // Open terminal with login command
    const commands = {
      vercel: 'vercel login',
      supabase: 'supabase login',
      github: 'gh auth login',
      firebase: 'firebase login',
    };
    return { command: commands[serviceName] || null };
  });

  ipcMain.handle('services:disconnect', async (_, serviceName) => {
    const commands = {
      vercel: ['vercel', ['logout']],
      supabase: ['supabase', ['logout']],
      github: ['gh', ['auth', 'logout']],
    };
    const command = commands[serviceName];
    if (!command) {
      recordError('unknown', 'disconnect', 'unsupported-service');
      return { success: false, error: 'Unknown service' };
    }
    const result = await runCli(command[0], command[1]);
    if (!result.success) recordError(serviceName, 'disconnect', 'command-failed');
    return { success: result.success };
  });
}

module.exports = { runCommand, resolveCliInvocation, checkVercel, checkSupabase, setupServiceHandlers };
