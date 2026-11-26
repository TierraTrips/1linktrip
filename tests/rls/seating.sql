-- RLS checks for supabase/schema-seating.sql: tables, seat assignments, "show table to guests", household_seats().
-- Run with tests/rls/run.sh after the other files (reuses t_ok / t_fail / t_eq / t_txt from messaging.sql).
-- SO owns S1 (published) and S2 (published, another page); SP is an accepted planner of S1; SX is a stranger;
-- SQ was invited to S1 but never accepted. Households: HA (2 people) and HB (1) on S1, HC on S2.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create function as_s(u text) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000' || u, 'role', 'authenticated')::text, false) $$;
grant execute on function as_s(text) to anon, authenticated;
create function n_rows(q text) returns bigint language plpgsql as $$ declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $$;
grant execute on function n_rows(text) to anon, authenticated;
create temp table sids (k text primary key, v text); grant select on sids to anon, authenticated;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000005001', 'seat-owner@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-000000005002', 'seat-planner@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-000000005003', 'seat-stranger@x.com', now(), '{}'),
  ('00000000-0000-0000-0000-000000005004', 'seat-invitee@x.com', now(), '{}');
insert into public.events (id, slug, owner, config, published) values
  ('00000000-0000-0000-0000-00000000e501', 'seat-s1', '00000000-0000-0000-0000-000000005001', '{"title":"Seated dinner"}', true),
  ('00000000-0000-0000-0000-00000000e502', 'seat-s2', '00000000-0000-0000-0000-000000005001', '{"title":"Other page"}', true);
insert into public.page_planners (event_id, email) values ('00000000-0000-0000-0000-00000000e501', 'seat-planner@x.com'), ('00000000-0000-0000-0000-00000000e501', 'seat-invitee@x.com');
update public.page_planners set user_id = '00000000-0000-0000-0000-000000005002', accepted_at = now() where email = 'seat-planner@x.com';
insert into public.guest_households (id, event_id, name) values
  ('00000000-0000-0000-0000-00000000a501', '00000000-0000-0000-0000-00000000e501', 'The Garcias'),
  ('00000000-0000-0000-0000-00000000a502', '00000000-0000-0000-0000-00000000e501', 'Ben Okafor'),
  ('00000000-0000-0000-0000-00000000a503', '00000000-0000-0000-0000-00000000e502', 'Other page household');
insert into public.guest_people (id, household_id, name, sort) values
  ('00000000-0000-0000-0000-00000000b501', '00000000-0000-0000-0000-00000000a501', 'Ana Garcia', 0),
  ('00000000-0000-0000-0000-00000000b502', '00000000-0000-0000-0000-00000000a501', 'Luis Garcia', 1),
  ('00000000-0000-0000-0000-00000000b503', '00000000-0000-0000-0000-00000000a502', 'Ben Okafor', 0),
  ('00000000-0000-0000-0000-00000000b504', '00000000-0000-0000-0000-00000000a503', 'Cora Other', 0);
insert into sids select 'hA', token from public.guest_households where id = '00000000-0000-0000-0000-00000000a501';
insert into sids select 'hB', token from public.guest_households where id = '00000000-0000-0000-0000-00000000a502';
insert into sids select 'hC', token from public.guest_households where id = '00000000-0000-0000-0000-00000000a503';

-- ===== the owner makes tables
set role authenticated; select as_s('5001');
select t_ok($$insert into public.guest_tables (id, event_id, name, shape, capacity, head, sort) values
  ('00000000-0000-0000-0000-00000000c501', '00000000-0000-0000-0000-00000000e501', 'Head table', 'rect', 10, true, 0),
  ('00000000-0000-0000-0000-00000000c502', '00000000-0000-0000-0000-00000000e501', 'Table 1', 'round', 2, false, 1)$$, 'owner adds tables');
