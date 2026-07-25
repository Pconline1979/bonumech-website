/**
 * Bonumech Remote Support - Signaling & Relay Server
 * ---------------------------------------------------
 * Sorumluluklar:
 *  - Host (kontrol edilen makine) kaydı: benzersiz 9 haneli ID + oturum şifresi üretir.
 *  - Viewer (destek veren) doğrulaması: ID + şifre ile hosta bağlanma isteğini eşleştirir.
 *  - WebRTC sinyalleşmesini (offer/answer/ICE) iki taraf arasında röle eder.
 *  - Web viewer'ı (public/) statik olarak servis eder.
 *
 * Not: Görüntü ve kontrol verisi P2P (WebRTC) akar; bu sunucudan geçmez.
 * Sadece bağlantı kurulumu (sinyalleşme) bu sunucu üzerinden yapılır.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

/**
 * ICE (STUN/TURN) yapılandırması. Ortam değişkenleri ile TURN eklenebilir:
 *   TURN_URL   = turn:turn.ornek.com:3478   (virgülle birden fazla verilebilir)
 *   TURN_USER  = kullanıcı
 *   TURN_PASS  = parola
 * Sunucu bu yapılandırmayı hem host'a hem viewer'a dağıtır; böylece kod değişmeden
 * TURN devreye alınabilir.
 */
function buildIceServers() {
  const servers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  if (process.env.TURN_URL) {
    const turn = { urls: process.env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean) };
    if (process.env.TURN_USER) turn.username = process.env.TURN_USER;
    if (process.env.TURN_PASS) turn.credential = process.env.TURN_PASS;
    servers.push(turn);
  }
  return servers;
}
const ICE_SERVERS = buildIceServers();

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, hosts: hosts.size }));
app.get('/ice-config', (_req, res) => res.json({ iceServers: ICE_SERVERS }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let connSeq = 1;
const conns = new Map(); // connId -> ws
const hosts = new Map(); // hostId (string) -> { connId, password }

function genId() {
  let id;
  do {
    id = String(Math.floor(100000000 + Math.random() * 900000000));
  } while (hosts.has(id));
  return id;
}

function genPassword() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function send(connId, obj) {
  const ws = conns.get(connId);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// Bağlantı eşleşmesini bildirim göndermeden temizler.
function clearLink(ws) {
  if (ws.peer != null) {
    const peer = conns.get(ws.peer);
    if (peer) {
      peer.peer = null;
      peer.busy = false;
    }
    ws.peer = null;
    ws.busy = false;
  }
}

// Eşi bilgilendirerek (peer-left) eşleşmeyi sonlandırır.
function unlink(ws) {
  if (ws.peer != null) {
    send(ws.peer, { type: 'peer-left' });
    clearLink(ws);
  }
}

wss.on('connection', (ws) => {
  const connId = connSeq++;
  ws.connId = connId;
  ws.role = null;
  ws.peer = null;
  ws.busy = false;
  ws.hostId = null;
  conns.set(connId, ws);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      // --- Host, kendini kaydeder ---
      case 'register': {
        ws.role = 'host';
        // Host daha önceki ID'sini korumak isteyebilir; boşsa/alınmışsa yeni üret.
        const id = msg.id && !hosts.has(String(msg.id)) ? String(msg.id) : genId();
        const password = msg.password ? String(msg.password) : genPassword();
        ws.hostId = id;
        hosts.set(id, { connId, password });
        send(connId, { type: 'registered', id, password, iceServers: ICE_SERVERS });
        break;
      }

      // --- Host oturum şifresini değiştirir ---
      case 'set-password': {
        if (ws.hostId && hosts.has(ws.hostId)) {
          const password = String(msg.password || genPassword());
          hosts.get(ws.hostId).password = password;
          send(connId, { type: 'password-set', password });
        }
        break;
      }

      // --- Viewer, host'a bağlanmak ister ---
      case 'join': {
        ws.role = 'viewer';
        const host = hosts.get(String(msg.id));
        if (!host) {
          send(connId, { type: 'join-error', reason: 'not-found' });
          break;
        }
        if (String(host.password) !== String(msg.password)) {
          send(connId, { type: 'join-error', reason: 'bad-password' });
          break;
        }
        const hostWs = conns.get(host.connId);
        if (!hostWs || hostWs.readyState !== hostWs.OPEN) {
          send(connId, { type: 'join-error', reason: 'offline' });
          break;
        }
        if (hostWs.busy) {
          send(connId, { type: 'join-error', reason: 'busy' });
          break;
        }
        // İki tarafı eşleştir
        ws.peer = host.connId;
        hostWs.peer = connId;
        hostWs.busy = true;
        ws.busy = true;
        send(host.connId, { type: 'peer-joined', peer: connId });
        send(connId, { type: 'join-ok', peer: host.connId, iceServers: ICE_SERVERS });
        break;
      }

      // --- Host bağlantı isteğini reddeder (onay ekranı) ---
      case 'reject': {
        if (ws.peer != null) {
          send(ws.peer, { type: 'rejected' });
          clearLink(ws);
        }
        break;
      }

      // --- WebRTC sinyal röleleme (offer/answer/ICE) ---
      case 'signal': {
        if (ws.peer != null) {
          send(ws.peer, { type: 'signal', from: connId, payload: msg.payload });
        }
        break;
      }

      // --- Oturumu sonlandır ---
      case 'bye': {
        unlink(ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    conns.delete(connId);
    if (ws.hostId && hosts.get(ws.hostId)?.connId === connId) {
      hosts.delete(ws.hostId);
    }
    unlink(ws);
  });

  ws.on('error', () => {
    /* yoksay - close event temizler */
  });
});

server.listen(PORT, () => {
  console.log(`[Bonumech Remote] Sinyalleşme sunucusu çalışıyor: http://localhost:${PORT}`);
});
