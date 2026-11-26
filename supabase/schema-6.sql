-- 1LinkTrip schema, part 6: co-planners, the household guest list (personal links, opens, household RSVP, plus-ones,
-- groups), who changed what. Safe to run more than once. Needs parts 1–5.
--
--   page_planners     people the owner invited to plan a page with them, by email. Once they accept (signed in with that
--                     CONFIRMED email) they read and change the page like the owner — but cannot delete it, change its
--                     link, transfer it, or invite / remove planners.
--   page_activity     who changed which part of a page, written by the server on every change (owner + planners read it)
--   guest_households  the guest list, one row per household: name, language, plus-ones allowed, group, and the personal
--                     link token (?e=<slug>&g=<token>); first / last opened are recorded on the server when the link opens
--   guest_people      the guests in each household (plus-ones a guest adds become guests of the same household)
--   page_opens        opens of the page's plain link (no personal token): a count per day, nothing about who
--   rsvps             + person_id / household_id: one reply per person on a household link (attending, events, diet)
--
-- Who can do what is decided here, by Row Level Security and security-definer functions:
--   • owner + accepted planners: everything on the guest list, replies, updates, groups, messages, vendors
--   • a household link (token) reads and answers ONLY its own household, through household_get / household_rsvp
--   • everyone else: nothing (anon has no table access to any of the new tables)

create extension if not exists pgcrypto;

-- ---------- co-planners ----------
create table if not exists public.page_planners (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  email        text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254 and position('@' in email) > 1),
  name         text not null default '' check (char_length(name) <= 60),
  token        text not null unique default encode(gen_random_bytes(16), 'hex') check (token ~ '^[a-f0-9]{32}$'),
  user_id      uuid references auth.users (id) on delete cascade,
  invited_by   uuid default auth.uid() references auth.users (id) on delete set null,
  accepted_at  timestamptz,
  notified_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (event_id, email)
);
create index if not exists page_planners_user_idx on public.page_planners (user_id);

-- the signed-in person owns the page, or is an accepted planner of it with the email they were invited at
create or replace function ep_private.plans_event(eid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.events e where e.id = eid and e.owner = auth.uid())
      or exists (select 1 from public.page_planners p
                 where p.event_id = eid and p.user_id = auth.uid() and p.accepted_at is not null and p.email = ep_private.my_email())
$$;

-- invites are made by the owner; the server fills in who / when, and never invites the owner to their own page
create or replace function public.page_planners_fill() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.invited_by := auth.uid(); new.user_id := null; new.accepted_at := null; new.notified_at := null; new.created_at := now();
  new.name := btrim(coalesce(new.name, ''));
  if exists (select 1 from public.events e join auth.users u on u.id = e.owner where e.id = new.event_id and lower(u.email) = new.email) then
    raise exception 'That''s the page owner''s email.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.page_planners p where p.event_id = new.event_id) >= 20 then
    raise exception 'A page can have up to 20 planners.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists page_planners_fill on public.page_planners;
create trigger page_planners_fill before insert on public.page_planners for each row execute function public.page_planners_fill();

alter table public.page_planners enable row level security;
drop policy if exists "page_planners_select" on public.page_planners;
create policy "page_planners_select" on public.page_planners for select to authenticated
  using (ep_private.plans_event(event_id) or email = ep_private.my_email());
drop policy if exists "page_planners_insert_owner" on public.page_planners;
create policy "page_planners_insert_owner" on public.page_planners for insert to authenticated
  with check (ep_private.owns_event(event_id));
drop policy if exists "page_planners_update_owner" on public.page_planners;
create policy "page_planners_update_owner" on public.page_planners for update to authenticated
  using (ep_private.owns_event(event_id)) with check (ep_private.owns_event(event_id));
-- the owner removes anyone; a planner leaves; an invitee declines
drop policy if exists "page_planners_delete" on public.page_planners;
create policy "page_planners_delete" on public.page_planners for delete to authenticated
  using (ep_private.owns_event(event_id) or user_id = (select auth.uid()) or email = ep_private.my_email());

