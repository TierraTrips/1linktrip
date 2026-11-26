// Race organizer end to end against the real Supabase project (11/26: organizer layouts by type + schema-volunteers.sql):
// a throwaway organizer (bbbot0209+typestest-…, made with the admin API, no email is sent) and one published Race page.
// The organizer sees Travel · Runners · Race weekend · Updates (no wedding tabs), imports 3 runners from a RunSignup-style
// CSV, turns on Volunteers in Add features (saved with the page) and adds a shift of 2. A volunteer (signed out) signs up on
// the page's ?volunteer=1 link; the organizer sees 1/2. A runner's personal link shows "Your race" (bib, wave, start time)
// and saves travel without any RSVP. Everything is backed up and deleted at the end.
//   BASE=https://1linktrip.com/ SHOTS=<dir> node tests/types-live.js     (PAT from secrets/supabase-pat, never printed)
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'https://1linktrip.com/';
const SHOTS = process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
const PAT = fs.readFileSync(__dirname + '/../../../../secrets/supabase-pat', 'utf8').trim();
const BACKUP = __dirname + '/../../../eventpages-supabase/backups';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TS = Date.now().toString(36); const addr = (k) => `bbbot0209+typestest-${TS}-${k}@gmail.com`;
const O = { email: addr('owner'), pass: 'T' + Math.random().toString(36).slice(2) + 'x9!' };
const SLUG = `types-e2e-${TS}`; const EK = 'modes:ty' + TS;
const CFG = { v: 2, ek: EK, type: 'Race', title: 'Harbor 10K (test)', start: '2027-05-16T07:00', end: '2027-05-16T10:00', tz: 'America/Chicago', lang: 'en',
  venue: { name: 'Buckingham Fountain', address: 'Chicago, IL', lat: 41.8758, lon: -87.619, city: 'Chicago', country: 'United States', cc: 'us' },
  tools: { weather: false, travel: false, stay: false, nearby: false, tours: false, mytrip: true, packing: false, shopping: false },
  x: { Race: { packet: 'Lower Hutchinson Field', packetHours: 'Fri May 14, 12–7 PM\nSat May 15, 9 AM–5 PM' } }, schedule: [] };
