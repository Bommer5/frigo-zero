// Prévient les autres membres du foyer quand quelqu'un ajoute à la liste de courses ou dans le stock.
// Appelée par les déclencheurs SQL (voir migrations/0010_voice_and_notifications.sql), chacun choisit dans les réglages.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

webpush.setVapidDetails('mailto:nathan23.brico@gmail.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

type Recipient = { endpoint: string; p256dh: string; auth: string; author: string; household: string };

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 });
  const { table, household_id, name, quantity, added_by } = await req.json();
  if (!household_id || !name || !['items', 'shopping_items'].includes(table)) return new Response('bad request', { status: 400 });

  const { data, error } = await admin.rpc('change_recipients', { p_household: household_id, p_author: added_by, p_table: table });
  if (error) return new Response(error.message, { status: 500 });

  const shop = table === 'shopping_items';
  let sent = 0;
  for (const r of data as Recipient[]) {
    const payload = JSON.stringify({
      title: shop ? `🛒 Liste de courses · ${r.household}` : `🧊 Ajouté au frigo · ${r.household}`,
      body: `${r.author || "Quelqu'un"} a ajouté : ${name}${quantity > 1 ? ` ×${quantity}` : ''}`,
      // Une notification par foyer et par type : les ajouts rapprochés se remplacent au lieu de s'empiler.
      tag: `fz-${shop ? 'shop' : 'stock'}-${household_id}`,
      view: shop ? 'shop' : 'stock',
    });
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload, { TTL: 12 * 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('endpoint', r.endpoint);
    }
  }
  return Response.json({ sent });
});
