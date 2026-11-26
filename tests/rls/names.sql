-- RLS checks for supabase/schema-names.sql (page names: https://1linktrip.com/<name>).
-- Run with tests/rls/run.sh after messaging.sql (reuses t_ok / t_fail / t_eq / t_txt). Own people and pages:
-- N1 owns N_E1 (published) and N_E2 (hidden); N2 owns N_E3 (published); N3 is a stranger; NP is an accepted co-planner
-- of N_E1 when part 6 (page_planners) is loaded.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'n1@x.com', now()), ('00000000-0000-0000-0000-0000000000d2', 'n2@x.com', now()),
  ('00000000-0000-0000-0000-0000000000d3', 'n3@x.com', now()), ('00000000-0000-0000-0000-0000000000d4', 'np@x.com', now());
insert into public.events (id, slug, owner, config, published) values
  ('00000000-0000-0000-0000-0000000000f1', 'party-f1abc', '00000000-0000-0000-0000-0000000000d1', '{"title":"Dylan''s <b>party</b>","cover":"https://x.com/a.jpg","start":"2026-12-31","venue":{"name":"Loft"}}', true),
  ('00000000-0000-0000-0000-0000000000f2', 'hidden-f2abc', '00000000-0000-0000-0000-0000000000d1', '{"title":"Hidden","cover":"javascript:alert(1)"}', false),
  ('00000000-0000-0000-0000-0000000000f3', 'other-f3abc', '00000000-0000-0000-0000-0000000000d2', '{"title":"Other"}', true);
do $$ begin
  if to_regclass('public.page_planners') is not null then
    insert into public.page_planners (event_id, email) values ('00000000-0000-0000-0000-0000000000f1', 'np@x.com');
    update public.page_planners set user_id = '00000000-0000-0000-0000-0000000000d4', accepted_at = now()
      where event_id = '00000000-0000-0000-0000-0000000000f1' and email = 'np@x.com';
  end if;
end $$;
create temp table nm_has_planners as select to_regclass('public.page_planners') is not null as v;
grant select on nm_has_planners to anon, authenticated;

