const { spawn } = require('child_process');

function killProcessTree(processHandle) {
  if (!processHandle?.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(processHandle.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      shell: false,
    });
    killer.on('error', () => {
      try { processHandle.kill(); } catch {}
    });
    return;
  }
  try { processHandle.kill('SIGTERM'); } catch {}
}

module.exports = { killProcessTree };
