// Envoie chaque jour, à l'heure choisie par l'utilisateur, un push listant les produits qui périment.
// Déclenchée toutes les 15 min par pg_cron (voir migrations/0002_reminders.sql).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

webpush.setVapidDetails('mailto:nathan23.brico@gmail.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

type Due = { user_id: string; local_date: string; endpoint: string; p256dh: string; auth: string; items: { name: string; days: number }[] };

const label = (d: number) => (d < 0 ? 'périmé' : d === 0 ? "aujourd'hui" : d === 1 ? 'demain' : `dans ${d} j`);

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 });

  const { data, error } = await admin.rpc('due_reminders');
  if (error) return new Response(error.message, { status: 500 });

  const notified = new Map<string, string>();
  for (const d of data as Due[]) {
    const expired = d.items.filter((i) => i.days < 0).length;
    const payload = JSON.stringify({
      title: expired ? `⚠️ ${expired} produit(s) périmé(s)` : `🍽️ ${d.items.length} produit(s) à manger vite`,
      body: d.items.slice(0, 4).map((i) => `${i.name} : ${label(i.days)}`).join('\n'),
    });
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, { TTL: 6 * 3600 });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('endpoint', d.endpoint);
    }
    notified.set(d.user_id, d.local_date);
  }
  for (const [id, day] of notified) await admin.from('profiles').update({ last_notified_on: day }).eq('id', id);
  return Response.json({ notified: notified.size });
});
