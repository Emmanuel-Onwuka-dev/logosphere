-- Usage tracking per church: speech-to-text seconds, translated characters, and speech-output characters.
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches(id) on delete cascade,
  kind text not null check (kind in ('stt_seconds', 'translation_chars', 'tts_chars')),
  provider text not null,
  quantity numeric not null check (quantity >= 0),
  source text not null check (source in ('live', 'recording', 'reply')),
  created_at timestamptz not null default now()
);

create index if not exists usage_events_church_time_idx on public.usage_events (church_id, created_at desc);

alter table public.usage_events enable row level security;

create policy "Church operators read usage" on public.usage_events for select to authenticated
  using (
    public.has_role(auth.uid(), 'platform_admin')
    or public.has_church_role(auth.uid(), church_id, 'church_admin')
    or public.has_church_role(auth.uid(), church_id, 'media_operator')
  );
