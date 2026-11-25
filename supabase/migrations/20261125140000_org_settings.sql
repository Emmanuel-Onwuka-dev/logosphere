-- Profile preferences, organisation settings, and member visibility for the platform dashboard.

alter table public.profiles add column if not exists preferred_language text not null default 'en';

alter table public.churches add column if not exists default_source_language text not null default 'en';
alter table public.churches add column if not exists enabled_languages text[] not null default array['fr', 'es'];

-- Members of a church can see each other's display names (needed for the members list).
create policy "Church members read member profiles" on public.profiles for select to authenticated
  using (
    church_id is not null
    and public.is_church_member(auth.uid(), church_id)
  );
