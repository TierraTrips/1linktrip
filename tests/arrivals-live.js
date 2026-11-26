// Arrivals board end to end against the real Supabase project (schema-arrivals.sql), on a site (local or live):
// a throwaway organizer and a throwaway signed-in guest (bbbot0209+arrivaltest-…, made with the admin API, no email is
// sent), one published wedding page with three households. The Garcias add their travel on their household RSVP; Jae Kim
// (signed in, on the Kims' link) switches on "Share my arrival with the organizers" in My trip, so his own bookings fill
// the Kims' row; switching it off hides them again. The organizer's board (timeline / list / CSV) is checked and
// screenshotted at 390 + 1280. Everything is backed up and deleted at the end.
//   LOCAL=1 BASE=http://127.0.0.1:18794/ SHOTS=<dir> node tests/arrivals-live.js
//   BASE=https://1linktrip.com/ SHOTS=<dir> node tests/arrivals-live.js     (PAT from secrets/supabase-pat, never printed)
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'https://1linktrip.com/';
const SHOTS = process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
const PAT = fs.readFileSync(__dirname + '/../../../../secrets/supabase-pat', 'utf8').trim();
const BACKUP = __dirname + '/../../../eventpages-supabase/backups';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TS = Date.now().toString(36); const addr = (k) => `bbbot0209+arrivaltest-${TS}-${k}@gmail.com`;
const O = { email: addr('owner'), pass: 'T' + Math.random().toString(36).slice(2) + 'x9!' }; const GU = { email: addr('guest'), pass: 'T' + Math.random().toString(36).slice(2) + 'y8!' };
const SLUG = `arr-e2e-${TS}`; const EK = 'modes:arr' + TS;
const CFG = { v: 2, ek: EK, type: 'Wedding', title: 'Lena & Sam', start: '2027-06-12T16:00', end: '2027-06-13T23:00', tz: 'Europe/Lisbon', lang: 'en',
  venue: { name: 'Quinta da Regaleira', address: 'Sintra, Portugal', lat: 38.796, lon: -9.396, city: 'Sintra', country: 'Portugal', cc: 'pt' },
  tools: { weather: false, travel: false, stay: false, nearby: false, tours: false, mytrip: true, packing: false, shopping: false }, rsvp: { via: 'form' },
  schedule: [{ date: '2027-06-12', time: '16:00', title: 'Ceremony', note: '' }] };
