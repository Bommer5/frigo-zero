-- Rappels quotidiens : abonnements push à notifier maintenant.
-- Utilisateurs dont l'heure locale a dépassé notify_hour et pas encore notifiés aujourd'hui,
-- avec leurs produits (tous foyers) qui périment dans <= notify_days jours.
create function public.due_reminders()
returns table (user_id uuid, local_date date, endpoint text, p256dh text, auth text, items jsonb)
language sql stable security definer set search_path = '' as $$
  with u as (
    select p.id, (now() at time zone p.timezone)::date as local_date, p.notify_days
    from public.profiles p
    where (now() at time zone p.timezone)::time >= p.notify_hour
      and (p.last_notified_on is null or p.last_notified_on < (now() at time zone p.timezone)::date)
  ), due as (
    select u.id, u.local_date,
      jsonb_agg(jsonb_build_object('name', i.name, 'days', i.expires_on - u.local_date) order by i.expires_on) as items
    from u
    join public.household_members m on m.user_id = u.id
    join public.items i on i.household_id = m.household_id and i.expires_on - u.local_date <= u.notify_days
    group by u.id, u.local_date
  )
  select due.id, due.local_date, s.endpoint, s.p256dh, s.auth, due.items
  from due join public.push_subscriptions s on s.user_id = due.id;
$$;
revoke execute on function public.due_reminders from anon, authenticated, public;
grant execute on function public.due_reminders to service_role;

-- Toutes les 15 min, appelle la fonction Edge (secret partagé stocké chiffré dans Vault)
select cron.schedule('send-reminders', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://nradddwwyiftbwkrzmsv.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
$cron$);
