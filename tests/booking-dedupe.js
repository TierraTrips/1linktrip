// One booking per real thing. A guest's hotel for a city is ONE item in My trip → bookings, whichever way it got in:
// Add a booking (screenshot / PDF / paste — the AI reader's items), Add to my trip, the Nearby "Your hotel" pick. A
// match (same place id, similar name, or same city with overlapping nights) is merged (confirmation / dates from the
// booking, place id + coords from the map), never added twice; two different hotels for the same nights ask once:
// Replace A with B? (Replace / Keep both). The Itinerary shows a hotel once (check-in day) plus its check-out line.
// Flights (airline + number + date) and rental cars (company + pickup date) dedupe the same way. Old duplicates
// (and old map picks stored as plan items) merge on load; merged-away ids never come back from account sync
// (live Supabase part: a throwaway user, deleted with its rows at the end; skipped without secrets/supabase-pat).
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/booking-dedupe.js
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).length; });
function fakeGoogleMaps() {
  const ls = (o) => { o._l = o._l || {}; return o; };
  class LatLng { constructor(a, b) { this._a = a; this._b = b; } lat() { return this._a; } lng() { return this._b; } }
  class LatLngBounds { constructor() { this.s = 90; this.n = -90; this.w = 180; this.e = -180; } extend(p) { this.s = Math.min(this.s, p.lat); this.n = Math.max(this.n, p.lat); this.w = Math.min(this.w, p.lng); this.e = Math.max(this.e, p.lng); return this; }
    getCenter() { return new LatLng((this.s + this.n) / 2, (this.w + this.e) / 2); } getNorthEast() { return new LatLng(this.n, this.e); } }
  const fire = (o, ev, arg) => ((o._l || {})[ev] || []).slice().forEach(f => f(arg));
  const on = (o, ev, f) => { ls(o); (o._l[ev] = o._l[ev] || []).push(f); return { remove() { o._l[ev] = o._l[ev].filter(x => x !== f); } }; };
  class Map {
    constructor(el, o) { this.el = el; this.c = o.center; this.z = o.zoom; window.__gmap = this; setTimeout(() => this._idle(), 30); }
    _idle() { clearTimeout(this._t); this._t = setTimeout(() => fire(this, 'idle'), 20); }
    addListener(ev, f) { return on(this, ev, f); }
    setCenter(c) { this.c = c; this._idle(); } setZoom(z) { this.z = z; this._idle(); } getZoom() { return this.z; } getCenter() { return new LatLng(this.c.lat, this.c.lng); }
    fitBounds(b) { const c = b.getCenter(); this.c = { lat: c.lat(), lng: c.lng() }; this._idle(); }
    getBounds() { const h = 0.006 * Math.pow(2, 15 - this.z), w = h * 0.6; const b = new LatLngBounds(); b.extend({ lat: this.c.lat - h, lng: this.c.lng - w }); b.extend({ lat: this.c.lat + h, lng: this.c.lng + w }); return b; }
    setOptions() {}
  }
  window.__markers = [];
  class Marker { constructor(o) { this.o = o; this.on = !!o.map; window.__markers.push(this); } setMap(m) { this.on = !!m; } addListener() { return { remove() {} }; } }
  class InfoWindow { setContent() {} open() {} }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Size { constructor(w, h) { this.w = w; this.h = h; } }
  window.google = { maps: { Map, Marker, InfoWindow, LatLngBounds, LatLng, Point, Size, SymbolPath: { CIRCLE: 0 }, event: { trigger() {}, addListenerOnce: (o, ev, f) => { const h = on(o, ev, (a) => { h.remove(); f(a); }); return h; } } } };
}
const P = (name, lat, lon, from, to) => ({ name, address: name + ', Japan', lat, lon, city: name, country: 'Japan', cc: 'jp', from, to });
const CFG = { v: 2, type: 'Trip', title: 'Dedupe trip', start: '2027-04-01', end: '2027-04-08', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 35.6764, 139.65, '2027-04-01', '2027-04-04'), P('Kyoto', 35.0116, 135.7681, '2027-04-04', '2027-04-08')], schedule: [],
  tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const HOT = { 'hotel alpha': [35.6900, 139.7000], 'hotel beta': [35.6600, 139.7300], 'hotel epsilon': [35.6700, 139.7100], 'hotel gamma': [35.6800, 139.7200], 'hotel delta': [35.6650, 139.7050] };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
