-- Versions HD (1200 px) pour le zoom : <code>-hd.jpg et u/<uuid>-hd.jpg
drop policy "product_images_insert" on storage.objects;
create policy "product_images_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and name ~ '^[0-9]{6,14}(-hd)?\.jpg$');
drop policy "product_images_insert_user" on storage.objects;
create policy "product_images_insert_user" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and name ~ '^u/[0-9a-f-]{36}(-hd)?\.jpg$');
