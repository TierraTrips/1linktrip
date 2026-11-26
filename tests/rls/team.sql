-- RLS checks for supabase/schema-6.sql: co-planners, change log, household guest list + household RSVP, opens.
-- Run with tests/rls/run.sh after the other files (reuses t_ok / t_fail / t_eq / t_txt from messaging.sql).
-- O owns E6 (published) and E7 (hidden); P is invited and accepts; P2 is invited and never accepts; Q is a stranger.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'own@x.com', now(), '{"full_name":"Olive Owner"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'Ana@X.com', now(), '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'q@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-0000000000c4', 'pl2@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-0000000000c5', 'guest@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-0000000000c6', 'ana2@x.com', null, '{}');
insert into public.events (id, slug, owner, config, published) values
  ('00000000-0000-0000-0000-0000000000e6', 'wed-e6', '00000000-0000-0000-0000-0000000000c1',
   '{"title":"Wedding","ek":"modes:k6","schedule":[{"id":"sc1","title":"Ceremony"},{"id":"sc2","title":"Dinner"}]}', true),
  ('00000000-0000-0000-0000-0000000000e7', 'hid-e7', '00000000-0000-0000-0000-0000000000c1', '{"title":"Hidden"}', false);
create temp table ids (k text primary key, v text); grant select on ids to anon, authenticated;
create function as_user(u text) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated')::text, false) $$;
grant execute on function as_user(text) to anon, authenticated;

-- ===== the owner invites planners
set role authenticated; select as_user('c1');
select t_ok($$insert into public.page_planners (event_id, email, name) values ('00000000-0000-0000-0000-0000000000e6', 'ana@x.com', 'Ana')$$, 'owner invites a planner');
select t_ok($$insert into public.page_planners (event_id, email) values ('00000000-0000-0000-0000-0000000000e6', 'pl2@x.com')$$, 'owner invites a second planner');
select t_ok($$insert into public.page_planners (event_id, email) values ('00000000-0000-0000-0000-0000000000e7', 'ana@x.com')$$, 'owner invites to a hidden page');
select t_fail($$insert into public.page_planners (event_id, email) values ('00000000-0000-0000-0000-0000000000e6', 'own@x.com')$$, 'the owner cannot invite themselves');
select t_fail($$insert into public.page_planners (event_id, email, token) values ('00000000-0000-0000-0000-0000000000e6', 'z@x.com', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$, 'the browser cannot choose the token');
select t_fail($$insert into public.page_planners (event_id, email, user_id) values ('00000000-0000-0000-0000-0000000000e6', 'z@x.com', '00000000-0000-0000-0000-0000000000c3')$$, 'the browser cannot mark an invite accepted');
select t_eq((select count(*) from public.page_team('00000000-0000-0000-0000-0000000000e6')), 3, 'owner sees the team (owner + 2)');
select t_eq((select count(*) from public.page_team('00000000-0000-0000-0000-0000000000e6') where token ~ '^[a-f0-9]{32}$'), 2, 'owner sees the invite tokens');
reset role;
insert into ids select 'tokA', token from public.page_planners where email = 'ana@x.com' and event_id = '00000000-0000-0000-0000-0000000000e6';
insert into ids select 'tokA7', token from public.page_planners where email = 'ana@x.com' and event_id = '00000000-0000-0000-0000-0000000000e7';
insert into ids select 'tok2', token from public.page_planners where email = 'pl2@x.com';

-- ===== before accepting, an invitee is not a planner
set role authenticated; select as_user('c2');
select t_eq((select count(*) from public.events where id = '00000000-0000-0000-0000-0000000000e7'), 0, 'invitee cannot read the hidden page yet');
select t_eq((select count(*) from public.planner_pending()), 2, 'invitee sees their 2 pending invites');
select t_eq((select count(*) from public.page_team('00000000-0000-0000-0000-0000000000e6')), 0, 'invitee cannot read the team yet');
update public.events set config = '{"title":"hacked"}' where id = '00000000-0000-0000-0000-0000000000e6';
reset role;
select t_txt((select config->>'title' from public.events where id = '00000000-0000-0000-0000-0000000000e6'), 'Wedding', 'invitee cannot change the page before accepting');

-- the wrong account cannot accept; an unconfirmed email cannot accept
set role authenticated; select as_user('c3');
select t_fail($$select * from public.planner_accept((select v from ids where k = 'tokA'))$$, 'another account cannot accept the invite');
select as_user('c6');
select t_fail($$select * from public.planner_accept((select v from ids where k = 'tokA'))$$, 'an unconfirmed email cannot accept');
reset role;
set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$select * from public.planner_accept((select v from ids where k = 'tokA'))$$, 'anon cannot accept');
select t_txt((select email_hint from public.planner_invite_info((select v from ids where k = 'tokA'))), 'a•••@x.com', 'invite link shows only a hint of the email');
select t_fail($$select count(*) from public.page_planners$$, 'anon cannot read planners');
reset role;

