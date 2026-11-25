// "Forward bookings" in the app (the inbound function + Resend Inbound). The row — personal address add-<token>@<domain>,
// Copy, "Or send from <sign-in email> to trips@<domain>" — shows in My trip and My pages only when signed in AND the
// inbound function says it's set up (GET → { enabled, domain }); dormant (not deployed / not configured / signed out) it's
// not there at all. Forwarded bookings the function saved for this trip become bookings through the same add path as
// Add a booking (dedupe/merge); Inbox ones show a one-tap "Add to this trip" in My trip, and an "Add to…" trip picker in My pages.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/inbound-ui.js
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.tagName + '.' + e.className).slice(0, 5); });

const USER = { id: 'aaaaaaaa-0000-4000-8000-0000000000d1', email: 'dylan@example.com' };
const TOKEN = '0123456789abcdef01';
const FX = JSON.parse(fs.readFileSync(__dirname + '/fixtures/inbound-hotel-email.json', 'utf8'));
const CFG = { v: 2, type: 'Trip', title: 'Japan Trip', start: '2027-04-25', end: '2027-06-02', venue: { name: 'Kyoto', address: 'Kyoto, Japan', lat: 35.0116, lon: 135.7681, city: 'Kyoto', country: 'Japan', cc: 'jp' }, schedule: [],
  tools: { nearby: false, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
const K = keyOf(CFG);
const fwdRow = (page_key, i = 0, ai = FX.ai_item) => ({ owner: USER.id, id: `em-8c1f7c3e2b7a4d7e-${i}`, page_key, kind: 'booking', source: 'email', item: { inbound: 1, ai, em: FX.webhook.data.email_id, subj: 'Fwd: Hyatt', at: '2026-11-24T18:02:12Z' } });

// in-page supabase-js stand-in: an in-memory table store with the filters the app uses
function fakeSupabase(seed) {
  const db = window.__db = JSON.parse(JSON.stringify(seed.db)); window.__user = seed.user;
  const qb = (name) => {
    const fs = []; let op = 'select', one = 0, payload = null, ret = false;
    const T = () => (db[name] = db[name] || []);
    const run = () => {
      const hit = T().filter(r => fs.every(f => f(r)));
      if (op === 'insert' || op === 'upsert') {
        const rows = (Array.isArray(payload) ? payload : [payload]).map(r => ({ ...(name === 'inbound_tokens' ? { token: seed.token } : {}), owner: window.__user && window.__user.id, ...r }));
        rows.forEach(r => { const i = T().findIndex(x => x.owner === r.owner && x.id !== undefined && x.id === r.id); if (i >= 0) T()[i] = { ...T()[i], ...r }; else T().push(r); });
        const data = ret ? rows : null; return { data: one ? data && data[0] : data, error: null };
      }
      if (op === 'update') { hit.forEach(r => Object.assign(r, payload)); return { data: null, error: null }; }
      if (op === 'delete') { db[name] = T().filter(r => !hit.includes(r)); return { data: null, error: null }; }
      return { data: one ? hit[0] || null : hit, error: null };
    };
    const q = {
      select: () => { if (op !== 'select') ret = true; return q; },
      insert: (p) => { op = 'insert'; payload = p; return q; }, upsert: (p) => { op = 'upsert'; payload = p; return q; },
      update: (p) => { op = 'update'; payload = p; return q; }, delete: () => { op = 'delete'; return q; },
      eq: (k, v) => { fs.push(r => r[k] === v); return q; }, neq: (k, v) => { fs.push(r => r[k] !== v); return q; },
      in: (k, vs) => { fs.push(r => vs.includes(r[k])); return q; },
      not: (k, o, v) => { const ids = String(v).replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')); fs.push(r => !ids.includes(r[k])); return q; },
      is: () => q, gte: () => q, order: () => q, limit: () => q,
      single: () => { one = 2; return Promise.resolve(run()); }, maybeSingle: () => { one = 1; return Promise.resolve(run()); },
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  const client = { from: qb, rpc: async () => ({ data: null, error: { message: 'no' } }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
    auth: { getSession: async () => ({ data: { session: window.__user ? { user: window.__user, access_token: 'tok' } : null } }), getUser: async () => ({ data: { user: window.__user } }), signOut: async () => ({}), signInWithOtp: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
  window.supabase = { createClient: () => client };
}

async function setup(browser, { w = 390, inbound = { ok: true, enabled: true, domain: 'in.1linktrip.com' }, signedIn = true, db = {}, events = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const full = { inbound_tokens: [], trip_items: [], events, ...db };
  await page.addInitScript(fakeSupabase, { db: full, user: signedIn ? USER : null, token: TOKEN });
  if (signedIn) await page.addInitScript(() => { if (!localStorage.getItem('ep:signedIn')) localStorage.setItem('ep:signedIn', 'true'); });
  const calls = { inbound: 0 };
  await page.route('**/*.supabase.co/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('/functions/v1/inbound')) { calls.inbound++; return inbound === 404 ? route.fulfill({ status: 404, body: 'not found', headers: { 'access-control-allow-origin': '*' } }) : route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(inbound) }); }
    if (u.pathname.includes('/functions/')) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    return route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'PGRST205', message: 'not here' }) });
  });
  await page.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon|unsplash|fonts\.|maps\.mail\.ru/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  return { ctx, page, errors, calls };
}
const openTrip = async (page) => { await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), CFG) + '&t=mytrip'); await page.waitForSelector('#sec-itinerary'); await page.waitForTimeout(900); };
const itin = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k) || '[]'), K);
const rows = (page, t) => page.evaluate((t) => window.__db[t] || [], t);

