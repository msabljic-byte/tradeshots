-- Notify followers when an author publishes or updates a public shared playbook.
-- Requires:
--   - public.follows (follower_id, following_id)
--   - public.notifications (user_id, type, message, source_folder_id, created_at)

create or replace function public.notify_followers_playbook_activity()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_username text;
  f_row record;
  v_type text;
  v_message text;
  should_notify boolean := false;
begin
  if tg_op = 'INSERT' then
    should_notify := coalesce(new.is_public, false) and new.share_id is not null;
    v_type := 'new_playbook';
  elsif tg_op = 'UPDATE' then
    if coalesce(new.is_public, false) and new.share_id is not null then
      if not coalesce(old.is_public, false) or old.share_id is null then
        -- Became public/shared now: treat as a new publish event.
        should_notify := true;
        v_type := 'new_playbook';
      elsif row(new.*) is distinct from row(old.*) then
        should_notify := true;
        v_type := 'playbook_update';
      end if;
    end if;
  end if;

  if not should_notify then
    return new;
  end if;

  select coalesce(nullif(trim(p.username), ''), 'Unknown')
  into v_username
  from public.profiles p
  where p.id = new.user_id
  limit 1;

  if coalesce(v_type, '') = 'new_playbook' then
    v_message := format('New playbook published by %s', coalesce(v_username, 'Unknown'));
  else
    v_message := format('%s updated a playbook', coalesce(v_username, 'Unknown'));
  end if;

  for f_row in
    select f.follower_id
    from public.follows f
    where f.following_id = new.user_id
      and f.follower_id is not null
      and f.follower_id <> new.user_id
  loop
    -- Debounce repeated update writes for the same follower + playbook.
    if v_type = 'playbook_update' and exists (
      select 1
      from public.notifications n
      where n.user_id = f_row.follower_id
        and n.type = 'playbook_update'
        and n.source_folder_id = new.id
        and n.created_at > now() - interval '30 seconds'
      limit 1
    ) then
      continue;
    end if;

    insert into public.notifications (user_id, type, message, source_folder_id)
    values (f_row.follower_id, v_type, v_message, new.id);
  end loop;

  return new;
end;
$$;

drop trigger if exists folders_notify_followers_playbook_activity on public.folders;

create trigger folders_notify_followers_playbook_activity
after insert or update on public.folders
for each row
execute function public.notify_followers_playbook_activity();
