-- Saved filter presets per user for dashboard screenshot workflows.
create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.saved_views enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'saved_views'
      and policyname = 'saved_views_select_own'
  ) then
    create policy saved_views_select_own
      on public.saved_views
      for select
      using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'saved_views'
      and policyname = 'saved_views_insert_own'
  ) then
    create policy saved_views_insert_own
      on public.saved_views
      for insert
      with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'saved_views'
      and policyname = 'saved_views_update_own'
  ) then
    create policy saved_views_update_own
      on public.saved_views
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'saved_views'
      and policyname = 'saved_views_delete_own'
  ) then
    create policy saved_views_delete_own
      on public.saved_views
      for delete
      using (auth.uid() = user_id);
  end if;
end $$;

