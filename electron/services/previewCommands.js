const { ANDROID_AVD_NAME } = require('./environmentManager');
const { PREVIEW_HOST, PREVIEW_PORT, classifyWebScript, planWebLaunch } = require('./previewProfiles');

const PREVIEW_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`;

/*
 * Los argumentos de host y puerto salen del plan, no de una tabla paralela:
 * cada servidor de desarrollo los nombra distinto y quien sabe cual usar es
 * `previewProfiles`. Aca solo se comprueba que el plan sea ejecutable.
 */
function buildWebDevArgs(packageJsonOrPlan) {
  const plan = packageJsonOrPlan && packageJsonOrPlan.mode
    ? packageJsonOrPlan
    : planWebLaunch({ packageJson: packageJsonOrPlan });
  if (plan.mode !== 'managed-npm' || !Array.isArray(plan.npmArgs)) {
    throw new Error('Unsupported web development server. No managed development script was recognised.');
  }
  return [...plan.npmArgs];
}

function isValidManagedSerial(serial) {
  return /^emulator-\d+$/.test(String(serial || ''));
}

function buildAdbRotationArgs(serial, orientation) {
  if (!isValidManagedSerial(serial)) throw new Error('Invalid managed emulator serial.');
  if (!['portrait', 'landscape'].includes(orientation)) throw new Error('Invalid orientation.');
  return ['-s', serial, 'shell', 'settings', 'put', 'system', 'user_rotation', orientation === 'portrait' ? '0' : '1'];
}

function buildAdbDisableAccelerometerArgs(serial) {
  if (!isValidManagedSerial(serial)) throw new Error('Invalid managed emulator serial.');
  return ['-s', serial, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'];
}

function buildAdbRotationCommands(serial, orientation) {
  return [buildAdbDisableAccelerometerArgs(serial), buildAdbRotationArgs(serial, orientation)];
}

function buildAdbScreenshotArgs(serial) {
  if (!isValidManagedSerial(serial)) throw new Error('Invalid managed emulator serial.');
  return ['-s', serial, 'exec-out', 'screencap', '-p'];
}

function buildFlutterRunSpawnOptions(cwd, env) {
  return { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
}

function buildFlutterControlInput(control) {
  if (control === 'reload') return 'r\n';
  if (control === 'restart') return 'R\n';
  throw new Error('Invalid Flutter control.');
}

function parseAdbEmulatorSerials(output) {
  return String(output || '').split(/\r?\n/)
    .map((line) => line.match(/^(emulator-\d+)\s+device$/)?.[1])
    .filter(Boolean);
}

function isConfiguredAvdNameOutput(output) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines[0] === ANDROID_AVD_NAME;
}

module.exports = {
  PREVIEW_HOST,
  PREVIEW_PORT,
  PREVIEW_URL,
  buildAdbDisableAccelerometerArgs,
  buildAdbRotationArgs,
  buildAdbRotationCommands,
  buildAdbScreenshotArgs,
  buildFlutterControlInput,
  buildFlutterRunSpawnOptions,
  buildWebDevArgs,
  classifyWebScript,
  isConfiguredAvdNameOutput,
  isValidManagedSerial,
  parseAdbEmulatorSerials,
};
