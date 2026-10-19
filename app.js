'use strict';
// ---------- Données ----------
const LOCS = { frigo: '🧊 Frigo', congel: '❄️ Congélateur', placard: '🥫 Placard', autre: '📦 Autre' };
const VRAC = [ // produits sans code-barres : [emoji+nom, emplacement, jours de conservation]
  ['🍎 Pommes', 'placard', 21], ['🍌 Bananes', 'placard', 5], ['🍅 Tomates', 'frigo', 7], ['🥕 Carottes', 'frigo', 14],
  ['🥬 Salade', 'frigo', 4], ['🥩 Viande', 'frigo', 3], ['🐟 Poisson', 'frigo', 2], ['🍗 Poulet', 'frigo', 2],
  ['🧀 Fromage', 'frigo', 14], ['🥚 Œufs', 'frigo', 21], ['🍞 Pain', 'placard', 3], ['🍲 Restes', 'frigo', 3]
];
const QUICK_DATES = [['+1 j', 1], ['+3 j', 3], ['+1 sem', 7], ['+2 sem', 14], ['+1 mois', 30], ['+3 mois', 90], ['+1 an', 365]];
const KEY = 'frigo-zero-v1';
const DAY = 864e5;

const db = load();
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d) return Object.assign({ items: [], shop: [], log: [], products: {}, settings: {} }, d);
  } catch {}
  return { items: [], shop: [], log: [], products: {}, settings: { days: 2, hour: '18:00' } };
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(db));
  mirrorForWorker();
  syncPush();
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const plusDays = n => iso(new Date(today().getTime() + n * DAY));
const daysLeft = date => Math.round((new Date(date + 'T00:00') - today()) / DAY);

function whenText(n, kind) {
  if (n < 0) return kind === 'ddm' ? `DDM dépassée de ${-n} j (souvent encore bon)` : `Périmé depuis ${-n} j`;
  if (n === 0) return "Aujourd'hui !";
  if (n === 1) return 'Demain';
  return `Dans ${n} jours`;
}
function status(n) { return n < 0 ? 'expired' : n <= db.settings.days ? 'soon' : n <= 7 ? 'week' : ''; }

function toast(msg, action, fn) {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (action ? ` <button>${esc(action)}</button>` : '');
  if (action) t.querySelector('button').onclick = () => { fn(); t.classList.remove('show'); };
  t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2500);
}

// ---------- Onglets ----------
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  ['stock', 'courses', 'stats'].forEach(t => $('#tab-' + t).hidden = t !== b.dataset.tab);
  $('#fab').hidden = b.dataset.tab !== 'stock';
  render();
});

