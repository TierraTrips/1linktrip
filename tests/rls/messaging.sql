-- RLS checks for supabase/schema-3.sql (messages, groups, group updates). Run with tests/rls/run.sh.
-- Every check prints "ok   …" or "FAIL …"; run.sh fails if any FAIL appears.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create function t_eq(got bigint, want bigint, msg text) returns void language plpgsql as $$
begin raise notice '%', (case when got = want then 'ok   ' else 'FAIL ' end) || msg || ' (got ' || got || ', want ' || want || ')'; end $$;
create function t_ok(q text, msg text) returns void language plpgsql as $$
begin execute q; raise notice 'ok   %', msg; exception when others then raise notice 'FAIL % (%)', msg, sqlerrm; end $$;
create function t_fail(q text, msg text) returns void language plpgsql as $$
begin execute q; raise notice 'FAIL % (it succeeded)', msg; exception when others then raise notice 'ok   % (refused: %)', msg, sqlerrm; end $$;
create function t_txt(got text, want text, msg text) returns void language plpgsql as $$
begin raise notice '%', (case when got is not distinct from want then 'ok   ' else 'FAIL ' end) || msg || ' (got ' || coalesce(got, 'null') || ', want ' || coalesce(want, 'null') || ')'; end $$;

-- people: H owns E1 and E3, H2 owns E2; G1, G2 confirmed guests; U3 has an unconfirmed email
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a1', 'host@x.com', now()), ('00000000-0000-0000-0000-0000000000a2', 'host2@x.com', now()),
  ('00000000-0000-0000-0000-0000000000b1', 'g1@x.com', now()), ('00000000-0000-0000-0000-0000000000b2', 'G2@X.com', now()),
  ('00000000-0000-0000-0000-0000000000b3', 'u3@x.com', null);
insert into public.events (id, slug, owner, config, published) values
  ('00000000-0000-0000-0000-0000000000e1', 'wedding-e1', '00000000-0000-0000-0000-0000000000a1', '{"title":"W","guestMessages":true}', true),
  ('00000000-0000-0000-0000-0000000000e2', 'race-e2', '00000000-0000-0000-0000-0000000000a2', '{"title":"R"}', true),
  ('00000000-0000-0000-0000-0000000000e3', 'hidden-e3', '00000000-0000-0000-0000-0000000000a1', '{"title":"Hid","guestMessages":true}', false);

-- ===== H, owner of E1
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select t_ok($$insert into public.event_groups (id, event_id, name, self_pick) values
  ('00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-0000000000e1', 'VIPs', false),
  ('00000000-0000-0000-0000-00000000c0f2', '00000000-0000-0000-0000-0000000000e1', 'Full marathon', true),
  ('00000000-0000-0000-0000-00000000c0f3', '00000000-0000-0000-0000-0000000000e1', 'Half marathon', true)$$, 'owner creates groups');
