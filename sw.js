const CACHE = 'fz-v1';
const ASSETS = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'fz-data').map(k => caches.delete(k)))));
  self.clients.claim();
});
// Réseau d'abord pour l'app (mises à jour immédiates), cache en secours hors ligne
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.includes('openfoodfacts')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && (u.origin === location.origin || u.hostname === 'unpkg.com')) { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

// Vérification en arrière-plan (Android Chrome, app installée)
self.addEventListener('periodicsync', e => { if (e.tag === 'fz-check') e.waitUntil(check()); });
async function check() {
  const r = await (await caches.open('fz-data')).match('fz-data.json'); if (!r) return;
  const { items, days } = await r.json(), t = new Date(); t.setHours(0, 0, 0, 0);
  const due = items.filter(i => Math.round((new Date(i.date + 'T00:00') - t) / 864e5) <= days);
  if (due.length) await self.registration.showNotification(`🍽️ ${due.length} produit(s) à manger vite`,
    { body: due.slice(0, 4).map(i => i.name).join(', '), icon: 'icons/icon-192.png', tag: 'fz-daily' });
}

// Push envoyé par le serveur (iPhone + Android)
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'Frigo Zéro', body: 'Vérifie ton frigo !' };
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: 'icons/icon-192.png', tag: 'fz-daily' }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(cs => cs[0] ? cs[0].focus() : clients.openWindow('./')));
});
