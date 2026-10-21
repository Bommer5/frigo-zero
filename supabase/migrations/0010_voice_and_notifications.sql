-- Assistant vocal (Gemini) et notifications quand un autre membre du foyer ajoute quelque chose.

-- Préférences : notification quand quelqu'un ajoute à la liste de courses / dans le stock, et bouton assistant.
alter table public.profiles
  add column notify_shop boolean not null default true,
  add column notify_stock boolean not null default false,
  add column ai_voice boolean not null default true;

-- Le compteur d'usage IA distingue les recettes et l'assistant (limites séparées).
alter table public.ai_usage add column kind text not null default 'recipes' check (kind in ('recipes', 'assistant'));
create index on public.ai_usage (user_id, kind, created_at);

-- À chaque ajout, appelle la fonction Edge notify-change (secret partagé du cron, stocké chiffré dans Vault).
create function public.notify_household_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://nradddwwyiftbwkrzmsv.supabase.co/functions/v1/notify-change',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := jsonb_build_object('table', tg_table_name, 'household_id', new.household_id,
      -- to_jsonb : les deux tables n'ont pas les mêmes colonnes (label / name), new.x planterait sur l'autre
      'name', coalesce(to_jsonb(new)->>'label', to_jsonb(new)->>'name'),
      'quantity', coalesce((to_jsonb(new)->>'quantity')::int, 1),
      'added_by', coalesce(to_jsonb(new)->>'added_by', auth.uid()::text)),
    timeout_milliseconds := 10000);
  return new;
end $$;
revoke execute on function public.notify_household_change from anon, authenticated, public;

create trigger shopping_items_notify after insert on public.shopping_items for each row execute function public.notify_household_change();
create trigger items_notify after insert on public.items for each row execute function public.notify_household_change();

-- Abonnements push des membres à prévenir (tous sauf l'auteur, selon leurs préférences).
create function public.change_recipients(p_household uuid, p_author uuid, p_table text)
returns table (endpoint text, p256dh text, auth text, author text, household text)
language sql stable security definer set search_path = '' as $$
  select s.endpoint, s.p256dh, s.auth,
    (select split_part(coalesce(a.display_name, 'Quelqu''un'), ' ', 1) from public.profiles a where a.id = p_author),
    (select h.name from public.households h where h.id = p_household)
  from public.household_members m
  join public.profiles p on p.id = m.user_id
  join public.push_subscriptions s on s.user_id = m.user_id
  where m.household_id = p_household and m.user_id is distinct from p_author
    and case when p_table = 'shopping_items' then p.notify_shop else p.notify_stock end;
$$;
revoke execute on function public.change_recipients from anon, authenticated, public;
grant execute on function public.change_recipients to service_role;
