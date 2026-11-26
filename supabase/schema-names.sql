-- 1LinkTrip schema: page names — the pretty link https://1linktrip.com/<name> (Dylan 11/25: "customizable URLs").
-- Safe to run more than once. Needs parts 1 and 3 (events, ep_private). With part 6 (co-planners) accepted planners of a
-- page may set its name too; without it, only the owner.
--
--   page_names               one row per name a page has ever had. The page's current name has is_current; its older names
--                            stay as aliases that keep opening the same page (printed links never break) and stay taken.
--                            name is the primary key: one name, one page, across the whole site.
--   page_name_set(eid, nm)   the only way to give a page a name or change it (owner or accepted planner); validates the name
--                            (3–40 of a-z 0-9 -, not a reserved word), refuses a name another page has, keeps the old one as
--                            an alias. A page's own old name can be taken back.
--   page_name_check(nm, eid) live availability for the name field: ok | yours | alias | taken | reserved | invalid
--   page_name_resolve(nm)    what /<name> opens: the page's slug and its current name (published pages; and the signed-in
--                            organizer's own hidden page)
--   page_name_for(slug)      the current name of a published page (share sheets on ?e= links show the pretty link)
--   page_names_public()      every name of every published page with its title / description / image, for the link-preview
--                            pages (<name>.html) a GitHub Action writes into the site. Only what guests can already read.
-- The table itself: organizers read their own pages' names; nobody writes it directly (no insert/update/delete grants).

