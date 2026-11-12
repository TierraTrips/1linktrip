// Messages, groups and "Send to" (schema-3), at phone width:
//   • every piece stays hidden, with no script errors, while the tables are missing (404 from the probe)
//   • guest: "Message the host" (signed out → sign-in; signed in → send), thread + group updates on My trip, group picker in RSVP
//   • host: inbox + reply in My pages, groups editor (add, paste emails, guests can pick), Send to: Everyone / chosen groups
//   • builder: the Messages card and its "Let guests message you" switch
//   • Add a booking review cards: Departs / Arrives show the whole time at 390px
// The database is faked in the page (supabase-js stand-in + routed REST); the access rules themselves are tested on
// Postgres by tests/rls/run.sh.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/messages.js
//   SHOTS=/Users/bot/bbbot/run/tmp-msg node tests/messages.js
//
// Needs Playwright. Exit code 1 on any failure.
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };

const EID = '11111111-1111-4111-8111-111111111111', SLUG = 'ana-ben-k7m2q';
const HOST = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', email: 'host@example.com' };
const GUEST = { id: 'bbbbbbbb-0000-4000-8000-00000000000b', email: 'gia@example.com', user_metadata: { full_name: 'Gia Park' } };
const GV = 'c0000000-0000-4000-8000-000000000001', GF = 'c0000000-0000-4000-8000-000000000002', GH = 'c0000000-0000-4000-8000-000000000003';
const CFG = { v: 2, type: 'Wedding', title: 'Ana & Ben', host: 'Ana and Ben', start: '2027-06-12T16:00', end: '', venue: null, guestMessages: true, tools: { mytrip: true, packing: true } };

// a tiny in-page stand-in for the parts of supabase-js the app uses
function fakeSupabase(seed) {
  const db = window.__db = JSON.parse(JSON.stringify(seed.db)); window.__user = seed.user; window.__calls = [];
  let n = 0; const uid = () => 'f0000000-0000-4000-8000-' + String(++n).padStart(12, '0');
  const qb = (name) => {
    const fs = []; let op = 'select', rows = null, patch = null, lim = 1e9, one = 0, head = false, ord = [];
    const run = () => {
      const T = db[name] = db[name] || []; let data, count;
      const match = () => T.filter(r => fs.every(f => f(r)));
      if (op === 'insert' || op === 'upsert') {
        data = rows.map(r => {
          const x = { id: uid(), created_at: new Date(Date.now() + n * 1000).toISOString(), ...r };
          if (name === 'event_messages' && !x.from_host) { x.from_host = false; x.guest = window.__user.id; x.guest_email = window.__user.email; }
          if (name === 'announcements' && !x.group_ids) x.group_ids = [];
          if (op === 'upsert' && name === 'event_group_members' && T.some(y => y.group_id === x.group_id && y.email === x.email)) return null;
          T.push(x); return x;
        }).filter(Boolean);
      } else if (op === 'update') { data = match(); data.forEach(r => Object.assign(r, patch)); }
      else if (op === 'delete') { data = match(); db[name] = T.filter(r => !data.includes(r)); }
      else { data = match(); for (const [k, asc] of ord.slice().reverse()) data.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)); count = data.length; data = data.slice(0, lim); }
      window.__calls.push({ name, op, rows, patch });
      if (head) return { data: null, count, error: null };
      if (one) return { data: data[0] || null, error: one === 2 && !data[0] ? { message: 'none' } : null };
      return { data, count, error: null };
    };
    const q = {
      select: (_c, o) => { if (o && o.head) head = true; return q; }, insert: (r) => { op = 'insert'; rows = [].concat(r); return q; },
      upsert: (r) => { op = 'upsert'; rows = [].concat(r); return q; }, update: (p) => { op = 'update'; patch = p; return q; }, delete: () => { op = 'delete'; return q; },
      eq: (k, v) => { fs.push(r => r[k] === v); return q; }, neq: (k, v) => { fs.push(r => r[k] !== v); return q; }, in: (k, vs) => { fs.push(r => vs.includes(r[k])); return q; },
      is: (k, v) => { fs.push(r => (r[k] ?? null) === v); return q; }, not: () => q, gte: (k, v) => { fs.push(r => r[k] >= v); return q; },
      order: (k, o) => { ord.push([k, !o || o.ascending !== false]); return q; }, limit: (x) => { lim = x; return q; },
      single: () => { one = 2; return Promise.resolve(run()); }, maybeSingle: () => { one = 1; return Promise.resolve(run()); },
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  const client = { from: qb, auth: { getSession: async () => ({ data: { session: window.__user ? { user: window.__user, access_token: 'tok' } : null } }), signOut: async () => ({}), signInWithOtp: async () => ({ error: null }) } };
  window.supabase = { createClient: () => client };
}

