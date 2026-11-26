-- 1LinkTrip schema, part 8: invitations. Safe to run more than once. Needs parts 1–7.
--
--   invitations      a page's invitation designs: one "invitation" and one "save the date" per page. Either built from a
--                    template (design = the structured data: template, texts, per-language texts, font, colors, photo) or
--                    an uploaded design. images = the rendered picture per language: { "en": { "path", "w", "h" }, … }
--                    (files in the public 'invitations' storage bucket, under <event id>/…, random names).
--   invite_sends     one row per invitation sent to a household: by email (queued → sending → sent → delivered / bounced,
--                    written only by the notify function with the server's key) or by text (recorded by the planner's app
--                    when they open the text / share sheet). Queued emails wait for the daily email allowance.
--   email_usage      the email allowance the server has observed (Resend's quota headers) + email_log (what it sent):
--                    server-only, never readable by anyone signed in.
--
-- Who can do what:
--   • owner + accepted planners (ep_private.plans_event): make, change and delete designs; upload their images; read every
--     send; record text sends; cancel a queued email. Nobody signed in can write an email send or change its status.
--   • a household link (token) sees ONLY the invitation it was sent, through household_invitation() — and only while the
--     organizers have "Show on their page" on for that design.
--   • everyone else: nothing (anon / strangers have no access to the tables; the pictures are public files with random
--     names so they can be shown in an email, and nobody can list the bucket).

create extension if not exists pgcrypto;

-- ---------- designs ----------
create table if not exists public.invitations (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  kind          text not null default 'invitation' check (kind in ('invitation', 'save_the_date')),
  source        text not null default 'template' check (source in ('template', 'upload')),
  design        jsonb not null default '{}'::jsonb check (jsonb_typeof(design) = 'object' and pg_column_size(design) <= 65536),
  images        jsonb not null default '{}'::jsonb check (jsonb_typeof(images) = 'object'),
  show_on_page  boolean not null default true,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (event_id, kind)
);

-- a storage path of this page's own folder: <event id>/<random>.jpg (no other folder, no "..")
create or replace function ep_private.inv_path_ok(eid uuid, p text) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and p ~ ('^' || eid::text || '/[A-Za-z0-9_-]{6,80}\.(jpg|png|webp)$')
$$;

create or replace function public.invitations_check() returns trigger
language plpgsql set search_path = '' as $$
declare k text; v jsonb;
begin
  if tg_op = 'UPDATE' then new.event_id := old.event_id; new.kind := old.kind; new.created_at := old.created_at; end if;
  for k, v in select * from jsonb_each(new.images) loop
    if k !~ '^[a-z]{2,3}(-[a-z]{2,4})?$' or jsonb_typeof(v) <> 'object' or not ep_private.inv_path_ok(new.event_id, v ->> 'path')
       or coalesce((v ->> 'w')::int, 0) not between 100 and 4000 or coalesce((v ->> 'h')::int, 0) not between 100 and 6000 then
      raise exception 'Bad invitation image %', k using errcode = 'P0001'; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(new.images)) > 40 then raise exception 'Too many languages' using errcode = 'P0001'; end if;
  new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists invitations_check on public.invitations;
create trigger invitations_check before insert or update on public.invitations for each row execute function public.invitations_check();

alter table public.invitations enable row level security;
drop policy if exists "invitations_planners" on public.invitations;
create policy "invitations_planners" on public.invitations for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
revoke all on public.invitations from anon, authenticated;
grant select, delete on public.invitations to authenticated;
grant insert (id, event_id, kind, source, design, images, show_on_page) on public.invitations to authenticated;
grant update (source, design, images, show_on_page) on public.invitations to authenticated;

-- ---------- sends ----------
create table if not exists public.invite_sends (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete cascade,
  household_id   uuid not null references public.guest_households (id) on delete cascade,
  invitation_id  uuid references public.invitations (id) on delete set null,
  kind           text not null default 'invitation' check (kind in ('invitation', 'save_the_date')),
  channel        text not null check (channel in ('email', 'text')),
  status         text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'canceled')),
  to_email       text check (to_email is null or char_length(to_email) <= 254),
  lang           text not null default '' check (lang ~ '^([a-z]{2,3}(-[a-z]{2,4})?)?$'),
  image_path     text check (image_path is null or char_length(image_path) <= 200),
  resend_id      text unique,
  error          text check (error is null or char_length(error) <= 300),
  not_before     timestamptz not null default now(),
  created_by     uuid,
  queued_at      timestamptz not null default now(),
  sent_at        timestamptz,
  delivered_at   timestamptz,
  bounced_at     timestamptz
);
create index if not exists invite_sends_event_idx on public.invite_sends (event_id, household_id);
create index if not exists invite_sends_queue_idx on public.invite_sends (not_before) where status = 'queued';

-- signed-in planners may only record a text send (it is "sent" the moment they open the text / share sheet) and cancel a
-- queued email; everything about email rows is the server's (notify runs as service_role, which skips these checks)
create or replace function public.invite_sends_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('anon', 'authenticated') then return new; end if;
  if tg_op = 'INSERT' then
    if new.channel <> 'text' then raise exception 'Emails are sent by the server' using errcode = 'P0001'; end if;
    select h.event_id into new.event_id from public.guest_households h where h.id = new.household_id;
    if new.event_id is null then raise exception 'Unknown household' using errcode = 'P0001'; end if;
    if new.invitation_id is not null and not exists (select 1 from public.invitations i where i.id = new.invitation_id and i.event_id = new.event_id) then
      raise exception 'Unknown invitation' using errcode = 'P0001'; end if;
    new.status := 'sent'; new.sent_at := now(); new.queued_at := now(); new.not_before := now(); new.created_by := auth.uid();
    new.resend_id := null; new.to_email := null; new.error := null; new.delivered_at := null; new.bounced_at := null;
    if (select count(*) from public.invite_sends s where s.event_id = new.event_id) >= 20000 then
      raise exception 'Too many sends on this page' using errcode = 'P0001'; end if;
    return new;
  end if;
  -- update: queued → canceled, nothing else
  if not (old.status = 'queued' and new.status = 'canceled') then raise exception 'Only a queued email can be canceled' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists invite_sends_check on public.invite_sends;
