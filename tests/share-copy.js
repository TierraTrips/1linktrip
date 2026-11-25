// Personal copy + Share my trip (Dylan 11/25).
//  1. A guest's view = the organizer's plan + their own overlay: Edit / Hide an organizer's item (private, per device +
//     account); organizer changes flow through; an item they edited that the organizer changed since keeps their version
//     and asks "Updated — use the new one?" (Use new / Keep mine). Show hidden (N) brings hidden ones back.
//  2. Share has two choices: Invite guests (the page link) and Share my trip (the plan + your bookings, live, revocable).
//  3. Type rule: a Trip's plan includes the organizer's hotels/flights; a wedding / conference… page doesn't show them.
//  4. A Share my trip link opens My trip pre-filled with the sharer's bookings (base of the recipient's copy).
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/share-copy.js     (SHOTS=<dir> for screenshots)
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const VENUE = { name: 'Hotel Esencia', address: 'Xpu-Ha, Quintana Roo', lat: 20.47, lon: -87.26, city: 'Xpu-Ha', country: 'Mexico', cc: 'mx' };
const WED = { v: 2, type: 'Wedding', title: 'Ana and Leo', start: '2027-03-12', end: '2027-03-14', venue: VENUE, tz: 'America/Cancun',
  tools: { weather: false, travel: true, stay: true, nearby: false, tours: false, mytrip: true, packing: false, shopping: false },
  schedule: [
    { date: '2027-03-12', time: '19:00', title: 'Welcome drinks', note: 'Beach bar' },
    { date: '2027-03-13', time: '16:00', title: 'Ceremony', note: 'On the lawn' },
    { date: '2027-03-11', time: '', title: 'Check in: Grand Hyatt Playa', note: 'Our room, conf 88812' },
    { date: '2027-03-11', time: '09:10', title: 'Depart New York JFK on AA 1234', note: '' },
    { date: '2027-03-11', time: '12:55', title: 'Arrive Cancun CUN', note: '' },
    { date: '2027-03-14', time: '', title: 'Check out: Grand Hyatt Playa', note: '' }] };
const TRIP = { ...WED, type: 'Trip', title: 'Ana and Leo trip' };

