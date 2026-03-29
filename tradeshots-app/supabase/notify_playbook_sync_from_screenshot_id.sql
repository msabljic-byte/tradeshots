-- Run after notify_playbook_importers.sql and notify_playbook_update.sql.
-- Syncs importer copies only (no notification here — app calls notify_playbook_update once).
-- Returns the resolved shared-playbook folder id (for debounced notify on the client), or null.

drop function if exists public.notify_playbook_sync_from_screenshot_id(uuid);

create or replace function public.notify_playbook_sync_from_screenshot_id(p_screenshot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  fid uuid;
begin
  if p_screenshot_id is null then
    return null;
  end if;

  select sh.folder_id
  into fid
  from public.screenshots sh
  where sh.id = p_screenshot_id
    and sh.user_id is not distinct from auth.uid();

  if fid is null then
    return null;
  end if;

  perform public.notify_playbook_importers(fid);
  return fid;
end;
$$;

grant execute on function public.notify_playbook_sync_from_screenshot_id(uuid) to authenticated;
