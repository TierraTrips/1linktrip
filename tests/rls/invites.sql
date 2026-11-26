-- RLS checks for supabase/schema-invites.sql: invitation designs, their pictures (storage), sends, household_invitation().
-- Run with tests/rls/run.sh after the other files (reuses t_ok / t_fail / t_eq / t_txt from messaging.sql, n_rows from seating.sql).
-- IO owns I1 (published) and I2 (published, another page); IP is an accepted planner of I1; IX is a stranger;
-- IQ was invited to I1 but never accepted. Households: HA, HB on I1; HC on I2.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create function as_i(u text) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000' || u, 'role', 'authenticated')::text, false) $$;
grant execute on function as_i(text) to anon, authenticated;
create temp table iids (k text primary key, v text); grant select on iids to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000006001', 'inv-owner@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-000000006002', 'inv-planner@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-000000006003', 'inv-stranger@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-000000006004', 'inv-invitee@x.com', now(), '{}');
insert into public.events (id, slug, owner, config, published) values
  ('00000000-0000-0000-0000-00000000e601', 'inv-s1', '00000000-0000-0000-0000-000000006001', '{"title":"Ana & Ben","lang":"en","langs":["es"]}', true),
  ('00000000-0000-0000-0000-00000000e602', 'inv-s2', '00000000-0000-0000-0000-000000006001', '{"title":"Other page"}', true);
insert into public.page_planners (event_id, email) values ('00000000-0000-0000-0000-00000000e601', 'inv-planner@x.com'), ('00000000-0000-0000-0000-00000000e601', 'inv-invitee@x.com');
update public.page_planners set user_id = '00000000-0000-0000-0000-000000006002', accepted_at = now() where email = 'inv-planner@x.com';
insert into public.guest_households (id, event_id, name, lang, email) values
  ('00000000-0000-0000-0000-00000000a601', '00000000-0000-0000-0000-00000000e601', 'The Garcias', 'es', 'garcia@x.com'),
  ('00000000-0000-0000-0000-00000000a602', '00000000-0000-0000-0000-00000000e601', 'Ben Okafor', '', null),
  ('00000000-0000-0000-0000-00000000a603', '00000000-0000-0000-0000-00000000e602', 'Other page household', '', null);
insert into iids select 'hA', token from public.guest_households where id = '00000000-0000-0000-0000-00000000a601';
insert into iids select 'hB', token from public.guest_households where id = '00000000-0000-0000-0000-00000000a602';
insert into iids select 'hC', token from public.guest_households where id = '00000000-0000-0000-0000-00000000a603';

-- ===== designs: the owner and the planner make them; nobody else
set role authenticated; select as_i('6001');
select t_ok($$insert into public.invitations (id, event_id, kind, source, design, images) values ('00000000-0000-0000-0000-00000000d601', '00000000-0000-0000-0000-00000000e601', 'invitation', 'template',
  '{"tpl":"classic","t":{"headline":"Together with their families"}}', '{"en":{"path":"00000000-0000-0000-0000-00000000e601/inv-en-abc123.jpg","w":1200,"h":1680},"es":{"path":"00000000-0000-0000-0000-00000000e601/inv-es-abc123.jpg","w":1200,"h":1680}}')$$, 'owner saves a template invitation with en + es pictures');
