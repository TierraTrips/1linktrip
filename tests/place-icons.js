// Category icons come from each place's own Google type, not the chip that found it: a Cafés search that also returns a
// museum with a café, a hotel with a bar, a mall and a pub shows each with ITS icon (Sights, Hotels, Shopping, Bars), in
// the list and on the map, whichever chip (or text search) is active. Explicit type table (primaryType first, then
// types[]); a word-boundary keyword guess only when Google gives no usable type ("Barcelona" is not a bar). 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/place-icons.js
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs'); const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const COLORS = Object.fromEntries([...fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').matchAll(/\['(\w+)', '[^']+', '(#[0-9A-F]{6})'\]/g)].map(m => [m[2], m[1]]));
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
const CFG = { v: 2, type: 'Trip', title: 'Tokyo icons', start: '2027-04-01', end: '2027-04-04', tz: 'Asia/Tokyo', venue: { name: 'Ueno', address: 'Tokyo', lat: 35.7141, lon: 139.7774, city: 'Tokyo', country: 'Japan', cc: 'jp' }, tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false } };
// real-ish Places API (New) answers: primaryType + types as Google returns them
const P = (id, name, primaryType, types, dLat, label) => ({ id, displayName: { text: name }, primaryType, primaryTypeDisplayName: label ? { text: label } : undefined, types, location: { latitude: 35.7141 + dLat, longitude: 139.7774 }, rating: 4.4, userRatingCount: 900 });
const FIX = [
  P('museum', 'Tokyo National Museum', 'museum', ['museum', 'cafe', 'tourist_attraction', 'point_of_interest', 'establishment'], 0.001, 'Museum'),
  P('starbucks', 'Starbucks Coffee Ueno Park', 'coffee_shop', ['coffee_shop', 'cafe', 'food', 'store', 'point_of_interest', 'establishment'], 0.0015, 'Coffee Shop'),
  P('hotel', 'Hotel Ueno Bar & Lounge', 'hotel', ['hotel', 'lodging', 'bar', 'restaurant', 'point_of_interest', 'establishment'], 0.002, 'Hotel'),
  P('mall', 'Shibuya 109', 'shopping_mall', ['shopping_mall', 'clothing_store', 'store', 'point_of_interest', 'establishment'], 0.0025, 'Shopping Mall'),
  P('pub', 'The Aldgate', 'pub', ['pub', 'bar', 'restaurant', 'food', 'point_of_interest', 'establishment'], 0.003, 'Pub'),
  P('tapas', 'Barcelona Tapas Ueno', 'spanish_restaurant', ['spanish_restaurant', 'restaurant', 'bar', 'food', 'point_of_interest', 'establishment'], 0.0035, 'Spanish Restaurant'),
  P('notype', 'Kissa Untyped', '', [], 0.004, ''),
];
const WANT = { museum: 'sights', starbucks: 'cafes', hotel: 'hotels', mall: 'shopping', pub: 'bars', tapas: 'restaurants' };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(fakeGoogleMaps); const masks = [];
  await page.route('https://places.googleapis.com/**', async (r) => { masks.push(r.request().headers()['x-goog-fieldmask'] || ''); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: FIX }) }); });
  await page.route(/overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), CFG) + '&t=nearby'); await page.waitForSelector('[data-gp-body] .place-row', { timeout: 15000 });
  ok(masks.some(m => /places\.types/.test(m) && /places\.primaryType\b/.test(m)), 'the list request asks Google for primaryType + types');
  const icons = async () => {
    const list = await page.$$eval('[data-gp-body] .place-row', bs => bs.map(b => [b.dataset.gplace, (b.querySelector('.cci').getAttribute('style').match(/#[0-9A-F]{6}/i) || [''])[0].toUpperCase()]));
    const map = await page.evaluate(() => window.__markers.filter(m => m.on && (m.o.zIndex || 500) === 500 && m.o.icon && m.o.icon.url).map(m => [m.o.title, (decodeURIComponent(m.o.icon.url).match(/fill="(#[0-9A-F]{6})" stroke/i) || [, ''])[1].toUpperCase()]));
    const names = Object.fromEntries(FIX.map(p => [p.displayName.text, p.id]));
    return { list: Object.fromEntries(list.map(([id, c]) => [id, COLORS[c] || c])), map: Object.fromEntries(map.map(([t, c]) => [names[t], COLORS[c] || c])) };
  };
  for (const chip of ['cafes', 'bars', 'restaurants', 'sights', 'shopping', 'hotels', 'q:ramen']) {
    if (chip.startsWith('q:')) { await page.fill('[data-gp-q]', chip.slice(2)); await page.click('[data-gp-go]'); }
    else if (await page.getAttribute(`[data-ccb="near"] [data-dd="cat"] [data-dd-v="${chip}"]`, 'aria-pressed') !== 'true') await page.click(`[data-ccb="near"] [data-dd="cat"] [data-dd-v="${chip}"]`);
    await page.waitForTimeout(500); await page.waitForSelector('[data-gp-body] .place-row');
    const ic = await icons(); const bad = Object.entries(WANT).filter(([id, k]) => ic.list[id] !== k || ic.map[id] !== k);
    ok(bad.length === 0 && Object.keys(ic.map).length === FIX.length, `${chip}: each place keeps its own icon in list + map ${bad.length ? JSON.stringify(ic) : ''}`);
    ok(chip.startsWith('q:') ? ic.list.notype === 'transport' /* neutral gray: no type, no chip */ : ic.list.notype === chip && ic.map.notype === chip, `${chip}: a place with no Google type falls back to the chip, else neutral (${ic.list.notype})`);
  }
  // pure categorizer checks (no types → keyword with word boundaries: 'Barcelona Tapas' is not a bar)
  const kw = await page.evaluate(() => ['Barcelona Tapas', 'Hotel Bar', 'Museum Café', 'Hotels near Ueno', 'Ueno Zoo'].map(s => window.__ep.ccCatOfTypes([], s)));
  ok(kw.join() === ',hotels,cafes,hotels,tours', `keyword fallback: ${kw.join()}`);
  const ty = await page.evaluate(() => [['museum', 'cafe'], ['', 'coffee_shop'], ['hotel', 'bar'], ['ramen_restaurant'], ['department_store'], ['night_club'], ['amusement_park'], ['buddhist_temple'], ['point_of_interest', 'establishment']].map(t => window.__ep.ccCatOfTypes(t, '')));
  ok(ty.join() === 'sights,cafes,hotels,restaurants,shopping,bars,tours,sights,', `types table: ${ty.join()}`);
  ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
  await ctx.close(); await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
