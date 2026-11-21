-- =========================================================
-- Sol: image uploads for writers (book covers + chapter pictures)
--   Run in Supabase -> SQL Editor AFTER sql/07.
--   Safe to run again. One transaction: on any error nothing changes.
--
--   - New public bucket "sol-images": anyone can view the pictures
--     (they appear on book pages and in chapters).
--   - Only signed-in writers can upload, only into their own folder
--     (<their user id>/...), only images, max 5 MB each.
--     The site shrinks pictures before upload, so most are < 400 KB.
--   - Writers can replace or delete only their own files.
--   - Blocked writers (sql/07) can't upload.
--
--   Undo uploads (files stay):
--     drop policy "sol images upload own"  on storage.objects;
--     drop policy "sol images update own"  on storage.objects;
--     drop policy "sol images delete own"  on storage.objects;
--     drop policy "sol images read own"    on storage.objects;
-- =========================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sol-images', 'sol-images', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "sol images upload own" on storage.objects;
create policy "sol images upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sol-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.author_can_write()
  );

drop policy if exists "sol images update own" on storage.objects;
create policy "sol images update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'sol-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'sol-images' and (storage.foldername(name))[1] = auth.uid()::text
              and public.author_can_write());

drop policy if exists "sol images delete own" on storage.objects;
create policy "sol images delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'sol-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- a writer can list their own files; everyone else sees pictures
-- through the public link only (no listing of other people's folders)
drop policy if exists "sol images read own" on storage.objects;
create policy "sol images read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'sol-images' and (storage.foldername(name))[1] = auth.uid()::text);

do $$ begin
  raise notice 'Image uploads are on (bucket sol-images, 5 MB, own folder only).';
end $$;

commit;
