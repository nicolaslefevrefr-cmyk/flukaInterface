/* pwa.js — service worker registration + "always the latest version" mechanism (HTTPS or localhost only).
 *  - the service worker is network-first (see service-worker.js);
 *  - version.json is fetched with no-store at load and when the tab regains focus; a newer version shows a reload bar;
 *  - CGT_forceRefresh() (Settings ▸ Updates) unregisters the worker, empties the caches and reloads. */
(function () {
  const cur = () => (window.FK && FK.VERSION) || '';
  const bar = () => document.getElementById('updBar');
  function showBar(v) {
    const b = bar(); if (!b) return;
    document.getElementById('updVer').textContent = 'v' + v; b.hidden = false;
  }
  async function check(manual) {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      if (j && j.version && j.version !== cur()) { showBar(j.version); return 'new'; }
      return 'same';
    } catch (e) { return 'offline'; }
  }
  async function forceRefresh() {
    try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); } catch (e) {}
    try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (e) {}
    location.reload();
  }
  window.CGT_check = check; window.CGT_forceRefresh = forceRefresh;
  document.getElementById('updGo').onclick = forceRefresh;
  document.getElementById('updLater').onclick = () => { bar().hidden = true; };
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener('focus', () => check());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  check();
  if ('serviceWorker' in navigator) {
    const had = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' }).then(reg => { reg.update().catch(() => {}); }).catch(() => {});
    });
  }
})();