(async () => {
  const browser = await chromium.launch();
  try {
    // ---------- dormant: hidden everywhere ----------
    for (const [label, inbound, signedIn] of [['not configured', { ok: true, enabled: false, domain: '' }, true], ['not deployed (404)', 404, true], ['signed out', { ok: true, enabled: true, domain: 'in.1linktrip.com' }, false]]) {
      const { ctx, page, errors } = await setup(browser, { inbound, signedIn });
      await openTrip(page);
      ok(!(await page.$('.fwd-row')), `${label}: no Forward bookings row in My trip`);
      ok(!/Forward bookings|in\.1linktrip/.test(await page.textContent('#sec-itinerary')), `${label}: no forwarding text in My trip`);
      if (signedIn) { await page.goto(BASE + '#mine'); await page.waitForSelector('.mine-h'); await page.waitForTimeout(500); ok(!(await page.$('.fwd-row')), `${label}: no row in My pages`); }
      ok(!(await rows(page, 'inbound_tokens')).length, `${label}: no token made`);
      ok(!errors.length, `${label}: no page errors ${errors.join(' | ')}`);
      await ctx.close();
    }

    // ---------- enabled: the row, Copy, token made once ----------
    for (const w of [390, 320]) {
      const { ctx, page, errors } = await setup(browser, { w });
      await openTrip(page);
      await page.waitForSelector('#sec-itinerary .fwd-row', { timeout: 5000 }).catch(() => {});
      const txt = await page.textContent('#sec-itinerary .fwd-row').catch(() => '');
      ok(txt.includes('Forward bookings') && txt.includes(`add-${TOKEN}@in.1linktrip.com`), `@${w} My trip: Forward bookings + personal address (${txt.slice(0, 90)})`);
      ok(txt.includes('Or send from dylan@example.com to trips@in.1linktrip.com'), `@${w} My trip: "Or send from <sign-in email>" line`);
      ok(txt.includes('Forward any confirmation email to this address and it’s added to your trip.'), `@${w} My trip: one-sentence explainer`);
      const stacked = await page.evaluate(() => { const r = (s) => document.querySelector('#sec-itinerary .fwd-row ' + s).getBoundingClientRect(); const h = r('.fwd-h'), p = r('.fwd-p'), a = r('.fwd-addr'), o = r('.fwd-or'); return h.bottom <= p.top + 1 && p.bottom <= a.top + 1 && a.bottom <= o.top + 1; });
      ok(stacked, `@${w} My trip: title, sentence, address, alternate each on their own line`);
      const toks = await rows(page, 'inbound_tokens'); ok(toks.length === 1 && toks[0].owner === USER.id, `@${w} token row made for this account (${toks.length})`);
      await page.click('#sec-itinerary [data-fwd-copy]'); await page.waitForTimeout(200);
      ok(await page.evaluate(() => navigator.clipboard.readText()) === `add-${TOKEN}@in.1linktrip.com`, `@${w} Copy puts the address on the clipboard`);
      ok(/Copied/.test(await page.textContent('#sec-itinerary [data-fwd-copy]')), `@${w} Copy says Copied`);
      if (SHOTS) await page.locator('#sec-itinerary').screenshot({ path: `${SHOTS}/fwd-mytrip-${w}.png` });
      const ov = await overflow(page); ok(!ov.length, `@${w} My trip: no overflow ${ov}`);
      await page.goto(BASE + '#mine'); await page.waitForSelector('.mine-h'); await page.waitForSelector('.mine .fwd-row', { timeout: 5000 }).catch(() => {});
      ok((await page.textContent('.mine .fwd-row').catch(() => '')).includes(`add-${TOKEN}@in.1linktrip.com`), `@${w} My pages: the same row`);
      ok((await rows(page, 'inbound_tokens')).length === 1, `@${w} existing token reused`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/fwd-mine-${w}.png` });
      ok(!errors.length, `@${w} no page errors ${errors.join(' | ')}`);
      await ctx.close();
    }

    // ---------- forwarded into this trip: becomes a booking via the add path; same booking twice merges ----------
    {
      const { ctx, page, errors } = await setup(browser, { db: { trip_items: [fwdRow(K, 0), fwdRow(K, 1, { ...FX.ai_item, room_type: '' })] } });
      await openTrip(page); await page.waitForTimeout(1200);
      const xs = await itin(page); const h = xs.filter(x => /Hyatt Place Kyoto/.test(x.name));
      ok(h.length === 1 && h[0].confNo === '58213977' && h[0].kind === 'hotel' && h[0].start === '2027-05-10T15:00', `forwarded hotel is a booking, once (${xs.map(x => x.name + ':' + x.confNo).join(', ')})`);
      ok(h[0] && h[0].det && h[0].det.room === 'King Bed, Non-Smoking' && h[0].det.cancelBy === '2027-05-07', 'details mapped like Read with AI (room, free cancellation)');
      ok(/Hyatt Place Kyoto/.test(await page.textContent('#sec-itinerary')), 'shown in My trip bookings');
      const tr = await rows(page, 'trip_items'); ok(!tr.some(r => r.item && r.item.inbound), `account copy no longer raw (${tr.map(r => r.id + (r.item.inbound ? '*' : '')).join(',')})`);
      ok(!errors.length, `forwarded: no page errors ${errors.join(' | ')}`);
      await ctx.close();
    }

    // ---------- Inbox: My trip one tap ----------
    {
      const { ctx, page, errors } = await setup(browser, { db: { trip_items: [fwdRow('inbox', 0)] } });
      await openTrip(page); await page.waitForSelector('.inbox-note', { timeout: 5000 }).catch(() => {});
      const note = await page.textContent('.inbox-note').catch(() => '');
      ok(/1 forwarded booking/.test(note) && /Hyatt Place Kyoto/.test(note) && /May/.test(note), `My trip: Inbox note lists it (${note})`);
      if (SHOTS) await page.locator('#sec-plan').screenshot({ path: `${SHOTS}/fwd-inbox-mytrip.png` }).catch(() => {});
      await page.click('[data-inbox-add]'); await page.waitForTimeout(1500);
      ok((await itin(page)).some(x => x.confNo === '58213977'), 'Add to this trip → booking added');
      ok(!(await page.$('.inbox-note')), 'note gone');
      const tr = await rows(page, 'trip_items'); ok(!tr.some(r => r.page_key === 'inbox') && tr.some(r => r.page_key === K && r.id === 'em-8c1f7c3e2b7a4d7e-0'), `account row now under this trip (${tr.map(r => r.page_key + ':' + r.id).join(',')})`);
      ok(!errors.length, `inbox: no page errors ${errors.join(' | ')}`);
      await ctx.close();
    }

    // ---------- Inbox: My pages picker ----------
    {
      const ev = { id: 'e1', slug: 'japan-trip-djepw', owner: USER.id, config: { ...CFG, ek: 'modes:xfr8ua' }, published: true, updated_at: '2026-11-24T00:00:00Z' };
      const { ctx, page, errors } = await setup(browser, { db: { trip_items: [fwdRow('inbox', 0)] }, events: [ev] });
      await page.goto(BASE + '#mine'); await page.waitForSelector('[data-inbox-to]', { timeout: 6000 }).catch(() => {});
      const sec = await page.textContent('[data-slot="mine-inbox"]').catch(() => '');
      ok(/1 forwarded booking/.test(sec) && /Hyatt Place Kyoto/.test(sec), `My pages: Inbox lists it (${sec.slice(0, 80)})`);
      ok((await page.$$eval('[data-inbox-to] option', os => os.map(o => o.value))).includes('xfr8ua'), 'trip picker offers Japan Trip');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/fwd-inbox-mine.png` });
      await page.selectOption('[data-inbox-to]', 'xfr8ua'); await page.waitForTimeout(400);
      ok((await rows(page, 'trip_items')).find(r => r.id === 'em-8c1f7c3e2b7a4d7e-0').page_key === 'xfr8ua', 'one tap moves it to that trip');
      ok(!(await page.$('[data-inbox-to]')), 'row gone from the Inbox');
      const ov = await overflow(page); ok(!ov.length, `My pages: no overflow ${ov}`);
      ok(!errors.length, `My pages inbox: no page errors ${errors.join(' | ')}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
