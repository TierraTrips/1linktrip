// Invite link vs Share my trip hotels (Dylan 11/25), end to end on the live site with throwaway data: one throwaway organizer
// (bbbot0209+sugtest-…@gmail.com, admin API), one Trip page and one Wedding page; everything is backed up and deleted at the
// end. No one else's data is touched.
//   BASE=https://1linktrip.com/ SHOTS=<dir> node tests/hotel-suggest-live.js
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'https://1linktrip.com/';
const SHOTS = process.env.SHOTS || '';
const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
const PAT = fs.readFileSync(process.env.SUPABASE_PAT_FILE || __dirname + '/../../../../secrets/supabase-pat', 'utf8').trim();
const BACKUP = process.env.BACKUP || __dirname + '/../../../eventpages-supabase/backups';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TS = Date.now().toString(36);
const O = { email: `bbbot0209+sugtest-${TS}-org@gmail.com`, pass: 'T' + Math.random().toString(36).slice(2) + 'x9!' };
const TSLUG = `sug-trip-${TS}`, WSLUG = `sug-wed-${TS}`;
const TOOLS = { weather: false, travel: true, stay: true, nearby: true, tours: false, mytrip: true, packing: false, shopping: false };
const TRIP = { v: 2, ek: 'modes:t' + TS, type: 'Trip', title: `Suggest trip ${TS}`, start: '2027-04-01', end: '2027-04-07', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo Station', address: 'Marunouchi, Tokyo', lat: 35.6812, lon: 139.7671, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [{ name: 'Tokyo', lat: 35.6812, lon: 139.7671, city: 'Tokyo', country: 'Japan', cc: 'jp', from: '2027-04-01', to: '2027-04-04' }, { name: 'Kyoto', lat: 35.0116, lon: 135.7681, city: 'Kyoto', country: 'Japan', cc: 'jp', from: '2027-04-04', to: '2027-04-07' }], tools: TOOLS,
  schedule: [{ date: '2027-04-01', time: '15:00', title: 'Check in: Park Hyatt Tokyo', note: '' }, { date: '2027-04-02', time: '10:00', title: 'Senso-ji', note: '' },
    { date: '2027-04-04', time: '15:00', title: 'Check in: Ace Hotel Kyoto', note: '' }, { date: '2027-04-07', time: '11:00', title: 'Check out: Ace Hotel Kyoto', note: '' }] };
const WED = { v: 2, ek: 'modes:w' + TS, type: 'Wedding', title: `Suggest wedding ${TS}`, start: '2027-03-12', end: '2027-03-14', tz: 'America/Cancun',
  venue: { name: 'Hotel Esencia', address: 'Xpu-Ha, Quintana Roo', lat: 20.47, lon: -87.26, city: 'Xpu-Ha', country: 'Mexico', cc: 'mx' }, tools: TOOLS,
  x: { Wedding: { blockHotel: 'Hotel Esencia', blockCode: 'ANALEO' } },
  schedule: [{ date: '2027-03-12', time: '19:00', title: 'Welcome drinks', note: '' }, { date: '2027-03-13', time: '16:00', title: 'Ceremony', note: '' },
    { date: '2027-03-11', time: '', title: 'Check in: Grand Hyatt Playa', note: 'Our room' }] };

