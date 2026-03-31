-- Add source (author-owned) voice memo metadata to screenshots.

alter table public.screenshots
  add column if not exists voice_memo_url text,
  add column if not exists voice_memo_path text,
  add column if not exists voice_memo_duration_ms integer,
  add column if not exists voice_memo_mime_type text,
  add column if not exists voice_memo_size_bytes bigint,
  add column if not exists voice_memo_updated_at timestamptz;

comment on column public.screenshots.voice_memo_url is
  'Source voice memo URL for this screenshot.';
comment on column public.screenshots.voice_memo_path is
  'Storage object path for source memo (used for replace/delete).';
comment on column public.screenshots.voice_memo_duration_ms is
  'Duration in milliseconds for source voice memo.';
comment on column public.screenshots.voice_memo_mime_type is
  'MIME type of source voice memo.';
comment on column public.screenshots.voice_memo_size_bytes is
  'Source voice memo size in bytes.';
comment on column public.screenshots.voice_memo_updated_at is
  'Last update time for source voice memo metadata.';
