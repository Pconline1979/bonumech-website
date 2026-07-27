# Windows Hızlı Kurulum

> **Not:** Bu uygulama **Node.js** ile çalışır (PHP değil). XAMPP'ın Apache'si
> WebSocket sinyalleşme sunucusunu çalıştıramaz; sunucuyu Node ile başlatırsınız.
> Dosyaları `htdocs` altında tutmanızda sakınca yok, ama çalıştırmak Node iledir.

## 0) Ön koşul: Node.js

[https://nodejs.org](https://nodejs.org) adresinden **LTS** sürümünü kurun.
Kurulumu doğrulayın (yeni bir komut istemi açıp):

```bat
node -v
npm -v
```

## 1) Kodu bilgisayara indirin

### Yöntem A — Git ile (önerilen)

Komut istemi (cmd) açın:

```bat
cd C:\xampp\htdocs
git clone -b claude/remote-support-app-68c34g https://github.com/Pconline1979/bonumech-website.git TeamDesk
```

Bu, kodu `C:\xampp\htdocs\TeamDesk` klasörüne indirir.

### Yöntem B — ZIP ile (Git yoksa)

1. Şu adrese gidin:
   `https://github.com/Pconline1979/bonumech-website/tree/claude/remote-support-app-68c34g`
2. Yeşil **Code** düğmesi → **Download ZIP**.
3. ZIP'i açıp içindekileri `C:\xampp\htdocs\TeamDesk` klasörüne kopyalayın.

## 2) Sunucuyu başlatın

`C:\xampp\htdocs\TeamDesk` klasöründe **start-server.bat** dosyasına çift tıklayın.
(İlk çalıştırmada bağımlılıkları indirir, sonra `http://localhost:8080` açılır.)

## 3) Host'u (kontrol edilecek makine) başlatın

Aynı klasördeki **start-host.bat** dosyasına çift tıklayın.
Açılan pencerede bir **ID** ve **oturum şifresi** görünür.

> Sunucu **başka bir makinede/sunucuda** ise: `start-host.bat` dosyasını Not Defteri
> ile açıp `set BONUMECH_SERVER=ws://SUNUCU_ADRESI:8080` satırını etkinleştirin.

## 4) Destek verin (viewer)

Destek veren kişi tarayıcıda `http://SUNUCU_ADRESI:8080` (aynı makinede test için
`http://localhost:8080`) adresini açar, host'taki **ID** ve **şifreyi** girer, **Bağlan**'a basar.
Host'ta çıkan onay ekranından **İzin ver** denince ekran paylaşımı başlar.

---

### Sık sorunlar

- **`node` tanınmıyor:** Node.js kurulu değil ya da komut istemini kurulumdan sonra
  yeniden açmadınız.
- **`npm install` host tarafında hata verdi:** `nut.js` derlenebilir bileşen içerir;
  Windows'ta genelde hazır ikili iner. Sorun olursa
  [windows-build-tools](https://github.com/nodejs/node-gyp#on-windows) gerekebilir.
- **Farklı ağdan bağlanılmıyor:** Katı NAT arkasında **TURN** sunucusu gerekir
  (bkz. ana `README.md`).
- **XAMPP 80 portu:** Bu uygulama 80'i kullanmaz (varsayılan 8080), XAMPP ile çakışmaz.
