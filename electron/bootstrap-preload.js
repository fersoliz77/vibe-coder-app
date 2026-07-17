const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bootstrap', {
  getStatus: () => ipcRenderer.invoke('bootstrap:get-status'),
  start: (language) => ipcRenderer.send('bootstrap:start', language),
  acknowledge: () => ipcRenderer.send('bootstrap:acknowledge'),
  openApp: () => ipcRenderer.send('bootstrap:open-app'),
  copyDetails: () => ipcRenderer.invoke('bootstrap:copy-details'),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('bootstrap:status', listener);
    return () => ipcRenderer.removeListener('bootstrap:status', listener);
  },
});
