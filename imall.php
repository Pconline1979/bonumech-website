<?php
/* =====================================================================
   imall.php  —  Siemens Industry Mall (IMALL) OCI 5.0
   Toplu Fiyat / İskonto Çekici  (XAMPP / PHP için tek dosya)
   ---------------------------------------------------------------------
   KULLANIM (XAMPP):
     1) Bu dosyayı  C:\xampp\htdocs\  klasörüne kopyalayın.
     2) XAMPP Control Panel'de Apache'yi "Start" ile başlatın.
     3) Tarayıcıda şu adresi açın:  http://localhost/imall.php
     4) Formu doldurun, ürün kodlarını alt alta yapıştırın, butona basın.

   NE YAPAR?
     IMALL'a OCI (Open Catalog Interface) ile bağlanır. "VALIDATE" çağrısında
     IMALL, ürün bilgisini gizli form alanları (NEW_ITEM-PRICE gibi) olarak
     döndürür; biz bu yanıtı doğrudan okuyup fiyat/iskontoyu çıkarırız.
     Gerçek bir SAP/SRM sunucusuna İHTİYAÇ YOKTUR.

   ÖNCE NE YAPMALI?
     İlk olarak "1) KEŞİF" modunu TEK bir kodla çalıştırın. IMALL'ın o ürün
     için döndürdüğü TÜM alanları görürsünüz; fiyatın ve iskontonun hangi
     alanda olduğunu gözünüzle saptarsınız.
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
$run      = isset($_POST['run']);
$cfg = [
    'BASE_URL'   => trim($_POST['base_url'] ?? 'https://mall.industry.siemens.com/mall/OCI/OCI/OCILogin'),
    'SITEID'     => trim($_POST['siteid']   ?? 'TR'),
    'LANGUAGE'   => trim($_POST['language'] ?? 'en'),   // "LanguageSelector" hatası için ŞART (tr/en/de)
    'USERNAME'   => trim($_POST['username'] ?? ''),
    'PASSWORD'   =>      $_POST['password']  ?? '',
    'HOOK_URL'   => trim($_POST['hook_url'] ?? 'https://www.automation.siemens.com/cgi-extern/showparams.pl'),
    'METHOD'     => (($_POST['http_method'] ?? 'GET') === 'POST') ? 'POST' : 'GET',  // ASP.NET goos genelde GET ile çalışır
    'TIMEOUT'    => 40,
    // SSL hatası alırsanız "SSL doğrulamayı kapat" kutusunu işaretleyin (yalnız yerel test için):
    'VERIFY_SSL' => !isset($_POST['no_ssl']),
    'COOKIE'     => sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'imall_cookies.txt',
];
$mode       = $_POST['mode']       ?? 'discover';
$qty        = trim($_POST['qty']   ?? '1');
$batchSize  = max(1, (int)($_POST['batch_size'] ?? 100));
$concurrency= min(20, max(1, (int)($_POST['concurrency'] ?? 8)));
$codesRaw   = $_POST['codes'] ?? '';

/* CSV dosyası bu betiğin yanına yazılır */
$CSV_PATH = __DIR__ . DIRECTORY_SEPARATOR . 'son_sonuc.csv';
$CSV_URL  = 'son_sonuc.csv';
$RAW_PATH = __DIR__ . DIRECTORY_SEPARATOR . 'kesif_ham_yanit.html';
$RAW_URL  = 'kesif_ham_yanit.html';

/* ===================================================================== */
/*  ÇEKİRDEK FONKSİYONLAR                                                 */
/* ===================================================================== */

function base_params($cfg) {
    return [
        'SITEID'        => $cfg['SITEID'],
        'LANGUAGE'      => $cfg['LANGUAGE'],   // IMALL dil bağlamı — eksikse "LanguageSelector" hatası
        'USERNAME'      => $cfg['USERNAME'],
        'PASSWORD'      => $cfg['PASSWORD'],
        'HOOK_URL'      => $cfg['HOOK_URL'],
        '~caller'       => 'CTLG',
        '~OkCode'       => 'ADDI',
        '~ForceTarget'  => 'yes',
        '~target'       => '_blank',
        'OCI_VERSION'   => '5.0',
        'BYPASS_INB_HANDLER' => 'X',   // daha sade HTML döndürür; sorun olursa boşaltın
    ];
}