(async () => {
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key;
  const admin = (path, init = {}) => fetch(SBURL + path, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const r0 = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: O.email, password: O.pass, email_confirm: true, user_metadata: { full_name: 'Olly Test' } }) })).json();
  const OID = r0.id; ok(/^[0-9a-f-]{36}$/.test(OID || ''), 'throwaway organizer created');
  const browser = await chromium.launch();
  const mk = async () => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
    await page.goto(BASE + '?x=' + TS); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear()); return { ctx, page }; };
  const rows = (page) => page.evaluate(() => { document.querySelectorAll('.day:not(.open) [data-day-tog]').forEach(b => b.click()); return [...document.querySelectorAll('[data-panel="event"] .tl li')].map(l => l.textContent.replace(/\s+/g, ' ').trim()); });
  const tab = async (page, k) => { await page.click(`[data-tab-go="${k}"][role="tab"]`); await page.waitForTimeout(2500); };
  const txt = (page, sel) => page.$eval(sel, e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
  const itin = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k) || '[]'), k);
  const shot = async (page, n, full) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: !!full }); };
  try {
    const o = await mk();
    ok(await o.page.evaluate(async ([e, p]) => { const c = await window.__ep.sb(); const r = await c.auth.signInWithPassword({ email: e, password: p }); localStorage.setItem('ep:signedIn', 'true'); return !!(r.data && r.data.session); }, [O.email, O.pass]), 'organizer signed in');
    const pub = (cfg, slug) => o.page.evaluate(async ([cfg, slug]) => { const c = await window.__ep.sb(); const conf = window.__ep.normalize(JSON.parse(JSON.stringify(cfg))); const r = await c.from('events').insert({ slug, config: conf, published: true }).select('id,config').single(); return r.data || r.error; }, [cfg, slug]);
    const T = await pub(TRIP, TSLUG), W = await pub(WED, WSLUG); ok(T && T.id && W && W.id, 'throwaway Trip + Wedding pages published');
    const TK = 't' + TS, WK = 'w' + TS;

    // ---- Trip, invite link, fresh guest ----
    const g = await mk();
    await g.page.goto(BASE + '?e=' + TSLUG); await g.page.waitForSelector('.ev-tabs'); await g.page.waitForTimeout(1500);
    let rs = (await rows(g.page)).filter(r => /Check in/.test(r)); ok(rs.length === 2 && rs.every(r => /Suggested/.test(r)), `Trip invite: check-in rows Suggested: ${rs.join(' | ')}`);
    await shot(g.page, 'live-trip-invite-event', true);
    await tab(g.page, 'nearby'); await g.page.waitForTimeout(2500);
    let bar = await txt(g.page, '[data-slot="hotel"]'); ok(/No hotel yet/.test(bar) && /Suggested/.test(bar) && !/From the itinerary/.test(bar), `Trip invite Nearby: ${bar}`);
    await shot(g.page, 'live-trip-invite-nearby');
    await tab(g.page, 'mytrip'); ok(!/Park Hyatt|Ace Hotel/.test(await txt(g.page, '#sec-itinerary')), 'Trip invite: My trip has no hotel');
    await shot(g.page, 'live-trip-invite-mytrip');
    ok((await itin(g.page, TK)).length === 0, 'Trip invite: nothing pre-selected');
    // choose
    await tab(g.page, 'nearby'); const ch = await g.page.$('[data-slot="hotel"] .hb-sugs [data-hs-set]'); ok(!!ch, 'Choose button present');
    if (ch) { await ch.click(); await g.page.waitForTimeout(1500); }
    const xs = await itin(g.page, TK); ok(xs.some(x => x.name === 'Park Hyatt Tokyo' && x.start === '2027-04-01' && x.end === '2027-04-04'), `chosen: ${JSON.stringify(xs.map(x => [x.name, x.start, x.end]))}`);
    bar = await txt(g.page, '[data-slot="hotel"]'); ok(/Park Hyatt Tokyo/.test(bar) && !/No hotel yet/.test(bar), `chosen Nearby: ${bar}`);
    await shot(g.page, 'live-trip-chosen-nearby');
    await tab(g.page, 'mytrip'); ok(/Park Hyatt Tokyo/.test(await txt(g.page, '#sec-itinerary')), 'chosen: in My trip');
    await shot(g.page, 'live-trip-chosen-mytrip', true);
    await tab(g.page, 'event'); rs = (await rows(g.page)).filter(r => /Check in/.test(r)); ok(/Park Hyatt Tokyo.*Yours/.test(rs.join('|')) && /Ace Hotel Kyoto.*Suggested/.test(rs.join('|')), `chosen rows: ${rs.join(' | ')}`);

    // ---- Wedding, invite link, fresh guest ----
    const w = await mk();
    await w.page.goto(BASE + '?e=' + WSLUG); await w.page.waitForSelector('.ev-tabs'); await w.page.waitForTimeout(1500);
    rs = await rows(w.page); ok(/Ceremony/.test(rs.join('|')) && !/Grand Hyatt/.test(rs.join('|')), `Wedding invite rows: ${rs.join(' | ')}`);
    await shot(w.page, 'live-wed-invite-event', true);
    await tab(w.page, 'travel'); await shot(w.page, 'live-wed-invite-travel');
    await tab(w.page, 'nearby'); bar = await txt(w.page, '[data-slot="hotel"]'); ok(/No hotel yet/.test(bar) && !/Grand Hyatt/.test(bar), `Wedding invite Nearby: ${bar}`);
    await shot(w.page, 'live-wed-invite-nearby');
    await tab(w.page, 'mytrip'); await shot(w.page, 'live-wed-invite-mytrip');
    ok((await itin(w.page, WK)).length === 0, 'Wedding invite: nothing pre-selected');

    // ---- Share my trip from the Trip's organizer ----
    const tok = await o.page.evaluate(async ([id, cfg]) => { const c = await window.__ep.sb(); const u = (await c.auth.getUser()).data.user; const data = window.__ep.shareData(cfg, true);
      const r = await c.from('trip_shares').insert({ owner: u.id, event_id: id, page_key: window.__ep.syncKey(cfg), name: 'Olly', data }).select('token').single(); return r.data ? r.data.token : JSON.stringify(r.error); }, [T.id, T.config]);
    ok(/^[a-f0-9]{32}$/.test(tok), 'organizer share link made');
    const r = await mk();
    await r.page.goto(BASE + '?e=' + TSLUG + '&s=' + tok); await r.page.waitForSelector('.ev-tabs'); await r.page.waitForTimeout(2500);
    const rx = await itin(r.page, TK); ok(rx.length === 2, `recipient: both hotels pre-selected ${rx.map(x => x.name)}`);
    await tab(r.page, 'mytrip'); const mt = await txt(r.page, '#sec-itinerary'); ok(/Park Hyatt Tokyo/.test(mt) && /Ace Hotel Kyoto/.test(mt), 'recipient: both in their itinerary');
    await shot(r.page, 'live-share-recipient-mytrip', true);
    await tab(r.page, 'event'); rs = (await rows(r.page)).filter(x => /Check in/.test(x)); ok(rs.length === 2 && rs.every(x => /Yours/.test(x)), `recipient rows: ${rs.join(' | ')}`);
    await shot(r.page, 'live-share-recipient-event', true);
    await tab(r.page, 'nearby'); bar = await txt(r.page, '[data-slot="hotel"]'); ok(/Park Hyatt Tokyo/.test(bar) && !/Suggested|No hotel yet/.test(bar), `recipient Nearby: ${bar}`);
    await shot(r.page, 'live-share-recipient-nearby');
    for (const [n, x] of [['organizer', o], ['guest', g], ['wedding guest', w], ['recipient', r]]) ok(!x.page._err.length, `no page errors (${n}) ${x.page._err.join(' | ')}`);
  } catch (e) { ok(false, 'crashed: ' + (e && e.message || e)); }
  finally {
    const dump = { events: await sql(`select * from public.events where owner = '${OID}'`), trip_items: await sql(`select * from public.trip_items where owner = '${OID}'`), trip_shares: await sql(`select owner, event_id, page_key, name, data, created_at from public.trip_shares where owner = '${OID}'`), user: OID };
    fs.mkdirSync(BACKUP, { recursive: true }); const bf = `${BACKUP}/sug-e2e-${TS}.json`; fs.writeFileSync(bf, JSON.stringify(dump, null, 1)); fs.chmodSync(bf, 0o600); console.log('backup ' + bf);
    await sql(`delete from public.trip_shares where owner = '${OID}'`);
    await sql(`delete from public.events where owner = '${OID}' and slug in ('${TSLUG}','${WSLUG}')`);
    if (OID) await admin(`/auth/v1/admin/users/${OID}`, { method: 'DELETE' });
    const left = await sql(`select (select count(*) from public.events where slug in ('${TSLUG}','${WSLUG}')) e, (select count(*) from public.trip_items where owner = '${OID}') i, (select count(*) from public.trip_shares where owner = '${OID}') s, (select count(*) from auth.users where id = '${OID}') u`);
    ok(Array.isArray(left) && +left[0].e === 0 && +left[0].i === 0 && +left[0].s === 0 && +left[0].u === 0, 'test data deleted ' + JSON.stringify(left));
    await browser.close();
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
