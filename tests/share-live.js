// Personal copy + Share my trip, end to end against the real Supabase project and a live site: throwaway users
// (bbbot0209+sharetest-…@gmail.com, made with the admin API), one throwaway wedding page; everything is backed up and
// deleted at the end. No one else's data is touched.
//   BASE=https://1linktrip.com/ SHOTS=<dir> node tests/share-live.js
//   (needs the Management API token in secrets/supabase-pat, read here and never printed)
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'https://1linktrip.com/';
const SHOTS = process.env.SHOTS || '';
const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
const PAT = fs.readFileSync(process.env.SUPABASE_PAT_FILE || __dirname + '/../../../../secrets/supabase-pat', 'utf8').trim();
const BACKUP = process.env.BACKUP || __dirname + '/../../../eventpages-supabase/backups';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TS = Date.now().toString(36);
const mkUser = (k) => ({ email: `bbbot0209+sharetest-${TS}-${k}@gmail.com`, pass: 'T' + Math.random().toString(36).slice(2) + 'x9!' });
const O = mkUser('org'), G = mkUser('guest'); const SLUG = `share-e2e-${TS}`; const KEY = 'e2e' + TS;
const CFG = { v: 2, ek: 'modes:' + KEY, type: 'Wedding', title: `Share test ${TS}`, start: '2027-03-12', end: '2027-03-14', tz: 'America/Cancun',
  venue: { name: 'Hotel Esencia', address: 'Xpu-Ha, Quintana Roo', lat: 20.47, lon: -87.26, city: 'Xpu-Ha', country: 'Mexico', cc: 'mx' },
  tools: { weather: false, travel: true, stay: true, nearby: false, tours: false, mytrip: true, packing: false, shopping: false },
  schedule: [{ date: '2027-03-12', time: '19:00', title: 'Welcome drinks', note: 'Beach bar' }, { date: '2027-03-13', time: '16:00', title: 'Ceremony', note: 'On the lawn' },
    { date: '2027-03-11', time: '', title: 'Check in: Grand Hyatt Playa', note: 'Our room' }, { date: '2027-03-11', time: '09:10', title: 'Depart New York JFK on AA 1234', note: '' }] };

