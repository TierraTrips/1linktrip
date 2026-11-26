// Shuttle runs end to end (schema-shuttles.sql) — based on the arrivals e2e. Arrivals board end to end against the real Supabase project (schema-arrivals.sql), on a site (local or live):
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
const SLUG = `shut-e2e-${TS}`; const EK = 'modes:arr' + TS;
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
  const uid = await mkUser(O, 'Olly Owner'); const gid = null;
  ok(/^[0-9a-f-]{36}$/.test(uid || ''), 'throwaway organizer');
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
    await sql(`insert into public.guest_travel (household_id, event_id, arr_date, arr_time, arr_place, arr_no) values ('${H['The Garcias'].id}', '${eid}', '2027-06-11', '14:40', 'LIS', 'TP 1350'), ('${H['The Kims'].id}', '${eid}', '2027-06-11', '15:05', 'LIS', 'UA 990'), ('${H['Priya Shah'].id}', '${eid}', '2027-06-12', '09:00', 'OPO', 'FR 8')`);
    await o.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=shut'); await o.page.waitForSelector('.sh', { timeout: 30000 }); await o.page.waitForTimeout(800);
    const sug = await o.page.$$eval('.sh-sl li', xs => xs.map(x => x.innerText.replace(/\s+/g, ' ')));
    ok(sug.length === 2 && /LIS/.test(sug[0]) && /4 guests/.test(sug[0]) && /Run at 3:45 PM/.test(sug[0]) && /OPO/.test(sug[1]), 'suggestions: LIS (Garcias + Kims within 60 min, leaves 3:45 PM) and OPO (Priya): ' + sug.join(' || '));
    await o.page.click('[data-sh-make="0"]'); await o.page.waitForSelector('.sh-run', { timeout: 15000 }); await o.page.waitForTimeout(1000);
    const runs = await sql(`select id, from_place, to_place, depart_date, depart_time, capacity from public.shuttle_runs where event_id = '${eid}'`);
    const riders = await sql(`select count(*)::int n from public.shuttle_riders where event_id = '${eid}'`);
    ok(runs.length === 1 && runs[0].from_place === 'LIS' && runs[0].to_place === 'Quinta da Regaleira' && runs[0].depart_time === '15:45' && riders[0].n === 4, 'run saved LIS → Quinta 15:45 with 4 riders: ' + JSON.stringify(runs));
    await o.page.click(`[data-sh-edit="${runs[0].id}"]`); await o.page.fill('#gldlg [data-she="meet"]', 'Arrivals hall, exit 3'); await o.page.fill('#gldlg [data-she="capacity"]', '3'); await o.page.fill('#gldlg [data-she="vehicle"]', 'Mercedes Vito');
    await o.page.click('#gldlg [data-she-ok]'); await o.page.waitForTimeout(1200);
    ok((await sql(`select meet, capacity from public.shuttle_runs where id = '${runs[0].id}'`))[0].meet === 'Arrivals hall, exit 3', 'meeting point saved');
    ok(/1 over capacity/.test(await o.page.textContent('.sh-run')), 'seat warning: 4 riders on 3 seats');
    await o.page.selectOption('.sh-wait li:has-text("Priya Shah") select', runs[0].id); await o.page.waitForTimeout(1500);
    ok((await sql(`select count(*)::int n from public.shuttle_riders where run_id = '${runs[0].id}'`))[0].n === 5, 'Add to… puts Priya on the run');
    await o.page.click(`.sh-run [data-sh-rm$="|${(await sql(`select id from public.guest_people where household_id = '${H['Priya Shah'].id}'`))[0].id}"]`); await o.page.waitForTimeout(1200);
    ok((await sql(`select count(*)::int n from public.shuttle_riders where run_id = '${runs[0].id}'`))[0].n === 4, 'and × takes her off again');
    await shot(o.page, '1280-shuttles', true);
    await o.page.evaluate((rid) => { window.print = () => {}; window.__ep.sh.shPrint(rid); }, runs[0].id); await o.page.emulateMedia({ media: 'print' }); await o.page.waitForTimeout(300); await shot(o.page, '1280-manifest-print', true); await o.page.emulateMedia({ media: 'screen' });
    const ph = await mk(390); ok(await signIn(ph.page, O), 'organizer on the phone');
    await ph.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=shut'); await ph.page.waitForSelector('.sh', { timeout: 30000 }); await ph.page.waitForTimeout(800); await shot(ph.page, '390-shuttles', true);
    // the Garcias' link: Your shuttle
    const g = await mk(390); await g.page.goto(BASE + `?e=${SLUG}&g=${H['The Garcias'].token}`); await g.page.waitForSelector('.hh-shut', { timeout: 30000 });
    const card = await g.page.textContent('.hh-shut');
    ok(/Your shuttle/i.test(card) && /3:45 PM/.test(card) && /from LIS to Quinta da Regaleira/.test(card) && /Meet: Arrivals hall, exit 3/.test(card) && /Mercedes Vito/.test(card) && !/Kim|seats/.test(card), 'household link: Your shuttle (time, route, meeting point, vehicle; no other riders, no seats): ' + card.replace(/\s+/g, ' '));
    await g.page.evaluate(() => document.querySelector('.hh-shut').scrollIntoView({ block: 'center' })); await shot(g.page, '390-household-shuttle');
    const p2 = await mk(390); await p2.page.goto(BASE + `?e=${SLUG}&g=${H['Priya Shah'].token}`); await p2.page.waitForSelector('.hh-rsvp', { timeout: 30000 }); await p2.page.waitForTimeout(500);
    ok(!(await p2.page.$('.hh-shut')), 'Priya (on no run) sees no shuttle card');
    for (const p of pages) ok(!p._err.length, 'no page errors ' + p._err.join(' | ').slice(0, 300));
  } catch (e) { ok(false, 'crashed: ' + (e && e.stack || e)); }
  finally {
    const z = eid || '00000000-0000-0000-0000-000000000000';
    const dump = { events: await sql(`select * from public.events where owner = '${uid}'`), guest_households: await sql(`select * from public.guest_households where event_id = '${z}'`), guest_people: await sql(`select * from public.guest_people where event_id = '${z}'`),
      guest_travel: await sql(`select * from public.guest_travel where event_id = '${z}'`), shuttle_runs: await sql(`select * from public.shuttle_runs where event_id = '${z}'`), shuttle_riders: await sql(`select * from public.shuttle_riders where event_id = '${z}'`), users: [uid] };
    fs.mkdirSync(BACKUP, { recursive: true }); const bf = `${BACKUP}/shuttles-e2e-${TS}.json`; fs.writeFileSync(bf, JSON.stringify(dump, null, 1)); fs.chmodSync(bf, 0o600); console.log('backup ' + bf);
    await sql(`delete from public.events where owner = '${uid}' and slug = '${SLUG}'`); await sql(`delete from public.trip_items where owner = '${uid}'`);
    if (uid) await admin(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' });
    const left = await sql(`select (select count(*) from public.events where slug = '${SLUG}') e, (select count(*) from public.shuttle_runs where event_id = '${z}') r, (select count(*) from auth.users where id = '${uid}') u`);
    ok(Array.isArray(left) && Object.values(left[0]).every(v => +v === 0), 'test data deleted ' + JSON.stringify(left));
    await browser.close(); if (srv) srv.close();
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
