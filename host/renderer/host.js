/**
 * Bonumech Remote Support - Host renderer
 * ---------------------------------------
 * - Sunucuya kaydolur, ID + oturum şifresini gösterir.
 * - Viewer katıldığında ekranı yakalayıp WebRTC ile yayınlar.
 * - Kontrol kanalından gelen olayları ana sürece (nut.js) iletir.
 */

(() => {
  'use strict';

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Üretim için TURN önerilir (internet üzerinden NAT geçişi):
    // { urls: 'turn:turn.ornek.com:3478', username: '...', credential: '...' },
  ];

  const idValue = document.getElementById('id-value');
  const passValue = document.getElementById('pass-value');
  const statusText = document.getElementById('status-text');
  const statusDot = document.querySelector('#status .dot');
  const localPreview = document.getElementById('local-preview');
  const newPassBtn = document.getElementById('new-pass');

  let ws = null;
  let pc = null;
  let controlChannel = null;
  let localStream = null;
  let myId = null;
  let peerId = null;
  let reconnectTimer = null;

  function setStatus(text, dotClass) {
    statusText.textContent = text;
    statusDot.className = 'dot ' + dotClass;
  }

  function groupDigits(s) {
    return String(s).replace(/(\d{3})(?=\d)/g, '$1 ').trim();
  }

  async function start() {
    const url = await window.hostAPI.serverUrl();
    connect(url);
  }

  function connect(url) {
    setStatus('Sunucuya bağlanılıyor…', 'dot-wait');
    ws = new WebSocket(url);

    ws.onopen = () => {
      // Önceki ID'yi koru (varsa) - yeniden bağlanmada aynı ID.
      ws.send(JSON.stringify({ type: 'register', id: myId || undefined }));
    };

    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case 'registered':
          myId = msg.id;
          idValue.textContent = groupDigits(msg.id);
          passValue.textContent = groupDigits(msg.password);
          setStatus('Hazır — bağlantı bekleniyor', 'dot-ok');
          window.hostAPI.reportState({ connected: false, id: myId });
          break;

        case 'password-set':
          passValue.textContent = groupDigits(msg.password);
          break;

        case 'peer-joined':
          peerId = msg.peer;
          setStatus('Destek bağlanıyor…', 'dot-live');
          await startSharing();
          break;

        case 'signal':
          await handleSignal(msg.payload);
          break;

        case 'peer-left':
          resetSession('Hazır — bağlantı bekleniyor', 'dot-ok');
          break;
      }
    };

    ws.onclose = () => {
      setStatus('Bağlantı koptu — yeniden deneniyor…', 'dot-err');
      scheduleReconnect(url);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  function scheduleReconnect(url) {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(url), 3000);
  }

  async function startSharing() {
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (e) {
      setStatus('Ekran paylaşımı reddedildi/başarısız', 'dot-err');
      return;
    }
    localPreview.srcObject = localStream;

    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    // Kontrol kanalını host oluşturur; viewer bu kanaldan olay gönderir.
    controlChannel = pc.createDataChannel('control', { ordered: true });
    controlChannel.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      window.hostAPI.inject(ev);
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) signal({ candidate: e.candidate });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setStatus('Oturum aktif — uzaktan kontrol ediliyor', 'dot-live');
        window.hostAPI.reportState({ connected: true, id: myId });
      } else if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        if (pc.connectionState === 'failed') resetSession('Hazır — bağlantı bekleniyor', 'dot-ok');
      }
    };

    // Ekran paylaşımı kullanıcı tarafından durdurulursa
    localStream.getVideoTracks()[0].addEventListener('ended', () => {
      resetSession('Ekran paylaşımı durduruldu', 'dot-err');
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signal({ sdp: pc.localDescription });
  }

  async function handleSignal(payload) {
    if (!pc) return;
    if (payload.sdp) {
      await pc.setRemoteDescription(payload.sdp);
    } else if (payload.candidate) {
      try { await pc.addIceCandidate(payload.candidate); } catch { /* yoksay */ }
    }
  }

  function signal(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', payload }));
    }
  }

  function resetSession(text, dot) {
    if (controlChannel) { try { controlChannel.close(); } catch {} controlChannel = null; }
    if (pc) { try { pc.close(); } catch {} pc = null; }
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
    localPreview.srcObject = null;
    peerId = null;
    window.hostAPI.reportState({ connected: false, id: myId });
    setStatus(text, dot);
  }

  newPassBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set-password' }));
    }
  });

  start();
})();
