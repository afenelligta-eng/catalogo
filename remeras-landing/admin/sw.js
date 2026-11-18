// Service worker del panel: permite instalarlo como app y abrirlo aunque la señal sea mala.
// Solo guarda la "cáscara" del panel. Los datos (ventas, stock, ajustes) SIEMPRE se piden en vivo
// al Apps Script: nunca se muestran datos viejos guardados.
const CACHE = 'panel-v1';
const SHELL = ['/admin/', '/admin/manifest.webmanifest', '/admin/icon-192.png', '/admin/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/admin')) return;
  // Red primero (así cada cambio del panel llega enseguida); si no hay señal, la copia guardada.
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match('/admin/')))
  );
});
