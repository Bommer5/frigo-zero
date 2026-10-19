import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } });

// ---------- Constantes ----------
const LOCS = { fridge: ['🧊', 'Frigo'], freezer: ['❄️', 'Congélo'], pantry: ['🥫', 'Placard'], other: ['📦', 'Autre'] };
const VRAC = [ // produits sans code-barres : [emoji, nom, emplacement, jours]
  ['🍎', 'Pommes', 'pantry', 21], ['🍌', 'Bananes', 'pantry', 5], ['🍅', 'Tomates', 'fridge', 7], ['🥕', 'Carottes', 'fridge', 14],
  ['🥬', 'Salade', 'fridge', 4], ['🥩', 'Viande', 'fridge', 3], ['🐟', 'Poisson', 'fridge', 2], ['🍗', 'Poulet', 'fridge', 2],
  ['🧀', 'Fromage', 'fridge', 14], ['🥚', 'Œufs', 'fridge', 21], ['🍞', 'Pain', 'pantry', 3], ['🍲', 'Restes', 'fridge', 3]];
const QUICK_DATES = [['Demain', 1], ['+3 j', 3], ['+1 sem', 7], ['+2 sem', 14], ['+1 mois', 30], ['+3 mois', 90], ['+1 an', 365]];
const DAY = 864e5;
const BASE_URL = location.origin + location.pathname.replace(/index\.html$/, '');

// ---------- État ----------
const S = { user: null, profile: null, households: [], hid: null, items: [], shop: [], members: [], log: [], loc: '', q: '', view: 'stock', channel: null };

// ---------- Utilitaires ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (id) => `<svg class="i"><use href="#i-${id}"/></svg>`;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const plusDays = (n) => iso(new Date(today().getTime() + n * DAY));
const daysLeft = (date) => Math.round((new Date(date + 'T00:00') - today()) / DAY);
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const initials = (n) => (n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avatar = (p, id = '') => p?.avatar_url
  ? `<img ${id && `id="${id}"`} class="avatar" src="${esc(p.avatar_url)}" alt="" referrerpolicy="no-referrer">`
  : `<span ${id && `id="${id}"`} class="avatar">${esc(initials(p?.display_name))}</span>`;
const vibrate = (n = 10) => navigator.vibrate?.(n);

function when(n, kind) {
  if (n < 0) return kind === 'ddm' ? `DDM passée (${-n} j)` : `Périmé (${-n} j)`;
  if (n === 0) return "Aujourd'hui";
  if (n === 1) return 'Demain';
  if (n < 7) return `${n} jours`;
  if (n < 60) return `${Math.round(n / 7)} sem.`;
  return new Date(Date.now() + n * DAY).toLocaleDateString('fr-BE', { month: 'short', year: 'numeric' });
}
const urgency = (n) => (n < 0 ? 'r' : n <= (S.profile?.notify_days ?? 2) ? 'o' : '');

let toastTimer;
function toast(msg, action, fn) {
  const t = $('#toast'), b = t.querySelector('button');
  t.querySelector('span').textContent = msg;
  b.hidden = !action; b.textContent = action || ''; b.onclick = () => { t.classList.remove('show'); fn?.(); };
  t.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2400);
}
function fail(e) { console.error(e); toast(navigator.onLine ? 'Oups, une erreur est survenue' : 'Pas de connexion internet'); }

function openSheet(id) { const d = $(id); if (!d.open) d.showModal(); }
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) e.target.closest('dialog')?.close();
  if (e.target.tagName === 'DIALOG') e.target.close(); // clic sur le fond
});

// ---------- Authentification ----------
$('#btn-google').onclick = () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: BASE_URL, queryParams: { prompt: 'select_account' } } });
$('#btn-logout').onclick = async () => { await sb.auth.signOut(); localStorage.removeItem('fz-cache'); location.reload(); };

// Code d'invitation dans l'URL : gardé jusqu'après la connexion
const params = new URLSearchParams(location.search);
if (params.get('invite')) { store.set('fz-invite', params.get('invite')); history.replaceState(null, '', BASE_URL); }

sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') { S.user = null; showLogin(); }
  else if (session?.user && S.user?.id !== session.user.id) { S.user = session.user; setTimeout(boot); }
});
sb.auth.getSession().then(({ data }) => { if (!data.session) showLogin(); });

function showLogin() {
  $('#splash').hidden = true; $('#app').hidden = true; $('#login').hidden = false;
  const h = $('#invite-hint');
  h.hidden = !store.get('fz-invite');
  h.textContent = "🏠 On t'a invité dans un foyer ! Connecte-toi pour le rejoindre.";
}

