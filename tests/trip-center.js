// A trip whose destination is a whole country ("Japan", a country-centroid point in central Japan) with a Tokyo/Kyoto/Osaka
// route: the Nearby map opens on Tokyo (the first stop, city zoom), Nearby searches start there, the pin is named Tokyo,
// stop chips move the map to that city, and a city with a hotel opens on the hotel. A route filled from a document
// (stops without map points) gets city-level points on load — never the country result Google lists first.
// The Event tab still says "Japan". 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/trip-center.js
//
// Google Maps JS is an in-page stand-in; Places answers are generated.
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
  class Marker { constructor(o) { this.o = o; this.on = !!o.map; window.__markers.push(this); } setMap(m) { this.on = !!m; } addListener() { return { remove() {} }; } }
  class InfoWindow { setContent() {} open() {} }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Size { constructor(w, h) { this.w = w; this.h = h; } }
  window.google = { maps: { Map, Marker, InfoWindow, LatLngBounds, LatLng, Point, Size, SymbolPath: { CIRCLE: 0 }, event: { trigger() {}, addListenerOnce: (o, ev, f) => { const h = on(o, ev, (a) => { h.remove(); f(a); }); return h; } } } };
}
const JAPAN = { name: 'Japan', address: 'Japan', lat: 36.2048, lon: 138.2529, city: '', region: '', country: 'Japan', cc: 'jp' };
const P = (name, lat, lon, from, to) => ({ name, address: name + ', Japan', lat, lon, city: name, region: '', country: 'Japan', cc: 'jp', from, to });
const STOPS = [P('Tokyo', 35.6764, 139.6500, '2027-04-01', '2027-04-04'), P('Kyoto', 35.0116, 135.7681, '2027-04-04', '2027-04-07'), P('Osaka', 34.6937, 135.5023, '2027-04-07', '2027-04-10')];
const CFG = { v: 2, type: 'Trip', title: 'Japan in spring', start: '2027-04-01', end: '2027-04-10', tz: 'Asia/Tokyo', venue: JAPAN, stops: STOPS,
  tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const CITY = { tokyo: [35.6764, 139.6500, 'administrative_area_level_1'], kyoto: [35.0116, 135.7681, 'locality'], osaka: [34.6937, 135.5023, 'locality'] };
const near = (a, b, e = 2e-3) => Math.abs(a - b) < e;

(async () => {
  const browser = await chromium.launch();
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(fakeGoogleMaps); const reqs = [];
    await page.route('https://places.googleapis.com/**', async (r) => {
      const b = JSON.parse(r.request().postData() || '{}'); reqs.push({ url: r.request().url(), b });
      if (/searchText/.test(r.request().url()) && b.textQuery) {
        const k = b.textQuery.toLowerCase().split(',')[0].trim(); const c = CITY[k];
        // Google lists the country first for a loose query: it must not be picked
        const country = { id: 'jp', displayName: { text: 'Japan' }, formattedAddress: 'Japan', types: ['country', 'political'], location: { latitude: 36.2048, longitude: 138.2529 }, addressComponents: [{ longText: 'Japan', shortText: 'JP', types: ['country'] }] };
        const city = c && { id: 'c-' + k, displayName: { text: k[0].toUpperCase() + k.slice(1) }, formattedAddress: k + ', Japan', types: [c[2], 'political'], location: { latitude: c[0], longitude: c[1] }, addressComponents: [{ longText: k, shortText: k, types: ['locality'] }, { longText: 'Japan', shortText: 'JP', types: ['country'] }] };
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: city ? [country, city] : [country] }) });
      }
      const c = (b.locationRestriction || b.locationBias || {}).circle; const la = c ? c.center.latitude : 0, lo = c ? c.center.longitude : 0;
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: Array.from({ length: 3 }, (_, i) => ({ id: `p-${la.toFixed(3)}-${i}`, displayName: { text: `Place ${i}` }, location: { latitude: la + i * 5e-4, longitude: lo }, rating: 4.3, userRatingCount: 50 })) }) });
    });
    await page.route(/overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    return { ctx, page, errors, reqs };
  };
  const nearbyReq = (reqs) => [...reqs].reverse().find(x => /searchNearby/.test(x.url));
  const mapC = (page) => page.evaluate(() => ({ lat: window.__gmap.c.lat, lon: window.__gmap.c.lng, z: window.__gmap.z }));
  // ---- destination "Japan", stops with points ----
  {
    const { ctx, page, errors, reqs } = await mk();
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), CFG);
    await page.goto(BASE + '#e=' + packed + '&t=nearby'); await page.waitForSelector('[data-gp-body] .place-row', { timeout: 15000 }); await page.waitForTimeout(300);
    const c = await mapC(page);
    ok(near(c.lat, 35.6764) && near(c.lon, 139.65) && c.z === 13, `map opens on Tokyo at city zoom, not central Japan ${JSON.stringify(c)}`);
    const nb = nearbyReq(reqs); ok(nb && near(nb.b.locationRestriction.circle.center.latitude, 35.6764), 'Nearby search starts at Tokyo');
    const pin = await page.evaluate(() => window.__markers.filter(m => m.on && m.o.zIndex === 1000).map(m => [m.o.title, m.o.position.lat]));
    ok(pin.length === 1 && pin[0][0] === 'Tokyo' && near(pin[0][1], 35.6764), `the pin is Tokyo ${JSON.stringify(pin)}`);
    await page.click('[data-gp-stop="1"]'); await page.waitForTimeout(300);
    const k = await mapC(page); ok(near(k.lat, 35.0116) && k.z === 13, `Kyoto chip → Kyoto ${JSON.stringify(k)}`);
    // a hotel set for Osaka → Osaka opens on the hotel
    await page.click('[data-gp-stop="2"]'); await page.waitForSelector('[data-hotel-q]');
    await page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('ep:plan:')); }); 
    await page.fill('[data-hotel-q]', 'Osaka'); await page.click('[data-hotel-find]'); await page.waitForSelector('[data-slot="hotel"] .hb');
    await page.waitForTimeout(200); const o = await mapC(page); ok(near(o.lat, 34.6937) && o.z === 15, `Osaka with a hotel → map on the hotel ${JSON.stringify(o)}`);
    await page.click('[data-gp-stop="0"]'); await page.waitForTimeout(200); await page.click('[data-gp-stop="2"]'); await page.waitForTimeout(300);
    const o2 = await mapC(page); ok(near(o2.lat, 34.6937) && o2.z === 15, 'back to Osaka → on its hotel again');
    await page.click('[data-tab-go="event"]');
    ok(/Japan/.test(await page.textContent('.stub')), 'Event tab still says Japan');
    const edit = await page.$eval('.ev-foot a[href^="#edit="]', a => a.getAttribute('href').slice(6));
    const back = await page.evaluate((x) => window.__ep.unpackEvent(x).venue, edit);
    ok(back.name === 'Japan' && near(back.lat, 36.2048), 'Edit a copy keeps the page as written');
    ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  // ---- document-filled route: stops without points → city-level points on load ----
  {
    const { ctx, page, errors } = await mk();
    const bare = { ...CFG, stops: STOPS.map(s => ({ name: s.name, from: s.from, to: s.to })) };
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), bare);
    await page.goto(BASE + '#e=' + packed + '&t=nearby');
    await page.waitForFunction(() => window.__gmap && Math.abs(window.__gmap.c.lat - 35.6764) < 2e-3, null, { timeout: 15000 }).catch(() => {});
    const c = await mapC(page); ok(near(c.lat, 35.6764) && near(c.lon, 139.65), `stops found by city; map on Tokyo ${JSON.stringify(c)}`);
    ok((await page.$$eval('[data-gp-stop]', bs => bs.map(b => b.textContent))).join() === 'Tokyo,Kyoto,Osaka', 'stop chips for the found cities');
    const pts = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ep:sgeo:')).map(k => JSON.parse(localStorage.getItem(k))).map(x => [x.name, x.lat]));
    ok(pts.length === 3 && pts.every(([, la]) => la !== 36.2048), `never the country point ${JSON.stringify(pts)}`);
    ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  // ---- unit: a document-filled route through docApply gets city points ----
  {
    const { ctx, page } = await mk();
    const st = await page.evaluate(async (c) => (await window.__ep.docApply(window.__ep.unpackEvent(window.__ep.packEvent({ ...c, stops: [] })), ['Tokyo', 'Kyoto'].map(title => ({ sec: 'route', title, country: 'Japan', date: '', end: '' })))).stops.map(s => [s.name, s.lat]), CFG);
    ok(st.length === 2 && near(st[0][1], 35.6764) && near(st[1][1], 35.0116), `docApply: city points ${JSON.stringify(st)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
