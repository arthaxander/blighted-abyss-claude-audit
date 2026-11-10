const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('balanceLab', {
  getCatalog: () => ipcRenderer.invoke('balance-lab:catalog'),
  preview: payload => ipcRenderer.invoke('balance-lab:preview', payload),
  run: payload => ipcRenderer.invoke('balance-lab:run', payload),
  findBuilds: payload => ipcRenderer.invoke('balance-lab:find-builds', payload),
  cancel: () => ipcRenderer.invoke('balance-lab:cancel'),
  save: payload => ipcRenderer.invoke('balance-lab:save', payload),
  copy: content => ipcRenderer.invoke('balance-lab:copy', content),
  onProgress: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('balance-lab:progress', listener);
    return () => ipcRenderer.removeListener('balance-lab:progress', listener);
  }
});
