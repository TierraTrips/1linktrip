-- 1LinkTrip schema, part 4: organizer-only data for a page (vendors and their payments).
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Safe to run more than once. Adds one new table only.
-- Needs part 1 (events) and part 3 (ep_private.owns_event).
--
--   event_private   one row per page: the organizer's own planning data ({ cur, vendors: [...], t }), never shown to guests
--
-- The page's config (events.config) is readable by anyone with its link, so nothing private goes there. This table is
-- readable and writable only by the page's owner (Row Level Security); guests and signed-out visitors get nothing.

create table if not exists public.event_private (
  event_id    uuid primary key references public.events (id) on delete cascade,
  data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 300000),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create or replace function public.event_private_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists event_private_touch on public.event_private;
create trigger event_private_touch before insert or update on public.event_private
  for each row execute function public.event_private_touch();

alter table public.event_private enable row level security;

-- only the page's owner, for everything
drop policy if exists "event_private_owner" on public.event_private;
create policy "event_private_owner" on public.event_private
  for all to authenticated
  using (ep_private.owns_event(event_id))
  with check (ep_private.owns_event(event_id));

-- grants (new tables are not exposed automatically in this project): nothing for anon
revoke all on public.event_private from anon, authenticated;
grant select, insert, update, delete on public.event_private to authenticated;
revoke execute on function public.event_private_touch() from public, anon, authenticated;
