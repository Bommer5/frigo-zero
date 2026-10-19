-- Catégories propres à chaque foyer (Viande, Alcool…), choisies à l'ajout d'un produit.
create table public.household_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  emoji text check (char_length(emoji) <= 16),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.household_categories (household_id, position);
alter table public.household_categories enable row level security;
create policy "cat_select" on public.household_categories for select to authenticated using (public.is_member(household_id));
create policy "cat_insert" on public.household_categories for insert to authenticated with check (public.is_member(household_id));
create policy "cat_update" on public.household_categories for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "cat_delete" on public.household_categories for delete to authenticated using (public.is_member(household_id));

alter table public.items add column category_id uuid references public.household_categories on delete set null;
alter table public.household_products add column category_id uuid references public.household_categories on delete set null;
alter publication supabase_realtime add table public.household_categories;