revoke all on public.page_planners from anon, authenticated;
grant select, delete on public.page_planners to authenticated;
grant insert (event_id, email, name) on public.page_planners to authenticated;
grant update (name) on public.page_planners to authenticated;

-- events: planners read and change the page (not delete it: that policy stays owner-only); its link never changes for them
drop policy if exists "events_select_published_or_own" on public.events;
create policy "events_select_published_or_own" on public.events for select to anon, authenticated
  using (published or owner = (select auth.uid()) or ep_private.plans_event(id));
drop policy if exists "events_update_planner" on public.events;
create policy "events_update_planner" on public.events for update to authenticated
  using (ep_private.plans_event(id)) with check (ep_private.plans_event(id));
create or replace function public.events_keep_slug() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is distinct from old.owner then new.slug := old.slug; end if;
  return new;
end $$;
drop trigger if exists events_keep_slug on public.events;
create trigger events_keep_slug before update on public.events for each row execute function public.events_keep_slug();

-- accept an invite: signed in with the invited, confirmed email
create or replace function public.planner_accept(tok text)
returns table (event_id uuid, slug text)
language plpgsql security definer set search_path = '' as $$
declare p public.page_planners; me text := ep_private.my_email();
begin
  if auth.uid() is null or me is null then raise exception 'Sign in first.' using errcode = 'P0001'; end if;
  select * into p from public.page_planners x where tok ~ '^[a-f0-9]{32}$' and x.token = tok;
  if not found then raise exception 'This invite was removed.' using errcode = 'P0001'; end if;
  if p.email <> me then
    raise exception 'This invite is for %', regexp_replace(p.email, '^(.)[^@]*', '\1•••') using errcode = 'P0001';
  end if;
  update public.page_planners x set user_id = auth.uid(), accepted_at = coalesce(x.accepted_at, now()) where x.id = p.id;
  return query select e.id, e.slug from public.events e where e.id = p.event_id;
end $$;

-- what an invite link shows before signing in: the page's title and a hint of the invited email
create or replace function public.planner_invite_info(tok text)
returns table (title text, email_hint text, accepted boolean)
language sql stable security definer set search_path = '' as $$
  select left(coalesce(e.config ->> 'title', ''), 120), regexp_replace(p.email, '^(.)[^@]*', '\1•••'), p.accepted_at is not null
  from public.page_planners p join public.events e on e.id = p.event_id
  where tok ~ '^[a-f0-9]{32}$' and p.token = tok
$$;

-- invites waiting for the signed-in person (My pages)
create or replace function public.planner_pending()
returns table (token text, event_id uuid, title text)
language sql stable security definer set search_path = '' as $$
  select p.token, p.event_id, left(coalesce(e.config ->> 'title', ''), 120)
  from public.page_planners p join public.events e on e.id = p.event_id
  where p.accepted_at is null and p.email = ep_private.my_email()
  order by p.created_at desc limit 50
$$;