-- ===== N1, owner
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', false);
select t_txt(public.page_name_check('dylansparty', '00000000-0000-0000-0000-0000000000f1'), 'ok', 'a free name is ok');
select t_txt(public.page_name_check('ab', null), 'invalid', 'too short');
select t_txt(public.page_name_check(repeat('a', 41), null), 'invalid', 'too long (41)');
select t_txt(public.page_name_check(repeat('a', 40), null), 'ok', '40 chars is fine');
select t_txt(public.page_name_check('-abc', null), 'invalid', 'no leading hyphen');
select t_txt(public.page_name_check('abc-', null), 'invalid', 'no trailing hyphen');
select t_txt(public.page_name_check('a--b', null), 'invalid', 'no double hyphen');
select t_txt(public.page_name_check('a_b c', null), 'invalid', 'only a-z 0-9 -');
select t_txt(public.page_name_check('café', null), 'invalid', 'no accents');
select t_txt(public.page_name_check('DylansParty', null), 'ok', 'upper case is folded to lower');
select t_txt(public.page_name_check('mine', null), 'reserved', 'app route reserved');
select t_txt(public.page_name_check('supabase', null), 'reserved', 'site folder reserved');
select t_txt(public.page_name_check('admin', null), 'reserved', 'admin reserved');
select t_txt(public.page_name_check('ai', null), 'invalid', 'two letters is too short anyway');
select t_txt(public.page_name_check('assets', null), 'reserved', 'assets reserved');
select t_txt(public.page_name_check('fuckparty', null), 'reserved', 'profanity-lite');
select t_txt(public.page_name_set('00000000-0000-0000-0000-0000000000f1', ' DylansParty '), 'dylansparty', 'owner names the page (trimmed, lower-cased)');
select t_txt(public.page_name_check('dylansparty', '00000000-0000-0000-0000-0000000000f1'), 'yours', 'now it is this page''s name');
select t_txt(public.page_name_check('dylansparty', '00000000-0000-0000-0000-0000000000f2'), 'taken', 'taken for the owner''s other page');
select t_fail($$select public.page_name_set('00000000-0000-0000-0000-0000000000f2', 'dylansparty')$$, 'one name, one page (even for the same owner)');
select t_fail($$select public.page_name_set('00000000-0000-0000-0000-0000000000f1', 'settings')$$, 'reserved refused by the server');
select t_fail($$select public.page_name_set('00000000-0000-0000-0000-0000000000f1', 'a b')$$, 'invalid refused by the server');
select t_txt(public.page_name_set('00000000-0000-0000-0000-0000000000f1', 'dylansparty'), 'dylansparty', 'setting the same name again is a no-op');
select t_txt(public.page_name_set('00000000-0000-0000-0000-0000000000f1', 'dylans-nye'), 'dylans-nye', 'rename');
select t_eq((select count(*) from public.page_names where event_id = '00000000-0000-0000-0000-0000000000f1'), 2, 'old name kept as an alias');
select t_eq((select count(*) from public.page_names where event_id = '00000000-0000-0000-0000-0000000000f1' and is_current), 1, 'one current name');
select t_txt(public.page_name_check('dylansparty', '00000000-0000-0000-0000-0000000000f1'), 'alias', 'the old name reads as this page''s alias');
select t_fail($$insert into public.page_names (name, event_id) values ('sneaky', '00000000-0000-0000-0000-0000000000f1')$$, 'no direct insert');
select t_fail($$update public.page_names set is_current = true$$, 'no direct update');
select t_fail($$delete from public.page_names$$, 'no direct delete');
select t_txt(public.page_name_set('00000000-0000-0000-0000-0000000000f2', 'quiet-page'), 'quiet-page', 'owner names their hidden page');
select t_eq((select count(*) from public.page_name_resolve('quiet-page')), 1, 'the owner opens their own hidden page by name');
reset role;
select t_eq((select count(*) from public.page_names where name = 'sneaky'), 0, 'nothing written directly');

-- ===== N2, another owner: cannot take or change N1's names
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', false);
select t_txt(public.page_name_check('dylansparty', '00000000-0000-0000-0000-0000000000f3'), 'taken', 'someone else''s alias is taken');
select t_txt(public.page_name_check('dylansparty', '00000000-0000-0000-0000-0000000000f1'), 'taken', 'cannot claim to be that page');
select t_fail($$select public.page_name_set('00000000-0000-0000-0000-0000000000f3', 'dylans-nye')$$, 'cannot take a current name');
select t_fail($$select public.page_name_set('00000000-0000-0000-0000-0000000000f3', 'dylansparty')$$, 'cannot take an old name (printed links keep working)');
select t_fail($$select public.page_name_set('00000000-0000-0000-0000-0000000000f1', 'stolen-name')$$, 'cannot rename someone else''s page');
select t_eq((select count(*) from public.page_names), 0, 'cannot read others'' name rows');
select t_txt(public.page_name_set('00000000-0000-0000-0000-0000000000f3', 'other-party'), 'other-party', 'names their own page');
select t_eq((select count(*) from public.page_names), 1, 'reads only their own name rows');
reset role;

-- ===== N3, a stranger: nothing
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}', false);
select t_fail($$select public.page_name_set('00000000-0000-0000-0000-0000000000f1', 'mine-now')$$, 'stranger cannot rename');
select t_eq((select count(*) from public.page_name_resolve('quiet-page')), 0, 'stranger cannot open a hidden page by name');
reset role;

-- ===== co-planner (part 6)
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', false);
select case when (select v from nm_has_planners)
  then t_ok($$select public.page_name_set('00000000-0000-0000-0000-0000000000f1', 'dylans-nye-2026')$$, 'an accepted co-planner renames the page')
  else t_ok($$select 1$$, 'co-planner check skipped (part 6 not loaded)') end;
select case when (select v from nm_has_planners)
  then t_fail($$select public.page_name_set('00000000-0000-0000-0000-0000000000f3', 'planner-grab')$$, 'a co-planner cannot rename another page')
  else t_ok($$select 1$$, 'co-planner check skipped (part 6 not loaded)') end;
