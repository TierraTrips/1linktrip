-- 1LinkTrip schema, part 10: shuttle runs. Safe to run more than once. Needs parts 1–9 (schema-6 guest list, schema-arrivals).
--
--   shuttle_runs     the page's runs: from → to, departure day + time, seats, vehicle, meeting point, notes (≤300 per page)
--   shuttle_riders   who rides which run (a guest of the page; one row per person per run). Seats are a warning, not a wall.
--
-- Who can do what:
--   • owner + accepted planners (ep_private.plans_event): everything
--   • a household link (token): reads ONLY the runs its own people ride (household_json → 'shuttles'): when, from, to,
--     meeting point, vehicle, notes and which of its people — never the other riders or the seat count
--   • everyone else: nothing

create extension if not exists pgcrypto;

create table if not exists public.shuttle_runs (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  name         text check (name is null or char_length(name) <= 60),
  from_place   text not null default '' check (char_length(from_place) <= 80),
  to_place     text not null default '' check (char_length(to_place) <= 80),
  depart_date  date,
  depart_time  text check (depart_time is null or depart_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  capacity     smallint not null default 8 check (capacity between 1 and 200),
  vehicle      text check (vehicle is null or char_length(vehicle) <= 80),
  meet         text check (meet is null or char_length(meet) <= 200),
  notes        text check (notes is null or char_length(notes) <= 300),
  sort         integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists shuttle_runs_event_idx on public.shuttle_runs (event_id, depart_date, depart_time);

create table if not exists public.shuttle_riders (
  run_id     uuid not null references public.shuttle_runs (id) on delete cascade,
  person_id  uuid not null references public.guest_people (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (run_id, person_id)
);
create index if not exists shuttle_riders_person_idx on public.shuttle_riders (person_id);
create index if not exists shuttle_riders_event_idx on public.shuttle_riders (event_id);

create or replace function public.shuttle_runs_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.event_id <> old.event_id then raise exception 'A run stays on its page' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' and (select count(*) from public.shuttle_runs r where r.event_id = new.event_id) >= 300 then
    raise exception 'A page can have up to 300 shuttle runs.' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists shuttle_runs_check on public.shuttle_runs;
create trigger shuttle_runs_check before insert or update on public.shuttle_runs for each row execute function public.shuttle_runs_check();

-- a rider is a guest of the run's page
create or replace function public.shuttle_riders_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select r.event_id into new.event_id from public.shuttle_runs r where r.id = new.run_id;
  if new.event_id is null then raise exception 'Unknown run' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.guest_people p where p.id = new.person_id and p.event_id = new.event_id) then
    raise exception 'Unknown guest' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists shuttle_riders_check on public.shuttle_riders;
create trigger shuttle_riders_check before insert or update on public.shuttle_riders for each row execute function public.shuttle_riders_check();

alter table public.shuttle_runs   enable row level security;
alter table public.shuttle_riders enable row level security;
drop policy if exists "shuttle_runs_planners" on public.shuttle_runs;
create policy "shuttle_runs_planners" on public.shuttle_runs for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
drop policy if exists "shuttle_riders_planners" on public.shuttle_riders;
create policy "shuttle_riders_planners" on public.shuttle_riders for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
revoke all on public.shuttle_runs, public.shuttle_riders from anon, authenticated;
grant select, delete on public.shuttle_runs, public.shuttle_riders to authenticated;
grant insert (id, event_id, name, from_place, to_place, depart_date, depart_time, capacity, vehicle, meet, notes, sort) on public.shuttle_runs to authenticated;
grant update (name, from_place, to_place, depart_date, depart_time, capacity, vehicle, meet, notes, sort) on public.shuttle_runs to authenticated;
grant insert (run_id, person_id, event_id) on public.shuttle_riders to authenticated;

-- what a household link sees: + 'shuttles' = the runs its own people ride
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
               from public.guest_travel g where g.household_id = h.id),
    'shuttles', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', r.id, 'name', r.name, 'from', r.from_place, 'to', r.to_place, 'date', r.depart_date, 'time', r.depart_time,
                   'vehicle', r.vehicle, 'meet', r.meet, 'notes', r.notes,
                   'people', (select jsonb_agg(x.person_id) from public.shuttle_riders x join public.guest_people p on p.id = x.person_id where x.run_id = r.id and p.household_id = h.id)))
                   order by r.depart_date nulls last, r.depart_time nulls last)
                 from public.shuttle_runs r where exists (select 1 from public.shuttle_riders x join public.guest_people p on p.id = x.person_id where x.run_id = r.id and p.household_id = h.id)), '[]'::jsonb))
  from public.guest_households h where h.id = hid
$$;

revoke all on all functions in schema ep_private from public;
grant execute on all functions in schema ep_private to anon, authenticated;
revoke execute on function public.shuttle_runs_check(), public.shuttle_riders_check() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.shuttle_runs, public.shuttle_riders to service_role;
  end if;
end $$;
