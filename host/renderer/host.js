/**
 * Bonumech Remote Support - Host renderer
 * ---------------------------------------
 * - Kalıcı ID/şifre ile sunucuya kaydolur.
 * - Onay sonrası seçili monitörü WebRTC ile yayınlar (çoklu monitör).
 * - Kontrol olaylarını nut.js'e iletir; sohbet, pano ve dosya transferini yönetir.
 */

(() => {
  'use strict';

  const DEFAULT_ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const $ = (id) => document.getElementById(id);
  const idValue = $('id-value');
  const passValue = $('pass-value');
  const statusText = $('status-text');
  const statusDot = document.querySelector('#status .dot');
  const localPreview = $('local-preview');
  const newPassBtn = $('new-pass');
  const consentPanel = $('consent');
  const consentAllow = $('consent-allow');
  const consentReject = $('consent-reject');
  const consentTimer = $('consent-timer');
  const autoAllow = $('auto-allow');
  const sessionPanel = $('session-panel');
  const monitorSelect = $('monitor-select');
  const chatLog = $('chat-log');
  const chatText = $('chat-text');
  const chatSend = $('chat-send');
  const sendFileBtn = $('send-file-btn');
  const fileInput = $('file-input');
  const fileStatus = $('file-status');

  const CONSENT_TIMEOUT = 30;
  const CHUNK = 16384;

  let ws = null;
  let pc = null;
  let controlChannel = null;
  let fileChannel = null;
  let localStream = null;
  let videoSender = null;
  let myId = null;
  let myPass = null;
  let peerId = null;
  let reconnectTimer = null;
  let iceServers = DEFAULT_ICE;
  let consentCountdown = null;
  let fileRecv = null;
  let screensList = [];

  function setStatus(text, dotClass) {
    statusText.textContent = text;
    statusDot.className = 'dot ' + dotClass;
  }
  const groupDigits = (s) => String(s).replace(/(\d{3})(?=\d)/g, '$1 ').trim();

  // ---------------------------------------------------------------------------
  // Başlangıç + bağlantı
  // ---------------------------------------------------------------------------
  async function start() {
    const creds = await window.hostAPI.loadCreds();
    if (creds) { myId = creds.id; myPass = creds.password; }
    const url = await window.hostAPI.serverUrl();
    connect(url);
  }

  function connect(url) {
    setStatus('Sunucuya bağlanılıyor…', 'dot-wait');
    ws = new WebSocket(url);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', id: myId || undefined, password: myPass || undefined }));
    };

    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case 'registered':
          myId = msg.id;
          myPass = msg.password;
          if (Array.isArray(msg.iceServers) && msg.iceServers.length) iceServers = msg.iceServers;
          window.hostAPI.saveCreds({ id: myId, password: myPass });
          idValue.textContent = groupDigits(myId);
          passValue.textContent = groupDigits(myPass);
          setStatus('Hazır — bağlantı bekleniyor', 'dot-ok');
          window.hostAPI.reportState({ connected: false, id: myId });
          break;

        case 'password-set':
          myPass = msg.password;
          window.hostAPI.saveCreds({ id: myId, password: myPass });
          passValue.textContent = groupDigits(myPass);
          break;

        case 'peer-joined':
          peerId = msg.peer;
          if (autoAllow.checked) { setStatus('Bağlantı otomatik onaylandı…', 'dot-live'); await startSharing(); }
          else showConsent();
          break;

        case 'signal':
          await handleSignal(msg.payload);
          break;

        case 'peer-left':
          hideConsent();
          resetSession('Hazır — bağlantı bekleniyor', 'dot-ok');
          break;
      }
    };

    ws.onclose = () => { setStatus('Bağlantı koptu — yeniden deneniyor…', 'dot-err'); scheduleReconnect(url); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function scheduleReconnect(url) {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(url), 3000);
  }

  // ---------------------------------------------------------------------------
  // Onay ekranı
  // ---------------------------------------------------------------------------
  function showConsent() {
    setStatus('Bağlantı isteği — onayınız bekleniyor', 'dot-wait');
    consentPanel.classList.remove('hidden');
    let left = CONSENT_TIMEOUT;
    consentTimer.textContent = `${left} sn içinde otomatik reddedilir`;
    clearInterval(consentCountdown);
    consentCountdown = setInterval(() => {
      left -= 1;
      consentTimer.textContent = `${left} sn içinde otomatik reddedilir`;
      if (left <= 0) rejectConnection();
    }, 1000);
  }
  function hideConsent() { clearInterval(consentCountdown); consentPanel.classList.add('hidden'); }
  async function allowConnection() { hideConsent(); setStatus('Destek bağlanıyor…', 'dot-live'); await startSharing(); }
  function rejectConnection() {
    hideConsent();
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'reject' }));
    peerId = null;
    setStatus('Bağlantı reddedildi — bağlantı bekleniyor', 'dot-ok');
  }

  // ---------------------------------------------------------------------------
  // Ekran paylaşımı + WebRTC
  // ---------------------------------------------------------------------------
  async function captureSelected() {
    return navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  }

  async function startSharing() {
    // Monitörleri listele ve ilkini (birincil) seç.
    try { screensList = await window.hostAPI.listScreens(); } catch { screensList = []; }
    populateMonitors(screensList);
    if (screensList[0]) { window.hostAPI.selectScreen(screensList[0].id); monitorSelect.value = screensList[0].id; }

    try {
      localStream = await captureSelected();
    } catch {
      setStatus('Ekran paylaşımı reddedildi/başarısız', 'dot-err');
      return;
    }
    localPreview.srcObject = localStream;

    pc = new RTCPeerConnection({ iceServers });

    for (const track of localStream.getTracks()) {
      const sender = pc.addTrack(track, localStream);
      if (track.kind === 'video') videoSender = sender;
    }

    // Kontrol kanalı (girdi + sohbet + pano + monitör)
    controlChannel = pc.createDataChannel('control', { ordered: true });
    controlChannel.onopen = () => {
      sessionPanel.classList.remove('hidden');
      sendControl({ t: 'screens', list: screensList, current: monitorSelect.value });
      addMsg('sys', 'Destek bağlandı.');
    };
    controlChannel.onmessage = (e) => onControlMessage(e.data);

    // Dosya kanalı
    fileChannel = pc.createDataChannel('file', { ordered: true });
    fileChannel.binaryType = 'arraybuffer';
    fileChannel.onmessage = (e) => onFileMessage(e.data);

    pc.onicecandidate = (e) => { if (e.candidate) signal({ candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setStatus('Oturum aktif — uzaktan kontrol ediliyor', 'dot-live');
        window.hostAPI.reportState({ connected: true, id: myId });
      } else if (pc.connectionState === 'failed') {
        resetSession('Hazır — bağlantı bekleniyor', 'dot-ok');
      }
    };
    localStream.getVideoTracks()[0].addEventListener('ended', () => resetSession('Ekran paylaşımı durduruldu', 'dot-err'));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signal({ sdp: pc.localDescription });
  }

  async function switchScreen(sourceId) {
    if (!sourceId || !videoSender) return;
    window.hostAPI.selectScreen(sourceId);
    let newStream;
    try { newStream = await captureSelected(); } catch { return; }
    const newTrack = newStream.getVideoTracks()[0];
    await videoSender.replaceTrack(newTrack);
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    localStream = newStream;
    localPreview.srcObject = newStream;
    newTrack.addEventListener('ended', () => resetSession('Ekran paylaşımı durduruldu', 'dot-err'));
  }

  async function handleSignal(payload) {
    if (!pc) return;
    if (payload.sdp) await pc.setRemoteDescription(payload.sdp);
    else if (payload.candidate) { try { await pc.addIceCandidate(payload.candidate); } catch {} }
  }
  function signal(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'signal', payload }));
  }

  function resetSession(text, dot) {
    hideConsent();
    if (controlChannel) { try { controlChannel.close(); } catch {} controlChannel = null; }
    if (fileChannel) { try { fileChannel.close(); } catch {} fileChannel = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
    videoSender = null;
    fileRecv = null;
    localPreview.srcObject = null;
    peerId = null;
    sessionPanel.classList.add('hidden');
    fileStatus.textContent = '';
    window.hostAPI.reportState({ connected: false, id: myId });
    setStatus(text, dot);
  }

  // ---------------------------------------------------------------------------
  // Kontrol kanalı: girdi + sohbet + pano + monitör
  // ---------------------------------------------------------------------------
  function sendControl(obj) {
    if (controlChannel && controlChannel.readyState === 'open') controlChannel.send(JSON.stringify(obj));
  }

  function onControlMessage(data) {
    let ev;
    try { ev = JSON.parse(data); } catch { return; }
    switch (ev.t) {
      case 'chat': addMsg('them', ev.text); break;
      case 'clip': window.hostAPI.clipWrite(ev.text || ''); addMsg('sys', 'Uzak pano alındı.'); break;
      case 'setscreen': monitorSelect.value = ev.id; switchScreen(ev.id); break;
      default: window.hostAPI.inject(ev); // fare/klavye
    }
  }

  // ---------------------------------------------------------------------------
  // Sohbet
  // ---------------------------------------------------------------------------
  function addMsg(kind, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + kind;
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function sendChat() {
    const text = chatText.value.trim();
    if (!text) return;
    sendControl({ t: 'chat', text });
    addMsg('me', text);
    chatText.value = '';
  }

  // ---------------------------------------------------------------------------
  // Dosya transferi (file kanalı)
  // ---------------------------------------------------------------------------
  async function sendFile(file) {
    if (!fileChannel || fileChannel.readyState !== 'open') return;
    fileChannel.send(JSON.stringify({ t: 'meta', name: file.name, size: file.size, mime: file.type }));
    fileChannel.bufferedAmountLowThreshold = 1 << 20;
    let offset = 0;
    while (offset < file.size) {
      const buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
      if (fileChannel.bufferedAmount > (8 << 20)) {
        await new Promise((res) => { fileChannel.onbufferedamountlow = () => { fileChannel.onbufferedamountlow = null; res(); }; });
      }
      fileChannel.send(buf);
      offset += buf.byteLength;
      fileStatus.textContent = `Gönderiliyor: ${file.name} — %${Math.round((offset / file.size) * 100)}`;
    }
    fileChannel.send(JSON.stringify({ t: 'end', name: file.name }));
    fileStatus.textContent = `Gönderildi: ${file.name}`;
  }

  function onFileMessage(data) {
    if (typeof data === 'string') {
      let m; try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'meta') {
        fileRecv = { name: m.name, size: m.size, chunks: [], received: 0 };
        fileStatus.textContent = `Alınıyor: ${m.name} — %0`;
      } else if (m.t === 'end' && fileRecv) {
        finalizeRecv();
      }
    } else if (fileRecv) {
      fileRecv.chunks.push(new Uint8Array(data));
      fileRecv.received += data.byteLength;
      const pct = fileRecv.size ? Math.round((fileRecv.received / fileRecv.size) * 100) : 0;
      fileStatus.textContent = `Alınıyor: ${fileRecv.name} — %${pct}`;
    }
  }

  async function finalizeRecv() {
    const total = fileRecv.received;
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of fileRecv.chunks) { merged.set(c, off); off += c.byteLength; }
    const res = await window.hostAPI.saveFile({ name: fileRecv.name, data: merged });
    if (res && res.ok) { addMsg('sys', `Dosya kaydedildi: ${res.path}`); fileStatus.textContent = `Kaydedildi: ${fileRecv.name}`; }
    else { addMsg('sys', 'Dosya kaydedilemedi.'); }
    fileRecv = null;
  }

  function populateMonitors(screens) {
    monitorSelect.innerHTML = '';
    screens.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name || `Ekran ${i + 1}`;
      monitorSelect.appendChild(opt);
    });
  }

  // ---------------------------------------------------------------------------
  // Olaylar
  // ---------------------------------------------------------------------------
  consentAllow.addEventListener('click', () => allowConnection());
  consentReject.addEventListener('click', () => rejectConnection());
  newPassBtn.addEventListener('click', () => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'set-password' })); });
  chatSend.addEventListener('click', sendChat);
  chatText.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
  monitorSelect.addEventListener('change', () => { const id = monitorSelect.value; sendControl({ t: 'screens', list: screensList, current: id }); switchScreen(id); });
  sendFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) { sendFile(fileInput.files[0]); fileInput.value = ''; } });

  // Host panosu değişince viewer'a gönder.
  window.hostAPI.onHostClipboard((text) => sendControl({ t: 'clip', text }));

  start();
})();