const HH = [['The Garcias', ['Ana Garcia', 'Luis Garcia']], ['The Kims', ['Jae Kim', 'Min Kim']], ['Priya Shah', ['Priya Shah']]];
(async () => {
  let srv = null; if (process.env.LOCAL) srv = await require('./_pages-server.js').start(+new URL(BASE).port);
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key;
  const admin = (p, init = {}) => fetch(SBURL + p, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const mkUser = async (u, name) => (await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: u.email, password: u.pass, email_confirm: true, user_metadata: { full_name: name } }) })).json()).id;
  const uid = await mkUser(O, 'Olly Owner'); const gid = await mkUser(GU, 'Jae Kim');
  ok(/^[0-9a-f-]{36}$/.test(uid || '') && /^[0-9a-f-]{36}$/.test(gid || ''), 'throwaway organizer + guest');
  const browser = await chromium.launch(); const pages = [];
  const mk = async (w = 1280) => { const touch = w < 600; const ctx = await browser.newContext({ viewport: { width: w, height: touch ? 844 : 900 }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, serviceWorkers: 'block', locale: 'en-US' });
    await ctx.route(/open-meteo|overpass|nominatim|maps\.googleapis|tile\.openstreetmap|timeapi|photon|basemaps/, r => r.abort());
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => { page._err.push(String(e)); console.log('     [pageerror] ' + String(e).slice(0, 300)); });
    await page.goto(BASE + '?x=' + TS); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear()); pages.push(page); return { ctx, page }; };
  const signIn = (page, u) => page.evaluate(async ([e, p]) => { const c = await window.__ep.sb(); const r = await c.auth.signInWithPassword({ email: e, password: p }); localStorage.setItem('ep:signedIn', 'true'); return !!(r.data && r.data.session); }, [u.email, u.pass]);
  const shot = async (page, name, full) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: !!full }); };
  let eid = '';
  try {
    const o = await mk(1280); ok(await signIn(o.page, O), 'organizer signed in');
    eid = await o.page.evaluate(async ([cfg, slug, HH]) => { const c = await window.__ep.sb(); const r = await c.from('events').insert({ slug, config: window.__ep.normalize(JSON.parse(JSON.stringify(cfg))), published: true }).select('id').single(); if (r.error) return null;
      let k = 0; for (const [name, ps] of HH) { const hid = crypto.randomUUID(); await c.from('guest_households').insert({ id: hid, event_id: r.data.id, name, sort: ++k }); await c.from('guest_people').insert(ps.map((n, i) => ({ id: crypto.randomUUID(), household_id: hid, name: n, sort: i }))); }
      return r.data.id; }, [CFG, SLUG, HH]);
    ok(!!eid, 'published page with 3 households');
    const H = Object.fromEntries((await sql(`select name, id, token from public.guest_households where event_id = '${eid}'`)).map(x => [x.name, x]));

    // ===== the Garcias add travel on their household RSVP (phone)
    const g = await mk(390);
    await g.page.goto(BASE + `?e=${SLUG}&g=${H['The Garcias'].token}`); await g.page.waitForSelector('.hh-rsvp', { timeout: 30000 });
    ok(await g.page.$('.hh-travel') !== null && !(await g.page.$eval('.hh-travel', d => d.open)), 'household RSVP has a folded "Arriving and departing (optional)"');
    await g.page.click(`.hh-p[data-hh-p] >> nth=0 >> [data-hh-att="1"]`); await g.page.click(`.hh-p[data-hh-p] >> nth=1 >> [data-hh-att="1"]`);
    await g.page.click('.hh-travel > summary');
    await g.page.fill('[data-hht="arr_date"]', '2027-06-11'); await g.page.fill('[data-hht="arr_time"]', '11:45'); await g.page.fill('[data-hht="arr_place"]', 'LIS'); await g.page.fill('[data-hht="arr_no"]', 'TP 1350');
    await g.page.fill('[data-hht="dep_date"]', '2027-06-14'); await g.page.fill('[data-hht="dep_time"]', '18:20'); await g.page.fill('[data-hht="dep_place"]', 'LIS'); await g.page.fill('[data-hht="dep_no"]', 'TP 1351'); await g.page.fill('[data-hht="stay"]', 'Tivoli Palácio de Seteais');
    await shot(g.page, '390-household-travel-form', true);
    await g.page.click('[data-hh="send"]'); await g.page.waitForSelector('.hh-done', { timeout: 20000 });
    const row = (await sql(`select arr_date, arr_time, arr_place, arr_no, dep_no, stay, updated_by from public.guest_travel where household_id = '${H['The Garcias'].id}'`))[0] || {};
    ok(row.arr_date === '2027-06-11' && row.arr_time === '11:45' && row.arr_place === 'LIS' && row.arr_no === 'TP 1350' && row.dep_no === 'TP 1351' && row.updated_by === 'guest', 'travel saved with the replies: ' + JSON.stringify(row));
    ok(/TP 1350/.test(await g.page.textContent('.hh-done .hh-trs')), 'thank-you card shows their travel');
    await shot(g.page, '390-household-travel-done', true);

    // ===== Jae Kim (signed in) on the Kims' link: Share my arrival
    const k = await mk(390); ok(await signIn(k.page, GU), 'guest signed in');
    await k.page.goto(BASE + `?e=${SLUG}&g=${H['The Kims'].token}&r=1`); await k.page.waitForSelector('.hh-rsvp', { timeout: 30000 });
    await k.page.click('[data-tab-go="mytrip"]'); await k.page.waitForSelector('[data-arr-share]', { timeout: 20000 });
    ok(!(await k.page.$eval('[data-arr-share]', i => i.checked)), 'Share my arrival is off by default');
    await shot(k.page, '390-mytrip-share-off');
    // his bookings for this page (as the app would sync them), before he opts in
    const pk = EK.slice(6);
    const seed = () => sql(`insert into public.trip_items (id, owner, page_key, kind, item) values
      ('e2e-f1', '${gid}', '${pk}', 'booking', '{"kind":"flight","name":"United UA 990","flight":"UA 990","start":"2027-06-10T17:00","end":"2027-06-11T07:05","from":"EWR","to":"LIS","note":"conf QWERTY"}'),
      ('e2e-h1', '${gid}', '${pk}', 'booking', '{"kind":"hotel","name":"Penha Longa Resort","start":"2027-06-11","end":"2027-06-14","conf":"ZZZ"}'),
      ('e2e-f2', '${gid}', '${pk}', 'booking', '{"kind":"flight","name":"United UA 991","flight":"UA 991","start":"2027-06-14T10:30","end":"2027-06-14T13:20","from":"LIS","to":"EWR"}') on conflict (owner, id) do nothing returning id`);
        const ins = await seed();
    ok(Array.isArray(ins) && ins.length === 3, 'his own bookings exist in trip_items');
    // organizer before the opt-in: nothing of his
    await o.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=arr'); await o.page.waitForSelector('.ar', { timeout: 30000 }); await o.page.waitForTimeout(800);
    ok(!/UA 990|Penha/.test(await o.page.textContent('.ar')), 'before he opts in, the organizer sees none of his bookings');
    await k.page.click('.arr-share .tool'); await k.page.waitForTimeout(2500);
    const sh = await sql(`select household_id from public.arrival_shares where event_id = '${eid}' and user_id = '${gid}'`);
    ok(sh.length === 1 && sh[0].household_id === H['The Kims'].id, 'opt-in saved, tied to the Kims');
    ok(await k.page.$eval('[data-arr-share]', i => i.checked), 'toggle shows on');
    await shot(k.page, '390-mytrip-share-on');
    // the app's own sync must not have dropped his bookings (it pushes his device list); put them back if it did
    const left = await sql(`select count(*)::int n from public.trip_items where owner = '${gid}' and page_key = '${pk}' and kind = 'booking'`);
    if (!left[0] || left[0].n < 3) { console.log('     (his device list replaced the seeded rows on sync, as it should; seeding them again as his app would)'); await seed(); }
    const stranger = await k.page.evaluate(async (eid) => { const c = await window.__ep.sb(); const r = await c.rpc('arrivals_trips', { eid }); return (r.data || []).length; }, eid);
    ok(stranger === 0, 'the guest cannot read the board’s shared bookings');
    // ===== the organizer's board
    await o.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=arr'); await o.page.waitForSelector('.ar', { timeout: 30000 }); await o.page.waitForTimeout(800);
    const txt = await o.page.textContent('.ar');
    ok(/LIS/.test(await o.page.$eval('.ar-port .ar-code > b', b => b.getAttribute('aria-label') || '')), 'timeline groups by airport (LIS)');
    const tags = await o.page.$$eval('.ar-tag', xs => xs.map(x => x.innerText.replace(/\s+/g, ' ')));
    ok(tags.length === 2 && /7:05 AM The Kims/.test(tags[0]) && /UA 990/.test(tags[0]) && /11:45 AM The Garcias/.test(tags[1]) && /TP 1350/.test(tags[1]), 'Kims (shared trip, 7:05 AM) and Garcias (RSVP, 11:45 AM) on Jun 11: ' + tags.join(' || '));
    ok(/shared trip/i.test(tags[0]) && !/QWERTY|ZZZ/.test(txt), 'shared row marked, no confirmation codes');
    ok(await o.page.$eval('.ar-tag a.ar-no', a => a.href) === 'https://www.flightaware.com/live/flight/UA990', 'flight status link');
    ok(/No arrival yet/.test(txt) && /Priya Shah/.test(await o.page.textContent('.ar-und')), 'Priya under No arrival yet');
    await shot(o.page, '1280-arrivals-timeline', true);
    await o.page.click('[data-ar-view="list"]'); await shot(o.page, '1280-arrivals-list', true);
    const lt = await o.page.$$eval('.ar-tr:not(.ar-th)', xs => xs.map(x => x.innerText.replace(/\s+/g, ' ')));
    ok(lt.length === 3 && lt.some(l => /The Kims/.test(l) && /UA 991/.test(l) && /Penha Longa/.test(l)), 'list: Kims depart UA 991, stay Penha Longa (from their bookings)');
    const ph = await mk(390); ok(await signIn(ph.page, O), 'organizer on the phone');
    await ph.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=arr'); await ph.page.waitForSelector('.ar', { timeout: 30000 }); await ph.page.waitForTimeout(800);
    await shot(ph.page, '390-arrivals-timeline', true);
    // planner edits Priya's travel
    await o.page.click('[data-ar-view="time"]'); await o.page.click(`[data-ar-edit="${H['Priya Shah'].id}"]`);
    await o.page.fill('#gldlg [data-are="arr_date"]', '2027-06-12'); await o.page.fill('#gldlg [data-are="arr_place"]', 'OPO'); await o.page.click('#gldlg [data-are-ok]'); await o.page.waitForTimeout(1200);
    const pr = await sql(`select arr_place, updated_by from public.guest_travel where household_id = '${H['Priya Shah'].id}'`);
    ok(pr[0] && pr[0].arr_place === 'OPO' && pr[0].updated_by === 'planner', 'organizer adds travel for Priya (OPO)');
    // he switches it off → gone from the board
    await k.page.click('.arr-share .tool'); await k.page.waitForTimeout(2000);
    ok((await sql(`select count(*)::int n from public.arrival_shares where event_id = '${eid}'`))[0].n === 0, 'opt-out removes the share');
    await o.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=arr'); await o.page.waitForSelector('.ar', { timeout: 30000 }); await o.page.waitForTimeout(800);
    ok(!/UA 990|Penha/.test(await o.page.textContent('.ar')), 'after switching off, his bookings are gone from the board');
    for (const p of pages) ok(!p._err.length, 'no page errors ' + p._err.join(' | ').slice(0, 300));
  } catch (e) { ok(false, 'crashed: ' + (e && e.stack || e)); }
  finally {
    const z = eid || '00000000-0000-0000-0000-000000000000';
    const dump = { events: await sql(`select * from public.events where owner = '${uid}'`), guest_households: await sql(`select * from public.guest_households where event_id = '${z}'`), guest_people: await sql(`select * from public.guest_people where event_id = '${z}'`),
      guest_travel: await sql(`select * from public.guest_travel where event_id = '${z}'`), arrival_shares: await sql(`select * from public.arrival_shares where event_id = '${z}'`), rsvps: await sql(`select * from public.rsvps where event_id = '${z}'`),
      trip_items: await sql(`select * from public.trip_items where owner in ('${uid}', '${gid}')`), users: [uid, gid] };
    fs.mkdirSync(BACKUP, { recursive: true }); const bf = `${BACKUP}/arrivals-e2e-${TS}.json`; fs.writeFileSync(bf, JSON.stringify(dump, null, 1)); fs.chmodSync(bf, 0o600); console.log('backup ' + bf);
    await sql(`delete from public.events where owner = '${uid}' and slug = '${SLUG}'`);
    await sql(`delete from public.trip_items where owner in ('${uid}', '${gid}')`);
    for (const u of [uid, gid]) if (u) await admin(`/auth/v1/admin/users/${u}`, { method: 'DELETE' });
    const left = await sql(`select (select count(*) from public.events where slug = '${SLUG}') e, (select count(*) from public.guest_travel where event_id = '${z}') t, (select count(*) from public.arrival_shares where event_id = '${z}') s, (select count(*) from auth.users where id in ('${uid}', '${gid}')) u`);
    ok(Array.isArray(left) && Object.values(left[0]).every(v => +v === 0), 'test data deleted ' + JSON.stringify(left));
    await browser.close(); if (srv) srv.close();
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