-- ===== P accepts (case of the account email doesn't matter)
set role authenticated; select as_user('c2');
select t_eq((select count(*) from public.planner_accept((select v from ids where k = 'tokA'))), 1, 'planner accepts');
select t_ok($$select * from public.planner_accept((select v from ids where k = 'tokA7'))$$, 'planner accepts the hidden page too');
select t_eq((select count(*) from public.events where id = '00000000-0000-0000-0000-0000000000e7'), 1, 'planner reads the hidden page');
select t_ok($$update public.events set config = jsonb_set(config, '{schedule,0,title}', '"Ceremony on the lawn"') where id = '00000000-0000-0000-0000-0000000000e6'$$, 'planner updates the page');
select t_ok($$update public.events set slug = 'stolen-link' where id = '00000000-0000-0000-0000-0000000000e6'$$, 'planner update with a new link runs…');
select t_eq((select count(*) from public.events where slug = 'wed-e6'), 1, '…but the link stays');
select t_ok($$update public.events set owner = '00000000-0000-0000-0000-0000000000c2' where id = '00000000-0000-0000-0000-0000000000e6'$$, 'planner update of the owner runs…');
select t_eq((select count(*) from public.events where owner = '00000000-0000-0000-0000-0000000000c1' and id = '00000000-0000-0000-0000-0000000000e6'), 1, '…but ownership does not move');
delete from public.events where id = '00000000-0000-0000-0000-0000000000e6';
select t_eq((select count(*) from public.events where id = '00000000-0000-0000-0000-0000000000e6'), 1, 'planner cannot delete the page');
select t_fail($$insert into public.page_planners (event_id, email) values ('00000000-0000-0000-0000-0000000000e6', 'friend@x.com')$$, 'planner cannot invite planners');
delete from public.page_planners where email = 'pl2@x.com';
select t_eq((select count(*) from public.page_planners where email = 'pl2@x.com'), 1, 'planner cannot remove another planner');
select t_eq((select count(*) from public.page_team('00000000-0000-0000-0000-0000000000e6')), 3, 'planner reads the team');
select t_eq((select count(*) from public.page_team('00000000-0000-0000-0000-0000000000e6') where token is not null), 0, 'planner does not get invite tokens');
select t_txt((select name from public.page_team('00000000-0000-0000-0000-0000000000e6') where role = 'owner'), 'Olive Owner', 'team: the owner''s name');
select t_txt((select actor_name from public.page_activity where event_id = '00000000-0000-0000-0000-0000000000e6' order by id desc limit 1), 'Ana', 'change log: by Ana (the name the owner gave)');
select t_txt((select array_to_string(keys, ',') from public.page_activity where event_id = '00000000-0000-0000-0000-0000000000e6' order by id desc limit 1), 'sc:sc1', 'change log: which item changed');
select t_ok($$update public.events set config = config || '{"title":"Our wedding"}' where id = '00000000-0000-0000-0000-0000000000e6'$$, 'planner changes the title');
select t_txt((select array_to_string(keys, ',') from public.page_activity where event_id = '00000000-0000-0000-0000-0000000000e6' order by id desc limit 1), 'f:title,sc:sc1', 'one entry per sitting gathers both');
select t_eq((select count(*) from public.rsvps where event_id = '00000000-0000-0000-0000-0000000000e6'), 0, 'planner can query replies');
reset role;
-- the owner's own change is logged under the owner
set role authenticated; select as_user('c1');
select t_ok($$update public.events set config = config - 'schedule' || '{"schedule":[{"id":"sc1","title":"Ceremony on the lawn"}]}' where id = '00000000-0000-0000-0000-0000000000e6'$$, 'owner removes an item');
select t_txt((select actor_name || ':' || array_to_string(keys, ',') from public.page_activity where event_id = '00000000-0000-0000-0000-0000000000e6' order by id desc limit 1), 'Olive Owner:sc-:sc2', 'change log: removed item by the owner');
reset role;

-- strangers and anon: nothing
set role authenticated; select as_user('c3');
select t_eq((select count(*) from public.page_activity), 0, 'stranger cannot read the change log');
select t_eq((select count(*) from public.page_planners), 0, 'stranger cannot read planners');
select t_eq((select count(*) from public.page_team('00000000-0000-0000-0000-0000000000e6')), 0, 'stranger cannot read the team');
select t_eq((select count(*) from public.events where id = '00000000-0000-0000-0000-0000000000e7'), 0, 'stranger cannot read the hidden page');
reset role;
set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$select count(*) from public.page_activity$$, 'anon cannot read the change log');
reset role;