select t_ok($$insert into public.guest_tables (id, event_id, name) values ('00000000-0000-0000-0000-00000000c503', '00000000-0000-0000-0000-00000000e502', 'Other page table')$$, 'owner adds a table on another page');
select t_fail($$insert into public.guest_tables (event_id, name, shape) values ('00000000-0000-0000-0000-00000000e501', 'T', 'hexagon')$$, 'shape is round / rect');
select t_fail($$insert into public.guest_tables (event_id, name, capacity) values ('00000000-0000-0000-0000-00000000e501', 'T', 0)$$, 'capacity at least 1');
select t_fail($$insert into public.guest_tables (event_id, name, capacity) values ('00000000-0000-0000-0000-00000000e501', 'T', 61)$$, 'capacity at most 60');
select t_fail($$insert into public.guest_tables (event_id, name) values ('00000000-0000-0000-0000-00000000e501', '   ')$$, 'a table needs a name');
select t_fail($$insert into public.guest_tables (event_id, name, x) values ('00000000-0000-0000-0000-00000000e501', 'T', 5000)$$, 'floor position stays in the room');
select t_fail($$update public.guest_tables set event_id = '00000000-0000-0000-0000-00000000e502' where id = '00000000-0000-0000-0000-00000000c502'$$, 'a table cannot move to another page');
reset role;

-- ===== seating guests (owner)
set role authenticated; select as_s('5001');
select t_ok($$update public.guest_people set table_id = '00000000-0000-0000-0000-00000000c502' where id = '00000000-0000-0000-0000-00000000b501'$$, 'owner seats Ana at Table 1');
select t_fail($$update public.guest_people set table_id = '00000000-0000-0000-0000-00000000c503' where id = '00000000-0000-0000-0000-00000000b502'$$, 'a table from another page is refused');
select t_fail($$update public.guest_people set table_id = gen_random_uuid() where id = '00000000-0000-0000-0000-00000000b502'$$, 'a made-up table is refused');
select t_fail($$update public.guest_people set household_id = '00000000-0000-0000-0000-00000000a503' where id = '00000000-0000-0000-0000-00000000b501'$$, 'moving a seated guest to another page''s household is refused');
reset role;

-- ===== the accepted planner seats people, moves and unseats them; household at once
set role authenticated; select as_s('5002');
select t_eq((select count(*) from public.guest_tables where event_id = '00000000-0000-0000-0000-00000000e501'), 2, 'planner reads the tables');
select t_ok($$insert into public.guest_tables (id, event_id, name, sort) values ('00000000-0000-0000-0000-00000000c504', '00000000-0000-0000-0000-00000000e501', 'Table 2', 2)$$, 'planner adds a table');
select t_ok($$update public.guest_people set table_id = '00000000-0000-0000-0000-00000000c504' where household_id = '00000000-0000-0000-0000-00000000a501'$$, 'planner seats the whole household at Table 2');
select t_eq((select count(*) from public.guest_people where table_id = '00000000-0000-0000-0000-00000000c504'), 2, 'both Garcias at Table 2');
-- a move only lands if the guest is still where this planner saw them (another planner may have moved them meanwhile)
select t_eq(n_rows($q$update public.guest_people set table_id = '00000000-0000-0000-0000-00000000c501' where id = '00000000-0000-0000-0000-00000000b502' and table_id = '00000000-0000-0000-0000-00000000c502'$q$), 0, 'a stale move changes nothing');
select t_eq(n_rows($q$update public.guest_people set table_id = '00000000-0000-0000-0000-00000000c501' where id = '00000000-0000-0000-0000-00000000b502' and table_id = '00000000-0000-0000-0000-00000000c504'$q$), 1, 'planner moves Luis to the head table');
select t_ok($$update public.guest_people set table_id = null where id = '00000000-0000-0000-0000-00000000b502'$$, 'planner unseats Luis');
select t_ok($$update public.guest_people set table_id = '00000000-0000-0000-0000-00000000c502' where id = '00000000-0000-0000-0000-00000000b503'$$, 'planner seats Ben at Table 1');
select t_ok($$insert into public.guest_seating (event_id, show_guests) values ('00000000-0000-0000-0000-00000000e501', false)$$, 'planner saves the seating setting');
select t_ok($$update public.guest_tables set x = 500, y = 320 where id = '00000000-0000-0000-0000-00000000c504'$$, 'planner places a table on the floor plan');
reset role;

