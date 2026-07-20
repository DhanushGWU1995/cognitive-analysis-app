const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

/** @returns {string} Folder containing index.html for the Angular build. */
function webRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web');
  }
  return path.join(__dirname, '..', 'web', 'dist', 'web', 'browser');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 700,
    title: 'SELeCT Toddler',
    backgroundColor: '#ffe8a3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(webRoot(), 'index.html'));

  // Toddler task: start fullscreen; Escape exits fullscreen (menu bar hidden).
  win.once('ready-to-show', () => {
    win.show();
    win.setFullScreen(true);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
