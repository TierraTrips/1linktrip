-- 1LinkTrip schema, part 12: volunteer sign-up slots (organizer → Volunteers). Safe to run more than once. Needs parts 1–11.
--
--   volunteer_slots     the page's tasks × shifts: task, shift label, day, start/end time, how many people it needs (≤200 per page)
--   volunteer_signups   who took a slot: name, optional email / phone (no money, no account)
--
-- Who can do what:
--   • owner + accepted planners (ep_private.plans_event): everything
--   • anyone with the page's sign-up link (published page, by slug): volunteer_board() = the slots with filled / needed counts
--     (never names or emails); volunteer_signup() = take one open place in one slot (refused when it's full or the same
--     email already has that slot)
--   • everyone else: nothing

create extension if not exists pgcrypto;

create table if not exists public.volunteer_slots (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  task        text not null check (char_length(btrim(task)) between 1 and 80),
  shift       text not null default '' check (char_length(shift) <= 80),
  day         date,
  starts      text check (starts is null or starts ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ends        text check (ends is null or ends ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  capacity    integer not null default 1 check (capacity between 1 and 500),
  notes       text check (notes is null or char_length(notes) <= 300),
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists volunteer_slots_event_idx on public.volunteer_slots (event_id, sort);

create table if not exists public.volunteer_signups (
  id          uuid primary key default gen_random_uuid(),
  slot_id     uuid not null references public.volunteer_slots (id) on delete cascade,
  event_id    uuid not null references public.events (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  email       text check (email is null or (char_length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  phone       text check (phone is null or char_length(phone) <= 40),
  created_at  timestamptz not null default now()
);
create index if not exists volunteer_signups_event_idx on public.volunteer_signups (event_id);
create index if not exists volunteer_signups_slot_idx on public.volunteer_signups (slot_id);
create unique index if not exists volunteer_signups_once on public.volunteer_signups (slot_id, lower(email)) where email is not null;

create or replace function public.volunteer_slots_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.event_id <> old.event_id then raise exception 'A slot stays on its page' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' and (select count(*) from public.volunteer_slots s where s.event_id = new.event_id) >= 200 then
    raise exception 'A page can have up to 200 volunteer slots.' using errcode = 'P0001'; end if;
  new.task := btrim(new.task); new.shift := btrim(new.shift);
  return new;
end $$;
drop trigger if exists volunteer_slots_check on public.volunteer_slots;
create trigger volunteer_slots_check before insert or update on public.volunteer_slots for each row execute function public.volunteer_slots_check();

-- a sign-up belongs to its slot's page
create or replace function public.volunteer_signups_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.volunteer_slots;
begin
  select * into s from public.volunteer_slots x where x.id = new.slot_id;
  if not found then raise exception 'Unknown slot' using errcode = 'P0001'; end if;
  new.event_id := s.event_id; new.name := btrim(new.name); new.email := nullif(lower(btrim(coalesce(new.email, ''))), ''); new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  return new;
end $$;
drop trigger if exists volunteer_signups_check on public.volunteer_signups;
create trigger volunteer_signups_check before insert or update on public.volunteer_signups for each row execute function public.volunteer_signups_check();

alter table public.volunteer_slots   enable row level security;
alter table public.volunteer_signups enable row level security;
drop policy if exists "volunteer_slots_planners" on public.volunteer_slots;
create policy "volunteer_slots_planners" on public.volunteer_slots for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
drop policy if exists "volunteer_signups_planners" on public.volunteer_signups;
create policy "volunteer_signups_planners" on public.volunteer_signups for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
revoke all on public.volunteer_slots, public.volunteer_signups from anon, authenticated;
grant select, delete on public.volunteer_slots, public.volunteer_signups to authenticated;
grant insert (id, event_id, task, shift, day, starts, ends, capacity, notes, sort) on public.volunteer_slots to authenticated;
grant update (task, shift, day, starts, ends, capacity, notes, sort) on public.volunteer_slots to authenticated;
grant insert (id, slot_id, name, email, phone) on public.volunteer_signups to authenticated;
grant update (name, email, phone) on public.volunteer_signups to authenticated;

-- the sign-up sheet: a published page's slots with how many have signed up (no names)
create or replace function public.volunteer_board(s text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', v.id, 'task', v.task, 'shift', nullif(v.shift, ''), 'day', v.day, 'starts', v.starts, 'ends', v.ends,
           'capacity', v.capacity, 'notes', v.notes, 'filled', (select count(*) from public.volunteer_signups x where x.slot_id = v.id)))
         order by v.sort, v.day nulls last, v.starts nulls last, v.created_at), '[]'::jsonb)
  from public.volunteer_slots v join public.events e on e.id = v.event_id
  where e.slug = s and e.published
$$;

-- take one place: the slot must be on that published page and not full; one sign-up per email per slot
create or replace function public.volunteer_signup(s text, slot uuid, nm text, em text, ph text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.volunteer_slots; n integer;
begin
  select x.* into v from public.volunteer_slots x join public.events e on e.id = x.event_id where x.id = slot and e.slug = s and e.published for update of x;
  if not found then raise exception 'This sign-up isn''t available.' using errcode = 'P0001'; end if;
  if nm is null or char_length(btrim(nm)) not between 1 and 120 then raise exception 'Add your name' using errcode = 'P0001'; end if;
  if (select count(*) from public.volunteer_signups x where x.event_id = v.event_id) >= 5000 then raise exception 'Sign-ups are closed.' using errcode = 'P0001'; end if;
  select count(*) into n from public.volunteer_signups x where x.slot_id = v.id;
  if n >= v.capacity then raise exception 'That shift is full.' using errcode = 'P0001'; end if;
  if nullif(btrim(coalesce(em, '')), '') is not null and exists (select 1 from public.volunteer_signups x where x.slot_id = v.id and x.email = lower(btrim(em))) then
    raise exception 'You''re already signed up for that shift.' using errcode = 'P0001'; end if;
  insert into public.volunteer_signups (slot_id, event_id, name, email, phone) values (v.id, v.event_id, left(btrim(nm), 120), left(nullif(btrim(coalesce(em, '')), ''), 254), left(nullif(btrim(coalesce(ph, '')), ''), 40));
  return public.volunteer_board(s);
end $$;

revoke all on function public.volunteer_board(text), public.volunteer_signup(text, uuid, text, text, text) from public;
grant execute on function public.volunteer_board(text), public.volunteer_signup(text, uuid, text, text, text) to anon, authenticated;
revoke execute on function public.volunteer_slots_check(), public.volunteer_signups_check() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.volunteer_slots, public.volunteer_signups to service_role;
  end if;
end $$;