-- a display name for a person: the name the owner gave them, else their account's name, else their email's first part
create or replace function ep_private.person_name(eid uuid, uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    nullif((select p.name from public.page_planners p where p.event_id = eid and p.user_id = uid limit 1), ''),
    nullif((select btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')) from auth.users u where u.id = uid), ''),
    (select split_part(u.email, '@', 1) from auth.users u where u.id = uid), '')
$$;

-- the team of a page: owner first, then planners (owner + planners only). The invite token only for the owner.
create or replace function public.page_team(eid uuid)
returns table (id uuid, role text, name text, email text, joined boolean, me boolean, token text)
language sql stable security definer set search_path = '' as $$
  select null::uuid, 'owner', ep_private.person_name(e.id, e.owner), lower(u.email), true, e.owner = auth.uid(), null::text
  from public.events e join auth.users u on u.id = e.owner
  where e.id = eid and ep_private.plans_event(eid)
  union all
  select * from (select p.id, 'planner', case when p.user_id is null then p.name else ep_private.person_name(p.event_id, p.user_id) end, p.email,
         p.accepted_at is not null, p.user_id is not distinct from auth.uid() and p.user_id is not null,
         case when ep_private.owns_event(eid) then p.token end
  from public.page_planners p where p.event_id = eid and ep_private.plans_event(eid) order by p.created_at) x
$$;

-- ---------- who changed what ----------
create table if not exists public.page_activity (
  id          bigint generated always as identity primary key,
  event_id    uuid not null references public.events (id) on delete cascade,
  actor       uuid references auth.users (id) on delete set null,
  actor_name  text not null default '',
  keys        text[] not null default '{}',
  at          timestamptz not null default now()
);
create index if not exists page_activity_event_idx on public.page_activity (event_id, id desc);

-- the parts of a page that differ: f:<field> for page fields, sc:<id> for changed / added schedule items, sc-:<id> removed
create or replace function ep_private.config_diff(a jsonb, b jsonb) returns text[]
language sql immutable set search_path = '' as $$
  with sa as (select x from jsonb_array_elements(case when jsonb_typeof(a -> 'schedule') = 'array' then a -> 'schedule' else '[]'::jsonb end) x),
       sb as (select x from jsonb_array_elements(case when jsonb_typeof(b -> 'schedule') = 'array' then b -> 'schedule' else '[]'::jsonb end) x),
       ks as (select jsonb_object_keys(case when jsonb_typeof(a) = 'object' then a else '{}'::jsonb end) k
              union select jsonb_object_keys(case when jsonb_typeof(b) = 'object' then b else '{}'::jsonb end))
  select coalesce(array_agg(d order by d), '{}') from (
    select 'f:' || k d from ks where k not in ('schedule', 'osm', 'tr', 'ek', 'v') and k !~ '^_' and (a -> k) is distinct from (b -> k)
    union select 'sc:' || (sb.x ->> 'id') from sb where jsonb_typeof(sb.x -> 'id') = 'string' and not exists (select 1 from sa where sa.x = sb.x)
    union select 'sc-:' || (sa.x ->> 'id') from sa where jsonb_typeof(sa.x -> 'id') = 'string'
      and not exists (select 1 from sb where sb.x ->> 'id' = sa.x ->> 'id')) z
$$;

create or replace function public.events_log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); ks text[]; last public.page_activity;
begin
  if uid is null or new.config is not distinct from old.config then return null; end if;
  ks := ep_private.config_diff(old.config, new.config);
  if cardinality(ks) = 0 then return null; end if;
  ks := ks[1:60];
  select * into last from public.page_activity a where a.event_id = new.id order by a.id desc limit 1;
  if found and last.actor = uid and last.at > now() - interval '10 minutes' then -- one entry per person per sitting
    update public.page_activity a set keys = (select array(select distinct v from unnest(last.keys || ks) v limit 80)), at = now() where a.id = last.id;
  else
    insert into public.page_activity (event_id, actor, actor_name, keys) values (new.id, uid, left(ep_private.person_name(new.id, uid), 60), ks);
    delete from public.page_activity a where a.event_id = new.id and a.id <= (select a2.id from public.page_activity a2 where a2.event_id = new.id order by a2.id desc offset 200 limit 1);
  end if;
  return null;
end $$;
drop trigger if exists events_log_change on public.events;
create trigger events_log_change after update on public.events for each row execute function public.events_log_change();

alter table public.page_activity enable row level security;
drop policy if exists "page_activity_select" on public.page_activity;
create policy "page_activity_select" on public.page_activity for select to authenticated using (ep_private.plans_event(event_id));
revoke all on public.page_activity from anon, authenticated;
grant select on public.page_activity to authenticated;

-- ---------- planners share the organizer's tools (replaces owner-only policies from parts 1, 3 and 4) ----------
drop policy if exists "rsvps_select_owner" on public.rsvps;
create policy "rsvps_select_owner" on public.rsvps for select to authenticated using (ep_private.plans_event(event_id));

drop policy if exists "announcements_select" on public.announcements;
create policy "announcements_select" on public.announcements for select to anon, authenticated
  using (ep_private.plans_event(event_id)
         or (ep_private.event_published(event_id) and (cardinality(group_ids) = 0 or ep_private.in_groups(event_id, group_ids))));
drop policy if exists "announcements_insert_owner" on public.announcements;
create policy "announcements_insert_owner" on public.announcements for insert to authenticated
  with check (ep_private.plans_event(event_id) and ep_private.groups_of_event(event_id, group_ids));
drop policy if exists "announcements_update_owner" on public.announcements;
create policy "announcements_update_owner" on public.announcements for update to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id) and ep_private.groups_of_event(event_id, group_ids));
drop policy if exists "announcements_delete_owner" on public.announcements;
create policy "announcements_delete_owner" on public.announcements for delete to authenticated using (ep_private.plans_event(event_id));

