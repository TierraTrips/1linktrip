-- 1LinkTrip: "Forward a booking email" (the inbound edge function). Additive only; safe to run more than once.
-- Needs schema-2 (trip_items, inbound_tokens).
--
--   inbound_messages        one row per received email (Resend email_id): makes the webhook idempotent, keeps a short log.
--                           RLS on with NO policies: only the function (service role) can read or write it.
--   inbound_user_by_email() the confirmed account with that email (sender matching); callable by the service role only.
--   inbound_page_tokens     one forwarding address per person PER EVENT (add-<token>@<domain> → owner + page_key, the key
--                           that event's My trip syncs under). Mail to it lands in that event only, no date guessing.
--                           The owner reads and creates their own; the token itself is always made here (column grants),
--                           never chosen by the browser.

create table if not exists public.inbound_messages (
  email_id    text primary key check (char_length(email_id) between 1 and 200),
  owner       uuid references auth.users (id) on delete cascade,
  status      text not null default 'processing' check (status in ('processing', 'added', 'empty', 'unknown')),
  added       smallint not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.inbound_messages enable row level security;
revoke all on public.inbound_messages from anon, authenticated;
grant select, insert, update, delete on public.inbound_messages to service_role; -- new tables aren't exposed automatically here

create or replace function public.inbound_user_by_email(addr text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
  where lower(u.email) = lower(addr) and u.email_confirmed_at is not null
  order by u.created_at limit 1
$$;
revoke all on function public.inbound_user_by_email(text) from public, anon, authenticated;
grant execute on function public.inbound_user_by_email(text) to service_role;

-- the function reads tokens, pages (to pick the trip) and writes trip_items as the service role, which has no table
-- grants by default in this project
grant select on public.inbound_tokens to service_role;
grant select on public.events to service_role;
grant select, insert on public.trip_items to service_role;

-- per-event forwarding addresses (Dylan 11/24: several events can overlap in dates, so each event gets its own address)
create extension if not exists pgcrypto;
create table if not exists public.inbound_page_tokens (
  token       text primary key default encode(gen_random_bytes(9), 'hex') check (token ~ '^[a-f0-9]{18}$'),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  page_key    text not null check (char_length(page_key) between 1 and 80 and page_key <> 'inbox'),
  created_at  timestamptz not null default now(),
  unique (owner, page_key)
);
alter table public.inbound_page_tokens enable row level security;
drop policy if exists "inbound_page_tokens_select_own" on public.inbound_page_tokens;
create policy "inbound_page_tokens_select_own" on public.inbound_page_tokens
  for select to authenticated using (owner = (select auth.uid()));
drop policy if exists "inbound_page_tokens_insert_own" on public.inbound_page_tokens;
create policy "inbound_page_tokens_insert_own" on public.inbound_page_tokens
  for insert to authenticated with check (owner = (select auth.uid()));
revoke all on public.inbound_page_tokens from anon, authenticated;
grant select on public.inbound_page_tokens to authenticated;
grant insert (owner, page_key) on public.inbound_page_tokens to authenticated; -- not token: always the server default
grant select on public.inbound_page_tokens to service_role;
