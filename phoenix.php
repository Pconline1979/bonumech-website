<?php
/* =====================================================================
   phoenix.php  —  Phoenix Contact Web Sitesi  OCI 3.0
   Fiyat / Ürün Bilgisi Keşif & Çekme Aracı  (XAMPP / PHP, tek dosya)
   ---------------------------------------------------------------------
   KAYNAK: "Open Catalog Interface (OCI) — Connection to the Phoenix
   Contact website" V1.5 (Ocak 2014) dokümanı.

   ÖNEMLİ FARK (Siemens IMALL'a göre):
     Phoenix'in dokümante ettiği arayüz OCI **3.0**'dır ve Siemens'teki
     gibi makine-okunur fiyat döndüren bir VALIDATE fonksiyonu YOKTUR.
     Belgedeki fonksiyonlar:
       - (varsayılan)  : otomatik login + katalog
       - PRODUCTDETAILS: ürünün web sayfasını (HTML) açar
       - SEARCH        : arama sonucu sayfasını açar
     Dolayısıyla fiyat, giriş sonrası dönen HTML sayfadan "kazınır".
     Bu ancak hesabınız sayfada net fiyatı gösteriyorsa çalışır.

   NE YAPMALI?
     1) Bu dosyayı XAMPP'a koyun (htdocs ya da vhost public klasörü).
     2) http://localhost/phoenix.php (veya http://imall.local/phoenix.php)
     3) USERNAME + PASSWORD girin (Phoenix'in verdiği OCI hesabı).
     4) Önce "1) KEŞİF" modunu TEK kodla (örn. 0402174) çalıştırın:
        dönen yanıtın TÜMÜNÜ görürsünüz — login sayfası mı geldi, fiyat
        HTML'de mi, NEW_ITEM alanı var mı, hepsi listelenir.
   ===================================================================== */

error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING & ~E_NOTICE);
@set_time_limit(0);
@ini_set('memory_limit', '1024M');

if (!function_exists('curl_init')) {
    die('<h2>php_curl eklentisi kapalı.</h2><p>C:\\xampp\\php\\php.ini dosyasında '
      . '<code>;extension=curl</code> satırının başındaki noktalı virgülü kaldırıp '
      . 'Apache\'yi yeniden başlatın.</p>');
}

/* ---------- Form değerleri (POST) veya ilk açılış varsayılanları ---------- */
$run = isset($_POST['run']);
$cfg = [
    // Dokümandaki resmi giriş adresi:
    'BASE_URL'   => trim($_POST['base_url'] ?? 'https://www.phoenixcontact.com/pxc-portal-login-external/SRM?vp=de&lang=de'),
    'USERNAME'   => trim($_POST['username'] ?? ''),
    'PASSWORD'   =>      $_POST['password']  ?? '',
    // Dokümanda SERVICE ve VENDOR "service"/"vendor" yer tutucu olarak geçiyor;
    // Phoenix size gerçek değerlerini verdiyse buraya yazın, yoksa boş bırakın.
    'SERVICE'    => trim($_POST['service']  ?? ''),
    'VENDOR'     => trim($_POST['vendor']   ?? ''),
    // HOOK_URL: gerçek SRM gerekmez; sadece geri-dönüş adresi olarak bir yer.
    'HOOK_URL'   => trim($_POST['hook_url'] ?? 'https://www.phoenixcontact.com/'),
    'METHOD'     => (($_POST['http_method'] ?? 'GET') === 'POST') ? 'POST' : 'GET',
    'TIMEOUT'    => 45,
    'VERIFY_SSL' => !isset($_POST['no_ssl']),
    'COOKIE'     => sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phoenix_cookies.txt',
];
$mode      = $_POST['mode']      ?? 'discover';
$searchStr = trim($_POST['search'] ?? '');
$concurrency = min(12, max(1, (int)($_POST['concurrency'] ?? 4)));
$codesRaw  = $_POST['codes'] ?? '';

