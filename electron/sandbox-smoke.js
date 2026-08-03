const api = window.electronAPI;
const passed = Boolean(
  api
  && typeof api.system?.platform === 'string'
  && !Object.hasOwn(api.system, 'homedir')
  && typeof api.store?.get === 'function'
  && typeof api.window?.onCloseRequested === 'function'
  && typeof api.openai?.cancel === 'function'
);
document.documentElement.dataset.smokeResult = passed ? 'pass' : 'fail';
