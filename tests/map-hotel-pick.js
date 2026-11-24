// Map hotels in one tap (Dylan 11/24: "The hotels on the map are still incredibly confusing. When you click to add one of
// them it brings you to a search bar, instead of just adding it. And it's not giving an option to remove old hotel
// selections."). A hotel the app already knows (Google place sheet, Where to stay row) has ONE action: Set as my hotel —
// it becomes the guest's hotel booking for that city's nights, replacing a pick (Undo) or a real booking (Keep both).
// Every hotel of the city has Remove in the Nearby bar and in its amber pin's popup; removed stays removed on reload.
// The search box only opens from "Other hotel…". The organizer's itinerary hotel (incl. free-form "Tokyo: Hotel X,
// 6 nights" lines) gives way to the guest's own hotel, and a document's check-in supersedes those free-form lines.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/map-hotel-pick.js
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
  class InfoWindow { constructor() { window.__info = this; this.at = null; this.html = ''; } setContent(h) { this.html = h; } open(o) { this.at = o.anchor; } close() { this.at = null; } addListener(ev, f) { return on(this, ev, f); } }
  window.__fire = fire;
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Size { constructor(w, h) { this.w = w; this.h = h; } }
  window.google = { maps: { Map, Marker, InfoWindow, LatLngBounds, LatLng, Point, Size, SymbolPath: { CIRCLE: 0 }, event: { trigger() {}, addListenerOnce: (o, ev, f) => { const h = on(o, ev, (a) => { h.remove(); f(a); }); return h; } } } };
}
const P = (name, lat, lon, from, to) => ({ name, address: name + ', Japan', lat, lon, city: name, country: 'Japan', cc: 'jp', from, to });
const CFG = { v: 2, type: 'Trip', title: 'Map hotel pick trip', start: '2027-04-01', end: '2027-04-08', tz: 'Asia/Tokyo',
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
  await page.route('https://places.googleapis.com/**', async (r) => { const u = r.request().url(); const dm = u.match(/\/v1\/places\/([^?:]+)(\?|$)/);
    if (dm && r.request().method() === 'GET') { const id = decodeURIComponent(dm[1]); const h = GH[id]; return r.fulfill({ contentType: 'application/json', body: JSON.stringify(h ? { id, displayName: { text: h[0] }, formattedAddress: h[3], location: { latitude: h[1], longitude: h[2] }, types: ['lodging', 'point_of_interest'], primaryType: 'hotel', primaryTypeDisplayName: { text: 'Hotel' } } : { id, displayName: { text: 'Ramen Bar' }, location: { latitude: 35.67, longitude: 139.76 }, types: ['restaurant', 'food'], primaryType: 'ramen_restaurant' }) }); }
    const b = JSON.parse(r.request().postData() || '{}');
    if (/searchText/.test(r.request().url()) && b.textQuery) { const hit = Object.entries(HOT).find(([k]) => b.textQuery.toLowerCase().startsWith(k)); if (hit) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: [{ id: 'h-' + hit[0].replace(/ /g, '-'), displayName: { text: hit[0].replace(/\b\w/g, c => c.toUpperCase()) }, formattedAddress: '1-1 Somewhere, Tokyo', types: ['lodging'], location: { latitude: hit[1][0], longitude: hit[1][1] } }] }) }); }
    const c = (b.locationRestriction || b.locationBias || {}).circle; const la = c ? c.center.latitude : 0, lo = c ? c.center.longitude : 0;
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: [{ id: `p-${la.toFixed(3)}`, displayName: { text: 'Place' }, location: { latitude: la, longitude: lo }, rating: 4.1, userRatingCount: 5 }] }) }); });
  await page.route(/overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon|functions\/v1|supabase\.co/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  return { ctx, page };
}
const GH = { 'g-imperial': ['Imperial Hotel Tokyo', 35.6727, 139.7586, '1-1 Uchisaiwaicho, Tokyo'], 'g-okura': ['The Okura Tokyo', 35.6671, 139.7449, '2-10-4 Toranomon, Tokyo'], 'g-kanra': ['Hotel Kanra Kyoto', 34.9990, 135.7590, 'Kyoto'] };
const open = async (page, tab, seed, cfg = CFG) => {
  await page.evaluate(([k, s]) => { localStorage.clear(); for (const [n, v] of Object.entries(s || {})) localStorage.setItem('ep:' + n + ':' + k, JSON.stringify(v)); }, [keyOf(cfg), seed]);
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), cfg) + '&t=' + tab); await page.waitForSelector(tab === 'nearby' ? '[data-slot="hotel"]' : '#sec-itinerary');
  await page.waitForTimeout(700);
};
const itin = (page, cfg = CFG) => page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k) || '[]'), keyOf(cfg));
const bar = async (page) => (await page.textContent('[data-slot="hotel"]')).replace(/\s+/g, ' ').trim();
const hotelPins = (page) => page.evaluate(() => window.__markers.filter(m => m.on && m.o.zIndex === 5000).map(m => m.o.title));
const toast = (page) => page.textContent('#toast').then(x => x.replace(/\s+/g, ' ').trim()).catch(() => '');
const sheet = async (page, id) => { await page.evaluate((i) => document.querySelector('.ev')._openGPlace(i), id); await page.waitForSelector('#placedlg[open] .hs-slot, #placedlg[open] .plan-add'); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const PARK = { id: 'pk1', kind: 'hotel', name: 'Park Hotel Tokyo', address: 'Shiodome, Tokyo', lat: 35.6627, lon: 139.7600, start: '2027-04-01T15:00', end: '2027-04-04T11:00', confNo: 'PK-9' };

(async () => {
  const browser = await chromium.launch();
  try {
    for (const w of [390, 320]) {
      // 1 — one tap on a Google hotel's sheet sets it: over a real booking it replaces it (Keep both), no search box
      { const { ctx, page } = await setup(browser, w);
        await open(page, 'nearby', { itin: [PARK] });
        ok(!(await page.$('[data-hotel-q]')), `@${w} no search box in the hotel bar until Other hotel…`);
        await sheet(page, 'g-imperial');
        const acts = await page.$$eval('#placedlg [data-hs-set], #placedlg [data-plan-open]', bs => bs.map(b => b.textContent.trim()));
        ok(acts.length === 1 && /Set as my hotel/.test(acts[0]), `@${w} hotel sheet: one primary action "Set as my hotel" (${acts})`);
        await shot(page, `maphotel-test-sheet-${w}`);
        await page.click('#placedlg [data-hs-set]'); await page.waitForTimeout(500);
        let xs = await itin(page);
        ok(xs.length === 1 && xs[0].name === 'Imperial Hotel Tokyo' && xs[0].pin && xs[0].ref === 'g-imperial', `@${w} one tap → Imperial is the hotel, Park replaced ${JSON.stringify(xs.map(x => x.name))}`);
        ok(/Replaced Park Hotel Tokyo with Imperial Hotel Tokyo/.test(await toast(page)) && /Keep both/.test(await toast(page)), `@${w} toast: Replaced … · Keep both (${await toast(page)})`);
        ok(!(await page.$('.bk-ask')) && !(await page.$('[data-hotel-q]')), `@${w} no question, no search bar`);
        ok(/Your hotel/.test(await page.textContent('#placedlg .hs-slot')) && !!(await page.$('#placedlg [data-hs-rm]')), `@${w} the sheet now says Your hotel + Remove`);
        await page.evaluate(() => document.querySelector('#placedlg').close());
        const b = await bar(page); ok(/Imperial Hotel Tokyo/.test(b) && !/Park Hotel/.test(b), `@${w} bar: Imperial only (${b})`);
        const pins = await hotelPins(page); ok(pins.length === 1 && /Imperial/.test(pins[0]), `@${w} one amber pin, Imperial (${pins})`);
        // 2 — another pick over a pick: replaced, Undo brings the first one back
        await sheet(page, 'g-okura'); await page.click('#placedlg [data-hs-set]'); await page.waitForTimeout(500);
        xs = await itin(page); ok(xs.length === 1 && xs[0].name === 'The Okura Tokyo', `@${w} pick over a pick → replaced ${JSON.stringify(xs.map(x => x.name))}`);
        ok(/Replaced Imperial Hotel Tokyo with The Okura Tokyo/.test(await toast(page)) && /Undo/.test(await toast(page)), `@${w} toast: Replaced … · Undo (${await toast(page)})`);
        await page.click('#toast .toast-act'); await page.waitForTimeout(400);
        xs = await itin(page); ok(xs.map(x => x.name).join() === 'Imperial Hotel Tokyo', `@${w} Undo → Imperial back, Okura gone ${JSON.stringify(xs.map(x => x.name))}`);
        ok(/Set as my hotel/.test(await page.textContent('#placedlg .hs-slot')), `@${w} the open sheet follows Undo (Okura: Set as my hotel again)`);
        await page.evaluate(() => document.querySelector('#placedlg').close());
        // 3 — the amber pin's popup has Remove; the bar has Remove on every row
        const pop = await page.evaluate(() => { const m = window.__markers.find(x => x.on && x.o.zIndex === 5000); window.__fire(m, 'click'); return window.__info && window.__info.html; });
        ok(/data-hs-rm=/.test(pop || '') && /Remove/.test(pop || ''), `@${w} amber pin popup: Remove (${pop})`);
        await page.evaluate((h) => { const d = document.createElement('div'); d.id = 'fakepop'; d.innerHTML = h; document.querySelector('[data-slot="map"]').appendChild(d); }, pop);
        await page.click('#fakepop [data-hs-rm]'); await page.waitForTimeout(400);
        ok((await itin(page)).length === 0 && /No hotel yet/.test(await bar(page)) && (await hotelPins(page)).length === 0, `@${w} popup Remove → no hotel, no pin (${await bar(page)})`);
        await page.click('#toast .toast-act'); await page.waitForTimeout(300); ok((await itin(page)).length === 1, `@${w} Undo puts it back`);
        await page.click('[data-slot="hotel"] [data-hotel-del]'); await page.waitForTimeout(300);
        ok((await itin(page)).length === 0, `@${w} bar Remove → gone`);
        // 4 — no resurrection on reload
        await page.reload(); await page.waitForSelector('[data-slot="hotel"]'); await page.waitForTimeout(800);
        ok((await itin(page)).length === 0 && /No hotel yet/.test(await bar(page)) && (await hotelPins(page)).length === 0, `@${w} reload: still no hotel (${await bar(page)})`);
        // 5 — Other hotel… is the only way to the search box; Hotels shows hotels nearby
        await page.click('[data-hotel-add]'); ok(!!(await page.$('[data-hotel-q]')), `@${w} Other hotel… opens the search`);
        await page.click('[data-hotel-cancel]'); await page.click('[data-hotel-browse]'); await page.waitForTimeout(400);
        ok(await page.evaluate(() => document.querySelector('.ev')._gp.cat) === 'hotels', `@${w} Hotels → the Hotels category on the map`);
        await shot(page, `maphotel-test-bar-${w}`);
        ok((await overflow(page)) === 0, `@${w} no overflow`);
        // a restaurant's sheet still has Add to itinerary (and its day form stays folded)
        await sheet(page, 'g-ramen'); ok(!!(await page.$('#placedlg [data-plan-open]')) && !(await page.$('#placedlg [data-hs-set]')) && !(await page.isVisible('#placedlg .plan-form')), `@${w} non-hotel sheet: Add to itinerary, form folded`);
        ok(page._err.length === 0, `@${w} no page errors ${page._err}`); await ctx.close(); }
    }

    // 6 — a pick fills the city's leg that has no hotel; the guest's own pin hides the blue duplicate; Kyoto stays untouched
    { const { ctx, page } = await setup(browser);
      await open(page, 'nearby', { itin: [{ id: 'k1', kind: 'hotel', name: 'Hotel Kanra Kyoto', address: 'Kyoto', lat: 34.999, lon: 135.759, start: '2027-04-04T15:00', end: '2027-04-08T11:00' }] });
      await sheet(page, 'g-imperial'); await page.click('#placedlg [data-hs-set]'); await page.waitForTimeout(500);
      const xs = await itin(page); const im = xs.find(x => /Imperial/.test(x.name));
      ok(xs.length === 2 && im && im.start === '2027-04-01' && /Kanra/.test(xs.find(x => x.id === 'k1').name), `added for Tokyo's nights, Kyoto kept ${JSON.stringify(xs.map(x => [x.name, x.start]))}`);
      ok(/is your hotel/.test(await toast(page)) && /Undo/.test(await toast(page)), `toast: … is your hotel · Undo (${await toast(page)})`);
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 7 — the organizer's itinerary hotel (free-form or check-in) gives way to the guest's own hotel for those nights
    { const { ctx, page } = await setup(browser);
      const cfg = { ...CFG, schedule: [{ date: '2027-04-01', time: '', title: 'Tokyo: Hotel Sunroute Plaza, 3 nights', kind: 'activity' }, { date: '2027-04-04', time: '', title: 'Kyoto: ryokan, 4 nights (not chosen yet)', kind: 'activity' }] };
      await open(page, 'nearby', {}, cfg);
      const hn = await page.evaluate((c) => window.__ep.hotelsNow(window.__ep.normalize(c)).map(hs => hs.map(h => h.name + '|' + h.src + '|' + h.to)), cfg);
      ok(JSON.stringify(hn) === JSON.stringify([['Hotel Sunroute Plaza|host|2027-04-04'], []]), `free-form lines: Tokyo's hotel named, the undecided Kyoto ryokan isn't a hotel ${JSON.stringify(hn)}`);
      await sheet(page, 'g-imperial'); await page.click('#placedlg [data-hs-set]'); await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelector('#placedlg').close());
      const b = await bar(page); ok(/Imperial Hotel Tokyo/.test(b) && !/Sunroute/.test(b), `the organizer's Tokyo hotel no longer shows as the guest's (${b})`);
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 8 — organizer: a document's check-in replaces free-form stay lines for that stop/nights (Dylan's Japan page)
    { const { ctx, page } = await setup(browser);
      const r = await page.evaluate(async () => { const E = window.__ep;
        const cfg = E.normalize({ v: 2, type: 'Trip', title: 'Doc trip', start: '2027-04-01', end: '2027-04-10', tz: 'Asia/Tokyo',
          venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
          stops: [{ name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp', from: '2027-04-01', to: '2027-04-07' }, { name: 'Arima Onsen', address: 'Arima, Kobe, Japan', lat: 34.7967, lon: 135.2479, city: 'Arima Onsen', country: 'Japan', cc: 'jp', from: '2027-04-07', to: '2027-04-09' }],
          schedule: [{ date: '2027-04-01', time: '', title: 'Tokyo: Hotel Gracery Shinjuku, 6 nights', kind: 'activity' }, { date: '2027-04-07', time: '', title: 'Arima onsen: ryokan, 2 nights (not chosen yet)', kind: 'activity' }, { date: '2027-04-02', time: '10:00', title: 'Tsukiji market', kind: 'activity' }],
          tools: { nearby: true, mytrip: true } });
        const doc = { title: 'Booking', type: 'Trip', start_date: '2027-04-01', end_date: '2027-04-09', stops: [], notes: [], sections: [], schedule: [{ date: '2027-04-01', time: '15:00', title: 'Check in: Park Hotel Tokyo', note: '', kind: 'reservation' }, { date: '2027-04-07', time: '15:00', title: 'Check in: Gekkoen Yugekan', note: '', kind: 'reservation' }] };
        let next; try { next = await E.docApply(cfg, E.docItems(cfg, doc, 'schedule')); } catch (e) { return { err: String(e) }; }
        return { titles: next.schedule.map(x => x.title), hotels: E.hotelsNow(next).map(hs => hs.map(h => h.name)) }; });
      ok(r && !r.err && !r.titles.some(t => /Gracery|ryokan, 2 nights/.test(t)) && r.titles.includes('Tsukiji market'), `free-form stay lines superseded by the document's check-ins ${JSON.stringify(r)}`);
      ok(r && r.hotels && /Park Hotel Tokyo/.test(r.hotels[0].join()) && /Gekkoen/.test(r.hotels[1].join()), `each stop's hotel = the document's ${JSON.stringify(r && r.hotels)}`);
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }
  } catch (e) { console.error(e); fails.push(String(e)); }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