select t_fail($$insert into public.invitations (event_id, kind) values ('00000000-0000-0000-0000-00000000e601', 'invitation')$$, 'one invitation per page (save the date is the other kind)');
select t_fail($$insert into public.invitations (event_id, kind) values ('00000000-0000-0000-0000-00000000e601', 'menu')$$, 'kind is invitation / save_the_date');
select t_fail($$insert into public.invitations (event_id, kind, images) values ('00000000-0000-0000-0000-00000000e601', 'save_the_date', '{"en":{"path":"00000000-0000-0000-0000-00000000e602/x-abcdef.jpg","w":1200,"h":1680}}')$$, 'a picture from another page''s folder is refused');
select t_fail($$insert into public.invitations (event_id, kind, images) values ('00000000-0000-0000-0000-00000000e601', 'save_the_date', '{"en":{"path":"00000000-0000-0000-0000-00000000e601/../x.jpg","w":1200,"h":1680}}')$$, 'a path that climbs out of the folder is refused');
select t_fail($$insert into public.invitations (event_id, kind, images) values ('00000000-0000-0000-0000-00000000e601', 'save_the_date', '{"EN!":{"path":"00000000-0000-0000-0000-00000000e601/abcdef.jpg","w":1200,"h":1680}}')$$, 'a picture''s language must be a language code');
select t_fail($$insert into public.invitations (event_id, kind, images) values ('00000000-0000-0000-0000-00000000e601', 'save_the_date', '{"en":{"path":"00000000-0000-0000-0000-00000000e601/abcdef.jpg","w":1,"h":1680}}')$$, 'a picture needs a real size');
select t_fail($$update public.invitations set event_id = '00000000-0000-0000-0000-00000000e602' where id = '00000000-0000-0000-0000-00000000d601'$$, 'a design cannot move to another page (column not granted)');
select t_txt((select updated_by::text from public.invitations where id = '00000000-0000-0000-0000-00000000d601'), '00000000-0000-0000-0000-000000006001', 'the server records who saved it');
reset role;

set role authenticated; select as_i('6002');
select t_eq((select count(*) from public.invitations where event_id = '00000000-0000-0000-0000-00000000e601'), 1, 'planner reads the page''s design');
select t_ok($$insert into public.invitations (id, event_id, kind, source, images) values ('00000000-0000-0000-0000-00000000d602', '00000000-0000-0000-0000-00000000e601', 'save_the_date', 'upload',
  '{"en":{"path":"00000000-0000-0000-0000-00000000e601/std-upload1.jpg","w":1200,"h":1500}}')$$, 'planner uploads a save the date');
select t_eq(n_rows($$update public.invitations set design = '{"tpl":"modern"}' where id = '00000000-0000-0000-0000-00000000d601'$$), 1, 'planner edits the invitation');
select t_fail($$insert into public.invitations (event_id, kind) values ('00000000-0000-0000-0000-00000000e602', 'invitation')$$, 'planner cannot make a design on a page they don''t plan');
reset role;

set role authenticated; select as_i('6003');
select t_eq((select count(*) from public.invitations), 0, 'stranger reads no designs');
select t_fail($$insert into public.invitations (event_id, kind) values ('00000000-0000-0000-0000-00000000e601', 'save_the_date')$$, 'stranger cannot make a design');
select t_eq(n_rows($$update public.invitations set show_on_page = false$$), 0, 'stranger changes nothing');
select t_eq(n_rows($$delete from public.invitations$$), 0, 'stranger deletes nothing');
reset role;
set role authenticated; select as_i('6004');
select t_eq((select count(*) from public.invitations), 0, 'invited-but-not-joined planner reads no designs');
reset role;
set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$select count(*) from public.invitations$$, 'anon cannot read designs');
select t_fail($$select count(*) from public.invite_sends$$, 'anon cannot read sends');
select t_fail($$select count(*) from public.email_usage$$, 'anon cannot read the email allowance');
reset role;

