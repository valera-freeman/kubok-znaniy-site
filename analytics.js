/* Аналитика лендинга «Кубок знаний».
   Без cookie, без IP, без отпечатка браузера: только счётчики событий и день.
   События копятся в памяти и уходят одной-двумя пачками на приёмник
   (Yandex Cloud Functions → Object Storage). См. docs/АНАЛИТИКА-САЙТА.md. */
(function () {
  var CFG = window.KZ_ANALYTICS || {};
  var ENDPOINT = CFG.url || '';
  var TOKEN = CFG.token || '';
  if (!ENDPOINT) return;
  // Уважаем «Не отслеживать» в браузере.
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  var queue = {};
  var timer = null;

  function add(name, n) {
    queue[name] = (queue[name] || 0) + (n || 1);
    if (timer === null) timer = setTimeout(flush, 2000);
  }

  function flush() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (!Object.keys(queue).length) return;
    var payload = JSON.stringify({
      t: TOKEN,
      ev: queue,
      src: source(),
      med: medium(),
      dev: device(),
      p: location.pathname,
    });
    queue = {};
    try {
      if (navigator.sendBeacon) {
        // text/plain — «простой» запрос: браузер не делает preflight.
        if (navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'text/plain;charset=UTF-8' }))) return;
      }
    } catch (e) { /* ниже обычный fetch */ }
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        keepalive: true,
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: payload,
      });
    } catch (e) { /* тихо: аналитика не должна ломать страницу */ }
  }

  /* ── источник визита: UTM → реферер → прямой заход ── */
  var qs = new URLSearchParams(location.search);
  var clean = function (v, max) {
    return String(v || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, max || 32);
  };
  function source() {
    var utm = clean(qs.get('utm_source'));
    if (utm) return utm;
    var ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) { ref = ''; }
    if (!ref || ref === location.hostname.replace(/^www\./, '')) return 'direct';
    if (/(^|\.)(yandex|ya|google|bing|duckduckgo|mail\.ru|go\.mail\.ru)\./.test(ref) || /yandex|google|bing|duckduckgo/.test(ref)) return 'search';
    if (/t\.me|telegram/.test(ref)) return 'telegram';
    if (/vk\.com|vk\.ru/.test(ref)) return 'vk';
    if (/youtube|youtu\.be/.test(ref)) return 'youtube';
    if (/ok\.ru/.test(ref)) return 'ok';
    if (/dzen\.ru|zen\.yandex/.test(ref)) return 'dzen';
    if (/rustore/.test(ref)) return 'rustore';
    return clean(ref, 32) || 'referral';
  }
  function medium() {
    return clean(qs.get('utm_medium') || qs.get('utm_campaign'), 24);
  }
  function device() {
    var ua = navigator.userAgent || '';
    if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
    if (/Mobi|iPhone|Android.*Mobile/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  /* ── клики ── */
  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('a, button') : null;
    if (!el) return;
    var href = el.getAttribute('href') || '';
    var apk = el.getAttribute('data-apk');
    var isStore = /rustore\.ru/i.test(href);

    if (isStore && apk === 'phone') return add('dl_rustore_phone');
    if (isStore && apk === 'tv') return add('dl_rustore_tv');
    if (apk === 'phone') return add('dl_phone');
    if (apk === 'tv') return add('dl_tv');
    if (el.closest('.site-header') && href === '#download') return add('dl_header');
    if (el.getAttribute('data-modal') === 'updates') return add('updates_open');
    if (/^privacy(\/|$|\.html)/i.test(href) || href.indexOf('privacy/') === 0) return add('privacy_open');
    if (/^mailto:/i.test(href)) return add('feedback_click');
  }
  document.addEventListener('click', onClick, true);

  /* ── показы блоков «телефон» и «ТВ» ── */
  (function views() {
    if (!('IntersectionObserver' in window)) return;
    var map = { phone: 'view_phone', tv: 'view_tv' };
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var kind = en.target.getAttribute('data-kz-view');
        if (!kind || seen[kind]) return;
        seen[kind] = true;
        add(map[kind] || 'view');
        io.unobserve(en.target);
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('[data-kz-view]').forEach(function (el) { io.observe(el); });
  })();

  /* ── глубина прокрутки: 50 / 70 / 90 %, по разу за визит ── */
  (function scrollDepth() {
    var marks = [50, 70, 90];
    var done = {};
    var raf = 0;
    function check() {
      raf = 0;
      var doc = document.documentElement;
      var height = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
      var visible = window.innerHeight + (window.pageYOffset || doc.scrollTop || 0);
      var pct = height > 0 ? (visible / height) * 100 : 100;
      for (var i = 0; i < marks.length; i++) {
        var m = marks[i];
        if (!done[m] && pct >= m) { done[m] = true; add('scroll_' + m); }
      }
      if (done[90]) window.removeEventListener('scroll', onScroll);
    }
    function onScroll() { if (!raf) raf = requestAnimationFrame(check); }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    check();
  })();

  /* ── отправка: пачкой при уходе со страницы, плюс через 2 с после события ── */
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  add('landing_open');
})();
