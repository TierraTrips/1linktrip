// Replacing and removing a hotel (Dylan 11/24: "It's still keeping old hotel selection when I replace it with a new one
// via a pdf" / "There needs to be a way simpler option to remove a hotel").
//  Guest: a hotel booking from a PDF (Add a booking → upload) for nights another hotel already has in that city replaces
//  it — My trip, the hotel sheet, Nearby's "Your hotel" bar and the map pin all show the new hotel (a map pick is
//  replaced the same way). Remove hotel (trash + label) on the My trip card, the hotel sheet and the Nearby bar takes it
//  out of the bookings, the selection and the map in one tap, with Undo; the id is remembered so account sync can't
//  bring it back.
//  Organizer: a document with a new hotel's check-in replaces the old hotel's check-in + check-out at that stop (the
//  review says "Replaces <old>"); a different stop / other nights keep both. Builder → Itinerary: a hotel's row has
//  "Remove hotel", which takes its check-in and check-out together, with Undo.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/hotel-replace.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
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
  class Marker { constructor(o) { this.o = o; this.on = !!o.map; window.__markers.push(this); } setMap(m) { this.on = !!m; } setLabel(l) { this.o.label = l; } addListener(ev, f) { return on(this, ev, f); } }
  class InfoWindow { setContent() {} open() {} close() {} addListener(ev, f) { return on(this, ev, f); } }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Size { constructor(w, h) { this.w = w; this.h = h; } }
  window.google = { maps: { Map, Marker, InfoWindow, LatLngBounds, LatLng, Point, Size, SymbolPath: { CIRCLE: 0 }, event: { trigger() {}, addListenerOnce: (o, ev, f) => { const h = on(o, ev, (a) => { h.remove(); f(a); }); return h; } } } };
}
const P = (name, lat, lon, from, to) => ({ name, address: name + ', Japan', lat, lon, city: name, country: 'Japan', cc: 'jp', from, to });
const CFG = { v: 2, type: 'Trip', title: 'Hotel swap trip', start: '2027-04-01', end: '2027-04-08', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 35.6764, 139.65, '2027-04-01', '2027-04-04'), P('Kyoto', 35.0116, 135.7681, '2027-04-04', '2027-04-08')], schedule: [],
  tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const HOT = { 'park hotel tokyo': [35.6627, 139.7600], 'hotel gracery shinjuku': [35.6950, 139.7020], 'hotel kanra kyoto': [34.9990, 135.7590] };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
const K = keyOf(CFG);
const AI = (name, start, end, conf) => ({ type: 'hotel', name, provider: '', start, end, address: 'Tokyo', confirmation: conf, booked_through: '', flight_number: '', from: '', to: '', note: '', link: '' });
async function setup(browser, w = 390) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.addInitScript(fakeGoogleMaps);
  await page.route('https://places.googleapis.com/**', async (r) => { const b = JSON.parse(r.request().postData() || '{}');
    if (/searchText/.test(r.request().url()) && b.textQuery) { const hit = Object.entries(HOT).find(([k]) => b.textQuery.toLowerCase().startsWith(k)); if (hit) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: [{ id: 'h-' + hit[0].replace(/ /g, '-'), displayName: { text: hit[0].replace(/\b\w/g, c => c.toUpperCase()) }, formattedAddress: '1-1 Somewhere, Tokyo', types: ['lodging'], location: { latitude: hit[1][0], longitude: hit[1][1] } }] }) }); }
    const c = (b.locationRestriction || b.locationBias || {}).circle; const la = c ? c.center.latitude : 0, lo = c ? c.center.longitude : 0;
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: [{ id: `p-${la.toFixed(3)}`, displayName: { text: 'Place' }, location: { latitude: la, longitude: lo }, rating: 4.1, userRatingCount: 5 }] }) }); });
  await page.route(/overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon|functions\/v1|supabase\.co/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  return { ctx, page };
}
const open = async (page, tab, seed) => {
  await page.evaluate(([k, s]) => { localStorage.clear(); for (const [n, v] of Object.entries(s || {})) localStorage.setItem('ep:' + n + ':' + k, JSON.stringify(v)); }, [K, seed]);
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), CFG) + '&t=' + tab); await page.waitForSelector(tab === 'nearby' ? '[data-slot="hotel"]' : '#sec-itinerary');
};
const itin = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k) || '[]'), K);
const gone = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem('ep:gone:' + k) || '[]'), K);
const importAI = async (page, items) => { await page.click('[data-tab-go="mytrip"]'); await page.click('#sec-itinerary [data-itin-add]');
  await page.evaluate((xs) => document.querySelector('.ev')._itinReview(window.__ep.aiItemsToBookings(xs)), items); await page.waitForTimeout(100); await page.click('[data-rv-save]'); await page.waitForTimeout(400); };
