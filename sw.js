/* Čuva aplikaciju na telefonu da se otvori i bez interneta. Podatke čuva Firebase. */
const VERZIJA = 'pecenje-v4';
const OSNOVA = ['./', 'index.html', 'app.js', 'shim.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'vendor/jspdf.umd.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERZIJA).then(c => c.addAll(OSNOVA)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERZIJA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const svoje = url.origin === location.origin;
  const biblioteke = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  const fontovi = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!svoje && !biblioteke && !fontovi) return;   // baza i prijava idu direktno na internet
  // prvo internet (da uvijek bude najnovija verzija), a bez interneta sačuvana kopija
  e.respondWith(fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      const copy = res.clone();
      caches.open(VERZIJA).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: svoje }).then(r => r || caches.match('index.html'))));
});