// ---------- Stock ----------
$('#filter-loc').innerHTML = '<option value="">Tout</option>' + Object.entries(LOCS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('#f-loc').innerHTML = Object.entries(LOCS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('#search').oninput = $('#filter-loc').onchange = renderStock;

function renderStock() {
  const q = $('#search').value.toLowerCase(), loc = $('#filter-loc').value;
  const items = db.items.filter(i => (!loc || i.loc === loc) && (!q || i.name.toLowerCase().includes(q)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const all = db.items.map(i => daysLeft(i.date));
  const exp = all.filter(n => n < 0).length, soon = all.filter(n => n >= 0 && n <= db.settings.days).length;
  $('#summary').innerHTML = `<span class="pill">${db.items.length} produit(s)</span>` +
    (exp ? `<span class="pill red">${exp} périmé(s)</span>` : '') + (soon ? `<span class="pill orange">${soon} à manger vite</span>` : '');
  $('#empty').hidden = db.items.length > 0;
  $('#list').innerHTML = items.map(i => {
    const n = daysLeft(i.date);
    const thumb = i.img ? `<img class="thumb" src="${esc(i.img)}" alt="" loading="lazy">` : `<div class="thumb">${LOCS[i.loc]?.split(' ')[0] || '📦'}</div>`;
    return `<li class="${status(n)}" data-id="${i.id}">${thumb}
      <div class="info" data-act="edit"><b>${esc(i.name)}${i.qty > 1 ? ` ×${i.qty}` : ''}</b>
      <span class="when">${whenText(n, i.kind)} · ${LOCS[i.loc]?.split(' ').slice(1).join(' ') || ''}${i.note ? ' · ' + esc(i.note) : ''}</span></div>
      <div class="acts"><button data-act="eaten" title="Consommé">😋</button><button data-act="wasted" title="Jeté">🗑️</button></div></li>`;
  }).join('');
}
$('#list').onclick = e => {
  const act = e.target.closest('[data-act]')?.dataset.act, li = e.target.closest('li');
  if (!act || !li) return;
  const item = db.items.find(i => i.id === li.dataset.id);
  if (act === 'edit') return openItem(item);
  consume(item, act);
};
function consume(item, outcome) {
  const before = JSON.stringify(db);
  db.log.push({ name: item.name, date: iso(new Date()), outcome });
  if (item.qty > 1) item.qty--; else db.items = db.items.filter(i => i !== item);
  save(); render();
  const gone = !db.items.includes(item);
  if (gone && outcome === 'eaten' && !db.shop.some(s => s.text === item.name && !s.done))
    toast(`${item.name} terminé`, '🛒 Racheter', () => { db.shop.push({ id: uid(), text: item.name, done: false }); save(); });
  else toast(outcome === 'eaten' ? 'Bon appétit 😋' : 'Noté comme jeté', 'Annuler', () => { Object.assign(db, JSON.parse(before)); save(); render(); });
}

// ---------- Ajout / édition ----------
let editing = null, scanner = null;
$('#fab').onclick = () => openItem();
$('#quick-items').innerHTML = VRAC.map((v, k) => `<button type="button" data-k="${k}">${v[0]}</button>`).join('');
$('#quick-dates').innerHTML = QUICK_DATES.map(([l, n]) => `<button type="button" data-n="${n}">${l}</button>`).join('');
$('#quick-items').onclick = e => {
  const v = VRAC[e.target.dataset.k]; if (!v) return;
  $('#f-name').value = v[0].split(' ').slice(1).join(' '); $('#f-loc').value = v[1]; $('#f-date').value = plusDays(v[2]);
};
$('#quick-dates').onclick = e => { if (e.target.dataset.n) $('#f-date').value = plusDays(+e.target.dataset.n); };

function openItem(item) {
  editing = item || null;
  $('#item-title').textContent = item ? 'Modifier' : 'Ajouter un produit';
  $('#scanner-wrap').hidden = !!item;
  $('#quick-items').hidden = !!item;
  $('#f-name').value = item?.name || ''; $('#f-code').value = item?.code || '';
  $('#f-date').value = item?.date || ''; $('#f-loc').value = item?.loc || 'frigo';
  $('#f-qty').value = item?.qty || 1; $('#f-kind').value = item?.kind || 'dlc'; $('#f-note').value = item?.note || '';
  setImg(item?.img); $('#scan-status').textContent = '';
  $('#item-save').textContent = item ? 'Enregistrer' : 'Ajouter';
  $('#dlg-item').showModal();
}
function setImg(src) { const im = $('#item-img'); im.hidden = !src; im.src = src || ''; }
function closeItem() { stopScan(); $('#dlg-item').close(); }
$('#item-cancel').onclick = closeItem;
$('#dlg-item').addEventListener('close', stopScan);
$('#item-form').onsubmit = e => {
  e.preventDefault();
  const data = { name: $('#f-name').value.trim(), code: $('#f-code').value.trim(), date: $('#f-date').value,
    loc: $('#f-loc').value, qty: Math.max(1, +$('#f-qty').value || 1), kind: $('#f-kind').value,
    note: $('#f-note').value.trim(), img: $('#item-img').hidden ? '' : $('#item-img').src };
  if (!data.name || !data.date) return;
  if (editing) Object.assign(editing, data);
  else db.items.push({ id: uid(), added: iso(new Date()), ...data });
  if (data.code) db.products[data.code] = { name: data.name, img: data.img, loc: data.loc, kind: data.kind };
  save(); closeItem(); render();
  toast(editing ? 'Modifié' : `${data.name} ajouté ✔️`);
};

// Scan du code-barres (caméra ou photo), infos via Open Food Facts
const FORMATS = () => [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E];
function newScanner() {
  if (!window.Html5Qrcode) { toast('Scanner indisponible hors ligne'); return null; }
  return new Html5Qrcode('reader', { formatsToSupport: FORMATS(), useBarCodeDetectorIfSupported: true, verbose: false });
}
$('#btn-scan').onclick = async () => {
  if (scanner) return stopScan();
  scanner = newScanner(); if (!scanner) return;
  $('#btn-scan').textContent = '✖ Arrêter';
  $('#scan-status').textContent = 'Vise le code-barres…';
  try {
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 120 } }, code => { stopScan(); onCode(code); });
  } catch (err) {
    stopScan(); $('#scan-status').textContent = 'Caméra inaccessible : autorise-la ou utilise « Photo ».';
  }
};
$('#scan-file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const s = newScanner(); if (!s) return;
  try { onCode(await s.scanFile(f, false)); } catch { $('#scan-status').textContent = 'Aucun code-barres trouvé sur la photo.'; }
  e.target.value = '';
};
function stopScan() {
  if (scanner) { const s = scanner; scanner = null; s.isScanning ? s.stop().then(() => s.clear()).catch(() => {}) : s.clear(); }
  $('#btn-scan').textContent = '📷 Scanner le code-barres';
}
async function onCode(code) {
  navigator.vibrate?.(80);
  $('#f-code').value = code;
  const known = db.products[code];
  if (known) return fillProduct(known, 'Produit déjà connu ✔️');
  $('#scan-status').textContent = `Code ${code} — recherche…`;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name_fr,product_name,brands,image_front_small_url,categories_tags`);
    const j = await r.json();
    if (j.status !== 1) throw 0;
    const p = j.product, name = [p.product_name_fr || p.product_name, p.brands?.split(',')[0]].filter(Boolean).join(' – ');
    const cats = (p.categories_tags || []).join(' ');
    const loc = /frozen|surgel/.test(cats) ? 'congel' : /dairies|meats|fishes|fresh|yogurt|cheese|desserts/.test(cats) ? 'frigo' : 'placard';
    fillProduct({ name, img: p.image_front_small_url, loc }, 'Trouvé sur Open Food Facts ✔️ — indique la date.');
  } catch {
    $('#scan-status').textContent = 'Produit inconnu : tape son nom.';
    $('#f-name').focus();
  }
}
function fillProduct(p, msg) {
  $('#f-name').value = p.name || ''; setImg(p.img); if (p.loc) $('#f-loc').value = p.loc; if (p.kind) $('#f-kind').value = p.kind;
  $('#scan-status').textContent = msg;
  $('#f-date').focus(); $('#f-date').showPicker?.();
}

// ---------- Courses ----------
$('#shop-form').onsubmit = e => {
  e.preventDefault(); const t = $('#shop-input').value.trim(); if (!t) return;
  db.shop.push({ id: uid(), text: t, done: false }); $('#shop-input').value = ''; save(); renderShop();
};
function renderShop() {
  $('#shop-list').innerHTML = db.shop.map(s => `<li class="${s.done ? 'done' : ''}" data-id="${s.id}">
    <input type="checkbox" ${s.done ? 'checked' : ''}><span class="grow">${esc(s.text)}</span></li>`).join('') ||
    '<p class="empty">Liste vide. Les produits terminés peuvent y être ajoutés en un clic.</p>';
}
$('#shop-list').onclick = e => {
  const li = e.target.closest('li'); if (!li) return;
  const s = db.shop.find(x => x.id === li.dataset.id); s.done = !s.done; save(); renderShop();
};
$('#shop-clear').onclick = () => { db.shop = db.shop.filter(s => !s.done); save(); renderShop(); };

// ---------- Bilan ----------
function renderStats() {
  const since = iso(new Date(Date.now() - 30 * DAY)), recent = db.log.filter(l => l.date >= since);
  const eaten = recent.filter(l => l.outcome === 'eaten').length, wasted = recent.length - eaten;
  const pct = recent.length ? Math.round(eaten / recent.length * 100) : 100;
  const top = Object.entries(db.log.filter(l => l.outcome === 'wasted').reduce((m, l) => (m[l.name] = (m[l.name] || 0) + 1, m), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#stats').innerHTML = `<div class="stat"><div class="muted">30 derniers jours</div><div class="big">${pct}% sauvés</div>
    <div>😋 ${eaten} consommé(s) · 🗑️ ${wasted} jeté(s)</div><div class="bar"><div style="width:${pct}%"></div></div></div>
    <div class="stat"><b>Ce que tu jettes le plus</b>${top.length ? '<ol>' + top.map(([n, c]) => `<li>${esc(n)} (${c}×)</li>`).join('') + '</ol><p class="muted">Astuce : achètes-en moins souvent ou en plus petit format.</p>' : '<p class="muted">Rien jeté pour l\'instant, bravo !</p>'}</div>`;
}

function render() { renderStock(); renderShop(); renderStats(); }

// ---------- Réglages, export, partage ----------
$('#btn-settings').onclick = () => {
  $('#s-days').value = db.settings.days; $('#s-hour').value = db.settings.hour; notifStatus(); $('#dlg-settings').showModal();
};
$('#s-days').onchange = () => { db.settings.days = +$('#s-days').value; save(); render(); };
$('#s-hour').onchange = () => { db.settings.hour = $('#s-hour').value; save(); };
$('#btn-export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }));
  a.download = `frigo-zero-${iso(new Date())}.json`; a.click();
};
$('#import-file').onchange = async e => {
  try {
    const d = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(d.items)) throw 0;
    Object.assign(db, d); save(); render(); toast('Sauvegarde importée ✔️');
  } catch { toast('Fichier invalide'); }
};
$('#btn-share').onclick = async () => {
  const payload = db.items.map(({ name, date, loc, qty, kind, img, code }) => ({ name, date, loc, qty, kind, img, code }));
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))));
  const url = `${location.origin}${location.pathname}#share=${encodeURIComponent(b64)}`;
  try { if (navigator.share) await navigator.share({ title: 'Mon frigo', url }); else { await navigator.clipboard.writeText(url); toast('Lien copié 📋'); } } catch {}
};
function readShareLink() {
  const m = location.hash.match(/^#share=(.+)$/); if (!m) return;
  history.replaceState(null, '', location.pathname);
  try {
    const items = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(decodeURIComponent(m[1])), c => c.charCodeAt(0))));
    if (!confirm(`Importer ${items.length} produit(s) partagé(s) ? (les doublons sont ignorés)`)) return;
    const seen = new Set(db.items.map(i => i.name + i.date));
    items.filter(i => !seen.has(i.name + i.date)).forEach(i => db.items.push({ id: uid(), added: iso(new Date()), note: '', ...i }));
    save();
  } catch { toast('Lien de partage invalide'); }
}

