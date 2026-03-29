-- Run before replacing `notify_playbook_update` with the two-argument version.
-- Separates debounce: "new screenshot(s)" vs "content updated" per shared playbook.

alter table public.notifications
  add column if not exists notify_kind text;

comment on column public.notifications.notify_kind is
  'Debounce bucket: new_content (uploads) vs content_edit (notes/annotations/attributes/moves). Null treated as content_edit.';

create index if not exists notifications_source_kind_created_idx
  on public.notifications (source_folder_id, notify_kind, created_at desc);