$CSV_PATH = __DIR__ . DIRECTORY_SEPARATOR . 'phoenix_sonuc.csv';
$CSV_URL  = 'phoenix_sonuc.csv';
$RAW_PATH = __DIR__ . DIRECTORY_SEPARATOR . 'phoenix_kesif_ham.html';
$RAW_URL  = 'phoenix_kesif_ham.html';

/* ===================================================================== */
/*  ÇEKİRDEK                                                              */
/* ===================================================================== */

/* Dokümandaki OCI 3.0 sabit parametreleri */
function base_params($cfg) {
    $p = [
        '~OkCode'  => 'ADDI',   // doküman 3.1/3.2/3.3
        '~TARGET'  => '_top',
        '~CALLER'  => 'CTLG',
        'USERNAME' => $cfg['USERNAME'],
        'PASSWORD' => $cfg['PASSWORD'],
        'HOOK_URL' => $cfg['HOOK_URL'],
    ];
    if ($cfg['SERVICE'] !== '') $p['SERVICE'] = $cfg['SERVICE'];
    if ($cfg['VENDOR']  !== '') $p['VENDOR']  = $cfg['VENDOR'];
    return $p;
}

function make_handle($cfg, $params, $useCookieJar = true) {
    $method = strtoupper($cfg['METHOD'] ?? 'GET');
    $url = $cfg['BASE_URL'];
    if ($method === 'GET') {
        // BASE_URL'de zaten ?vp=de&lang=de var → mevcut sorguyu koru, & ile ekle
        $url .= (strpos($url, '?') === false ? '?' : '&') . http_build_query($params);
    }
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 8,
        CURLOPT_TIMEOUT        => $cfg['TIMEOUT'],
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => $cfg['VERIFY_SSL'],
        CURLOPT_SSL_VERIFYHOST => $cfg['VERIFY_SSL'] ? 2 : 0,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        CURLOPT_COOKIEFILE     => $cfg['COOKIE'],
        CURLOPT_HTTPHEADER     => ['Accept-Language: de,en;q=0.8,tr;q=0.6'],
    ];
    if ($method === 'GET') {
        $opts[CURLOPT_HTTPGET] = true;
    } else {
        $opts[CURLOPT_POST]       = true;
        $opts[CURLOPT_POSTFIELDS] = http_build_query($params);
    }
    if ($useCookieJar) { $opts[CURLOPT_COOKIEJAR] = $cfg['COOKIE']; }
    curl_setopt_array($ch, $opts);
    return $ch;
}

function oci_get($cfg, $params) {
    $ch = make_handle($cfg, $params, true);
    $body  = curl_exec($ch);
    $err   = curl_error($ch);
    $http  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $url   = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    curl_close($ch);
    return ['body' => $body ?: '', 'err' => $err, 'http' => $http, 'ctype' => (string)$ctype, 'url' => (string)$url];
}

/* PRODUCTDETAILS çağrısı için parametreler (doküman 3.2) */
function product_params($cfg, $code) {
    $p = base_params($cfg);
    $p['FUNCTION']  = 'PRODUCTDETAILS';
    $p['PRODUCTID'] = $code;
    return $p;
}

/* SEARCH çağrısı (doküman 3.3) */
function search_params($cfg, $term) {
    $p = base_params($cfg);
    $p['FUNCTION']     = 'SEARCH';
    $p['SEARCHSTRING'] = $term;
    return $p;
}

/* OCI tarzı NEW_ITEM-* gizli alanları (ihtimale karşı — varsa yakalarız) */
function parse_oci_fields($html) {
    $items = [];
    if (trim($html) === '') return $items;
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="utf-8" ?>' . $html);
    libxml_clear_errors();
    foreach (['input', 'textarea', 'select'] as $tag) {
        foreach ($dom->getElementsByTagName($tag) as $el) {
            $name = trim($el->getAttribute('name'));
            if ($name === '') continue;
            $val = $el->getAttribute('value');
            if ($val === '' && $tag === 'textarea') $val = trim($el->textContent);
            if (preg_match('/^NEW[_-]ITEM[_-]([A-Za-z0-9_]+?)(?:\[(\d+)\])?$/', $name, $m)) {
                $idx = isset($m[2]) && $m[2] !== '' ? (int)$m[2] : 1;
                $items[$idx][strtoupper($m[1])] = $val;
            }
        }
    }
    return $items;
}

