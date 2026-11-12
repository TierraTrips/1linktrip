// Nearby, per route city: "Your hotel" — from the guest's own hotel booking (My trip), else the host's stay on the
// itinerary for that leg, else one the guest sets (search + Find). It is a large coral bed pin with a permanent label,
// highest on the map, with a key + a "Hotel" button that re-centers on it. Nearby searches start at the hotel and
// distances are measured from it. ☆ on any place saves it (plan item, synced like My trip), shows as a gold star pin,
// and is listed per city in My trip → Saved spots with Open in Google Maps, plus Save all to Google Maps (a KML file)
// with the My Maps note. 390 + 320.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/hotel-spots.js
//   SHOTS=/tmp/ep-shots node tests/hotel-spots.js
//
// Part 1 uses an in-page stand-in for Google Maps JS (markers recorded) and generated Places answers.
// Part 2 draws the OpenStreetMap map (no Google) with real tiles for a legibility screenshot.
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => {
  const cw = document.documentElement.clientWidth;
  return [...document.querySelectorAll('body *')].filter(e => {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return false;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false;
    const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1;
  }).slice(0, 5).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.'));
});
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
const P = (name, lat, lon, from, to) => ({ name, address: name + ', Japan', lat, lon, city: name, region: '', country: 'Japan', cc: 'jp', from, to });
const CFG = {
  v: 2, type: 'Trip', title: 'Japan in spring', start: '2027-04-01', end: '2027-04-10', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 35.6762, 139.6503, '2027-04-01', '2027-04-04'), P('Kyoto', 35.0116, 135.7681, '2027-04-04', '2027-04-07'), P('Osaka', 34.6937, 135.5023, '2027-04-07', '2027-04-10')],
  schedule: [{ date: '2027-04-04', time: '15:00', title: 'Check in: Ryokan Sakura', note: '' }, { date: '2027-04-05', time: '', title: 'Fushimi Inari', note: '' }],
  tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false },
};
const HOTELS = { 'park hotel tokyo': [35.6627, 139.7576], 'ryokan sakura': [35.0036, 135.7780], 'hotel osaka bay': [34.6650, 135.4320] };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);

