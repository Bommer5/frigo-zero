-- Recettes IA : option réservée aux personnes à qui l'administrateur (Nathan) donne l'accès.
-- L'accès n'est modifiable que par un administrateur, via les fonctions admin_* ci-dessous.

-- Préférence de l'utilisateur : afficher ou non l'onglet Recettes (actif par défaut).
alter table public.profiles add column ai_tab boolean not null default true;

-- Administrateurs de l'app (pas de politique RLS : invisible et non modifiable depuis l'app).
create table public.app_admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.app_admins enable row level security;
insert into public.app_admins (user_id) select id from auth.users where email = 'nathan23.brico@gmail.com';

-- Qui a accès aux recettes IA.
create table public.ai_access (
  user_id uuid primary key references auth.users on delete cascade,
  granted_by uuid references auth.users on delete set null,
  granted_at timestamptz not null default now()
);
alter table public.ai_access enable row level security;
create policy "ai_access_select_own" on public.ai_access for select to authenticated using (user_id = (select auth.uid()));
-- Les administrateurs ont toujours accès.
insert into public.ai_access (user_id) select user_id from public.app_admins;

-- Compteur de demandes (limite quotidienne, lu uniquement par la fonction Edge).
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.ai_usage (user_id, created_at);
alter table public.ai_usage enable row level security;

create function public.is_app_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;
revoke execute on function public.is_app_admin from anon, public;
grant execute on function public.is_app_admin to authenticated;

-- Liste des utilisateurs pour l'écran d'administration.
create function public.admin_list_users()
returns table (id uuid, display_name text, email text, avatar_url text, created_at timestamptz, last_sign_in_at timestamptz, ai_allowed boolean, is_admin boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden'; end if;
  return query
    select u.id, p.display_name, u.email::text, p.avatar_url, u.created_at, u.last_sign_in_at,
      exists (select 1 from public.ai_access a where a.user_id = u.id),
      exists (select 1 from public.app_admins ad where ad.user_id = u.id)
    from auth.users u left join public.profiles p on p.id = u.id
    order by u.last_sign_in_at desc nulls last;
end $$;
revoke execute on function public.admin_list_users from anon, public;
grant execute on function public.admin_list_users to authenticated;

create function public.admin_set_ai(p_user uuid, p_allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_app_admin() then raise exception 'forbidden'; end if;
  if p_allowed then
    insert into public.ai_access (user_id, granted_by) values (p_user, auth.uid()) on conflict do nothing;
  else
    delete from public.ai_access where user_id = p_user;
  end if;
end $$;
revoke execute on function public.admin_set_ai from anon, public;
grant execute on function public.admin_set_ai to authenticated;
