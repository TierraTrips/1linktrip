// Per-guest fields end to end (schema-fields.sql) — based on the arrivals e2e. Arrivals board end to end against the real Supabase project (schema-arrivals.sql), on a site (local or live):
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
const SLUG = `fld-e2e-${TS}`; const EK = 'modes:arr' + TS;
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
    const P = Object.fromEntries((await sql(`select name, id from public.guest_people where event_id = '${eid}'`)).map(x => [x.name, x.id]));
    await o.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=fld'); await o.page.waitForSelector('.fd', { timeout: 30000 }); await o.page.waitForTimeout(600);
    const addField = async (label, kind, vis, choices) => { await o.page.click('[data-fd-new]'); await o.page.fill('#gldlg [data-fde="label"]', label); await o.page.click(`#gldlg [data-fde-kind="${kind}"]`); if (choices) await o.page.fill('#gldlg [data-fde="choices"]', choices); await o.page.click(`#gldlg [data-fde-vis="${vis}"]`); await o.page.click('#gldlg [data-fde-ok]'); await o.page.waitForTimeout(1200); };
    await addField('Bib', 'number', 'guest'); await addField('Wave', 'choice', 'guest', 'A\nB\nC'); await addField('VIP note', 'text', 'planners');
    const F = Object.fromEntries((await sql(`select label, id, kind, visible from public.guest_fields where event_id = '${eid}'`)).map(x => [x.label, x]));
    ok(F.Bib && F.Bib.kind === 'number' && F.Wave && F.Wave.kind === 'choice' && F['VIP note'].visible === 'planners', 'three fields saved: ' + JSON.stringify(Object.values(F).map(x => x.label + ':' + x.kind + ':' + x.visible)));
    await o.page.fill(`[data-fd-cell="${F.Bib.id}|${P['Ana Garcia']}"]`, '214'); await o.page.press(`[data-fd-cell="${F.Bib.id}|${P['Ana Garcia']}"]`, 'Tab'); await o.page.waitForTimeout(1000);
    await o.page.fill(`[data-fd-cell="${F.Bib.id}|${P['Luis Garcia']}"]`, 'two'); await o.page.press(`[data-fd-cell="${F.Bib.id}|${P['Luis Garcia']}"]`, 'Tab'); await o.page.waitForTimeout(1000);
    ok(await o.page.$eval(`[data-fd-cell="${F.Bib.id}|${P['Luis Garcia']}"]`, i => i.value === '' && i.classList.contains('bad')), 'the server refuses text in a number field (cell put back)');
    await o.page.fill(`[data-fd-cell="${F['VIP note'].id}|${P['Ana Garcia']}"]`, 'Bride’s aunt'); await o.page.press(`[data-fd-cell="${F['VIP note'].id}|${P['Ana Garcia']}"]`, 'Tab'); await o.page.waitForTimeout(1000);
    for (const n of ['Ana Garcia', 'Luis Garcia']) await o.page.check(`[data-fd-sel="${P[n]}"]`);
    await o.page.waitForTimeout(300); await o.page.selectOption('[data-fd-bf]', F.Wave.id); await o.page.waitForTimeout(300); await o.page.selectOption('[data-fd-bv]', 'B'); await o.page.click('[data-fd-bset]'); await o.page.waitForTimeout(1500);
    const r = await o.page.evaluate(() => window.__ep.fd.fdImport('Name,Bib,Shirt\nLuis Garcia,215,L\nPriya Shah,301,S\nNo One,9,M'));
    ok(r.n === 2 && r.made.join() === 'Shirt' && r.missing.join() === 'No One', 'CSV import (2 matched, Shirt created, unknown reported): ' + JSON.stringify(r));
    const vals = await sql(`select f.label, p.name, v.value from public.guest_field_values v join public.guest_fields f on f.id = v.field_id join public.guest_people p on p.id = v.person_id where v.event_id = '${eid}' order by 1, 2`);
    const vs = vals.map(x => `${x.label}/${x.name}=${x.value}`).join(', ');
    ok(/Bib\/Ana Garcia=214/.test(vs) && /Bib\/Luis Garcia=215/.test(vs) && /Bib\/Priya Shah=301/.test(vs) && /Wave\/Ana Garcia=B/.test(vs) && /Wave\/Luis Garcia=B/.test(vs) && /Shirt\/Priya Shah=S/.test(vs) && /VIP note\/Ana Garcia=Bride’s aunt/.test(vs), 'values in the database: ' + vs);
    await o.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=fld'); await o.page.waitForSelector('.fd-grid', { timeout: 30000 }); await o.page.waitForTimeout(600); await shot(o.page, '1280-fields', true);
    await o.page.click(`[data-fd-edit="${F.Wave.id}"]`); await o.page.waitForTimeout(300); await shot(o.page, '1280-field-editor'); await o.page.click('#gldlg [data-fde-x]');
    const ph = await mk(390); ok(await signIn(ph.page, O), 'organizer on the phone'); await ph.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=fld'); await ph.page.waitForSelector('.fd-grid', { timeout: 30000 }); await ph.page.waitForTimeout(600); await shot(ph.page, '390-fields', true);
    // the Garcias' link: Your details (Bib + Wave per person; never the VIP note)
    const g = await mk(390); await g.page.goto(BASE + `?e=${SLUG}&g=${H['The Garcias'].token}`); await g.page.waitForSelector('.hh-fd', { timeout: 30000 });
    const card = (await g.page.textContent('.hh-fd')).replace(/\s+/g, ' ');
    ok(/Your details/i.test(card) && /Ana Garcia/.test(card) && /214/.test(card) && /Luis Garcia/.test(card) && /215/.test(card) && /Wave/i.test(card) && !/aunt|VIP|Shirt|301/.test(card), 'household link: Your details per person, only guest-visible fields of its own people: ' + card);
    await g.page.evaluate(() => document.querySelector('.hh-fd').scrollIntoView({ block: 'center' })); await shot(g.page, '390-household-fields');
    const p2 = await mk(390); await p2.page.goto(BASE + `?e=${SLUG}&g=${H['Priya Shah'].token}`); await p2.page.waitForSelector('.hh-fd', { timeout: 30000 });
    const c2 = (await p2.page.textContent('.hh-fd')).replace(/\s+/g, ' '); ok(/301/.test(c2) && !/Shirt|214/.test(c2), 'Priya sees her bib 301, not the organizers-only Shirt: ' + c2);
    for (const p of pages) ok(!p._err.length, 'no page errors ' + p._err.join(' | ').slice(0, 300));
  } catch (e) { ok(false, 'crashed: ' + (e && e.stack || e)); }
  finally {
    const z = eid || '00000000-0000-0000-0000-000000000000';
    const dump = { events: await sql(`select * from public.events where owner = '${uid}'`), guest_households: await sql(`select * from public.guest_households where event_id = '${z}'`), guest_people: await sql(`select * from public.guest_people where event_id = '${z}'`),
      guest_fields: await sql(`select * from public.guest_fields where event_id = '${z}'`), guest_field_values: await sql(`select * from public.guest_field_values where event_id = '${z}'`), users: [uid] };
    fs.mkdirSync(BACKUP, { recursive: true }); const bf = `${BACKUP}/fields-e2e-${TS}.json`; fs.writeFileSync(bf, JSON.stringify(dump, null, 1)); fs.chmodSync(bf, 0o600); console.log('backup ' + bf);
    await sql(`delete from public.events where owner = '${uid}' and slug = '${SLUG}'`); await sql(`delete from public.trip_items where owner = '${uid}'`);
    if (uid) await admin(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' });
    const left = await sql(`select (select count(*) from public.events where slug = '${SLUG}') e, (select count(*) from public.guest_fields where event_id = '${z}') f, (select count(*) from auth.users where id = '${uid}') u`);
    ok(Array.isArray(left) && Object.values(left[0]).every(v => +v === 0), 'test data deleted ' + JSON.stringify(left));
    await browser.close(); if (srv) srv.close();
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
