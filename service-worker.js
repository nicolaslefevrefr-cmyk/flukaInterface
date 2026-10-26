/* Combinatorial Geometry Tool — service worker.
 * Network-first: the latest files are always fetched when online; the cache is only an offline fallback.
 * The cache name carries the version, so each release starts from a clean cache. */
const VERSION = '1.15.0';
const CACHE = 'cgt-' + VERSION;
const ASSETS = ['./', './index.html', './css/style.css', './js/lib/three.min.js', './js/core.js', './js/state.js', './js/scene.js', './js/cut.js', './js/compare.js', './js/check.js', './js/snap.js', './js/ui.js', './js/pwa.js', './manifest.json', './version.json', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(u => fetch(u, { cache: 'reload' }).then(r => r.ok && c.put(u, r)).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-store' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
