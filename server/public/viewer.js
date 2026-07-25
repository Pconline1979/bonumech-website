/**
 * Bonumech Uzak Destek - Web Görüntüleyici (Viewer)
 * -------------------------------------------------
 * - Sunucuya WebSocket ile bağlanır, ID+şifre ile host'a katılır.
 * - WebRTC ile host'un ekran görüntüsünü alır (video track).
 * - Fare/klavye olaylarını data channel üzerinden host'a gönderir.
 */

(() => {
  'use strict';

  // Varsayılan ICE; sunucu 'join-ok' ile gerçek yapılandırmayı (TURN dahil) gönderir.
  const DEFAULT_ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  let iceServers = DEFAULT_ICE;

  // --- DOM ---
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

  // --- Durum ---
  let ws = null;
  let pc = null;
  let controlChannel = null;
  let peerId = null;
  let controlEnabled = true;

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
    if (id.length < 6 || pass.length < 4) {
      setStatus('Geçerli bir ID ve şifre girin.', 'err');
      return;
    }

    connectBtn.disabled = true;
    setStatus('Sunucuya bağlanılıyor…', 'info');

    ws = new WebSocket(wsUrl());

    ws.onopen = () => {
      setStatus('Host aranıyor…', 'info');
      ws.send(JSON.stringify({ type: 'join', id, password: pass }));
    };

    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case 'join-error':
          setStatus(errorText(msg.reason), 'err');
          connectBtn.disabled = false;
          ws.close();
          break;

        case 'join-ok':
          peerId = msg.peer;
          if (Array.isArray(msg.iceServers) && msg.iceServers.length) iceServers = msg.iceServers;
          setStatus('Onay bekleniyor… (uzak kullanıcı bağlantıyı onaylamalı)', 'info');
          await setupPeer();
          break;

        case 'signal':
          await handleSignal(msg.payload);
          break;

        case 'rejected':
          endSession('Bağlantı uzak kullanıcı tarafından reddedildi.');
          break;

        case 'peer-left':
          endSession('Uzak makine bağlantıyı kapattı.');
          break;
      }
    };

    ws.onclose = () => {
      if (!pc) connectBtn.disabled = false;
    };
    ws.onerror = () => {
      setStatus('Sunucuya bağlanılamadı.', 'err');
      connectBtn.disabled = false;
    };
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

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        signal({ candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      video.srcObject = e.streams[0];
      showRemoteScreen();
    };

    // Host'un oluşturduğu kontrol kanalını al
    pc.ondatachannel = (e) => {
      if (e.channel.label === 'control') {
        controlChannel = e.channel;
        controlChannel.onopen = () => bindInput();
        controlChannel.onclose = () => unbindInput();
      }
    };

    pc.onconnectionstatechange = () => {
      updateQuality(pc.connectionState);
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        // 'disconnected' geçici olabilir; 'failed'/'closed' kesin.
        if (pc.connectionState === 'failed') endSession('Bağlantı koptu (NAT/TURN gerekli olabilir).');
      }
    };

    // Host offer üretecek; biz beklerken hazırız. (Offer signal ile gelecek.)
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
      try { await pc.addIceCandidate(payload.candidate); } catch { /* yoksay */ }
    }
  }

  function signal(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', payload }));
    }
  }

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
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'bye' })); } catch {}
      ws.close();
    }
    ws = null;
    video.srcObject = null;
    remoteScreen.classList.add('hidden');
    connectScreen.classList.remove('hidden');
    connectBtn.disabled = false;
    setStatus(reason || 'Oturum sonlandı.', 'info');
  }

  // ---------------------------------------------------------------------------
  // Kontrol (fare/klavye) → host
  // ---------------------------------------------------------------------------
  let lastMove = 0;

  function sendControl(obj) {
    if (controlEnabled && controlChannel && controlChannel.readyState === 'open') {
      controlChannel.send(JSON.stringify(obj));
    }
  }

  // Fare konumunu, letterbox (contain) dikkate alarak [0,1] aralığına normalize et.
  function normCoords(e) {
    const rect = video.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const dispW = vw * scale, dispH = vh * scale;
    const offX = (rect.width - dispW) / 2, offY = (rect.height - dispH) / 2;
    let x = (e.clientX - rect.left - offX) / dispW;
    let y = (e.clientY - rect.top - offY) / dispH;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    return { x, y };
  }

  const onMouseMove = (e) => {
    const now = performance.now();
    if (now - lastMove < 16) return; // ~60fps throttle
    lastMove = now;
    const c = normCoords(e);
    if (c) sendControl({ t: 'm', x: c.x, y: c.y });
  };
  const onMouseDown = (e) => {
    const c = normCoords(e);
    if (c) sendControl({ t: 'd', b: e.button, x: c.x, y: c.y });
  };
  const onMouseUp = (e) => {
    const c = normCoords(e);
    if (c) sendControl({ t: 'u', b: e.button, x: c.x, y: c.y });
  };
  const onWheel = (e) => {
    e.preventDefault();
    sendControl({ t: 'w', dy: e.deltaY });
  };
  const onContextMenu = (e) => e.preventDefault();
  const onKeyDown = (e) => {
    if (!controlEnabled) return;
    e.preventDefault();
    sendControl({ t: 'kd', code: e.code, key: e.key });
  };
  const onKeyUp = (e) => {
    if (!controlEnabled) return;
    e.preventDefault();
    sendControl({ t: 'ku', code: e.code, key: e.key });
  };

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
  // UI olayları
  // ---------------------------------------------------------------------------
  connectBtn.addEventListener('click', connect);
  passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
  $('disconnect-btn').addEventListener('click', () => endSession('Bağlantı kesildi.'));
  controlToggle.addEventListener('change', () => { controlEnabled = controlToggle.checked; });
  $('fs-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) stage.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  // ID alanını okunaklı gruplandır
  idInput.addEventListener('input', () => {
    const d = idInput.value.replace(/\D/g, '').slice(0, 9);
    idInput.value = d.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
  });
})();