(async () => {
  let srv = null; if (process.env.LOCAL) srv = await require('./_pages-server.js').start(+new URL(BASE).port);
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key;
  const admin = (p, init = {}) => fetch(SBURL + p, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const mkUser = async (u, name) => (await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: u.email, password: u.pass, email_confirm: true, user_metadata: { full_name: name } }) })).json()).id;
  const uid = await mkUser(O, 'Olly Owner');
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
    eid = await o.page.evaluate(async ([cfg, slug]) => { const c = await window.__ep.sb(); const r = await c.from('events').insert({ slug, config: window.__ep.normalize(JSON.parse(JSON.stringify(cfg))), published: true }).select('id').single(); return r.error ? null : r.data.id; }, [CFG, SLUG]);
    ok(!!eid, 'published race page');
    await o.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid); await o.page.waitForSelector('[data-gl-tab]', { timeout: 30000 }); await o.page.waitForTimeout(800);
    const tabs = await o.page.$$eval('[data-gl-tab]', xs => xs.map(x => x.textContent.trim()));
    ok(tabs.join(' · ') === 'Travel · Runners · Race weekend · Updates', 'a new race page starts lean: ' + tabs.join(' · '));
    await o.page.click('[data-gl-tab="list"]'); await o.page.waitForTimeout(300); await o.page.click('.ot-empty [data-gl-add]'); await o.page.waitForSelector('#ro-paste');
    await o.page.fill('#ro-paste', 'First Name,Last Name,Email,Bib Num,Event,Wave,Start Time,City,State,Team Name\nMaya,Patel,bbbot0209+typestest-maya@gmail.com,1042,10K,B,07:25,Madison,WI,Lakeview Runners\nTom,Novak,,2001,Half marathon,1,06:45,Chicago,IL,\nAna,Ruiz,,5001,5K,D,08:00,Toronto,ON,');
    await o.page.waitForTimeout(300); await o.page.click('[data-ro-go]'); await o.page.waitForTimeout(3000);
    const n = await o.page.$$eval('.ro-r:not(.ro-h)', xs => xs.length); ok(n === 3 && !(await o.page.$('.gl-h')), `3 runners imported, still a roster (no household view) (${n})`);
    const vals = await sql(`select f.label, p.name, v.value from public.guest_field_values v join public.guest_fields f on f.id = v.field_id join public.guest_people p on p.id = v.person_id where v.event_id = '${eid}' order by 1, 2`);
    const vs = vals.map(x => `${x.label}/${x.name}=${x.value}`).join(', ');
    ok(/Bib\/Maya Patel=1042/.test(vs) && /Distance\/Maya Patel=10K/.test(vs) && /Wave\/Maya Patel=B/.test(vs) && /Hometown\/Maya Patel=Madison, WI/.test(vs) && /Club\/Maya Patel=Lakeview Runners/.test(vs), 'roster values saved as fields: ' + vs.slice(0, 300));
    await shot(o.page, '1280-live-runners');
    // Add features → Volunteers (saved with the page)
    await o.page.click('[data-mod-open]'); await o.page.waitForSelector('dialog[open] [data-mod="vol"]'); await o.page.$eval('dialog[open] [data-mod="vol"]', x => x.click()); await o.page.waitForTimeout(2000); await o.page.click('dialog[open] [data-gl-x]');
    const org = await sql(`select config -> 'org' as org from public.events where id = '${eid}'`); ok(org[0] && org[0].org && org[0].org.mods && org[0].org.mods.vol === true, 'Volunteers on, saved with the page: ' + JSON.stringify(org[0]));
    await o.page.click('[data-gl-tab="vol"]'); await o.page.click('[data-vl-new]'); await o.page.fill('#vl-task', 'Water station 2'); await o.page.fill('#vl-cap', '2'); await o.page.click('[data-vl-save]'); await o.page.waitForTimeout(1500);
    ok(/Water station 2[\s\S]*0\/2/.test(await o.page.textContent('.vl')), 'a shift of 2');
    // a volunteer, signed out, on the page's sign-up link
    const v = await mk(390); await v.page.goto(BASE + `?e=${SLUG}&volunteer=1`); await v.page.waitForSelector('[data-vl-pick]', { timeout: 30000 }); await shot(v.page, '390-live-volunteer-sheet');
    await v.page.click('[data-vl-pick]'); await v.page.fill('[data-vl-n]', 'Leah Kim'); await v.page.fill('[data-vl-e]', 'bbbot0209+typestest-leah@gmail.com'); await v.page.click('[data-vl-go]'); await v.page.waitForTimeout(2000);
    ok(/You’re signed up/.test(await v.page.textContent('[data-vl-board]')) && /1 of 2 places left/.test(await v.page.textContent('[data-vl-board]')), 'the volunteer signs up; 1 of 2 left');
    await shot(v.page, '390-live-volunteer-done');
    await o.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=vol'); await o.page.waitForSelector('.vl', { timeout: 30000 }); await o.page.waitForTimeout(800);
    ok(/1\/2[\s\S]*Leah Kim/.test(await o.page.textContent('.vl')), 'the organizer sees Leah on the shift (1/2)');
    // a runner's personal link: Your race + travel, no RSVP
    const tok = (await sql(`select token from public.guest_households where event_id = '${eid}' and name = 'Maya Patel'`))[0].token;
    const r = await mk(390); await r.page.goto(BASE + `?e=${SLUG}&g=${tok}`); await r.page.waitForSelector('.hh-info', { timeout: 30000 });
    const card = (await r.page.textContent('#sec-rsvp')).replace(/\s+/g, ' ');
    ok(/Your race/.test(card) && /1042/.test(card) && /10K/.test(card) && /07:25/.test(card) && !/Send replies|Replying for|Madison|Lakeview/.test(card), 'personal link: Your race with bib, distance, start; no replies; organizers-only hometown/club hidden: ' + card.slice(0, 200));
    await r.page.evaluate(() => { const d = document.querySelector('.hh-travel'); if (d) d.open = true; document.querySelector('#sec-rsvp').scrollIntoView(); });
    await r.page.fill('[data-hht="stay"]', 'Hilton Chicago'); await r.page.click('[data-hh="travel"]'); await r.page.waitForTimeout(2000);
    const tr = await sql(`select stay from public.guest_travel where event_id = '${eid}'`); ok(tr[0] && tr[0].stay === 'Hilton Chicago', 'travel saved from the personal link: ' + JSON.stringify(tr));
    await shot(r.page, '390-live-runner-link');
    for (const p of pages) ok(!p._err.length, 'no page errors ' + p._err.join(' | ').slice(0, 300));
  } catch (e) { ok(false, 'crashed: ' + (e && e.stack || e)); }
  finally {
    const z = eid || '00000000-0000-0000-0000-000000000000';
    const dump = { events: await sql(`select * from public.events where owner = '${uid}'`), guest_households: await sql(`select * from public.guest_households where event_id = '${z}'`), volunteer_signups: await sql(`select * from public.volunteer_signups where event_id = '${z}'`), users: [uid] };
    fs.mkdirSync(BACKUP, { recursive: true }); const bf = `${BACKUP}/types-e2e-${TS}.json`; fs.writeFileSync(bf, JSON.stringify(dump, null, 1)); fs.chmodSync(bf, 0o600); console.log('backup ' + bf);
    await sql(`delete from public.events where owner = '${uid}' and slug = '${SLUG}'`); await sql(`delete from public.trip_items where owner = '${uid}'`);
    if (uid) await admin(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' });
    const left = await sql(`select (select count(*) from public.events where slug = '${SLUG}') e, (select count(*) from public.volunteer_slots where event_id = '${z}') s, (select count(*) from public.volunteer_signups where event_id = '${z}') u2, (select count(*) from auth.users where id = '${uid}') u`);
    ok(Array.isArray(left) && Object.values(left[0]).every(v => +v === 0), 'test data deleted ' + JSON.stringify(left));
    await browser.close(); if (srv) srv.close();
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
