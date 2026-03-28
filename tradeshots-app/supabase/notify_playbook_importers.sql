-- Run in Supabase SQL Editor after playbook_import_sync_columns.sql
-- Optional: run `notify_importers_on_screenshot_folder_change.sql` so moves into a shared
-- playbook always sync importers (not only when the app calls this RPC).
-- Notifies importers AND copies source screenshots into each importer's copy folder.
-- When a copy already exists (same source_screenshot_id or legacy image_url match), OVERWRITES
-- notes, tags, annotation fields, and trade_attributes from the source so late edits sync.
--
-- p_folder_id may be the shared playbook root OR any subfolder under it (where share_id is null).
-- The function walks up to the folder that has share_id — that id must match user_playbooks.source_folder_id.
-- Screenshots in the entire subtree under that root are synced (not only the root folder).
--
-- Notifications (per importer, per RPC call):
-- - "New setup added" if at least one NEW importer screenshot row was inserted.
-- - "Setup updated" if p_notify_importers_on_copy_updates is true and at least one EXISTING
--   copy was synced (notes/annotations/tags/attributes), and there was no new insert this call.
--
-- Pass p_notify_importers_on_copy_updates from the app when the author edits or clears notes,
-- annotations, or trade attributes so importers are notified. Upload/move/trigger use default false.

drop function if exists public.notify_playbook_importers(uuid);

create or replace function public.notify_playbook_importers(
  p_folder_id uuid,
  p_notify_importers_on_copy_updates boolean default false
)
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
  any_insert_for_importer boolean;
  any_copy_update_for_importer boolean;
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
    any_insert_for_importer := false;
    any_copy_update_for_importer := false;

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
        and (
          d.source_screenshot_id is not distinct from s.id
          or (
            d.source_screenshot_id is null
            and d.image_url is not distinct from s.image_url
          )
        )
      limit 1;

      if dest_id is not null then
        begin
          update public.screenshots as dst
          set
            notes = src.notes,
            annotation = src.annotation,
            annotations = src.annotations,
            tags = coalesce(src.tags, dst.tags),
            source_screenshot_id = coalesce(dst.source_screenshot_id, src.id)
          from public.screenshots as src
          where dst.id = dest_id
            and src.id = s.id;
        exception
          when sqlstate '42703' then
            update public.screenshots as dst
            set
              notes = src.notes,
              tags = coalesce(src.tags, dst.tags),
              source_screenshot_id = coalesce(dst.source_screenshot_id, src.id)
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

        any_copy_update_for_importer := true;
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
          source_screenshot_id
        )
        values (
          up_row.copy_folder_id,
          up_row.user_id,
          s.image_url,
          s.notes,
          s.tags,
          s.annotation,
          s.annotations,
          s.id
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
              source_screenshot_id
            )
            values (
              up_row.copy_folder_id,
              up_row.user_id,
              s.image_url,
              s.notes,
              s.tags,
              s.id
            )
            returning id into new_sid;
          exception
            when sqlstate '42703' then
              insert into public.screenshots (
                folder_id,
                user_id,
                image_url,
                notes,
                tags
              )
              values (
                up_row.copy_folder_id,
                up_row.user_id,
                s.image_url,
                s.notes,
                s.tags
              )
              returning id into new_sid;
          end;
      end;

      any_insert_for_importer := true;

      begin
        update public.screenshots as dst
        set
          notes = src.notes,
          annotation = src.annotation,
          annotations = src.annotations,
          tags = coalesce(src.tags, dst.tags)
        from public.screenshots as src
        where dst.id = new_sid
          and src.id = s.id;
      exception
        when sqlstate '42703' then
          update public.screenshots as dst
          set
            notes = src.notes,
            tags = coalesce(src.tags, dst.tags)
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

    if any_insert_for_importer then
      insert into public.notifications (user_id, type, message)
      values (
        up_row.user_id,
        'update',
        format('New setup added to "%s"', coalesce(f_name, 'Shared playbook'))
      );
    elsif p_notify_importers_on_copy_updates and any_copy_update_for_importer then
      insert into public.notifications (user_id, type, message)
      values (
        up_row.user_id,
        'update',
        format('Setup updated in "%s"', coalesce(f_name, 'Shared playbook'))
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.notify_playbook_importers(uuid, boolean) to authenticated;