// ---------- Démarrage ----------
async function boot() {
  $('#login').hidden = true;
  const cached = store.get('fz-cache');
  if (cached?.uid === S.user.id) { Object.assign(S, cached.s); showApp(); } // affichage instantané (et hors ligne)
  try {
    await loadProfile();
    await loadHouseholds();
    await loadHousehold();
    showApp();
    await handleInvite();
    offerLegacyImport();
    if (params.has('add')) { history.replaceState(null, '', BASE_URL); openItem(); }
    if (window.Notification?.permission === 'granted' && store.get('fz-push')) ensurePush().catch(() => {});
  } catch (e) { showApp(); fail(e); }
}
function showApp() { $('#splash').hidden = true; $('#app').hidden = false; render(); }
function cache() { store.set('fz-cache', { uid: S.user.id, s: { profile: S.profile, households: S.households, hid: S.hid, items: S.items, shop: S.shop, members: S.members, log: S.log } }); }

async function loadProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('id', S.user.id).single();
  if (error) throw error;
  S.profile = data;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && data.timezone !== tz) { S.profile.timezone = tz; sb.from('profiles').update({ timezone: tz }).eq('id', S.user.id).then(); }
}
async function loadHouseholds() {
  const { data, error } = await sb.from('household_members').select('role, households(id, name)').eq('user_id', S.user.id);
  if (error) throw error;
  S.households = data.filter((m) => m.households).map((m) => ({ ...m.households, role: m.role })).sort((a, b) => a.name.localeCompare(b.name));
  if (!S.households.length) { await rpc('create_household', { p_name: 'Mon frigo' }); return loadHouseholds(); }
  const saved = store.get('fz-hid');
  S.hid = S.households.find((h) => h.id === saved)?.id || S.households[0].id;
}
async function loadHousehold() {
  if (!S.hid) return;
  store.set('fz-hid', S.hid);
  const [items, shop, members, log] = await Promise.all([
    sb.from('items').select('*').eq('household_id', S.hid).order('expires_on'),
    sb.from('shopping_items').select('*').eq('household_id', S.hid).order('created_at'),
    sb.from('household_members').select('user_id, role, joined_at, profiles(display_name, avatar_url)').eq('household_id', S.hid).order('joined_at'),
    sb.from('consumption_log').select('name, outcome, happened_on').eq('household_id', S.hid).gte('happened_on', plusDays(-30))]);
  for (const r of [items, shop, members, log]) if (r.error) throw r.error;
  Object.assign(S, { items: items.data, shop: shop.data, members: members.data, log: log.data });
  cache(); subscribe();
}
async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; }

