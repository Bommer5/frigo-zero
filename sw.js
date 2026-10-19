// Service worker : app utilisable hors ligne + réception des rappels push.
const CACHE = 'fz-v4';
const ASSETS = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/config.js', 'manifest.webmanifest', 'privacy.html',
  'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Réseau d'abord (mises à jour immédiates), cache en secours. Les API (Supabase, Open Food Facts) ne sont jamais mises en cache.
const CACHEABLE = (u) => u.origin === location.origin || u.hostname === 'unpkg.com' || u.hostname === 'cdn.jsdelivr.net';
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || !CACHEABLE(u)) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: u.origin === location.origin })));
});

self.addEventListener('push', (e) => {
  let d = { title: 'Frigo Zéro', body: 'Pense à vérifier ton frigo !' };
  try { d = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'fz-daily', renotify: true }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => cs[0] ? cs[0].focus() : clients.openWindow('./')));
});
