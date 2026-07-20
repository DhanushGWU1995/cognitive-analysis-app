const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('selectDesktop', {
  platform: process.platform,
  closeApp: () => ipcRenderer.send('app:quit'),
});