reset role;
-- put the owner's name back for the checks below whichever path ran
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', false);
select t_txt(public.page_name_set('00000000-0000-0000-0000-0000000000f1', 'dylans-nye'), 'dylans-nye', 'the owner takes back an old name of the page (alias → current)');
select t_eq((select count(*) from public.page_names where event_id = '00000000-0000-0000-0000-0000000000f1' and is_current), 1, 'still one current name');
reset role;

-- ===== anon: resolve, name-for, the public list; no table, no writes
set role anon; select set_config('request.jwt.claims', '', false);
select t_fail($$select count(*) from public.page_names$$, 'anon cannot read the table');
select t_fail($$select public.page_name_set('00000000-0000-0000-0000-0000000000f1', 'anon-name')$$, 'anon cannot set a name');
select t_fail($$select public.page_name_check('free-name', null)$$, 'anon cannot run the availability check');
select t_txt((select slug from public.page_name_resolve('dylans-nye')), 'party-f1abc', 'current name opens the page');
select t_txt((select slug from public.page_name_resolve('DylansParty')), 'party-f1abc', 'old name (any case) opens the same page');
select t_txt((select name from public.page_name_resolve('dylansparty')), 'dylans-nye', 'and says the current name (redirect)');
select t_eq((select count(*) from public.page_name_resolve('quiet-page')), 0, 'a hidden page''s name opens nothing');
select t_eq((select count(*) from public.page_name_resolve('nobody-here')), 0, 'unknown name: nothing');
select t_eq((select count(*) from public.page_name_resolve('%')), 0, 'a pattern is not a name');
select t_txt(public.page_name_for('party-f1abc'), 'dylans-nye', 'the pretty name of a ?e= page');
select t_txt(public.page_name_for('hidden-f2abc'), null, 'no name for a hidden page');
select t_eq((select count(*) from public.page_names_public()), (select case when v then 4 else 3 end from nm_has_planners), 'public list: every name of published pages (N_E1''s + N_E3''s)');
select t_eq((select count(*) from public.page_names_public() where name = 'quiet-page'), 0, 'public list skips hidden pages');
select t_txt((select current_name from public.page_names_public() where name = 'dylansparty'), 'dylans-nye', 'aliases carry the current name');
select t_txt((select image from public.page_names_public() where name = 'dylans-nye'), 'https://x.com/a.jpg', 'https cover passes');
reset role;
update public.events set config = config || '{"cover":"javascript:alert(1)"}' where id = '00000000-0000-0000-0000-0000000000f1';
set role anon; select t_txt((select image from public.page_names_public() where name = 'dylans-nye'), '', 'non-https cover dropped'); reset role;

-- unpublishing hides the name; deleting the page frees its names
update public.events set published = false where id = '00000000-0000-0000-0000-0000000000f1';
set role anon; select t_eq((select count(*) from public.page_name_resolve('dylans-nye')), 0, 'unpublished: the name opens nothing'); reset role;
update public.events set published = true where id = '00000000-0000-0000-0000-0000000000f1';
delete from public.events where id = '00000000-0000-0000-0000-0000000000f1';
select t_eq((select count(*) from public.page_names where event_id = '00000000-0000-0000-0000-0000000000f1'), 0, 'deleting the page deletes its names');

-- limit: 20 names per page
set role authenticated; select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', false);
do $$ begin for i in 1..19 loop perform public.page_name_set('00000000-0000-0000-0000-0000000000f3', 'other-n' || i); end loop; end $$;
select t_eq((select count(*) from public.page_names where event_id = '00000000-0000-0000-0000-0000000000f3'), 20, '20 names on one page');
select t_fail($$select public.page_name_set('00000000-0000-0000-0000-0000000000f3', 'one-too-many')$$, 'the 21st name is refused');
select t_txt(public.page_name_set('00000000-0000-0000-0000-0000000000f3', 'other-party'), 'other-party', 'an old name of the page still works at the limit');
reset role;
