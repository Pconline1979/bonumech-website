/**
 * Bonumech Remote Support - Host (Windows) - Electron ana süreç
 * ------------------------------------------------------------
 * - Görünür bir pencere açar (ID + oturum şifresi + durum + sohbet).
 * - getDisplayMedia isteklerini seçili monitöre yönlendirir (çoklu monitör).
 * - Renderer'dan gelen kontrol olaylarını nut.js ile enjekte eder.
 * - Pano senkronizasyonu, dosya kaydı ve kalıcı cihaz kimliği sağlar.
 */

const {
  app, BrowserWindow, ipcMain, desktopCapturer, session,
  screen, clipboard, Tray, Menu, nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const input = require('./input');

const SERVER_URL = process.env.BONUMECH_SERVER || 'ws://localhost:8080';

let win = null;
let tray = null;

// Seçili ekran kaynağı ve monitör sınırları önbelleği.
let selectedSourceId = null;
const boundsBySourceId = new Map(); // sourceId -> {x,y,width,height}

// --- Kalıcı cihaz kimliği deposu ---
const credsPath = () => path.join(app.getPath('userData'), 'device-creds.json');

function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(credsPath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveCreds(creds) {
  try {
    fs.writeFileSync(credsPath(), JSON.stringify(creds), 'utf8');
  } catch {
    /* yazılamadıysa yoksay */
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 440,
    height: 720,
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

  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

// getDisplayMedia -> seçili (ya da birincil) ekranı paylaş.
function setupDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      let source = sources.find((s) => s.id === selectedSourceId) || sources[0];
      callback({ video: source, audio: false });
    }).catch(() => callback({}));
  }, { useSystemPicker: false });
}

// Ekran kaynaklarını, her birinin sanal masaüstü sınırlarıyla eşleştirerek listele.
async function listScreens() {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  const displays = screen.getAllDisplays();
  boundsBySourceId.clear();
  return sources.map((s, i) => {
    const disp = displays.find((d) => String(d.id) === String(s.display_id)) || displays[i] || displays[0];
    const b = disp ? disp.bounds : null;
    if (b) boundsBySourceId.set(s.id, b);
    return { id: s.id, name: s.name || `Ekran ${i + 1}` };
  });
}

// Seçili ekranı ayarla ve girdi koordinat sınırlarını güncelle.
function selectScreen(sourceId) {
  selectedSourceId = sourceId;
  const b = boundsBySourceId.get(sourceId);
  input.setBounds(b || null);
}

function createTray() {
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

// --- Pano izleme: değişiklikleri renderer'a bildir (viewer'a iletmek için) ---
let lastClip = '';
let clipTimer = null;

function startClipboardWatch() {
  lastClip = clipboard.readText();
  clipTimer = setInterval(() => {
    const now = clipboard.readText();
    if (now !== lastClip) {
      lastClip = now;
      if (win && !win.isDestroyed()) win.webContents.send('host-clipboard', now);
    }
  }, 1000);
}

app.whenReady().then(() => {
  setupDisplayMediaHandler();
  createWindow();
  createTray();
  startClipboardWatch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { /* tepside kalmaya devam */ });
app.on('before-quit', () => { clearInterval(clipTimer); });

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('server-url', () => SERVER_URL);
ipcMain.handle('load-creds', () => loadCreds());
ipcMain.on('save-creds', (_e, creds) => saveCreds(creds));

ipcMain.handle('list-screens', () => listScreens());
ipcMain.on('select-screen', (_e, id) => selectScreen(id));

ipcMain.handle('clip-read', () => clipboard.readText());
ipcMain.on('clip-write', (_e, text) => {
  lastClip = text; // kendi yazdığımızı geri göndermeyelim
  clipboard.writeText(text || '');
});

// Dosyayı İndirilenler klasörüne kaydet.
ipcMain.handle('save-file', (_e, { name, data }) => {
  try {
    const dir = app.getPath('downloads');
    const safe = String(name || 'dosya').replace(/[\\/:*?"<>|]/g, '_');
    let target = path.join(dir, safe);
    // Aynı isim varsa numaralandır.
    let n = 1;
    const ext = path.extname(safe);
    const base = path.basename(safe, ext);
    while (fs.existsSync(target)) {
      target = path.join(dir, `${base} (${n++})${ext}`);
    }
    fs.writeFileSync(target, Buffer.from(data));
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Kontrol olayı enjeksiyonu (düşük gecikme).
ipcMain.on('inject', (_e, ev) => input.handle(ev));

// Oturum durumu (tepsi ipucu).
ipcMain.on('session-state', (_e, state) => {
  if (tray) {
    tray.setToolTip(state.connected
      ? `Bonumech Host — Oturum aktif (ID ${state.id || ''})`
      : 'Bonumech Host — Uzak Destek');
  }
});
