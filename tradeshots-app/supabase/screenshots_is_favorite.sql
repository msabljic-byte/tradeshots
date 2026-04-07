-- Screenshot favorites flag for dashboard bookmarking/filtering.
alter table public.screenshots
add column if not exists is_favorite boolean not null default false;

