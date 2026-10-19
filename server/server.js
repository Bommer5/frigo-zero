// Serveur de rappels push pour Frigo Zéro (nécessaire pour les notifications sur iPhone).
// Ne stocke que l'abonnement push + noms/dates des produits. Aucun compte.
const http = require('http');
const fs = require('fs');
const webpush = require('web-push');

const PORT = process.env.PORT || 8787;
const ORIGIN = process.env.ALLOW_ORIGIN || '*';
const DATA = process.env.DATA_FILE || __dirname + '/data.json';
const KEYS = process.env.KEYS_FILE || __dirname + '/vapid.json';

if (!fs.existsSync(KEYS)) fs.writeFileSync(KEYS, JSON.stringify(webpush.generateVAPIDKeys()));
const vapid = JSON.parse(fs.readFileSync(KEYS));
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapid.publicKey, vapid.privateKey);
console.log('Clé publique VAPID (à mettre dans config.js) :', vapid.publicKey);

let subs = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA)) : {};
const persist = () => fs.writeFileSync(DATA, JSON.stringify(subs));

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();
  if (req.method === 'GET' && req.url === '/vapid') return res.end(vapid.publicKey);
  if (req.method !== 'POST' || req.url !== '/sync') { res.statusCode = 404; return res.end(); }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 2e5) req.destroy(); });
  req.on('end', () => {
    try {
      const d = JSON.parse(body);
      if (!d.sub?.endpoint?.startsWith('https://')) throw 0;
      const prev = subs[d.sub.endpoint];
      subs[d.sub.endpoint] = { sub: d.sub, days: +d.days || 2, hour: /^\d\d:\d\d$/.test(d.hour) ? d.hour : '18:00',
        tz: d.tz || 'Europe/Brussels', items: (d.items || []).slice(0, 500), last: prev?.last };
      persist(); res.end('ok');
    } catch { res.statusCode = 400; res.end('bad'); }
  });
}).listen(PORT, () => console.log('Frigo Zéro push sur :' + PORT));

// Toutes les minutes : envoie le rappel du jour à l'heure choisie par chaque utilisateur
setInterval(async () => {
  for (const [ep, s] of Object.entries(subs)) {
    const now = new Date(), local = now.toLocaleString('sv-SE', { timeZone: s.tz }); // "2026-10-19 18:00:00"
    const [date, time] = local.split(' ');
    if (s.last === date || time.slice(0, 5) < s.hour) continue;
    s.last = date;
    const t0 = new Date(date + 'T00:00Z');
    const due = s.items.map(i => ({ ...i, n: Math.round((new Date(i.date + 'T00:00Z') - t0) / 864e5) })).filter(i => i.n <= s.days);
    if (!due.length) continue;
    const exp = due.filter(i => i.n < 0).length;
    const payload = JSON.stringify({
      title: exp ? `⚠️ ${exp} produit(s) périmé(s)` : `🍽️ ${due.length} produit(s) à manger vite`,
      body: due.sort((a, b) => a.n - b.n).slice(0, 4).map(i => `${i.name} : ${i.n < 0 ? 'périmé' : i.n === 0 ? "aujourd'hui" : i.n === 1 ? 'demain' : `dans ${i.n} j`}`).join('\n')
    });
    try { await webpush.sendNotification(s.sub, payload); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) delete subs[ep]; }
  }
  persist();
}, 60e3);
