const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

/** @returns {string} Folder containing index.html for the Angular build. */
function webRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web');
  }
  return path.join(__dirname, '..', 'web', 'dist', 'web', 'browser');
}

function indexUrl(role) {
  const url = pathToFileURL(path.join(webRoot(), 'index.html'));
  url.searchParams.set('display', role);
  return url.href;
}

const windowPrefs = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

/** @type {BrowserWindow | null} */
let researcherWin = null;
/** @type {BrowserWindow | null} */
let subjectWin = null;
/** Last test frame so a late subject window can catch up. */
let lastFrame = null;

function relayToOthers(sender, channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.id === sender.id) continue;
    win.webContents.send(channel, payload);
  }
}

function createResearcherWindow() {
  const primary = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    x: primary.bounds.x,
    y: primary.bounds.y,
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 700,
    title: 'SELeCT Toddler',
    backgroundColor: '#ffe8a3',
    autoHideMenuBar: true,
    webPreferences: windowPrefs,
  });
  researcherWin = win;
  win.loadURL(indexUrl('researcher'));
  win.once('ready-to-show', () => {
    win.show();
    win.setFullScreen(true);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    researcherWin = null;
    if (subjectWin && !subjectWin.isDestroyed()) subjectWin.close();
  });
}

function createSubjectWindow() {
  if (subjectWin && !subjectWin.isDestroyed()) {
    subjectWin.show();
    subjectWin.focus();
    return;
  }
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target = displays.find((d) => d.id !== primary.id) ?? primary;
  const win = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    title: 'Test Screen',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    frame: false,
    webPreferences: windowPrefs,
  });
  subjectWin = win;
  win.loadURL(indexUrl('subject'));
  win.once('ready-to-show', () => {
    win.setBounds(target.bounds);
    win.show();
    win.setFullScreen(true);
  });
  win.on('closed', () => {
    subjectWin = null;
    if (researcherWin && !researcherWin.isDestroyed()) {
      researcherWin.webContents.send('display:subject-closed');
    }
  });
}

ipcMain.on('app:quit', () => {
  app.quit();
});

ipcMain.on('display:open-subject', () => {
  createSubjectWindow();
});

ipcMain.on('display:frame', (event, frame) => {
  lastFrame = frame;
  relayToOthers(event.sender, 'display:frame', frame);
});

ipcMain.on('display:hello', (event) => {
  if (lastFrame) event.sender.send('display:frame', lastFrame);
  relayToOthers(event.sender, 'display:hello');
});

ipcMain.on('display:tap', (event, cell) => {
  relayToOthers(event.sender, 'display:tap', cell);
});

app.whenReady().then(() => {
  createResearcherWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createResearcherWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
