// Assistant vocal : la phrase de l'utilisateur (texte reconnu par le téléphone, ou audio brut) est transformée
// par Gemini (offre gratuite de Google AI Studio) en actions sur l'app : ajouter, consommer, liste de courses, recettes…
// Les actions sont renvoyées à l'app, qui les exécute avec les droits de l'utilisateur (RLS).
// Réservé aux utilisateurs présents dans ai_access ; limite quotidienne via ai_usage (kind = 'assistant').
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const DAILY_LIMIT = 100;
// Du plus capable au plus léger : on passe au suivant si un modèle est saturé ou indisponible.
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

const SYSTEM = `Tu es l'assistant vocal de Frigo Zéro, une app anti-gaspillage qui gère le stock (frigo, congélateur, placard)
et la liste de courses d'un foyer. L'utilisateur te parle en français, souvent de façon familière.
Tu transformes sa demande en actions. Tu reçois le stock et la liste de courses actuels avec leurs identifiants.

Actions possibles (champ "type") :
- "add_item" : ajouter au stock. Champs : name (nom simple, majuscule au début), quantity (entier), location ("fridge" | "freezer" | "pantry" | "other"),
  days (jours avant péremption : estime une durée réaliste si l'utilisateur ne la donne pas, ex. baguette 2, lait 7, yaourts 14, viande 3, surgelés 90),
  date_kind ("dlc" pour le frais, "ddm" pour l'épicerie sèche et les conserves).
- "consume" : l'utilisateur a mangé / utilisé / bu un produit du stock. Champs : item_id, quantity, outcome ("eaten" ou "wasted" s'il l'a jeté).
- "delete_item" : retirer un produit du stock sans le compter comme mangé ni jeté (erreur de saisie). Champ : item_id.
- "update_item" : corriger un produit. Champs : item_id et ce qui change parmi quantity, days, location.
- "add_shop" : ajouter à la liste de courses. Champ : label (avec la quantité si donnée, ex. "Lait (2)").
- "check_shop" : cocher (acheté) un élément de la liste. Champ : shop_id.
- "remove_shop" : supprimer un élément de la liste. Champ : shop_id.
- "recipes" : l'utilisateur veut des idées de recettes ou décrit une envie de plat. Champ : wish (son envie, ou "" s'il veut être surpris).
- "navigate" : ouvrir un écran. Champ : view ("stock" | "shop" | "stats" | "recipes" | "home").

Règles :
- "J'ai acheté X" = add_item (et si X est sur la liste de courses non cochée, ajoute aussi check_shop pour cet élément).
- "J'ai mangé / fini / utilisé X" = consume. "J'ai jeté X" = consume avec outcome "wasted".
- "Il faut acheter / rajoute aux courses X" = add_shop.
- Pour consume, delete_item, update_item, check_shop et remove_shop, utilise UNIQUEMENT des identifiants présents dans les listes reçues.
  Si plusieurs lots du même produit existent, prends celui qui périme le plus tôt. Ne consomme pas plus que la quantité disponible.
- Si le produit mentionné ne correspond pas exactement à un produit de la liste mais que tu penses que c'est le même
  (ex. "lait" pour "Lait demi-écrémé Campina", "yaourt" pour "Skyr nature"), ou si la demande est ambiguë,
  NE L'EXÉCUTE PAS : mets ces actions dans "confirm" avec une question courte (ex. "Tu parles du Lait demi-écrémé Campina ?").
  Les actions sûres vont quand même dans "actions".
- Si le produit à consommer n'existe pas du tout dans le stock, ne l'invente pas : dis-le dans "reply".
- Si "pending" est fourni, l'utilisateur répond à ta question précédente : s'il confirme (oui, ouais, c'est ça…), renvoie
  ces actions dans "actions" ; s'il refuse, ne les renvoie pas ; s'il précise autre chose, adapte.
- "reply" : une phrase courte et naturelle, à l'oral, qui résume ce que tu fais (ex. "C'est noté, 3 baguettes ajoutées au placard.").
  Pas d'emoji, pas de liste.
- "heard" : ce que tu as compris de la phrase de l'utilisateur, écrit proprement.
Réponds UNIQUEMENT avec un objet JSON valide :
{"heard":"","reply":"","actions":[{"type":"", ...}],"confirm":{"question":"","actions":[]} ou null}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const auth = req.headers.get('authorization') ?? '';
  const { data: { user } } = await admin.auth.getUser(auth.replace('Bearer ', ''));
  if (!user) return json({ error: 'Non connecté' }, 401);

  const [{ data: access }, { data: isAdmin }] = await Promise.all([
    admin.from('ai_access').select('user_id').eq('user_id', user.id).maybeSingle(),
    admin.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
  ]);
  if (!access) return json({ error: "L'assistant n'est pas activé pour ton compte." }, 403);

  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { count } = await admin.from('ai_usage').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('kind', 'assistant').gte('created_at', since);
  if (!isAdmin && (count ?? 0) >= DAILY_LIMIT) return json({ error: `Limite atteinte (${DAILY_LIMIT} demandes par jour). Reviens demain.` }, 429);

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? '').trim().slice(0, 600);
  const audio = typeof body.audio === 'string' && body.audio.length < 4_000_000 ? body.audio : '';
  if (!text && !audio) return json({ error: "Je n'ai rien entendu." }, 400);

  // Lecture du foyer avec les droits de l'utilisateur (RLS : seulement ses foyers).
  const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const [items, shop] = await Promise.all([
    asUser.from('items').select('id, name, quantity, location, expires_on').eq('household_id', body.household_id).order('expires_on').limit(150),
    asUser.from('shopping_items').select('id, label, done').eq('household_id', body.household_id).order('created_at').limit(100),
  ]);
  if (items.error || shop.error) return json({ error: (items.error || shop.error)!.message }, 400);

  const today = new Date().toISOString().slice(0, 10);
  const context = `Date du jour : ${today}\n\nStock :\n` +
    (items.data.map((i) => `- id=${i.id} | ${i.name} | ×${i.quantity} | ${i.location} | périme le ${i.expires_on}`).join('\n') || '(vide)') +
    `\n\nListe de courses :\n` +
    (shop.data.map((s) => `- id=${s.id} | ${s.label}${s.done ? ' (coché)' : ''}`).join('\n') || '(vide)') +
    (body.pending ? `\n\npending (ta question précédente) : ${JSON.stringify(body.pending).slice(0, 3000)}` : '');
  const parts: unknown[] = [{ text: context }];
  if (text) parts.push({ text: `L'utilisateur dit : « ${text} »` });
  else parts.push({ text: "Voici ce que dit l'utilisateur :" }, { inline_data: { mime_type: String(body.mime || 'audio/webm').split(';')[0], data: audio } });

  let out: { heard?: string; reply?: string; actions?: unknown[]; confirm?: unknown } | null = null, model = '';
  for (const m of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(25_000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 2000, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }).catch(() => null);
    if (!r) continue; // délai dépassé : modèle suivant
    const res = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('gemini', m, r.status, JSON.stringify(res).slice(0, 300)); continue; }
    try {
      out = JSON.parse(res?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') || '{}');
      model = m;
      break;
    } catch { console.error('gemini json', m); }
  }
  if (!out) return json({ error: "L'assistant ne répond pas pour le moment, réessaie dans un instant." }, 502);

  // On ne garde que des actions connues, avec des identifiants qui existent vraiment dans le foyer.
  const itemIds = new Set(items.data.map((i) => i.id)), shopIds = new Set(shop.data.map((s) => s.id));
  const valid = (a: Record<string, unknown>) => {
    switch (a?.type) {
      case 'add_item': return typeof a.name === 'string' && a.name.trim() !== '';
      case 'consume': case 'delete_item': case 'update_item': return itemIds.has(a.item_id as string);
      case 'check_shop': case 'remove_shop': return shopIds.has(a.shop_id as string);
      case 'add_shop': return typeof a.label === 'string' && a.label.trim() !== '';
      case 'recipes': case 'navigate': return true;
      default: return false;
    }
  };
  const actions = (Array.isArray(out.actions) ? out.actions : []).filter(valid).slice(0, 30);
  const c = out.confirm as { question?: string; actions?: unknown[] } | null;
  const confirm = c?.question && Array.isArray(c.actions) && c.actions.filter(valid).length
    ? { question: String(c.question), actions: c.actions.filter(valid).slice(0, 30) } : null;

  await admin.from('ai_usage').insert({ user_id: user.id, kind: 'assistant' });
  return json({ heard: String(out.heard ?? text), reply: String(out.reply ?? ''), actions, confirm, model });
});