// Temps réel : les changements des autres membres arrivent automatiquement
let reloadTimer, subscribedTo = null;
function subscribe() {
  if (subscribedTo === S.hid) return;
  if (S.channel) sb.removeChannel(S.channel);
  subscribedTo = S.hid;
  const refresh = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => loadHousehold().then(render).catch(() => {}), 400); };
  S.channel = sb.channel('hh-' + S.hid);
  for (const table of ['items', 'shopping_items', 'household_members'])
    S.channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${S.hid}` }, refresh);
  S.channel.subscribe();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) loadHousehold().then(render).catch(() => {}); });
addEventListener('online', () => { $('#offline').hidden = true; if (S.user) loadHousehold().then(render).catch(() => {}); });
addEventListener('offline', () => { $('#offline').hidden = false; });
$('#offline').hidden = navigator.onLine;

// ---------- Navigation ----------
document.querySelectorAll('.tabbar button').forEach((b) => (b.onclick = () => { S.view = b.dataset.view; vibrate(); render(); scrollTo(0, 0); }));

function render() {
  if (!S.user || !S.profile) return;
  const hh = S.households.find((h) => h.id === S.hid);
  $('#hh-name').textContent = hh?.name || 'Mon frigo';
  $('#me-avatar').outerHTML = avatar(S.profile, 'me-avatar');
  for (const v of ['stock', 'shop', 'stats', 'home']) $('#v-' + v).hidden = S.view !== v;
  document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === S.view));
  $('#fab').hidden = S.view !== 'stock';
  badge('#badge-stock', S.items.filter((i) => urgency(daysLeft(i.expires_on))).length);
  badge('#badge-shop', S.shop.filter((s) => !s.done).length);
  ({ stock: renderStock, shop: renderShop, stats: renderStats, home: renderHome })[S.view]();
}
function badge(sel, n) { const b = $(sel); b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }
$('#btn-me').onclick = () => { S.view = 'home'; render(); };

// ---------- Stock ----------
$('#loc-chips').innerHTML = [['', 'Tout'], ...Object.entries(LOCS).map(([k, [e, l]]) => [k, `${e} ${l}`])]
  .map(([k, l]) => `<button class="chip" data-loc="${k}" aria-pressed="${k === ''}">${l}</button>`).join('');
$('#loc-chips').onclick = (e) => {
  const c = e.target.closest('.chip'); if (!c) return;
  S.loc = c.dataset.loc; document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', x === c)); renderStock();
};
$('#q').oninput = (e) => { S.q = e.target.value.trim().toLowerCase(); renderStock(); };

function renderStock() {
  const all = S.items.map((i) => ({ ...i, n: daysLeft(i.expires_on) }));
  const exp = all.filter((i) => i.n < 0).length, soon = all.filter((i) => urgency(i.n) === 'o').length;
  $('#overview').innerHTML = all.length ? `<div><b>${all.length}</b><span>produits</span></div><div class="o"><b>${soon}</b><span>à manger vite</span></div><div class="r"><b>${exp}</b><span>périmés</span></div>` : '';
  if (!all.length) {
    $('#stock-list').innerHTML = `<div class="empty"><div class="big">🧊</div><h3>Ton frigo est vide</h3><p>Appuie sur <b>Ajouter</b> pour scanner ton premier produit.</p></div>`;
    return;
  }
  const items = all.filter((i) => (!S.loc || i.location === S.loc) && (!S.q || i.name.toLowerCase().includes(S.q)));
  if (!items.length) { $('#stock-list').innerHTML = `<div class="empty"><p>Aucun produit ne correspond.</p></div>`; return; }
  const groups = [['Périmés', 'r', (i) => i.n < 0], ['À manger vite', 'o', (i) => urgency(i.n) === 'o'],
    ['Cette semaine', '', (i) => !urgency(i.n) && i.n <= 7], ['Plus tard', '', (i) => !urgency(i.n) && i.n > 7]];
  $('#stock-list').innerHTML = groups.map(([title, cls, f]) => {
    const g = items.filter(f);
    return g.length ? `<div class="section-h ${cls}">${title} · ${g.length}</div><div class="card-list">${g.map(itemRow).join('')}</div>` : '';
  }).join('');
}
function itemRow(i) {
  const [emo, loc] = LOCS[i.location] || LOCS.other;
  return `<div class="row" data-id="${i.id}">
    <button class="thumb" data-act="edit" aria-label="Modifier">${i.image_url ? `<img src="${esc(i.image_url)}" alt="" loading="lazy">` : emo}</button>
    <button class="main" data-act="edit"><div class="title">${esc(i.name)}</div>
      <div class="sub"><span class="badge ${urgency(i.n)}">${when(i.n, i.date_kind)}</span>${i.quantity > 1 ? `<span>×${i.quantity}</span>` : ''}<span>${loc}${i.note ? ' · ' + esc(i.note) : ''}</span></div></button>
    <div class="row-actions"><button class="eat" data-act="eaten" aria-label="Consommé">${icon('eat')}</button><button class="waste" data-act="wasted" aria-label="Jeté">${icon('trash')}</button></div></div>`;
}
$('#stock-list').onclick = (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act, row = e.target.closest('.row');
  if (!act || !row) return;
  const item = S.items.find((i) => i.id === row.dataset.id);
  if (item) act === 'edit' ? openItem(item) : consume(item, act);
};
async function consume(item, outcome) {
  vibrate(15);
  const snapshot = { ...item }, gone = item.quantity <= 1;
  if (gone) S.items = S.items.filter((i) => i !== item); else item.quantity--; // optimiste
  render();
  try { await rpc('consume_item', { p_item: item.id, p_outcome: outcome }); } catch (e) { await loadHousehold().catch(() => {}); render(); return fail(e); }
  S.log.push({ name: item.name, outcome, happened_on: iso(new Date()) });
  if (gone && outcome === 'eaten' && !S.shop.some((s) => !s.done && s.label.toLowerCase() === item.name.toLowerCase()))
    toast(`${item.name} terminé`, 'Racheter', () => addShop(item.name));
  else toast(outcome === 'eaten' ? 'Bon appétit 😋' : 'Noté comme jeté', 'Annuler', () => restore(snapshot, gone));
}
async function restore(it, gone) {
  try {
    if (gone) { const { created_at, updated_at, ...row } = it; await sb.from('items').insert(row).throwOnError(); }
    else await sb.from('items').update({ quantity: it.quantity }).eq('id', it.id).throwOnError();
    await loadHousehold(); render();
  } catch (e) { fail(e); }
}

// ---------- Feuille produit ----------
let editing = null, kind = 'dlc', loc = 'fridge', qty = 1, img = null, scanner = null;
$('#f-loc').innerHTML = Object.entries(LOCS).map(([k, [e, l]]) => `<button type="button" data-v="${k}">${e} ${l}</button>`).join('');
$('#quick-items').innerHTML = VRAC.map(([e, n], k) => `<button type="button" data-k="${k}">${e} ${n}</button>`).join('');
$('#quick-dates').innerHTML = QUICK_DATES.map(([l, n]) => `<button type="button" data-n="${n}">${l}</button>`).join('');
const setSeg = (sel, v) => document.querySelectorAll(`${sel} button`).forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v));
$('#f-kind').onclick = (e) => { const b = e.target.closest('button'); if (b) setSeg('#f-kind', (kind = b.dataset.v)); };
$('#f-loc').onclick = (e) => { const b = e.target.closest('button'); if (b) setSeg('#f-loc', (loc = b.dataset.v)); };
$('.stepper').onclick = (e) => { const s = +e.target.dataset.step; if (s) { qty = Math.min(999, Math.max(1, qty + s)); $('#f-qty').value = qty; } };
$('#quick-items').onclick = (e) => {
  const v = VRAC[e.target.dataset.k]; if (!v) return;
  $('#f-name').value = v[1]; setSeg('#f-loc', (loc = v[2])); $('#f-date').value = plusDays(v[3]); vibrate();
};
$('#quick-dates').onclick = (e) => { if (e.target.dataset.n) { $('#f-date').value = plusDays(+e.target.dataset.n); vibrate(); } };
$('#fab').onclick = () => openItem();

function openItem(item = null) {
  editing = item;
  $('#item-title').textContent = item ? 'Modifier' : 'Ajouter un produit';
  $('#scan-zone').hidden = !!item; $('#quick-items').hidden = !!item; $('#item-delete').hidden = !item;
  $('#item-save').textContent = item ? 'Enregistrer' : 'Ajouter';
  $('#f-name').value = item?.name || ''; $('#f-date').value = item?.expires_on || ''; $('#f-note').value = item?.note || '';
  setSeg('#f-kind', (kind = item?.date_kind || 'dlc')); setSeg('#f-loc', (loc = item?.location || 'fridge'));
  $('#f-qty').value = qty = item?.quantity || 1;
  setProduct(item ? { name: item.name, image_url: item.image_url, barcode: item.barcode } : null);
  status('');
  openSheet('#sheet-item');
}
function setProduct(p) {
  img = p?.image_url || null; $('#item-form').dataset.code = p?.barcode || '';
  $('#product-preview').hidden = !p?.barcode || !!editing;
  if (p?.barcode) { $('#pp-img').src = img || 'icons/icon-192.png'; $('#pp-name').textContent = p.name || 'Produit inconnu'; $('#pp-code').textContent = p.barcode; }
}
const status = (msg, ok) => { const s = $('#scan-status'); s.textContent = msg; s.classList.toggle('ok', !!ok); };
$('#sheet-item').addEventListener('close', stopScan);

$('#item-form').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('#f-name').value.trim(), date = $('#f-date').value;
  if (!name) { $('#f-name').focus(); return toast('Indique le nom du produit'); }
  if (!date) { $('#f-date').focus(); return toast('Choisis une date de péremption'); }
  const code = $('#item-form').dataset.code || null;
  const row = { name, expires_on: date, date_kind: kind, location: loc, quantity: qty, note: $('#f-note').value.trim() || null, barcode: code, image_url: img };
  $('#item-save').disabled = true;
  try {
    if (editing) await sb.from('items').update(row).eq('id', editing.id).throwOnError();
    else await sb.from('items').insert({ ...row, household_id: S.hid }).throwOnError();
    if (code) { const p = store.get('fz-products') || {}; p[code] = { name, image_url: img, location: loc, date_kind: kind }; store.set('fz-products', p); }
    $('#sheet-item').close(); vibrate(20);
    toast(editing ? 'Modifié ✓' : `${name} ajouté ✓`);
    await loadHousehold(); render();
  } catch (err) { fail(err); } finally { $('#item-save').disabled = false; }
};
$('#item-delete').onclick = async () => {
  const it = editing; $('#sheet-item').close();
  try {
    await sb.from('items').delete().eq('id', it.id).throwOnError();
    S.items = S.items.filter((i) => i.id !== it.id); render();
    toast('Produit supprimé', 'Annuler', () => restore({ ...it }, true));
  } catch (e) { fail(e); }
};

// Scan : BarcodeDetector natif (Android) sinon polyfill zxing-wasm (iOS/Safari, bien plus fiable que ZXing-js sur les EAN)
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let detectorP = null;
function getDetector() {
  return (detectorP ||= (async () => {
    if ('BarcodeDetector' in window) {
      try { if ((await BarcodeDetector.getSupportedFormats()).includes('ean_13')) return new BarcodeDetector({ formats: FORMATS }); } catch {}
    }
    const { BarcodeDetector: Poly } = await import('https://cdn.jsdelivr.net/npm/barcode-detector@3.0.8/ponyfill/+esm');
    return new Poly({ formats: FORMATS });
  })().catch((e) => { detectorP = null; throw e; }));
}
getDetector().catch(() => {});
$('#btn-scan').onclick = async () => {
  if (scanner) return stopScan();
  const s = (scanner = { stream: null, timer: 0 });
  $('#scan-box').hidden = false; $('#btn-scan span').textContent = 'Arrêter'; status('Vise le code-barres');
  try {
    const [det, stream] = await Promise.all([getDetector(), navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })]);
    s.stream = stream; if (scanner !== s) return stopTracks(stream);
    const track = stream.getVideoTracks()[0];
    try { if (track.getCapabilities?.().focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch {}
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: stream });
    video.setAttribute('playsinline', ''); $('#reader').replaceChildren(video); await video.play();
    const tick = async () => {
      if (scanner !== s) return;
      try {
        const [hit] = await det.detect(video);
        if (hit && scanner === s) { stopScan(); return onCode(hit.rawValue); }
      } catch {}
      s.timer = setTimeout(tick, 120);
    };
    tick();
  } catch (e) {
    stopScan();
    status(e?.name === 'NotAllowedError' || e?.name === 'NotFoundError' ? "Impossible d'accéder à la caméra. Autorise-la dans les réglages, ou utilise « Photo »." : 'Le scanner ne se charge pas. Vérifie ta connexion, ou utilise « Photo ».');
  }
};
$('#scan-file').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  status('Analyse de la photo…');
  try {
    const det = await getDetector(), [hit] = await det.detect(await createImageBitmap(f));
    if (!hit) throw new Error('none'); onCode(hit.rawValue);
  } catch { status('Aucun code-barres lisible sur cette photo.'); }
};
const stopTracks = (st) => st?.getTracks().forEach((t) => t.stop());
function stopScan() {
  const s = scanner; scanner = null;
  if (s) { clearTimeout(s.timer); stopTracks(s.stream); }
  $('#reader').replaceChildren();
  $('#scan-box').hidden = true; $('#btn-scan span').textContent = 'Scanner';
}
async function onCode(code) {
  vibrate(60);
  const known = (store.get('fz-products') || {})[code] || S.items.find((i) => i.barcode === code);
  if (known) return fillFrom({ barcode: code, name: known.name, image_url: known.image_url, location: known.location, date_kind: known.date_kind }, 'Produit reconnu ✓');
  status('Recherche du produit…');
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name_fr,product_name,brands,image_front_small_url,categories_tags`);
    const j = await r.json(); if (j.status !== 1) throw new Error('unknown');
    const p = j.product, cats = (p.categories_tags || []).join(' ');
    const name = [p.product_name_fr || p.product_name, p.brands?.split(',')[0]?.trim()].filter(Boolean).join(' · ');
    const location = /frozen|surgel/.test(cats) ? 'freezer' : /dair|meat|fish|fresh|yogurt|chees|dessert|ham|charcut/.test(cats) ? 'fridge' : 'pantry';
    fillFrom({ barcode: code, name, image_url: p.image_front_small_url?.startsWith('https://') ? p.image_front_small_url : null, location }, 'Trouvé ✓ Indique la date');
  } catch {
    setProduct({ barcode: code, name: '' });
    status('Produit inconnu : tape son nom.'); $('#f-name').focus();
  }
}
function fillFrom(p, msg) {
  setProduct(p); $('#f-name').value = p.name || '';
  if (p.location) setSeg('#f-loc', (loc = p.location));
  if (p.date_kind) setSeg('#f-kind', (kind = p.date_kind));
  status(msg, true);
  $('#f-date').focus(); try { $('#f-date').showPicker(); } catch {}
}