function fakeSupabase() { // trip_shares / trip_items under owner-only rules; a session from localStorage['mock-user']
  const db = (t) => JSON.parse(localStorage.getItem('mock-' + t) || '[]'); const put = (t, xs) => localStorage.setItem('mock-' + t, JSON.stringify(xs));
  const user = () => { const u = localStorage.getItem('mock-user'); return u ? JSON.parse(u) : null; };
  const q = (table) => { const st = { op: 'select', filters: [], single: false };
    const run = async () => {
      const u = user(); let xs = db(table); const match = (r) => st.filters.every(([k, v]) => r[k] === v); const mine = (r) => u && r.owner === u.id;
      if (table !== 'trip_shares') return { data: st.single ? null : [], error: null };
      if (st.op === 'insert') { if (!u || xs.some(r => r.owner === u.id && r.event_id === st.row.event_id)) return { data: null, error: { message: 'dup' } };
        const r = { token: [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''), owner: u.id, ...st.row }; xs.push(r); put(table, xs); return { data: r, error: null }; }
      if (st.op === 'update') { const hit = xs.filter(r => match(r) && mine(r)); hit.forEach(r => Object.assign(r, st.row)); put(table, xs); return { data: hit, error: null }; }
      if (st.op === 'delete') { put(table, xs.filter(r => !(match(r) && mine(r)))); return { data: null, error: null }; }
      const hit = xs.filter(r => match(r) && mine(r)); return { data: st.single ? hit[0] || null : hit, error: null };
    };
    const b = { select() { return b; }, eq(k, v) { st.filters.push([k, v]); return b; }, order() { return b; }, limit() { return b; }, in() { return b; }, not() { return b; }, upsert() { return b; },
      insert(row) { st.op = 'insert'; st.row = row; return b; }, update(row) { st.op = 'update'; st.row = row; return b; }, delete() { st.op = 'delete'; return b; }, single() { st.single = true; return b; }, maybeSingle() { st.single = true; return b; },
      then(res, rej) { return run().then(res, rej); } };
    return b; };
  window.supabase = { createClient: () => ({ from: q, storage: { from: () => ({}) }, functions: { invoke: async () => ({ data: null, error: { message: 'off' } }) }, rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => { const u = user(); return { data: { session: u ? { user: u, access_token: 'a.b.c' } : null } }; }, signInWithOtp: async () => ({ error: null }), signOut: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
}

(async () => {
  const browser = await chromium.launch();
  const mk = async (state) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript(fakeSupabase);
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon|functions\/v1|auth\/v1/, r => r.abort());
    await ctx.route(/\/rest\/v1\//, async r => { const u = r.request().url();
      if (/\/events\?/.test(u)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(state.event ? [state.event] : []) });
      if (/rpc\/trip_share_get/.test(u)) { const tok = JSON.parse(r.request().postData() || '{}').tok; state.rpc = (state.rpc || 0) + 1; return r.fulfill({ contentType: 'application/json', body: JSON.stringify(state.share && state.share.token === tok ? [state.share] : []) }); }
      return r.fulfill({ contentType: 'application/json', body: '[]' }); });
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.AIRPORTS);
    return { ctx, page };
  };
  const norm = (page, c) => page.evaluate((c) => window.__ep.normalize(JSON.parse(JSON.stringify(c))), c);
  const openPacked = async (page, c, tab) => { const packed = await page.evaluate((c) => window.__ep.packEvent(c), c); await page.goto(BASE + '#e=' + packed + (tab ? '&t=' + tab : '')); await page.reload(); await page.waitForSelector('.ev'); await page.waitForTimeout(250); };
  const rows = (page) => page.$$eval('[data-panel="event"] .tl li', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim()));
  const tapRow = async (page, txt) => { await page.evaluate((txt) => { document.querySelectorAll('.day:not(.open) [data-day-tog]').forEach(b => b.click()); }, txt); await page.locator('[data-panel="event"] .tl-go', { hasText: txt }).first().click(); await page.waitForSelector('dialog.ds-sheet[open]'); await page.waitForTimeout(150); };
  const show = (sel) => (page) => page.$eval(sel, e => !!e.checkVisibility()).catch(() => false);

  // ---------- 1. pure parts ----------
  {
    const { ctx, page } = await mk({});
    const r = await page.evaluate(() => { const E = window.__ep;
      const a = E.schedIds([{ date: '2027-01-01', title: 'A' }, { date: '2027-01-01', title: 'A' }, { title: 'B', id: 'keep1' }]);
      const b = E.schedIds([{ date: '2027-01-01', title: 'A' }, { date: '2027-01-01', title: 'A' }]);
      const sched = [{ id: 's1', date: '2027-01-02', time: '10:00', title: 'Tour', note: '' }, { id: 's2', date: '2027-01-03', time: '', title: 'Dinner', note: 'x' }, { id: 's3', date: '2027-01-04', title: 'Museum' }];
      const ov = { it: { s1: { e: { title: 'My tour', conf: 'C9' }, b: E.ovPick(sched[0]) }, s3: { h: 1 } } };
      const r1 = E.ovApply(sched, ov);
      const changed = sched.map(x => x.id === 's1' ? { ...x, time: '11:00' } : x);
      const r2 = E.ovApply(changed, ov);
      const detailsOnly = E.ovApply(changed, { it: { s1: { e: { conf: 'C9' }, b: E.ovPick(sched[0]) } } });
      const alias = E.ovApply([{ id: 'new1', date: '2027-01-02', time: '10:30', title: 'Tour', note: '' }], ov);
      const own = [{ id: 'mine1', kind: 'hotel', name: 'Mine' }];
      const S = [{ id: 'h1', kind: 'hotel', name: 'Park Hyatt', start: '2027-04-01T15:00' }, { id: 'f1', kind: 'flight', name: 'UA 1', start: '2027-04-01T09:00' }];
      const m1 = E.shareMerge(own, S, 'tok00000aaaa', []);
      const S2 = [{ ...S[0], name: 'Park Hyatt Tokyo' }, { ...S[1], start: '2027-04-01T10:00' }];
      const edited = m1.list.map(x => x.sh && x.sh.id === 'f1' ? { ...x, confNo: 'MY1' } : x);
      const m2 = E.shareMerge(edited, S2, 'tok00000aaaa', []);
      const m3 = E.shareMerge(m2.list, [S2[1]], 'tok00000aaaa', []); // sharer removed the hotel
      const gone = E.shareMerge([], S, 'tok00000aaaa', [m1.list[1].id]);
      return { a: a.map(x => x.id), b: b.map(x => x.id), r1: { t: r1.sched.map(x => x.title), conf: r1.sched[0].conf, hid: r1.hidden.length, upd: r1.upd },
        r2: { t: r2.sched[0].title, time: r2.sched[0].time, upd: r2.sched[0]._ov.upd, org: r2.sched[0]._ov.org.time }, d: { upd: detailsOnly.sched[0]._ov.upd, time: detailsOnly.sched[0].time, conf: detailsOnly.sched[0].conf },
        alias: { t: alias.sched[0].title, upd: alias.sched[0]._ov.upd },
        m1: { n: m1.list.length, added: m1.added, ids: m1.list.map(x => x.id) },
        m2: { hotel: m2.list.find(x => x.sh && x.sh.id === 'h1').name, flStart: m2.list.find(x => x.sh && x.sh.id === 'f1').start, flConf: m2.list.find(x => x.sh && x.sh.id === 'f1').confNo, pend: m2.pending, n: !!m2.list.find(x => x.sh && x.sh.id === 'f1').sh.n, upd: m2.updated },
        m3: m3.list.map(x => x.name), gone: gone.list.map(x => x.sh.id),
        rule: [['Check in: Grand Hyatt', 1], ['Depart New York JFK on AA 1', 1], ['Ceremony', 0], ['Check out the gardens', 0], ['Check out: Grand Hyatt', 1], ['Welcome drinks at the hotel', 0]].map(([t, w]) => !!E.orgBookingLine({ date: '2027-01-01', title: t }) === !!w) };
    });
    ok(r.a[0] === r.b[0] && r.a[1] === r.b[1] && r.a[0] !== r.a[1] && r.a[2] === 'keep1', `schedule ids: same content → same id on every device, duplicates differ, an id is kept ${JSON.stringify(r.a)}`);
    ok(r.r1.t.join() === 'My tour,Dinner' && r.r1.conf === 'C9' && r.r1.hid === 1 && r.r1.upd === 0, `overlay: edit replaces, hide removes ${JSON.stringify(r.r1)}`);
    ok(r.r2.t === 'My tour' && r.r2.time === '11:00' && r.r2.upd && r.r2.org === '11:00', `organizer changed an edited item: their edit stays (the rest follows), flagged updated ${JSON.stringify(r.r2)}`);
    ok(!r.d.upd && r.d.time === '11:00' && r.d.conf === 'C9', `only their details added: the organizer's change flows through ${JSON.stringify(r.d)}`);
    ok(r.alias.t === 'My tour' && r.alias.upd, `an item that lost its id is found by its title ${JSON.stringify(r.alias)}`);
    ok(r.m1.n === 3 && r.m1.added === 2, `share merge: the sharer's bookings join the recipient's own ${JSON.stringify(r.m1)}`);
    ok(r.m2.hotel === 'Park Hyatt Tokyo' && r.m2.upd === 1 && r.m2.flStart === '2027-04-01T09:00' && r.m2.flConf === 'MY1' && r.m2.pend === 1 && r.m2.n, `unchanged follows the sharer; changed keeps theirs + pending ${JSON.stringify(r.m2)}`);
    ok(r.m3.join() === 'Mine,UA 1', `the sharer removed an untouched item: it goes; an edited one stays ${JSON.stringify(r.m3)}`);
    ok(r.gone.join() === 'f1', `an item the recipient removed stays removed ${JSON.stringify(r.gone)}`);
    ok(r.rule.every(Boolean), `organizer booking lines: check in / flight lines yes, events no ${JSON.stringify(r.rule)}`);
    ok(!page._err.length, 'no page errors (pure)'); await ctx.close();
  }

  // ---------- 2. type rule: a wedding page shows the event schedule only; a Trip keeps the organizer's hotels/flights ----------
  {
    const { ctx, page } = await mk({});
    await openPacked(page, await norm(page, WED));
    await page.evaluate(() => document.querySelectorAll('.day:not(.open) [data-day-tog]').forEach(b => b.click()));
    let rs = (await rows(page)).join(' | ');
    ok(/Ceremony/.test(rs) && /Welcome drinks/.test(rs) && !/Grand Hyatt|JFK|CUN/.test(rs), `wedding: schedule without the organizer's hotel and flights: ${rs}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-wedding-guest.png`, fullPage: true });
    await openPacked(page, await norm(page, TRIP));
    await page.evaluate(() => document.querySelectorAll('.day:not(.open) [data-day-tog]').forEach(b => b.click()));
    rs = (await rows(page)).join(' | ');
    ok(/Grand Hyatt/.test(rs) && /JFK/.test(rs), `trip: the organizer's hotel and flights are part of the plan: ${rs}`);
    ok(!page._err.length, 'no page errors (type rule) ' + page._err.join(' ')); await ctx.close();
  }

  // ---------- 3. the guest's personal copy on the page ----------
  {
    const { ctx, page } = await mk({});
    const c0 = await norm(page, WED);
    await openPacked(page, c0);
    await tapRow(page, 'Ceremony');
    await page.click('dialog.ds-sheet [data-ov-edit]');
    await page.fill('#ov-title', 'Ceremony (we sit row 3)'); await page.fill('#ov-conf', 'SEAT-3');
    await page.click('dialog.ds-sheet [data-ov-save]'); await page.waitForTimeout(400);
    let rs = (await rows(page)).join(' | ');
    ok(/Ceremony \(we sit row 3\)\s*Edited/.test(rs), `edited: their title + Edited tag: ${rs}`);
    const sheet = await page.$eval('dialog.ds-sheet[open]', d => d.textContent).catch(() => '');
    ok(/SEAT-3/.test(sheet), 'their confirmation shows on the sheet');
    // the organizer moves the ceremony (same item, new time) → their version stays + Updated prompt
    const c1 = JSON.parse(JSON.stringify(c0)); c1.schedule.find(x => x.title === 'Ceremony').time = '17:00'; c1.schedule.find(x => x.title === 'Welcome drinks').note = 'Beach bar, sunset';
    await page.goto(BASE); await openPacked(page, c1);
    rs = (await rows(page)).join(' | ');
    ok(/Ceremony \(we sit row 3\)\s*Updated/.test(rs) && /Beach bar, sunset/.test(rs), `organizer changed it: theirs stays, tagged Updated; other changes flow: ${rs}`);
    await tapRow(page, 'Ceremony (we sit');
    const p = await page.$eval('dialog.ds-sheet .ov-p', e => e.textContent).catch(() => '');
    ok(/Updated — use the new one\?/.test(p) && /5:00 PM/.test(p) && /Ceremony/.test(p), `sheet asks "Updated — use the new one?" with the new version: ${p}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-updated-prompt.png` });
    await page.click('dialog.ds-sheet [data-ov-keep]'); await page.waitForTimeout(400);
    rs = (await rows(page)).join(' | ');
    ok(/Ceremony \(we sit row 3\)\s*Edited/.test(rs), `Keep mine: their version, no prompt: ${rs}`);
    const c2 = JSON.parse(JSON.stringify(c1)); c2.schedule.find(x => x.title === 'Ceremony').time = '17:30';
    await page.goto(BASE); await openPacked(page, c2);
    await tapRow(page, 'Ceremony (we sit');
    await page.click('dialog.ds-sheet [data-ov-use]'); await page.waitForTimeout(400);
    rs = (await rows(page)).join(' | ');
    ok(/5:30 PM\s*Ceremony/.test(rs) && !/we sit|Edited|Updated/.test(rs), `Use new: the organizer's version: ${rs}`);
    const conf = await page.evaluate(() => JSON.stringify(Object.values(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('ep:ov:')))).it)));
    ok(/SEAT-3/.test(conf), 'Use new keeps their own confirmation');
    // hide + show hidden
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await tapRow(page, 'Welcome drinks'); await page.click('dialog.ds-sheet [data-ov-hide]'); await page.waitForTimeout(400);
    rs = (await rows(page)).join(' | ');
    const sh = await page.$eval('[data-ov-show]', b => b.textContent).catch(() => '');
    ok(!/Welcome drinks/.test(rs) && sh === 'Show hidden (1)', `Hide: gone, one "Show hidden (1)": ${rs} / ${sh}`);
    await page.click('[data-ov-show]'); await page.waitForTimeout(400);
    ok(/Welcome drinks/.test((await rows(page)).join()), 'Show hidden brings it back');
    ok(!page._err.length, 'no page errors (copy) ' + page._err.join(' ')); await ctx.close();
  }

  // ---------- 4. Share sheet + Share my trip link + recipient ----------
  {
    const state = {};
    const { ctx, page } = await mk(state);
    const cfg = await norm(page, TRIP);
    state.event = { id: 'e0000000-0000-4000-8000-000000000001', slug: 'ana-and-leo-x1', config: cfg, updated_at: new Date().toISOString(), published: true };
    const KEY = await page.evaluate((c) => { const n = (x) => Math.abs([...(x.title || '') + (x.start || '') + (x.venue ? x.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36); return c.ek ? c.ek.slice(6) : n(c); }, cfg);
    const HOTEL = { id: 'bk1', kind: 'hotel', name: 'Rosewood Mayakoba', start: '2027-03-11T15:00', end: '2027-03-14T11:00', confNo: 'RW-77' };
    await page.evaluate(([k, h]) => { localStorage.clear(); localStorage.setItem('mock-user', JSON.stringify({ id: 'u-gia', email: 'gia@example.com', user_metadata: { full_name: 'Gia Rossi' } })); localStorage.setItem('ep:signedIn', 'true'); localStorage.setItem('ep:itin:' + k, JSON.stringify([h])); }, [KEY, HOTEL]);
    await page.goto(BASE + '?e=ana-and-leo-x1'); await page.waitForSelector('.ev [data-act="share"]');
    await page.click('.ev [data-act="share"]'); await page.waitForSelector('#shr-dlg[open]');
    const tabs = await page.$$eval('#shr-dlg [data-shr-tab]', bs => bs.map(b => b.textContent));
    ok(tabs.join('|') === 'Invite guests|Share my trip', `Share: two choices ${tabs}`);
    const pl = await page.$eval('#shr-dlg [data-shr-p="plan"] input', i => i.value);
    ok(/\?e=ana-and-leo-x1$/.test(pl), `Invite guests: the page link ${pl}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-sheet-invite.png` });
    await page.click('#shr-dlg [data-shr-tab="trip"]'); await page.waitForSelector('#shr-dlg [data-shr-url]');
    const url = await page.$eval('#shr-dlg [data-shr-url]', i => i.value); const cnt = await page.textContent('#shr-dlg .shr-count');
    ok(/\?e=ana-and-leo-x1&s=[a-f0-9]{32}$/.test(url) && /1 booking/.test(cnt), `Share my trip: a revocable link with the token ${url} · ${cnt}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-sheet-trip.png` });
    const row = await page.evaluate(() => JSON.parse(localStorage.getItem('mock-trip_shares'))[0]);
    ok(row && row.data.bk[0].name === 'Rosewood Mayakoba' && row.name === 'Gia' && !row.data.bk[0].photos, `the share holds their bookings + first name ${row && row.name}`);
    // live: a change on the sharer's side reaches the row
    await page.evaluate(() => { document.querySelector('#shr-dlg').close(); });
    await page.evaluate((k) => { const raw = JSON.parse(localStorage.getItem('ep:itin:' + k)); raw.push({ id: 'bk2', kind: 'flight', name: 'AA 1234', start: '2027-03-11T09:10' }); localStorage.setItem('ep:itin:' + k, JSON.stringify(raw)); window.__shTouch('itin:' + k); }, KEY);
    await page.waitForTimeout(2200);
    const row2 = await page.evaluate(() => JSON.parse(localStorage.getItem('mock-trip_shares'))[0]);
    ok(row2.data.bk.length === 2, `live: the shared row follows their bookings (${row2.data.bk.length})`);
    state.share = { token: row2.token, event_id: state.event.id, slug: 'ana-and-leo-x1', name: row2.name, data: row2.data, updated_at: new Date().toISOString() };

    // recipient (signed out, fresh device)
    const R = await mk(state);
    await R.page.goto(BASE + '?e=ana-and-leo-x1&s=' + row2.token); await R.page.waitForSelector('.ev');
    await R.page.waitForTimeout(400);
    const sel = await R.page.$eval('[data-tab-go][aria-selected="true"]', b => b.dataset.tabGo).catch(() => '');
    const mt = await R.page.$eval('[data-panel="mytrip"]', p => p.textContent.replace(/\s+/g, ' ')).catch(() => '');
    ok(sel === 'mytrip' && /Rosewood Mayakoba/.test(mt) && /AA 1234/.test(mt) && /Gia’s trip/.test(mt), `recipient: My trip opens pre-filled with Gia's bookings ${sel}`);
    ok(!/[?&]s=/.test(R.page.url()), 'the token leaves the address bar');
    if (SHOTS) await R.page.screenshot({ path: `${SHOTS}/share-recipient-mytrip.png` });
    // the sharer renames the hotel (untouched by the recipient → follows) and moves the flight the recipient edited (→ prompt)
    await R.page.evaluate((k) => { const xs = JSON.parse(localStorage.getItem('ep:itin:' + k)); const f = xs.find(x => x.sh && x.sh.id === 'bk2'); f.confNo = 'MINE-1'; localStorage.setItem('ep:itin:' + k, JSON.stringify(xs)); }, KEY);
    state.share = { ...state.share, data: { ...state.share.data, bk: [{ ...state.share.data.bk[0], name: 'Rosewood Mayakoba Resort' }, { ...state.share.data.bk[1], start: '2027-03-11T10:10' }] } };
    await R.page.reload(); await R.page.waitForSelector('.ev'); await R.page.waitForTimeout(400);
    const mt2 = await R.page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k)), KEY);
    const h2 = mt2.find(x => x.sh && x.sh.id === 'bk1'), f2 = mt2.find(x => x.sh && x.sh.id === 'bk2');
    ok(h2.name === 'Rosewood Mayakoba Resort' && f2.start === '2027-03-11T09:10' && f2.confNo === 'MINE-1' && f2.sh.n && f2.sh.n.start === '2027-03-11T10:10', 'recipient: untouched follows the sharer; their edited flight keeps theirs + pending');
    await R.page.click('[data-tab-go="mytrip"]').catch(() => {});
    await R.page.$eval(`[data-ds="bk:${f2.id}"]`, b => b.click()); await R.page.waitForSelector('dialog.ds-sheet[open] .ov-p');
    const p2 = await R.page.textContent('dialog.ds-sheet .ov-p');
    ok(/Updated — use the new one\?/.test(p2) && /10:10 AM/.test(p2), `booking sheet asks: ${p2}`);
    if (SHOTS) await R.page.screenshot({ path: `${SHOTS}/share-recipient-updated.png` });
    await R.page.click('dialog.ds-sheet [data-sh-use]'); await R.page.waitForTimeout(300);
    const f3 = (await R.page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k)), KEY)).find(x => x.sh && x.sh.id === 'bk2');
    ok(f3.start === '2027-03-11T10:10' && !f3.sh.n, 'Use new: the sharer\'s version');
    ok(!R.page._err.length, 'no page errors (recipient) ' + R.page._err.join(' '));

    // Stop sharing → the link reads nothing → the recipient keeps their copy, unfollowed
    await page.goto(BASE + '?e=ana-and-leo-x1'); await page.waitForSelector('.ev [data-act="share"]');
    await page.click('.ev [data-act="share"]'); await page.click('#shr-dlg [data-shr-tab="trip"]'); await page.waitForSelector('#shr-dlg [data-shr-stop]');
    await page.click('#shr-dlg [data-shr-stop]'); await page.waitForSelector('#shr-dlg [data-shr-new]');
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem('mock-trip_shares')).length);
    ok(left === 0, 'Stop sharing deletes the share');
    state.share = null;
    await R.page.reload(); await R.page.waitForSelector('.ev'); await R.page.waitForTimeout(400);
    const after = await R.page.evaluate((k) => ({ xs: JSON.parse(localStorage.getItem('ep:itin:' + k)), f: localStorage.getItem('ep:shIn:' + k) }), KEY);
    ok(after.xs.length === 2 && after.xs.every(x => !x.sh) && !after.f, 'a turned-off link: the recipient keeps their copy as their own');
    ok(!page._err.length, 'no page errors (sharer) ' + page._err.join(' '));
    await R.ctx.close(); await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
