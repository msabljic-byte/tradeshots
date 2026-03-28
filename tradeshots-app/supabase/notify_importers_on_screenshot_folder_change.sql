-- Run in Supabase SQL Editor AFTER `notify_playbook_importers.sql` is applied.
--
-- When screenshots.folder_id is updated (drag-drop, Move To, API, etc.), calls
-- notify_playbook_importers once per distinct destination folder per UPDATE statement.
-- This covers authors moving setups from a non-shared folder into a shared playbook tree
-- so importers get copies + "New setup added" when the RPC inserts new rows.
--
-- Note: Cannot use "UPDATE OF folder_id" with transition tables (PostgreSQL restriction).
-- Trigger runs on any UPDATE; the function only calls notify when folder_id actually changed.

create or replace function public.notify_importers_after_screenshot_folder_change()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  dest record;
begin
  for dest in
    select distinct n.folder_id as fid
    from new_rows n
    inner join old_rows o on n.id = o.id
    where n.folder_id is distinct from o.folder_id
      and n.folder_id is not null
  loop
    perform public.notify_playbook_importers(dest.fid);
  end loop;

  return null;
end;
$$;

drop trigger if exists screenshots_folder_change_notify_importers on public.screenshots;

create trigger screenshots_folder_change_notify_importers
  after update on public.screenshots
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.notify_importers_after_screenshot_folder_change();
