-- Produits nommés par le foyer (codes inconnus d'Open Food Facts) : partagés entre tous les membres.
create table public.household_products (
  household_id uuid not null references public.households on delete cascade,
  barcode text not null check (barcode ~ '^[0-9]{6,14}$'),
  name text not null check (char_length(name) between 1 and 120),
  image_url text check (image_url is null or image_url ~ '^https://'),
  location text check (location in ('fridge', 'freezer', 'pantry', 'other')),
  date_kind text check (date_kind in ('dlc', 'ddm')),
  updated_at timestamptz not null default now(),
  primary key (household_id, barcode)
);
alter table public.household_products enable row level security;
create policy "hp_select" on public.household_products for select to authenticated using (public.is_member(household_id));
create policy "hp_insert" on public.household_products for insert to authenticated with check (public.is_member(household_id));
create policy "hp_update" on public.household_products for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Photos prises dans l'app pour les produits sans photo : u/<uuid>.jpg
create policy "product_images_insert_user" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and name ~ '^u/[0-9a-f-]{36}\.jpg$');
