const { spawn } = require('child_process');
const { buildSubprocessEnv } = require('./subprocessEnv');

function killProcessTree(processHandle) {
  if (!processHandle?.pid) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/pid', String(processHandle.pid), '/T', '/F'], {
        env: buildSubprocessEnv(),
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      });
      killer.once('error', () => {
        try { processHandle.kill(); } catch {}
        resolve();
      });
      killer.once('close', resolve);
    });
  }
  try { processHandle.kill('SIGTERM'); } catch {}
  return Promise.resolve();
}

module.exports = { killProcessTree };
