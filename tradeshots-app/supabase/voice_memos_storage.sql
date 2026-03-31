-- Supabase Storage bucket + RLS policies for voice memos.
-- Path conventions:
--   source/<owner_user_id>/<screenshot_id>/<timestamp>.webm
--   private/<owner_user_id>/<screenshot_id>/<timestamp>.webm

insert into storage.buckets (id, name, public)
values ('voice-memos', 'voice-memos', true)
on conflict (id) do nothing;

drop policy if exists "voice memos read all authenticated" on storage.objects;
create policy "voice memos read all authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'voice-memos');

drop policy if exists "voice memos write own prefix" on storage.objects;
create policy "voice memos write own prefix"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'voice-memos'
    and split_part(name, '/', 2) = auth.uid()::text
  );

drop policy if exists "voice memos update own prefix" on storage.objects;
create policy "voice memos update own prefix"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'voice-memos'
    and split_part(name, '/', 2) = auth.uid()::text
  )
  with check (
    bucket_id = 'voice-memos'
    and split_part(name, '/', 2) = auth.uid()::text
  );

drop policy if exists "voice memos delete own prefix" on storage.objects;
create policy "voice memos delete own prefix"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'voice-memos'
    and split_part(name, '/', 2) = auth.uid()::text
  );
