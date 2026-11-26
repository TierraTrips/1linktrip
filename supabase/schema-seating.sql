-- 1LinkTrip schema, part 7: seating. Safe to run more than once. Needs parts 1–6.
--
--   guest_tables       the page's tables: name, shape (round / rect), seats, head table, order, and (optional) where the
--                      table stands on the floor plan (x / y in a 1000 × 640 room)
--   guest_people       + table_id: the table a guest sits at (null = not seated). Deleting a table unseats its guests.
--   guest_seating      per page: whether guests see their own table on their household link (off by default)
--
-- Who can do what:
--   • owner + accepted planners (ep_private.plans_event): everything
--   • a household link (token) reads ONLY its own people's table names, through household_seats(), and only while the
--     organizers have "Show table to guests" on. Never anyone else's seat, never who sits with them.
--   • everyone else: nothing (anon / strangers have no access to the new table or columns)

create extension if not exists pgcrypto;

create table if not exists public.guest_tables (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  shape       text not null default 'round' check (shape in ('round', 'rect')),
  capacity    smallint not null default 8 check (capacity between 1 and 60),
  head        boolean not null default false,
  sort        integer not null default 0,
  x           smallint check (x is null or x between 0 and 1000),
  y           smallint check (y is null or y between 0 and 640),
  created_at  timestamptz not null default now()
);
create index if not exists guest_tables_event_idx on public.guest_tables (event_id, sort);

create or replace function public.guest_tables_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then new.event_id := old.event_id; end if; -- a table never moves to another page
  if tg_op = 'INSERT' and (select count(*) from public.guest_tables t where t.event_id = new.event_id) >= 300 then
    raise exception 'A page can have up to 300 tables.' using errcode = 'P0001'; end if;
  new.name := btrim(new.name);
  return new;
end $$;
drop trigger if exists guest_tables_check on public.guest_tables;
create trigger guest_tables_check before insert or update on public.guest_tables for each row execute function public.guest_tables_check();

alter table public.guest_tables enable row level security;
drop policy if exists "guest_tables_planners" on public.guest_tables;
create policy "guest_tables_planners" on public.guest_tables for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
revoke all on public.guest_tables from anon, authenticated;
grant select, delete on public.guest_tables to authenticated;
grant insert (id, event_id, name, shape, capacity, head, sort, x, y) on public.guest_tables to authenticated;
grant update (name, shape, capacity, head, sort, x, y) on public.guest_tables to authenticated;

-- ---------- a guest's table ----------
alter table public.guest_people add column if not exists table_id uuid references public.guest_tables (id) on delete set null;
create index if not exists guest_people_table_idx on public.guest_people (table_id) where table_id is not null;

-- the table must be one of the guest's own page (runs after guest_people_check, which fills event_id from the household)
create or replace function public.guest_people_table_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.table_id is not null and not exists (select 1 from public.guest_tables t where t.id = new.table_id and t.event_id = new.event_id) then
    raise exception 'Unknown table' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists guest_people_table_check on public.guest_people;
create trigger guest_people_table_check before insert or update of table_id, household_id on public.guest_people
  for each row execute function public.guest_people_table_check();
grant insert (table_id) on public.guest_people to authenticated;
grant update (table_id) on public.guest_people to authenticated;

-- ---------- page setting: show guests their table ----------
create table if not exists public.guest_seating (
  event_id     uuid primary key references public.events (id) on delete cascade,
  show_guests  boolean not null default false,
  updated_at   timestamptz not null default now()
);
create or replace function public.guest_seating_touch() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists guest_seating_touch on public.guest_seating;
create trigger guest_seating_touch before insert or update on public.guest_seating for each row execute function public.guest_seating_touch();
alter table public.guest_seating enable row level security;
drop policy if exists "guest_seating_planners" on public.guest_seating;
create policy "guest_seating_planners" on public.guest_seating for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
revoke all on public.guest_seating from anon, authenticated;
grant select, delete on public.guest_seating to authenticated;
grant insert (event_id, show_guests) on public.guest_seating to authenticated;
grant update (show_guests) on public.guest_seating to authenticated;

-- what a household link sees: null while the organizers keep tables private; else its own people's table names
create or replace function public.household_seats(s text, tok text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h public.guest_households;
begin
  if tok is null or tok !~ '^[a-f0-9]{24}$' then return null; end if;
  select x.* into h from public.guest_households x join public.events e on e.id = x.event_id
    where x.token = tok and e.slug = s and e.published;
  if not found then return null; end if;
  if not coalesce((select z.show_guests from public.guest_seating z where z.event_id = h.event_id), false) then return null; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('person_id', p.id, 'table', t.name) order by p.sort, p.created_at)
                   from public.guest_people p join public.guest_tables t on t.id = p.table_id
                   where p.household_id = h.id), '[]'::jsonb);
end $$;

revoke execute on function public.guest_tables_check(), public.guest_people_table_check(), public.guest_seating_touch() from public, anon, authenticated;
revoke all on function public.household_seats(text, text) from public;
grant execute on function public.household_seats(text, text) to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.guest_tables, public.guest_seating to service_role;
  end if;
end $$;