/* Yanıttaki tüm form alan adları (teşhis) */
function all_field_names($html) {
    $names = [];
    if (trim($html) === '') return $names;
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="utf-8" ?>' . $html);
    libxml_clear_errors();
    foreach (['input', 'textarea', 'select', 'form'] as $t) {
        foreach ($dom->getElementsByTagName($t) as $el) {
            $n = trim($el->getAttribute('name'));
            if ($n !== '') $names[$n] = true;
        }
    }
    ksort($names);
    return array_keys($names);
}

/* HTML'den fiyat görünümlü değerleri kazı (best-effort).
   Hem yapılandırılmış ipuçlarını (data-*, json) hem de görsel "12,34 €"
   kalıplarını arar. */
function scrape_prices($html) {
    $hits = [];
    if (trim($html) === '') return $hits;

    // 1) data-price / itemprop=price / "price": ... benzeri yapılandırılmış ipuçları
    if (preg_match_all('/(data-[a-z-]*price[a-z-]*|itemprop\s*=\s*"price"|"price[A-Za-z]*")\s*[:=]\s*["\']?\s*([0-9][0-9.,\s]*)/i', $html, $m, PREG_SET_ORDER)) {
        foreach ($m as $x) $hits[] = ['kaynak' => trim($x[1]), 'deger' => trim($x[2])];
    }
    // 2) Para birimi kalıpları: 1.234,56 € / EUR 1234.56 / € 12,34
    if (preg_match_all('/(?:€|EUR|TL|TRY)\s*([0-9][0-9.\s]*,[0-9]{2}|[0-9][0-9,\s]*\.[0-9]{2})|([0-9][0-9.\s]*,[0-9]{2}|[0-9][0-9,\s]*\.[0-9]{2})\s*(?:€|EUR|TL|TRY)/u', $html, $m2, PREG_SET_ORDER)) {
        foreach ($m2 as $x) {
            $val = trim(($x[1] ?? '') !== '' ? $x[1] : ($x[2] ?? ''));
            if ($val !== '') $hits[] = ['kaynak' => 'para-kalıbı', 'deger' => $val];
        }
    }
    // En çok 25 eşleşme yeter
    return array_slice($hits, 0, 25);
}

/* Yanıtın ne olduğunu sınıflandır (login mi, ürün mü, hata mı) */
function classify($html, $url) {
    $h = mb_strtolower($html);
    $login = (strpos($h, 'password') !== false && strpos($h, 'username') !== false)
          || strpos($h, 'login') !== false || strpos($h, 'anmeld') !== false;
    $title = '';
    if (preg_match('/<title[^>]*>(.*?)<\/title>/is', $html, $m)) $title = trim(html_entity_decode(strip_tags($m[1])));
    return ['login_var' => $login, 'title' => $title];
}

/* Ürün kodlarını ayrıştır */
function parse_codes($raw) {
    $out = [];
    foreach (preg_split('/[\r\n]+/', (string)$raw) as $ln) {
        $ln = trim($ln);
        if ($ln !== '' && preg_match('/[;,\t]/', $ln)) {
            $parts = preg_split('/[;,\t]/', $ln);
            $ln = trim($parts[0]);
        }
        $ln = trim($ln, " \"'");
        if ($ln !== '') $out[] = $ln;
    }
    return $out;
}

function write_csv($rows, $path) {
    if (!$rows) return false;
    $cols = [];
    foreach ($rows as $r) foreach ($r as $k => $v) $cols[$k] = true;
    $preferred = ['PRODUCTID_SORGU','BASLIK','FIYAT_TAHMIN','FIYAT_KAYNAK','NEW_ITEM_PRICE','NEW_ITEM_CURRENCY','LOGIN_SAYFASI','HTTP','_DURUM'];
    $ordered = [];
    foreach ($preferred as $c) if (isset($cols[$c])) { $ordered[] = $c; unset($cols[$c]); }
    foreach (array_keys($cols) as $c) $ordered[] = $c;
    $fh = @fopen($path, 'w');
    if (!$fh) return false;
    fwrite($fh, "\xEF\xBB\xBF");
    fputcsv($fh, $ordered, ';');
    foreach ($rows as $r) {
        $line = [];
        foreach ($ordered as $c) $line[] = $r[$c] ?? '';
        fputcsv($fh, $line, ';');
    }
    fclose($fh);
    return true;
}

