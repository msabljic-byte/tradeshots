-- Run before or with updated notify_playbook_importers (sync inserts set is_new = true).

alter table public.screenshots
  add column if not exists is_new boolean not null default false;

comment on column public.screenshots.is_new is
  'True when this row was just synced/copied from a shared playbook; UI can highlight until cleared.';

create index if not exists screenshots_is_new_idx
  on public.screenshots (user_id, is_new)
  where is_new = true;