const K = keyOf(CFG);
const AI = (name, start, end, conf, extra = {}) => ({ type: 'hotel', name, provider: '', start, end, address: 'Shinjuku, Tokyo', confirmation: conf, booked_through: 'Booking.com', flight_number: '', from: '', to: '', note: '', link: '', ...extra });
async function setup(browser, w = 390) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.addInitScript(fakeGoogleMaps);
  await page.route('https://places.googleapis.com/**', async (r) => { const b = JSON.parse(r.request().postData() || '{}');
    if (/searchText/.test(r.request().url()) && b.textQuery) { const hit = Object.entries(HOT).find(([k]) => b.textQuery.toLowerCase().startsWith(k)); if (hit) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: [{ id: 'h-' + hit[0].replace(/ /g, '-'), displayName: { text: hit[0].replace(/\b\w/g, c => c.toUpperCase()) }, formattedAddress: '1-1 Somewhere, Tokyo', types: ['lodging'], location: { latitude: hit[1][0], longitude: hit[1][1] } }] }) }); }
    const c = (b.locationRestriction || b.locationBias || {}).circle; const la = c ? c.center.latitude : 0, lo = c ? c.center.longitude : 0;
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: [{ id: `p-${la.toFixed(3)}`, displayName: { text: 'Place' }, location: { latitude: la, longitude: lo }, rating: 4.1, userRatingCount: 5 }] }) }); });
  await page.route(/overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon|functions\/v1/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  return { ctx, page };
}
const packed = (page) => page.evaluate((c) => window.__ep.packEvent(c), CFG);
const open = async (page, tab, seed) => {
  await page.evaluate(([k, s]) => { localStorage.clear(); for (const [n, v] of Object.entries(s || {})) localStorage.setItem('ep:' + n + ':' + k, JSON.stringify(v)); }, [K, seed]);
  await page.goto(BASE + '#e=' + await packed(page) + '&t=' + tab); await page.waitForSelector(tab === 'nearby' ? '[data-slot="hotel"]' : '#sec-itinerary');
};
const itin = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k) || '[]'), K);
const plan = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem('ep:plan:' + k) || '[]'), K);
const importAI = async (page, items) => { await page.click('[data-tab-go="mytrip"]'); await page.click('#sec-itinerary [data-itin-add]');
  await page.evaluate((xs) => document.querySelector('.ev')._itinReview(window.__ep.aiItemsToBookings(xs)), items); await page.waitForTimeout(100); await page.click('[data-rv-save]'); await page.waitForTimeout(400); };
const mapPick = async (page, q) => { await page.click('[data-tab-go="nearby"]'); await page.waitForSelector('[data-slot="hotel"]');
  if (await page.$('[data-slot="hotel"] [data-hotel-add]')) await page.click('[data-slot="hotel"] [data-hotel-add]');
  await page.fill('[data-hotel-q]', q); await page.click('[data-hotel-find]'); await page.waitForTimeout(600); };
const hotelPins = (page) => page.evaluate(() => window.__markers.filter(m => m.on && m.o.zIndex === 5000).map(m => m.o.label.text));