-- ===== storage: only the page's organizers write / list its folder
set role authenticated; select as_i('6001');
select t_ok($$insert into storage.objects (bucket_id, name) values ('invitations', '00000000-0000-0000-0000-00000000e601/inv-en-abc123.jpg')$$, 'owner uploads into the page folder');
select t_fail($$insert into storage.objects (bucket_id, name) values ('invitations', 'not-a-uuid/x.jpg')$$, 'a folder that is not a page is refused');
reset role;
set role authenticated; select as_i('6002');
select t_ok($$insert into storage.objects (bucket_id, name) values ('invitations', '00000000-0000-0000-0000-00000000e601/std-upload1.jpg')$$, 'planner uploads into the page folder');
select t_fail($$insert into storage.objects (bucket_id, name) values ('invitations', '00000000-0000-0000-0000-00000000e602/x.jpg')$$, 'planner cannot upload into another page''s folder');
select t_eq((select count(*) from storage.objects where bucket_id = 'invitations'), 2, 'planner lists the page folder');
reset role;
set role authenticated; select as_i('6003');
select t_fail($$insert into storage.objects (bucket_id, name) values ('invitations', '00000000-0000-0000-0000-00000000e601/evil-123456.jpg')$$, 'stranger cannot upload into the page folder');
select t_eq((select count(*) from storage.objects where bucket_id = 'invitations'), 0, 'stranger cannot list the pictures');
select t_eq(n_rows($$delete from storage.objects where bucket_id = 'invitations'$$), 0, 'stranger deletes no pictures');
select t_eq(n_rows($$update storage.objects set name = name || 'x' where bucket_id = 'invitations'$$), 0, 'stranger replaces no pictures');
reset role;
set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$insert into storage.objects (bucket_id, name) values ('invitations', '00000000-0000-0000-0000-00000000e601/anon-123456.jpg')$$, 'anon cannot upload');
select t_eq((select count(*) from storage.objects where bucket_id = 'invitations'), 0, 'anon cannot list the pictures');
reset role;

-- ===== sends: email rows are the server's; planners record texts and cancel queued emails
set role authenticated; select as_i('6001');
select t_fail($$insert into public.invite_sends (household_id, invitation_id, channel) values ('00000000-0000-0000-0000-00000000a601', '00000000-0000-0000-0000-00000000d601', 'email')$$, 'owner cannot write an email send (the server sends)');
select t_ok($$insert into public.invite_sends (household_id, invitation_id, kind, channel, lang) values ('00000000-0000-0000-0000-00000000a602', '00000000-0000-0000-0000-00000000d601', 'invitation', 'text', '')$$, 'owner records a text to Ben');
select t_txt((select status || ' ' || (sent_at is not null)::text || ' ' || event_id::text from public.invite_sends where household_id = '00000000-0000-0000-0000-00000000a602'),
  'sent true 00000000-0000-0000-0000-00000000e601', 'the text send is "sent" now, on the household''s page');