(async () => {
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key; const ANON = (keys.find(k => k.name === 'anon') || {}).api_key;
  const admin = (path, init = {}) => fetch(SBURL + path, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 600)); } };
  const ids = {};
  for (const [k, u] of [['O', O], ['G', G]]) { const r = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: u.email, password: u.pass, email_confirm: true, user_metadata: { full_name: k === 'G' ? 'Gia Test' : 'Olly Test' } }) })).json(); ids[k] = r.id; }
  ok(/^[0-9a-f-]{36}$/.test(ids.O || '') && /^[0-9a-f-]{36}$/.test(ids.G || ''), 'throwaway users created');
  const inList = `('${ids.O}','${ids.G}')`;
  const browser = await chromium.launch();
  const mk = async () => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon/, r => r.abort());
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
    await page.goto(BASE + '?x=' + TS); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear()); return { ctx, page }; };
  const signIn = (page, u) => page.evaluate(async ([e, p]) => { const c = await window.__ep.sb(); const r = await c.auth.signInWithPassword({ email: e, password: p }); localStorage.setItem('ep:signedIn', 'true'); return !!(r.data && r.data.session); }, [u.email, u.pass]);
  const rows = (page) => page.$$eval('[data-panel="event"] .tl li', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
  const openDays = (page) => page.evaluate(() => document.querySelectorAll('.day:not(.open) [data-day-tog]').forEach(b => b.click()));
  const tapRow = async (page, txt) => { await openDays(page); await page.locator('[data-panel="event"] .tl-go', { hasText: txt }).first().click(); await page.waitForSelector('dialog.ds-sheet[open]'); await page.waitForTimeout(200); };
  let tok = '';
  try {
    // organizer publishes a wedding page whose plan has their own hotel + flight lines
    const o = await mk(); ok(await signIn(o.page, O), 'organizer signed in');
    const ins = await o.page.evaluate(async ([cfg, slug]) => { const c = await window.__ep.sb(); const conf = window.__ep.normalize(JSON.parse(JSON.stringify(cfg))); const r = await c.from('events').insert({ slug, config: conf, published: true }).select('id,config').single(); return r.data || r.error; }, [CFG, SLUG]);
    ok(ins && ins.id && ins.config.schedule.every(x => /^sc/.test(x.id)), 'throwaway wedding page published (items carry ids)');

    // a guest: their booking on this device, signed in
    const g = await mk(); ok(await signIn(g.page, G), 'guest signed in');
    await g.page.evaluate((k) => localStorage.setItem('ep:itin:' + k, JSON.stringify([{ id: 'bkLive1', kind: 'hotel', name: 'Rosewood Mayakoba', start: '2027-03-11T15:00', end: '2027-03-14T11:00', confNo: 'RW-77' }])), KEY);
    await g.page.goto(BASE + '?e=' + SLUG); await g.page.waitForSelector('.ev [data-act="share"]'); await openDays(g.page);
    const rs = await rows(g.page);
    ok(/Ceremony/.test(rs) && !/Grand Hyatt|JFK/.test(rs), `wedding page: no organizer hotel/flight: ${rs}`);
    if (SHOTS) await g.page.screenshot({ path: `${SHOTS}/live-wedding-guest.png`, fullPage: true });
    // the guest's personal copy, synced to their account
    await tapRow(g.page, 'Ceremony'); await g.page.click('dialog.ds-sheet [data-ov-edit]'); await g.page.fill('#ov-title', 'Ceremony, row 3'); await g.page.click('dialog.ds-sheet [data-ov-save]');
    const ovRow = await until(async () => { const x = await sql(`select item from public.trip_items where owner = '${ids.G}' and id = 'ov-${KEY}'`); return Array.isArray(x) && x[0] && JSON.stringify(x[0].item).includes('row 3') ? x[0] : null; });
    ok(!!ovRow, 'personal copy saved to the guest\'s account (trip_items ov row)');
    // Share sheet: both choices; Share my trip makes the link
    await g.page.keyboard.press('Escape'); await g.page.waitForTimeout(300);
    await g.page.evaluate(() => { const d = document.querySelector('dialog.ds-sheet[open]'); if (d) d.close(); });
    await g.page.click('.ev [data-act="share"]'); await g.page.waitForSelector('#shr-dlg[open]');
    if (SHOTS) await g.page.screenshot({ path: `${SHOTS}/live-share-sheet-invite.png` });
    await g.page.click('#shr-dlg [data-shr-tab="trip"]'); await g.page.waitForSelector('#shr-dlg [data-shr-url]', { timeout: 20000 });
    const url = await g.page.$eval('#shr-dlg [data-shr-url]', i => i.value); tok = (url.match(/&s=([a-f0-9]{32})$/) || [])[1] || '';
    ok(!!tok && url.startsWith(BASE.replace(/\/$/, '')), `Share my trip link ${url.replace(/[a-f0-9]{32}$/, '<token>')}`);
    if (SHOTS) await g.page.screenshot({ path: `${SHOTS}/live-share-sheet-trip.png` });
    const sh = await sql(`select name, data from public.trip_shares where owner = '${ids.G}'`);
    ok(Array.isArray(sh) && sh[0] && sh[0].name === 'Gia' && sh[0].data.bk[0].name === 'Rosewood Mayakoba', 'trip_shares row: the guest\'s bookings, first name');
    // the organizer cannot see it; anon gets only the token read
    const oSee = await o.page.evaluate(async () => { const c = await window.__ep.sb(); const r = await c.from('trip_shares').select('token'); return (r.data || []).length; });
    ok(oSee === 0, 'the organizer cannot list the guest\'s share');
    const anonTable = await fetch(`${SBURL}/rest/v1/trip_shares?select=*`, { headers: { apikey: ANON } }); ok(anonTable.status >= 400, `anon cannot read trip_shares (${anonTable.status})`);
    const anonGet = await (await fetch(`${SBURL}/rest/v1/rpc/trip_share_get`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ tok }) })).json();
    ok(Array.isArray(anonGet) && anonGet.length === 1 && anonGet[0].slug === SLUG, 'anon with the token: the shared trip');

    // recipient: signed out, fresh device → My trip pre-filled
    const r = await mk();
    await r.page.goto(url); await r.page.waitForSelector('[data-panel="mytrip"]'); await r.page.waitForTimeout(800);
    const sel = await r.page.$eval('[data-tab-go][aria-selected="true"]', b => b.dataset.tabGo).catch(() => '');
    const mt = await r.page.$eval('[data-panel="mytrip"]', p => p.textContent.replace(/\s+/g, ' '));
    ok(sel === 'mytrip' && /Rosewood Mayakoba/.test(mt) && /Gia’s trip/.test(mt), 'recipient: My trip opens pre-filled with Gia\'s bookings');
    if (SHOTS) await r.page.screenshot({ path: `${SHOTS}/live-recipient-mytrip.png` });
    // live: the guest renames their hotel → the recipient's (untouched) copy follows on the next open
    await g.page.evaluate((k) => { const xs = JSON.parse(localStorage.getItem('ep:itin:' + k)); xs[0].name = 'Rosewood Mayakoba Resort'; localStorage.setItem('ep:itin:' + k, JSON.stringify(xs)); window.__shTouch('itin:' + k); }, KEY);
    ok(!!(await until(async () => { const x = await sql(`select data from public.trip_shares where owner = '${ids.G}'`); return Array.isArray(x) && x[0] && x[0].data.bk[0].name === 'Rosewood Mayakoba Resort'; })), 'the share follows the guest\'s change');
    await r.page.reload(); await r.page.waitForSelector('.ev'); await r.page.waitForTimeout(1200);
    const rb = await r.page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k)).map(x => x.name).join(), KEY);
    ok(rb === 'Rosewood Mayakoba Resort', `recipient's copy updated: ${rb}`);

    // the organizer moves the ceremony → the guest's edited item says Updated — use the new one?
    const upd = await o.page.evaluate(async ([id]) => { const c = await window.__ep.sb(); const { data } = await c.from('events').select('config').eq('id', id).single(); const cf = data.config; cf.schedule.find(x => x.title === 'Ceremony').time = '17:00'; const r = await c.from('events').update({ config: cf }).eq('id', id).select('id'); return !!(r.data && r.data.length); }, [ins.id]);
    ok(upd, 'organizer moved the ceremony');
    await g.page.goto(BASE + '?e=' + SLUG + '&r=1'); await g.page.waitForSelector('.ev'); await g.page.waitForTimeout(800);
    const rs2 = await (async () => { await openDays(g.page); return rows(g.page); })();
    ok(/Ceremony, row 3\s*Updated/.test(rs2), `guest: their version + Updated: ${rs2}`);
    await tapRow(g.page, 'Ceremony, row 3');
    const p = await g.page.$eval('dialog.ds-sheet .ov-p', e => e.textContent).catch(() => '');
    ok(/Updated — use the new one\?/.test(p) && /5:00 PM/.test(p), `prompt: ${p}`);
    if (SHOTS) await g.page.screenshot({ path: `${SHOTS}/live-updated-prompt.png` });

    // Stop sharing → the token reads nothing
    await g.page.evaluate(() => { const d = document.querySelector('dialog.ds-sheet[open]'); if (d) d.close(); });
    await g.page.click('.ev [data-act="share"]'); await g.page.click('#shr-dlg [data-shr-tab="trip"]'); await g.page.waitForSelector('#shr-dlg [data-shr-stop]', { timeout: 20000 });
    await g.page.click('#shr-dlg [data-shr-stop]'); await g.page.waitForSelector('#shr-dlg [data-shr-new]');
    const after = await (await fetch(`${SBURL}/rest/v1/rpc/trip_share_get`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ tok }) })).json();
    ok(Array.isArray(after) && after.length === 0, 'Stop sharing: the link reads nothing');
    for (const [n, x] of [['organizer', o], ['guest', g], ['recipient', r]]) ok(!x.page._err.length, `no page errors (${n}) ${x.page._err.join(' | ')}`);
  } catch (e) { ok(false, 'crashed: ' + (e && e.message || e)); }
  finally {
    // back up, then delete everything the test made
    const dump = { events: await sql(`select * from public.events where owner in ${inList}`), trip_items: await sql(`select * from public.trip_items where owner in ${inList}`), trip_shares: await sql(`select owner, event_id, page_key, name, data, created_at from public.trip_shares where owner in ${inList}`), users: ids };
    fs.mkdirSync(BACKUP, { recursive: true }); const bf = `${BACKUP}/share-e2e-${TS}.json`; fs.writeFileSync(bf, JSON.stringify(dump, null, 1)); fs.chmodSync(bf, 0o600); console.log('backup ' + bf);
    await sql(`delete from public.events where owner in ${inList} and slug = '${SLUG}'`);
    for (const id of Object.values(ids)) if (id) await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    const left = await sql(`select (select count(*) from public.events where slug = '${SLUG}') e, (select count(*) from public.trip_items where owner in ${inList}) i, (select count(*) from public.trip_shares where owner in ${inList}) s, (select count(*) from auth.users where id in ${inList}) u`);
    ok(Array.isArray(left) && +left[0].e === 0 && +left[0].i === 0 && +left[0].s === 0 && +left[0].u === 0, 'test data deleted ' + JSON.stringify(left));
    await browser.close();
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
