-- Run in Supabase SQL Editor BEFORE or WITH the updated notify_playbook_importers function.
-- Links each import to the importer's copy folder and tracks which source shot was copied (for incremental sync).

alter table public.user_playbooks
  add column if not exists copy_folder_id uuid references public.folders (id) on delete set null;

create index if not exists user_playbooks_source_copy_idx
  on public.user_playbooks (source_folder_id, copy_folder_id);

comment on column public.user_playbooks.copy_folder_id is
  'Importer''s folder that holds copied screenshots; used to push new source shots on update.';

alter table public.screenshots
  add column if not exists source_screenshot_id uuid references public.screenshots (id) on delete set null;

create index if not exists screenshots_source_screenshot_id_idx
  on public.screenshots (source_screenshot_id);

comment on column public.screenshots.source_screenshot_id is
  'If set, copy of this row came from the referenced source screenshot (shared playbook sync).';

-- Optional: imports done BEFORE copy_folder_id existed will not auto-sync until you set copy_folder_id
-- (and ideally add source_screenshot_id on existing copied rows) — e.g.:
-- update public.user_playbooks set copy_folder_id = 'YOUR-COPY-FOLDER-UUID'
-- where user_id = 'YOUR-USER-UUID' and source_folder_id = 'CREATOR-SHARED-FOLDER-UUID';
