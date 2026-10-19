-- Copie des photos Open Food Facts (serveur lent : 5-10 s par image) dans un bucket public servi par le CDN Supabase.
-- Une photo par code-barres, jamais écrasée ni supprimée par les clients.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 512000, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "product_images_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and name ~ '^[0-9]{6,14}\.jpg$');
