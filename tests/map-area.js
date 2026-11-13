// Nearby map "Search this area": after the guest pans/zooms away from what was searched, a button appears on the map;
// tapping it searches inside the current view (Google Places locationRestriction circle = the map's bounds center and
// half-diagonal, not the venue) for whichever category/filter is chosen; it hides until the next real move; repeated pans
// keep working; small nudges don't show it; changing category after an area search stays in that area; trip stop chips
// reset the area. The OpenStreetMap fallback (no Google) re-queries Overpass around the new center. 390 + 320.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/map-area.js
//
// Google Maps JS is replaced by a small in-page stand-in (pan = setCenter + idle); Places/Overpass answers are generated.
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const pick = async (page, key, v, box = '[data-ccb="near"]') => { await page.click(`${box} [data-dd="${key}"] [data-dd-v="${v}"]`); }; // tap a city tab / category chip
const selLabel = (page, key, box = '[data-ccb="near"]') => page.$$eval(`${box} [data-dd="${key}"] [aria-selected="true"], ${box} [data-dd="${key}"] [aria-pressed="true"]`, bs => bs.map(b => (b.querySelector('span:not(.cci)') || b).textContent).join());
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
    // the visible box: ~0.01° tall at zoom 15, halving per zoom level
    getBounds() { const h = 0.006 * Math.pow(2, 15 - this.z), w = h * 0.6; const b = new LatLngBounds(); b.extend({ lat: this.c.lat - h, lng: this.c.lng - w }); b.extend({ lat: this.c.lat + h, lng: this.c.lng + w }); return b; }
    setOptions() {}
  }
  class Marker { constructor(o) { this.o = o; } setMap() {} addListener() { return { remove() {} }; } }
  class InfoWindow { setContent() {} open() {} }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Size { constructor(w, h) { this.w = w; this.h = h; } }
  window.google = { maps: { Map, Marker, InfoWindow, LatLngBounds, LatLng, Point, Size, SymbolPath: { CIRCLE: 0 }, event: { trigger() {}, addListenerOnce: (o, ev, f) => { const h = on(o, ev, (a) => { h.remove(); f(a); }); return h; } } } };
}

