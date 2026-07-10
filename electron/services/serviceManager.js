const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execAsync = util.promisify(exec);
const os = require('os');

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

async function runCommand(command) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 20000,
      shell: true,
      env: { ...process.env, PATH: extraPath, FORCE_COLOR: '0' },
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

async function checkVercel(projectPath) {
  // Always get global state first
  const res = await runCommand(`${CLI.vercel} whoami`);
  const globalConnected = res.success && res.stdout.length > 0 && !res.stdout.toLowerCase().includes('error');
  const user = globalConnected ? res.stdout.split('\n')[0].trim() : null;

  if (!projectPath) {
    return { id: 'vercel', name: 'Vercel', connected: globalConnected, user, checking: false };
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
    id: 'vercel', name: 'Vercel', connected: isLinked,
    user, // Display global account name
    project: vercelProject,
    details: isLinked ? { platform: 'Vercel', type: 'Deployment' } : { error: 'Run: vercel link' },
  };
}

async function checkSupabase(projectPath) {
  // Always get global state first
  const orgsRes = await runCommand(`${CLI.supabase} orgs list --output json`);
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
    const projRes = await runCommand(`${CLI.supabase} projects list --output json`);
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
    return { id: 'supabase', name: 'Supabase', connected: globalConnected, user, checking: false };
  }

  // Project-level: check for supabase/config.toml and extract project name
  const configPath = path.join(projectPath, 'supabase', 'config.toml');
  const isLinked = fs.existsSync(configPath);
  let projectName = null;
  if (isLinked) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      const m = content.match(/project_id\s*=\s*"([^"]+)"/);
      if (m) projectName = m[1];
    } catch (e) {}
  }
  return {
    id: 'supabase', name: 'Supabase', connected: isLinked,
    user, // Display global account name
    project: projectName,
    details: isLinked ? { platform: 'Supabase', type: 'Backend' } : { error: 'Run: supabase init' },
  };
}

async function checkGitHub(projectPath) {
  // Always get global state first
  const res = await runCommand(`${CLI.gh} auth status`);
  const output = res.stdout + ' ' + res.stderr;
  const match = output.match(/account\s+(\S+)/i);
  const globalConnected = res.success || output.includes('Logged in');
  const user = match ? match[1] : (globalConnected ? 'Logged in' : null);

  if (!projectPath) {
    return { id: 'github', name: 'GitHub', connected: globalConnected, user, checking: false };
  }

  const isGit = fs.existsSync(path.join(projectPath, '.git'));
  if (!isGit) return { id: 'github', name: 'GitHub', connected: false, user, details: { error: 'Not a git repository' }};
  
  const result = await runCommand(`cd "${projectPath}" && git remote -v`);
  const isLinked = result.success && result.stdout.includes('github.com');
  
  let repoName = null;
  if (isLinked) {
    const repoMatch = result.stdout.match(/github\.com[:/]([^/]+\/[^\s.]+)/);
    if (repoMatch) repoName = repoMatch[1].replace(/\.git$/, '');
  }
  
  return {
    id: 'github', name: 'GitHub', connected: isLinked,
    user, // Display global account name
    project: repoName,
    details: isLinked ? { platform: 'GitHub', type: 'Repository' } : { error: 'Run: git remote add origin' },
  };
}

async function checkGit(projectPath) {
  // Always get global state first
  const versionRes = await runCommand(`${CLI.git} --version`);
  const globalConnected = versionRes.success && versionRes.stdout.includes('git version');
  let user = null;
  if (globalConnected) {
    const emailRes = await runCommand(`${CLI.git} config --global user.email`);
    user = emailRes.success && emailRes.stdout.length > 0 ? emailRes.stdout.trim() : 'Installed';
  }

  if (!projectPath) {
    return { id: 'git', name: 'Git', connected: globalConnected, user, checking: false };
  }

  const isGit = fs.existsSync(path.join(projectPath, '.git'));
  let branch = null;
  if (isGit) {
    const branchRes = await runCommand(`cd "${projectPath}" && git branch --show-current`);
    if (branchRes.success && branchRes.stdout) branch = branchRes.stdout.trim();
  }
  return {
    id: 'git', name: 'Git', connected: isGit,
    user, // Display global account name
    project: branch ? `branch: ${branch}` : null,
    details: isGit ? { platform: 'Git', type: 'Local Tool' } : { error: 'Run: git init' },
  };
}

async function checkFirebase(projectPath) {
  // Always get global state first
  const res = await runCommand(`${CLI.firebase} login:list`);
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
    const fallback = await runCommand(`${CLI.firebase} projects:list`);
    if (fallback.success && fallback.stdout.includes('project(s) total')) {
      globalConnected = true;
      user = 'Logged in';
    }
  }

  if (!projectPath) {
    return { id: 'firebase', name: 'Firebase', connected: globalConnected, user, checking: false };
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
    id: 'firebase', name: 'Firebase', connected: isLinked,
    user, // Display global account name
    project: projectName,
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

function setupServiceHandlers(ipcMain) {
  ipcMain.handle('services:check-all', async (_, projectPath) => {
    const EXPECTED_IDS = ['vercel', 'supabase', 'github', 'git', 'firebase'];
    const results = await Promise.allSettled([
      checkVercel(projectPath),
      checkSupabase(projectPath),
      checkGitHub(projectPath),
      checkGit(projectPath),
      checkFirebase(projectPath),
    ]);
    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        id: EXPECTED_IDS[i],
        name: EXPECTED_IDS[i],
        connected: false,
        user: null,
        checking: false,
        details: { error: r.reason?.message },
      };
    });
  });

  ipcMain.handle('services:check', async (_, serviceName, projectPath) => {
    if (!projectPath) return { error: 'No project path' };
    const checker = checkers[serviceName];
    if (!checker) return { error: `Unknown service: ${serviceName}` };
    return await checker(projectPath);
  });

  ipcMain.handle('services:connect', async (_, serviceName) => {
    // Open terminal with login command
    const commands = {
      vercel: 'vercel login',
      supabase: 'supabase login',
      github: 'gh auth login',
    };
    return { command: commands[serviceName] || null };
  });

  ipcMain.handle('services:disconnect', async (_, serviceName) => {
    const commands = {
      vercel: 'vercel logout',
      supabase: 'supabase logout',
      github: 'gh auth logout',
    };
    const result = await runCommand(commands[serviceName]);
    return { success: result.success };
  });
}

module.exports = { setupServiceHandlers };
