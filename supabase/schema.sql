-- Eventpages database schema for Supabase.
-- Paste into Dashboard → SQL Editor → New query → Run. Safe to run more than once.
--
-- Tables
--   events         one row per hosted page (short link = slug, the page itself = config jsonb)
--   rsvps          replies from guests (anyone can send one; only the event owner can read them)
--   announcements  updates the organizer posts to a page (public to read, owner to write)
--
-- This project has "automatically expose new tables" OFF and automatic RLS ON,
-- so every table below gets explicit GRANTs for the anon and authenticated roles,
-- and Row Level Security policies decide which rows each role can actually touch.

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
              check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  config      jsonb not null,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists events_owner_idx on public.events (owner);

create table if not exists public.rsvps (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  email       text check (email is null or char_length(email) <= 254),
  attending   boolean not null default true,
  guests      smallint not null default 1 check (guests between 0 and 20),
  note        text check (note is null or char_length(note) <= 1000),
  created_at  timestamptz not null default now()
);
create index if not exists rsvps_event_idx on public.rsvps (event_id);

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  pinned      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists announcements_event_idx on public.announcements (event_id, created_at desc);

-- keep events.updated_at current
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at before update on public.events
  for each row execute function public.touch_updated_at();

-- owner may not be changed after creation
create or replace function public.keep_event_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.owner := old.owner;
  new.id := old.id;
  return new;
end $$;
drop trigger if exists events_keep_owner on public.events;
create trigger events_keep_owner before update on public.events
  for each row execute function public.keep_event_owner();

-- ---------- row level security ----------
alter table public.events        enable row level security;
alter table public.rsvps         enable row level security;
alter table public.announcements enable row level security;

-- events: anyone reads published pages; owners read, create, change and delete their own
drop policy if exists "events_select_published_or_own" on public.events;
create policy "events_select_published_or_own" on public.events
  for select to anon, authenticated
  using (published or owner = (select auth.uid()));

drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own" on public.events
  for insert to authenticated
  with check (owner = (select auth.uid()));

drop policy if exists "events_update_own" on public.events;
create policy "events_update_own" on public.events
  for update to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

drop policy if exists "events_delete_own" on public.events;
create policy "events_delete_own" on public.events
  for delete to authenticated
  using (owner = (select auth.uid()));

-- rsvps: anyone can reply to a published page; only that page's owner can read or delete replies
drop policy if exists "rsvps_insert_published" on public.rsvps;
create policy "rsvps_insert_published" on public.rsvps
  for insert to anon, authenticated
  with check (exists (select 1 from public.events e where e.id = event_id and e.published));

drop policy if exists "rsvps_select_owner" on public.rsvps;
create policy "rsvps_select_owner" on public.rsvps
  for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = (select auth.uid())));

drop policy if exists "rsvps_delete_owner" on public.rsvps;
create policy "rsvps_delete_owner" on public.rsvps
  for delete to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = (select auth.uid())));

-- announcements: anyone reads them on published pages; only the page's owner writes them
drop policy if exists "announcements_select" on public.announcements;
create policy "announcements_select" on public.announcements
  for select to anon, authenticated
  using (exists (select 1 from public.events e where e.id = event_id and (e.published or e.owner = (select auth.uid()))));

drop policy if exists "announcements_insert_owner" on public.announcements;
create policy "announcements_insert_owner" on public.announcements
  for insert to authenticated
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner = (select auth.uid())));

drop policy if exists "announcements_update_owner" on public.announcements;
create policy "announcements_update_owner" on public.announcements
  for update to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = (select auth.uid())))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner = (select auth.uid())));

drop policy if exists "announcements_delete_owner" on public.announcements;
create policy "announcements_delete_owner" on public.announcements
  for delete to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = (select auth.uid())));

-- ---------- grants (needed because new tables are not exposed automatically) ----------
-- Grants open the door for a role; the policies above decide which rows get through.
grant usage on schema public to anon, authenticated;

revoke all on public.events, public.rsvps, public.announcements from anon, authenticated;

grant select                         on public.events        to anon;
grant select, insert, update, delete on public.events        to authenticated;

grant insert                         on public.rsvps         to anon;
grant select, insert, delete         on public.rsvps         to authenticated;

grant select                         on public.announcements to anon;
grant select, insert, update, delete on public.announcements to authenticated;

-- All ids are uuids, so there are no sequences to grant usage on.
-- Trigger functions run inside the table owner's statements and need no grants for API roles.
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.keep_event_owner() from public, anon, authenticated;
