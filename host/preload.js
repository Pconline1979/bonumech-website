/**
 * Preload - renderer'a güvenli, sınırlı bir API açar.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hostAPI', {
  // Kontrol olayını ana sürece iletir (nut.js enjeksiyonu için).
  inject: (ev) => ipcRenderer.send('inject', ev),
  // Sunucu WebSocket adresini alır.
  serverUrl: () => ipcRenderer.invoke('server-url'),
  // Oturum durumunu ana sürece bildirir (tepsi ipucu vb.).
  reportState: (state) => ipcRenderer.send('session-state', state),
});
