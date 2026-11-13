// Richer bookings: details per type (hotel room / beds / guests / amenities / free cancellation / price; tour meeting point /
// duration / included / price; flight seat / cabin / baggage; car class), folded behind the item; the AI reader
// (ai-import v16, fixture from a real run) fills them; photos on bookings and plan places — signed out a few small
// copies on the device, signed in uploaded to Storage (live part: a throwaway user, photo + user deleted after);
// a place with a Google place id shows Google's photos with their authors credited, fetched once. Merging keeps them.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/booking-details.js
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).length; });
const SHOTS = process.env.SHOTS || '';
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
const CFG = { v: 2, type: 'Trip', title: 'Details trip', start: '2027-04-01', end: '2027-04-08', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 35.6764, 139.65, '2027-04-01', '2027-04-08')], schedule: [],
  tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
const K = keyOf(CFG);
// what the deployed ai-import (v16) returned for a real Booking.com + United + GetYourGuide confirmation
const AI_ITEMS = JSON.parse(fs.readFileSync(__dirname + '/fixtures/ai-items-v16.json', 'utf8'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = (n) => ({ name: `p${n}.png`, mimeType: 'image/png', buffer: PNG });
async function setup(browser, w = 390) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e))); page._g = [];
  await page.addInitScript(fakeGoogleMaps);
  await page.route('https://places.googleapis.com/**', async (r) => { const u = r.request().url(); page._g.push(u);
    if (/\/media\?/.test(u)) return r.fulfill({ contentType: 'image/png', body: PNG });
    if (/\/v1\/places\/[^:?]+/.test(u) && r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ photos: [{ name: 'places/h-gracery/photos/AAA', authorAttributions: [{ displayName: 'Aiko T.', uri: 'https://maps.google.com/maps/contrib/1' }] }, { name: 'places/h-gracery/photos/BBB', authorAttributions: [{ displayName: 'Ben K.', uri: 'https://maps.google.com/maps/contrib/2' }] }] }) });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: [] }) }); });
  await page.route(/overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon|functions\/v1/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  return { ctx, page };
}
const open = async (page, seed) => {
  await page.evaluate(([k, s]) => { localStorage.clear(); for (const [n, v] of Object.entries(s || {})) localStorage.setItem('ep:' + n + ':' + k, JSON.stringify(v)); }, [K, seed]);
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), CFG) + '&t=mytrip'); await page.waitForSelector('#sec-itinerary');
};
const itin = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k) || '[]'), K);
const card = (page, re) => page.evaluateHandle((s) => [...document.querySelectorAll('#sec-itinerary .bookings > li')].find(li => new RegExp(s).test(li.querySelector('b').textContent)), re);