(async () => {
  const browser = await chromium.launch();
  const near = (a, b, e = 1e-3) => Math.abs(a - b) < e;

  // ---------- part 1: Google (stand-in) ----------
  for (const w of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(fakeGoogleMaps);
    const reqs = [];
    await page.route('https://places.googleapis.com/**', async (r) => {
      const b = JSON.parse(r.request().postData() || '{}'); reqs.push({ url: r.request().url(), b });
      if (/searchText/.test(r.request().url()) && b.textQuery) {
        const hit = Object.entries(HOTELS).find(([k]) => b.textQuery.toLowerCase().startsWith(k));
        if (hit) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: [{ id: 'h-' + hit[0].replace(/ /g, '-'), displayName: { text: hit[0].replace(/\b\w/g, c => c.toUpperCase()) }, formattedAddress: '1-1 Somewhere, Japan', location: { latitude: hit[1][0], longitude: hit[1][1] } }] }) });
      }
      const c = (b.locationRestriction || b.locationBias || {}).circle; const la = c ? c.center.latitude : 0, lo = c ? c.center.longitude : 0;
      const out = Array.from({ length: 4 }, (_, i) => ({ id: `p-${la.toFixed(3)}-${i}`, displayName: { text: `Cafe ${i} near ${la.toFixed(3)}` }, shortFormattedAddress: `${i} Main St`, location: { latitude: la + i * 0.0006, longitude: lo + i * 0.0004 }, rating: 4.2, userRatingCount: 80 }));
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: out }) });
    });
    await page.route(/overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    const k = keyOf(CFG);
    await page.evaluate(([k]) => { localStorage.clear(); localStorage.setItem('ep:itin:' + k, JSON.stringify([{ id: 'bk1', kind: 'hotel', name: 'Park Hotel Tokyo', address: 'Shiodome, Tokyo', start: '2027-04-01T15:00', end: '2027-04-04T11:00', confNo: 'PH-1' }])); }, [k]);
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), CFG);
    await page.goto(BASE + '#e=' + packed + '&t=nearby'); await page.waitForSelector('[data-gp-body] .place-row', { timeout: 15000 });
    await page.waitForFunction(() => /Park Hotel Tokyo/.test(document.querySelector('[data-slot="hotel"]').textContent) && !/Finding/.test(document.querySelector('[data-slot="hotel"]').textContent));
    await page.waitForTimeout(400);
    const bar = await page.textContent('[data-slot="hotel"]');
    ok(/Your hotel in Tokyo/.test(bar) && /From your bookings/.test(bar), `@${w} Tokyo hotel from the guest's booking: ${bar.replace(/\s+/g, ' ')}`);
    const hm = await page.evaluate(() => window.__markers.filter(m => m.on && m.o.zIndex === 5000).map(m => ({ lat: m.o.position.lat, lbl: m.o.label && m.o.label.text, url: (m.o.icon || {}).url || '', w: m.o.icon.scaledSize.w, z: m.o.zIndex })));
    const maxZ = await page.evaluate(() => Math.max(...window.__markers.filter(m => m.on).map(m => m.o.zIndex || 0)));
    hm.sort((a, b) => b.lat - a.lat); // other cities' hotels may already be found too
    ok(hm.length >= 1 && near(hm[0].lat, 35.6627) && hm[0].lbl === 'Park Hotel Tokyo' && /E35B47/.test(decodeURIComponent(hm[0].url)) && hm[0].w === 48 && maxZ === 5000, `@${w} hotel marker: big coral bed pin, labelled, on top ${JSON.stringify(hm)}`);
    const nb = [...reqs].reverse().find(x => /searchNearby/.test(x.url));
    ok(nb && near(nb.b.locationRestriction.circle.center.latitude, 35.6627) && near(nb.b.locationRestriction.circle.center.longitude, 139.7576), `@${w} Nearby searches start at the hotel`);
    ok(/Your hotel/.test(await page.textContent('[data-slot="map-key"]')) && !!(await page.$('[data-slot="map-key"] [data-hotel-go]')), `@${w} map key + Hotel button`);
    await page.evaluate(() => window.__gmap.setCenter({ lat: 35.70, lng: 139.70 })); await page.click('[data-hotel-go]'); await page.waitForTimeout(100);
    ok(await page.evaluate(() => Math.abs(window.__gmap.c.lat - 35.6627) < 1e-3 && window.__gmap.z === 16), `@${w} Hotel button re-centers on it`);
    if (SHOTS && w === 390) await page.locator('#sec-map').screenshot({ path: `${SHOTS}/hotel-bar-google-390.png` });

    // ☆ save a place
    const first = await page.$eval('[data-gp-body] .star-b', b => b.dataset.gpSave);
    await page.click(`[data-gp-save="${first}"]`); await page.waitForTimeout(200);
    ok(await page.$eval(`[data-gp-save="${first}"]`, b => b.classList.contains('on') && b.getAttribute('aria-pressed') === 'true'), `@${w} ☆ → ★ saved`);
    const stars = await page.evaluate(() => window.__markers.filter(m => m.on && m.o.zIndex === 4000).map(m => decodeURIComponent((m.o.icon || {}).url || '')));
    ok(stars.length === 1 && /E8A100/.test(stars[0]), `@${w} saved spot is a gold star marker`);
    ok(/Saved/.test(await page.textContent('[data-slot="map-key"]')), `@${w} key shows Saved`);

    // Kyoto: the host's stay on the itinerary
    await page.click('[data-gp-stop="1"]');
    await page.waitForFunction(() => /Ryokan Sakura/i.test(document.querySelector('[data-slot="hotel"]').textContent) && !/Finding/.test(document.querySelector('[data-slot="hotel"]').textContent), null, { timeout: 8000 }).catch(() => {});
    const kb = await page.textContent('[data-slot="hotel"]');
    ok(/Your hotel in Kyoto/.test(kb) && /Ryokan Sakura/.test(kb) && /From the itinerary/.test(kb), `@${w} Kyoto hotel from the host's itinerary: ${kb.replace(/\s+/g, ' ')}`);
    await page.waitForTimeout(400);
    const nb2 = [...reqs].reverse().find(x => /searchNearby/.test(x.url));
    ok(nb2 && near(nb2.b.locationRestriction.circle.center.latitude, 35.0036), `@${w} Kyoto searches start at the ryokan`);
    // Osaka: nothing known → Set your hotel
    await page.click('[data-gp-stop="2"]'); await page.waitForSelector('[data-hotel-q]');
    ok(/Set your hotel/.test(await page.textContent('[data-slot="hotel"]')), `@${w} Osaka: Set your hotel`);
    await page.fill('[data-hotel-q]', 'Hotel Osaka Bay'); await page.click('[data-hotel-find]');
    await page.waitForFunction(() => /Hotel Osaka Bay/i.test(document.querySelector('[data-slot="hotel"] .hb') ? document.querySelector('[data-slot="hotel"] .hb').textContent : ''));
    const plan = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:plan:' + k)), k);
    ok(plan.some(x => x.hotel && /Osaka Bay/i.test(x.name)) && plan.some(x => !x.hotel && x.ref === first), `@${w} set hotel + saved spot stored as My trip items`);
    ok(await page.evaluate(() => window.__markers.filter(m => m.on && m.o.zIndex === 5000).length) === 3, `@${w} a hotel pin per city`);
    const of = await overflow(page); ok(of.length === 0, `@${w} Nearby: no overflow ${of.join(' ')}`);

    // My trip → Saved spots
    await page.click('[data-tab-go="mytrip"]'); await page.waitForSelector('#sec-spots');
    const sp = await page.$$eval('#sec-spots .sub-h', hs => hs.map(h => h.textContent));
    ok(sp.join() === 'Tokyo,Kyoto,Osaka', `@${w} saved spots grouped by city ${sp}`);
    const tokyo = await page.$$eval('#sec-spots .spots', ls => [...ls[0].querySelectorAll('li')].map(li => ({ t: li.querySelector('b').textContent, href: li.querySelector('a').href, a: li.querySelector('a').textContent })));
    ok(tokyo.length === 2 && /Park Hotel Tokyo/.test(tokyo[0].t) && tokyo.every(x => x.a === 'Open in Google Maps' && x.href.startsWith('https://www.google.com/maps/search/?api=1&query=')) && /query_place_id=/.test(tokyo[1].href), `@${w} Tokyo: hotel + saved spot with Google Maps links ${JSON.stringify(tokyo)}`);
    ok(/Import into Google My Maps — shows in the Google Maps app under Saved → Maps/.test(await page.textContent('#sec-spots')), `@${w} My Maps note`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sec-spots [data-kml]')]);
    const kml = fs.readFileSync(await dl.path(), 'utf8');
    ok(/\.kml$/.test(dl.suggestedFilename()) && (kml.match(/<Folder>/g) || []).length === 3 && /<name>Your hotel: Park Hotel Tokyo<\/name>/.test(kml) && /139\.7576,35\.6627,0/.test(kml) && kml.includes(`<name>Cafe 0 near`), `@${w} KML: a folder per city, hotel + spots (${dl.suggestedFilename()})`);
    const of2 = await overflow(page); ok(of2.length === 0, `@${w} My trip: no overflow ${of2.join(' ')}`);
    if (SHOTS && w === 390) await page.locator('#sec-spots').screenshot({ path: `${SHOTS}/saved-spots-390.png` });
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }

  // ---------- part 2: the drawn map (OpenStreetMap, real tiles) for a legibility check ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/google-config.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.EP_GOOGLE = { key: "" };' }));
    await page.route(/overpass|maps\.mail\.ru|open-meteo|timeapi|nominatim|photon/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    const one = { ...CFG, stops: [], schedule: [] }; const k = keyOf(one);
    await page.evaluate(([k]) => { localStorage.clear(); localStorage.setItem('ep:plan:' + k, JSON.stringify([
      { id: 'h1', src: 'osm', ref: '', name: 'Park Hotel Tokyo', lat: 35.6640, lon: 139.7570, addr: 'Shiodome', hotel: true, type: 'stay', day: '' },
      { id: 's1', src: 'osm', ref: 'n1', name: 'Tsukiji Outer Market', lat: 35.6655, lon: 139.7707, addr: '', type: 'food', day: '' },
      { id: 's2', src: 'osm', ref: 'n2', name: 'Hamarikyu Gardens', lat: 35.6600, lon: 139.7630, addr: '', type: 'activity', day: '' }])); }, [k]);
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), { ...one, venue: { ...one.venue, lat: 35.6655, lon: 139.7620 } });
    await page.goto(BASE + '#e=' + packed + '&t=nearby'); await page.waitForSelector('.hpin', { timeout: 15000 }); await page.waitForTimeout(2500);
    const z = await page.evaluate(() => { const h = document.querySelector('.hpin'); const zs = [...document.querySelectorAll('.leaflet-marker-icon')].map(e => +e.style.zIndex); return { h: +h.style.zIndex, max: Math.max(...zs), lbl: h.querySelector('.map-lbl').textContent, stars: document.querySelectorAll('.spin img').length }; });
    ok(z.h === z.max && z.lbl === 'Park Hotel Tokyo' && z.stars === 2, `OSM map: hotel pin on top with its label, 2 star pins ${JSON.stringify(z)}`);
    if (SHOTS) await page.locator('#sec-map').screenshot({ path: `${SHOTS}/hotel-map-osm-390.png` });
    ok(errors.length === 0, `OSM: no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
