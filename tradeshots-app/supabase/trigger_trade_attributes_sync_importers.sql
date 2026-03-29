-- Run after notify_playbook_importers.sql and notify_playbook_update.sql.
-- Statement-level: one sync per INSERT/DELETE/UPDATE statement on trade_attributes (not per row).
-- Sync only — no notify_playbook_update here (avoids duplicate "Playbook updated" with the app).

create or replace function public.notify_importers_after_trade_attributes_insert()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  r record;
begin
  for r in
    select distinct s.folder_id as fid
    from new_rows nr
    inner join public.screenshots s on s.id = nr.screenshot_id
    where s.folder_id is not null
  loop
    perform public.notify_playbook_importers(r.fid);
  end loop;
  return null;
end;
$$;

create or replace function public.notify_importers_after_trade_attributes_delete()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  r record;
begin
  for r in
    select distinct s.folder_id as fid
    from old_rows orow
    inner join public.screenshots s on s.id = orow.screenshot_id
    where s.folder_id is not null
  loop
    perform public.notify_playbook_importers(r.fid);
  end loop;
  return null;
end;
$$;

create or replace function public.notify_importers_after_trade_attributes_update()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  r record;
begin
  for r in
    select distinct s.folder_id as fid
    from (
      select screenshot_id from new_rows
      union
      select screenshot_id from old_rows
    ) x
    inner join public.screenshots s on s.id = x.screenshot_id
    where s.folder_id is not null
  loop
    perform public.notify_playbook_importers(r.fid);
  end loop;
  return null;
end;
$$;

drop trigger if exists trade_attributes_ai_sync_shared_playbook on public.trade_attributes;
drop trigger if exists trade_attributes_ad_sync_shared_playbook on public.trade_attributes;
drop trigger if exists trade_attributes_au_sync_shared_playbook on public.trade_attributes;

create trigger trade_attributes_ai_sync_shared_playbook
  after insert on public.trade_attributes
  referencing new table as new_rows
  for each statement
  execute function public.notify_importers_after_trade_attributes_insert();

create trigger trade_attributes_ad_sync_shared_playbook
  after delete on public.trade_attributes
  referencing old table as old_rows
  for each statement
  execute function public.notify_importers_after_trade_attributes_delete();

create trigger trade_attributes_au_sync_shared_playbook
  after update on public.trade_attributes
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.notify_importers_after_trade_attributes_update();