drop policy if exists "event_groups_select" on public.event_groups;
create policy "event_groups_select" on public.event_groups for select to anon, authenticated
  using (ep_private.plans_event(event_id) or (self_pick and ep_private.event_published(event_id)) or ep_private.is_member(id));
drop policy if exists "event_groups_write_owner" on public.event_groups;
create policy "event_groups_write_owner" on public.event_groups for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
drop policy if exists "event_group_members_select" on public.event_group_members;
create policy "event_group_members_select" on public.event_group_members for select to authenticated
  using (ep_private.plans_event(event_id) or email = ep_private.my_email());
drop policy if exists "event_group_members_insert" on public.event_group_members;
create policy "event_group_members_insert" on public.event_group_members for insert to authenticated
  with check (ep_private.plans_event(event_id)
              or (added_by = 'guest' and email = ep_private.my_email() and ep_private.group_pickable(group_id, event_id)));
drop policy if exists "event_group_members_delete" on public.event_group_members;
create policy "event_group_members_delete" on public.event_group_members for delete to authenticated
  using (ep_private.plans_event(event_id) or (added_by = 'guest' and email = ep_private.my_email()));

drop policy if exists "event_messages_select" on public.event_messages;
create policy "event_messages_select" on public.event_messages for select to authenticated
  using (guest = (select auth.uid()) or ep_private.plans_event(event_id));
drop policy if exists "event_messages_insert_host" on public.event_messages;
create policy "event_messages_insert_host" on public.event_messages for insert to authenticated
  with check (from_host and ep_private.plans_event(event_id) and ep_private.thread_exists(event_id, guest));

drop policy if exists "event_private_owner" on public.event_private;
create policy "event_private_owner" on public.event_private for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));

