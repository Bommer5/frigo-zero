// Service worker : app utilisable hors ligne + réception des rappels push.
const CACHE = 'fz-v16', IMG_CACHE = 'fz-img';
const ASSETS = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/config.js', 'manifest.webmanifest', 'privacy.html',
  'icons/favicon-32.png', 'icons/icon-192.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Réseau d'abord (mises à jour immédiates), cache en secours. Les API (Supabase, Open Food Facts) ne sont jamais mises en cache, seules les photos le sont.
const CACHEABLE = (u) => u.origin === location.origin || u.hostname === 'unpkg.com' || u.hostname === 'cdn.jsdelivr.net';
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  // Photos produits (Open Food Facts / bucket Supabase) affichées par <img> : cache d'abord
  // (pas pour fetch() en CORS : la copie vers le bucket doit lire l'image, une réponse opaque en cache la ferait échouer) (une image ne change pas d'URL), réseau seulement la 1re fois
  if (e.request.method === 'GET' && e.request.mode === 'no-cors' && (/(^|\.)open(food|products|beauty)facts\.org$/.test(u.hostname) && u.pathname.startsWith('/images/') || u.pathname.startsWith('/storage/v1/object/public/product-images/'))) {
    e.respondWith(caches.open(IMG_CACHE).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r;
    }))));
    return;
  }
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