// ---------- Notifications ----------
// 1) locales : à l'ouverture de l'app et via periodicSync (Android Chrome, app installée)
// 2) push via serveur (facultatif) : seule façon de réveiller une PWA iPhone
function dueItems() { return db.items.filter(i => daysLeft(i.date) <= db.settings.days); }
function dueMessage(items) {
  const exp = items.filter(i => daysLeft(i.date) < 0).length;
  return { title: exp ? `⚠️ ${exp} produit(s) périmé(s)` : `🍽️ ${items.length} produit(s) à manger vite`,
    body: items.slice(0, 4).map(i => `${i.name} : ${whenText(daysLeft(i.date), i.kind).toLowerCase()}`).join('\n') };
}
async function mirrorForWorker() { // le service worker lit ce cache pour periodicSync
  try { const c = await caches.open('fz-data'); await c.put('fz-data.json', new Response(JSON.stringify({ items: db.items, days: db.settings.days }))); } catch {}
}
async function localNotify() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const key = 'fz-last-notif', d = iso(new Date());
  if (localStorage.getItem(key) === d) return;
  const items = dueItems(); if (!items.length) return;
  localStorage.setItem(key, d);
  const reg = await navigator.serviceWorker?.ready; const m = dueMessage(items);
  reg?.showNotification(m.title, { body: m.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'fz-daily' });
}
function notifStatus() {
  const s = $('#notif-status'), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isIOS() && !standalone) return s.textContent = "Sur iPhone : installe d'abord l'app (Partager → « Sur l'écran d'accueil »).";
  if (!('Notification' in window)) return s.textContent = 'Notifications non supportées sur ce navigateur.';
  s.textContent = { granted: '✔️ Activées' + (FZ_CONFIG.pushServer ? ' (push)' : ' (à l\'ouverture de l\'app' + ('periodicSync' in ServiceWorkerRegistration.prototype ? ' + en arrière-plan)' : ')')),
    denied: '❌ Bloquées : réautorise-les dans les réglages du téléphone.', default: '' }[Notification.permission];
}
$('#btn-notif').onclick = async () => {
  if (!('Notification' in window)) return notifStatus();
  if (await Notification.requestPermission() === 'granted') {
    const reg = await navigator.serviceWorker.ready;
    try { await reg.periodicSync?.register('fz-check', { minInterval: 12 * 3600e3 }); } catch {}
    await subscribePush(reg);
    reg.showNotification('Frigo Zéro', { body: 'Les rappels de péremption sont activés 👍', icon: 'icons/icon-192.png' });
  }
  notifStatus();
};
async function subscribePush(reg) {
  if (!FZ_CONFIG.pushServer || !reg.pushManager) return;
  const key = Uint8Array.from(atob(FZ_CONFIG.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  localStorage.setItem('fz-sub', JSON.stringify(sub)); syncPush();
}
function syncPush() { // envoie au serveur uniquement noms + dates, pour le rappel quotidien
  const sub = localStorage.getItem('fz-sub'); if (!FZ_CONFIG.pushServer || !sub) return;
  clearTimeout(syncPush.t);
  syncPush.t = setTimeout(() => fetch(FZ_CONFIG.pushServer + '/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sub: JSON.parse(sub), days: db.settings.days, hour: db.settings.hour, tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      items: db.items.map(({ name, date, kind }) => ({ name, date, kind })) }) }).catch(() => {}), 1500);
}

// ---------- Installation ----------
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvt = null;
addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installEvt = e;
  const h = $('#install-hint'); h.hidden = false;
  h.innerHTML = '📲 Installe Frigo Zéro sur ton téléphone pour les rappels. <button>Installer</button>';
  h.querySelector('button').onclick = () => { installEvt.prompt(); h.hidden = true; };
});
if (isIOS() && !navigator.standalone && !localStorage.getItem('fz-ios-hint')) {
  const h = $('#install-hint'); h.hidden = false;
  h.innerHTML = '📲 Sur iPhone : touche <b>Partager</b> ⬆️ puis <b>« Sur l\'écran d\'accueil »</b> pour installer l\'app et recevoir les rappels. <button class="ghost">OK</button>';
  h.querySelector('button').onclick = () => { h.hidden = true; localStorage.setItem('fz-ios-hint', 1); };
}

// ---------- Démarrage ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
readShareLink();
render(); mirrorForWorker(); localNotify();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); localNotify(); } });
if (new URLSearchParams(location.search).has('add')) openItem();
