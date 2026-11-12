-- PlanEZR schema, part 2: personal itineraries synced to the account, and (dormant) email forwarding.
-- Paste into Supabase Dashboard → SQL Editor → New query → Run. Safe to run more than once. Adds new tables only.
--
--   trip_items      a signed-in person's own itinerary items (bookings and saved places), per page
--   inbound_tokens  one private forwarding token per person, used by the optional inbound-email function

create extension if not exists pgcrypto;

create table if not exists public.trip_items (
  id          text not null,
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  page_key    text not null check (char_length(page_key) between 1 and 80),
  kind        text not null check (kind in ('booking', 'place')),
  item        jsonb not null,
  source      text not null default 'app' check (source in ('app', 'email')),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  primary key (owner, id)
);
create index if not exists trip_items_owner_page_idx on public.trip_items (owner, page_key);

create table if not exists public.inbound_tokens (
  owner       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(9), 'hex'),
  created_at  timestamptz not null default now()
);

alter table public.trip_items     enable row level security;
alter table public.inbound_tokens enable row level security;

-- trip_items: only the owner, for everything
drop policy if exists "trip_items_own" on public.trip_items;
create policy "trip_items_own" on public.trip_items
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- inbound_tokens: the owner can read and create their own token (the inbound function uses the service role on the server)
drop policy if exists "inbound_tokens_select_own" on public.inbound_tokens;
create policy "inbound_tokens_select_own" on public.inbound_tokens
  for select to authenticated using (owner = (select auth.uid()));
drop policy if exists "inbound_tokens_insert_own" on public.inbound_tokens;
create policy "inbound_tokens_insert_own" on public.inbound_tokens
  for insert to authenticated with check (owner = (select auth.uid()));

-- grants (new tables are not exposed automatically in this project)
revoke all on public.trip_items, public.inbound_tokens from anon, authenticated;
grant select, insert, update, delete on public.trip_items     to authenticated;
grant select, insert                 on public.inbound_tokens to authenticated;