(async () => {
  const browser = await chromium.launch();
  try {
    // 1 — screenshot import, then the same hotel picked on the map → one item
    { const { ctx, page } = await setup(browser);
      await open(page, 'mytrip');
      await importAI(page, [AI('Hotel Alpha Tokyo', '2027-04-01T15:00', '2027-04-04T11:00', 'AB123')]);
      await mapPick(page, 'Hotel Alpha');
      const xs = await itin(page); const h = xs.filter(x => x.kind === 'hotel');
      ok(h.length === 1 && h[0].confNo === 'AB123' && h[0].ref === 'h-hotel-alpha' && Math.abs(h[0].lat - 35.69) < 1e-3 && h[0].start === '2027-04-01T15:00' && !h[0].guess, `import → map pick: one hotel, booking facts + place ${JSON.stringify(h)}`);
      ok(!(await plan(page)).some(x => x.hotel), 'no separate map-pick copy in the plan');
      await page.waitForTimeout(300); const pins = await hotelPins(page);
      ok(pins.length === 1 && /^Hotel Alpha Tokyo/.test(pins[0]), `one hotel pin, from the booking: ${pins}`);
      ok(/From your bookings/.test(await page.textContent('[data-slot="hotel"]')), 'hotel bar reads the booking');
      await page.click('[data-tab-go="mytrip"]');
      const planRows = await page.$$eval('#sec-plan .plan-row', ls => ls.map(l => l.textContent)); ok(planRows.filter(r => /Hotel Alpha/.test(r)).length === 1, `Your itinerary lists it once (${planRows.length} rows)`);
      ok((await page.$$('#sec-itinerary .bookings li')).length === 1, 'Your bookings: one card');
      await page.click('[data-tab-go="event"]'); await page.waitForSelector('#sec-schedule');
      const sched = await page.$$eval('#sec-schedule li.mine', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim()));
      ok(sched.length === 2 && /Hotel Alpha Tokyo/.test(sched[0]) && /^11:00 AM\s*Check out · Hotel Alpha Tokyo$/.test(sched[1]), `itinerary: check-in + check-out, once each ${JSON.stringify(sched)}`);
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 2 — map pick first, then the screenshot → one item with the booking's dates
    { const { ctx, page } = await setup(browser);
      await open(page, 'nearby'); await page.waitForSelector('[data-hotel-q]');
      await mapPick(page, 'Hotel Beta');
      let xs = await itin(page); ok(xs.length === 1 && xs[0].kind === 'hotel' && xs[0].pin && xs[0].guess && xs[0].start === '2027-04-01' && xs[0].end === '2027-04-04', `map pick = a hotel booking for the Tokyo nights ${JSON.stringify(xs)}`);
      await importAI(page, [AI('Hotel Beta Tokyo', '2027-04-02T15:00', '2027-04-04T10:00', 'BB9')]);
      xs = await itin(page);
      ok(xs.length === 1 && xs[0].confNo === 'BB9' && xs[0].start === '2027-04-02T15:00' && xs[0].ref === 'h-hotel-beta' && xs[0].via === 'booking' && !xs[0].guess, `map pick → import: one hotel, dates/conf from the booking ${JSON.stringify(xs)}`);
      ok(/Updated the booking you already had/.test(await page.textContent('body')), 'says it updated the existing booking');
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 3 — two different hotels for the same nights: ask once (Keep both / Replace), from the sheet and from the map
    { const { ctx, page } = await setup(browser, 320);
      await open(page, 'mytrip');
      await importAI(page, [AI('Hotel Alpha Tokyo', '2027-04-01T15:00', '2027-04-04T11:00', 'AB123')]);
      await importAI(page, [AI('Hotel Gamma', '2027-04-02T15:00', '2027-04-04T11:00', 'GG1')]);
      const q = await page.textContent('#sec-itinerary .bk-ask').catch(() => '');
      ok(/Replace Hotel Alpha Tokyo with Hotel Gamma\?/.test(q), `asks: ${q.replace(/\s+/g, ' ')}`);
      ok((await overflow(page)) === 0, '@320 prompt fits');
      await page.click('#sec-itinerary [data-bk-ask="0"]'); await page.waitForTimeout(300);
      let names = (await itin(page)).map(x => x.name); ok(names.join('|') === 'Hotel Alpha Tokyo|Hotel Gamma' && !(await page.$('.bk-ask')), `Keep both → both, prompt gone (${names})`);
      await importAI(page, [AI('Hotel Delta', '2027-04-01T15:00', '2027-04-03T11:00', 'DD1')]);
      await page.click('#sec-itinerary [data-bk-ask="1"]'); await page.waitForTimeout(300);
      names = (await itin(page)).map(x => x.name); ok(names.length === 2 && names.includes('Hotel Delta') && !names.includes('Hotel Alpha Tokyo'), `Replace → Alpha replaced by Delta (${names})`);
      await mapPick(page, 'Hotel Epsilon');
      const mq = await page.textContent('[data-slot="hotel-ask"]').catch(() => '');
      ok(/Replace .+ with Hotel Epsilon\?/.test(mq), `map pick over booked nights asks too: ${mq.replace(/\s+/g, ' ')}`);
      await page.click('[data-slot="hotel-ask"] [data-bk-ask="0"]'); await page.waitForTimeout(300);
      ok((await itin(page)).length === 3, 'Keep both from the map → 3 hotels');
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 4 — flights and rental cars
    { const { ctx, page } = await setup(browser);
      await open(page, 'mytrip');
      const fl = async (n) => { await page.click('#sec-itinerary [data-itin-add]'); await page.click('[data-itin-mode="manual"]'); await page.selectOption('#it-kind', 'flight'); await page.fill('#it-flight', n); await page.fill('#it-start', '2027-04-01T09:00'); await page.click('[data-itin-save]'); await page.waitForTimeout(300); };
      await fl('ua 837'); await fl('UA837');
      await importAI(page, [{ type: 'flight', name: 'UA 837 SFO → HND', provider: 'United', start: '2027-04-01T09:00', end: '2027-04-02T13:05', address: '', confirmation: 'UQ7Z', flight_number: 'UA 837', from: 'SFO', to: 'HND', note: '', link: '' },
        { type: 'flight', name: 'UA 838 HND → SFO', provider: 'United', start: '2027-04-08T16:00', end: '2027-04-08T09:40', address: '', confirmation: 'UQ7Z', flight_number: 'UA 838', from: 'HND', to: 'SFO', note: '', link: '' },
        { type: 'car', name: 'Hertz', provider: 'Hertz', start: '2027-04-04T10:00', end: '2027-04-08T10:00', address: 'Kyoto Station', confirmation: 'HZ1', flight_number: '', from: '', to: '', note: '', link: '' }]);
      await importAI(page, [{ type: 'car', name: 'Hertz Japan', provider: 'Hertz', start: '2027-04-04T11:00', end: '2027-04-08T10:00', address: '', confirmation: '', flight_number: '', from: '', to: '', note: 'Compact', link: '' }]);
      const xs = await itin(page); const f = xs.filter(x => x.kind === 'flight'); const c = xs.filter(x => x.kind === 'car');
      ok(f.length === 2 && f.find(x => /837/.test(x.flight)).confNo === 'UQ7Z', `same flight number + date → one flight (UA 837 ×3 → 1; UA 838 separate) ${JSON.stringify(f.map(x => x.flight))}`);
      ok(c.length === 1 && c[0].confNo === 'HZ1' && /Compact/.test(c[0].note || ''), `same company + pickup date → one car ${JSON.stringify(c)}`);
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 5 — existing duplicates (and an old map pick in the plan) merge on load, keeping the richer item
    { const { ctx, page } = await setup(browser);
      await open(page, 'mytrip', {
        itin: [{ id: 'a1', kind: 'hotel', name: 'Hotel Alpha Tokyo', address: 'Shinjuku', start: '2027-04-01T15:00', end: '2027-04-04T11:00', confNo: 'AB123', via: 'booking' },
          { id: 'a2', kind: 'hotel', name: 'HOTEL ALPHA TOKYO', address: '', start: '2027-04-01', end: '2027-04-04' },
          { id: 'f1', kind: 'flight', name: 'United UA 837', flight: 'UA 837', start: '2027-04-01T09:00', end: '' },
          { id: 'f2', kind: 'flight', name: 'United UA 837', flight: 'UA837', start: '2027-04-01T09:00', end: '2027-04-02T13:05', to: 'HND', confNo: 'UQ7Z' },
          { id: 'c1', kind: 'car', name: 'Rental car at HND', address: 'Haneda', start: '2027-04-04', end: '2027-04-08', ph: 1 },
          { id: 'c2', kind: 'car', name: 'Hertz', start: '2027-04-04T10:00', end: '2027-04-08T10:00', confNo: 'HZ1' },
          { id: 'k1', kind: 'hotel', name: 'Ryokan Kyo', start: '2027-04-04', end: '2027-04-08' }],
        plan: [{ id: 'pl1', src: 'g', ref: 'h-hotel-alpha', name: 'Hotel Alpha', lat: 35.69, lon: 139.70, addr: '1-1 Somewhere, Tokyo', hotel: true, city: 0, type: 'stay', day: '' },
          { id: 'pl2', src: 'g', ref: 'p-1', name: 'Cafe', lat: 35.68, lon: 139.70, type: 'food', day: '' }] });
      const xs = await itin(page); const gone = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:gone:' + k) || '[]'), K);
      const h = xs.filter(x => x.kind === 'hotel' && /alpha/i.test(x.name));
      ok(h.length === 1 && h[0].id === 'a1' && h[0].confNo === 'AB123' && h[0].ref === 'h-hotel-alpha' && h[0].lat === 35.69, `3 copies of Hotel Alpha → the richer one, with the map's place ${JSON.stringify(h)}`);
      ok(xs.filter(x => x.kind === 'flight').length === 1 && xs.find(x => x.kind === 'flight').confNo === 'UQ7Z', 'flight duplicates → one');
      ok(xs.filter(x => x.kind === 'car').length === 1 && xs.find(x => x.kind === 'car').confNo === 'HZ1' && !xs.find(x => x.kind === 'car').ph, 'placeholder rental car + Hertz → one');
      ok(xs.some(x => x.name === 'Ryokan Kyo'), 'a different city\'s hotel stays');
      const pl = await plan(page); ok(!pl.some(x => x.hotel) && pl.some(x => x.id === 'pl2'), 'old map pick left the plan; saved spot stays');
      ok(['a2', 'pl1'].every(id => gone.includes(id)) && gone.includes(xs.find(x => x.kind === 'flight').id === 'f1' ? 'f2' : 'f1'), `merged-away ids remembered ${gone}`);
      ok((await page.$$('#sec-itinerary .bookings li')).length === 4, 'bookings: 4 cards');
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 6 — signed in: the merge reaches the account and a stale duplicate row there never comes back (live Supabase)
    const patFile = process.env.SUPABASE_PAT_FILE || __dirname + '/../../../../secrets/supabase-pat';
    if (!fs.existsSync(patFile)) console.log('skip live sync part (no PAT)'); else await liveSync(browser, fs.readFileSync(patFile, 'utf8').trim());
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

async function liveSync(browser, PAT) {
  const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key;
  const admin = (path, init = {}) => fetch(SBURL + path, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const EMAIL = `ep-dedupe-${Date.now().toString(36)}@example.com`; const PASS = 'T' + Math.random().toString(36).slice(2) + 'x9!';
  const u = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }) })).json();
  const UID = u.id; ok(/^[0-9a-f-]{36}$/.test(UID || ''), 'throwaway user created');
  // trip_items is granted to signed-in users only: read / seed it as the database owner over the Management API
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const rows = async () => sql(`select id, kind, item from public.trip_items where owner = '${UID}' and page_key = '${K}' order by id`);
  const put = (rs) => sql(`insert into public.trip_items (id, owner, page_key, kind, item) values ${rs.map(r => `('${r.id}', '${UID}', '${K}', '${r.kind}', $j$${JSON.stringify(r.item)}$j$::jsonb)`).join(', ')} on conflict (owner, id) do update set item = excluded.item, kind = excluded.kind returning id`);
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 500)); } };
  const signIn = (page) => page.evaluate(async ([e, p]) => { const c = await window.__ep.sb(); const r = await c.auth.signInWithPassword({ email: e, password: p }); localStorage.setItem('ep:signedIn', 'true'); return !!(r.data && r.data.session); }, [EMAIL, PASS]);
  try {
    // device A had the duplicates; the account has them too (as an older version pushed them)
    const dupes = [{ id: 'a1', kind: 'hotel', name: 'Hotel Alpha Tokyo', start: '2027-04-01T15:00', end: '2027-04-04T11:00', confNo: 'AB123' }, { id: 'a2', kind: 'hotel', name: 'Hotel Alpha Tokyo', start: '2027-04-01', end: '2027-04-04' }];
    const pin = { id: 'pl1', src: 'g', ref: 'h-hotel-alpha', name: 'Hotel Alpha', lat: 35.69, lon: 139.70, addr: '', hotel: true, city: 0, type: 'stay', day: '' };
    const ins = await put(dupes.map(x => ({ id: x.id, kind: 'booking', item: x })).concat([{ id: 'pl1', kind: 'place', item: pin }]));
    ok(Array.isArray(ins) && ins.length === 3, `account seeded with the duplicates ${JSON.stringify(ins).slice(0, 120)}`);
    const A = await setup(browser); await A.page.evaluate(() => localStorage.clear()); ok(await signIn(A.page), 'A signed in');
    await A.page.evaluate(([k, d, p]) => { localStorage.setItem('ep:itin:' + k, JSON.stringify(d)); localStorage.setItem('ep:plan:' + k, JSON.stringify([p])); }, [K, dupes, pin]);
    await A.page.goto(BASE + '#e=' + await packed(A.page) + '&t=mytrip'); await A.page.waitForSelector('#sec-itinerary');
    const r1 = await until(async () => { const r = await rows(); return Array.isArray(r) && r.length === 1 ? r : null; });
    ok(r1 && r1[0].id === 'a1' && r1[0].kind === 'booking' && r1[0].item.confNo === 'AB123' && r1[0].item.ref === 'h-hotel-alpha', `account: one hotel row after the merge ${JSON.stringify(r1)}`);
    // an old copy of the app elsewhere pushes a2 back; A reopens: not resurrected, and deleted again
    const re = await put([{ id: 'a2', kind: 'booking', item: dupes[1] }]); ok(Array.isArray(re) && re.length === 1, 'an old client pushes the duplicate back');
    await A.page.reload(); await A.page.waitForSelector('#sec-itinerary'); await A.page.waitForTimeout(2500);
    ok((await A.page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k)), K)).length === 1, 'A: the stale row did not come back');
    const r2 = await until(async () => { const r = await rows(); return Array.isArray(r) && r.length === 1 ? r : null; });
    ok(!!r2, 'account: the stale duplicate row was deleted again');
    // device B (nothing local) signs in → one hotel
    const B = await setup(browser); await B.page.evaluate(() => localStorage.clear()); ok(await signIn(B.page), 'B signed in');
    await B.page.goto(BASE + '#e=' + await packed(B.page) + '&t=mytrip'); await B.page.waitForSelector('#sec-itinerary');
    await until(async () => (await B.page.$$('#sec-itinerary .bookings li')).length > 0);
    ok((await B.page.$$('#sec-itinerary .bookings li')).length === 1, 'B: one hotel from the account');
    ok(A.page._err.length + B.page._err.length === 0, `no page errors ${A.page._err} ${B.page._err}`);
    await A.ctx.close(); await B.ctx.close();
  } finally {
    if (/^[0-9a-f-]{36}$/.test(UID || '')) { await admin(`/auth/v1/admin/users/${UID}`, { method: 'DELETE' }); const gone = (await admin(`/auth/v1/admin/users/${UID}`)).status === 404; const left = await rows(); ok(gone && Array.isArray(left) && !left.length, 'cleanup: throwaway user and its rows deleted'); }
  }
}
