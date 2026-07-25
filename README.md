# Bonumech Uzak Destek (Remote Support)

TeamViewer / AnyDesk / RustDesk benzeri, **kendinize ait sunucu-istemci** ile çalışan
uzaktan destek uygulaması. Destek veren kişi bir **web tarayıcısından** (kurulum gerekmez),
uzak makinenin ekranını görür ve **fare + klavye ile tam kontrol** eder.

```
┌────────────────┐    WebSocket (sinyalleşme)   ┌──────────────────────┐
│  HOST (Windows)│◄────────────────────────────►│   SUNUCU (Node.js)   │
│  Electron ajanı│                               │  sinyal + web viewer │
│  ekran + girdi │                               └──────────┬───────────┘
└───────┬────────┘                                          │ WebSocket
        │                                                   ▼
        │           WebRTC (P2P: ekran videosu + kontrol)   ┌──────────────┐
        └──────────────────────────────────────────────────►│ VIEWER (web) │
                                                             │  tarayıcı    │
                                                             └──────────────┘
```

- **Ekran görüntüsü ve kontrol verisi P2P (WebRTC) akar** — sunucudan geçmez, düşük gecikme.
- Sunucu yalnızca **bağlantı kurulumu** (ID/şifre eşleştirme + WebRTC sinyalleşmesi) yapar.

---

## Bileşenler

| Klasör    | Nedir                                   | Nerede çalışır            |
|-----------|-----------------------------------------|---------------------------|
| `server/` | Sinyalleşme sunucusu + web viewer       | Bir sunucu/VPS (Node.js)  |
| `host/`   | Kontrol edilen makinenin ajanı (Electron)| Windows masaüstü          |
| `server/public/` | Tarayıcı görüntüleyici (viewer)  | Destek verenin tarayıcısı |

---

## Kurulum ve Çalıştırma

### 1) Sunucu

```bash
cd server
npm install
npm start          # varsayılan: http://localhost:8080  (PORT ile değiştirilebilir)
```

Sunucu hem WebSocket sinyalleşmesini yürütür hem de viewer web sayfasını servis eder.
Destek veren kişi tarayıcıda `http://SUNUCU_ADRESI:8080` adresini açar.

### 2) Host (kontrol edilecek Windows makine)

```bash
cd host
npm install
# Sunucu adresini belirtin (uzak sunucu için gerekli):
set BONUMECH_SERVER=ws://SUNUCU_ADRESI:8080
npm start
```

Uygulama açıldığında bir **ID** ve **oturum şifresi** gösterir. Bunları destek veren kişiye iletin.

Windows kurulum paketi (.exe) üretmek için:

```bash
cd host
npm run dist       # dist/ altında NSIS installer oluşur
```

### 3) Viewer (destek veren)

Tarayıcıda sunucu adresini açın → host'un **ID**'sini ve **şifresini** girin → **Bağlan**.
Uzak ekran görünür; fare/klavye ile kontrol edebilirsiniz. Sağ üstteki **Kontrol**
anahtarı ile kontrolü geçici olarak devre dışı bırakabilirsiniz.

---

## Güvenlik Notları

- Her oturum **6 haneli oturum şifresi** ile korunur; host'ta yeni şifre üretilebilir (⟳).
- Üretim ortamında sunucuyu **HTTPS/WSS** (TLS) arkasında çalıştırın. `getDisplayMedia`
  ve pano gibi tarayıcı özellikleri güvenli bağlam (https) gerektirir.
- **NAT arkası internet erişimi** için bir **TURN sunucusu** eklemeniz gerekir
  (örn. [coturn](https://github.com/coturn/coturn)). ICE ayarları `host.js` ve `viewer.js`
  içindeki `ICE_SERVERS` listesindedir; yalnızca STUN ile katı NAT'larda bağlantı kurulamayabilir.
- Host uygulaması, karşı tarafa **tam fare/klavye kontrolü** verir. Yalnızca güvendiğiniz
  kişilere ID/şifre paylaşın ve oturum bitince host penceresini kapatın (tepsiden Çıkış).

---

## Yol Haritası (sonraki adımlar)

- [ ] TURN sunucusu entegrasyonu + yapılandırma dosyası
- [ ] Dosya transferi (WebRTC data channel)
- [ ] Sohbet paneli
- [ ] Çoklu monitör seçimi
- [ ] Pano (clipboard) senkronizasyonu
- [ ] Kalıcı ID (host cihaz kimliğini diske kaydeder)
- [ ] Host tarafında "izin iste" onay ekranı (bağlantı öncesi kullanıcı onayı)

---

## Teknik Ayrıntılar

- **Sinyalleşme protokolü** (JSON, WebSocket): `register` / `join` / `signal` / `peer-joined`
  / `peer-left` / `bye`. Bkz. `server/server.js`.
- **Kontrol protokolü** (WebRTC data channel, JSON): fare `m/d/u/w`, klavye `kd/ku`.
  Koordinatlar `[0,1]` normalize edilir; host gerçek çözünürlüğe ölçekler.
  Bkz. `host/input.js` ve `server/public/viewer.js`.
- **Girdi enjeksiyonu**: [`@nut-tree-fork/nut-js`](https://github.com/nut-tree/nut.js) (Windows).
