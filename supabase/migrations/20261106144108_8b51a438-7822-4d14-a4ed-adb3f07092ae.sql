create type public.app_role as enum ('platform_admin','church_admin','media_operator','listener');

create table public.churches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  country text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.churches to authenticated;
grant all on public.churches to service_role;
alter table public.churches enable row level security;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  church_id uuid references public.churches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  church_id uuid references public.churches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, role, church_id)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.has_church_role(_user_id uuid, _church_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and church_id = _church_id and role = _role)
$$;

create or replace function public.is_church_member(_user_id uuid, _church_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and church_id = _church_id)
    or exists (select 1 from public.profiles where id = _user_id and church_id = _church_id)
$$;

-- profiles policies
create policy "Own profile read" on public.profiles for select to authenticated
  using (auth.uid() = id or public.has_role(auth.uid(),'platform_admin')
    or (church_id is not null and public.has_church_role(auth.uid(), church_id, 'church_admin')));
create policy "Own profile insert" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "Own profile update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- churches policies
create policy "Members read church" on public.churches for select to authenticated
  using (public.is_church_member(auth.uid(), id) or created_by = auth.uid() or public.has_role(auth.uid(),'platform_admin'));
create policy "Admins update church" on public.churches for update to authenticated
  using (public.has_church_role(auth.uid(), id, 'church_admin') or public.has_role(auth.uid(),'platform_admin'));
create policy "Platform admins delete church" on public.churches for delete to authenticated
  using (public.has_role(auth.uid(),'platform_admin'));

-- user_roles policies
create policy "Read own or managed roles" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'platform_admin')
    or (church_id is not null and public.has_church_role(auth.uid(), church_id, 'church_admin')));

-- register a church: caller becomes church_admin
create or replace function public.create_church(_name text, _city text, _country text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'Church name required'; end if;
  insert into public.churches(name, city, country, created_by) values (trim(_name), _city, _country, auth.uid()) returning id into _id;
  insert into public.user_roles(user_id, role, church_id) values (auth.uid(), 'church_admin', _id);
  update public.profiles set church_id = _id where id = auth.uid();
  return _id;
end $$;
grant execute on function public.create_church(text,text,text) to authenticated;

-- updated_at
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
create trigger churches_updated before update on public.churches for each row execute function public.update_updated_at_column();
create trigger profiles_updated before update on public.profiles for each row execute function public.update_updated_at_column();

-- new user: profile + listener role
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  insert into public.user_roles(user_id, role) values (new.id, 'listener');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();