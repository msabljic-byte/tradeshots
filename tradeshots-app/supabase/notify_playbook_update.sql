-- Run after `notifications_source_folder_id.sql` and `notifications_notify_kind.sql`.
-- Requires `notify_playbook_importers` for app flow context (not a hard dependency).
--
-- p_kind:
--   'new_content' — author added screenshot(s); message mentions new shots.
--   'content_edit' — notes / annotations / attributes / moves; classic "updated" copy.
-- Debounce: at most one notification per (source_folder_id, notify_kind) per 30 seconds.

drop function if exists public.notify_playbook_update(uuid);
drop function if exists public.notify_playbook_update(uuid, text);

create or replace function public.notify_playbook_update(
  p_folder_id uuid,
  p_kind text default 'content_edit'
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  sync_root uuid;
  cur_id uuid;
  cur_parent uuid;
  cur_share text;
  cur_owner uuid;
  f_name text;
  up_row record;
  v_kind text;
begin
  if p_folder_id is null then
    return;
  end if;

  v_kind := lower(trim(coalesce(p_kind, 'content_edit')));
  if v_kind not in ('new_content', 'content_edit') then
    v_kind := 'content_edit';
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
      exit;
    end if;

    cur_id := cur_parent;
  end loop;

  if sync_root is null then
    return;
  end if;

  if exists (
    select 1
    from public.notifications n
    where n.source_folder_id is not distinct from sync_root
      and n.created_at > now() - interval '30 seconds'
      and coalesce(n.notify_kind, 'content_edit') = v_kind
    limit 1
  ) then
    return;
  end if;

  for up_row in
    select user_id
    from public.user_playbooks
    where source_folder_id = sync_root
      and copy_folder_id is not null
  loop
    insert into public.notifications (user_id, type, message, source_folder_id, notify_kind)
    values (
      up_row.user_id,
      'update',
      case v_kind
        when 'new_content' then
          format('Playbook "%s" has new screenshot(s)', coalesce(f_name, 'Shared playbook'))
        else
          format('Playbook "%s" updated', coalesce(f_name, 'Shared playbook'))
      end,
      sync_root,
      v_kind
    );
  end loop;
end;
$$;

grant execute on function public.notify_playbook_update(uuid, text) to authenticated;
