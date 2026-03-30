-- Run in Supabase SQL Editor after playbook_import_sync_columns.sql, screenshots_is_new.sql, and screenshots_is_updated.sql
-- Syncs importer copies only — notifications are handled by `notify_playbook_update` (debounced).
-- Optional: run `notify_importers_on_screenshot_folder_change.sql` for folder_id moves.
--
-- p_folder_id may be the shared playbook root OR any subfolder under it (share_id on an ancestor).
-- Screenshots in the entire subtree under that root are synced.

drop function if exists public.notify_playbook_importers(uuid);
drop function if exists public.notify_playbook_importers(uuid, boolean);

create or replace function public.notify_playbook_importers(p_folder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  f_name text;
  owner_id uuid;
  sync_root uuid;
  cur_id uuid;
  cur_parent uuid;
  cur_share text;
  cur_owner uuid;
  up_row record;
  s record;
  new_sid uuid;
  dest_id uuid;
begin
  if p_folder_id is null then
    return;
  end if;

  sync_root := null;
  cur_id := p_folder_id;

  loop
    exit when cur_id is null;

    select f.parent_id, f.share_id, f.user_id, f.name
    into cur_parent, cur_share, cur_owner, f_name
    from public.folders f
    where f.id = cur_id;

    if not found then
      return;
    end if;

    if cur_owner is distinct from auth.uid() then
      return;
    end if;

    if cur_share is not null and length(trim(cur_share)) > 0 then
      sync_root := cur_id;
      owner_id := cur_owner;
      exit;
    end if;

    cur_id := cur_parent;
  end loop;

  if sync_root is null then
    return;
  end if;

  for up_row in
    select user_id, copy_folder_id
    from public.user_playbooks
    where source_folder_id = sync_root
      and copy_folder_id is not null
  loop
    for s in
      select sh.*
      from public.screenshots sh
      where sh.user_id = owner_id
        and sh.folder_id in (
          with recursive playbook_tree as (
            select id
            from public.folders
            where id = sync_root
            union all
            select f.id
            from public.folders f
            inner join playbook_tree t on f.parent_id = t.id
          )
          select id from playbook_tree
        )
    loop
      dest_id := null;
      select d.id
      into dest_id
      from public.screenshots d
      where d.folder_id = up_row.copy_folder_id
        and d.user_id = up_row.user_id
        and d.image_url is not distinct from s.image_url
      order by
        case when d.source_screenshot_id is not distinct from s.id then 0 else 1 end,
        d.id
      limit 1;

      if dest_id is not null then
        begin
          update public.screenshots as dst
          set
            notes = src.notes,
            annotation = src.annotation,
            annotations = src.annotations,
            tags = coalesce(src.tags, dst.tags),
            source_screenshot_id = coalesce(dst.source_screenshot_id, src.id),
            -- Importer copy: always mark updated when syncing from author (reliable UPDATED badge).
            is_updated = true
          from public.screenshots as src
          where dst.id = dest_id
            and src.id = s.id;
        exception
          when sqlstate '42703' then
            update public.screenshots as dst
            set
              notes = src.notes,
              tags = coalesce(src.tags, dst.tags),
              source_screenshot_id = coalesce(dst.source_screenshot_id, src.id),
              is_updated = true
            from public.screenshots as src
            where dst.id = dest_id
              and src.id = s.id;
        end;

        delete from public.trade_attributes
        where screenshot_id = dest_id;

        insert into public.trade_attributes (screenshot_id, user_id, key, value)
        select
          dest_id,
          up_row.user_id,
          ta.key,
          ta.value
        from public.trade_attributes ta
        where ta.screenshot_id = s.id;

        continue;
      end if;

      begin
        insert into public.screenshots (
          folder_id,
          user_id,
          image_url,
          notes,
          tags,
          annotation,
          annotations,
          source_screenshot_id,
          is_new,
          is_updated
        )
        values (
          up_row.copy_folder_id,
          up_row.user_id,
          s.image_url,
          s.notes,
          s.tags,
          s.annotation,
          s.annotations,
          s.id,
          true,
          coalesce(s.is_updated, false)
        )
        returning id into new_sid;
      exception
        when sqlstate '42703' then
          begin
            insert into public.screenshots (
              folder_id,
              user_id,
              image_url,
              notes,
              tags,
              source_screenshot_id,
              is_new,
              is_updated
            )
            values (
              up_row.copy_folder_id,
              up_row.user_id,
              s.image_url,
              s.notes,
              s.tags,
              s.id,
              true,
              coalesce(s.is_updated, false)
            )
            returning id into new_sid;
          exception
            when sqlstate '42703' then
              insert into public.screenshots (
                folder_id,
                user_id,
                image_url,
                notes,
                tags,
                is_new,
                is_updated
              )
              values (
                up_row.copy_folder_id,
                up_row.user_id,
                s.image_url,
                s.notes,
                s.tags,
                true,
                coalesce(s.is_updated, false)
              )
              returning id into new_sid;
          end;
      end;

      begin
        update public.screenshots as dst
        set
          notes = src.notes,
          annotation = src.annotation,
          annotations = src.annotations,
          tags = coalesce(src.tags, dst.tags),
          is_updated = coalesce(src.is_updated, false)
        from public.screenshots as src
        where dst.id = new_sid
          and src.id = s.id;
      exception
        when sqlstate '42703' then
          update public.screenshots as dst
          set
            notes = src.notes,
            tags = coalesce(src.tags, dst.tags),
            is_updated = coalesce(src.is_updated, false)
          from public.screenshots as src
          where dst.id = new_sid
            and src.id = s.id;
      end;

      insert into public.trade_attributes (screenshot_id, user_id, key, value)
      select
        new_sid,
        up_row.user_id,
        ta.key,
        ta.value
      from public.trade_attributes ta
      where ta.screenshot_id = s.id;
    end loop;
  end loop;
end;
$$;

grant execute on function public.notify_playbook_importers(uuid) to authenticated;