// ---------- Courses ----------
$('#shop-form').onsubmit = (e) => { e.preventDefault(); const v = $('#shop-input').value.trim(); if (v) { $('#shop-input').value = ''; addShop(v); } };
async function addShop(label) {
  try {
    await sb.from('shopping_items').insert({ household_id: S.hid, label: label.slice(0, 120) }).throwOnError();
    await loadHousehold(); render(); if (S.view !== 'shop') toast('Ajouté aux courses 🛒');
  } catch (e) { fail(e); }
}
function renderShop() {
  const list = [...S.shop].sort((a, b) => a.done - b.done);
  $('#shop-list').innerHTML = list.length ? `<div class="card-list">${list.map((s) => `<button class="row ${s.done ? 'done' : ''}" data-id="${s.id}">
    <span class="check">${icon('check')}</span><span class="main"><span class="title">${esc(s.label)}</span></span></button>`).join('')}</div>`
    : `<div class="empty"><div class="big">🛒</div><h3>Liste vide</h3><p>Quand tu finis un produit, Frigo Zéro te propose de l'ajouter ici.</p></div>`;
  $('#shop-clear').hidden = !S.shop.some((s) => s.done);
}
$('#shop-list').onclick = async (e) => {
  const row = e.target.closest('.row'); if (!row) return;
  const s = S.shop.find((x) => x.id === row.dataset.id); s.done = !s.done; vibrate(); render();
  try { await sb.from('shopping_items').update({ done: s.done }).eq('id', s.id).throwOnError(); } catch (err) { fail(err); }
};
$('#shop-clear').onclick = async () => {
  const ids = S.shop.filter((s) => s.done).map((s) => s.id);
  S.shop = S.shop.filter((s) => !s.done); render();
  try { await sb.from('shopping_items').delete().in('id', ids).throwOnError(); } catch (e) { fail(e); }
};