-- ===== the guest list (households) — planner P builds it
set role authenticated; select as_user('c2');
select t_ok($$insert into public.event_groups (id, event_id, name) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000e6', 'Bride''s family')$$, 'planner adds a guest group');
select t_ok($$insert into public.guest_households (id, event_id, name, lang, plus_ones, group_id, email) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e6', 'The Garcias', 'es', 0, '00000000-0000-0000-0000-00000000f001', 'garcia@x.com'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e6', 'Ben Okafor', '', 1, null, null)$$, 'planner adds households');
select t_ok($$insert into public.guest_people (id, household_id, name, plus_ones, age) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', 'Ana Garcia', 0, 'adult'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1', 'Luis Garcia', 1, 'adult'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000d1', 'Sofi Garcia', 0, 'child'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d2', 'Ben Okafor', 0, 'adult')$$, 'planner adds guests (one a child)');
select t_fail($$update public.guest_people set age = 'teen' where id = '00000000-0000-0000-0000-0000000000f4'$$, 'age is adult / child / infant');
select t_fail($$insert into public.guest_households (event_id, name, token) values ('00000000-0000-0000-0000-0000000000e6', 'X', 'aaaaaaaaaaaaaaaaaaaaaaaa')$$, 'the browser cannot choose a household token');
select t_fail($$update public.guest_households set opens = 99$$, 'the browser cannot set opens');
select t_fail($$insert into public.guest_households (event_id, name, group_id) values ('00000000-0000-0000-0000-0000000000e7', 'X', '00000000-0000-0000-0000-00000000f001')$$, 'a group from another page is refused');
select t_eq((select event_id = '00000000-0000-0000-0000-0000000000e6' and true from public.guest_people where id = '00000000-0000-0000-0000-0000000000f1')::int, 1, 'a guest''s page comes from their household');
reset role;
insert into ids select 'hA', token from public.guest_households where id = '00000000-0000-0000-0000-0000000000d1';
insert into ids select 'hB', token from public.guest_households where id = '00000000-0000-0000-0000-0000000000d2';

-- the owner reads the planner's list; strangers and anon get nothing
set role authenticated; select as_user('c1');
select t_eq((select count(*) from public.guest_households), 2, 'owner reads the households');
reset role;
set role authenticated; select as_user('c3');
select t_eq((select count(*) from public.guest_households), 0, 'stranger cannot read households');
select t_eq((select count(*) from public.guest_people), 0, 'stranger cannot read guests');
select t_eq((select count(*) from public.household_hotels('00000000-0000-0000-0000-0000000000e6')), 0, 'stranger gets no hotel status');
select t_fail($$insert into public.guest_households (event_id, name) values ('00000000-0000-0000-0000-0000000000e6', 'Intruder')$$, 'stranger cannot add households');
update public.guest_households set name = 'hacked'; delete from public.guest_people;
select t_eq((select count(*) from public.page_opens), 0, 'stranger cannot read opens');
reset role;
select t_eq((select count(*) from public.guest_people), 4, 'stranger changed nothing');
set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$select count(*) from public.guest_households$$, 'anon cannot read households');
select t_fail($$select count(*) from public.guest_people$$, 'anon cannot read guests');
select t_fail($$select count(*) from public.page_opens$$, 'anon cannot read opens');
select t_fail($$select * from public.household_hotels('00000000-0000-0000-0000-0000000000e6')$$, 'anon cannot read hotel status');