-- ===== strangers, the not-yet-accepted invitee and anon: nothing
set role authenticated; select as_s('5003');
select t_eq((select count(*) from public.guest_tables), 0, 'stranger cannot read tables');
select t_eq((select count(*) from public.guest_seating), 0, 'stranger cannot read the seating setting');
select t_eq((select count(*) from public.guest_people where table_id is not null), 0, 'stranger cannot read seats');
select t_fail($$insert into public.guest_tables (event_id, name) values ('00000000-0000-0000-0000-00000000e501', 'Intruder')$$, 'stranger cannot add a table');
select t_fail($$insert into public.guest_seating (event_id, show_guests) values ('00000000-0000-0000-0000-00000000e502', true)$$, 'stranger cannot switch on showing tables');
update public.guest_tables set name = 'hacked'; delete from public.guest_tables; update public.guest_people set table_id = null; update public.guest_seating set show_guests = true;
reset role;
set role authenticated; select as_s('5004');
select t_eq((select count(*) from public.guest_tables), 0, 'invitee who has not accepted cannot read tables');
update public.guest_people set table_id = null;
reset role;
select t_eq((select count(*) from public.guest_tables where event_id = '00000000-0000-0000-0000-00000000e501'), 3, 'strangers deleted no tables');
select t_eq((select count(*) from public.guest_tables where name = 'hacked'), 0, 'strangers renamed nothing');
select t_eq((select count(*) from public.guest_people where table_id is not null), 2, 'strangers unseated nobody (Ana + Ben)');
select t_eq((select count(*) from public.guest_seating where show_guests), 0, 'strangers did not switch on showing tables');
set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$select count(*) from public.guest_tables$$, 'anon cannot read tables');
select t_fail($$select count(*) from public.guest_seating$$, 'anon cannot read the seating setting');
select t_fail($$insert into public.guest_tables (event_id, name) values ('00000000-0000-0000-0000-00000000e501', 'Anon')$$, 'anon cannot add a table');

-- ===== a household link: nothing while the toggle is off
select t_txt(public.household_seats('seat-s1', (select v from sids where k = 'hA'))::text, null, 'toggle off: the household link reads no table');
reset role;
set role authenticated; select as_s('5002');
select t_ok($$update public.guest_seating set show_guests = true where event_id = '00000000-0000-0000-0000-00000000e501'$$, 'planner switches on Show table to guests');
reset role;
set role anon; select set_config('request.jwt.claims', '', false);
select t_txt(public.household_seats('seat-s1', (select v from sids where k = 'hA'))::text,
  '[{"table": "Table 2", "person_id": "00000000-0000-0000-0000-00000000b501"}]', 'toggle on: household A reads only its own seated person''s table');
select t_txt(public.household_seats('seat-s1', (select v from sids where k = 'hB'))::text,
  '[{"table": "Table 1", "person_id": "00000000-0000-0000-0000-00000000b503"}]', 'household B reads its own table, not who else sits there');
select t_txt(public.household_seats('seat-s2', (select v from sids where k = 'hA'))::text, null, 'a token with another page''s link reads nothing');
select t_txt(public.household_seats('seat-s2', (select v from sids where k = 'hC'))::text, null, 'another page with the toggle off reads nothing');
select t_txt(public.household_seats('seat-s1', 'aaaaaaaaaaaaaaaaaaaaaaaa')::text, null, 'a made-up token reads nothing');
select t_txt(public.household_seats('seat-s1', 'x'' or 1=1 --')::text, null, 'a malformed token reads nothing');
select t_fail($$select count(*) from public.guest_people$$, 'anon still cannot read guests');
reset role;
update public.events set published = false where id = '00000000-0000-0000-0000-00000000e501';
set role anon; select set_config('request.jwt.claims', '', false);
select t_txt(public.household_seats('seat-s1', (select v from sids where k = 'hA'))::text, null, 'a hidden page shows no tables');
reset role;
update public.events set published = true where id = '00000000-0000-0000-0000-00000000e501';

-- ===== deleting a table unseats its guests; removing the planner ends access; deleting the page deletes everything
set role authenticated; select as_s('5001');
select t_ok($$delete from public.guest_tables where id = '00000000-0000-0000-0000-00000000c502'$$, 'owner deletes Table 1');
select t_eq((select count(*) from public.guest_people where id = '00000000-0000-0000-0000-00000000b503' and table_id is null), 1, 'Ben is unseated, still on the list');
select t_ok($$delete from public.page_planners where email = 'seat-planner@x.com'$$, 'owner removes the planner');
reset role;
set role authenticated; select as_s('5002');
select t_eq((select count(*) from public.guest_tables), 0, 'removed planner reads no tables');
update public.guest_people set table_id = null;
reset role;
select t_eq((select count(*) from public.guest_people where table_id is not null), 1, 'removed planner unseated nobody');
delete from public.events where id in ('00000000-0000-0000-0000-00000000e501', '00000000-0000-0000-0000-00000000e502');
select t_eq((select (select count(*) from public.guest_tables) + (select count(*) from public.guest_seating)), 0, 'deleting the page deletes its tables and setting');
