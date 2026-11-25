-- 1LinkTrip schema, part 5: "Share my trip" links. Safe to run more than once. Adds one table and one function.
-- Needs part 1 (events) and part 3 (ep_private.owns_event, ep_private.event_published).
--
--   trip_shares        one row per person per page they chose to "Share my trip" from: a copy of their own bookings and
--                      planned places for that page (kept current by their app), behind an unguessable token. Only its
--                      owner can read, change or delete the row (deleting it = Stop sharing: the link stops working).
--   trip_share_get()   what a link holder gets: the shared copy for ONE token, only while the page is published. Nobody
--                      can list shares; anon and other people have no table access at all.
--
-- A person's own personal changes to a page (their copy of the plan: edits, hides, details on the organizer's items) ride in
-- trip_items (part 2), which is already private to its owner.

create extension if not exists pgcrypto;

create table if not exists public.trip_shares (
  token       text primary key default encode(gen_random_bytes(16), 'hex') check (token ~ '^[a-f0-9]{32}$'),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id    uuid not null references public.events (id) on delete cascade,
  page_key    text not null check (char_length(page_key) between 1 and 80),
  name        text not null default '' check (char_length(name) <= 60),
  data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 200000),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (owner, event_id)
);

create or replace function public.trip_shares_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trip_shares_touch on public.trip_shares;
create trigger trip_shares_touch before insert or update on public.trip_shares
  for each row execute function public.trip_shares_touch();

alter table public.trip_shares enable row level security;

drop policy if exists "trip_shares_select_own" on public.trip_shares;
create policy "trip_shares_select_own" on public.trip_shares
  for select to authenticated using (owner = (select auth.uid()));
-- a share is made for a page its maker can see: a published page, or their own
drop policy if exists "trip_shares_insert_own" on public.trip_shares;
create policy "trip_shares_insert_own" on public.trip_shares
  for insert to authenticated
  with check (owner = (select auth.uid()) and (ep_private.event_published(event_id) or ep_private.owns_event(event_id)));
drop policy if exists "trip_shares_update_own" on public.trip_shares;
create policy "trip_shares_update_own" on public.trip_shares
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
drop policy if exists "trip_shares_delete_own" on public.trip_shares;
create policy "trip_shares_delete_own" on public.trip_shares
  for delete to authenticated using (owner = (select auth.uid()));

-- grants (new tables are not exposed automatically in this project): nothing for anon; the token is always made here
revoke all on public.trip_shares from anon, authenticated;
grant select, delete on public.trip_shares to authenticated;
grant insert (owner, event_id, page_key, name, data) on public.trip_shares to authenticated;
grant update (name, data) on public.trip_shares to authenticated;
revoke execute on function public.trip_shares_touch() from public, anon, authenticated;

-- the link holder's read: one token → the shared copy, while its page is published
create or replace function public.trip_share_get(tok text)
returns table (event_id uuid, slug text, name text, data jsonb, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.event_id, e.slug, s.name, s.data, s.updated_at
  from public.trip_shares s join public.events e on e.id = s.event_id
  where tok ~ '^[a-f0-9]{32}$' and s.token = tok and e.published
$$;
revoke all on function public.trip_share_get(text) from public;
grant execute on function public.trip_share_get(text) to anon, authenticated;