async function setup(browser, { tables = true, user = null, db = {}, notify = 404 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; const posted = { rsvps: [], notify: [] };
  page.on('pageerror', e => errors.push(String(e)));
  const full = { events: [{ id: EID, slug: SLUG, owner: HOST.id, config: CFG, published: true }], event_messages: [], announcements: [], event_groups: [], event_group_members: [], rsvps: [], ...db };
  await page.addInitScript(fakeSupabase, { db: full, user });
  const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await page.route('**/*.supabase.co/**', (route) => {
    const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
    if (m === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p.endsWith('/functions/v1/notify')) { if (m === 'POST') posted.notify.push(JSON.parse(route.request().postData())); return J(route, notify, {}); }
    if (p.includes('/functions/')) return J(route, 404, {});
    const tbl = p.split('/rest/v1/')[1];
    if (tbl === 'event_groups' && !tables) return J(route, 404, { code: 'PGRST205', message: "Could not find the table 'public.event_groups' in the schema cache" });
    if (tbl === 'events') return J(route, 200, full.events.filter(e => u.search.includes(e.slug)).map(e => ({ ...e, updated_at: '2026-11-01T00:00:00Z' })));
    if (tbl === 'announcements') return J(route, 200, full.announcements.filter(a => !(a.group_ids || []).length));
    if (tbl === 'event_groups') return J(route, 200, u.searchParams.get('self_pick') ? full.event_groups.filter(g => g.self_pick) : []);
    if (tbl === 'rsvps' && m === 'POST') { posted.rsvps.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' }); }
    return J(route, 404, {});
  });
  await page.route(/open-meteo|overpass|nominatim|googleapis\.com\/(?!css)|tile\.openstreetmap/, r => r.abort());
  return { ctx, page, errors, posted };
}
const groups = [{ id: GV, event_id: EID, name: 'VIPs', self_pick: false, sort: 0 }, { id: GF, event_id: EID, name: 'Full marathon', self_pick: true, sort: 1 }, { id: GH, event_id: EID, name: 'Half marathon', self_pick: true, sort: 2 }];
const shot = async (loc, name) => { if (SHOTS) await loc.screenshot({ path: `${SHOTS}/${name}.png` }); };

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. tables missing: nothing shows, nothing throws ----------
  {
    const { ctx, page, errors } = await setup(browser, { tables: false, user: HOST });
    await page.goto(BASE + '?e=' + SLUG); await page.waitForSelector('.ev-title');
    await page.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('ep:msgReady') || 'null'); return c && c.ok === false; });
    await page.waitForTimeout(300);
    ok(!(await page.$('#sec-gm')) && !(await page.$('#sec-gmt')), 'tables missing: no "Message the host" and no Messages on My trip');
    ok(await page.$eval('[data-rsvp-group]', el => el.innerHTML.trim() === ''), 'tables missing: RSVP has no group picker');
    await shot(page, 'missing-guest');
    await page.evaluate(() => localStorage.setItem('ep:signedIn', 'true'));
    await page.goto(BASE + '#mine/' + EID); await page.waitForSelector('.ann-form');
    ok(!(await page.$('#mine-msgs')) && !(await page.$('#mine-groups')) && !(await page.$('.send-to')), 'tables missing: My pages has no Messages, Groups or Send to');
    await page.evaluate((c) => { localStorage.setItem('ep:draft', JSON.stringify(c)); localStorage.setItem('ep:draftHosted', JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', slug: 'ana-ben-k7m2q' })); }, CFG);
    await page.goto(BASE + '#new'); await page.waitForSelector('.b-form .cards'); await page.waitForTimeout(400);
    ok(!(await page.$('[data-card="msgs"]')), 'tables missing: builder has no Messages card');
    ok(!errors.length, 'tables missing: no script errors ' + errors.join(' | '));
    await ctx.close();
  }

  // ---------- 2. guest signed out: sign-in prompt, group picker at RSVP ----------
  {
    const { ctx, page, errors, posted } = await setup(browser, { db: { event_groups: groups } });
    await page.goto(BASE + '?e=' + SLUG); await page.waitForSelector('#sec-gm .gm-signin');
    ok(/Sign in first/.test(await page.textContent('#sec-gm')), 'signed out: "Message the host" asks to sign in');
    await page.waitForSelector('#rs-group');
    const opts = await page.$$eval('#rs-group option', os => os.map(o => o.textContent));
    ok(opts.join('|') === 'Choose|Full marathon|Half marathon', 'RSVP group picker lists only pickable groups: ' + opts.join(' | '));
    await page.fill('#rs-name', 'Gia Park'); await page.fill('#rs-email', 'gia@example.com'); await page.selectOption('#rs-group', GF);
    await page.locator('#sec-rsvp').screenshot(SHOTS ? { path: `${SHOTS}/rsvp-group-picker.png` } : {});
    await page.locator('#sec-gm').screenshot(SHOTS ? { path: `${SHOTS}/guest-signed-out.png` } : {});
    await page.click('[data-rsvp="send"]'); await page.waitForSelector('.rsvp-done');
    ok(posted.rsvps.length === 1 && posted.rsvps[0].group_id === GF, 'RSVP sends the picked group');
    ok(await page.evaluate((id) => JSON.parse(localStorage.getItem('ep:grpPick:' + id)), EID) === GF, 'signed out: the pick waits for sign-in on this device');
    // the Google button returns the guest to this page and tab
    await page.evaluate(() => { const a = document.querySelector('.gm-signin [data-si-oauth]'); if (a) a.addEventListener('click', e => e.preventDefault()); });
    if (await page.$('.gm-signin [data-si-oauth]')) { await page.click('.gm-signin [data-si-oauth]'); ok(await page.evaluate(() => JSON.parse(localStorage.getItem('ep:afterSignIn'))) === '?e=' + SLUG, 'sign-in comes back to the hosted page'); }
    ok(!errors.length, 'guest signed out: no script errors ' + errors.join(' | '));
    await ctx.close();
  }

  // ---------- 3. guest signed in: send, thread on My trip, updates for their group ----------
  {
    const db = { event_groups: groups, event_group_members: [{ event_id: EID, group_id: GV, email: GUEST.email, added_by: 'host' }],
      announcements: [{ id: 'a1', event_id: EID, body: 'Shuttle leaves at 4:30.', group_ids: [], created_at: '2026-11-10T10:00:00Z' }, { id: 'a2', event_id: EID, body: 'VIP dinner at 7 in the garden room.', group_ids: [GV], created_at: '2026-11-11T10:00:00Z' }],
      event_messages: [{ id: 'm0', event_id: EID, guest: GUEST.id, from_host: true, body: 'Welcome! Ask us anything.', created_at: '2026-11-11T09:00:00Z' }] };
    // the host's earlier welcome only exists as a reply in this fake; real threads always start with the guest
    db.event_messages.unshift({ id: 'm-1', event_id: EID, guest: GUEST.id, from_host: false, guest_name: 'Gia Park', guest_email: GUEST.email, body: 'Hi! Is there parking?', created_at: '2026-11-11T08:00:00Z' });
    const { ctx, page, errors, posted } = await setup(browser, { user: GUEST, db, notify: 401 });
    await page.addInitScript((id) => { if (!localStorage.getItem('ep:signedIn')) { localStorage.setItem('ep:signedIn', 'true'); localStorage.setItem('ep:grpPick:' + id, JSON.stringify('c0000000-0000-4000-8000-000000000002')); } }, EID);
    await page.goto(BASE + '?e=' + SLUG); await page.waitForSelector('#sec-gm textarea');
    await page.waitForFunction(() => !localStorage.getItem('ep:grpPick:11111111-1111-4111-8111-111111111111'));
    ok(await page.evaluate(() => window.__db.event_group_members.some(m => m.group_id === 'c0000000-0000-4000-8000-000000000002' && m.email === 'gia@example.com' && m.added_by === 'guest')), 'signed in: the RSVP group pick is saved to the account');
    ok(await page.$eval('[data-tab-go="mytrip"][role="tab"]', b => b.classList.contains('has-new')), 'My trip tab shows a dot for a new host message');
    await page.fill('#gm-ev', 'Can I bring my dog?'); await page.click('[data-gm-send="ev"]');
    await page.waitForFunction(() => window.__db.event_messages.some(m => m.body === 'Can I bring my dog?'));
    const sent = await page.evaluate(() => window.__db.event_messages.find(m => m.body === 'Can I bring my dog?'));
    ok(sent.guest === GUEST.id && sent.guest_name === 'Gia Park' && sent.event_id === EID, 'guest message saved to their own thread with their name');
    await page.waitForFunction(() => /Sent/.test(document.querySelector('#sec-gm [data-gm-msg]')?.textContent || ''));
    await page.waitForTimeout(300);
    ok(posted.notify.length === 1 && posted.notify[0].kind === 'message', 'email notification requested once the notify function answers');
    await page.locator('#sec-gm').screenshot(SHOTS ? { path: `${SHOTS}/guest-event-compose.png` } : {});
    await page.click('[data-tab-go="mytrip"][role="tab"]'); await page.waitForSelector('#sec-gmt .msg-list');
    const txt = await page.textContent('#sec-gmt');
    ok(/VIP dinner at 7/.test(txt) && /VIPs/.test(txt), 'My trip: the VIP update shows, tagged with its group');
    ok(!/Shuttle leaves/.test(txt), 'My trip: updates for everyone stay on the Event tab, not duplicated');
    ok((await page.$$('#sec-gmt .msg')).length === 3 && /Ana and Ben/.test(txt) && /Can I bring my dog/.test(txt), 'My trip: the whole thread, host shown by the page’s host name');
    ok(!/host@example\.com/.test(await page.content()), 'the host’s email is nowhere on the guest page');
    ok(!(await page.$eval('[data-tab-go="mytrip"][role="tab"]', b => b.classList.contains('has-new'))), 'opening My trip clears the dot');
    await page.locator('#sec-gmt').screenshot(SHOTS ? { path: `${SHOTS}/guest-mytrip-messages.png` } : {});
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov <= 0, 'no sideways scroll at 390px on My trip');
    ok(!errors.length, 'guest signed in: no script errors ' + errors.join(' | '));
    await ctx.close();
  }

  // ---------- 4. host: inbox, reply, groups editor, Send to ----------
  {
    const db = { event_groups: groups, event_group_members: [{ event_id: EID, group_id: GV, email: 'gia@example.com', added_by: 'host' }, { event_id: EID, group_id: GF, email: 'sam@example.com', added_by: 'guest' }],
      event_messages: [{ id: 'm1', event_id: EID, guest: GUEST.id, from_host: false, guest_name: 'Gia Park', guest_email: 'gia@example.com', body: 'Is there parking at the venue?', created_at: '2026-11-11T08:00:00Z' },
        { id: 'm2', event_id: EID, guest: 'dddddddd-0000-4000-8000-00000000000d', from_host: false, guest_name: null, guest_email: 'sam@example.com', body: 'What time does the shuttle leave?', created_at: '2026-11-11T09:00:00Z' }],
      rsvps: [{ id: 'r1', event_id: EID, name: 'Sam Lee', email: 'sam@example.com', attending: true, guests: 1, note: null, group_id: GF, created_at: '2026-11-10T00:00:00Z' }] };
    const { ctx, page, errors, posted } = await setup(browser, { user: HOST, db, notify: 401 });
    await page.addInitScript(() => localStorage.setItem('ep:signedIn', 'true'));
    await page.goto(BASE + '#mine'); await page.waitForSelector('.mine-list');
    await page.waitForSelector('.mine-list .badge');
    ok(/2 new/.test(await page.textContent('.mine-list .badge')), 'My pages list: "2 new" on the page with unanswered messages');
    await page.goto(BASE + '#mine/' + EID); await page.waitForSelector('#mine-msgs');
    const thr = await page.$$eval('#mine-msgs details.thr', ds => ds.map(d => d.querySelector('summary').textContent.replace(/\s+/g, ' ').trim()));
    ok(thr.length === 2 && /sam@example\.com/.test(thr[0]) && /Gia Park/.test(thr[1]), 'inbox: one thread per guest, newest first: ' + thr.join(' / '));
    ok((await page.$$('#mine-msgs .dot')).length === 2, 'inbox: unread dots');
    ok(await page.$eval('[data-gm-on]', i => i.checked), 'inbox: "Let guests message you" reflects the page');
    ok(/Full marathon/.test(await page.textContent('.rs-tbl')), 'Replies table shows the group picked at RSVP');
    await shot(page.locator('#mine-msgs'), 'host-inbox');
    await page.click(`details.thr[data-thr="${GUEST.id}"] summary`);
    await page.fill(`#gm-h-${GUEST.id}`, 'Yes, lot B behind the barn.'); await page.click(`[data-gm-send="h-${GUEST.id}"]`);
    await page.waitForFunction(() => window.__db.event_messages.some(m => m.from_host && /lot B/.test(m.body)));
    const rep = await page.evaluate(() => window.__db.event_messages.find(m => m.from_host));
    ok(rep.guest === GUEST.id && rep.event_id === EID, 'host reply goes into that guest’s thread');
    await page.waitForSelector(`details.thr[data-thr="${GUEST.id}"][open] .msg.out`);
    ok((await page.$$('#mine-msgs .dot')).length === 1, 'opening a thread marks it read; the reply keeps it open');
    await shot(page.locator(`details.thr[data-thr="${GUEST.id}"]`), 'host-thread-reply');
    ok(posted.notify.some(x => x.kind === 'message'), 'reply asks for an email to the guest');

    // groups editor
    const names = await page.$$eval('#mine-groups .grp-card .grp-h b', bs => bs.map(b => b.textContent));
    ok(names.join('|') === 'VIPs|Full marathon|Half marathon', 'Groups lists the page’s groups');
    await page.fill('#mine-groups [data-g-name]', 'Wedding party'); await page.click('#mine-groups [data-g-new]');
    await page.waitForFunction(() => [...document.querySelectorAll('#mine-groups .grp-h b')].some(b => b.textContent === 'Wedding party'));
    const wp = await page.evaluate(() => window.__db.event_groups.find(g => g.name === 'Wedding party').id);
    await page.click(`.grp-card[data-gid="${wp}"] .grp-more summary`);
    await page.fill(`[data-g-paste="${wp}"]`, 'Maid Of Honor <moh@example.com>\nbest.man@example.com, bad-entry\nmoh@example.com');
    await page.click(`[data-g-add="${wp}"]`);
    await page.waitForFunction((g) => window.__db.event_group_members.filter(m => m.group_id === g).length === 2, wp);
    ok((await page.evaluate((g) => window.__db.event_group_members.filter(m => m.group_id === g).map(m => m.email).sort().join(), wp)) === 'best.man@example.com,moh@example.com', 'paste a list: emails found, lowercased, deduped');
    await page.waitForSelector(`.grp-card[data-gid="${wp}"]`);
    ok(/2 people/.test(await page.textContent(`.grp-card[data-gid="${wp}"] .grp-h`)), 'group shows its member count');
    await page.click(`.grp-card[data-gid="${GH}"] .tool`);
    await page.waitForFunction((g) => window.__db.event_groups.find(x => x.id === g).self_pick === false, GH);
    ok(true, '"Guests can pick" switch saves');
    await page.click(`.grp-card[data-gid="${GF}"] .grp-more summary`);
    await shot(page.locator('#mine-groups'), 'host-groups');

    // Send to
    ok((await page.$$eval('.send-to .chip', cs => cs.map(c => c.textContent))).join('|') === 'Everyone|VIPs|Full marathon|Half marathon|Wedding party', 'Send to: Everyone + each group');
    await page.click('.send-to [data-st-g="' + GV + '"]');
    ok(!(await page.$eval('.send-to [data-st-all]', b => b.classList.contains('on'))), 'choosing a group turns off Everyone');
    await page.fill('#an-body', 'VIP photos at 5:15 by the fountain.');
    await shot(page.locator('.ann-form'), 'host-send-to');
    await page.click('[data-an="post"]');
    await page.waitForFunction(() => window.__db.announcements.some(a => /VIP photos/.test(a.body)));
    const an = await page.evaluate(() => window.__db.announcements.find(a => /VIP photos/.test(a.body)));
    ok(JSON.stringify(an.group_ids) === JSON.stringify([GV]), 'update saved for the chosen group only');
    ok(!(await page.evaluate(() => window.__calls.some(c => c.name === 'events' && c.op === 'update' && JSON.stringify(c.patch).includes('VIP photos')))), 'a group update is never copied into the public page config');
    await page.waitForSelector('.ann-list.own li');
    ok(/Send to: VIPs/.test(await page.textContent('.ann-list.own')), 'posted update shows who it went to');
    await page.click('.send-to [data-st-all]');
    await page.fill('#an-body', 'Ceremony starts at 4 sharp.'); await page.click('[data-an="post"]');
    await page.waitForFunction(() => window.__db.announcements.some(a => /4 sharp/.test(a.body)));
    ok((await page.evaluate(() => window.__db.announcements.find(a => /4 sharp/.test(a.body)).group_ids)).length === 0, 'Everyone: saved with no groups');
    ok(posted.notify.filter(x => x.kind === 'announcement').length === 2, 'each update asks for its email once');
    await page.click('.gm-on'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => window.__db.events[0].config.guestMessages === false), 'switching messages off saves to the page');
    await shot(page, 'host-mypages-full');
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov <= 0, 'no sideways scroll at 390px in My pages');
    ok(!errors.length, 'host: no script errors ' + errors.join(' | '));
    await ctx.close();
  }

  // ---------- 5. builder: Messages card ----------
  {
    const { ctx, page, errors } = await setup(browser, { user: HOST, db: { event_groups: groups } });
    await page.addInitScript((c) => { if (!localStorage.getItem('ep:draft')) { localStorage.setItem('ep:signedIn', 'true'); localStorage.setItem('ep:draft', JSON.stringify({ ...c, guestMessages: false })); localStorage.setItem('ep:draftHosted', JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', slug: 'ana-ben-k7m2q' })); } }, CFG);
    await page.goto(BASE + '#new'); await page.waitForSelector('[data-card="msgs"]');
    await page.click('[data-card="msgs"]'); await page.waitForSelector('#sheet .grp-card');
    ok((await page.$$('#sheet .grp-card')).length === 3, 'builder card loads the groups editor for a hosted page');
    await page.click('#sheet .tool:has([data-gmsg])'); await page.waitForTimeout(500);
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).guestMessages === true), '"Let guests message you" turns on in the page');
    await shot(page.locator('#sheet .sheet-in'), 'builder-messages-card');
    ok(!errors.length, 'builder: no script errors ' + errors.join(' | '));
    await ctx.close();
  }

  // ---------- 6. Add a booking: review cards show the whole time at 390px ----------
  {
    const { ctx, page } = await setup(browser, {});
    await page.goto(BASE + '?demo=wedding#t=mytrip'); await page.waitForSelector('[data-itin-add]');
    await page.click('[data-itin-add]'); await page.click('[data-itin-mode="paste"]');
    await page.fill('#it-paste', 'Delta Air Lines\nFlight DL 1873\nThu, Mar 11, 2027 8:05 AM\nArrives Thu, Mar 11, 2027 11:52 AM\nConfirmation number: HX7Q2L');
    await page.click('[data-itin-read]'); await page.waitForSelector('.rv-card');
    const w = await page.$$eval('.rv-card input[type="datetime-local"]', is => is.map(i => { const r = i.getBoundingClientRect(); const card = i.closest('.rv-card').getBoundingClientRect(); return { w: r.width, card: card.width, right: r.right <= card.right + 0.5 }; }));
    ok(w.length >= 1 && w.every(x => x.w >= x.card - 30 && x.right), 'Departs/Arrives take the full card width: ' + JSON.stringify(w));
    await shot(page.locator('.rv-card').first(), 'review-card-times');
    await ctx.close();
  }

  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