(async () => {
  const browser = await chromium.launch();
  try {
    for (const w of [390, 320]) {
      const { ctx, page } = await setup(browser, w);
      await open(page);
      // AI import fills the details; the review card says what it read
      await page.click('#sec-itinerary [data-itin-add]');
      await page.evaluate((xs) => document.querySelector('.ev')._itinReview(window.__ep.aiItemsToBookings(xs)), AI_ITEMS); await page.waitForTimeout(150);
      const rv = await page.$$eval('.rv-card .rv-det', ps => ps.map(p => p.textContent));
      ok(rv.length === 3 && /Room type: Superior Double Room/.test(rv[0]) && /Breakfast/.test(rv[0]) && /Seat: 34C/.test(rv[1]) && /Meeting point: Shinjuku Station/.test(rv[2]), `@${w} review cards show the details read ${JSON.stringify(rv)}`);
      ok(await page.$eval('#rv2-kind', s => s.value) === 'tour', `@${w} a tour is a Tour or activity`);
      await page.click('[data-rv-save]'); await page.waitForTimeout(300);
      let xs = await itin(page); const h = xs.find(x => x.kind === 'hotel');
      ok(h && h.det.room === 'Superior Double Room, Non-Smoking' && h.det.beds === '1 queen' && h.det.guests === '2' && h.det.amen.join() === 'breakfast,wifi' && h.det.cancelBy === '2027-03-29' && h.det.price === '¥64,800', `@${w} hotel details stored ${JSON.stringify(h && h.det)}`);
      ok(xs.find(x => x.kind === 'flight').det.cabin === 'economy' && xs.find(x => x.kind === 'tour').det.duration === '10 hours', `@${w} flight + tour details stored`);
      // folded behind the card until tapped
      const hc = await card(page, 'Gracery'); const det = await hc.$('details.det');
      const fd = det ? await det.evaluate(d => [d.open, Math.round(d.getBoundingClientRect().height)]) : null; ok(fd && !fd[0] && fd[1] < 30, `@${w} details folded on the card ${fd}`);
      await det.$eval('summary', s => s.click()); await page.waitForTimeout(200);
      const lines = await det.$$eval('.det-l > span', ls => ls.map(l => l.textContent)); const tags = await det.$$eval('.det-am .tag', ls => ls.map(l => l.textContent));
      ok(lines.includes('Check-in 3:00 PM') && lines.includes('Check-out 11:00 AM') && lines.includes('Room type: Superior Double Room, Non-Smoking') && lines.includes('Free cancellation until: Mar 29') && tags.join() === 'Breakfast,Wi-Fi', `@${w} tap → details ${JSON.stringify(lines)} ${tags}`);
      // edit: more details in the form
      const i = await hc.$eval('[data-itin-edit]', b => b.dataset.itinEdit); await page.click(`[data-itin-edit="${i}"]`); await page.waitForSelector('.itin-form .more-f[open]');
      await page.fill('[data-det="beds"]', '1 king'); await page.click('[data-det-amen="pool"]'); await page.click('[data-itin-save]'); await page.waitForTimeout(300);
      xs = await itin(page); ok(xs.find(x => x.kind === 'hotel').det.beds === '1 king' && xs.find(x => x.kind === 'hotel').det.amen.includes('pool'), `@${w} edit form saves beds + amenity chip`);
      // photos signed out: small copies on this device, 3 per item; remove ×
      const ref = 'bk:' + xs.find(x => x.kind === 'tour').id;
      await page.setInputFiles(`[data-ph-add="${ref}"]`, [JPG(1), JPG(2)]); await page.waitForTimeout(600);
      let ps = (await itin(page)).find(x => x.kind === 'tour').photos || [];
      ok(ps.length === 2 && ps.every(p => /^data:image\/jpeg;base64,/.test(p.url) && p.local && p.url.length < 90e3), `@${w} 2 photos kept on the device (${ps.map(p => p.url.length)})`);
      ok(await page.$$eval(`[data-gal="${ref}"] figure img`, is => is.length) === 2 && await page.$eval(`[data-det-ref="${ref}"]`, d => d.open), `@${w} gallery on the card, stays open`);
      await page.setInputFiles(`[data-ph-add="${ref}"]`, [JPG(3), JPG(4)]); await page.waitForTimeout(600);
      ok(((await itin(page)).find(x => x.kind === 'tour').photos || []).length === 3 && /Sign in to add more photos/.test(await page.textContent('body')), `@${w} signed out: 3 photos max, then sign in`);
      await page.click(`[data-ph-del="${ref}"][data-ph-i="0"]`); await page.waitForTimeout(300);
      ok(((await itin(page)).find(x => x.kind === 'tour').photos || []).length === 2, `@${w} × removes a photo`);
      if (SHOTS && w === 390) await page.locator('#sec-itinerary').screenshot({ path: `${SHOTS}/booking-details-390.png` });
      ok((await overflow(page)) === 0, `@${w} no overflow with details open`);
      ok(page._err.length === 0, `@${w} no page errors ${page._err}`); await ctx.close();
    }

    // a hotel with a Google place id gets Google's photos (fetched once, with the authors credited)
    { const { ctx, page } = await setup(browser);
      await open(page, { itin: [{ id: 'h1', kind: 'hotel', name: 'Hotel Gracery Shinjuku', start: '2027-04-01T15:00', end: '2027-04-04T11:00', ref: 'h-gracery', lat: 35.6945, lon: 139.7016, pin: 1 }],
        plan: [{ id: 'pl1', src: 'g', ref: 'ChIJtour', name: 'Tsukiji Food Tour', lat: 35.665, lon: 139.77, type: 'activity', day: '2027-04-03', time: '09:00', note: '' }] });
      await page.click('[data-det-ref="bk:h1"] summary'); await page.waitForFunction(() => document.querySelectorAll('[data-gal="bk:h1"] figure img').length === 2, null, { timeout: 5000 }).catch(() => {});
      const srcs = await page.$$eval('[data-gal="bk:h1"] figure img', is => is.map(i => i.getAttribute('src')));
      ok(srcs.length === 2 && srcs.every(s => /^https:\/\/places\.googleapis\.com\/v1\/places\/h-gracery\/photos\/\w+\/media\?maxWidthPx=400&key=/.test(s)), `Google photos for the place ${srcs}`);
      const attr = await page.textContent('[data-det-ref="bk:h1"] .g-attr').catch(() => '');
      ok(/Aiko T\./.test(attr) && /Ben K\./.test(attr) && /Google/.test(attr) && await page.$eval('[data-det-ref="bk:h1"] .g-attr a', a => a.href) === 'https://maps.google.com/maps/contrib/1', `authors credited, linked: ${attr}`);
      const st = (await itin(page))[0]; ok(st.gph === 1 && st.photos.length === 2 && st.photos[0].g && !JSON.stringify(st).includes('key='), 'kept on the item (photo names, never the key)');
      const n0 = page._g.filter(u => /\/places\/h-gracery\?|\/places\/h-gracery$/.test(u)).length;
      await page.reload(); await page.waitForSelector('#sec-itinerary'); await page.click('[data-det-ref="bk:h1"] summary'); await page.waitForTimeout(400);
      ok(page._g.filter(u => /\/places\/h-gracery\?|\/places\/h-gracery$/.test(u)).length === n0, 'not fetched again');
      // a place in the plan: tour fields right there (saved on change)
      const pd = '[data-det-ref="pl:pl1"]'; await page.click(`${pd} summary`); await page.waitForTimeout(200);
      await page.fill(`${pd} [data-pdet="meet"]`, 'Tsukiji Station exit 1'); await page.press(`${pd} [data-pdet="meet"]`, 'Tab'); await page.waitForTimeout(200);
      await page.fill(`${pd} [data-pdet="duration"]`, '3 hours'); await page.press(`${pd} [data-pdet="duration"]`, 'Tab'); await page.waitForTimeout(200);
      const pl = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:plan:' + k)), K);
      ok(pl[0].det && pl[0].det.meet === 'Tsukiji Station exit 1' && pl[0].det.duration === '3 hours' && await page.$eval(pd, d => d.open), `plan place: tour details saved, stays open ${JSON.stringify(pl[0].det)}`);
      ok(page._g.some(u => /places\/ChIJtour\?/.test(u) || /places\/ChIJtour$/.test(u)), 'the plan place pulls its Google photo too');
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // merging two copies keeps every detail and photo
    { const { ctx, page } = await setup(browser); await open(page);
      const m = await page.evaluate(() => window.__ep.bkMerge({ id: 'a', kind: 'hotel', name: 'Hotel Gracery', start: '2027-04-01', end: '2027-04-04', confNo: 'X1', det: { room: 'Double', amen: ['wifi'] }, photos: [{ url: 'https://x/1.jpg' }] },
        { id: 'b', kind: 'hotel', name: 'Hotel Gracery Shinjuku', ref: 'h-g', lat: 1, lon: 2, pin: 1, guess: 1, det: { beds: '1 queen', amen: ['wifi', 'pool'] }, photos: [{ url: 'https://x/1.jpg' }, { g: 'places/h-g/photos/A', by: 'A' }] }));
      ok(m.det.room === 'Double' && m.det.beds === '1 queen' && m.det.amen.length >= 1 && m.photos.length === 2 && m.confNo === 'X1' && m.ref === 'h-g', `merge keeps details + photos ${JSON.stringify(m)}`);
      await ctx.close(); }

    // signed in: a photo goes to Storage (the guest's own folder) — live Supabase, throwaway user
    const patFile = process.env.SUPABASE_PAT_FILE || __dirname + '/../../../../secrets/supabase-pat';
    if (fs.existsSync(patFile)) await liveUpload(browser, fs.readFileSync(patFile, 'utf8').trim()); else console.log('skip live upload (no PAT)');
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

async function liveUpload(browser, PAT) {
  const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key;
  const admin = (path, init = {}) => fetch(SBURL + path, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const EMAIL = `ep-photo-${Date.now().toString(36)}@example.com`; const PASS = 'T' + Math.random().toString(36).slice(2) + 'x9!';
  const u = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }) })).json(); const UID = u.id;
  let url = '';
  try {
    const { ctx, page } = await setup(browser); await open(page, { itin: [{ id: 't1', kind: 'tour', name: 'Fuji tour', start: '2027-04-02T07:30' }] });
    ok(await page.evaluate(async ([e, p]) => { const c = await window.__ep.sb(); const r = await c.auth.signInWithPassword({ email: e, password: p }); localStorage.setItem('ep:signedIn', 'true'); return !!(r.data && r.data.session); }, [EMAIL, PASS]), 'signed in (throwaway user)');
    await page.click('[data-det-ref="bk:t1"] summary'); await page.setInputFiles('[data-ph-add="bk:t1"]', [JPG(1)]);
    await page.waitForFunction((k) => ((JSON.parse(localStorage.getItem('ep:itin:' + k)) || [])[0].photos || []).length === 1, K, { timeout: 20000 }).catch(() => {});
    const p = ((await itin(page))[0].photos || [])[0] || {}; url = p.url || '';
    ok(url.startsWith(`${SBURL}/storage/v1/object/public/event-files/${UID}/trip-`) && !p.local, `uploaded to the guest's own folder ${url.replace(UID, '<uid>')}`);
    const r = await fetch(url); ok(r.ok && /image\/jpeg/.test(r.headers.get('content-type') || ''), `public URL serves the JPEG (${r.status})`);
    ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close();
  } finally {
    if (url) { const path = url.split('/public/event-files/')[1]; await admin('/storage/v1/object/event-files', { method: 'DELETE', body: JSON.stringify({ prefixes: [path] }) }); ok((await fetch(url + '?x=' + Date.now())).status >= 400, 'test photo deleted'); }
    if (UID) { await admin(`/auth/v1/admin/users/${UID}`, { method: 'DELETE' }); ok((await admin(`/auth/v1/admin/users/${UID}`)).status === 404, 'throwaway user deleted'); }
  }
}
