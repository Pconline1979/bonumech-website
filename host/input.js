/**
 * Bonumech Remote Support - Girdi Enjeksiyonu (nut.js)
 * ---------------------------------------------------
 * Viewer'dan gelen normalize edilmiş fare/klavye olaylarını
 * gerçek işletim sistemi girdilerine çevirir.
 *
 * Olay biçimleri (viewer.js ile eşleşir):
 *   { t: 'm', x, y }            -> fare hareketi (x,y ∈ [0,1])
 *   { t: 'd', b, x, y }         -> fare tuşu bas (b: 0 sol, 1 orta, 2 sağ)
 *   { t: 'u', b, x, y }         -> fare tuşu bırak
 *   { t: 'w', dy }              -> tekerlek kaydırma
 *   { t: 'kd', code, key }      -> klavye tuşu bas
 *   { t: 'ku', code, key }      -> klavye tuşu bırak
 */

const { mouse, keyboard, Button, Key, Point, screen } = require('@nut-tree-fork/nut-js');

// Gecikmeleri sıfırla -> uzaktan kontrolde akıcılık.
mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 100000;
keyboard.config.autoDelayMs = 0;

// Ekran çözünürlüğünü önbelleğe al (periyodik yenilenir).
let screenW = 1920;
let screenH = 1080;

// Paylaşılan monitörün sanal masaüstündeki sınırları {x,y,width,height}.
// Çoklu monitörde ikincil ekranların offset'ini hesaba katmak için kullanılır.
let bounds = null;

function setBounds(b) {
  bounds = b && b.width && b.height ? b : null;
}

async function refreshScreenSize() {
  try {
    screenW = await screen.width();
    screenH = await screen.height();
  } catch {
    /* varsayılanları koru */
  }
}
refreshScreenSize();
setInterval(refreshScreenSize, 5000);

// Normalize [0,1] koordinatı gerçek (sanal masaüstü) piksele çevirir.
function toPixel(nx, ny) {
  const bx = bounds ? bounds.x : 0;
  const by = bounds ? bounds.y : 0;
  const bw = bounds ? bounds.width : screenW;
  const bh = bounds ? bounds.height : screenH;
  return { x: Math.round(bx + nx * bw), y: Math.round(by + ny * bh) };
}

const BUTTON = { 0: Button.LEFT, 1: Button.MIDDLE, 2: Button.RIGHT };

// --- Tuş kodu -> nut.js Key eşlemesi ---
const CODE = {
  Backspace: Key.Backspace, Tab: Key.Tab, Enter: Key.Enter, NumpadEnter: Key.Enter,
  Escape: Key.Escape, Space: Key.Space,
  ShiftLeft: Key.LeftShift, ShiftRight: Key.RightShift,
  ControlLeft: Key.LeftControl, ControlRight: Key.RightControl,
  AltLeft: Key.LeftAlt, AltRight: Key.RightAlt,
  MetaLeft: Key.LeftSuper, MetaRight: Key.RightSuper,
  CapsLock: Key.CapsLock, Insert: Key.Insert, Delete: Key.Delete,
  Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
  ArrowLeft: Key.Left, ArrowUp: Key.Up, ArrowRight: Key.Right, ArrowDown: Key.Down,
  Minus: Key.Minus, Equal: Key.Equal,
  BracketLeft: Key.LeftBracket, BracketRight: Key.RightBracket,
  Backslash: Key.Backslash, Semicolon: Key.Semicolon, Quote: Key.Quote,
  Backquote: Key.Grave, Comma: Key.Comma, Period: Key.Period, Slash: Key.Slash,
  PrintScreen: Key.Print, ScrollLock: Key.ScrollLock, Pause: Key.Pause,
  NumpadAdd: Key.Add, NumpadSubtract: Key.Subtract, NumpadMultiply: Key.Multiply,
  NumpadDivide: Key.Divide, NumpadDecimal: Key.Decimal,
};

// Harfler: KeyA..KeyZ
for (let c = 65; c <= 90; c++) {
  const ch = String.fromCharCode(c);
  CODE['Key' + ch] = Key[ch];
}
// Rakamlar: Digit0..9 ve Numpad0..9
for (let d = 0; d <= 9; d++) {
  CODE['Digit' + d] = Key['Num' + d];
  CODE['Numpad' + d] = Key['NumPad' + d] || Key['Num' + d];
}
// Fonksiyon tuşları: F1..F24
for (let f = 1; f <= 24; f++) {
  if (Key['F' + f] !== undefined) CODE['F' + f] = Key['F' + f];
}

function mapKey(ev) {
  if (ev.code && CODE[ev.code] !== undefined) return CODE[ev.code];
  // Yedek: tek karakterli harf/rakam key'inden çöz.
  if (ev.key && ev.key.length === 1) {
    const up = ev.key.toUpperCase();
    if (up >= 'A' && up <= 'Z') return Key[up];
    if (up >= '0' && up <= '9') return Key['Num' + up];
  }
  return null;
}

function scrollAmount(dy) {
  // Tarayıcı deltaY genelde ~100'lük adımlar; satır sayısına indir.
  return Math.max(1, Math.round(Math.abs(dy) / 100 * 3));
}

async function handle(ev) {
  try {
    switch (ev.t) {
      case 'm': {
        const p = toPixel(ev.x, ev.y);
        await mouse.setPosition(new Point(p.x, p.y));
        break;
      }
      case 'd': {
        const p = toPixel(ev.x, ev.y);
        await mouse.setPosition(new Point(p.x, p.y));
        await mouse.pressButton(BUTTON[ev.b] ?? Button.LEFT);
        break;
      }
      case 'u': {
        await mouse.releaseButton(BUTTON[ev.b] ?? Button.LEFT);
        break;
      }
      case 'w': {
        const amt = scrollAmount(ev.dy);
        if (ev.dy < 0) await mouse.scrollUp(amt);
        else await mouse.scrollDown(amt);
        break;
      }
      case 'kd': {
        const k = mapKey(ev);
        if (k != null) await keyboard.pressKey(k);
        break;
      }
      case 'ku': {
        const k = mapKey(ev);
        if (k != null) await keyboard.releaseKey(k);
        break;
      }
    }
  } catch {
    /* tekil olay hataları yoksayılır - oturum devam etsin */
  }
}

module.exports = { handle, setBounds };