-- ===== a household link: its own household only
select t_eq(jsonb_array_length(public.household_get('wed-e6', (select v from ids where k = 'hA')) -> 'people'), 3, 'household A link: its 3 guests');
select t_txt(public.household_get('wed-e6', (select v from ids where k = 'hA')) ->> 'lang', 'es', 'household A link: its language');
select t_txt(public.household_get('hid-e7', (select v from ids where k = 'hA')) ->> 'name', null, 'a token with another page''s link reads nothing');
select t_txt(public.household_get('wed-e6', 'aaaaaaaaaaaaaaaaaaaaaaaa') ->> 'name', null, 'a made-up token reads nothing');
reset role;
select t_eq((select opens from public.guest_households where id = '00000000-0000-0000-0000-0000000000d1'), 1, 'the open is recorded once (repeat opens within 30 min fold)');
select t_eq((select count(*) from public.guest_households where id = '00000000-0000-0000-0000-0000000000d2' and first_opened_at is null), 1, 'household B is still unopened');
set role anon; select set_config('request.jwt.claims', '', false);
select t_ok($$select public.household_rsvp('wed-e6', (select v from ids where k = 'hA'), '[{"person_id":"00000000-0000-0000-0000-0000000000f1","attending":true,"note":"[[1lt:{\"v\":1,\"diets\":[\"vegetarian\"]}]]"},{"person_id":"00000000-0000-0000-0000-0000000000f2","attending":false}]')$$, 'household A answers for its people');
select t_fail($$select public.household_rsvp('wed-e6', (select v from ids where k = 'hA'), '[{"person_id":"00000000-0000-0000-0000-0000000000f3","attending":false}]')$$, 'household A cannot answer for household B');
select t_fail($$select public.household_rsvp('wed-e6', (select v from ids where k = 'hA'), '[{"name":"Extra","attending":true}]')$$, 'household A has no household plus-ones');
select t_ok($$select public.household_rsvp('wed-e6', (select v from ids where k = 'hA'), '[{"plus_of":"00000000-0000-0000-0000-0000000000f2","name":"Marta Ruiz","attending":true}]')$$, 'Luis brings a plus-one');
select t_fail($$select public.household_rsvp('wed-e6', (select v from ids where k = 'hA'), '[{"plus_of":"00000000-0000-0000-0000-0000000000f2","name":"Second","attending":true}]')$$, 'only one plus-one per guest');
select t_fail($$select public.household_rsvp('wed-e6', (select v from ids where k = 'hA'), '[{"plus_of":"00000000-0000-0000-0000-0000000000f1","name":"Nope","attending":true}]')$$, 'no plus-one for a guest without one');
select t_fail($$select public.household_rsvp('wed-e6', (select v from ids where k = 'hA'), '[{"person_id":"00000000-0000-0000-0000-0000000000f1","remove":true}]')$$, 'a household cannot remove a guest the host added');
select t_eq(jsonb_array_length(public.household_get('wed-e6', (select v from ids where k = 'hA')) -> 'replies'), 3, 'household A reads its 3 replies (incl. the plus-one)');
select t_ok($$select public.household_rsvp('wed-e6', (select v from ids where k = 'hB'), '[{"name":"Ben''s guest","attending":true}]')$$, 'household B uses its household plus-one');
select t_eq(jsonb_array_length(public.household_get('wed-e6', (select v from ids where k = 'hB')) -> 'replies'), 1, 'household B reads only its own reply');
select t_fail($$insert into public.rsvps (event_id, name, person_id) values ('00000000-0000-0000-0000-0000000000e6', 'Fake', '00000000-0000-0000-0000-0000000000f3')$$, 'a plain reply cannot claim a guest');
select t_ok($$insert into public.rsvps (event_id, name) values ('00000000-0000-0000-0000-0000000000e6', 'Walk-in')$$, 'the open RSVP form still works');
select t_fail($$select count(*) from public.rsvps$$, 'anon cannot read replies');
select public.page_open('wed-e6'); select public.page_open('wed-e6'); select public.page_open('hid-e7');
reset role;
select t_eq((select count(*) from public.guest_people where household_id = '00000000-0000-0000-0000-0000000000d1'), 4, 'the plus-one is a guest of the same household');
select t_eq((select count(*) from public.rsvps where person_id = '00000000-0000-0000-0000-0000000000f1'), 1, 'one reply per person');
select t_eq((select coalesce(sum(n), 0) from public.page_opens where event_id = '00000000-0000-0000-0000-0000000000e6'), 2, 'plain-link opens counted');
select t_eq((select count(*) from public.page_opens where event_id = '00000000-0000-0000-0000-0000000000e7'), 0, 'a hidden page counts nothing');

