// Recettes IA : propose des recettes à partir du stock du foyer (+ une envie facultative).
// Réservé aux utilisateurs présents dans ai_access ; limite quotidienne via ai_usage.
// Modèles gratuits d'OpenRouter, avec bascule automatique de l'un à l'autre.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const DAILY_LIMIT = 15;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
type Recipe = { title: string; ingredients: { name: string; qty: string; have: boolean }[] };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

// Liste des modèles gratuits, rafraîchie toutes les 6 h (ils changent souvent).
let freeModels: string[] = [];
let freeModelsAt = 0;
// Modèles testés comme fiables pour ce format (rapides, JSON correct), essayés en premier.
const PREFERRED = /minimax|lfm|llama-3\.3-70b|gemini|deepseek|qwen.*(72|235)|mistral-small|gpt-oss/i;
async function getFreeModels(): Promise<string[]> {
  if (freeModels.length && Date.now() - freeModelsAt < 6 * 3600e3) return freeModels;
  const r = await fetch('https://openrouter.ai/api/v1/models');
  const { data } = await r.json();
  const free = (data as { id: string; pricing: { prompt: string; completion: string }; context_length: number }[])
    .filter((m) => m.id.endsWith(':free') && +m.pricing.prompt === 0 && +m.pricing.completion === 0 && m.context_length >= 8000)
    .map((m) => m.id);
  freeModels = [...free.filter((id) => PREFERRED.test(id)), ...free.filter((id) => !PREFERRED.test(id))];
  freeModelsAt = Date.now();
  return freeModels;
}

const SYSTEM = `Tu es un chef cuisinier anti-gaspillage. Tu proposes des recettes simples et réalistes,
en utilisant en priorité les produits qui périment bientôt.
Règles :
- Écris UNIQUEMENT en français, avec l'alphabet latin (aucun mot dans une autre langue ou un autre alphabet).
- Donne une quantité précise pour CHAQUE ingrédient, adaptée au nombre de personnes (ex. "200 g", "2", "10 cl", "1 c. à soupe", "1 pincée").
- "have": true si l'ingrédient vient du stock ou fait partie des basiques toujours disponibles (sel, poivre, huile, beurre,
  farine, sucre, épices courantes, eau) ; false seulement s'il faut l'acheter.
- Utilise le nom simple de l'ingrédient (ex. "Lait" plutôt que "Lait entier - Campina").
- Les étapes reprennent les quantités utiles.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"recipes":[{"title":"","emoji":"","minutes":0,"servings":0,"why":"une phrase",
"ingredients":[{"name":"","qty":"","have":true}],"steps":["étape courte"]}]}`;

// Certains modèles gratuits glissent des mots d'autres alphabets : on les retire.
const FOREIGN = /[\u0400-\u04ff\u0590-\u06ff\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const auth = req.headers.get('authorization') ?? '';
  const { data: { user } } = await admin.auth.getUser(auth.replace('Bearer ', ''));
  if (!user) return json({ error: 'Non connecté' }, 401);

  const [{ data: access }, { data: isAdmin }] = await Promise.all([
    admin.from('ai_access').select('user_id').eq('user_id', user.id).maybeSingle(),
    admin.from('app_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
  ]);
  if (!access) return json({ error: 'Les recettes IA ne sont pas activées pour ton compte.' }, 403);

  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { count } = await admin.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
  if (!isAdmin && (count ?? 0) >= DAILY_LIMIT) return json({ error: `Limite atteinte (${DAILY_LIMIT} demandes par jour). Reviens demain 🙂` }, 429);

  const body = await req.json().catch(() => ({}));
  const wish = String(body.wish ?? '').trim().slice(0, 300);
  const servings = Math.min(Math.max(+body.servings || 2, 1), 12);
  const howMany = Math.min(Math.max(+body.count || 3, 1), 5);

  // Lecture du stock avec les droits de l'utilisateur (RLS : seulement ses foyers).
  const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: items, error } = await asUser.from('items').select('name, expires_on, quantity, location')
    .eq('household_id', body.household_id).order('expires_on').limit(80);
  if (error) return json({ error: error.message }, 400);
  if (!items?.length) return json({ error: 'Ton frigo est vide : ajoute quelques produits d’abord.' }, 400);

  const today = new Date().toISOString().slice(0, 10);
  const stock = items.map((i) => {
    const d = Math.round((Date.parse(i.expires_on) - Date.parse(today)) / 864e5);
    return `- ${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''} (${d < 0 ? 'périmé' : d === 0 ? "périme aujourd'hui" : `périme dans ${d} j`}, ${i.location})`;
  }).join('\n');
  const prompt = `Mon stock :\n${stock}\n\n` +
    (wish ? `Mon envie : « ${wish} ». Respecte-la au mieux.\n` : 'Je n’ai pas d’idée : surprends-moi avec des recettes variées.\n') +
    `Propose ${howMany} recettes pour ${servings} personne(s). N'utilise pas les produits périmés.`;

  const all = await getFreeModels();
  if (!all.length) return json({ error: 'Aucun modèle gratuit disponible pour le moment.' }, 503);
  let recipes: Recipe[] = [], model = '';
  // Jusqu'à 3 essais, chacun avec un groupe de modèles différent.
  for (let attempt = 0; attempt < 3 && !recipes.length; attempt++) {
    const models = all.slice(attempt * 3, attempt * 3 + 3);
    if (!models.length) break;
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(30_000), // un modèle bloqué ne doit pas faire attendre l'utilisateur
      headers: {
        Authorization: `Bearer ${Deno.env.get('OPENROUTER_API_KEY')}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://bommer5.github.io/frigo-zero/',
        'X-Title': 'Frigo Zero',
      },
      body: JSON.stringify({
        models, // OpenRouter bascule sur le suivant si le premier est saturé
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
        temperature: wish ? 0.7 : 0.95,
        max_tokens: 4000,
        reasoning: { effort: 'low', exclude: true }, // modèles « qui réfléchissent » : réponse directe
      }),
    }).catch(() => null);
    if (!r) continue; // délai dépassé : groupe de modèles suivant
    const out = await r.json().catch(() => ({}));
    const text: string = (out?.choices?.[0]?.message?.content ?? '').replace(FOREIGN, '').replace(/ {2,}/g, ' ');
    try {
      const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}').recipes ?? [];
      recipes = parsed.filter((x: Recipe) => x?.title && Array.isArray(x.ingredients));
      model = out.model;
    } catch { console.error('openrouter', r.status, JSON.stringify(out).slice(0, 300)); }
  }
  if (!recipes.length) return json({ error: 'L’IA n’a pas répondu correctement, réessaie dans un instant.' }, 502);

  await admin.from('ai_usage').insert({ user_id: user.id });
  return json({ recipes: recipes.slice(0, 5), model, remaining: isAdmin ? null : DAILY_LIMIT - (count ?? 0) - 1 });
});
