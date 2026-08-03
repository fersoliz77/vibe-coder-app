const RESTRICTED_READ_CHANNELS = new Set([
  'store:get',
  'store:getAll',
  'projects:list',
  'terminal:destroy',
  'claude:cancel',
  'openai:cancel',
]);

const AUTH_CHANNELS = new Set([
  'auth:get-state',
  'auth:login',
  'auth:google',
  'auth:revalidate',
  'auth:logout',
  'auth:open-help',
]);

function canAccessChannel(policy, channel) {
  if (AUTH_CHANNELS.has(channel) || channel.startsWith('window:') || channel === 'diagnostics:export') return true;
  if (policy === 'active') return true;
  if (policy === 'restricted') return RESTRICTED_READ_CHANNELS.has(channel);
  return false;
}

function installIpcAuthorization(ipcMain, getPolicy) {
  const originalHandle = ipcMain.handle.bind(ipcMain);
  const originalOn = ipcMain.on.bind(ipcMain);

  ipcMain.handle = (channel, handler) => originalHandle(channel, (event, ...args) => {
    const policy = getPolicy();
    if (!canAccessChannel(policy, channel)) {
      const error = new Error(`AUTH_POLICY_${policy.toUpperCase()}: IPC channel ${channel} is blocked.`);
      error.code = `AUTH_POLICY_${policy.toUpperCase()}`;
      throw error;
    }
    return handler(event, ...args);
  });

  ipcMain.on = (channel, listener) => originalOn(channel, (event, ...args) => {
    if (canAccessChannel(getPolicy(), channel)) listener(event, ...args);
  });
}

module.exports = { canAccessChannel, installIpcAuthorization };