// ---------- Bilan ----------
function renderStats() {
  const eaten = S.log.filter((l) => l.outcome === 'eaten').length, wasted = S.log.length - eaten;
  const pct = S.log.length ? Math.round((eaten / S.log.length) * 100) : 100;
  const top = Object.entries(S.log.filter((l) => l.outcome === 'wasted').reduce((m, l) => ((m[l.name] = (m[l.name] || 0) + 1), m), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#stats').innerHTML = `<div class="stat-hero"><div class="ring" style="--p:${pct}"><div>${pct}%</div></div>
    <p>${S.log.length ? 'des produits sauvés ces 30 derniers jours' : 'Marque tes produits comme consommés ou jetés pour voir ton bilan.'}</p></div>
    <div class="stat-split"><div><b>${eaten}</b><span>consommés</span></div><div><b style="color:var(--red)">${wasted}</b><span>jetés</span></div></div>
    ${top.length ? `<div class="section-h">Ce que le foyer jette le plus</div><div class="card-list">${top.map(([n, c]) =>
      `<div class="row"><span class="main"><span class="title">${esc(n)}</span></span><span class="badge r">${c}×</span></div>`).join('')}</div>
      <p class="note">Astuce : achète ces produits en plus petite quantité, ou congèle-les dès l'achat.</p>` : ''}`;
}

// ---------- Foyer ----------
function renderHome() {
  const hh = S.households.find((h) => h.id === S.hid);
  $('#members').innerHTML = S.members.map((m) => `<div class="setting">${avatar(m.profiles)}<span class="main"><b>${esc(m.profiles?.display_name || 'Membre')}</b>${m.user_id === S.user.id ? ' <span class="sub">(toi)</span>' : ''}</span>
    ${m.role === 'owner' ? '<span class="role">Admin</span>' : hh?.role === 'owner' ? `<button class="icon-btn" data-kick="${m.user_id}" aria-label="Retirer du foyer">${icon('x')}</button>` : ''}</div>`).join('');
  $('#btn-rename').hidden = hh?.role !== 'owner';
  $('#s-days').value = S.profile.notify_days;
  $('#s-hour').value = (S.profile.notify_hour || '18:00').slice(0, 5);
  $('#me-name').textContent = S.profile.display_name || '';
  $('#me-email').textContent = S.user.email || '';
  $('#me-avatar2').outerHTML = avatar(S.profile, 'me-avatar2');
  pushUI();
}
$('#members').onclick = async (e) => {
  const id = e.target.closest('[data-kick]')?.dataset.kick; if (!id) return;
  const m = S.members.find((x) => x.user_id === id);
  if (!confirm(`Retirer ${m.profiles?.display_name || 'ce membre'} du foyer ?`)) return;
  try { await sb.from('household_members').delete().eq('household_id', S.hid).eq('user_id', id).throwOnError(); await loadHousehold(); render(); } catch (err) { fail(err); }
};
$('#btn-invite').onclick = async () => {
  try {
    const { data } = await sb.from('household_invites').insert({ household_id: S.hid }).select('code').single().throwOnError();
    const url = `${BASE_URL}?invite=${encodeURIComponent(data.code)}`;
    const text = `Rejoins « ${S.households.find((h) => h.id === S.hid).name} » sur Frigo Zéro pour gérer le frigo ensemble 🧊`;
    if (navigator.share) await navigator.share({ title: 'Frigo Zéro', text, url }).catch(() => {});
    else { await navigator.clipboard.writeText(`${text}\n${url}`); toast("Lien d'invitation copié 📋"); }
  } catch (e) { fail(e); }
};
$('#btn-rename').onclick = async () => {
  const hh = S.households.find((h) => h.id === S.hid);
  const name = prompt('Nom du foyer', hh.name)?.trim(); if (!name || name === hh.name) return;
  try { await sb.from('households').update({ name: name.slice(0, 60) }).eq('id', S.hid).throwOnError(); hh.name = name; render(); } catch (e) { fail(e); }
};
$('#btn-leave').onclick = async () => {
  const alone = S.members.length <= 1;
  if (!confirm(alone ? 'Tu es seul dans ce foyer : le quitter supprimera tous ses produits. Continuer ?' : "Quitter ce foyer ? Tu n'auras plus accès à son stock.")) return;
  try {
    if (alone) await sb.from('households').delete().eq('id', S.hid).throwOnError();
    else await sb.from('household_members').delete().eq('household_id', S.hid).eq('user_id', S.user.id).throwOnError();
    store.set('fz-hid', null); subscribedTo = null; S.view = 'stock';
    await loadHouseholds(); await loadHousehold(); render(); toast('Foyer quitté');
  } catch (e) { fail(e); }
};
$('#btn-delete-account').onclick = async () => {
  if (!confirm('Supprimer définitivement ton compte et tes données ? Les foyers partagés restent pour les autres membres.')) return;
  if (prompt('Tape SUPPRIMER pour confirmer') !== 'SUPPRIMER') return;
  try { await rpc('delete_my_account'); localStorage.clear(); await sb.auth.signOut(); location.reload(); } catch (e) { fail(e); }
};
$('#btn-export').onclick = async () => {
  try {
    const [items, shop, log] = await Promise.all(['items', 'shopping_items', 'consumption_log'].map((t) => sb.from(t).select('*').then((r) => r.data)));
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), profile: S.profile, households: S.households, items, shopping_items: shop, consumption_log: log }, null, 2)], { type: 'application/json' });
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `frigo-zero-${iso(new Date())}.json` }).click();
  } catch (e) { fail(e); }
};
const saveProfile = async (patch) => { Object.assign(S.profile, patch); try { await sb.from('profiles').update(patch).eq('id', S.user.id).throwOnError(); render(); } catch (e) { fail(e); } };
$('#s-days').onchange = (e) => saveProfile({ notify_days: +e.target.value });
$('#s-hour').onchange = (e) => e.target.value && saveProfile({ notify_hour: e.target.value });

// Choix / création de foyer
$('#hh-switch').onclick = () => {
  $('#hh-list').innerHTML = S.households.map((h) => `<button class="setting" data-hid="${h.id}">${icon('home')}<span class="main">${esc(h.name)}</span>${h.id === S.hid ? `<span class="check-mark">${icon('check')}</span>` : ''}</button>`).join('');
  openSheet('#sheet-hh');
};
$('#hh-list').onclick = async (e) => {
  const id = e.target.closest('[data-hid]')?.dataset.hid; if (!id) return;
  $('#sheet-hh').close(); if (id === S.hid) return;
  S.hid = id; S.items = []; S.shop = []; S.members = []; S.log = []; render();
  try { await loadHousehold(); render(); } catch (err) { fail(err); }
};
$('#hh-create').onsubmit = async (e) => {
  e.preventDefault(); const name = $('#hh-new').value.trim(); if (!name) return;
  try {
    const id = await rpc('create_household', { p_name: name.slice(0, 60) });
    store.set('fz-hid', id); $('#hh-new').value = ''; $('#sheet-hh').close();
    await loadHouseholds(); await loadHousehold(); render(); toast(`Foyer « ${name} » créé`);
  } catch (err) { fail(err); }
};

// Invitation reçue
async function handleInvite() {
  const code = store.get('fz-invite'); if (!code) return;
  store.set('fz-invite', null);
  try {
    const [inv] = await rpc('invite_preview', { p_code: code });
    if (!inv) return toast('Invitation expirée ou invalide');
    $('#join-title').textContent = `Rejoindre « ${inv.household_name} »`;
    $('#join-text').textContent = `${inv.inviter || "Quelqu'un"} t'invite à partager son frigo. Vous verrez les mêmes produits et la même liste de courses.`;
    $('#join-ok').onclick = async () => {
      $('#sheet-join').close();
      try {
        const id = await rpc('join_household', { p_code: code });
        store.set('fz-hid', id); S.view = 'stock';
        await loadHouseholds(); await loadHousehold(); render(); toast(`Bienvenue dans « ${inv.household_name} » 🎉`);
      } catch (e) { fail(e); }
    };
    openSheet('#sheet-join');
  } catch (e) { fail(e); }
}

// Import des données de la première version (stockées sur le téléphone)
function offerLegacyImport() {
  const old = store.get('frigo-zero-v1'); if (!old?.items?.length) return;
  const b = $('#import-banner'); b.hidden = false;
  b.innerHTML = `<span class="grow">📦 ${old.items.length} produit(s) de l'ancienne version trouvés sur ce téléphone.</span><button class="btn small">Importer</button>`;
  b.querySelector('button').onclick = async () => {
    const map = { frigo: 'fridge', congel: 'freezer', placard: 'pantry', autre: 'other' };
    const rows = old.items.filter((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.date)).map((i) => ({ household_id: S.hid, name: String(i.name).slice(0, 120), expires_on: i.date,
      location: map[i.loc] || 'other', quantity: Math.max(1, Math.min(999, +i.qty || 1)), date_kind: i.kind === 'ddm' ? 'ddm' : 'dlc', note: i.note || null,
      barcode: /^\d{6,14}$/.test(i.code || '') ? i.code : null, image_url: /^https:\/\//.test(i.img || '') ? i.img : null }));
    try { await sb.from('items').insert(rows).throwOnError(); localStorage.removeItem('frigo-zero-v1'); b.hidden = true; await loadHousehold(); render(); toast('Import terminé ✓'); }
    catch (e) { fail(e); }
  };
}

// ---------- Notifications push (Android, et iPhone 16.4+ avec l'app installée) ----------
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function pushUI() {
  const t = $('#push-toggle'), sub = $('#push-sub');
  if (isIOS && !standalone) { t.disabled = true; t.checked = false; sub.textContent = "Installe d'abord l'app sur l'écran d'accueil"; return; }
  if (!pushSupported) { t.disabled = true; sub.textContent = 'Non supporté par ce navigateur'; return; }
  if (Notification.permission === 'denied') { t.disabled = true; t.checked = false; sub.textContent = 'Bloquées dans les réglages du téléphone'; return; }
  t.disabled = false; t.checked = Notification.permission === 'granted' && store.get('fz-push') === true;
  sub.textContent = t.checked ? `Chaque jour à ${(S.profile.notify_hour || '18:00').slice(0, 5)}` : 'Désactivées';
}
$('#push-toggle').onchange = async (e) => {
  try {
    if (e.target.checked) {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('denied');
      await ensurePush(); store.set('fz-push', true); toast('Rappels activés 🔔');
    } else {
      const s = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (s) { await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint); await s.unsubscribe(); }
      store.set('fz-push', false);
    }
  } catch (err) { if (err.message !== 'denied') fail(err); }
  pushUI();
};
async function ensurePush() {
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const s = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  const j = s.toJSON();
  await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: S.user.id }).throwOnError();
}

// ---------- Installation ----------
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  const b = $('#install-banner'); b.hidden = false;
  b.innerHTML = `<span class="grow">📲 Installe Frigo Zéro pour l'avoir sous la main et recevoir les rappels.</span><button class="btn small">Installer</button>`;
  b.querySelector('button').onclick = () => { e.prompt(); b.hidden = true; };
});
if (isIOS && !standalone && !store.get('fz-ios-hint')) {
  const b = $('#install-banner'); b.hidden = false;
  b.innerHTML = `<span class="grow">📲 Touche <b>Partager</b> puis <b>« Sur l'écran d'accueil »</b> pour installer l'app et recevoir les rappels.</span><button class="icon-btn" aria-label="Fermer">${icon('x')}</button>`;
  b.querySelector('button').onclick = () => { b.hidden = true; store.set('fz-ios-hint', true); };
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
