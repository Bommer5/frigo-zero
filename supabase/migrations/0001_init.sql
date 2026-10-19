-- Frigo Zéro : schéma initial
-- Principe : tout appartient à un foyer (household). Row Level Security partout :
-- un utilisateur ne voit et ne modifie que les données des foyers dont il est membre.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- Tables ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  avatar_url text,
  notify_days smallint not null default 2 check (notify_days between 0 and 14),
  notify_hour time not null default '18:00',
  timezone text not null default 'Europe/Brussels',
  last_notified_on date,
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null references auth.users on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index on public.household_members (user_id);

create table public.household_invites (
  code text primary key default encode(extensions.gen_random_bytes(9), 'base64'),
  household_id uuid not null references public.households on delete cascade,
  created_by uuid not null references auth.users on delete cascade default auth.uid(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index on public.household_invites (household_id);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  barcode text check (barcode ~ '^[0-9]{6,14}$'),
  image_url text check (image_url is null or image_url ~ '^https://'),
  expires_on date not null,
  date_kind text not null default 'dlc' check (date_kind in ('dlc', 'ddm')),
  location text not null default 'fridge' check (location in ('fridge', 'freezer', 'pantry', 'other')),
  quantity int not null default 1 check (quantity between 1 and 999),
  note text check (char_length(note) <= 200),
  added_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.items (household_id, expires_on);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  done boolean not null default false,
  added_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.shopping_items (household_id);

create table public.consumption_log (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  outcome text not null check (outcome in ('eaten', 'wasted')),
  user_id uuid references auth.users on delete set null default auth.uid(),
  happened_on date not null default current_date
);
create index on public.consumption_log (household_id, happened_on);

create table public.push_subscriptions (
  endpoint text primary key check (endpoint ~ '^https://'),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index on public.push_subscriptions (user_id);

-- ---------- Helpers (security definer = évite la récursion RLS) ----------
create function public.is_member(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members where household_id = hid and user_id = auth.uid());
$$;

create function public.is_owner(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.household_members where household_id = hid and user_id = auth.uid() and role = 'owner');
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.items enable row level security;
alter table public.shopping_items enable row level security;
alter table public.consumption_log enable row level security;
alter table public.push_subscriptions enable row level security;

-- Profil : soi-même + les membres de mes foyers (pour afficher noms/avatars)
create policy "profiles_select" on public.profiles for select to authenticated using (
  id = (select auth.uid()) or exists (
    select 1 from public.household_members a join public.household_members b using (household_id)
    where a.user_id = (select auth.uid()) and b.user_id = profiles.id));
create policy "profiles_update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "households_select" on public.households for select to authenticated using (public.is_member(id));
create policy "households_update" on public.households for update to authenticated using (public.is_owner(id));
create policy "households_delete" on public.households for delete to authenticated using (public.is_owner(id));

create policy "members_select" on public.household_members for select to authenticated using (public.is_member(household_id));
-- quitter un foyer, ou en retirer quelqu'un si on est propriétaire
create policy "members_delete" on public.household_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_owner(household_id));

create policy "invites_select" on public.household_invites for select to authenticated using (public.is_member(household_id));
create policy "invites_insert" on public.household_invites for insert to authenticated with check (public.is_member(household_id));
create policy "invites_delete" on public.household_invites for delete to authenticated using (public.is_member(household_id));

create policy "items_all" on public.items for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "shopping_all" on public.shopping_items for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "log_select" on public.consumption_log for select to authenticated using (public.is_member(household_id));
create policy "log_insert" on public.consumption_log for insert to authenticated with check (public.is_member(household_id));

create policy "push_all" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- Fonctions métier ----------
-- Création d'un foyer : le créateur en devient propriétaire
create function public.create_household(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.households (name, created_by) values (p_name, auth.uid()) returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, auth.uid(), 'owner');
  return hid;
end $$;

-- Rejoindre un foyer avec un code d'invitation valide
create function public.join_household(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select household_id into hid from public.household_invites where code = p_code and expires_at > now();
  if hid is null then raise exception 'invalid_or_expired_invite'; end if;
  insert into public.household_members (household_id, user_id) values (hid, auth.uid()) on conflict do nothing;
  return hid;
end $$;

-- Infos minimales d'une invitation avant de rejoindre (nom du foyer + inviteur)
create function public.invite_preview(p_code text) returns table (household_name text, inviter text)
language sql stable security definer set search_path = '' as $$
  select h.name, p.display_name from public.household_invites i
  join public.households h on h.id = i.household_id
  left join public.profiles p on p.id = i.created_by
  where i.code = p_code and i.expires_at > now();
$$;

-- Consommer / jeter : décrémente ou supprime l'article + journalise, atomiquement
create function public.consume_item(p_item uuid, p_outcome text) returns void
language plpgsql security invoker set search_path = '' as $$
declare it public.items;
begin
  select * into it from public.items where id = p_item for update;
  if not found then raise exception 'not_found'; end if;
  insert into public.consumption_log (household_id, name, outcome) values (it.household_id, it.name, p_outcome);
  if it.quantity > 1 then update public.items set quantity = quantity - 1, updated_at = now() where id = p_item;
  else delete from public.items where id = p_item; end if;
end $$;

-- Nouveau compte : profil + premier foyer
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare hid uuid;
begin
  insert into public.profiles (id, display_name, avatar_url) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url');
  insert into public.households (name, created_by) values ('Mon frigo', new.id) returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, new.id, 'owner');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger items_touch before update on public.items for each row execute function public.touch_updated_at();

-- Les fonctions sensibles ne sont pas exposées aux anonymes
revoke execute on function public.create_household, public.join_household, public.invite_preview, public.consume_item from anon, public;
grant execute on function public.create_household, public.join_household, public.invite_preview, public.consume_item to authenticated;
revoke execute on function public.handle_new_user, public.is_member, public.is_owner from anon, public;
grant execute on function public.is_member, public.is_owner to authenticated;

-- Temps réel pour la synchro entre membres du foyer
alter publication supabase_realtime add table public.items, public.shopping_items, public.household_members;
