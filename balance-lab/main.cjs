const { app, BrowserWindow, clipboard, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

let mainWindow = null;
let activeWorker = null;

function getSourceRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'src') : path.resolve(__dirname, '..', 'src');
}

function runWorker(sender, type, payload) {
  return new Promise((resolve, reject) => {
    if (activeWorker) {
      reject(new Error('Другая задача уже выполняется. Дождитесь окончания или нажмите «Отмена».'));
      return;
    }
    const worker = new Worker(path.join(__dirname, 'worker.cjs'), {
      workerData: { sourceRoot: getSourceRoot(), type: type, payload: payload || {} }
    });
    activeWorker = worker;
    let settled = false;
    worker.on('message', message => {
      if (message && message.kind === 'progress') {
        sender.send('balance-lab:progress', message.payload);
        return;
      }
      if (message && message.kind === 'result') {
        settled = true;
        activeWorker = null;
        resolve(message.payload);
        worker.terminate();
        return;
      }
      if (message && message.kind === 'error') {
        settled = true;
        activeWorker = null;
        reject(new Error(message.error || 'Balance Lab worker failed'));
        worker.terminate();
      }
    });
    worker.on('error', error => {
      activeWorker = null;
      if (!settled) reject(error);
    });
    worker.on('exit', code => {
      if (activeWorker === worker) activeWorker = null;
      if (!settled && code !== 0) reject(new Error('Balance Lab worker stopped unexpectedly.'));
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#10130f',
    title: 'Ashen Abyss Balance Lab',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('balance-lab:catalog', event => runWorker(event.sender, 'catalog', {}));
  ipcMain.handle('balance-lab:preview', (event, payload) => runWorker(event.sender, 'preview', payload));
  ipcMain.handle('balance-lab:run', (event, payload) => runWorker(event.sender, 'run', payload));
  ipcMain.handle('balance-lab:find-builds', (event, payload) => runWorker(event.sender, 'find-builds', payload));
  ipcMain.handle('balance-lab:cancel', () => {
    if (!activeWorker) return false;
    activeWorker.terminate();
    activeWorker = null;
    return true;
  });
  ipcMain.handle('balance-lab:copy', (_event, content) => { clipboard.writeText(content || ''); return true; });
  ipcMain.handle('balance-lab:save', async (_event, data) => {
    const suggestedName = data.suggestedName || 'ashen-balance-report.md';
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName,
      filters: suggestedName.endsWith('.json')
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, data.content || '', 'utf8');
    return result.filePath;
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
