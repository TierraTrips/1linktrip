-- 1LinkTrip: documents a host attaches to a page section ("Attach for guests").
-- Public-read bucket 'event-files'; a signed-in user can upload, see and delete only under <their user id>/…
-- Re-runnable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-files', 'event-files', true, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "event-files owner insert" on storage.objects;
drop policy if exists "event-files owner select" on storage.objects;
drop policy if exists "event-files owner delete" on storage.objects;
create policy "event-files owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "event-files owner select" on storage.objects for select to authenticated
  using (bucket_id = 'event-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "event-files owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
