-- RLS checks for supabase/schema-arrivals.sql: guest_travel, household_travel(), arrival_shares / arrival_share(),
-- arrivals_trips(). Run with tests/rls/run.sh after the other files (reuses t_ok / t_fail / t_eq / t_txt, as_s, n_rows).
-- AO owns A1 (published, ek modes:arr1) and A2 (published, another page); AP is an accepted planner of A1; AX a stranger;
-- AG a signed-in guest of household HA (opts in); AN a signed-in guest who never opts in. Households HA (2), HB (1) on A1, HC on A2.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create temp table aids (k text primary key, v text); grant select on aids to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000009001', 'arr-owner@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-000000009002', 'arr-planner@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-000000009003', 'arr-stranger@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-000000009004', 'arr-guest@x.com', now(), '{"full_name":"Ana Garcia"}'),
  ('00000000-0000-0000-0000-000000009005', 'arr-noshare@x.com', now(), '{"full_name":"Nina Private"}');
insert into public.events (id, slug, owner, config, published) values
  ('00000000-0000-0000-0000-00000000e901', 'arr-a1', '00000000-0000-0000-0000-000000009001', '{"title":"Wedding","ek":"modes:arr1"}', true),
  ('00000000-0000-0000-0000-00000000e902', 'arr-a2', '00000000-0000-0000-0000-000000009001', '{"title":"Other","ek":"modes:arr2"}', true),
  ('00000000-0000-0000-0000-00000000e903', 'arr-a3', '00000000-0000-0000-0000-000000009001', '{"title":"Draft","ek":"modes:arr3"}', false);
insert into public.page_planners (event_id, email) values ('00000000-0000-0000-0000-00000000e901', 'arr-planner@x.com');
update public.page_planners set user_id = '00000000-0000-0000-0000-000000009002', accepted_at = now() where email = 'arr-planner@x.com';
insert into public.guest_households (id, event_id, name) values
  ('00000000-0000-0000-0000-00000000a901', '00000000-0000-0000-0000-00000000e901', 'The Garcias'),
  ('00000000-0000-0000-0000-00000000a902', '00000000-0000-0000-0000-00000000e901', 'Ben Okafor'),
  ('00000000-0000-0000-0000-00000000a903', '00000000-0000-0000-0000-00000000e902', 'Other page household');
insert into public.guest_people (id, household_id, name, sort) values
  ('00000000-0000-0000-0000-00000000b901', '00000000-0000-0000-0000-00000000a901', 'Ana Garcia', 0),
  ('00000000-0000-0000-0000-00000000b902', '00000000-0000-0000-0000-00000000a901', 'Luis Garcia', 1),
  ('00000000-0000-0000-0000-00000000b903', '00000000-0000-0000-0000-00000000a902', 'Ben Okafor', 0);
insert into aids select 'hA', token from public.guest_households where id = '00000000-0000-0000-0000-00000000a901';
insert into aids select 'hB', token from public.guest_households where id = '00000000-0000-0000-0000-00000000a902';
insert into aids select 'hC', token from public.guest_households where id = '00000000-0000-0000-0000-00000000a903';
-- the two guests' own My trip (trip_items, owner-only): a flight in, a hotel, a restaurant, and a flight for another page
insert into public.trip_items (id, owner, page_key, kind, item) values
  ('f1', '00000000-0000-0000-0000-000000009004', 'arr1', 'booking', '{"kind":"flight","name":"TAP TP 1350","flight":"TP 1350","start":"2027-06-11T09:10","end":"2027-06-11T11:45","from":"MAD","to":"LIS","note":"conf ABC123 seat 14C","price":"412"}'),
  ('h1', '00000000-0000-0000-0000-000000009004', 'arr1', 'booking', '{"kind":"hotel","name":"Pestana Palace","start":"2027-06-11","end":"2027-06-14","conf":"XYZ","address":"Rua Jau 54"}'),
  ('r1', '00000000-0000-0000-0000-000000009004', 'arr1', 'booking', '{"kind":"food","name":"Belcanto","start":"2027-06-12T20:00"}'),
  ('p1', '00000000-0000-0000-0000-000000009004', 'arr1', 'place', '{"name":"Saved museum"}'),
  ('f2', '00000000-0000-0000-0000-000000009004', 'arr2', 'booking', '{"kind":"flight","name":"Other trip","flight":"UA 1","start":"2027-01-01T10:00"}'),
  ('n1', '00000000-0000-0000-0000-000000009005', 'arr1', 'booking', '{"kind":"flight","name":"Secret flight","flight":"BA 500","start":"2027-06-11T07:00","to":"LIS"}');
