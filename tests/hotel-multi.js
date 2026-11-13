// A route that comes back to a city (Tokyo → Kyoto → Tokyo) has ONE Tokyo in Nearby (one stop chip) holding both of its
// hotels: each pinned and labelled with its dates, chips above the map (All / Hotel A Apr 1–4 / Hotel B Apr 8–10) switch
// between them, re-centering the map and re-anchoring Nearby searches; All shows both (search from the city). The
// Itinerary still lists both Tokyo legs by date, and tapping either opens Tokyo in Nearby. 390 + 320.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/hotel-multi.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const pick = async (page, key, v, box = '[data-ccb="near"]') => { await page.click(`${box} [data-dd="${key}"] [data-dd-btn]`); await page.click(`${box} [data-dd="${key}"] [data-dd-v="${v}"]`); }; // City / Category dropdowns
const cityOpts = (page) => page.$$eval('[data-ccb="near"] [data-dd="city"] [data-dd-v]', bs => bs.map(b => b.textContent));
const cityNow = (page) => page.$eval('[data-ccb="near"] [data-dd="city"] [data-dd-v][aria-selected="true"]', b => b.dataset.ddV);
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
const CFG = { v: 2, type: 'Trip', title: 'Japan loop', start: '2027-04-01', end: '2027-04-10', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 35.6764, 139.65, '2027-04-01', '2027-04-04'), P('Kyoto', 35.0116, 135.7681, '2027-04-04', '2027-04-08'), P('Tokyo', 35.6764, 139.65, '2027-04-08', '2027-04-10')],
  schedule: [{ date: '2027-04-02', time: '', title: 'Shibuya', note: '' }, { date: '2027-04-09', time: '', title: 'Last-day shopping', note: '' }],
  tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const HOT = { 'hotel a': [35.6900, 139.7000], 'hotel b': [35.6600, 139.7300] };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
const near = (a, b, e = 1e-3) => Math.abs(a - b) < e;
(async () => {
  const browser = await chromium.launch();
  for (const w of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(fakeGoogleMaps); const reqs = [];
    await page.route('https://places.googleapis.com/**', async (r) => { const b = JSON.parse(r.request().postData() || '{}'); reqs.push({ url: r.request().url(), b });
      if (/searchText/.test(r.request().url()) && b.textQuery) { const hit = Object.entries(HOT).find(([k]) => b.textQuery.toLowerCase().startsWith(k)); if (hit) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: [{ id: 'h-' + hit[0], displayName: { text: hit[0] }, formattedAddress: 'Tokyo', types: ['lodging'], location: { latitude: hit[1][0], longitude: hit[1][1] } }] }) }); }
      const c = (b.locationRestriction || b.locationBias || {}).circle; const la = c ? c.center.latitude : 0, lo = c ? c.center.longitude : 0;
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: Array.from({ length: 3 }, (_, i) => ({ id: `p-${la.toFixed(3)}-${i}`, displayName: { text: `Place ${i}` }, location: { latitude: la + i * 5e-4, longitude: lo }, rating: 4.1, userRatingCount: 5 })) }) }); });
    await page.route(/overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await page.evaluate((k) => { localStorage.clear(); localStorage.setItem('ep:itin:' + k, JSON.stringify([
      { id: 'b1', kind: 'hotel', name: 'Hotel A', address: 'Shinjuku', start: '2027-04-01T15:00', end: '2027-04-04T11:00' },
      { id: 'b2', kind: 'hotel', name: 'Hotel B', address: 'Ginza', start: '2027-04-08T15:00', end: '2027-04-10T11:00' }])); }, keyOf(CFG));
    await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), CFG) + '&t=nearby'); await page.waitForSelector('[data-gp-body] .place-row', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-hotel-pick]').length === 3, null, { timeout: 8000 }).catch(() => {});
    ok((await cityOpts(page)).join() === 'Tokyo,Kyoto', `@${w} one Tokyo in the City dropdown for both Tokyo legs`);
    const chips = await page.$$eval('[data-hotel-pick]', bs => bs.map(b => b.textContent.replace(/\s+/g, ' ').trim()));
    ok(chips.join('|') === 'All|Hotel A Apr 1–4|Hotel B Apr 8–10', `@${w} hotel chips ${chips.join('|')}`);
    const pins = await page.evaluate(() => window.__markers.filter(m => m.on && m.o.zIndex === 5000).map(m => m.o.label.text).sort());
    ok(pins.join('|') === 'Hotel A · Apr 1–4|Hotel B · Apr 8–10', `@${w} both hotels pinned with dates ${pins.join('|')}`);
    const nb = () => [...reqs].reverse().find(x => /searchNearby/.test(x.url)).b.locationRestriction.circle.center;
    await page.waitForTimeout(300); ok(near(nb().latitude, 35.69), `@${w} search starts at Hotel A`);
    await page.click('[data-hotel-pick="1"]'); await page.waitForTimeout(400);
    ok(near(nb().latitude, 35.66) && await page.evaluate(() => Math.abs(window.__gmap.c.lat - 35.66) < 1e-3), `@${w} Hotel B chip → map + search at Hotel B`);
    ok(/Hotel B/.test(await page.textContent('[data-slot="hotel"] .hb')), `@${w} bar shows Hotel B`);
    await page.click('[data-hotel-pick="-1"]'); await page.waitForTimeout(400);
    const allC = await page.evaluate(() => window.__gmap.c.lat); const pl = await page.evaluate(() => window.__markers.filter(m => m.on && m.o.zIndex === 500).map(m => m.o.position.lat)[0]);
    ok(near(pl, 35.6764) && Math.abs(allC - 35.675) < 2e-3, `@${w} All → both in view, places from the city (${pl}, map ${allC})`);
    if (SHOTS && w === 390) await page.locator('#sec-map').screenshot({ path: `${SHOTS}/hotel-multi-390.png` });
    ok((await overflow(page)) === 0, `@${w} no overflow`);
    // the Itinerary still has both Tokyo legs; the second opens Tokyo in Nearby
    await page.click('[data-tab-go="event"]'); await page.waitForSelector('#sec-schedule .leg');
    ok((await page.$$eval('#sec-schedule .leg-h b', bs => bs.map(b => b.textContent))).join() === 'Tokyo,Kyoto,Tokyo', `@${w} itinerary keeps both Tokyo legs`);
    // (Nearby is a hidden tab now) — go via the itinerary instead
    await page.click('#sec-schedule [data-route-stop="2"]'); await page.waitForTimeout(300);
    ok(await cityNow(page) === '0' && await page.textContent('[data-ccb="near"] [data-dd="city"] .dd-l') === 'Tokyo', `@${w} second Tokyo leg → Tokyo in Nearby`);
    await page.click('[data-tab-go="mytrip"]');
    const sp = await page.textContent('#sec-spots'); ok(/Hotel A[\s\S]*Hotel B/.test(sp), `@${w} My trip lists both Tokyo hotels: ${sp.replace(/\s+/g, ' ').slice(0, 200)}`);
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
