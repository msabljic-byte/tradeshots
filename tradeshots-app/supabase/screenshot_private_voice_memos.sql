-- Importer-private per-screenshot voice memos.
-- One private memo per (user, screenshot).

create table if not exists public.screenshot_private_voice_memos (
  id uuid primary key default gen_random_uuid(),
  screenshot_id uuid not null references public.screenshots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  voice_memo_url text not null,
  voice_memo_path text not null,
  voice_memo_duration_ms integer,
  voice_memo_mime_type text,
  voice_memo_size_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (screenshot_id, user_id)
);

create index if not exists screenshot_private_voice_memos_screenshot_idx
  on public.screenshot_private_voice_memos (screenshot_id);

create index if not exists screenshot_private_voice_memos_user_idx
  on public.screenshot_private_voice_memos (user_id);

alter table public.screenshot_private_voice_memos enable row level security;

drop policy if exists "private voice memos select own" on public.screenshot_private_voice_memos;
create policy "private voice memos select own"
  on public.screenshot_private_voice_memos
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "private voice memos insert own" on public.screenshot_private_voice_memos;
create policy "private voice memos insert own"
  on public.screenshot_private_voice_memos
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "private voice memos update own" on public.screenshot_private_voice_memos;
create policy "private voice memos update own"
  on public.screenshot_private_voice_memos
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "private voice memos delete own" on public.screenshot_private_voice_memos;
create policy "private voice memos delete own"
  on public.screenshot_private_voice_memos
  for delete
  to authenticated
  using (user_id = auth.uid());

create or replace function public.touch_private_voice_memo_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_private_voice_memos_updated_at on public.screenshot_private_voice_memos;
create trigger set_private_voice_memos_updated_at
  before update on public.screenshot_private_voice_memos
  for each row
  execute function public.touch_private_voice_memo_updated_at();
