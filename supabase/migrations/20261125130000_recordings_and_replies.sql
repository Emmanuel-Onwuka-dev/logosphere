-- Recorded sermon translation and listener replies.
-- All writes happen in server functions with the service key. Browsers can only read what their role allows.

-- 1. Recorded sermons, translated piece by piece.
create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  public_code text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  source_language text not null default 'en',
  target_languages text[] not null check (array_length(target_languages, 1) >= 1),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  duration_seconds numeric not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.recording_pieces (
  recording_id uuid not null references public.recordings(id) on delete cascade,
  language text not null,
  piece_index integer not null check (piece_index >= 0),
  start_seconds numeric not null,
  end_seconds numeric not null,
  english text not null default '',
  translation text not null default '',
  storage_path text,
  error text,
  primary key (recording_id, language, piece_index)
);

alter table public.recordings enable row level security;
alter table public.recording_pieces enable row level security;

create policy "Church operators read recordings" on public.recordings for select to authenticated
  using (
    public.has_role(auth.uid(), 'platform_admin')
    or public.has_church_role(auth.uid(), church_id, 'church_admin')
    or public.has_church_role(auth.uid(), church_id, 'media_operator')
  );

create policy "Church operators read recording pieces" on public.recording_pieces for select to authenticated
  using (
    exists (
      select 1 from public.recordings r
      where r.id = recording_id
        and (public.has_role(auth.uid(), 'platform_admin')
          or public.has_church_role(auth.uid(), r.church_id, 'church_admin')
          or public.has_church_role(auth.uid(), r.church_id, 'media_operator'))
    )
  );

-- 2. Listener replies to the preacher, shown in English in the control view.
create table if not exists public.session_replies (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  language text not null,
  original text not null,
  english text not null,
  created_at timestamptz not null default now()
);

alter table public.session_replies enable row level security;

create policy "Session operators read replies" on public.session_replies for select to authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = session_id
        and (public.has_role(auth.uid(), 'platform_admin')
          or public.has_church_role(auth.uid(), s.church_id, 'church_admin')
          or public.has_church_role(auth.uid(), s.church_id, 'media_operator'))
    )
  );

-- 3. Private bucket for translated audio pieces. Served to listeners only through signed URLs.
insert into storage.buckets (id, name, public) values ('sermon-audio', 'sermon-audio', false)
on conflict (id) do nothing;
