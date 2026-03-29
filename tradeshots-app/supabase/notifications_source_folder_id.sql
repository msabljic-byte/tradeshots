-- Run in Supabase SQL Editor before `notify_playbook_update.sql`.
-- Used to debounce "Playbook updated" fan-out per shared playbook root.

alter table public.notifications
  add column if not exists source_folder_id uuid references public.folders (id) on delete set null;

create index if not exists notifications_source_folder_created_idx
  on public.notifications (source_folder_id, created_at desc);

comment on column public.notifications.source_folder_id is
  'Shared playbook folder id; used to debounce importer notifications for the same playbook.';
