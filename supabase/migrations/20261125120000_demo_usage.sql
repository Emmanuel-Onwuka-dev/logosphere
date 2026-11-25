-- Daily allowance for the public landing-page demo.
-- One row per visitor (a hash of their IP, never the IP itself) per UTC day.
create table if not exists public.demo_usage (
  visitor_key text not null,
  day date not null default ((now() at time zone 'utc')::date),
  seconds_used integer not null default 0 check (seconds_used >= 0),
  primary key (visitor_key, day)
);

-- Nobody reads or writes this table from the browser: RLS on with no policies.
alter table public.demo_usage enable row level security;

-- Adds p_seconds to the visitor's total for today, only if the total stays within p_limit.
-- Returns the new total, or NULL when the allowance would be exceeded (nothing is recorded).
create or replace function public.demo_take_seconds(p_key text, p_seconds integer, p_limit integer)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.demo_usage as u (visitor_key, day, seconds_used)
  select p_key, ((now() at time zone 'utc')::date), p_seconds
  where p_seconds > 0 and p_seconds <= p_limit
  on conflict (visitor_key, day) do update
    set seconds_used = u.seconds_used + excluded.seconds_used
    where u.seconds_used + excluded.seconds_used <= p_limit
  returning u.seconds_used;
$$;

-- Only the server (service key) may call it.
revoke execute on function public.demo_take_seconds(text, integer, integer) from public, anon, authenticated;
