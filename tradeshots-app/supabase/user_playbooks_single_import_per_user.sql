-- Enforce "one import per user per shared playbook"
-- This prevents the same importer account from importing the same shared root multiple times.
-- Multiple DIFFERENT users can still import the same shared playbook.

-- 1) (Optional but recommended) Inspect duplicates first:
-- select user_id, source_folder_id, count(*)
-- from public.user_playbooks
-- group by user_id, source_folder_id
-- having count(*) > 1;

-- 2) If duplicates exist, keep the newest row and delete the rest.
-- NOTE: This only deletes rows from `user_playbooks` (not folders). If you created extra copy folders,
-- you may want to delete those manually after confirming nothing references them.
with ranked as (
  select
    ctid,
    user_id,
    source_folder_id,
    copy_folder_id,
    row_number() over (
      partition by user_id, source_folder_id
      order by created_at desc nulls last, copy_folder_id desc nulls last
    ) as rn
  from public.user_playbooks
)
delete from public.user_playbooks up
using ranked r
where up.ctid = r.ctid
  and r.rn > 1;

-- 3) Add the unique constraint (DB guarantee)
alter table public.user_playbooks
  add constraint user_playbooks_one_import_per_user
  unique (user_id, source_folder_id);