/* Tek ürün → satır */
function fetch_product_row($cfg, $code) {
    $res = oci_get($cfg, product_params($cfg, $code));
    $cls = classify($res['body'], $res['url']);
    $oci = parse_oci_fields($res['body']);
    $prices = scrape_prices($res['body']);

    $row = [
        'PRODUCTID_SORGU' => $code,
        'BASLIK'          => $cls['title'],
        'HTTP'            => $res['http'],
        'LOGIN_SAYFASI'   => $cls['login_var'] ? 'EVET' : 'hayır',
    ];
    // OCI alanı döndüyse (ihtimal düşük ama yakala)
    $idx = $oci ? min(array_keys($oci)) : null;
    if ($idx !== null) {
        if (isset($oci[$idx]['PRICE']))    $row['NEW_ITEM_PRICE']    = $oci[$idx]['PRICE'];
        if (isset($oci[$idx]['CURRENCY'])) $row['NEW_ITEM_CURRENCY'] = $oci[$idx]['CURRENCY'];
    }
    // Kazınan fiyat tahmini
    if ($prices) {
        $row['FIYAT_TAHMIN'] = $prices[0]['deger'];
        $row['FIYAT_KAYNAK'] = $prices[0]['kaynak'];
    }
    $hasPrice = isset($row['NEW_ITEM_PRICE']) || isset($row['FIYAT_TAHMIN']);
    if ($res['err'])            $row['_DURUM'] = 'HATA: ' . $res['err'];
    elseif ($cls['login_var'] && !$hasPrice) $row['_DURUM'] = 'LOGIN_DONDU';
    elseif ($hasPrice)         $row['_DURUM'] = 'OK';
    else                       $row['_DURUM'] = 'FIYAT_BULUNAMADI';
    return $row;
}

/* ===================================================================== */
/*  ÇALIŞTIRMA                                                            */
/* ===================================================================== */
$messages = [];
$rows     = [];
$discover = null;
$csvReady = false;
$elapsed  = 0;

if ($run) {
    if ($cfg['USERNAME'] === '' || $cfg['PASSWORD'] === '') {
        $messages[] = 'Kullanıcı adı / şifre boş. Phoenix OCI hesabınızı girin.';
    } else {
        $codes = parse_codes($codesRaw);
        $t0 = microtime(true);

        if ($mode === 'discover') {
            if (!$codes) { $messages[] = 'Keşif için en az bir ürün kodu girin (örn. 0402174).'; }
            else {
                $code = $codes[0];
                $res = oci_get($cfg, product_params($cfg, $code));
                @file_put_contents($RAW_PATH, $res['body']);
                $cls = classify($res['body'], $res['url']);
                $discover = [
                    'code'    => $code,
                    'http'    => $res['http'],
                    'ctype'   => $res['ctype'],
                    'err'     => $res['err'],
                    'url'     => $res['url'],
                    'len'     => strlen($res['body']),
                    'title'   => $cls['title'],
                    'login'   => $cls['login_var'],
                    'oci'     => parse_oci_fields($res['body']),
                    'prices'  => scrape_prices($res['body']),
                    'names'   => all_field_names($res['body']),
                    'text'    => trim(preg_replace('/\s+/', ' ', strip_tags($res['body']))),
                ];
            }
        }
        elseif ($mode === 'single') {
            if (!$codes) { $messages[] = 'Ürün kodu girin.'; }
            else {
                foreach ($codes as $c) { $rows[] = fetch_product_row($cfg, $c); usleep(200000); }
            }
        }
        elseif ($mode === 'search') {
            if ($searchStr === '') { $messages[] = 'Arama terimi girin (örn. 0402*).'; }
            else {
                $res = oci_get($cfg, search_params($cfg, $searchStr));
                @file_put_contents($RAW_PATH, $res['body']);
                $cls = classify($res['body'], $res['url']);
                $discover = [
                    'code'    => '(SEARCH) ' . $searchStr,
                    'http'    => $res['http'],
                    'ctype'   => $res['ctype'],
                    'err'     => $res['err'],
                    'url'     => $res['url'],
                    'len'     => strlen($res['body']),
                    'title'   => $cls['title'],
                    'login'   => $cls['login_var'],
                    'oci'     => parse_oci_fields($res['body']),
                    'prices'  => scrape_prices($res['body']),
                    'names'   => all_field_names($res['body']),
                    'text'    => trim(preg_replace('/\s+/', ' ', strip_tags($res['body']))),
                ];
            }
        }

        $elapsed = round(microtime(true) - $t0, 1);
        if ($rows) {
            $csvReady = write_csv($rows, $CSV_PATH);
            if (!$csvReady) $messages[] = 'CSV yazılamadı (klasör yazma izni?).';
        }
    }
}

