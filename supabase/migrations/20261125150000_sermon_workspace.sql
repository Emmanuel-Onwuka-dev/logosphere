-- Recorded-sermon workspace: uploaded source audio, timed transcript segments, metadata, archive.

alter table public.recordings
  add column if not exists preacher text,
  add column if not exists sermon_date date,
  add column if not exists source_path text,
  add column if not exists source_mime text,
  add column if not exists transcript_status text not null default 'none'
    check (transcript_status in ('none', 'uploaded', 'transcribing', 'ready', 'failed')),
  add column if not exists transcript_error text,
  add column if not exists archived_at timestamptz;

-- Timed transcript segments. Each one becomes a translated, voiced piece.
create table if not exists public.recording_segments (
  recording_id uuid not null references public.recordings(id) on delete cascade,
  idx integer not null check (idx >= 0),
  start_seconds numeric not null,
  end_seconds numeric not null,
  original_text text not null default '',
  edited_text text,
  primary key (recording_id, idx)
);

alter table public.recording_segments enable row level security;

create policy "Church operators read recording segments" on public.recording_segments for select to authenticated
  using (
    exists (
      select 1 from public.recordings r
      where r.id = recording_id
        and (public.has_role(auth.uid(), 'platform_admin')
          or public.has_church_role(auth.uid(), r.church_id, 'church_admin')
          or public.has_church_role(auth.uid(), r.church_id, 'media_operator'))
    )
  );
