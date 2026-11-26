-- 1LinkTrip schema, part 9: arrivals board. Safe to run more than once. Needs parts 1–8 (schema-6 guest list).
--
--   guest_travel     per household: arriving / departing (date, time, airport or station, flight or train number) and
--                    where they stay. Written by the household on its RSVP (household_travel) or by the organizers.
--   arrival_shares   a signed-in guest's opt-in "Share my arrival with the organizers" for one page. Only while this row
--                    exists can the organizers see that guest's own My trip flights / trains / hotel (arrivals_trips()).
--
-- Who can do what:
--   • owner + accepted planners (ep_private.plans_event): read / write guest_travel; arrivals_trips(eid) returns the
--     travel bookings (kind, name, flight number, times, from / to — nothing else) of guests who opted in, on that page only
--   • a household link (token): reads and writes ONLY its own travel row (household_json → 'travel', household_travel())
--   • a signed-in guest: switches their own opt-in on / off (arrival_share) and reads their own opt-in rows
--   • everyone else: nothing. A guest who never opted in (or switched it off) is never visible, whatever they booked.

create extension if not exists pgcrypto;

create table if not exists public.guest_travel (
  household_id  uuid primary key references public.guest_households (id) on delete cascade,
  event_id      uuid not null references public.events (id) on delete cascade,
  arr_date      date,
  arr_time      text check (arr_time is null or arr_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  arr_place     text check (arr_place is null or char_length(arr_place) <= 80),
  arr_no        text check (arr_no is null or char_length(arr_no) <= 24),
  dep_date      date,
  dep_time      text check (dep_time is null or dep_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  dep_place     text check (dep_place is null or char_length(dep_place) <= 80),
  dep_no        text check (dep_no is null or char_length(dep_no) <= 24),
  stay          text check (stay is null or char_length(stay) <= 160),
  updated_by    text not null default 'planner' check (updated_by in ('guest', 'planner')),
  updated_at    timestamptz not null default now()
);
create index if not exists guest_travel_event_idx on public.guest_travel (event_id);

-- the row's page is its household's page; stamp the time
create or replace function public.guest_travel_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select h.event_id into new.event_id from public.guest_households h where h.id = new.household_id;
  if new.event_id is null then raise exception 'Unknown household' using errcode = 'P0001'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guest_travel_check on public.guest_travel;
create trigger guest_travel_check before insert or update on public.guest_travel for each row execute function public.guest_travel_check();

alter table public.guest_travel enable row level security;
drop policy if exists "guest_travel_planners" on public.guest_travel;
create policy "guest_travel_planners" on public.guest_travel for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
revoke all on public.guest_travel from anon, authenticated;
grant select, delete on public.guest_travel to authenticated;
grant insert (household_id, event_id, arr_date, arr_time, arr_place, arr_no, dep_date, dep_time, dep_place, dep_no, stay) on public.guest_travel to authenticated;
grant update (arr_date, arr_time, arr_place, arr_no, dep_date, dep_time, dep_place, dep_no, stay) on public.guest_travel to authenticated;

-- ---------- opt-in: share my arrival (my own My trip bookings) with the organizers ----------
create table if not exists public.arrival_shares (
  event_id      uuid not null references public.events (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  household_id  uuid references public.guest_households (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.arrival_shares enable row level security;
drop policy if exists "arrival_shares_own" on public.arrival_shares;
create policy "arrival_shares_own" on public.arrival_shares for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.arrival_shares from anon, authenticated;
grant select on public.arrival_shares to authenticated;

-- switch it on / off for a published page. tok = the household link this guest came from (optional): ties the shared
-- bookings to that household on the board. Returns whether sharing is on now.
create or replace function public.arrival_share(s text, tok text, share boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare eid uuid; hid uuid; me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  select e.id into eid from public.events e where e.slug = s and e.published;
  if eid is null then raise exception 'This page isn''t available.' using errcode = 'P0001'; end if;
  if not share then delete from public.arrival_shares a where a.event_id = eid and a.user_id = me; return false; end if;
  if tok is not null and tok ~ '^[a-f0-9]{24}$' then select h.id into hid from public.guest_households h where h.token = tok and h.event_id = eid; end if;
  insert into public.arrival_shares as a (event_id, user_id, household_id) values (eid, me, hid)
    on conflict (event_id, user_id) do update set household_id = coalesce(excluded.household_id, a.household_id);
  return true;
end $$;

-- the organizers' view: for each guest who opted in on this page, their name, household and travel bookings only
create or replace function public.arrivals_trips(eid uuid)
returns table (user_id uuid, household_id uuid, name text, items jsonb)
language sql stable security definer set search_path = '' as $$
  select a.user_id,
    coalesce(a.household_id, (select h.id from public.guest_households h where h.event_id = eid and h.user_id = a.user_id limit 1)),
    ep_private.person_name(eid, a.user_id),
    coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind', t.item ->> 'kind', 'name', left(t.item ->> 'name', 120), 'flight', left(t.item ->> 'flight', 24),
        'start', left(t.item ->> 'start', 16), 'end', left(t.item ->> 'end', 16), 'from', left(t.item ->> 'from', 80), 'to', left(t.item ->> 'to', 80))) order by t.item ->> 'start')
      from public.trip_items t
      where t.owner = a.user_id and t.kind = 'booking' and t.page_key = substr(coalesce(e.config ->> 'ek', ''), 7)
        and t.item ->> 'kind' in ('flight', 'train', 'bus', 'ferry', 'car', 'hotel', 'stay')), '[]'::jsonb)
  from public.arrival_shares a join public.events e on e.id = a.event_id
  where a.event_id = eid and ep_private.plans_event(eid)
$$;

-- the household link's own travel (also returned inside household_json as 'travel'): t = { arr_date, arr_time, arr_place,
-- arr_no, dep_date, dep_time, dep_place, dep_no, stay } — empty strings clear a field; all empty removes the row
create or replace function public.household_travel(s text, tok text, t jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.guest_households; v text[] := '{}'; k text; ks text[] := array['arr_date','arr_time','arr_place','arr_no','dep_date','dep_time','dep_place','dep_no','stay'];
begin
  if tok is null or tok !~ '^[a-f0-9]{24}$' or jsonb_typeof(t) <> 'object' then raise exception 'Unknown request' using errcode = 'P0001'; end if;
  select x.* into h from public.guest_households x join public.events e on e.id = x.event_id where x.token = tok and e.slug = s and e.published;
  if not found then raise exception 'This link isn''t available.' using errcode = 'P0001'; end if;
  foreach k in array ks loop v := v || nullif(btrim(coalesce(t ->> k, '')), ''); end loop;
  if (select bool_and(x is null) from unnest(v) x) then delete from public.guest_travel g where g.household_id = h.id; return ep_private.household_json(h.id); end if;
  insert into public.guest_travel as g (household_id, event_id, arr_date, arr_time, arr_place, arr_no, dep_date, dep_time, dep_place, dep_no, stay, updated_by)
    values (h.id, h.event_id, v[1]::date, v[2], left(v[3], 80), left(v[4], 24), v[5]::date, v[6], left(v[7], 80), left(v[8], 24), left(v[9], 160), 'guest')
    on conflict (household_id) do update set arr_date = excluded.arr_date, arr_time = excluded.arr_time, arr_place = excluded.arr_place, arr_no = excluded.arr_no,
      dep_date = excluded.dep_date, dep_time = excluded.dep_time, dep_place = excluded.dep_place, dep_no = excluded.dep_no, stay = excluded.stay, updated_by = 'guest';
  return ep_private.household_json(h.id);
end $$;

-- what a household link sees (schema-6) + its own travel row
create or replace function ep_private.household_json(hid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', h.name, 'lang', h.lang, 'plus_ones', h.plus_ones,
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'plus_ones', p.plus_ones, 'age', p.age, 'plus_of', p.plus_of, 'added_by', p.added_by) order by p.sort, p.created_at)
                        from public.guest_people p where p.household_id = h.id), '[]'::jsonb),
    'replies', coalesce((select jsonb_agg(jsonb_build_object('person_id', r.person_id, 'attending', r.attending, 'note', r.note, 'at', r.created_at))
                         from public.rsvps r where r.household_id = h.id and r.person_id is not null), '[]'::jsonb),
    'travel', (select jsonb_strip_nulls(jsonb_build_object('arr_date', g.arr_date, 'arr_time', g.arr_time, 'arr_place', g.arr_place, 'arr_no', g.arr_no,
                 'dep_date', g.dep_date, 'dep_time', g.dep_time, 'dep_place', g.dep_place, 'dep_no', g.dep_no, 'stay', g.stay))
               from public.guest_travel g where g.household_id = h.id))
  from public.guest_households h where h.id = hid
$$;

revoke all on all functions in schema ep_private from public;
grant execute on all functions in schema ep_private to anon, authenticated;
revoke execute on function public.guest_travel_check() from public, anon, authenticated;
revoke all on function public.arrival_share(text, text, boolean), public.arrivals_trips(uuid), public.household_travel(text, text, jsonb) from public;
grant execute on function public.arrival_share(text, text, boolean), public.arrivals_trips(uuid) to authenticated;
grant execute on function public.household_travel(text, text, jsonb) to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.guest_travel, public.arrival_shares to service_role;
  end if;
end $$;