function pick($r, $k) { return isset($r[$k]) ? htmlspecialchars($r[$k]) : ''; }
?>
<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phoenix Contact OCI — Fiyat Keşif/Çekme</title>
<style>
  :root { --line:#e2e8f0; --muted:#64748b; }
  * { box-sizing:border-box; }
  body { font-family:Segoe UI,Roboto,Arial,sans-serif; margin:0; background:#f1f5f9; color:#0f172a; }
  header { background:#0098a1; color:#fff; padding:16px 22px; }
  header h1 { margin:0; font-size:20px; }
  header p { margin:4px 0 0; opacity:.9; font-size:13px; }
  .wrap { max-width:1100px; margin:18px auto; padding:0 14px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:18px; margin-bottom:16px; }
  label { display:block; font-size:13px; font-weight:600; margin:10px 0 4px; }
  input[type=text], input[type=password], textarea, select {
    width:100%; padding:9px 10px; border:1px solid #cbd5e1; border-radius:7px; font-size:14px; font-family:inherit; }
  textarea { min-height:120px; font-family:Consolas,monospace; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
  .help { color:var(--muted); font-size:12px; margin-top:4px; }
  .modes label { display:flex; align-items:flex-start; gap:8px; font-weight:500; padding:8px; border:1px solid var(--line); border-radius:8px; margin-bottom:8px; cursor:pointer; }
  .modes input { margin-top:3px; }
  .modes b { color:#0e7490; }
  button { background:#0098a1; color:#fff; border:0; padding:12px 26px; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer; }
  button:hover { background:#007a82; }
  .msg { background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; padding:10px 12px; border-radius:8px; font-size:13px; margin-bottom:8px; white-space:pre-wrap; }
  .warn { background:#fef9c3; border:1px solid #fde047; color:#854d0e; padding:12px 14px; border-radius:8px; font-size:13px; margin-bottom:12px; }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  th,td { border:1px solid var(--line); padding:6px 8px; text-align:left; }
  th { background:#f8fafc; }
  .ok { color:#15803d; font-weight:600; }
  .bad { color:#b91c1c; font-weight:600; }
  .dl { display:inline-block; background:#0ea5e9; color:#fff; padding:9px 16px; border-radius:8px; text-decoration:none; font-weight:600; }
  code { background:#f1f5f9; padding:2px 5px; border-radius:4px; }
  .kv td:first-child { font-weight:600; width:240px; background:#f8fafc; }
  pre { background:#0f172a; color:#e2e8f0; padding:12px; border-radius:8px; overflow:auto; font-size:12px; max-height:340px; }
</style>
</head>
<body>
<header>
  <h1>Phoenix Contact — OCI 3.0 Fiyat Keşif / Çekme Aracı</h1>
  <p>Phoenix dokümanına (OCI V1.5) göre PRODUCTDETAILS / SEARCH çağrısı yapar. (Yerel XAMPP aracı)</p>
</header>

<div class="wrap">

  <div class="warn">
    <b>Önemli:</b> Phoenix'in bu arayüzü OCI <b>3.0</b>'dır ve Siemens'teki gibi makine-okunur fiyat döndüren
    bir <code>VALIDATE</code> fonksiyonu <b>yoktur</b>. <code>PRODUCTDETAILS</code> ürünün web sayfasını (HTML)
    açar; fiyat oradan <b>kazınır</b>. Bu, ancak hesabınız sayfada net fiyatı gösteriyorsa çalışır.
    Bu yüzden önce <b>1) KEŞİF</b> modunu tek kodla (örn. <code>0402174</code>) çalıştırın; ne döndüğünü görelim.
  </div>

  <form method="post" class="card">
    <div class="grid">
      <div>
        <label>Phoenix OCI Adresi (BASE_URL)</label>
        <input type="text" name="base_url" value="<?=htmlspecialchars($cfg['BASE_URL'])?>">
        <div class="help">Dokümandaki resmi adres: <code>.../pxc-portal-login-external/SRM?vp=de&amp;lang=de</code></div>
      </div>
      <div>
        <label>HOOK_URL (geri-dönüş adresi)</label>
        <input type="text" name="hook_url" value="<?=htmlspecialchars($cfg['HOOK_URL'])?>">
        <div class="help">Gerçek SRM gerekmez; herhangi bir geçerli adres olabilir.</div>
      </div>
    </div>

    <div class="grid">
      <div>
        <label>Kullanıcı adı (USERNAME)</label>
        <input type="text" name="username" value="<?=htmlspecialchars($cfg['USERNAME'])?>">
        <div class="help">Phoenix'in verdiği OCI kullanıcı adı.</div>
      </div>
      <div>
        <label>Şifre (PASSWORD)</label>
        <input type="password" name="password" value="<?=htmlspecialchars($cfg['PASSWORD'])?>">
        <div class="help">Phoenix OCI şifreniz. (Secret key gerekmiyor.)</div>
      </div>
    </div>

    <div class="grid3">
      <div>
        <label>SERVICE (opsiyonel)</label>
        <input type="text" name="service" value="<?=htmlspecialchars($cfg['SERVICE'])?>">
        <div class="help">Dokümanda yer tutucu. Phoenix size verdiyse yazın, yoksa boş bırakın.</div>
      </div>
      <div>
        <label>VENDOR (opsiyonel)</label>
        <input type="text" name="vendor" value="<?=htmlspecialchars($cfg['VENDOR'])?>">
        <div class="help">Yalnız SEARCH için; verilmediyse boş bırakın.</div>
      </div>
      <div>
        <label>Çağrı yöntemi</label>
        <select name="http_method">
          <option value="GET"  <?=$cfg['METHOD']==='GET'?'selected':''?>>GET (önce bunu deneyin)</option>
          <option value="POST" <?=$cfg['METHOD']==='POST'?'selected':''?>>POST</option>
        </select>
        <div class="help">OCI girişleri genelde GET ile yapılır.</div>
      </div>
    </div>

    <label>Ürün kodları (her satıra bir kod)</label>
    <textarea name="codes" placeholder="0402174"><?=htmlspecialchars($codesRaw)?></textarea>

    <label>Ne yapılsın?</label>
    <div class="modes">
      <label><input type="radio" name="mode" value="discover" <?=$mode==='discover'?'checked':''?>>
        <span><b>1) KEŞİF (önce bunu çalıştırın)</b> — İlk kodu <code>PRODUCTDETAILS</code> ile sorgular ve dönen yanıtın TÜMÜNÜ gösterir: login mi geldi, başlık, NEW_ITEM alanı, kazınan fiyatlar, tüm form alanları, ham metin.</span></label>
      <label><input type="radio" name="mode" value="single" <?=$mode==='single'?'checked':''?>>
        <span><b>2) Tek tek çek</b> — Her kodu <code>PRODUCTDETAILS</code> ile sorgular; bulabildiği fiyatı CSV'ye yazar. (Login dönerse "LOGIN_DONDU" der.)</span></label>
      <label><input type="radio" name="mode" value="search" <?=$mode==='search'?'checked':''?>>
        <span><b>3) Arama (SEARCH)</b> — Aşağıdaki terimle arama sonucu sayfasını çeker ve içeriğini gösterir.</span></label>
    </div>

    <div class="grid3">
      <div>
        <label>Arama terimi (SEARCH modu)</label>
        <input type="text" name="search" value="<?=htmlspecialchars($searchStr)?>">
        <div class="help">Örn. <code>0402*</code></div>
      </div>
      <div>
        <label>Bekleme/paralel</label>
        <input type="text" name="concurrency" value="<?=htmlspecialchars($concurrency)?>">
        <div class="help">Şimdilik sıralı çalışır; nazik olun.</div>
      </div>
      <div style="display:flex;align-items:flex-end;">
        <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin:0;">
          <input type="checkbox" name="no_ssl" <?=isset($_POST['no_ssl'])?'checked':''?>>
          SSL doğrulamayı kapat (yalnız yerel test)
        </label>
      </div>
    </div>

    <div style="margin-top:18px;">
      <button type="submit" name="run" value="1">Çalıştır</button>
    </div>
  </form>

  <?php if ($run): ?>
    <div class="card">
      <h3 style="margin-top:0;">Sonuç <?php if($elapsed) echo '<span style="font-weight:400;color:#64748b;font-size:13px;">('.$elapsed.' sn)</span>'; ?></h3>

      <?php foreach ($messages as $m): ?><div class="msg"><?=$m?></div><?php endforeach; ?>

      <?php if ($discover !== null): ?>
        <p>HTTP <b><?=$discover['http']?></b> · Content-Type: <code><?=htmlspecialchars($discover['ctype'])?></code>
           · <?=$discover['len']?> bayt · Son URL: <code><?=htmlspecialchars($discover['url'])?></code>
           · Ham yanıt: <a href="<?=$RAW_URL?>" target="_blank">phoenix_kesif_ham.html</a></p>
        <table class="kv"><tbody>
          <tr><td>Sorgu</td><td><?=htmlspecialchars($discover['code'])?></td></tr>
          <tr><td>Sayfa başlığı (&lt;title&gt;)</td><td><?=htmlspecialchars($discover['title'])?: '<i>—</i>'?></td></tr>
          <tr><td>Login sayfası mı döndü?</td><td><?=$discover['login']?'<b style="color:#b91c1c">EVET — giriş yapılamadı / oturum gerekiyor olabilir</b>':'hayır'?></td></tr>
          <tr><td>cURL hatası</td><td><?=htmlspecialchars($discover['err']) ?: '<i>yok</i>'?></td></tr>
        </tbody></table>

        <?php if (!empty($discover['oci'])): ?>
          <h4>NEW_ITEM-* alanları bulundu (beklenmedik ama harika):</h4>
          <?php foreach ($discover['oci'] as $i => $f): ?>
            <table class="kv"><tbody>
              <?php ksort($f); foreach ($f as $k=>$v): ?><tr><td>NEW_ITEM-<?=htmlspecialchars($k)?></td><td><?=htmlspecialchars($v)?></td></tr><?php endforeach; ?>
            </tbody></table><br>
          <?php endforeach; ?>
        <?php endif; ?>

        <h4>Kazınan fiyat adayları (<?=count($discover['prices'])?>):</h4>
        <?php if ($discover['prices']): ?>
          <table><thead><tr><th>#</th><th>Değer</th><th>Kaynak ipucu</th></tr></thead><tbody>
            <?php foreach ($discover['prices'] as $i=>$pr): ?>
              <tr><td><?=$i+1?></td><td><b><?=htmlspecialchars($pr['deger'])?></b></td><td><code><?=htmlspecialchars($pr['kaynak'])?></code></td></tr>
            <?php endforeach; ?>
          </tbody></table>
          <div class="msg" style="background:#ecfeff;border-color:#a5f3fc;color:#155e75;margin-top:8px;">
            Bu adaylardan hangisi gerçek fiyatsa söyleyin; tek-tek modda o kalıba göre çekelim.
          </div>
        <?php else: ?>
          <div class="msg" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;">
            Fiyat görünümlü değer bulunamadı. Muhtemelen: login sayfası döndü, fiyat JavaScript ile
            sonradan yükleniyor, ya da hesabınızda net fiyat görünmüyor. Ham yanıta ve aşağıdaki metne bakın.
          </div>
        <?php endif; ?>

        <h4>Yanıttaki form alan adları (<?=count($discover['names'])?>):</h4>
        <?php if ($discover['names']): ?>
          <p style="font-size:12px;"><?php foreach ($discover['names'] as $n): ?><code style="margin:2px;display:inline-block;"><?=htmlspecialchars($n)?></code> <?php endforeach; ?></p>
        <?php else: ?><p><i>—</i></p><?php endif; ?>

        <h4>Ham metin (ilk 4000 karakter):</h4>
        <pre><?=htmlspecialchars(mb_substr($discover['text'],0,4000))?></pre>

      <?php elseif ($rows): ?>
        <?php $ok=0; foreach($rows as $r) if(($r['_DURUM']??'')==='OK') $ok++; ?>
        <p><b><?=count($rows)?></b> satır · <span class="ok"><?=$ok?> fiyat bulundu</span>
           <?php if($ok<count($rows)) echo '· <span class="bad">'.(count($rows)-$ok).' bulunamadı</span>'; ?></p>
        <?php if ($csvReady): ?>
          <p><a class="dl" href="<?=$CSV_URL?>?t=<?=time()?>" download>⬇ CSV indir (Excel)</a></p>
        <?php endif; ?>
        <div style="overflow:auto;max-height:520px;">
        <table>
          <thead><tr><th>Kod</th><th>Başlık</th><th>Fiyat (tahmin)</th><th>Kaynak</th><th>Login?</th><th>Durum</th></tr></thead>
          <tbody>
          <?php foreach ($rows as $r): ?>
            <tr>
              <td><?=pick($r,'PRODUCTID_SORGU')?></td>
              <td><?=pick($r,'BASLIK')?></td>
              <td><?=pick($r,'FIYAT_TAHMIN') ?: pick($r,'NEW_ITEM_PRICE')?></td>
              <td><?=pick($r,'FIYAT_KAYNAK')?></td>
              <td><?=pick($r,'LOGIN_SAYFASI')?></td>
              <td class="<?=(($r['_DURUM']??'')==='OK')?'ok':'bad'?>"><?=pick($r,'_DURUM')?></td>
            </tr>
          <?php endforeach; ?>
          </tbody>
        </table>
        </div>
      <?php endif; ?>
    </div>
  <?php endif; ?>

  <div class="card" style="font-size:13px;color:#475569;">
    <b>Notlar</b>
    <ul style="margin:8px 0;">
      <li>Bu araç dokümandaki <b>OCI 3.0</b> parametrelerini kullanır: <code>~OkCode=ADDI</code>, <code>~TARGET=_top</code>, <code>~CALLER=CTLG</code>, <code>USERNAME</code>, <code>PASSWORD</code>, <code>FUNCTION=PRODUCTDETAILS</code>, <code>PRODUCTID</code>, <code>HOOK_URL</code>.</li>
      <li>Phoenix OCI 3.0 esasen <b>interaktif punch-out</b>'tur: insan tarayıcıda sepet doldurur, "Back to SRM" ile SAP'ye döner. Otomatik toplu fiyat <b>garanti değildir</b>.</li>
      <li><b>LOGIN_DONDU</b> görürseniz: oturum/çerez gerekiyor olabilir, ya da kullanıcı/şifre/SERVICE değeri eksik. KEŞİF'teki ham yanıta bakıp birlikte ayarlarız.</li>
      <li>Fiyat JavaScript ile yükleniyorsa cURL göremez; o durumda farklı bir yaklaşım (headless tarayıcı) gerekir — keşif çıktısına göre karar veririz.</li>
    </ul>
  </div>

</div>
</body>
</html>