/* Tek bir cURL handle hazırla (POST veya GET) */
function make_handle($cfg, $params, $useCookieJar = true) {
    $method = strtoupper($cfg['METHOD'] ?? 'POST');
    $url = $cfg['BASE_URL'];
    if ($method === 'GET') {
        $url .= (strpos($url, '?') === false ? '?' : '&') . http_build_query($params);
    }
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_TIMEOUT        => $cfg['TIMEOUT'],
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => $cfg['VERIFY_SSL'],
        CURLOPT_SSL_VERIFYHOST => $cfg['VERIFY_SSL'] ? 2 : 0,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (compatible; OCI-PriceFetcher/1.0)',
        CURLOPT_COOKIEFILE     => $cfg['COOKIE'],
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

/* Tek (senkron) çağrı */
function oci_post($cfg, $params) {
    $ch = make_handle($cfg, $params, true);
    $body  = curl_exec($ch);
    $err   = curl_error($ch);
    $http  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    return ['body' => $body ?: '', 'err' => $err, 'http' => $http, 'ctype' => (string)$ctype];
}

/* Dönen HTML'deki tüm NEW_ITEM-* alanlarını oku.
   Döner: [1 => ['PRICE'=>..,'CURRENCY'=>..], 2 => [...], ...] */
function parse_oci_html($html) {
    $items = [];
    if (trim($html) === '') return $items;
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="utf-8" ?>' . $html);
    libxml_clear_errors();

    foreach (['input', 'textarea', 'select'] as $tagName) {
        foreach ($dom->getElementsByTagName($tagName) as $el) {
            $name = trim($el->getAttribute('name'));
            if ($name === '') continue;
            $val = $el->getAttribute('value');
            if ($val === '' && $tagName === 'textarea') $val = trim($el->textContent);

            if (preg_match('/^NEW[_-]ITEM[_-]([A-Za-z0-9_]+?)\[(\d+)\]$/', $name, $m)) {
                $idx = (int)$m[2];
                $items[$idx][strtoupper($m[1])] = $val;
            } elseif (preg_match('/^NEW[_-]ITEM[_-]([A-Za-z0-9_]+?)$/', $name, $m)) {
                $items[1][strtoupper($m[1])] = $val;
            }
        }
    }
    return $items;
}

/* Yanıttaki TÜM form alan adlarını listele (teşhis için) */
function all_field_names($html) {
    $names = [];
    if (trim($html) === '') return $names;
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="utf-8" ?>' . $html);
    libxml_clear_errors();
    foreach (['input', 'textarea', 'select'] as $t) {
        foreach ($dom->getElementsByTagName($t) as $el) {
            $n = trim($el->getAttribute('name'));
            if ($n !== '') $names[$n] = true;
        }
    }
    ksort($names);
    return array_keys($names);
}

/* TEK ÜRÜN doğrula */
function validate_single($cfg, $code, $qty) {
    $p = base_params($cfg);
    $p['FUNCTION']  = 'VALIDATE';
    $p['PRODUCTID'] = $code;
    $p['QUANTITY']  = (string)$qty;
    $res = oci_post($cfg, $p);
    $items = parse_oci_html($res['body']);
    if (!$items) {
        return ['PRODUCTID_SORGU' => $code, '_DURUM' => $res['err'] ? ('HATA: '.$res['err']) : 'ALAN_YOK'];
    }
    $idx = min(array_keys($items));
    $row = $items[$idx];
    $row['PRODUCTID_SORGU'] = $code;
    $row['_DURUM'] = 'OK';
    return $row;
}

/* PARALEL tek-tek doğrulama (curl_multi). Büyük listeler için hızlı. */
function multi_validate($cfg, $codes, $qty, $concurrency) {
    $rows = [];
    $queue = array_values($codes);
    $mh = curl_multi_init();
    $handles = [];   // (int)$ch => ['ch'=>..,'code'=>..]
    $i = 0;

    $addOne = function() use (&$queue, &$handles, $mh, $cfg, $qty) {
        if (!$queue) return;
        $code = array_shift($queue);
        $p = base_params($cfg);
        $p['FUNCTION']  = 'VALIDATE';
        $p['PRODUCTID'] = $code;
        $p['QUANTITY']  = (string)$qty;
        $ch = make_handle($cfg, $p, false); // paralelde ortak jar yazımından kaçın
        curl_multi_add_handle($mh, $ch);
        $handles[(int)$ch] = ['ch' => $ch, 'code' => $code];
    };

    for ($k = 0; $k < $concurrency; $k++) $addOne();

    do {
        $status = curl_multi_exec($mh, $active);
        if ($active) curl_multi_select($mh, 1.0);

        while ($info = curl_multi_info_read($mh)) {
            $ch = $info['handle'];
            $id = (int)$ch;
            $code = $handles[$id]['code'] ?? '?';
            $body = curl_multi_getcontent($ch);
            $err  = curl_error($ch);

            $items = parse_oci_html($body);
            if ($items) {
                $idx = min(array_keys($items));
                $row = $items[$idx];
                $row['PRODUCTID_SORGU'] = $code;
                $row['_DURUM'] = 'OK';
            } else {
                $row = ['PRODUCTID_SORGU' => $code, '_DURUM' => $err ? ('HATA: '.$err) : 'ALAN_YOK'];
            }
            $rows[] = $row;

            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
            unset($handles[$id]);
            $addOne(); // boşalan slota yenisini koy
        }
    } while ($active || $handles || $queue);

    curl_multi_close($mh);
    return $rows;
}

/* TOPLU (deneysel): tek çağrıda PRODUCTID[1..n]. Destekleniyorsa çok hızlı. */
function validate_batch_chunk($cfg, $codes, $qty) {
    $p = base_params($cfg);
    $p['FUNCTION'] = 'VALIDATE';
    $i = 1;
    foreach ($codes as $c) {
        $p["PRODUCTID[$i]"] = $c;
        $p["QUANTITY[$i]"]  = (string)$qty;
        $i++;
    }
    // Bazı sistemler tekil alanı da bekler:
    $p['PRODUCTID'] = $codes[0];
    $p['QUANTITY']  = (string)$qty;

    $res   = oci_post($cfg, $p);
    $items = parse_oci_html($res['body']);

    $out = [];
    $idx = 1;
    foreach ($codes as $c) {
        $row = $items[$idx] ?? [];
        $row['PRODUCTID_SORGU'] = $c;
        $row['_DURUM'] = $row && count($row) > 2 ? 'OK' : 'ALAN_YOK';
        $out[] = $row;
        $idx++;
    }
    return [$out, count($items), $res['err']];
}

/* DOWNLOADJSON: tüm görünür kataloğu sayfa sayfa çek */
function download_json($cfg, $pagesize, &$messages) {
    $rows = [];
    $tx = '';
    $page = '';      // ilk çağrı boş
    $total = null;
    $guard = 0;

    while (true) {
        $guard++;
        if ($guard > 1000) { $messages[] = 'Güvenlik durdurması (1000 sayfa).'; break; }
        $p = base_params($cfg);
        $p['FUNCTION']      = 'DOWNLOADJSON';
        $p['PAGESIZE']      = (string)$pagesize;
        $p['REQUESTEDPAGE'] = (string)$page;
        $p['LASTUPDATED']   = '';
        if ($tx !== '') $p['TRANSACTIONID'] = (string)$tx;

        $res  = oci_post($cfg, $p);
        $data = json_decode($res['body'], true);
        if (!is_array($data)) {
            $messages[] = 'Sayfa ' . $guard . ': JSON ayrıştırılamadı (hesabınız DOWNLOADJSON için açık olmayabilir). '
                        . 'HTTP ' . $res['http'] . '. İlk 300 karakter: ' . htmlspecialchars(substr($res['body'], 0, 300));
            break;
        }
        $cur    = $data['CURRENTPAGE'] ?? null;
        $total  = $data['TOTALPAGES']  ?? $total;
        $tx     = $data['TRANSACTIONID'] ?? $tx;
        $items  = $data['Items'] ?? ($data['ITEMS'] ?? []);

        foreach ($items as $entry) {
            $ni = $entry['NEWITEM'] ?? ($entry['NEW_ITEM'] ?? $entry);
            $rows[] = flatten_json_item($ni);
        }
        $messages[] = "Sayfa $cur / $total — bu sayfada " . count($items) . " ürün.";

        if (!$total || ($cur !== null && (int)$cur >= (int)$total)) break;
        $page = $cur ? ((int)$cur + 1) : 2;
        usleep(300000);
    }
    return $rows;
}

function flatten_json_item($ni) {
    $row = [];
    foreach (['EXT_PRODUCT_ID','VENDOR_MAT','MANUFACTMAT','MATNR','PRICE','CURRENCY',
              'PRICE_QUANTITY','TAX','PRICE_VALID_FROM','PRICE_VALID_TO','UNIT','LEADTIME',
              'MINORDER_QTY','PACKAGING_QTY','CATALOG_MANAGED','CHANGED_AT'] as $k) {
        if (isset($ni[$k]) && !is_array($ni[$k])) $row[$k] = $ni[$k];
    }
    if (isset($ni['DESCRIPTION'][0]['description'])) $row['DESCRIPTION'] = $ni['DESCRIPTION'][0]['description'];
    if (!empty($ni['PRICE_SCALES']) && is_array($ni['PRICE_SCALES'])) {
        $parts = [];
        foreach ($ni['PRICE_SCALES'] as $s) {
            $parts[] = ($s['low'] ?? '') . '-' . ($s['high'] ?? '') . ':' . ($s['price'] ?? '');
        }
        $row['PRICE_SCALES'] = implode('; ', $parts);
    }
    if (!empty($ni['CUSTOMER_FIELDS']) && is_array($ni['CUSTOMER_FIELDS'])) {
        foreach ($ni['CUSTOMER_FIELDS'] as $c) {
            if (!empty($c['fieldName'])) $row['CUST_' . $c['fieldName']] = $c['fieldValue'] ?? '';
        }
    }
    return $row;
}

/* Ürün kodlarını metin kutusundan ayrıştır (her satır bir kod) */
function parse_codes($raw) {
    $out = [];
    $lines = preg_split('/[\r\n]+/', (string)$raw);
    foreach ($lines as $ln) {
        $ln = trim($ln);
        // virgül/noktalı virgül/tab ile yapıştırılırsa ilk parçayı al
        if ($ln !== '' && preg_match('/[;,\t]/', $ln)) {
            $parts = preg_split('/[;,\t]/', $ln);
            $ln = trim($parts[0]);
        }
        $ln = trim($ln, " \"'");
        if ($ln !== '') $out[] = $ln;
    }
    return $out;
}

/* CSV yaz (tüm alanların birleşimi sütun olur; hiçbir alan kaybolmaz) */
function write_csv($rows, $path) {
    if (!$rows) return false;
    $cols = [];
    foreach ($rows as $r) foreach ($r as $k => $v) $cols[$k] = true;
    $preferred = ['PRODUCTID_SORGU','EXT_PRODUCT_ID','DESCRIPTION','MATNR','VENDORMAT','VENDOR_MAT',
                  'MANUFACTMAT','PRICE','CURRENCY','PRICEUNIT','PRICE_QUANTITY','QUANTITY','UNIT',
                  'TAX','PRICE_SCALES','PRICE_VALID_FROM','PRICE_VALID_TO','LEADTIME','_DURUM'];
    $ordered = [];
    foreach ($preferred as $c) if (isset($cols[$c])) { $ordered[] = $c; unset($cols[$c]); }
    foreach (array_keys($cols) as $c) $ordered[] = $c;

    $fh = @fopen($path, 'w');
    if (!$fh) return false;
    fwrite($fh, "\xEF\xBB\xBF"); // Excel'in Türkçe karakterleri doğru açması için BOM
    fputcsv($fh, $ordered, ';');
    foreach ($rows as $r) {
        $line = [];
        foreach ($ordered as $c) $line[] = $r[$c] ?? '';
        fputcsv($fh, $line, ';');
    }
    fclose($fh);
    return true;
}

/* ===================================================================== */
/*  ÇALIŞTIRMA                                                            */
/* ===================================================================== */
$messages   = [];
$rows       = [];
$discover   = null;          // keşif modunda doldurulur
$csvReady   = false;
$elapsed    = 0;

if ($run) {
    if ($cfg['USERNAME'] === '' || $cfg['PASSWORD'] === '') {
        $messages[] = 'Kullanıcı adı / şifre boş. Lütfen OCI hesabınızı girin.';
    } else {
        $codes = parse_codes($codesRaw);
        $t0 = microtime(true);

        if ($mode === 'discover') {
            if (!$codes) { $messages[] = 'Keşif için en az bir ürün kodu girin.'; }
            else {
                $code = $codes[0];
                $p = base_params($cfg);
                $p['FUNCTION']='VALIDATE'; $p['PRODUCTID']=$code; $p['QUANTITY']=$qty;
                $res = oci_post($cfg, $p);
                @file_put_contents($RAW_PATH, $res['body']);
                $items = parse_oci_html($res['body']);
                $discover = [
                    'code'   => $code,
                    'http'   => $res['http'],
                    'ctype'  => $res['ctype'],
                    'err'    => $res['err'],
                    'len'    => strlen($res['body']),
                    'items'  => $items,
                    'names'  => $items ? [] : all_field_names($res['body']),
                    'isJson' => (stripos($res['ctype'],'json')!==false || (isset($res['body'][0]) && ltrim($res['body'])[0]==='{')),
                    'jsonPreview' => '',
                ];
                if ($discover['isJson']) {
                    $j = json_decode($res['body'], true);
                    $discover['jsonPreview'] = $j ? substr(json_encode($j, JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE), 0, 4000) : substr($res['body'],0,4000);
                }
            }
        }
        elseif ($mode === 'single') {
            if (!$codes) { $messages[] = 'Ürün kodu girin.'; }
            else {
                $rows = multi_validate($cfg, $codes, $qty, $concurrency);
            }
        }
        elseif ($mode === 'batch') {
            if (!$codes) { $messages[] = 'Ürün kodu girin.'; }
            else {
                $chunks = array_chunk($codes, $batchSize);
                $first = true;
                foreach ($chunks as $n => $chunk) {
                    list($part, $got, $err) = validate_batch_chunk($cfg, $chunk, $qty);
                    $rows = array_merge($rows, $part);
                    $messages[] = 'Grup ' . ($n+1) . '/' . count($chunks) . ': gönderilen ' . count($chunk) . ', dönen satır ' . $got . ($err ? (' — '.$err) : '');
                    if ($first && $got <= 1 && count($chunk) > 1) {
                        $messages[] = 'UYARI: İlk grupta yalnızca ~1 satır döndü → IMALL muhtemelen toplu VALIDATE\'i DESTEKLEMİYOR. "2) Tek tek (güvenli)" modunu kullanın.';
                    }
                    $first = false;
                    usleep(300000);
                }
            }
        }
        elseif ($mode === 'json') {
            $pagesize = max(1, (int)($_POST['pagesize'] ?? $batchSize));
            $rows = download_json($cfg, $pagesize, $messages);
        }

        $elapsed = round(microtime(true) - $t0, 1);

        if ($rows) {
            $csvReady = write_csv($rows, $CSV_PATH);
            if (!$csvReady) $messages[] = 'CSV yazılamadı (klasör yazma izni?). Tablo aşağıda görünüyor.';
        }
    }
}

/* Tabloda gösterilecek öne çıkan sütunlar */
function pick($r, $k) { return isset($r[$k]) ? htmlspecialchars($r[$k]) : ''; }
?>
<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IMALL OCI — Fiyat / İskonto Çekici</title>
<style>
  :root { --bg:#0f172a; --card:#fff; --line:#e2e8f0; --accent:#0ea5e9; --muted:#64748b; }
  * { box-sizing:border-box; }
  body { font-family:Segoe UI,Roboto,Arial,sans-serif; margin:0; background:#f1f5f9; color:#0f172a; }
  header { background:#009999; color:#fff; padding:16px 22px; }
  header h1 { margin:0; font-size:20px; }
  header p { margin:4px 0 0; opacity:.9; font-size:13px; }
  .wrap { max-width:1100px; margin:18px auto; padding:0 14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px; margin-bottom:16px; }
  label { display:block; font-size:13px; font-weight:600; margin:10px 0 4px; }
  input[type=text], input[type=password], textarea, select {
    width:100%; padding:9px 10px; border:1px solid #cbd5e1; border-radius:7px; font-size:14px; font-family:inherit;
  }
  textarea { min-height:160px; font-family:Consolas,monospace; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
  .help { color:var(--muted); font-size:12px; margin-top:4px; }
  .modes label { display:flex; align-items:flex-start; gap:8px; font-weight:500; padding:8px; border:1px solid var(--line); border-radius:8px; margin-bottom:8px; cursor:pointer; }
  .modes input { margin-top:3px; }
  .modes b { color:#0f766e; }
  button { background:#009999; color:#fff; border:0; padding:12px 26px; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer; }
  button:hover { background:#007a7a; }
  .msg { background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; padding:10px 12px; border-radius:8px; font-size:13px; margin-bottom:8px; white-space:pre-wrap; }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  th,td { border:1px solid var(--line); padding:6px 8px; text-align:left; }
  th { background:#f8fafc; }
  .ok { color:#15803d; font-weight:600; }
  .bad { color:#b91c1c; font-weight:600; }
  .dl { display:inline-block; background:#0ea5e9; color:#fff; padding:9px 16px; border-radius:8px; text-decoration:none; font-weight:600; }
  code { background:#f1f5f9; padding:2px 5px; border-radius:4px; }
  .kv td:first-child { font-weight:600; width:240px; background:#f8fafc; }
</style>
</head>
<body>
<header>
  <h1>Siemens IMALL — OCI 5.0 Fiyat / İskonto Çekici</h1>
  <p>Ürün kodlarınızı girin → güncel fiyat ve iskonto bilgisini çekin. (Yerel XAMPP aracı)</p>
</header>

<div class="wrap">

  <form method="post" class="card">
    <div class="grid">
      <div>
        <label>IMALL OCI Adresi (BASE_URL)</label>
        <input type="text" name="base_url" value="<?=htmlspecialchars($cfg['BASE_URL'])?>">
        <div class="help"><b>VALIDATE = OCI 5</b> → bu adresi kullanın: <code>.../mall/OCI/OCI/OCILogin</code>. (Sadece Checkout için OCI 4: <code>.../goos/oci/pages/ocilogin.aspx</code>)</div>
      </div>
      <div>
        <label>HOOK_URL (gerçek SRM gerekmez)</label>
        <input type="text" name="hook_url" value="<?=htmlspecialchars($cfg['HOOK_URL'])?>">
        <div class="help">Siemens'in gerçek test sayfası. <b>Buraya ürün kodu YAZMAYIN.</b></div>
      </div>
    </div>

    <div class="grid3">
      <div>
        <label>SITEID (ülke)</label>
        <input type="text" name="siteid" value="<?=htmlspecialchars($cfg['SITEID'])?>">
        <div class="help">Örn. TR veya DE</div>
      </div>
      <div>
        <label>LANGUAGE (dil) ⚠</label>
        <input type="text" name="language" value="<?=htmlspecialchars($cfg['LANGUAGE'])?>">
        <div class="help">"LanguageSelector" hatası için ŞART. Önce <code>en</code>, olmazsa <code>tr</code> veya <code>de</code> deneyin.</div>
      </div>
      <div>
        <label>Kullanıcı adı (USERNAME)</label>
        <input type="text" name="username" value="<?=htmlspecialchars($cfg['USERNAME'])?>">
        <div class="help">OCI hesabı, örn. IM02014823-OCI</div>
      </div>
    </div>
    <div class="grid">
      <div>
        <label>Şifre (PASSWORD / OCI API Secret)</label>
        <input type="password" name="password" value="<?=htmlspecialchars($cfg['PASSWORD'])?>">
        <div class="help">Üretilen OCI API Secret değeri.</div>
      </div>
      <div>
        <label>Çağrı yöntemi (Aufruftyp) ⚠</label>
        <select name="http_method">
          <option value="GET"  <?=$cfg['METHOD']==='GET'?'selected':''?>>GET (önce bunu deneyin)</option>
          <option value="POST" <?=$cfg['METHOD']==='POST'?'selected':''?>>POST</option>
        </select>
        <div class="help">goos/ocilogin.aspx parametreleri genelde URL'den (GET) okur. Login başarısızsa diğerini deneyin.</div>
      </div>
    </div>

    <label>Ürün kodları (her satıra bir kod — Excel'den kopyalayıp yapıştırabilirsiniz)</label>
    <textarea name="codes" placeholder="6ES7214-1AG40-0XB0&#10;6EP1333-4BA00&#10;3RV2011-1AA10"><?=htmlspecialchars($codesRaw)?></textarea>

    <label>Ne yapılsın?</label>
    <div class="modes">
      <label><input type="radio" name="mode" value="discover" <?=$mode==='discover'?'checked':''?>>
        <span><b>1) KEŞİF (önce bunu çalıştırın)</b> — Listedeki <u>ilk</u> kodu sorgular ve IMALL'ın döndürdüğü TÜM alanları gösterir. Fiyat ve iskontonun hangi alanda olduğunu burada görürsünüz.</span></label>
      <label><input type="radio" name="mode" value="single" <?=$mode==='single'?'checked':''?>>
        <span><b>2) Tek tek çek (güvenli)</b> — Her kodu ayrı ayrı, paralel olarak sorgular. Her zaman çalışır; 5000 ürün için uygundur.</span></label>
      <label><input type="radio" name="mode" value="batch" <?=$mode==='batch'?'checked':''?>>
        <span><b>3) Toplu dene (hızlı, deneysel)</b> — Tek çağrıda 100 kod gönderir. IMALL destekliyorsa ~50 çağrıda biter. Desteklemezse araç sizi uyarır.</span></label>
      <label><input type="radio" name="mode" value="json" <?=$mode==='json'?'checked':''?>>
        <span><b>4) Tüm kataloğu indir (DOWNLOADJSON)</b> — Görünür kataloğu sayfa sayfa JSON çeker. Hesabınız bu özelliğe açık olmalı.</span></label>
    </div>

    <div class="grid3">
      <div>
        <label>Miktar (QUANTITY)</label>
        <input type="text" name="qty" value="<?=htmlspecialchars($qty)?>">
        <div class="help">Skala fiyatı için adet. Genelde 1.</div>
      </div>
      <div>
        <label>Grup boyutu / Sayfa boyutu</label>
        <input type="text" name="batch_size" value="<?=htmlspecialchars($batchSize)?>">
        <div class="help">Toplu/JSON modunda kaçarlı (varsayılan 100).</div>
      </div>
      <div>
        <label>Paralel istek (tek tek modunda)</label>
        <input type="text" name="concurrency" value="<?=htmlspecialchars($concurrency)?>">
        <div class="help">Aynı anda kaç sorgu (varsayılan 8). Çok yükseltmeyin.</div>
      </div>
    </div>

    <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin-top:14px;">
      <input type="checkbox" name="no_ssl" <?=isset($_POST['no_ssl'])?'checked':''?>>
      SSL hatası alıyorsam doğrulamayı kapat (yalnız yerel test için)
    </label>

    <div style="margin-top:18px;">
      <button type="submit" name="run" value="1">Çek</button>
    </div>
  </form>

  <?php if ($run): ?>
    <div class="card">
      <h3 style="margin-top:0;">Sonuç <?php if($elapsed) echo '<span style="font-weight:400;color:#64748b;font-size:13px;">('.$elapsed.' sn)</span>'; ?></h3>

      <?php foreach ($messages as $m): ?>
        <div class="msg"><?=$m?></div>
      <?php endforeach; ?>

      <?php if ($discover !== null): ?>
        <p>HTTP <b><?=$discover['http']?></b> · Content-Type: <code><?=htmlspecialchars($discover['ctype'])?></code> · <?=$discover['len']?> bayt
           · Ham yanıt: <a href="<?=$RAW_URL?>" target="_blank">kesif_ham_yanit.html</a></p>

        <?php if ($discover['isJson']): ?>
          <p><b>Yanıt JSON görünüyor:</b></p>
          <pre style="background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;overflow:auto;font-size:12px;"><?=htmlspecialchars($discover['jsonPreview'])?></pre>
        <?php elseif (!empty($discover['items'])): ?>
          <p><b><?=count($discover['items'])?></b> ürün satırı bulundu. <code><?=htmlspecialchars($discover['code'])?></code> için dönen alanlar:</p>
          <?php foreach ($discover['items'] as $idx => $f): ?>
            <h4>Satır [<?=$idx?>]</h4>
            <table class="kv"><tbody>
              <?php ksort($f); foreach ($f as $k => $v): ?>
                <tr><td>NEW_ITEM-<?=htmlspecialchars($k)?></td><td><?=htmlspecialchars($v)?></td></tr>
              <?php endforeach; ?>
            </tbody></table><br>
          <?php endforeach; ?>
          <div class="msg" style="background:#ecfeff;border-color:#a5f3fc;color:#155e75;">
            FİYAT için <code>PRICE</code> / <code>CURRENCY</code> / <code>PRICEUNIT</code> alanlarına;
            İSKONTO veya LİSTE FİYATI için <code>CUST_FIELD1..5</code> ya da benzeri özel alanlara bakın.
            Hangi alanda olduğunu görünce, "Tek tek" veya "Toplu" modda o alan da CSV'ye otomatik gelir.
          </div>
        <?php else: ?>
          <div class="msg" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;">
            NEW_ITEM-* alanı bulunamadı. Olası nedenler: hatalı giriş, Secure OCI açık,
            login/onay sayfası döndü veya PRODUCTID kabul edilmedi.
            <?=$discover['err'] ? ('<br>cURL hatası: '.htmlspecialchars($discover['err'])) : ''?>
          </div>
          <?php if (!empty($discover['names'])): ?>
            <p>Yanıttaki form alan adları (teşhis):</p>
            <ul><?php foreach ($discover['names'] as $n): ?><li><code><?=htmlspecialchars($n)?></code></li><?php endforeach; ?></ul>
          <?php endif; ?>
        <?php endif; ?>

      <?php elseif ($rows): ?>
        <?php
          $ok = 0; foreach ($rows as $r) if (($r['_DURUM'] ?? '')==='OK') $ok++;
        ?>
        <p><b><?=count($rows)?></b> satır · <span class="ok"><?=$ok?> başarılı</span>
           <?php if ($ok < count($rows)) echo '· <span class="bad">'.(count($rows)-$ok).' başarısız</span>'; ?></p>

        <?php if ($csvReady): ?>
          <p><a class="dl" href="<?=$CSV_URL?>?t=<?=time()?>" download>⬇ Tüm verileri CSV indir (Excel)</a>
             <span class="help">Tüm alanlar CSV'de. Aşağıdaki tablo sadece özet.</span></p>
        <?php endif; ?>

        <div style="overflow:auto;max-height:520px;">
        <table>
          <thead><tr>
            <th>Sorgu Kodu</th><th>Açıklama</th><th>Fiyat</th><th>Para</th>
            <th>Fiyat Birimi</th><th>Birim</th><th>Durum</th>
          </tr></thead>
          <tbody>
          <?php foreach ($rows as $r): ?>
            <tr>
              <td><?=pick($r,'PRODUCTID_SORGU')?></td>
              <td><?=pick($r,'DESCRIPTION')?></td>
              <td><?=pick($r,'PRICE')?></td>
              <td><?=pick($r,'CURRENCY')?></td>
              <td><?=pick($r,'PRICEUNIT') ?: pick($r,'PRICE_QUANTITY')?></td>
              <td><?=pick($r,'UNIT')?></td>
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
    <b>İpuçları</b>
    <ul style="margin:8px 0;">
      <li><b>Login çalışmıyorsa önce şunu deneyin:</b> Siemens'in hazır test kullanıcısıyla — USERNAME <code>ocitest.5</code>, PASSWORD <code>Mig0123!</code>, yöntem GET. Çalışırsa araç doğru, sorun sizin API Secret'ınızda. Çalışmazsa adres/yöntem yanlış. (Test hesabı muhtemelen sadece test sistemde geçerli.)</li>
      <li><b>VALIDATE için BASE_URL = OCI 5</b> (<code>.../mall/OCI/OCI/OCILogin</code>) olmalı. OCI 4 (<code>goos/.../ocilogin.aspx</code>) yalnız Checkout yapar.</li>
      <li>İlk denemede <b>1) KEŞİF</b> modunu tek bir gerçek kodla çalıştırın; ne döndüğünü görün.</li>
      <li>Sonra küçük bir liste (10–20 kod) ile <b>3) Toplu</b> modu deneyin. Tek satır dönerse <b>2) Tek tek</b> moduna geçin.</li>
      <li>5000 ürünü tek seferde çekerken sekmeyi kapatmayın; işlem birkaç dakika sürebilir.</li>
      <li>"ALAN_YOK" çok çıkıyorsa: BASE_URL (OCI 5 mi?), yöntem (GET mi?), HOOK_URL (kod yazılmamış mı?) ve giriş bilgilerini kontrol edin.</li>
    </ul>
  </div>

</div>
</body>
</html>