-- a changed answer replaces the old one when the form saw the latest answer; a stale form doesn't overwrite it
reset role;
insert into ids select 'seenL', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.rsvps where person_id = '00000000-0000-0000-0000-0000000000f2';
set role anon; select set_config('request.jwt.claims', '', false);
select t_txt(public.household_rsvp('wed-e6', (select v from ids where k = 'hA'), '[{"person_id":"00000000-0000-0000-0000-0000000000f2","attending":true}]') ->> 'conflicts', '["00000000-0000-0000-0000-0000000000f2"]', 'a form that never saw Luis''s answer does not overwrite it');
select t_txt(public.household_rsvp('wed-e6', (select v from ids where k = 'hA'), json_build_array(json_build_object('person_id', '00000000-0000-0000-0000-0000000000f2', 'attending', true, 'seen', (select v from ids where k = 'seenL')))::jsonb) ->> 'conflicts', '[]', 'Luis changes his answer (form saw the latest)');
reset role;
select t_eq((select count(*) from public.rsvps where person_id = '00000000-0000-0000-0000-0000000000f2' and attending), 1, 'the new answer replaced the old one');

-- a signed-in guest opening the link ties the household to them (for "has a hotel"); planners' own opens don't count
set role authenticated; select as_user('c5');
select public.household_get('wed-e6', (select v from ids where k = 'hB'));
select t_ok($$insert into public.trip_items (id, page_key, kind, item) values ('bkH', 'k6', 'booking', '{"kind":"hotel","name":"Secret Hotel","confNo":"X9"}')$$, 'the guest saves a hotel');
select t_eq((select count(*) from public.guest_households), 0, 'the guest cannot read the guest list');
reset role;
set role authenticated; select as_user('c2');
select public.household_get('wed-e6', (select v from ids where k = 'hA'));
select t_eq((select opens from public.guest_households where id = '00000000-0000-0000-0000-0000000000d1'), 1, 'a planner opening a household link is not counted');
select t_txt((select string_agg(coalesce(has_hotel::text, 'unknown'), ',' order by id) from public.household_hotels('00000000-0000-0000-0000-0000000000e6')), 'unknown,true', 'hotel: unknown for A, chosen for B (nothing else about it)');
select t_eq((select count(*) from public.rsvps where event_id = '00000000-0000-0000-0000-0000000000e6'), 5, 'planner reads every reply (4 household + 1 walk-in)');
select t_eq((select coalesce(sum(n), 0) from public.page_opens), 2, 'planner reads plain-link opens');
reset role;

-- ===== removal: the owner removes the planner; access ends at once
set role authenticated; select as_user('c1');
select t_ok($$delete from public.page_planners where email = 'ana@x.com' and event_id = '00000000-0000-0000-0000-0000000000e7'$$, 'owner removes the planner from the hidden page');
reset role;
set role authenticated; select as_user('c2');
select t_eq((select count(*) from public.events where id = '00000000-0000-0000-0000-0000000000e7'), 0, 'removed planner cannot read the hidden page');
update public.events set config = '{"title":"after removal"}' where id = '00000000-0000-0000-0000-0000000000e7';
select t_ok($$delete from public.page_planners where user_id = '00000000-0000-0000-0000-0000000000c2'$$, 'a planner can leave');
select t_eq((select count(*) from public.guest_households), 0, 'after leaving: no guest list');
reset role;
select t_txt((select config->>'title' from public.events where id = '00000000-0000-0000-0000-0000000000e7'), 'Hidden', 'removed planner cannot change the page');
-- deleting the page deletes everything that hangs off it
delete from public.events where id = '00000000-0000-0000-0000-0000000000e6';
select t_eq((select (select count(*) from public.guest_households) + (select count(*) from public.guest_people) + (select count(*) from public.page_activity where event_id = '00000000-0000-0000-0000-0000000000e6') + (select count(*) from public.page_planners where event_id = '00000000-0000-0000-0000-0000000000e6')), 0, 'deleting the page deletes its guest list, log and planners');