(async () => {
  const browser = await chromium.launch();
  const mk = async (w, { google = true } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    const places = []; const overpass = [];
    if (google) await page.addInitScript(fakeGoogleMaps);
    else await page.route('**/google-config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.EP_GOOGLE = { key: "" };' }));
    await page.route('https://places.googleapis.com/**', async (r) => {
      const b = JSON.parse(r.request().postData() || '{}'); places.push({ url: r.request().url(), b });
      const c = (b.locationRestriction || b.locationBias || {}).circle; const la = c ? c.center.latitude : 0, lo = c ? c.center.longitude : 0;
      const tag = (b.includedTypes || [b.textQuery || 'x']).join('+');
      const out = Array.from({ length: 4 }, (_, i) => ({ id: `p-${la.toFixed(3)}-${lo.toFixed(3)}-${tag}-${i}`, displayName: { text: `${tag} ${la.toFixed(3)},${lo.toFixed(3)} #${i}` }, location: { latitude: la + i * 0.0004, longitude: lo + i * 0.0003 }, rating: 4 + i / 10, userRatingCount: 100 }));
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: out }) });
    });
    await page.route(/overpass|maps\.mail\.ru/, async (r) => {
      const q = decodeURIComponent((r.request().postData() || '').replace(/^data=/, '').replace(/\+/g, ' ')); const m = q.match(/around:\d+,([-\d.]+),([-\d.]+)/); const la = +m[1], lo = +m[2]; overpass.push([la, lo]);
      const els = Array.from({ length: 5 }, (_, i) => ({ type: 'node', id: Math.round(la * 1e4) * 10 + i, lat: la + i * 0.0003, lon: lo + i * 0.0002, tags: { amenity: 'restaurant', name: `OSM ${la.toFixed(3)} #${i}`, cuisine: 'pizza' } }));
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elements: els }) });
    });
    await page.route(/open-meteo|tile\.openstreetmap|timeapi|nominatim|photon/, r => r.abort());
    return { ctx, page, errors, places, overpass };
  };
  const cfg = { v: 2, type: 'Party', title: 'Dinner in Lisbon', start: '2027-05-14T19:00', tz: 'Europe/Lisbon', venue: { name: 'Praça do Comércio', address: 'Lisbon', lat: 38.7075, lon: -9.1364, city: 'Lisbon', country: 'Portugal', cc: 'pt' }, tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: false, packing: false } };
  const lastNearby = (places) => [...places].reverse().find(p => /searchNearby/.test(p.url) && p.b.maxResultCount === 20 && (p.b.includedTypes || []).length && !p.b.rankPreference);
  const btn = '[data-area-go]';
  for (const w of [390, 320]) {
    const { ctx, page, errors, places } = await mk(w);
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), cfg);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '#e=' + packed + '&t=nearby'); await page.waitForSelector('[data-gp-body] .place-row', { timeout: 15000 }); await page.waitForTimeout(300);
    ok(await page.$eval(btn, b => b.hidden), `@${w} no button before moving`);
    const first = lastNearby(places);
    ok(Math.abs(first.b.locationRestriction.circle.center.latitude - 38.7075) < 1e-4, `@${w} first search around the venue`);
    // a small nudge: no button
    await page.evaluate(() => document.querySelector('[data-panel="nearby"] [data-slot="map"]')._gmap.setCenter({ lat: 38.7077, lng: -9.1365 })); await page.waitForTimeout(150);
    ok(await page.$eval(btn, b => b.hidden), `@${w} small nudge: no button`);
    // pan ~1.5 km north-east → button; tap → search inside the new view
    await page.evaluate(() => document.querySelector('[data-panel="nearby"] [data-slot="map"]')._gmap.setCenter({ lat: 38.7200, lng: -9.1200 })); await page.waitForTimeout(150);
    ok(!(await page.$eval(btn, b => b.hidden)), `@${w} pan: Search this area appears`);
    ok((await page.textContent(btn)) === 'Search this area', `@${w} label`);
    if (SHOTS) await page.locator('.map-wrap').screenshot({ path: `${SHOTS}/map-area-${w}.png` });
    const bw = await page.$eval(btn, b => { const r = b.getBoundingClientRect(); return r.right <= document.documentElement.clientWidth && r.left >= 0; }); ok(bw, `@${w} button fits`);
    const n0 = places.length; await page.click(btn); await page.waitForFunction((n) => true, n0); await page.waitForTimeout(400);
    let s = lastNearby(places); const c1 = s.b.locationRestriction.circle;
    const bounds = await page.evaluate(() => { const b = document.querySelector('[data-panel="nearby"] [data-slot="map"]')._gmap.getBounds(); return { lat: b.getCenter().lat(), lng: b.getCenter().lng() }; });
    ok(places.length > n0 && Math.abs(c1.center.latitude - bounds.lat) < 1e-4 && Math.abs(c1.center.longitude - bounds.lng) < 1e-4 && c1.radius > 250 && c1.radius < 2000, `@${w} area search uses the view: ${JSON.stringify(c1)}`);
    ok(await page.$eval(btn, b => b.hidden), `@${w} button hides after the search`);
    ok(/38\.720/.test(await page.textContent('[data-gp-body]')), `@${w} list shows the new area's places`);
    // change category → still inside the searched area
    await pick(page, 'cat', 'cafes'); await page.waitForTimeout(400);
    s = lastNearby(places); ok(s.b.includedTypes.includes('cafe') && Math.abs(s.b.locationRestriction.circle.center.latitude - bounds.lat) < 1e-4, `@${w} Cafés searched in the same area`);
    // zoom out a lot (no pan) → button again; second, third pans keep working
    await page.evaluate(() => document.querySelector('[data-panel="nearby"] [data-slot="map"]')._gmap.setZoom(12)); await page.waitForTimeout(150);
    ok(!(await page.$eval(btn, b => b.hidden)), `@${w} zoom out: button appears again`);
    await page.click(btn); await page.waitForTimeout(400);
    s = lastNearby(places); ok(s.b.locationRestriction.circle.radius > 5000, `@${w} zoomed-out search covers more (${s.b.locationRestriction.circle.radius} m)`);
    for (const [la, lo] of [[38.69, -9.2], [38.75, -9.15]]) {
      await page.evaluate(([la, lo]) => document.querySelector('[data-panel="nearby"] [data-slot="map"]')._gmap.setCenter({ lat: la, lng: lo }), [la, lo]); await page.waitForTimeout(150);
      const shown = !(await page.$eval(btn, b => b.hidden)); await page.click(btn); await page.waitForTimeout(400);
      s = lastNearby(places); ok(shown && Math.abs(s.b.locationRestriction.circle.center.latitude - la) < 1e-3 && s.b.includedTypes.includes('cafe'), `@${w} pan to ${la},${lo}: button + search there`);
    }
    // text search after an area search: biased to the area
    await page.fill('[data-gp-q]', 'pastel de nata'); await page.click('[data-gp-go]').catch(() => page.press('[data-gp-q]', 'Enter')); await page.waitForTimeout(400);
    const tx = [...places].reverse().find(p => /searchText/.test(p.url) && p.b.textQuery === 'pastel de nata');
    ok(tx && Math.abs(tx.b.locationBias.circle.center.latitude - 38.75) < 1e-3, `@${w} text search biased to the area`);
    ok((await page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('.map-wrap *')].filter(e => e.getBoundingClientRect().right > cw + 1 && !e.closest('.map')).length; })) === 0, `@${w} no overflow`);
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }

  // trip with stops: picking a City resets the area (no button), panning from there works
  {
    const { ctx, page, places } = await mk(390);
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    const trip = { ...cfg, type: 'Trip', title: 'Portugal', stops: [{ name: 'Lisbon', lat: 38.7075, lon: -9.1364, cc: 'pt', from: '2027-05-14', to: '2027-05-17' }, { name: 'Porto', lat: 41.1496, lon: -8.611, cc: 'pt', from: '2027-05-17', to: '2027-05-20' }] };
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), trip);
    await page.goto(BASE + '#e=' + packed + '&t=nearby'); await page.waitForSelector('[data-gp-body] .place-row', { timeout: 15000 }); await page.waitForTimeout(300);
    await pick(page, 'city', '1'); await page.waitForTimeout(500);
    ok(await page.$eval(btn, b => b.hidden), 'City Porto: map moves there without the button');
    ok(Math.abs(lastNearby(places).b.locationRestriction.circle.center.latitude - 41.1496) < 1e-3, 'City Porto searches that stop');
    await page.evaluate(() => document.querySelector('[data-panel="nearby"] [data-slot="map"]')._gmap.setCenter({ lat: 41.16, lng: -8.63 })); await page.waitForTimeout(150);
    ok(!(await page.$eval(btn, b => b.hidden)), 'pan from the stop: button');
    await page.click(btn); await page.waitForTimeout(400);
    ok(Math.abs(lastNearby(places).b.locationRestriction.circle.center.latitude - 41.16) < 1e-3, 'area search near Porto');
    await ctx.close();
  }

  // OpenStreetMap fallback (no Google key): Leaflet map, pan → button → Overpass around the new center; repeat
  {
    const { ctx, page, errors, overpass } = await mk(390, { google: false });
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), cfg);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '#e=' + packed + '&t=nearby'); await page.waitForSelector('[data-slot="food"] [data-place]', { timeout: 20000 }); await page.waitForTimeout(500);
    const lmap = () => page.evaluate(() => { const el = document.querySelector('[data-slot="map"]'); return !!el && el.dataset.engine === 'leaflet'; });
    ok(await lmap(), 'OSM: Leaflet map');
    ok(await page.$eval(btn, b => b.hidden), 'OSM: no button before moving');
    for (const [la, lo] of [[38.722, -9.15], [38.70, -9.18]]) {
      await page.evaluate(([la, lo]) => { const m = [...window.__epMaps || []][0]; }, [la, lo]);
      await page.evaluate(([la, lo]) => { const el = document.querySelector('[data-slot="map"]'); const m = el._leafletMap; m.setView([la, lo], m.getZoom(), { animate: false }); }, [la, lo]);
      await page.waitForTimeout(250);
      ok(!(await page.$eval(btn, b => b.hidden)), `OSM: pan to ${la},${lo} → button`);
      const n0 = overpass.length; await page.click(btn); await page.waitForFunction((n) => document.querySelector('[data-slot="food"] [data-place]') && true, n0); await page.waitForTimeout(600);
      ok(overpass.length > n0 && Math.abs(overpass[overpass.length - 1][0] - la) < 2e-3, `OSM: Overpass asked around ${overpass[overpass.length - 1]}`);
      ok(new RegExp('OSM ' + la.toFixed(3)).test(await page.textContent('[data-slot="food"]')), 'OSM: list shows the new area');
      ok(await page.$eval(btn, b => b.hidden), 'OSM: button hides after the search');
    }
    // filters still work after re-wiring (one click = one toggle)
    await page.click('[data-ccb="near"] [data-cc-filters]'); await page.waitForTimeout(150);
    await page.click('[data-pf-open]'); await page.waitForTimeout(150); ok(await page.$eval('[data-pf-open]', b => b.getAttribute('aria-pressed') === 'true' && b.classList.contains('on')), 'OSM: a filter toggles once after re-searching');
    await page.click('[data-ccb="near"] .cc-sheet [data-cc-close].primary'); await page.waitForTimeout(100);
    ok(/Open now/.test(await page.textContent('[data-ccb="near"] [data-ccb-pills]')), 'OSM: the filter shows as a pill under the bar');
    ok(errors.length === 0, `OSM: no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failing` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
