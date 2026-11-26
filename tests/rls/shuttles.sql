-- RLS checks for supabase/schema-shuttles.sql (after arrivals.sql: reuses its users, pages, households and aids tokens).
-- AO owns A1 + A2; AP plans A1; AX stranger. Households HA (Ana, Luis) and HB (Ben) on A1, HC on A2.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
insert into public.guest_people (id, household_id, name, sort) values ('00000000-0000-0000-0000-00000000b904', '00000000-0000-0000-0000-00000000a903', 'Cora Other', 0);
-- ===== organizers make runs and seat riders
set role authenticated; select as_s('9001');
select t_ok($$insert into public.shuttle_runs (id, event_id, from_place, to_place, depart_date, depart_time, capacity, vehicle, meet) values
  ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000e901', 'LIS', 'Quinta', '2027-06-11', '12:15', 2, 'Van', 'Arrivals hall, exit 3')$$, 'owner adds a run');
select t_ok($$insert into public.shuttle_runs (id, event_id, from_place, to_place) values ('00000000-0000-0000-0000-00000000c903', '00000000-0000-0000-0000-00000000e902', 'OPO', 'Hotel')$$, 'owner adds a run on another page');
select t_fail($$insert into public.shuttle_runs (event_id, capacity) values ('00000000-0000-0000-0000-00000000e901', 0)$$, 'at least 1 seat');
select t_fail($$insert into public.shuttle_runs (event_id, depart_time) values ('00000000-0000-0000-0000-00000000e901', '7pm')$$, 'time is HH:MM');
reset role;
set role authenticated; select as_s('9002');
select t_ok($$insert into public.shuttle_runs (id, event_id, from_place, to_place, depart_date, depart_time) values ('00000000-0000-0000-0000-00000000c902', '00000000-0000-0000-0000-00000000e901', 'Quinta', 'LIS', '2027-06-14', '15:00')$$, 'planner adds a run');
select t_ok($$insert into public.shuttle_riders (run_id, person_id) values ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000b901'), ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000b902'), ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000b903')$$, 'planner seats 3 on a 2-seat run (a warning, not a wall)');
select t_ok($$insert into public.shuttle_riders (run_id, person_id) values ('00000000-0000-0000-0000-00000000c902', '00000000-0000-0000-0000-00000000b901')$$, 'Ana also rides home');
select t_fail($$insert into public.shuttle_riders (run_id, person_id) values ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000b904')$$, 'a guest of another page cannot ride');
select t_fail($$insert into public.shuttle_riders (run_id, person_id) values ('00000000-0000-0000-0000-00000000c903', '00000000-0000-0000-0000-00000000b904')$$, 'planner cannot touch another page''s run');
select t_fail($$update public.shuttle_runs set event_id = '00000000-0000-0000-0000-00000000e902' where id = '00000000-0000-0000-0000-00000000c902'$$, 'a run cannot move pages');
select t_eq((select count(*) from public.shuttle_riders), 4, 'planner reads the page''s riders only');
reset role;
-- ===== strangers / anon: nothing
set role authenticated; select as_s('9003');
select t_eq((select count(*) from public.shuttle_runs), 0, 'stranger reads no runs');
select t_eq((select count(*) from public.shuttle_riders), 0, 'stranger reads no riders');
select t_fail($$insert into public.shuttle_runs (event_id) values ('00000000-0000-0000-0000-00000000e901')$$, 'stranger cannot add a run');
update public.shuttle_runs set capacity = 99; delete from public.shuttle_riders; delete from public.shuttle_runs;
reset role;
select t_eq((select count(*) from public.shuttle_runs where capacity = 99), 0, 'stranger changed no run');
select t_eq((select count(*) from public.shuttle_riders), 4, 'stranger removed no rider');
set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$select count(*) from public.shuttle_runs$$, 'anon cannot read runs');
select t_fail($$insert into public.shuttle_riders (run_id, person_id) values ('00000000-0000-0000-0000-00000000c901', '00000000-0000-0000-0000-00000000b903')$$, 'anon cannot add riders');
-- ===== a household link: its own people's runs only
select t_eq(jsonb_array_length(public.household_get('arr-a1', (select v from aids where k = 'hA'), false) -> 'shuttles'), 2, 'household A sees its 2 runs');
select t_txt((public.household_get('arr-a1', (select v from aids where k = 'hA'), false) -> 'shuttles' -> 0 ->> 'meet'), 'Arrivals hall, exit 3', 'with the meeting point');
select t_eq(jsonb_array_length(public.household_get('arr-a1', (select v from aids where k = 'hA'), false) -> 'shuttles' -> 0 -> 'people'), 2, 'and only its own 2 people on the first run (not Ben)');
select t_txt((public.household_get('arr-a1', (select v from aids where k = 'hA'), false) -> 'shuttles' -> 0 ->> 'capacity'), null, 'no seat count');
select t_eq(jsonb_array_length(public.household_get('arr-a1', (select v from aids where k = 'hB'), false) -> 'shuttles'), 1, 'household B sees only the run Ben rides');
select t_txt((public.household_get('arr-a1', (select v from aids where k = 'hB'), false) -> 'shuttles' -> 0 -> 'people')::text, '["00000000-0000-0000-0000-00000000b903"]', 'Ben sees himself, not the Garcias');
select t_eq(jsonb_array_length(public.household_get('arr-a2', (select v from aids where k = 'hC'), false) -> 'shuttles'), 0, 'a household with no rides sees none');
reset role;
-- deleting a run frees its riders
set role authenticated; select as_s('9001');
select t_ok($$delete from public.shuttle_runs where id = '00000000-0000-0000-0000-00000000c902'$$, 'owner deletes a run');
reset role;
select t_eq((select count(*) from public.shuttle_riders), 3, 'its riders went with it');