update public.guest_households set user_id = '00000000-0000-0000-0000-000000009005' where id = '00000000-0000-0000-0000-00000000a902'; -- Nina opened Ben's link once

-- ===== a household link writes and reads only its own travel
set role anon; select set_config('request.jwt.claims', '', false);
select t_ok($$select public.household_travel('arr-a1', (select v from aids where k = 'hA'), '{"arr_date":"2027-06-11","arr_time":"11:45","arr_place":"LIS","arr_no":"TP 1350","dep_date":"2027-06-14","dep_time":"18:20","dep_place":"LIS","dep_no":"TP 1351","stay":"Pestana Palace"}')$$, 'household A saves its arrival and departure');
select t_txt((public.household_get('arr-a1', (select v from aids where k = 'hA'), false) -> 'travel' ->> 'arr_no'), 'TP 1350', 'household A reads its travel back in household_get');
select t_txt((public.household_get('arr-a1', (select v from aids where k = 'hB'), false) -> 'travel')::text, 'null', 'household B sees no travel (not A''s)');
select t_fail($$select public.household_travel('arr-a1', (select v from aids where k = 'hA'), '{"arr_time":"25:00"}')$$, 'a bad time is refused');
select t_fail($$select public.household_travel('arr-a1', (select v from aids where k = 'hA'), '{"arr_date":"not a date"}')$$, 'a bad date is refused');
select t_fail($$select public.household_travel('arr-a2', (select v from aids where k = 'hA'), '{"stay":"x"}')$$, 'a token with another page''s slug is refused');
select t_fail($$select public.household_travel('arr-a1', 'aaaaaaaaaaaaaaaaaaaaaaaa', '{"stay":"x"}')$$, 'a made-up token is refused');
select t_fail($$select count(*) from public.guest_travel$$, 'anon cannot read the travel table');
select t_fail($$insert into public.guest_travel (household_id, stay) values ('00000000-0000-0000-0000-00000000a902', 'x')$$, 'anon cannot write the travel table');
select t_ok($$select public.household_travel('arr-a1', (select v from aids where k = 'hB'), '{"stay":"Ben''s Airbnb"}')$$, 'household B saves only where it stays');
select t_ok($$select public.household_travel('arr-a1', (select v from aids where k = 'hB'), '{"stay":""}')$$, 'household B clears it (all empty → no row)');
reset role;
select t_eq((select count(*) from public.guest_travel where household_id = '00000000-0000-0000-0000-00000000a902'), 0, 'all-empty travel leaves no row');
select t_txt((select updated_by from public.guest_travel where household_id = '00000000-0000-0000-0000-00000000a901'), 'guest', 'the household''s row is marked as written by the guest');

-- ===== organizers read and edit travel; strangers nothing
set role authenticated; select as_s('9002');
select t_eq((select count(*) from public.guest_travel where event_id = '00000000-0000-0000-0000-00000000e901'), 1, 'planner reads the page''s travel');
select t_ok($$insert into public.guest_travel (household_id, arr_date, arr_place, stay) values ('00000000-0000-0000-0000-00000000a902', '2027-06-12', 'LIS', 'Hotel Avenida')$$, 'planner adds travel for Ben');
select t_fail($$insert into public.guest_travel (household_id, stay) values ('00000000-0000-0000-0000-00000000a903', 'x')$$, 'planner cannot add travel on a page they don''t plan');
select t_fail($$update public.guest_travel set event_id = '00000000-0000-0000-0000-00000000e902' where household_id = '00000000-0000-0000-0000-00000000a902'$$, 'a travel row cannot move pages');
select t_eq((select count(*) from public.arrivals_trips('00000000-0000-0000-0000-00000000e901')), 0, 'nobody opted in yet: no bookings at all');
reset role;
set role authenticated; select as_s('9003');
select t_eq((select count(*) from public.guest_travel), 0, 'stranger reads no travel');
select t_eq((select count(*) from public.arrivals_trips('00000000-0000-0000-0000-00000000e901')), 0, 'stranger gets no shared bookings');
select t_fail($$insert into public.guest_travel (household_id, stay) values ('00000000-0000-0000-0000-00000000a901', 'x')$$, 'stranger cannot write travel');
update public.guest_travel set stay = 'hacked'; delete from public.guest_travel;
select t_fail($$insert into public.arrival_shares (event_id, user_id) values ('00000000-0000-0000-0000-00000000e901', '00000000-0000-0000-0000-000000009004')$$, 'nobody writes opt-ins directly');
reset role;
select t_eq((select count(*) from public.guest_travel where stay = 'hacked'), 0, 'stranger changed nothing');
select t_eq((select count(*) from public.guest_travel), 2, 'stranger deleted nothing');