create table if not exists public.page_names (
  name        text primary key check (name ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' and position('--' in name) = 0),
  event_id    uuid not null references public.events (id) on delete cascade,
  is_current  boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists page_names_one_current on public.page_names (event_id) where is_current;
create index if not exists page_names_event_idx on public.page_names (event_id);

-- words that are app routes, site folders/files or would mislead (kept in step with NAME_RESERVED in app.js)
create or replace function ep_private.name_reserved(n text) returns boolean
language sql immutable set search_path = '' as $$
  select n = any (array[
    'about','account','accounts','admin','administrator','ai','api','app','apps','apple-touch-icon','assets','auth','billing',
    'blog','book','booking','brand','callback','cdn','contact','css','dashboard','demo','dns-inbound','docs','domain','download',
    'downloads','edit','email','event','events','example','examples','faq','favicon','files','fonts','google','guest','guests',
    'help','home','icon','icons','images','img','inbox','index','invite','invites','join','js','legal','linktrip','login',
    'logout','mail','manifest','me','mine','my','new','null','oauth','official','onelinktrip','page','pages','planner','planners',
    'pricing','privacy','proposal','public','register','resend','robots','root','rsvp','security','settings','setup','share',
    'shared','sign-in','sign-up','signin','signup','sitemap','static','status','support','supabase','sw','system','team','terms',
    'test','tests','trip','trips','undefined','upload','uploads','user','users','www','1linktrip','404','500'])
    or n ~ '(fuck|shit|cunt|nigg|fagg|rape|nazi)'
$$;

-- may the signed-in person name this page: its owner, or (with part 6) an accepted co-planner
create or replace function ep_private.can_name(eid uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare ok boolean := false;
begin
  if auth.uid() is null or eid is null then return false; end if;
  select exists (select 1 from public.events e where e.id = eid and e.owner = auth.uid()) into ok;
  if not ok and to_regprocedure('ep_private.plans_event(uuid)') is not null then
    execute 'select ep_private.plans_event($1)' into ok using eid;
  end if;
  return coalesce(ok, false);
end $$;

create or replace function public.page_name_check(nm text, eid uuid default null) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r public.page_names;
begin
  nm := lower(btrim(coalesce(nm, '')));
  if nm !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' or position('--' in nm) > 0 then return 'invalid'; end if;
  select * into r from public.page_names p where p.name = nm;
  if found then
    if eid is not null and r.event_id = eid and ep_private.can_name(eid) then return case when r.is_current then 'yours' else 'alias' end; end if;
    return 'taken';
  end if;
  if ep_private.name_reserved(nm) then return 'reserved'; end if;
  return 'ok';
end $$;

create or replace function public.page_name_set(eid uuid, nm text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare r public.page_names; st text;
begin
  if not ep_private.can_name(eid) then
    raise exception 'Only this page''s organizers can change its link.' using errcode = '42501';
  end if;
  nm := lower(btrim(coalesce(nm, '')));
  st := public.page_name_check(nm, eid);
  if st = 'invalid' then raise exception 'Use 3–40 letters, numbers or hyphens.' using errcode = 'P0001'; end if;
  if st = 'reserved' then raise exception 'That name is reserved. Try another.' using errcode = 'P0001'; end if;
  if st = 'taken' then raise exception 'That link is taken. Try another.' using errcode = 'P0001'; end if;
  if st = 'yours' then return nm; end if;
  if st = 'ok' and (select count(*) from public.page_names p where p.event_id = eid) >= 20 then
    raise exception 'A page can have up to 20 links.' using errcode = 'P0001';
  end if;
  -- one current name per page: the old one stays as an alias
  update public.page_names p set is_current = false where p.event_id = eid and p.is_current;
  if st = 'alias' then
    update public.page_names p set is_current = true where p.name = nm and p.event_id = eid;
  else
    begin
      insert into public.page_names (name, event_id, is_current) values (nm, eid, true);
    exception when unique_violation then
      raise exception 'That link is taken. Try another.' using errcode = 'P0001';
    end;
  end if;
  return nm;
end $$;

create or replace function public.page_name_resolve(nm text)
returns table (slug text, name text)
language sql stable security definer set search_path = '' as $$
  select e.slug, coalesce((select c.name from public.page_names c where c.event_id = e.id and c.is_current), p.name)
  from public.page_names p join public.events e on e.id = p.event_id
  where p.name = lower(btrim(coalesce(nm, ''))) and (e.published or ep_private.can_name(e.id))
$$;

create or replace function public.page_name_for(sl text) returns text
language sql stable security definer set search_path = '' as $$
  select p.name from public.events e join public.page_names p on p.event_id = e.id and p.is_current
  where e.slug = lower(btrim(coalesce(sl, ''))) and (e.published or ep_private.can_name(e.id))
$$;

create or replace function public.page_names_public()
returns table (name text, current_name text, slug text, title text, tagline text, description text, image text, start_at text, end_at text, place text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.name, c.name, e.slug,
    left(coalesce(e.config ->> 'title', ''), 200), left(coalesce(e.config ->> 'tagline', ''), 200),
    left(coalesce(e.config ->> 'description', ''), 400),
    case when coalesce(e.config ->> 'cover', '') ~ '^https://[^\s"<>]+$' then left(e.config ->> 'cover', 1000) else '' end,
    left(coalesce(e.config ->> 'start', ''), 25), left(coalesce(e.config ->> 'end', ''), 25),
    left(coalesce(e.config -> 'venue' ->> 'name', e.config -> 'venue' ->> 'q', ''), 160),
    e.updated_at
  from public.page_names p
  join public.events e on e.id = p.event_id
  join public.page_names c on c.event_id = e.id and c.is_current
  where e.published
  order by p.name
  limit 5000
$$;

alter table public.page_names enable row level security;
drop policy if exists "page_names_select_organizer" on public.page_names;
create policy "page_names_select_organizer" on public.page_names for select to authenticated
  using (ep_private.can_name(event_id));

revoke all on public.page_names from anon, authenticated;
grant select on public.page_names to authenticated;

revoke execute on function ep_private.name_reserved(text), ep_private.can_name(uuid) from public;
grant execute on function ep_private.name_reserved(text), ep_private.can_name(uuid) to anon, authenticated;
revoke execute on function public.page_name_check(text, uuid), public.page_name_set(uuid, text), public.page_name_resolve(text),
  public.page_name_for(text), public.page_names_public() from public;
grant execute on function public.page_name_check(text, uuid), public.page_name_set(uuid, text) to authenticated;
grant execute on function public.page_name_resolve(text), public.page_name_for(text), public.page_names_public() to anon, authenticated;
