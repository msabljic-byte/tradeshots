-- Ensure imported playbooks cannot be shared/monetized.
-- Safe to run multiple times.

begin;

alter table public.folders
  add column if not exists is_imported boolean not null default false;

create or replace function public.prevent_imported_folder_sharing_changes()
returns trigger
language plpgsql
as $$
begin
  if old.is_imported is true then
    if new.is_public is distinct from old.is_public
       or new.is_paid is distinct from old.is_paid
       or new.price is distinct from old.price then
      raise exception 'Imported playbooks cannot be made public or monetized.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_imported_folder_sharing_changes on public.folders;
create trigger trg_prevent_imported_folder_sharing_changes
before update on public.folders
for each row
execute function public.prevent_imported_folder_sharing_changes();

commit;
