/**
 * Bonumech Uzak Destek - Web Görüntüleyici (Viewer)
 * -------------------------------------------------
 * - Sunucuya WebSocket ile bağlanır, ID+şifre ile host'a katılır.
 * - WebRTC ile host'un ekranını alır; fare/klavyeyi data channel ile gönderir.
 * - Sohbet, pano senkronizasyonu, dosya transferi ve monitör seçimi.
 */

(() => {
  'use strict';

  const DEFAULT_ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  let iceServers = DEFAULT_ICE;

  const CHUNK = 16384;
  const $ = (id) => document.getElementById(id);

  const connectScreen = $('connect-screen');
  const remoteScreen = $('remote-screen');
  const idInput = $('host-id');
  const passInput = $('host-pass');
  const connectBtn = $('connect-btn');
  const connectStatus = $('connect-status');
  const video = $('remote-video');
  const stage = $('stage');
  const overlay = $('overlay');
  const sessionLabel = $('session-label');
  const controlToggle = $('control-toggle');
  const connQuality = $('conn-quality');
  const monitorSelect = $('monitor-select');
  const sidePanel = $('side-panel');
  const chatLog = $('chat-log');
  const chatText = $('chat-text');
  const chatSend = $('chat-send');
  const sendFileBtn = $('send-file-btn');
  const fileInput = $('file-input');
  const fileStatus = $('file-status');
  const clipBtn = $('clip-btn');

  let ws = null;
  let pc = null;
  let controlChannel = null;
  let fileChannel = null;
  let peerId = null;
  let controlEnabled = true;
  let fileRecv = null;

  function setStatus(msg, kind) {
    connectStatus.textContent = msg || '';
    connectStatus.className = 'status' + (kind ? ' ' + kind : '');
  }
  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  // ---------------------------------------------------------------------------
  // Bağlantı akışı
  // ---------------------------------------------------------------------------
  function connect() {
    const id = idInput.value.replace(/\D/g, '');
    const pass = passInput.value.replace(/\D/g, '');
    if (id.length < 6 || pass.length < 4) { setStatus('Geçerli bir ID ve şifre girin.', 'err'); return; }

    connectBtn.disabled = true;
    setStatus('Sunucuya bağlanılıyor…', 'info');
    ws = new WebSocket(wsUrl());

    ws.onopen = () => { setStatus('Host aranıyor…', 'info'); ws.send(JSON.stringify({ type: 'join', id, password: pass })); };

    ws.onmessage = async (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case 'join-error':
          setStatus(errorText(msg.reason), 'err');
          connectBtn.disabled = false; ws.close();
          break;
        case 'join-ok':
          peerId = msg.peer;
          if (Array.isArray(msg.iceServers) && msg.iceServers.length) iceServers = msg.iceServers;
          setStatus('Onay bekleniyor… (uzak kullanıcı bağlantıyı onaylamalı)', 'info');
          await setupPeer();
          break;
        case 'signal': await handleSignal(msg.payload); break;
        case 'rejected': endSession('Bağlantı uzak kullanıcı tarafından reddedildi.'); break;
        case 'peer-left': endSession('Uzak makine bağlantıyı kapattı.'); break;
      }
    };
    ws.onclose = () => { if (!pc) connectBtn.disabled = false; };
    ws.onerror = () => { setStatus('Sunucuya bağlanılamadı.', 'err'); connectBtn.disabled = false; };
  }

  function errorText(reason) {
    switch (reason) {
      case 'not-found': return 'Bu ID ile bir host bulunamadı.';
      case 'bad-password': return 'Şifre hatalı.';
      case 'offline': return 'Host çevrimdışı.';
      case 'busy': return 'Host şu anda başka bir oturumda meşgul.';
      default: return 'Bağlantı hatası.';
    }
  }

  async function setupPeer() {
    pc = new RTCPeerConnection({ iceServers });
    pc.onicecandidate = (e) => { if (e.candidate) signal({ candidate: e.candidate }); };
    pc.ontrack = (e) => { video.srcObject = e.streams[0]; showRemoteScreen(); };

    pc.ondatachannel = (e) => {
      const ch = e.channel;
      if (ch.label === 'control') {
        controlChannel = ch;
        controlChannel.onopen = () => bindInput();
        controlChannel.onmessage = (ev) => onControlMessage(ev.data);
        controlChannel.onclose = () => unbindInput();
      } else if (ch.label === 'file') {
        fileChannel = ch;
        fileChannel.binaryType = 'arraybuffer';
        fileChannel.onmessage = (ev) => onFileMessage(ev.data);
      }
    };

    pc.onconnectionstatechange = () => {
      updateQuality(pc.connectionState);
      if (pc.connectionState === 'failed') endSession('Bağlantı koptu (NAT/TURN gerekli olabilir).');
    };
  }

  async function handleSignal(payload) {
    if (!pc) await setupPeer();
    if (payload.sdp) {
      await pc.setRemoteDescription(payload.sdp);
      if (payload.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signal({ sdp: pc.localDescription });
      }
    } else if (payload.candidate) {
      try { await pc.addIceCandidate(payload.candidate); } catch {}
    }
  }
  function signal(payload) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'signal', payload })); }

  function showRemoteScreen() {
    connectScreen.classList.add('hidden');
    remoteScreen.classList.remove('hidden');
    sessionLabel.textContent = `Bağlı — ID ${idInput.value.trim()}`;
    overlay.classList.add('hidden');
  }
  function updateQuality(state) {
    const map = { connected: 'Bağlı', connecting: 'Bağlanıyor', new: '—', failed: 'Koptu', disconnected: 'Zayıf', closed: 'Kapalı' };
    connQuality.textContent = map[state] || state;
  }

  function endSession(reason) {
    unbindInput();
    if (controlChannel) { try { controlChannel.close(); } catch {} controlChannel = null; }
    if (fileChannel) { try { fileChannel.close(); } catch {} fileChannel = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: 'bye' })); } catch {} ws.close(); }
    ws = null; fileRecv = null;
    video.srcObject = null;
    chatLog.innerHTML = ''; fileStatus.textContent = '';
    remoteScreen.classList.add('hidden');
    connectScreen.classList.remove('hidden');
    connectBtn.disabled = false;
    setStatus(reason || 'Oturum sonlandı.', 'info');
  }

  // ---------------------------------------------------------------------------
  // Kontrol kanalı gelen mesajları (host -> viewer): sohbet, pano, monitör listesi
  // ---------------------------------------------------------------------------
  function onControlMessage(data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'chat': addMsg('them', m.text); break;
      case 'clip':
        navigator.clipboard?.writeText(m.text || '').catch(() => {});
        addMsg('sys', 'Uzak pano alındı (panonuza kopyalandı).');
        break;
      case 'screens': populateMonitors(m.list, m.current); break;
    }
  }

  // ---------------------------------------------------------------------------
  // Girdi (fare/klavye) -> host
  // ---------------------------------------------------------------------------
  let lastMove = 0;
  function sendControl(obj) {
    if (controlChannel && controlChannel.readyState === 'open') controlChannel.send(JSON.stringify(obj));
  }
  function sendInput(obj) { if (controlEnabled) sendControl(obj); }

  function normCoords(e) {
    const rect = video.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const dispW = vw * scale, dispH = vh * scale;
    const offX = (rect.width - dispW) / 2, offY = (rect.height - dispH) / 2;
    let x = (e.clientX - rect.left - offX) / dispW;
    let y = (e.clientY - rect.top - offY) / dispH;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  const onMouseMove = (e) => {
    const now = performance.now(); if (now - lastMove < 16) return; lastMove = now;
    const c = normCoords(e); if (c) sendInput({ t: 'm', x: c.x, y: c.y });
  };
  const onMouseDown = (e) => { const c = normCoords(e); if (c) sendInput({ t: 'd', b: e.button, x: c.x, y: c.y }); };
  const onMouseUp = (e) => { const c = normCoords(e); if (c) sendInput({ t: 'u', b: e.button, x: c.x, y: c.y }); };
  const onWheel = (e) => { e.preventDefault(); sendInput({ t: 'w', dy: e.deltaY }); };
  const onContextMenu = (e) => e.preventDefault();
  const onKeyDown = (e) => { if (!controlEnabled) return; if (isTyping(e)) return; e.preventDefault(); sendInput({ t: 'kd', code: e.code, key: e.key }); };
  const onKeyUp = (e) => { if (!controlEnabled) return; if (isTyping(e)) return; e.preventDefault(); sendInput({ t: 'ku', code: e.code, key: e.key }); };

  // Sohbet kutusuna yazarken tuşları host'a gönderme.
  function isTyping(e) { return e.target === chatText; }

  function bindInput() {
    stage.addEventListener('mousemove', onMouseMove);
    stage.addEventListener('mousedown', onMouseDown);
    stage.addEventListener('mouseup', onMouseUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  }
  function unbindInput() {
    stage.removeEventListener('mousemove', onMouseMove);
    stage.removeEventListener('mousedown', onMouseDown);
    stage.removeEventListener('mouseup', onMouseUp);
    stage.removeEventListener('wheel', onWheel);
    stage.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  }

  // ---------------------------------------------------------------------------
  // Sohbet
  // ---------------------------------------------------------------------------
  function addMsg(kind, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + kind; div.textContent = text;
    chatLog.appendChild(div); chatLog.scrollTop = chatLog.scrollHeight;
  }
  function sendChat() {
    const text = chatText.value.trim(); if (!text) return;
    sendControl({ t: 'chat', text }); addMsg('me', text); chatText.value = '';
  }

  // ---------------------------------------------------------------------------
  // Pano
  // ---------------------------------------------------------------------------
  async function sendClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      sendControl({ t: 'clip', text });
      addMsg('sys', 'Panonuz uzak makineye gönderildi.');
    } catch {
      addMsg('sys', 'Pano okunamadı (tarayıcı izni gerekli).');
    }
  }

  // ---------------------------------------------------------------------------
  // Monitör seçimi
  // ---------------------------------------------------------------------------
  function populateMonitors(list, current) {
    if (!Array.isArray(list) || !list.length) return;
    monitorSelect.innerHTML = '';
    list.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = s.id; opt.textContent = s.name || `Ekran ${i + 1}`;
      monitorSelect.appendChild(opt);
    });
    if (current) monitorSelect.value = current;
  }

  // ---------------------------------------------------------------------------
  // Dosya transferi
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
      if (m.t === 'meta') { fileRecv = { name: m.name, size: m.size, mime: m.mime, chunks: [], received: 0 }; fileStatus.textContent = `Alınıyor: ${m.name} — %0`; }
      else if (m.t === 'end' && fileRecv) { finalizeRecv(); }
    } else if (fileRecv) {
      fileRecv.chunks.push(new Uint8Array(data));
      fileRecv.received += data.byteLength;
      const pct = fileRecv.size ? Math.round((fileRecv.received / fileRecv.size) * 100) : 0;
      fileStatus.textContent = `Alınıyor: ${fileRecv.name} — %${pct}`;
    }
  }

  function finalizeRecv() {
    const blob = new Blob(fileRecv.chunks, { type: fileRecv.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileRecv.name; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    addMsg('sys', `Dosya indirildi: ${fileRecv.name}`);
    fileStatus.textContent = `İndirildi: ${fileRecv.name}`;
    fileRecv = null;
  }

  // ---------------------------------------------------------------------------
  // UI olayları
  // ---------------------------------------------------------------------------
  connectBtn.addEventListener('click', connect);
  passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
  $('disconnect-btn').addEventListener('click', () => endSession('Bağlantı kesildi.'));
  controlToggle.addEventListener('change', () => { controlEnabled = controlToggle.checked; });
  $('fs-btn').addEventListener('click', () => { if (!document.fullscreenElement) stage.requestFullscreen?.(); else document.exitFullscreen?.(); });
  $('panel-btn').addEventListener('click', () => sidePanel.classList.toggle('hidden'));
  chatSend.addEventListener('click', sendChat);
  chatText.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
  clipBtn.addEventListener('click', sendClipboard);
  monitorSelect.addEventListener('change', () => sendControl({ t: 'setscreen', id: monitorSelect.value }));
  sendFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) { sendFile(fileInput.files[0]); fileInput.value = ''; } });

  idInput.addEventListener('input', () => {
    const d = idInput.value.replace(/\D/g, '').slice(0, 9);
    idInput.value = d.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
  });
})();