select t_fail($$insert into public.event_groups (event_id, name) values ('00000000-0000-0000-0000-0000000000e2', 'Mine now')$$, 'owner cannot add a group to someone else''s page');
select t_fail($$insert into public.event_groups (event_id, name) values ('00000000-0000-0000-0000-0000000000e1', 'vips')$$, 'group names are unique per page (case-insensitive)');
select t_ok($$insert into public.event_group_members (event_id, group_id, email) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0f1', 'g1@x.com')$$, 'owner adds g1 to VIPs');
select t_fail($$insert into public.event_group_members (event_id, group_id, email) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0f1', 'Mixed@X.com')$$, 'member emails must be lowercase');
select t_fail($$insert into public.event_group_members (event_id, group_id, email) values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c0f1', 'a@x.com')$$, 'member row must match its group''s page');
select t_ok($$insert into public.announcements (id, event_id, body) values ('00000000-0000-0000-0000-0000000a0000', '00000000-0000-0000-0000-0000000000e1', 'For everyone')$$, 'owner posts to everyone');
select t_ok($$insert into public.announcements (id, event_id, body, group_ids) values ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000000e1', 'VIP only', '{00000000-0000-0000-0000-00000000c0f1}')$$, 'owner posts to VIPs');
select t_ok($$insert into public.announcements (id, event_id, body, group_ids) values ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-0000000000e1', 'Full only', '{00000000-0000-0000-0000-00000000c0f2}')$$, 'owner posts to Full marathon');
select t_eq((select count(*) from public.announcements where event_id = '00000000-0000-0000-0000-0000000000e1'), 3, 'owner reads all 3 updates');
reset role;

-- ===== H2 owns E2 and makes a group there
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', false);
select t_ok($$insert into public.event_groups (id, event_id, name, self_pick) values ('00000000-0000-0000-0000-00000000c0f9', '00000000-0000-0000-0000-0000000000e2', 'Other', true)$$, 'H2 creates a group on E2');
select t_fail($$insert into public.announcements (event_id, body) values ('00000000-0000-0000-0000-0000000000e1', 'hijack')$$, 'non-owner cannot post an update');
select t_eq((select count(*) from public.event_groups where event_id = '00000000-0000-0000-0000-0000000000e1'), 2, 'non-owner sees only pickable groups of E1');
select t_eq((select count(*) from public.event_group_members where event_id = '00000000-0000-0000-0000-0000000000e1'), 0, 'non-owner sees no members of E1');
select t_eq((select count(*) from public.announcements where event_id = '00000000-0000-0000-0000-0000000000e1'), 1, 'non-owner reads only the everyone update');
update public.event_groups set name = 'Hacked' where event_id = '00000000-0000-0000-0000-0000000000e1';
delete from public.event_groups where event_id = '00000000-0000-0000-0000-0000000000e1';
reset role;

-- H cannot target another page's group
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select t_fail($$insert into public.announcements (event_id, body, group_ids) values ('00000000-0000-0000-0000-0000000000e1', 'x', '{00000000-0000-0000-0000-00000000c0f9}')$$, 'owner cannot send to a group of another page');
select t_fail($$update public.announcements set group_ids = '{00000000-0000-0000-0000-00000000c0f9}' where id = '00000000-0000-0000-0000-0000000a0000'$$, 'owner cannot retarget to a group of another page');
reset role;

-- ===== anon
set role anon; select set_config('request.jwt.claims', '', false);
select t_eq((select count(*) from public.announcements where event_id = '00000000-0000-0000-0000-0000000000e1'), 1, 'anon reads only the everyone update');
select t_txt((select body from public.announcements where event_id = '00000000-0000-0000-0000-0000000000e1'), 'For everyone', 'anon sees the everyone update');
select t_eq((select count(*) from public.event_groups where event_id = '00000000-0000-0000-0000-0000000000e1'), 2, 'anon sees only pickable groups');
select t_fail($$select * from public.event_group_members$$, 'anon cannot read members');
select t_fail($$select * from public.event_messages$$, 'anon cannot read messages');
select t_fail($$insert into public.event_messages (event_id, guest, body) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'hi')$$, 'anon cannot send a message');
select t_ok($$insert into public.rsvps (event_id, name) values ('00000000-0000-0000-0000-0000000000e1', 'Old client')$$, 'RSVP without a group still works');
select t_ok($$insert into public.rsvps (event_id, name, email, group_id) values ('00000000-0000-0000-0000-0000000000e1', 'Runner', 'r@x.com', '00000000-0000-0000-0000-00000000c0f2')$$, 'RSVP picking a pickable group');
select t_fail($$insert into public.rsvps (event_id, name, group_id) values ('00000000-0000-0000-0000-0000000000e1', 'Sneaky', '00000000-0000-0000-0000-00000000c0f1')$$, 'RSVP cannot pick a host-only group');
select t_fail($$insert into public.rsvps (event_id, name, group_id) values ('00000000-0000-0000-0000-0000000000e1', 'Cross', '00000000-0000-0000-0000-00000000c0f9')$$, 'RSVP cannot pick another page''s group');
select t_fail($$insert into public.rsvps (event_id, name) values ('00000000-0000-0000-0000-0000000000e3', 'Hidden')$$, 'RSVP to a hidden page is refused');
reset role;

-- ===== G1: VIP member
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', false);
select t_eq((select count(*) from public.announcements where event_id = '00000000-0000-0000-0000-0000000000e1'), 2, 'VIP member reads everyone + VIP updates');
select t_eq((select count(*) from public.event_groups where event_id = '00000000-0000-0000-0000-0000000000e1'), 3, 'VIP member sees pickable groups + VIPs');
select t_eq((select count(*) from public.event_group_members), 1, 'guest sees only their own membership');
select t_ok($$insert into public.event_group_members (event_id, group_id, email, added_by) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0f2', 'g1@x.com', 'guest')$$, 'guest picks Full marathon');
select t_eq((select count(*) from public.announcements where event_id = '00000000-0000-0000-0000-0000000000e1'), 3, 'after picking, reads the Full marathon update too');
select t_fail($$insert into public.event_group_members (event_id, group_id, email, added_by) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0f3', 'g2@x.com', 'guest')$$, 'guest cannot add someone else');
select t_fail($$insert into public.event_group_members (event_id, group_id, email, added_by) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0f3', 'g1@x.com', 'host')$$, 'guest cannot pose as the host when joining');
delete from public.event_group_members where group_id = '00000000-0000-0000-0000-00000000c0f1';
select t_eq((select count(*) from public.event_group_members where group_id = '00000000-0000-0000-0000-00000000c0f1'), 1, 'guest cannot leave a host-assigned group');
delete from public.event_group_members where group_id = '00000000-0000-0000-0000-00000000c0f2';
select t_eq((select count(*) from public.event_group_members where group_id = '00000000-0000-0000-0000-00000000c0f2'), 0, 'guest can leave a group they picked');
select t_fail($$insert into public.event_groups (event_id, name) values ('00000000-0000-0000-0000-0000000000e1', 'Guest group')$$, 'guest cannot create groups');
select t_fail($$insert into public.announcements (event_id, body) values ('00000000-0000-0000-0000-0000000000e1', 'guest post')$$, 'guest cannot post updates');
select t_ok($$insert into public.event_messages (event_id, body, guest_name, guest_email, notified_at) values ('00000000-0000-0000-0000-0000000000e1', 'Is there parking?', 'Gia', 'evil@x.com', now())$$, 'guest sends a message');
select t_txt((select guest_email from public.event_messages limit 1), 'g1@x.com', 'server fills the guest email from the account (spoof ignored)');
select t_txt((select notified_at::text from public.event_messages limit 1), null, 'guest cannot pre-set notified_at');
select t_ok($$insert into public.event_messages (event_id, guest, body) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', 'posing as G2')$$, 'insert naming another guest…');
select t_eq((select count(*) from public.event_messages where guest = '00000000-0000-0000-0000-0000000000b2'), 0, '…lands in the sender''s own thread, not G2''s');
select t_fail($$insert into public.event_messages (event_id, body, from_host) values ('00000000-0000-0000-0000-0000000000e1', 'fake host', true)$$, 'guest cannot write as the host');
select t_fail($$insert into public.event_messages (event_id, body) values ('00000000-0000-0000-0000-0000000000e2', 'off')$$, 'no messages where the host has not turned them on');
select t_fail($$insert into public.event_messages (event_id, body) values ('00000000-0000-0000-0000-0000000000e3', 'hidden')$$, 'no messages to a hidden page');
select t_fail($$update public.event_messages set body = 'edited'$$, 'messages cannot be edited');
select t_fail($$delete from public.event_messages$$, 'messages cannot be deleted by guests');
reset role;

-- ===== G2: in no group (account email has capitals)
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', false);
select t_eq((select count(*) from public.announcements where event_id = '00000000-0000-0000-0000-0000000000e1'), 1, 'non-member reads only the everyone update');
select t_eq((select count(*) from public.event_messages), 0, 'guest cannot read another guest''s thread');
select t_fail($$insert into public.event_group_members (event_id, group_id, email, added_by) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0f1', 'g2@x.com', 'guest')$$, 'guest cannot join a host-only group');
select t_ok($$insert into public.event_group_members (event_id, group_id, email, added_by) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0f3', 'g2@x.com', 'guest')$$, 'guest joins Half marathon (account email matched lowercased)');
select t_eq((select count(*) from public.announcements where event_id = '00000000-0000-0000-0000-0000000000e1'), 1, 'Half marathon member still does not see the Full or VIP updates');
select t_fail($$insert into public.event_messages (event_id, guest, body, from_host) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'into G1 thread', true)$$, 'guest cannot write into another thread');
reset role;

-- ===== U3: unconfirmed email
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', false);
select t_fail($$insert into public.event_messages (event_id, body) values ('00000000-0000-0000-0000-0000000000e1', 'hi')$$, 'unconfirmed account cannot message');
select t_fail($$insert into public.event_group_members (event_id, group_id, email, added_by) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0f2', 'u3@x.com', 'guest')$$, 'unconfirmed account cannot join a group');
reset role;

-- ===== H reads the inbox and replies
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', false);
select t_eq((select count(*) from public.event_messages where event_id = '00000000-0000-0000-0000-0000000000e1'), 2, 'owner reads the inbox');
select t_eq((select count(*) from public.event_groups where event_id = '00000000-0000-0000-0000-0000000000e1' and name in ('VIPs', 'Full marathon', 'Half marathon')), 3, 'another host could not rename or delete E1''s groups');
select t_ok($$insert into public.event_messages (event_id, guest, body, from_host, guest_email) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'Yes, lot B.', true, 'host@x.com')$$, 'owner replies in a thread');
select t_txt((select guest_email from public.event_messages where from_host), null, 'host rows carry no email');
select t_fail($$insert into public.event_messages (event_id, guest, body, from_host) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', 'cold open', true)$$, 'owner cannot start a thread with someone who never wrote');
select t_eq((select count(*) from public.event_group_members where event_id = '00000000-0000-0000-0000-0000000000e1'), 2, 'owner sees all members');
select t_ok($$delete from public.event_group_members where email = 'g2@x.com'$$, 'owner removes a member');
reset role;

-- ===== H2 is not the owner of E1
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', false);
select t_eq((select count(*) from public.event_messages), 0, 'another host cannot read E1''s inbox');
select t_fail($$insert into public.event_messages (event_id, guest, body, from_host) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'not mine', true)$$, 'another host cannot reply on E1');
reset role;

-- ===== G1 sees the reply
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', false);
select t_eq((select count(*) from public.event_messages), 3, 'guest reads their thread incl. the host reply');
-- rate limit: 30 guest messages per hour per page
do $$ declare n int := 0; begin
  loop begin insert into public.event_messages (event_id, body) values ('00000000-0000-0000-0000-0000000000e1', 'spam'); n := n + 1; exception when others then exit; end; exit when n > 40; end loop;
  perform t_eq((select count(*) from public.event_messages where not from_host), 30, 'rate limit stops a guest at 30 messages an hour');
end $$;
reset role;

-- ===== hiding the page hides its updates from guests
update public.events set published = false where id = '00000000-0000-0000-0000-0000000000e1';
set role anon; select set_config('request.jwt.claims', '', false);
select t_eq((select count(*) from public.announcements where event_id = '00000000-0000-0000-0000-0000000000e1'), 0, 'hidden page: anon reads no updates');
select t_eq((select count(*) from public.event_groups where event_id = '00000000-0000-0000-0000-0000000000e1'), 0, 'hidden page: anon sees no groups');
reset role;