-- ---------- the guest list: households ----------
create table if not exists public.guest_households (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  token            text not null unique default encode(gen_random_bytes(12), 'hex') check (token ~ '^[a-f0-9]{24}$'),
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  lang             text not null default '' check (lang ~ '^([a-z]{2,3}(-[a-z]{2,4})?)?$'),
  plus_ones        smallint not null default 0 check (plus_ones between 0 and 10),
  greeting         text not null default 'household' check (greeting in ('household', 'names')),
  group_id         uuid references public.event_groups (id) on delete set null,
  email            text check (email is null or (email = lower(btrim(email)) and char_length(email) between 3 and 254 and position('@' in email) > 1)),
  phone            text check (phone is null or char_length(phone) between 3 and 40),
  address          text check (address is null or char_length(address) <= 300),
  sort             integer not null default 0,
  user_id          uuid references auth.users (id) on delete set null,
  first_opened_at  timestamptz,
  last_opened_at   timestamptz,
  opens            integer not null default 0,
  notified_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists guest_households_event_idx on public.guest_households (event_id, sort);

create table if not exists public.guest_people (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.guest_households (id) on delete cascade,
  event_id      uuid not null references public.events (id) on delete cascade,
  name          text not null default '' check (char_length(name) <= 120),
  plus_ones     smallint not null default 0 check (plus_ones between 0 and 5),
  age           text not null default 'adult' check (age in ('adult', 'child', 'infant')),
  plus_of       uuid references public.guest_people (id) on delete cascade,
  added_by      text not null default 'host' check (added_by in ('host', 'guest')),
  group_id      uuid references public.event_groups (id) on delete set null,
  sort          integer not null default 0,
  created_at    timestamptz not null default now()
);
-- (first version of this file, applied once: plus_one boolean → plus_ones count; age; greeting)
alter table public.guest_households add column if not exists greeting text not null default 'household' check (greeting in ('household', 'names'));
alter table public.guest_people add column if not exists plus_ones smallint not null default 0 check (plus_ones between 0 and 5);
alter table public.guest_people add column if not exists age text not null default 'adult' check (age in ('adult', 'child', 'infant'));
alter table public.guest_people drop column if exists plus_one;
create index if not exists guest_people_household_idx on public.guest_people (household_id, sort);
create index if not exists guest_people_event_idx on public.guest_people (event_id);
-- seating (a later phase) will add guest_tables (event_id, name, capacity, sort) and guest_people.table_id / seat

-- the household's page / group belong together; a person's page is their household's
create or replace function public.guest_households_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.group_id is not null and not exists (select 1 from public.event_groups g where g.id = new.group_id and g.event_id = new.event_id) then
    raise exception 'Unknown group' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' then
    new.first_opened_at := null; new.last_opened_at := null; new.opens := 0; new.user_id := null; new.notified_at := null;
    if (select count(*) from public.guest_households h where h.event_id = new.event_id) >= 2000 then
      raise exception 'A page can have up to 2000 households.' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
drop trigger if exists guest_households_check on public.guest_households;
create trigger guest_households_check before insert or update on public.guest_households for each row execute function public.guest_households_check();

create or replace function public.guest_people_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select h.event_id into new.event_id from public.guest_households h where h.id = new.household_id;
  if new.event_id is null then raise exception 'Unknown household' using errcode = 'P0001'; end if;
  if new.group_id is not null and not exists (select 1 from public.event_groups g where g.id = new.group_id and g.event_id = new.event_id) then
    raise exception 'Unknown group' using errcode = 'P0001'; end if;
  if new.plus_of is not null and not exists (select 1 from public.guest_people p where p.id = new.plus_of and p.event_id = new.event_id) then
    raise exception 'Unknown guest' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' and (select count(*) from public.guest_people p where p.household_id = new.household_id) >= 30 then
    raise exception 'A household can have up to 30 guests.' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists guest_people_check on public.guest_people;
create trigger guest_people_check before insert or update on public.guest_people for each row execute function public.guest_people_check();

alter table public.guest_households enable row level security;
alter table public.guest_people     enable row level security;
drop policy if exists "guest_households_planners" on public.guest_households;
create policy "guest_households_planners" on public.guest_households for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
drop policy if exists "guest_people_planners" on public.guest_people;
create policy "guest_people_planners" on public.guest_people for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));

revoke all on public.guest_households, public.guest_people from anon, authenticated;
grant select, delete on public.guest_households to authenticated;
grant insert (id, event_id, name, lang, plus_ones, greeting, group_id, email, phone, address, sort) on public.guest_households to authenticated;
grant update (name, lang, plus_ones, greeting, group_id, email, phone, address, sort) on public.guest_households to authenticated;
grant select, delete on public.guest_people to authenticated;
grant insert (id, household_id, name, plus_ones, age, plus_of, group_id, sort) on public.guest_people to authenticated;
grant update (household_id, name, plus_ones, age, group_id, sort) on public.guest_people to authenticated;

-- ---------- replies per person ----------
alter table public.rsvps add column if not exists person_id uuid references public.guest_people (id) on delete cascade;
alter table public.rsvps add column if not exists household_id uuid references public.guest_households (id) on delete cascade;
create unique index if not exists rsvps_person_idx on public.rsvps (person_id) where person_id is not null;
-- the open RSVP form keeps working; only household_rsvp() (below) writes person / household replies
revoke insert on public.rsvps from anon, authenticated;
grant insert (event_id, name, email, attending, guests, note, group_id) on public.rsvps to anon, authenticated;

-- ---------- opens ----------
create table if not exists public.page_opens (
  event_id  uuid not null references public.events (id) on delete cascade,
  day       date not null,
  n         integer not null default 0,
  primary key (event_id, day)
);
alter table public.page_opens enable row level security;
drop policy if exists "page_opens_select" on public.page_opens;
create policy "page_opens_select" on public.page_opens for select to authenticated using (ep_private.plans_event(event_id));
revoke all on public.page_opens from anon, authenticated;
grant select on public.page_opens to authenticated;

