-- RLS checks for supabase/schema-volunteers.sql (after arrivals.sql: reuses its users and pages — AO 9001 owns arr-a1 (published),
-- arr-a2 (published) and arr-a3 (not shared); AP 9002 plans arr-a1; AX 9003 is a stranger).
\set ON_ERROR_STOP 1
set client_min_messages = notice;
-- ===== organizers make slots
set role authenticated; select as_s('9001');
select t_ok($$insert into public.volunteer_slots (id, event_id, task, shift, day, starts, ends, capacity) values
  ('00000000-0000-0000-0000-00000000d901', '00000000-0000-0000-0000-00000000e901', 'Water station 3', 'Early', '2027-05-16', '06:00', '09:00', 2)$$, 'owner adds a slot');
select t_ok($$insert into public.volunteer_slots (id, event_id, task, capacity) values ('00000000-0000-0000-0000-00000000d903', '00000000-0000-0000-0000-00000000e903', 'Draft page task', 3)$$, 'owner adds a slot on an unshared page');
select t_ok($$insert into public.volunteer_slots (id, event_id, task, capacity) values ('00000000-0000-0000-0000-00000000d904', '00000000-0000-0000-0000-00000000e902', 'Other page task', 3)$$, 'owner adds a slot on another page');
select t_fail($$insert into public.volunteer_slots (event_id, task, capacity) values ('00000000-0000-0000-0000-00000000e901', 'x', 0)$$, 'a slot needs at least 1 person');
select t_fail($$insert into public.volunteer_slots (event_id, task, starts) values ('00000000-0000-0000-0000-00000000e901', 'x', '6am')$$, 'times are HH:MM');
select t_fail($$insert into public.volunteer_slots (event_id, task) values ('00000000-0000-0000-0000-00000000e901', '  ')$$, 'a slot has a task');
reset role;
set role authenticated; select as_s('9002');
select t_ok($$insert into public.volunteer_slots (id, event_id, task, shift, capacity) values ('00000000-0000-0000-0000-00000000d902', '00000000-0000-0000-0000-00000000e901', 'Finish line', 'Late', 1)$$, 'planner adds a slot');
select t_ok($$insert into public.volunteer_signups (slot_id, name, email) values ('00000000-0000-0000-0000-00000000d902', 'Dave Russo', 'dave@example.com')$$, 'planner signs someone up by hand');
select t_fail($$insert into public.volunteer_signups (slot_id, name) values ('00000000-0000-0000-0000-00000000d904', 'Nope')$$, 'planner cannot sign up on another page');
select t_fail($$update public.volunteer_slots set event_id = '00000000-0000-0000-0000-00000000e902' where id = '00000000-0000-0000-0000-00000000d902'$$, 'a slot cannot move pages');
select t_eq((select count(*) from public.volunteer_slots), 2, 'planner reads this page''s slots only');
reset role;
-- ===== the public sign-up sheet
set role anon; select set_config('request.jwt.claims', '', false);
select t_eq((select jsonb_array_length(public.volunteer_board('arr-a1'))), 2, 'anyone with the link sees the published page''s slots');
select t_txt((select (public.volunteer_board('arr-a1') -> 1 ->> 'filled')), '1', 'with filled counts');
select t_eq((select count(*) from jsonb_path_query(public.volunteer_board('arr-a1'), '$[*].email')), 0, 'and no emails');
select t_eq((select jsonb_array_length(public.volunteer_board('arr-a3'))), 0, 'an unshared page shows nothing');
select t_ok($$select public.volunteer_signup('arr-a1', '00000000-0000-0000-0000-00000000d901', 'Leah Kim', 'Leah@Example.com', '')$$, 'a volunteer takes a place');
select t_fail($$select public.volunteer_signup('arr-a1', '00000000-0000-0000-0000-00000000d901', 'Leah again', 'leah@example.com', '')$$, 'the same email cannot take the same slot twice');
select t_ok($$select public.volunteer_signup('arr-a1', '00000000-0000-0000-0000-00000000d901', 'Sam Torres', '', '312 555 0100')$$, 'a second volunteer fills it');
select t_fail($$select public.volunteer_signup('arr-a1', '00000000-0000-0000-0000-00000000d901', 'Late comer', 'late@example.com', '')$$, 'a full slot refuses');
select t_fail($$select public.volunteer_signup('arr-a1', '00000000-0000-0000-0000-00000000d902', 'Nina', 'nina@example.com', '')$$, 'Finish line (1 place) is already full');
select t_fail($$select public.volunteer_signup('arr-a2', '00000000-0000-0000-0000-00000000d901', 'Wrong page', 'w@example.com', '')$$, 'a slot under another page''s link is refused');
select t_fail($$select public.volunteer_signup('arr-a3', '00000000-0000-0000-0000-00000000d903', 'Draft', 'd@example.com', '')$$, 'an unshared page takes no sign-ups');
select t_fail($$select public.volunteer_signup('arr-a1', '00000000-0000-0000-0000-00000000d901', '', 'x@example.com', '')$$, 'a name is needed');
select t_fail($$select count(*) from public.volunteer_signups$$, 'anon cannot read sign-ups');
select t_fail($$select count(*) from public.volunteer_slots$$, 'anon cannot read slots directly');
select t_fail($$insert into public.volunteer_slots (event_id, task) values ('00000000-0000-0000-0000-00000000e901', 'x')$$, 'anon cannot add a slot');
reset role;
-- ===== strangers: nothing
set role authenticated; select as_s('9003');
select t_eq((select count(*) from public.volunteer_slots), 0, 'stranger reads no slots');
select t_eq((select count(*) from public.volunteer_signups), 0, 'stranger reads no sign-ups');
select t_fail($$insert into public.volunteer_slots (event_id, task) values ('00000000-0000-0000-0000-00000000e901', 'x')$$, 'stranger cannot add a slot');
update public.volunteer_slots set capacity = 99; delete from public.volunteer_signups;
reset role;
select t_eq((select count(*) from public.volunteer_slots where capacity = 99), 0, 'stranger changed no slot');
select t_eq((select count(*) from public.volunteer_signups where event_id = '00000000-0000-0000-0000-00000000e901'), 3, 'stranger deleted no sign-up (Dave, Leah, Sam)');
select t_txt((select email from public.volunteer_signups where name = 'Leah Kim'), 'leah@example.com', 'emails are stored lower-case');
-- ===== the owner sees names; deleting a slot takes its sign-ups
set role authenticated; select as_s('9001');
select t_eq((select count(*) from public.volunteer_signups where slot_id = '00000000-0000-0000-0000-00000000d901'), 2, 'owner sees who signed up');
select t_ok($$delete from public.volunteer_slots where id = '00000000-0000-0000-0000-00000000d901'$$, 'owner deletes a slot');
select t_eq((select count(*) from public.volunteer_signups where slot_id = '00000000-0000-0000-0000-00000000d901'), 0, 'its sign-ups go with it');
reset role;
