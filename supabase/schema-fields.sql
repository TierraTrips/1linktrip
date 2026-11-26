-- 1LinkTrip schema, part 11: per-guest organizer fields. Safe to run more than once. Needs parts 1–10.
--
--   guest_fields         the page's own fields: label, kind (text / number / choice + its choices), who sees it
--                        (planners = organizers only; guest = also that guest on their household link), order (≤40)
--   guest_field_values   one value per field per guest (bib 214, wave B, badge Speaker, meal Fish …)
--   (table: the seating chart's guest_people.table_id stays the one place for tables; guests see it via household_seats)
--
-- Who can do what:
--   • owner + accepted planners (ep_private.plans_event): everything
--   • a household link (token): reads ONLY the "guest"-visible fields' values of its own people (household_json → 'fields');
--     never organizers-only fields, never anyone else's values
--   • everyone else: nothing

create extension if not exists pgcrypto;

create table if not exists public.guest_fields (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 60),
  kind        text not null default 'text' check (kind in ('text', 'number', 'choice')),
  choices     text[] not null default '{}' check (cardinality(choices) <= 30),
  visible     text not null default 'planners' check (visible in ('planners', 'guest')),
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists guest_fields_event_idx on public.guest_fields (event_id, sort);

create table if not exists public.guest_field_values (
  field_id    uuid not null references public.guest_fields (id) on delete cascade,
  person_id   uuid not null references public.guest_people (id) on delete cascade,
  event_id    uuid not null references public.events (id) on delete cascade,
  value       text not null check (char_length(value) between 1 and 200),
  updated_at  timestamptz not null default now(),
  primary key (field_id, person_id)
);
create index if not exists guest_field_values_event_idx on public.guest_field_values (event_id);
create index if not exists guest_field_values_person_idx on public.guest_field_values (person_id);

create or replace function public.guest_fields_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.event_id <> old.event_id then raise exception 'A field stays on its page' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' and (select count(*) from public.guest_fields f where f.event_id = new.event_id) >= 40 then
    raise exception 'A page can have up to 40 fields.' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(new.choices) c where char_length(c) not between 1 and 60) then raise exception 'Choices are 1–60 characters' using errcode = 'P0001'; end if;
  new.label := btrim(new.label);
  return new;
end $$;
drop trigger if exists guest_fields_check on public.guest_fields;
create trigger guest_fields_check before insert or update on public.guest_fields for each row execute function public.guest_fields_check();

-- a value belongs to a guest of the field's page, and fits the field's kind
create or replace function public.guest_field_values_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare f public.guest_fields;
begin
  select * into f from public.guest_fields x where x.id = new.field_id;
  if not found then raise exception 'Unknown field' using errcode = 'P0001'; end if;
  new.event_id := f.event_id; new.value := btrim(new.value); new.updated_at := now();
  if not exists (select 1 from public.guest_people p where p.id = new.person_id and p.event_id = f.event_id) then raise exception 'Unknown guest' using errcode = 'P0001'; end if;
  if f.kind = 'number' and new.value !~ '^-?[0-9]{1,12}([.,][0-9]{1,6})?$' then raise exception '% takes a number', f.label using errcode = 'P0001'; end if;
  if f.kind = 'choice' and not (new.value = any (f.choices)) then raise exception '% takes one of its choices', f.label using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists guest_field_values_check on public.guest_field_values;
create trigger guest_field_values_check before insert or update on public.guest_field_values for each row execute function public.guest_field_values_check();

alter table public.guest_fields       enable row level security;
alter table public.guest_field_values enable row level security;
drop policy if exists "guest_fields_planners" on public.guest_fields;
create policy "guest_fields_planners" on public.guest_fields for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
drop policy if exists "guest_field_values_planners" on public.guest_field_values;
create policy "guest_field_values_planners" on public.guest_field_values for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
revoke all on public.guest_fields, public.guest_field_values from anon, authenticated;
grant select, delete on public.guest_fields, public.guest_field_values to authenticated;
grant insert (id, event_id, label, kind, choices, visible, sort) on public.guest_fields to authenticated;
grant update (label, kind, choices, visible, sort) on public.guest_fields to authenticated;
grant insert (field_id, person_id, value) on public.guest_field_values to authenticated;
grant update (field_id, person_id, value) on public.guest_field_values to authenticated;

-- what a household link sees: + 'fields' = the guest-visible fields with their own people's values
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
                 from public.shuttle_runs r where exists (select 1 from public.shuttle_riders x join public.guest_people p on p.id = x.person_id where x.run_id = r.id and p.household_id = h.id)), '[]'::jsonb),
    'fields', coalesce((select jsonb_agg(jsonb_build_object('label', f.label, 'values',
                   (select jsonb_agg(jsonb_build_object('person_id', v.person_id, 'value', v.value)) from public.guest_field_values v join public.guest_people p on p.id = v.person_id where v.field_id = f.id and p.household_id = h.id))
                   order by f.sort, f.created_at)
                 from public.guest_fields f where f.event_id = h.event_id and f.visible = 'guest'
                   and exists (select 1 from public.guest_field_values v join public.guest_people p on p.id = v.person_id where v.field_id = f.id and p.household_id = h.id)), '[]'::jsonb))
  from public.guest_households h where h.id = hid
$$;

revoke all on all functions in schema ep_private from public;
grant execute on all functions in schema ep_private to anon, authenticated;
revoke execute on function public.guest_fields_check(), public.guest_field_values_check() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.guest_fields, public.guest_field_values to service_role;
  end if;
end $$;
