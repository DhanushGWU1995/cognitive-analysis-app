const { contextBridge } = require('electron');

// Reserved for future desktop-only APIs (e.g. default report save folder).
contextBridge.exposeInMainWorld('selectDesktop', {
  platform: process.platform,
});
