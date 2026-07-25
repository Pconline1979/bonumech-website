/**
 * Preload - renderer'a güvenli, sınırlı bir API açar.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hostAPI', {
  // Sunucu / kimlik
  serverUrl: () => ipcRenderer.invoke('server-url'),
  loadCreds: () => ipcRenderer.invoke('load-creds'),
  saveCreds: (creds) => ipcRenderer.send('save-creds', creds),

  // Girdi enjeksiyonu
  inject: (ev) => ipcRenderer.send('inject', ev),

  // Çoklu monitör
  listScreens: () => ipcRenderer.invoke('list-screens'),
  selectScreen: (id) => ipcRenderer.send('select-screen', id),

  // Pano
  clipRead: () => ipcRenderer.invoke('clip-read'),
  clipWrite: (text) => ipcRenderer.send('clip-write', text),
  onHostClipboard: (cb) => ipcRenderer.on('host-clipboard', (_e, text) => cb(text)),

  // Dosya
  saveFile: (payload) => ipcRenderer.invoke('save-file', payload),

  // Durum
  reportState: (state) => ipcRenderer.send('session-state', state),
});
