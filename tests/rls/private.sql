-- RLS checks for supabase/schema-4.sql (event_private: the organizer's vendors and payments). Run with tests/rls/run.sh,
-- after messaging.sql (reuses its people, pages and t_* helpers: H owns E1 and E3, H2 owns E2, G1 is a guest).
\set ON_ERROR_STOP 1
set client_min_messages = notice;

-- ===== H, owner of E1
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select t_ok($$insert into public.event_private (event_id, data) values ('00000000-0000-0000-0000-0000000000e1', '{"cur":"USD","vendors":[{"name":"Bloom Co","total":2400}]}')$$, 'owner saves vendors for their page');
select t_ok($$update public.event_private set data = '{"cur":"USD","vendors":[{"name":"Bloom Co","total":2500}]}' where event_id = '00000000-0000-0000-0000-0000000000e1'$$, 'owner updates them');
select t_eq((select count(*) from public.event_private), 1, 'owner reads their row');
select t_fail($$insert into public.event_private (event_id, data) values ('00000000-0000-0000-0000-0000000000e2', '{}')$$, 'owner cannot write vendors on someone else''s page');
select t_fail($$insert into public.event_private (event_id, data) values ('00000000-0000-0000-0000-0000000000e3', '[]')$$, 'data must be an object');
reset role;

-- ===== H2 (another organizer)
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', false);
select t_eq((select count(*) from public.event_private), 0, 'another organizer reads nothing');
update public.event_private set data = '{"hacked":true}';
delete from public.event_private;
reset role;
select t_txt((select data->>'hacked' from public.event_private where event_id = '00000000-0000-0000-0000-0000000000e1'), null, 'another organizer cannot change it');
select t_eq((select count(*) from public.event_private), 1, 'another organizer cannot delete it');

-- ===== a signed-in guest of the (published) page
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', false);
select t_eq((select count(*) from public.event_private), 0, 'a guest reads nothing');
select t_fail($$insert into public.event_private (event_id, data) values ('00000000-0000-0000-0000-0000000000e3', '{}')$$, 'a guest cannot write');
reset role;

-- ===== anon: no access at all (not even a select grant)
update public.events set published = true where id = '00000000-0000-0000-0000-0000000000e1';
set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$select count(*) from public.event_private$$, 'anon cannot read the table');
select t_fail($$insert into public.event_private (event_id, data) values ('00000000-0000-0000-0000-0000000000e1', '{}')$$, 'anon cannot write');
reset role;

-- deleting the page deletes its private row
delete from public.events where id = '00000000-0000-0000-0000-0000000000e1';
select t_eq((select count(*) from public.event_private), 0, 'deleting the page deletes its vendors');
