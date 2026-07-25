/**
 * Bonumech Remote Support - Host (Windows) - Electron ana süreç
 * ------------------------------------------------------------
 * - Görünür bir pencere açar (ID + oturum şifresi + durum gösterir).
 * - getDisplayMedia isteklerini otomatik olarak birincil ekrana yönlendirir.
 * - Renderer'dan gelen kontrol olaylarını (IPC) nut.js ile işletim sistemine enjekte eder.
 */

const { app, BrowserWindow, ipcMain, desktopCapturer, session, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const input = require('./input');

// Sunucu adresi: ortam değişkeni ile override edilebilir.
const SERVER_URL = process.env.BONUMECH_SERVER || 'ws://localhost:8080';

let win = null;
let tray = null;

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    title: 'Bonumech Host',
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Pencere kapatılınca tepsiye küçült (arka planda çalışmaya devam etsin).
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

// getDisplayMedia -> otomatik olarak birincil ekranı paylaş (kullanıcıya seçtirmeden).
function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      // İlk (birincil) ekranı seç.
      callback({ video: sources[0], audio: false });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });
}

function createTray() {
  // Basit boş ikon (paketlemede gerçek ikon ile değiştirilebilir).
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Bonumech Host — Uzak Destek');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Göster', click: () => win.show() },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => win.show());
}

app.whenReady().then(() => {
  setupDisplayMediaHandler();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Tepside kalmaya devam et; sadece açıkça çıkışta kapan.
});

// --- IPC: renderer'a sunucu adresini ver ---
ipcMain.handle('server-url', () => SERVER_URL);

// --- IPC: kontrol olayı enjeksiyonu (fire-and-forget, düşük gecikme) ---
ipcMain.on('inject', (_e, ev) => {
  input.handle(ev);
});

// --- IPC: oturum durumu bildirimi (tepsi ipucu güncelle) ---
ipcMain.on('session-state', (_e, state) => {
  if (tray) {
    tray.setToolTip(state.connected
      ? `Bonumech Host — Oturum aktif (ID ${state.id || ''})`
      : 'Bonumech Host — Uzak Destek');
  }
});