select t_fail($$insert into public.invite_sends (household_id, invitation_id, channel) values ('00000000-0000-0000-0000-00000000a602', '00000000-0000-0000-0000-00000000d999', 'text')$$, 'a made-up invitation is refused');
select t_fail($$insert into public.invite_sends (household_id, invitation_id, channel) values ('00000000-0000-0000-0000-00000000a603', '00000000-0000-0000-0000-00000000d601', 'text')$$, 'an invitation from another page is refused');
select t_fail($$insert into public.invite_sends (household_id, channel, status, resend_id) values ('00000000-0000-0000-0000-00000000a602', 'text', 'delivered', 'fake')$$, 'status / resend id cannot be set (column not granted)');
reset role;
-- the server queues and sends emails
set role service_role;
select t_ok($$insert into public.invite_sends (id, event_id, household_id, invitation_id, kind, channel, status, to_email, lang, image_path, resend_id, sent_at) values
  ('00000000-0000-0000-0000-00000000f601', '00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-00000000a601', '00000000-0000-0000-0000-00000000d601', 'invitation', 'email', 'sent', 'garcia@x.com', 'es', '00000000-0000-0000-0000-00000000e601/inv-es-abc123.jpg', 're-1', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-00000000f602', '00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-00000000a601', '00000000-0000-0000-0000-00000000d602', 'save_the_date', 'email', 'queued', 'garcia@x.com', 'es', null, null, null)$$, 'the server writes email sends');
select t_ok($$update public.invite_sends set status = 'delivered', delivered_at = now() where resend_id = 're-1'$$, 'the server marks one delivered (webhook)');
select t_ok($$insert into public.email_log (kind, n) values ('invite', 1)$$, 'the server logs what it sent');
select t_ok($$insert into public.email_usage (id, day, day_used) values (1, current_date, 7) on conflict (id) do update set day_used = 7$$, 'the server records the allowance');
reset role;
set role authenticated; select as_i('6002');
select t_eq((select count(*) from public.invite_sends where event_id = '00000000-0000-0000-0000-00000000e601'), 3, 'planner reads every send on the page');
select t_fail($$update public.invite_sends set status = 'delivered' where id = '00000000-0000-0000-0000-00000000f601'$$, 'planner cannot mark an email delivered');
select t_fail($$update public.invite_sends set status = 'queued' where id = '00000000-0000-0000-0000-00000000f601'$$, 'planner cannot re-queue a sent email');
select t_fail($$update public.invite_sends set to_email = 'evil@x.com' where id = '00000000-0000-0000-0000-00000000f602'$$, 'planner cannot change the address of a queued email (column not granted)');
select t_eq(n_rows($$update public.invite_sends set status = 'canceled' where id = '00000000-0000-0000-0000-00000000f602'$$), 1, 'planner cancels a queued email');
select t_fail($$delete from public.invite_sends$$, 'planner cannot delete the send history');
reset role;
set role authenticated; select as_i('6003');
select t_eq((select count(*) from public.invite_sends), 0, 'stranger reads no sends');
select t_fail($$insert into public.invite_sends (household_id, channel) values ('00000000-0000-0000-0000-00000000a602', 'text')$$, 'stranger cannot record a send');
select t_eq(n_rows($$update public.invite_sends set status = 'canceled'$$), 0, 'stranger cancels nothing');
reset role;
set role authenticated; select as_i('6002');
select t_fail($$select count(*) from public.email_log$$, 'planner cannot read the email log');
select t_fail($$select count(*) from public.email_usage$$, 'planner cannot read the email allowance');
reset role;

-- ===== the household link sees only what it was sent
set role anon; select set_config('request.jwt.claims', '', false);
select t_txt(public.household_invitation('inv-s1', (select v from iids where k = 'hA')) ->> 'path', '00000000-0000-0000-0000-00000000e601/inv-es-abc123.jpg', 'the Garcias see their invitation, in Spanish');
select t_txt(public.household_invitation('inv-s1', (select v from iids where k = 'hA')) ->> 'kind', 'invitation', 'the save the date that was canceled before sending is not shown');
select t_txt(public.household_invitation('inv-s1', (select v from iids where k = 'hB')) ->> 'path', '00000000-0000-0000-0000-00000000e601/inv-en-abc123.jpg', 'Ben (texted) sees the page-language picture');
select t_txt(public.household_invitation('inv-s1', (select v from iids where k = 'hC'))::text, null, 'another page''s token reads nothing here');
select t_txt(public.household_invitation('inv-s2', (select v from iids where k = 'hC'))::text, null, 'a household that was sent nothing sees nothing');
select t_txt(public.household_invitation('inv-s1', 'zz')::text, null, 'a malformed token reads nothing');
select t_txt(public.household_invitation('inv-s1', repeat('0', 24))::text, null, 'a made-up token reads nothing');
reset role;
set role authenticated; select as_i('6001');
select t_eq(n_rows($$update public.invitations set show_on_page = false where id = '00000000-0000-0000-0000-00000000d601'$$), 1, 'owner turns "Show on their page" off');
reset role;
set role anon; select set_config('request.jwt.claims', '', false);
select t_txt(public.household_invitation('inv-s1', (select v from iids where k = 'hA'))::text, null, 'toggle off: the household page shows no invitation');
reset role;
update public.events set published = false where id = '00000000-0000-0000-0000-00000000e601';
update public.invitations set show_on_page = true where id = '00000000-0000-0000-0000-00000000d601';
set role anon; select set_config('request.jwt.claims', '', false);
select t_txt(public.household_invitation('inv-s1', (select v from iids where k = 'hA'))::text, null, 'a page that is not shared shows no invitation');
reset role;
update public.events set published = true where id = '00000000-0000-0000-0000-00000000e601';

-- ===== deleting
set role authenticated; select as_i('6002');
select t_eq(n_rows($$delete from public.invitations where id = '00000000-0000-0000-0000-00000000d602'$$), 1, 'planner deletes the save the date');
reset role;
select t_txt((select invitation_id::text from public.invite_sends where id = '00000000-0000-0000-0000-00000000f602'), null, 'its sends stay in the history, without the design');
