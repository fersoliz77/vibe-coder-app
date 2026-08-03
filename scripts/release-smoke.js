const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { inspectWindowsInstaller } = require('./verify-windows-installer');
const { readManifest, verifyManifestArtifact } = require('./release-manifest');
const { parseArgs } = require('./generate-release-manifest');

function validatePackagedAppPath(appPath, installerPath) {
  const resolvedApp = path.resolve(appPath);
  const resolvedInstaller = path.resolve(installerPath);
  const appName = path.basename(resolvedApp);
  if (resolvedApp.toLowerCase() === resolvedInstaller.toLowerCase()) throw new Error('--app cannot be the installer');
  if (/setup|installer/i.test(appName)) throw new Error('--app cannot point to a Setup or installer executable');
  if (appName !== 'Vibe IDE Code.exe' || path.basename(path.dirname(resolvedApp)) !== 'win-unpacked') {
    throw new Error('--app must be win-unpacked/Vibe IDE Code.exe');
  }
  const realApp = fs.realpathSync.native(resolvedApp);
  const realInstaller = fs.realpathSync.native(resolvedInstaller);
  if (realApp.toLowerCase() === realInstaller.toLowerCase()) throw new Error('--app cannot resolve to the installer');
  const appStat = fs.statSync(realApp);
  const installerStat = fs.statSync(realInstaller);
  if (appStat.ino !== 0 && appStat.dev === installerStat.dev && appStat.ino === installerStat.ino) {
    throw new Error('--app cannot be a hard link to the installer');
  }
  return resolvedApp;
}

function runPackagedSmoke(appPath, installerPath, timeoutMs = 30000) {
  const safeAppPath = validatePackagedAppPath(appPath, installerPath);
  inspectWindowsInstaller(installerPath, safeAppPath);
  return new Promise((resolve, reject) => {
    const child = spawn(safeAppPath, ['--sandbox-smoke-test'], { stdio: 'ignore', windowsHide: true });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`packaged smoke timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`packaged smoke exited with code ${code}`));
    });
  });
}

async function runReleaseSmoke(options) {
  if (!options.manifest || !options.installer) throw new Error('--manifest and --installer are required');
  if (options.app) validatePackagedAppPath(options.app, options.installer);
  const artifacts = inspectWindowsInstaller(options.installer, options.app);
  const errors = await verifyManifestArtifact(readManifest(options.manifest), options.installer);
  if (errors.length) throw new Error(errors.join('\n'));
  if (options.app) await runPackagedSmoke(options.app, options.installer);
  return { artifacts, packagedAppExecuted: Boolean(options.app) };
}

if (require.main === module) {
  runReleaseSmoke(parseArgs(process.argv.slice(2), ['manifest', 'installer', 'app'])).then(({ packagedAppExecuted }) => {
    console.log(`Release smoke passed (${packagedAppExecuted ? 'static checks + packaged app' : 'static checks only'}).`);
    console.log('The installer was not executed, installed, signed, or published.');
  }).catch((error) => {
    console.error(`Release smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { runPackagedSmoke, runReleaseSmoke, validatePackagedAppPath };
