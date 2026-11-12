// Nearby on a phone where Google Maps takes a few seconds to load: the map still opens on the guest's hotel (a view
// asked for before the map exists is applied when it appears — it used to be dropped after a fixed 1.5 s), and the
// place pins on first open are the ones in view and open their card when tapped — no need to switch stops and back.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/map-slow.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
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
  class Marker { constructor(o) { this.o = o; this.on = !!o.map; this.l = {}; window.__markers.push(this); } setMap(m) { this.on = !!m; } addListener(ev, f) { this.l[ev] = f; return { remove() {} }; } }
  class InfoWindow { setContent() {} open() {} }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Size { constructor(w, h) { this.w = w; this.h = h; } }
  window.google = { maps: { Map, Marker, InfoWindow, LatLngBounds, LatLng, Point, Size, SymbolPath: { CIRCLE: 0 }, event: { trigger() {}, addListenerOnce: (o, ev, f) => { const h = on(o, ev, (a) => { h.remove(); f(a); }); return h; } } } };
}
const CFG = { v: 2, type: 'Trip', title: 'Japan slow map', start: '2027-04-02', end: '2027-04-08', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [{ name: 'Tokyo', address: 'Tokyo', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp', from: '2027-04-02', to: '2027-04-05' }, { name: 'Kyoto', address: 'Kyoto', lat: 35.0116, lon: 135.7681, city: 'Kyoto', country: 'Japan', cc: 'jp', from: '2027-04-05', to: '2027-04-08' }],
  tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  // Google Maps JS arrives after 3 s
  await page.route(/maps\.googleapis\.com\/maps\/api\/js/, r => r.fulfill({ contentType: 'text/javascript', body: `setTimeout(() => { (${fakeGoogleMaps.toString()})(); window.__epGmaps(); }, 3000);` }));
  await page.route('https://places.googleapis.com/**', async (r) => { const u = r.request().url(); const b = JSON.parse(r.request().postData() || '{}');
    if (/places\/[^:]+$/.test(u) && r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: u.split('/').pop().split('?')[0], displayName: { text: 'Place card' }, location: { latitude: 35.663, longitude: 139.76 }, formattedAddress: 'Tokyo', photos: [], regularOpeningHours: {} }) });
    if (/searchText/.test(u) && /park hotel/i.test(b.textQuery || '')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: [{ id: 'h1', displayName: { text: 'Park Hotel Tokyo' }, types: ['lodging'], formattedAddress: 'Shiodome', location: { latitude: 35.6631, longitude: 139.7595 } }] }) });
    const c = (b.locationRestriction || b.locationBias || {}).circle; const la = c ? c.center.latitude : 0, lo = c ? c.center.longitude : 0;
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, displayName: { text: `Place ${i}` }, location: { latitude: la + i * 4e-4, longitude: lo }, rating: 4.2, userRatingCount: 9 })) }) }); });
  await page.route(/overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  await page.evaluate((k) => { localStorage.clear(); localStorage.setItem('ep:itin:' + k, JSON.stringify([{ id: 'b1', kind: 'hotel', name: 'Park Hotel Tokyo', address: 'Shiodome', start: '2027-04-02T15:00', end: '2027-04-05T11:00' }])); }, keyOf(CFG));
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), CFG)); await page.waitForSelector('#sec-schedule');
  await page.click('[data-tab-go="nearby"]');
  await page.waitForFunction(() => window.__gmap, null, { timeout: 15000 }); await page.waitForTimeout(800);
  const c = await page.evaluate(() => ({ lat: window.__gmap.c.lat, z: window.__gmap.z }));
  ok(Math.abs(c.lat - 35.6631) < 1e-3 && c.z === 15, `first open, slow map: opens on the hotel (${JSON.stringify(c)})`);
  const pin = await page.evaluate(() => { const ms = window.__markers.filter(m => m.on && m.o.zIndex === 500); return ms.length ? Math.abs(ms[0].o.position.lat - 35.6631) < 3e-3 : false; });
  ok(pin, 'first open: the place pins are around the hotel, in view');
  await page.evaluate(() => { const m = window.__markers.find(m => m.on && m.o.zIndex === 500); m.l.click(); });
  await page.waitForFunction(() => { const d = document.querySelector('#placedlg'); return d && d.open; }, null, { timeout: 5000 }).catch(() => {});
  ok(await page.evaluate(() => { const d = document.querySelector('#placedlg'); return !!(d && d.open); }), 'first open: tapping a pin opens its card');
  ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
