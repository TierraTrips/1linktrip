// Nearby's Category dropdown toggles: picking the active category again (Restaurants, Cafés, Bars…) deselects it, clears
// its list and pins and leaves just the map (venue, hotel, saved spots stay) and the search box; no category is a valid
// state; picking one again loads it. The default on open is unchanged. 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/category-toggle.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const pick = async (page, key, v, box = '[data-ccb="near"]') => { await page.click(`${box} [data-dd="${key}"] [data-dd-btn]`); await page.click(`${box} [data-dd="${key}"] [data-dd-v="${v}"]`); }; // City / Category dropdowns
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
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
const CFG = { v: 2, type: 'Party', title: 'Dinner in Lisbon', start: '2027-05-14T19:00', tz: 'Europe/Lisbon', venue: { name: 'Praça do Comércio', address: 'Lisbon', lat: 38.7075, lon: -9.1364, city: 'Lisbon', country: 'Portugal', cc: 'pt' }, tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: false, packing: false } };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(fakeGoogleMaps); const reqs = [];
  await page.route('https://places.googleapis.com/**', async (r) => { const b = JSON.parse(r.request().postData() || '{}'); reqs.push(b); const c = (b.locationRestriction || b.locationBias || {}).circle;
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}-${(b.includedTypes || [b.textQuery]).join()}`, displayName: { text: `Place ${i}` }, location: { latitude: c.center.latitude + i * 4e-4, longitude: c.center.longitude }, rating: 4.4, userRatingCount: 9 })) }) }); });
  await page.route(/overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), CFG) + '&t=nearby'); await page.waitForSelector('[data-gp-body] .place-row', { timeout: 15000 });
  const pins = () => page.evaluate(() => window.__markers.filter(m => m.on && (m.o.zIndex || 500) === 500).length);
  const catLabel = () => page.textContent('[data-ccb="near"] [data-dd="cat"] .dd-l');
  const selected = () => page.$$eval('[data-ccb="near"] [data-dd="cat"] [data-dd-v][aria-selected="true"]', bs => bs.map(b => b.dataset.ddV));
  ok(await catLabel() === 'Restaurants' && (await selected()).join() === 'restaurants' && await pins() === 4, 'opens on Restaurants as before');
  const n0 = reqs.length;
  await pick(page, 'cat', 'restaurants'); await page.waitForTimeout(200);
  ok((await selected()).length === 0 && await catLabel() === 'Category', 'picking the active category deselects it');
  ok(!(await page.$('[data-gp-body] .place-row')) && await pins() === 0, 'its list and pins are gone');
  ok(/Pick a category or search/.test(await page.textContent('[data-gp-body]')) && reqs.length === n0, 'no search sent; a hint instead');
  ok(await page.evaluate(() => window.__markers.some(m => m.on && m.o.zIndex === 1000)), 'the venue pin stays');
  ok(await page.$eval('[data-ccb="near"] [data-cc-filters]', b => b.disabled), 'filters off with no category');
  if (SHOTS) await page.locator('#sec-food').screenshot({ path: `${SHOTS}/cat-none-390.png` });
  await pick(page, 'cat', 'cafes'); await page.waitForSelector('[data-gp-body] .place-row');
  ok((await selected()).join() === 'cafes' && await catLabel() === 'Cafés' && await pins() === 4, 'another category loads its places');
  ok(reqs.at(-1).includedTypes && reqs.at(-1).includedTypes.includes('cafe'), 'Cafés asks Google for cafés');
  await pick(page, 'cat', 'cafes'); await page.waitForTimeout(200);
  await page.fill('[data-gp-q]', 'pastel de nata'); await page.click('[data-gp-go]'); await page.waitForSelector('[data-gp-body] .place-row');
  ok(reqs.at(-1).textQuery && /pastel de nata/.test(reqs.at(-1).textQuery), 'the search box still works with no category');
  ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
