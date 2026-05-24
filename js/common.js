// Ortak nav HTML
const NAV_HTML = `
<nav class="nav">
  <div class="nav-logo">
    <a href="index.html"><img src="images/logo.png" alt="Bonumech Teknoloji"></a>
  </div>
  <div class="nav-links">
    <a href="index.html" id="nav-home">Anasayfa</a>
    <a href="urunler.html" id="nav-urunler">Ürünler</a>
    <a href="projeler.html" id="nav-projeler">Projeler</a>
    <a href="intralogistik.html" id="nav-intra">İntralogistik</a>
    <a href="hakkimizda.html" id="nav-hakkimizda">Hakkımızda</a>
    <a href="blog.html" id="nav-blog">Haberler</a>
    <a href="iletisim.html" id="nav-iletisim">İletişim</a>
  </div>
  <div class="nav-right">
    <div class="nav-lang">TR / EN</div>
    <a href="iletisim.html" class="nav-cta">Teklif Al</a>
  </div>
</nav>`;

// Ortak footer HTML
const FOOTER_HTML = `
<footer>
  <div class="footer-main">
    <div>
      <div class="footer-logo"><img src="images/logo.png" alt="Bonumech"></div>
      <div class="footer-desc">
        Bonumech Teknoloji A.Ş.<br>
        İntralogistik & Otomasyon Sistemleri<br><br>
        Yaylacık Mah., Ulubat Cad. No:4<br>
        41140 Başiskele / Kocaeli / Türkiye<br><br>
        +90 262 349 66 47<br>
        info@bonumech.com
      </div>
      <div class="footer-socials">
        <a href="https://www.linkedin.com/company/bonumech-teknoloji/" class="social-icon" target="_blank"><i class="ti ti-brand-linkedin"></i></a>
        <a href="https://www.instagram.com/bonumech/" class="social-icon" target="_blank"><i class="ti ti-brand-instagram"></i></a>
        <a href="https://www.youtube.com/@Bonumech" class="social-icon" target="_blank"><i class="ti ti-brand-youtube"></i></a>
      </div>
    </div>
    <div>
      <div class="footer-col-title">ÜRÜNLER</div>
      <a href="urunler.html" class="footer-link">ASRS Sistemleri</a>
      <a href="urunler.html" class="footer-link">Shuttle Sistemleri</a>
      <a href="urunler.html" class="footer-link">Rail Guided Vehicle</a>
      <a href="urunler.html" class="footer-link">Destacker / Stacker</a>
      <a href="urunler.html" class="footer-link">Vertical Conveyor</a>
    </div>
    <div>
      <div class="footer-col-title">KURUMSAL</div>
      <a href="hakkimizda.html" class="footer-link">Hakkımızda</a>
      <a href="intralogistik.html" class="footer-link">İntralogistik</a>
      <a href="projeler.html" class="footer-link">Projeler</a>
      <a href="blog.html" class="footer-link">Haberler & Blog</a>
      <a href="iletisim.html" class="footer-link">İletişim</a>
    </div>
    <div>
      <div class="footer-col-title">DİL</div>
      <a href="#" class="footer-link" style="color:var(--orange)">Türkçe</a>
      <a href="#" class="footer-link">English</a>
    </div>
  </div>
  <div class="footer-bar">
    <div class="footer-copy">Bonumech ® 2025 · Tüm hakları saklıdır.</div>
    <div class="footer-legal">
      <a href="#">KVKK</a>
      <a href="#">Gizlilik Politikası</a>
    </div>
  </div>
</footer>`;

// Aktif nav linkini belirle
function setActiveNav() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const map = {
    'index.html': 'nav-home',
    'urunler.html': 'nav-urunler',
    'projeler.html': 'nav-projeler',
    'intralogistik.html': 'nav-intra',
    'hakkimizda.html': 'nav-hakkimizda',
    'blog.html': 'nav-blog',
    'iletisim.html': 'nav-iletisim'
  };
  const id = map[page];
  if (id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }
}

// Sayfaya enjekte et
document.addEventListener('DOMContentLoaded', () => {
  const navEl = document.getElementById('nav-placeholder');
  const footerEl = document.getElementById('footer-placeholder');
  if (navEl) navEl.innerHTML = NAV_HTML;
  if (footerEl) footerEl.innerHTML = FOOTER_HTML;
  setActiveNav();
});
