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
Uzak ekran görünür; fare/klavye ile kontrol edebilirsiniz.

Araç çubuğu (sağ üst):
- **Monitör** açılır listesi — çoklu monitörlü makinelerde ekran değiştirir.
- **📋** — kendi panonuzu uzak makineye gönderir. (Host panosu değişince otomatik size gelir.)
- **Kontrol** anahtarı — uzaktan kontrolü geçici olarak durdurur (yalnızca izleme).
- **💬** — sohbet ve dosya transferi panelini açar/kapatır.
- **⛶** — tam ekran.

**Sohbet & dosya:** 💬 panelinden karşılıklı mesajlaşabilir ve dosya gönderebilirsiniz.
Viewer'a gelen dosyalar tarayıcıdan indirilir; host'a gelen dosyalar **İndirilenler**
klasörüne kaydedilir.

---

## Güvenlik Notları

- Her oturum **6 haneli oturum şifresi** ile korunur; host'ta yeni şifre üretilebilir (⟳).
- Üretim ortamında sunucuyu **HTTPS/WSS** (TLS) arkasında çalıştırın. `getDisplayMedia`
  ve pano gibi tarayıcı özellikleri güvenli bağlam (https) gerektirir.
- **Bağlantı onayı:** Bir viewer katıldığında host makinesinde bir **onay ekranı** çıkar
  (İzin ver / Reddet, 30 sn sonra otomatik ret). Gözetimsiz destek için host penceresindeki
  **"Gözetimsiz erişim — otomatik onayla"** kutusu işaretlenebilir.
- **NAT arkası internet erişimi** için bir **TURN sunucusu** eklemeniz gerekir
  (örn. [coturn](https://github.com/coturn/coturn)). Sunucuyu şu ortam değişkenleriyle başlatın;
  yapılandırma otomatik olarak host ve viewer'a dağıtılır (kod değişikliği gerekmez):

  ```bash
  TURN_URL="turn:turn.ornek.com:3478" TURN_USER="kullanici" TURN_PASS="parola" npm start
  ```

  Yalnızca STUN ile katı NAT'larda bağlantı kurulamayabilir.
- Host uygulaması, karşı tarafa **tam fare/klavye kontrolü** verir. Yalnızca güvendiğiniz
  kişilere ID/şifre paylaşın ve oturum bitince host penceresini kapatın (tepsiden Çıkış).

---

## Yol Haritası (sonraki adımlar)

- [x] TURN sunucusu yapılandırması (ortam değişkeni ile, sunucudan dağıtılır)
- [x] Host tarafında "izin iste" onay ekranı (+ gözetimsiz otomatik onay)
- [x] Dosya transferi (WebRTC data channel, çift yönlü)
- [x] Sohbet paneli (host ↔ viewer)
- [x] Çoklu monitör seçimi (canlı geçiş + koordinat kalibrasyonu)
- [x] Pano (clipboard) senkronizasyonu (çift yönlü)
- [x] Kalıcı ID (host cihaz kimliğini diske kaydeder)
- [ ] Ses aktarımı (mikrofon/sistem sesi)
- [ ] Oturum kaydı (video)
- [ ] Çoklu izleyici (birden fazla destek görevlisi)

---

## Teknik Ayrıntılar

- **Sinyalleşme protokolü** (JSON, WebSocket): `register` / `join` / `signal` / `peer-joined`
  / `peer-left` / `bye`. Bkz. `server/server.js`.
- **Kontrol kanalı** (`control` data channel, JSON): fare `m/d/u/w`, klavye `kd/ku`,
  sohbet `chat`, pano `clip`, monitör listesi `screens`, monitör seçimi `setscreen`.
  Koordinatlar `[0,1]` normalize edilir; host seçili monitörün sanal masaüstü
  sınırlarına ölçekler (çoklu monitör offset'i dahil).
- **Dosya kanalı** (`file` data channel): `meta` (JSON) → ikili parçalar (16 KB, geri-basınç
  kontrollü) → `end`. Viewer'da indirilir, host'ta İndirilenler klasörüne yazılır.
- **Girdi enjeksiyonu**: [`@nut-tree-fork/nut-js`](https://github.com/nut-tree/nut.js) (Windows).
- **Kalıcı kimlik**: host, ID+şifreyi `userData/device-creds.json` içine kaydeder ve
  yeniden başlatmada aynı kimlikle kaydolur.