-- ===== the opt-in gate: only a guest who switched sharing on is visible, and only travel bookings of this page
set role authenticated; select as_s('9004');
select t_txt(public.arrival_share('arr-a1', (select v from aids where k = 'hA'), true)::text, 'true', 'guest AG opts in from household A''s link');
select t_eq((select count(*) from public.arrival_shares), 1, 'AG reads their own opt-in');
select t_fail($$select public.arrival_share('arr-a3', null, true)$$, 'opting in on an unshared page is refused');
select t_eq((select count(*) from public.arrivals_trips('00000000-0000-0000-0000-00000000e901')), 0, 'a guest cannot read the board''s shared bookings');
select t_eq((select count(*) from public.guest_travel), 0, 'a guest cannot read the travel table');
reset role;
set role authenticated; select as_s('9005');
select t_eq((select count(*) from public.arrival_shares), 0, 'AN cannot see AG''s opt-in');
reset role;
set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$select public.arrival_share('arr-a1', null, true)$$, 'anon cannot opt in (no account, no bookings)');
select t_fail($$select * from public.arrivals_trips('00000000-0000-0000-0000-00000000e901')$$, 'anon cannot call arrivals_trips');
reset role;
set role authenticated; select as_s('9001');
select t_eq((select count(*) from public.arrivals_trips('00000000-0000-0000-0000-00000000e901')), 1, 'owner sees exactly one shared guest (AG), never AN');
select t_txt((select household_id::text from public.arrivals_trips('00000000-0000-0000-0000-00000000e901')), '00000000-0000-0000-0000-00000000a901', 'AG''s bookings are tied to household A');
select t_txt((select name from public.arrivals_trips('00000000-0000-0000-0000-00000000e901')), 'Ana Garcia', 'shown with their name');
select t_eq((select jsonb_array_length(items) from public.arrivals_trips('00000000-0000-0000-0000-00000000e901')), 2, 'only the flight and the hotel of this page (no restaurant, saved place, other page)');
select t_txt((select (x ->> 'flight') || ' ' || (x ->> 'to') from public.arrivals_trips('00000000-0000-0000-0000-00000000e901') a, jsonb_array_elements(a.items) x where x ->> 'kind' = 'flight'), 'TP 1350 LIS', 'flight number and airport shared');
select t_txt((select (items::text ~ 'ABC123|412|XYZ|Rua Jau|seat')::text from public.arrivals_trips('00000000-0000-0000-0000-00000000e901')), 'false', 'no notes, confirmation codes, prices or addresses');
select t_txt((select (items::text ~ 'Secret')::text from public.arrivals_trips('00000000-0000-0000-0000-00000000e901')), 'false', 'AN''s booking never appears (no opt-in), even though AN is linked to household B');
select t_eq((select count(*) from public.arrivals_trips('00000000-0000-0000-0000-00000000e902')), 0, 'the opt-in is per page: nothing on A2');
reset role;
set role authenticated; select as_s('9004');
select t_txt(public.arrival_share('arr-a1', null, false)::text, 'false', 'AG switches sharing off');
reset role;
set role authenticated; select as_s('9002');
select t_eq((select count(*) from public.arrivals_trips('00000000-0000-0000-0000-00000000e901')), 0, 'after switching off, the planner sees no bookings');
reset role;