-- the plain link was opened (once per device per day, the app's side); the organizers' own opens don't count
create or replace function public.page_open(s text) returns void
language plpgsql security definer set search_path = '' as $$
declare eid uuid;
begin
  select e.id into eid from public.events e where e.slug = s and e.published;
  if eid is null or ep_private.plans_event(eid) then return; end if;
  insert into public.page_opens as o (event_id, day, n) values (eid, current_date, 1)
    on conflict (event_id, day) do update set n = least(o.n + 1, 1000000);
end $$;

-- what a household link sees: its own household and replies only
create or replace function ep_private.household_json(hid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', h.name, 'lang', h.lang, 'plus_ones', h.plus_ones,
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'plus_ones', p.plus_ones, 'age', p.age, 'plus_of', p.plus_of, 'added_by', p.added_by) order by p.sort, p.created_at)
                        from public.guest_people p where p.household_id = h.id), '[]'::jsonb),
    'replies', coalesce((select jsonb_agg(jsonb_build_object('person_id', r.person_id, 'attending', r.attending, 'note', r.note, 'at', r.created_at))
                         from public.rsvps r where r.household_id = h.id and r.person_id is not null), '[]'::jsonb))
  from public.guest_households h where h.id = hid
$$;

-- open a household link: records the open (unless an organizer of the page opens it) and returns that household
create or replace function public.household_get(s text, tok text, record boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.guest_households;
begin
  if tok is null or tok !~ '^[a-f0-9]{24}$' then return null; end if;
  select x.* into h from public.guest_households x join public.events e on e.id = x.event_id
    where x.token = tok and e.slug = s and e.published;
  if not found then return null; end if;
  if record and not ep_private.plans_event(h.event_id) then
    update public.guest_households x set first_opened_at = coalesce(x.first_opened_at, now()), last_opened_at = now(),
      opens = x.opens + case when x.last_opened_at is null or x.last_opened_at < now() - interval '30 minutes' then 1 else 0 end,
      user_id = coalesce(x.user_id, auth.uid())
    where x.id = h.id;
  end if;
  return ep_private.household_json(h.id);
end $$;

-- a household answers: replies = [{ person_id, attending, note, seen }] for its people, { plus_of, name, attending, note } to
-- add a plus-one (for a guest allowed some, or the household's own plus-ones), { person_id, remove: true } to drop a plus-one
-- they added. Anything that isn't theirs is refused. Each person's answer is their own row (the last answer wins per person);
-- `seen` = the answer's time when the form was opened: an answer changed since then (another member replied meanwhile) is
-- not overwritten — it comes back in `conflicts` for the guest to look at.
create or replace function public.household_rsvp(s text, tok text, replies jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.guest_households; r jsonb; p public.guest_people; pid uuid; nm text; nt text; att boolean; cur public.rsvps; clash uuid[] := '{}';
begin
  if tok is null or tok !~ '^[a-f0-9]{24}$' or jsonb_typeof(replies) <> 'array' or jsonb_array_length(replies) > 40 then
    raise exception 'Unknown request' using errcode = 'P0001'; end if;
  select x.* into h from public.guest_households x join public.events e on e.id = x.event_id
    where x.token = tok and e.slug = s and e.published;
  if not found then raise exception 'This link isn''t available.' using errcode = 'P0001'; end if;
  for r in select * from jsonb_array_elements(replies) loop
    nt := left(nullif(r ->> 'note', ''), 1000); att := coalesce((r ->> 'attending')::boolean, true);
    if r ? 'person_id' then
      select * into p from public.guest_people x where x.id = (r ->> 'person_id')::uuid and x.household_id = h.id;
      if not found then raise exception 'Not in this household' using errcode = 'P0001'; end if;
      if coalesce((r ->> 'remove')::boolean, false) then
        if p.added_by <> 'guest' then raise exception 'Only a plus-one you added can be removed' using errcode = 'P0001'; end if;
        delete from public.guest_people x where x.id = p.id; continue;
      end if;
      select * into cur from public.rsvps x where x.person_id = p.id;
      if found and (nullif(r ->> 'seen', '') is null or cur.created_at > (r ->> 'seen')::timestamptz + interval '1 millisecond')
         and (cur.attending is distinct from att or cur.note is distinct from nt) then
        clash := clash || p.id; continue;
      end if;
      if p.added_by = 'guest' and nullif(btrim(r ->> 'name'), '') is not null then
        update public.guest_people x set name = left(btrim(r ->> 'name'), 120) where x.id = p.id; p.name := left(btrim(r ->> 'name'), 120);
      end if;
      pid := p.id; nm := p.name;
    else
      nm := left(btrim(coalesce(r ->> 'name', '')), 120);
      if nm = '' then continue; end if;
      if r ? 'plus_of' and r ->> 'plus_of' is not null then
        if (select count(*) from public.guest_people x where x.plus_of = (r ->> 'plus_of')::uuid)
           >= coalesce((select x.plus_ones from public.guest_people x where x.id = (r ->> 'plus_of')::uuid and x.household_id = h.id and x.added_by = 'host'), 0) then
          raise exception 'No plus-one for that guest' using errcode = 'P0001'; end if;
        insert into public.guest_people (household_id, event_id, name, plus_of, added_by, sort)
          values (h.id, h.event_id, nm, (r ->> 'plus_of')::uuid, 'guest', 900) returning id into pid;
      else
        if (select count(*) from public.guest_people x where x.household_id = h.id and x.added_by = 'guest' and x.plus_of is null) >= h.plus_ones then
          raise exception 'No more plus-ones for this household' using errcode = 'P0001'; end if;
        insert into public.guest_people (household_id, event_id, name, added_by, sort) values (h.id, h.event_id, nm, 'guest', 950) returning id into pid;
      end if;
    end if;
    if nm = '' then nm := h.name; end if;
    insert into public.rsvps (event_id, name, attending, guests, note, person_id, household_id)
      values (h.event_id, nm, att, case when att then 1 else 0 end, nt, pid, h.id)
      on conflict (person_id) where person_id is not null
      do update set name = excluded.name, attending = excluded.attending, guests = excluded.guests, note = excluded.note, created_at = now();
  end loop;
  return ep_private.household_json(h.id) || jsonb_build_object('conflicts', to_jsonb(clash));
end $$;

-- the organizers' view of hotels: per household, whether the guest who opened the link (signed in, synced) has a hotel.
-- null = unknown (nobody signed in opened it). Never anything about the booking itself.
create or replace function public.household_hotels(eid uuid)
returns table (id uuid, has_hotel boolean)
language sql stable security definer set search_path = '' as $$
  select h.id, case when h.user_id is null then null else exists (
      select 1 from public.trip_items t where t.owner = h.user_id and t.page_key = substr(coalesce(e.config ->> 'ek', ''), 7)
        and t.kind = 'booking' and t.item ->> 'kind' = 'hotel') end
  from public.guest_households h join public.events e on e.id = h.event_id
  where h.event_id = eid and ep_private.plans_event(eid)
$$;

-- ---------- grants for functions ----------
revoke all on all functions in schema ep_private from public;
grant execute on all functions in schema ep_private to anon, authenticated;
revoke execute on function public.page_planners_fill(), public.events_keep_slug(), public.events_log_change(),
  public.guest_households_check(), public.guest_people_check() from public, anon, authenticated;
revoke all on function public.planner_accept(text), public.planner_invite_info(text), public.planner_pending(), public.page_team(uuid),
  public.page_open(text), public.household_get(text, text, boolean), public.household_rsvp(text, text, jsonb), public.household_hotels(uuid) from public;
grant execute on function public.planner_accept(text), public.planner_pending(), public.page_team(uuid), public.household_hotels(uuid) to authenticated;
grant execute on function public.planner_invite_info(text), public.page_open(text), public.household_get(text, text, boolean),
  public.household_rsvp(text, text, jsonb) to anon, authenticated;

-- the server's own role (the notify function) reads and marks invites
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.page_planners, public.page_activity, public.guest_households, public.guest_people, public.page_opens to service_role;
  end if;
end $$;
