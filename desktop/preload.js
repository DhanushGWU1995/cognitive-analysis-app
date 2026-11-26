const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('selectDesktop', {
  platform: process.platform,
  closeApp: () => ipcRenderer.send('app:quit'),
  openSubjectDisplay: () => ipcRenderer.send('display:open-subject'),
  publishSubjectFrame: (frame) => ipcRenderer.send('display:frame', frame),
  sendSubjectHello: () => ipcRenderer.send('display:hello'),
  sendSubjectTap: (cell) => ipcRenderer.send('display:tap', cell),
  onSubjectFrame: (cb) => {
    ipcRenderer.on('display:frame', (_event, frame) => cb(frame));
  },
  onSubjectTap: (cb) => {
    ipcRenderer.on('display:tap', (_event, cell) => cb(cell));
  },
  onSubjectHello: (cb) => {
    ipcRenderer.on('display:hello', () => cb());
  },
  onSubjectClosed: (cb) => {
    ipcRenderer.on('display:subject-closed', () => cb());
  },
});
