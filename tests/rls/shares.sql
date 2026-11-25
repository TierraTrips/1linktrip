-- RLS checks for supabase/schema-5.sql ("Share my trip" links) and the personal copy in trip_items (schema-2).
-- Run with tests/rls/run.sh, after messaging.sql and private.sql (reuses their people and pages; E1 is gone by now):
-- H owns E3 (not published), H2 owns E2 (published), G1 and G2 are guests.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
insert into public.events (id, slug, owner, config, published) values
  ('00000000-0000-0000-0000-0000000000e4', 'trip-e4', '00000000-0000-0000-0000-0000000000a1', '{"title":"Trip","type":"Trip"}', true);

-- ===== G1, a guest of E4 (published), shares their trip
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', false);
select t_ok($$insert into public.trip_shares (event_id, page_key, name, data) values ('00000000-0000-0000-0000-0000000000e4', 'k4', 'Gia', '{"v":1,"bk":[{"id":"h1","kind":"hotel","name":"Park Hyatt","confNo":"X1"}]}')$$, 'a guest shares their trip on a published page');
select t_eq((select count(*) from public.trip_shares), 1, 'the guest reads their own share');
select t_eq((select count(*) from public.trip_shares where token ~ '^[a-f0-9]{32}$'), 1, 'the token is made by the server (32 hex)');
select t_fail($$insert into public.trip_shares (token, event_id, page_key, data) values ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '00000000-0000-0000-0000-0000000000e2', 'k2', '{}')$$, 'the browser cannot choose the token');
select t_fail($$insert into public.trip_shares (event_id, page_key, data) values ('00000000-0000-0000-0000-0000000000e3', 'k3', '{}')$$, 'no share on an unpublished page that is not theirs');
select t_fail($$insert into public.trip_shares (owner, event_id, page_key, data) values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e2', 'k2', '{}')$$, 'cannot make a share in someone else''s name');
select t_fail($$insert into public.trip_shares (event_id, page_key, data) values ('00000000-0000-0000-0000-0000000000e4', 'k4', '{}')$$, 'one share per person per page');
select t_fail($$insert into public.trip_shares (event_id, page_key, data) values ('00000000-0000-0000-0000-0000000000e2', 'k2', '[]')$$, 'data must be an object');
select t_ok($$update public.trip_shares set data = '{"v":1,"bk":[{"id":"h1","kind":"hotel","name":"Park Hyatt Tokyo","confNo":"X1"}]}' where event_id = '00000000-0000-0000-0000-0000000000e4'$$, 'the guest updates their shared trip');
select t_fail($$update public.trip_shares set token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'$$, 'the token cannot be changed');
select t_fail($$update public.trip_shares set owner = '00000000-0000-0000-0000-0000000000b2'$$, 'the owner cannot be changed');
select t_fail($$update public.trip_shares set event_id = '00000000-0000-0000-0000-0000000000e2'$$, 'the page cannot be changed');
reset role;
create temp table tok as select token from public.trip_shares where owner = '00000000-0000-0000-0000-0000000000b1';
grant select on tok to anon, authenticated;

-- ===== G2: another signed-in person, without and with the link
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', false);
select t_eq((select count(*) from public.trip_shares), 0, 'another person cannot list shares');
update public.trip_shares set data = '{"hacked":true}';
delete from public.trip_shares;
select t_eq((select count(*) from public.trip_share_get((select token from tok))), 1, 'with the link: the shared trip');
select t_txt((select data->'bk'->0->>'name' from public.trip_share_get((select token from tok))), 'Park Hyatt Tokyo', 'the link shows the latest version');
select t_eq((select count(*) from public.trip_share_get('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')), 0, 'a made-up token gets nothing');
select t_eq((select count(*) from public.trip_share_get('%')), 0, 'a pattern is not a token');
reset role;
select t_txt((select data->>'hacked' from public.trip_shares), null, 'another person cannot change a share');
select t_eq((select count(*) from public.trip_shares), 1, 'another person cannot delete a share');

-- ===== the page's organizer (H owns E4) cannot see their guests' shares
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select t_eq((select count(*) from public.trip_shares), 0, 'the organizer cannot list guests'' shares');
select t_ok($$insert into public.trip_shares (event_id, page_key, data) values ('00000000-0000-0000-0000-0000000000e3', 'k3', '{"v":1}')$$, 'an organizer can share from their own unpublished page');
reset role;

-- ===== anon: only the one-token read
set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$select count(*) from public.trip_shares$$, 'anon cannot read the table');
select t_fail($$insert into public.trip_shares (event_id, page_key, data) values ('00000000-0000-0000-0000-0000000000e4', 'k4', '{}')$$, 'anon cannot make a share');
select t_eq((select count(*) from public.trip_share_get((select token from tok))), 1, 'anon with the link: the shared trip');
reset role;
select t_eq((select count(*) from public.trip_share_get((select token from public.trip_shares where event_id = '00000000-0000-0000-0000-0000000000e3'))), 0, 'a share of an unpublished page reads as nothing');

-- unpublishing the page turns its share links off; publishing again brings them back
update public.events set published = false where id = '00000000-0000-0000-0000-0000000000e4';
set role anon; select t_eq((select count(*) from public.trip_share_get((select token from tok))), 0, 'unpublished page: the link reads nothing'); reset role;
update public.events set published = true where id = '00000000-0000-0000-0000-0000000000e4';

-- ===== Stop sharing: the owner deletes the row, the link stops working
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', false);
select t_ok($$delete from public.trip_shares where event_id = '00000000-0000-0000-0000-0000000000e4'$$, 'the guest stops sharing');
reset role;
set role anon; select t_eq((select count(*) from public.trip_share_get((select token from tok))), 0, 'a stopped link reads nothing'); reset role;

-- ===== the personal copy (trip_items): only its owner
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', false);
select t_ok($$insert into public.trip_items (id, page_key, kind, item) values ('ov-k4', 'k4', 'place', '{"ov":true,"it":{"sc1":{"h":1}}}')$$, 'a guest saves their personal copy');
select t_fail($$insert into public.trip_items (id, owner, page_key, kind, item) values ('ov-x', '00000000-0000-0000-0000-0000000000b2', 'k4', 'place', '{}')$$, 'not in someone else''s name');
reset role;
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', false);
select t_eq((select count(*) from public.trip_items), 0, 'another person cannot read it');
update public.trip_items set item = '{"hacked":true}'; delete from public.trip_items;
reset role;
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select t_eq((select count(*) from public.trip_items), 0, 'the organizer cannot read a guest''s copy');
reset role;
set role anon; select t_fail($$select count(*) from public.trip_items$$, 'anon cannot read personal copies'); reset role;
select t_txt((select item->>'hacked' from public.trip_items where id = 'ov-k4'), null, 'nobody else can change it');

-- deleting the page deletes its shares
delete from public.events where id = '00000000-0000-0000-0000-0000000000e3';
select t_eq((select count(*) from public.trip_shares where event_id = '00000000-0000-0000-0000-0000000000e3'), 0, 'deleting the page deletes its shares');