const toNearby = async (page) => { await page.click('[data-tab-go="nearby"]'); await page.waitForSelector('[data-slot="hotel"]'); await page.waitForTimeout(900); };
const bar = async (page) => (await page.textContent('[data-slot="hotel"]')).replace(/\s+/g, ' ').trim();
const hotelPins = (page) => page.evaluate(() => window.__markers.filter(m => m.on && m.o.zIndex === 5000).map(m => m.o.title));
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

(async () => {
  const browser = await chromium.launch();
  try {
    // 1 — Dylan's case: a PDF for hotel A, then a PDF for hotel B, same Tokyo nights → B is the hotel everywhere
    { const { ctx, page } = await setup(browser);
      await open(page, 'mytrip');
      await importAI(page, [AI('Park Hotel Tokyo', '2027-04-01T15:00', '2027-04-04T11:00', 'PH-1')]);
      await toNearby(page);
      ok(/Park Hotel Tokyo/.test(await bar(page)), `before: hotel bar shows A (${await bar(page)})`);
      await importAI(page, [AI('Hotel Gracery Shinjuku', '2027-04-01T15:00', '2027-04-04T11:00', 'GR-2')]);
      const xs = await itin(page);
      ok(xs.length === 1 && xs[0].name === 'Hotel Gracery Shinjuku' && xs[0].confNo === 'GR-2', `one hotel booking, the new one ${JSON.stringify(xs.map(x => x.name))}`);
      ok(/Replaced Park Hotel Tokyo with Hotel Gracery Shinjuku/.test(await page.textContent('#toast')), 'toast says what was replaced');
      ok(!(await page.$('.bk-ask')), 'no question left waiting');
      const cards = await page.$$eval('#sec-itinerary .bookings li', ls => ls.map(l => l.textContent));
      ok(cards.length === 1 && /Gracery/.test(cards[0]), `My trip → bookings: the new hotel only (${cards.length})`);
      await shot(page, 'replace-mytrip');
      await toNearby(page);
      const b = await bar(page); ok(/Hotel Gracery Shinjuku/.test(b) && !/Park Hotel/.test(b), `Nearby "Your hotel" = the new one (${b})`);
      const pins = await hotelPins(page); ok(pins.length === 1 && /Gracery/.test(pins[0]), `one hotel pin, the new hotel (${pins})`);
      const c = await page.evaluate(() => window.__gmap && window.__gmap.c); ok(c && Math.abs(c.lat - 35.695) < 1e-3, `map centered on the new hotel ${JSON.stringify(c)}`);
      await shot(page, 'replace-nearby');
      await page.click('[data-tab-go="mytrip"]'); await page.click('#sec-itinerary .bk-go'); await page.waitForSelector('dialog.ds-sheet[open]');
      ok(/Hotel Gracery Shinjuku/.test(await page.textContent('dialog.ds-sheet .ds-t')), 'hotel sheet = the new hotel');
      await page.click('dialog.ds-sheet [data-ds-close]'); await page.waitForTimeout(200);
      // Keep both from the toast brings A back next to B (B stays the selected one)
      await importAI(page, [AI('Park Hotel Tokyo', '2027-04-01T15:00', '2027-04-04T11:00', 'PH-1')]);
      ok((await itin(page)).map(x => x.name).join() === 'Park Hotel Tokyo', 'and back again: the newest PDF wins');
      await page.click('#toast .toast-act'); await page.waitForTimeout(300);
      ok((await itin(page)).map(x => x.name).sort().join('|') === 'Hotel Gracery Shinjuku|Park Hotel Tokyo' && !(await gone(page)).includes((await itin(page)).find(x => /Gracery/.test(x.name)).id), 'Keep both → both, and the old id is wanted again');
      await toNearby(page); ok(/Your hotel in Tokyo.*Park Hotel Tokyo/.test(await bar(page).then(x => x.replace(/All.*?(?=Your hotel)/, ''))), `newest stays selected (${await bar(page)})`);
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 2 — a map pick, then a PDF for a different hotel on those nights → replaced; another city's hotel is untouched
    { const { ctx, page } = await setup(browser);
      await open(page, 'nearby', { itin: [
        { id: 'pk1', kind: 'hotel', name: 'Park Hotel Tokyo', address: 'Shiodome', ref: 'h-park-hotel-tokyo', lat: 35.6627, lon: 139.76, stopId: '', pin: 1, guess: 1, start: '2027-04-01', end: '2027-04-04' },
        { id: 'ky1', kind: 'hotel', name: 'Hotel Kanra Kyoto', address: 'Kyoto', lat: 34.999, lon: 135.759, start: '2027-04-04T15:00', end: '2027-04-08T11:00', confNo: 'KY' }] });
      await page.waitForTimeout(800);
      ok(/Park Hotel Tokyo/.test(await bar(page)), 'map pick is the Tokyo hotel');
      await importAI(page, [AI('Hotel Gracery Shinjuku', '2027-04-02T15:00', '2027-04-04T11:00', 'GR-2')]);
      const names = (await itin(page)).map(x => x.name).sort();
      ok(names.join('|') === 'Hotel Gracery Shinjuku|Hotel Kanra Kyoto', `map pick replaced, Kyoto kept (${names})`);
      await toNearby(page); ok(/Hotel Gracery Shinjuku/.test(await bar(page)), `Tokyo bar follows (${await bar(page)})`);
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 3 — Remove hotel: one tap on the My trip card, the hotel sheet or the Nearby bar; Undo; never comes back
    for (const w of [390, 320]) {
      const { ctx, page } = await setup(browser, w);
      const seed = { itin: [{ id: 'gr1', kind: 'hotel', name: 'Hotel Gracery Shinjuku', address: 'Kabukicho', lat: 35.695, lon: 139.702, start: '2027-04-01T15:00', end: '2027-04-04T11:00', confNo: 'GR-2' }] };
      // My trip card
      await open(page, 'mytrip', seed);
      const rm = await page.$('#sec-itinerary [data-bk-rm="gr1"]');
      ok(!!rm && /Remove hotel/.test(await rm.textContent()) && !!(await rm.$('svg.rm-ic')), `@${w} My trip card: trash + "Remove hotel"`);
      ok((await overflow(page)) === 0, `@${w} card fits`);
      await shot(page, `remove-card-${w}`);
      await rm.click(); await page.waitForTimeout(300);
      ok((await itin(page)).length === 0 && (await page.$$('#sec-itinerary .bookings li')).length === 0, `@${w} one tap → gone from bookings (no confirm dialog)`);
      ok(/Removed Hotel Gracery Shinjuku/.test(await page.textContent('#toast')) && /Undo/.test(await page.textContent('#toast .toast-act')), `@${w} toast: Removed … Undo`);
      ok((await gone(page)).includes('gr1'), `@${w} id remembered so sync can't resurrect it`);
      await page.click('#toast .toast-act'); await page.waitForTimeout(300);
      ok((await itin(page)).map(x => x.id).join() === 'gr1' && !(await gone(page)).includes('gr1'), `@${w} Undo puts it back (and forgets the gone id)`);
      // hotel sheet
      await page.click('#sec-itinerary .bk-go'); await page.waitForSelector('dialog.ds-sheet[open]');
      const srm = await page.$('dialog.ds-sheet [data-ds-rmbk="gr1"]'); ok(!!srm && /Remove hotel/.test(await srm.textContent()), `@${w} hotel sheet: Remove hotel`);
      await page.waitForTimeout(500); await shot(page, `remove-sheet-${w}`);
      await srm.click(); await page.waitForTimeout(400);
      ok(!(await page.$('dialog.ds-sheet[open]')) && (await itin(page)).length === 0, `@${w} sheet Remove → sheet closes, hotel gone`);
      await page.click('#toast .toast-act'); await page.waitForTimeout(300);
      // Nearby bar: the selection + the pin go too
      await toNearby(page);
      ok((await hotelPins(page)).length === 1, `@${w} pin before`);
      const brm = await page.$('[data-slot="hotel"] [data-hotel-del="gr1"]'); ok(!!brm && /Remove hotel/.test(await brm.textContent()), `@${w} Nearby bar: Remove hotel on a booked hotel (not only map picks)`);
      ok((await overflow(page)) === 0, `@${w} bar fits`);
      await shot(page, `remove-bar-${w}`);
      await brm.click(); await page.waitForTimeout(500);
      ok((await itin(page)).length === 0 && (await hotelPins(page)).length === 0 && !/Gracery/.test(await bar(page)), `@${w} bar Remove → no hotel selected, no pin (${await bar(page)})`);
      // reload: still gone (a pull from the account skips gone ids — see syncPull)
      await page.reload(); await page.waitForSelector('[data-slot="hotel"]'); await page.waitForTimeout(500);
      ok((await itin(page)).length === 0 && !/Gracery/.test(await bar(page)), `@${w} still gone after reload`);
      ok(page._err.length === 0, `@${w} no page errors ${page._err}`); await ctx.close();
    }

    // 3b — every hotel row in My trip carries its own Remove: Your itinerary and Saved spots
    { const { ctx, page } = await setup(browser);
      const seed = { itin: [{ id: 'gr1', kind: 'hotel', name: 'Hotel Gracery Shinjuku', address: 'Kabukicho', lat: 35.695, lon: 139.702, start: '2027-04-01T15:00', end: '2027-04-04T11:00', confNo: 'GR-2' }] };
      await open(page, 'mytrip', seed);
      const pr = await page.$('#sec-plan [data-bk-rm="gr1"]'); ok(!!pr && /Remove/.test(await pr.textContent()) && !!(await pr.$('svg.rm-ic')), 'Your itinerary: hotel row has trash + Remove');
      const sp = await page.$('#sec-spots [data-bk-rm="gr1"]'); ok(!!sp && /Remove/.test(await sp.textContent()), 'Saved spots: hotel row has trash + Remove');
      ok((await overflow(page)) === 0, 'rows fit');
      if (SHOTS) await page.locator('#sec-plan').screenshot({ path: `${SHOTS}/remove-itinerary-row.png` });
      if (SHOTS) await page.locator('#sec-spots').screenshot({ path: `${SHOTS}/remove-spots-row.png` });
      await pr.click(); await page.waitForTimeout(400);
      ok((await itin(page)).length === 0 && !(await page.$('[data-bk-rm="gr1"]')) && !(await page.$('dialog.ds-sheet[open]')), 'itinerary Remove → gone everywhere, no sheet opened');
      await page.click('#toast .toast-act'); await page.waitForTimeout(300);
      await page.click('#sec-spots [data-bk-rm="gr1"]'); await page.waitForTimeout(400);
      ok((await itin(page)).length === 0, 'saved spots Remove → gone');
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 4 — organizer: a document's new hotel replaces the old one at that stop (check-in + check-out), nothing else
    { const { ctx, page } = await setup(browser);
      const r = await page.evaluate(async (cfg0) => { const E = window.__ep;
        const cfg = E.normalize({ ...cfg0, schedule: [
          { date: '2027-04-01', time: '15:00', title: 'Check in: Park Hotel Tokyo', note: 'Conf PH-1', kind: 'reservation' }, { date: '2027-04-02', time: '09:00', title: 'Tsukiji market', note: '' },
          { date: '2027-04-04', time: '11:00', title: 'Check out: Park Hotel Tokyo', note: '' }, { date: '2027-04-04', time: '15:00', title: 'Check in: Hotel Kanra Kyoto', note: '', kind: 'reservation' }] });
        const doc = { title: 'Booking', type: 'Trip', start_date: '2027-04-01', end_date: '2027-04-04', stops: [], notes: [], sections: [],
          schedule: [{ date: '2027-04-01', time: '15:00', title: 'Check in: Hotel Gracery Shinjuku', note: 'Conf GR-2', kind: 'reservation' }, { date: '2027-04-04', time: '11:00', title: 'Check out: Hotel Gracery Shinjuku', note: '', kind: 'reservation' }] };
        const next = await E.docApply(cfg, E.docItems(cfg, doc, 'schedule'));
        const again = await E.docApply(next, E.docItems(next, doc, 'schedule'));
        const two = E.normalize({ ...cfg0, schedule: [{ date: '2027-04-01', time: '15:00', title: 'Check in: Park Hotel Tokyo', note: '', kind: 'reservation' }, { date: '2027-04-01', time: '15:00', title: 'Check in: Hotel Gracery Shinjuku', note: '', kind: 'reservation' }] });
        const healed = await E.docApply(two, E.docItems(two, doc, 'schedule'));
        return { sched: next.schedule.map(x => x.title), hotels: E.hotelsNow(next).map(hs => hs.map(h => h.name)), again: again.schedule.length, healed: healed.schedule.map(x => x.title) }; }, CFG);
      ok(r.sched.join('|') === 'Tsukiji market|Check in: Hotel Kanra Kyoto|Check in: Hotel Gracery Shinjuku|Check out: Hotel Gracery Shinjuku', `old Tokyo check-in + check-out replaced, Kyoto + activities kept: ${r.sched.join(' | ')}`);
      ok(JSON.stringify(r.hotels) === JSON.stringify([['Hotel Gracery Shinjuku'], ['Hotel Kanra Kyoto']]), `page hotels per stop ${JSON.stringify(r.hotels)}`);
      ok(r.again === 4, 'uploading the same document twice changes nothing');
      ok(r.healed.join('|') === 'Check in: Hotel Gracery Shinjuku|Check out: Hotel Gracery Shinjuku', `a page already holding both hotels heals on re-upload: ${r.healed.join(' | ')}`);
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 5 — organizer builder: the hotel row's "Remove hotel" takes check-in + check-out together, with Undo
    { const { ctx, page } = await setup(browser);
      const cfg = { ...CFG, schedule: [{ date: '2027-04-01', time: '15:00', title: 'Check in: Park Hotel Tokyo', note: '', kind: 'reservation' }, { date: '2027-04-02', time: '09:00', title: 'Tsukiji market', note: '' }, { date: '2027-04-04', time: '11:00', title: 'Check out: Park Hotel Tokyo', note: '' }] };
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + '#edit=' + await page.evaluate((c) => window.__ep.packEvent(c), cfg)); await page.waitForSelector('[data-card="schedule"]');
      await page.click('[data-card="schedule"]'); await page.waitForSelector('#sheet[open] [data-sdel]');
      const labels = await page.$$eval('#sheet [data-sdel]', bs => bs.map(b => b.textContent.trim()));
      ok(labels.join('|') === 'Remove hotel|Remove|Remove', `builder rows: ${labels.join(' | ')}`);
      await shot(page, 'builder-remove-hotel');
      await page.click('#sheet [data-sdel-hotel]'); await page.waitForTimeout(500);
      const left = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).schedule.map(x => x.title));
      ok(left.join('|') === 'Tsukiji market', `check-in + check-out gone (${left})`);
      ok(/Removed Park Hotel Tokyo/.test(await page.textContent('#undo')), 'Undo bar');
      await page.click('#undo button'); await page.waitForTimeout(500);
      const back = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).schedule.map(x => x.title));
      ok(back.length === 3 && back[0] === 'Check in: Park Hotel Tokyo', `Undo restores both (${back})`);
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 6 — organizer builder, wedding: the room block's hotel has a plainly labelled Remove (hotel + code + link + date), Undo
    { const { ctx, page } = await setup(browser);
      const wed = { v: 2, type: 'Wedding', title: 'Maya & Leo', start: '2027-03-12T16:00', venue: null, x: { Wedding: { blockHotel: 'Hotel Esencia', blockCode: 'MAYALEO27', blockBy: '2027-01-15', blockUrl: 'https://example.com/block' } } };
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + '#edit=' + await page.evaluate((c) => window.__ep.packEvent(c), wed)); await page.waitForSelector('[data-card="block"]');
      await page.click('[data-card="block"]'); await page.waitForSelector('#sheet[open] [data-b="rm-block"]');
      ok(/^Remove Hotel Esencia$/.test((await page.textContent('#sheet [data-b="rm-block"]')).trim()), 'room block card: Remove <hotel>');
      await shot(page, 'builder-remove-block');
      await page.click('#sheet [data-b="rm-block"]'); await page.waitForTimeout(500);
      const x = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).x.Wedding || {});
      ok(!x.blockHotel && !x.blockCode && !x.blockBy && !x.blockUrl, `room block cleared ${JSON.stringify(x)}`);
      await page.click('#undo button'); await page.waitForTimeout(500);
      const y = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).x.Wedding || {});
      ok(y.blockHotel === 'Hotel Esencia' && y.blockCode === 'MAYALEO27', 'Undo restores it');
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }
  } catch (e) { console.error(e); fails.push(String(e)); }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
