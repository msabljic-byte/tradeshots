-- Run before or with updated notify_playbook_importers (sync copies is_updated from source).

alter table public.screenshots
  add column if not exists is_updated boolean not null default false;

comment on column public.screenshots.is_updated is
  'Set when notes, annotations, or trade attributes change on the source screenshot; synced to importer copies.';

create index if not exists screenshots_is_updated_idx
  on public.screenshots (user_id, is_updated)
  where is_updated = true;