create trigger invite_sends_check before insert or update on public.invite_sends for each row execute function public.invite_sends_check();

alter table public.invite_sends enable row level security;
drop policy if exists "invite_sends_planners" on public.invite_sends;
create policy "invite_sends_planners" on public.invite_sends for all to authenticated
  using (ep_private.plans_event(event_id)) with check (ep_private.plans_event(event_id));
revoke all on public.invite_sends from anon, authenticated;
grant select on public.invite_sends to authenticated;
grant insert (household_id, invitation_id, kind, channel, lang, image_path) on public.invite_sends to authenticated;
grant update (status) on public.invite_sends to authenticated;

-- ---------- what a household link sees ----------
-- the invitation it was last sent (email or text), in its language when that picture exists; null while the organizers
-- keep that design off guests' pages, or when nothing was sent to this household
create or replace function public.household_invitation(s text, tok text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h public.guest_households; snd public.invite_sends; inv public.invitations; img jsonb; dl text;
begin
  if tok is null or tok !~ '^[a-f0-9]{24}$' then return null; end if;
  select x.* into h from public.guest_households x join public.events e on e.id = x.event_id
    where x.token = tok and e.slug = s and e.published;
  if not found then return null; end if;
  select x.* into snd from public.invite_sends x
    where x.household_id = h.id and x.invitation_id is not null and x.status in ('sent', 'delivered', 'sending')
    order by coalesce(x.sent_at, x.queued_at) desc limit 1;
  if not found then return null; end if;
  select x.* into inv from public.invitations x where x.id = snd.invitation_id;
  if not found or not inv.show_on_page then return null; end if;
  select coalesce(e.config ->> 'lang', 'en') into dl from public.events e where e.id = h.event_id;
  img := coalesce(inv.images -> nullif(snd.lang, ''), inv.images -> nullif(h.lang, ''), inv.images -> dl, inv.images -> 'en',
                  (select v from jsonb_each(inv.images) as j(k, v) limit 1));
  if img is null then return null; end if;
  return jsonb_build_object('kind', inv.kind, 'path', img ->> 'path', 'w', (img ->> 'w')::int, 'h', (img ->> 'h')::int, 'at', coalesce(snd.sent_at, snd.queued_at));
end $$;

-- ---------- the server's email allowance (notify only) ----------
create table if not exists public.email_usage (
  id           smallint primary key default 1 check (id = 1),
  day          date,            -- UTC day of the last reading
  day_used     integer not null default 0,
  month        text,            -- 'YYYY-MM' (UTC)
  month_used   integer not null default 0,
  observed_at  timestamptz
);
create table if not exists public.email_log (
  id    bigint generated always as identity primary key,
  at    timestamptz not null default now(),
  kind  text not null default '',
  n     integer not null default 1 check (n between 0 and 1000)
);
create index if not exists email_log_at_idx on public.email_log (at);
alter table public.email_usage enable row level security;
alter table public.email_log enable row level security;
revoke all on public.email_usage, public.email_log from anon, authenticated;

-- ---------- storage: the pictures ----------
-- public files (an email has to show them) with random names; only the page's organizers can upload, replace, delete or
-- list them, and only in the page's own folder
create or replace function ep_private.plans_folder(nm text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare f text := split_part(coalesce(nm, ''), '/', 1);
begin
  if f !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return ep_private.plans_event(f::uuid);
end $$;

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('invitations', 'invitations', true, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    drop policy if exists "invitations planners insert" on storage.objects;
    drop policy if exists "invitations planners select" on storage.objects;
    drop policy if exists "invitations planners update" on storage.objects;
    drop policy if exists "invitations planners delete" on storage.objects;
    create policy "invitations planners insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'invitations' and ep_private.plans_folder(name));
    create policy "invitations planners select" on storage.objects for select to authenticated
      using (bucket_id = 'invitations' and ep_private.plans_folder(name));
    create policy "invitations planners update" on storage.objects for update to authenticated
      using (bucket_id = 'invitations' and ep_private.plans_folder(name)) with check (bucket_id = 'invitations' and ep_private.plans_folder(name));
    create policy "invitations planners delete" on storage.objects for delete to authenticated
      using (bucket_id = 'invitations' and ep_private.plans_folder(name));
  end if;
end $$;

-- ---------- grants ----------
revoke all on function ep_private.inv_path_ok(uuid, text), ep_private.plans_folder(text) from public;
grant execute on function ep_private.inv_path_ok(uuid, text), ep_private.plans_folder(text) to anon, authenticated;
revoke execute on function public.invitations_check(), public.invite_sends_check() from public, anon, authenticated;
revoke all on function public.household_invitation(text, text) from public;
grant execute on function public.household_invitation(text, text) to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.invitations, public.invite_sends, public.email_usage, public.email_log to service_role;
    grant usage, select on all sequences in schema public to service_role;
    grant select on public.page_names to service_role; -- the email's link is the page's name: /<name>?g=<token>
  end if;
end $$;
