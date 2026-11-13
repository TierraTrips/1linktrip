// City × Category, one compact bar everywhere places/plans are listed (?demo=japan: Tokyo, Kyoto, Osaka, Tokyo again).
// Nearby: [City ▾] [Category ▾] + search + Filters. City = the route cities (Tokyo once), choosing one re-centers the map
// on that city's hotel and searches there; Category drives the Places query (Restaurants, Cafés, Bars, Sights, Things to
// do, Shopping, Hotels); text search is scoped to the chosen city ("ramen" in Kyoto); sub-filters live in a bottom
// sheet and show as removable pills. Each category has one icon + color: dropdown, list rows and map markers alike;
// saved spots are their category's marker with a gold star; a small legend only when several categories are on the
// map. My trip (itinerary, saved spots, bookings) and the trip Itinerary share one City × Category selection
// ("Kyoto · Restaurants"). The selection is kept per trip, and ?city=kyoto&cat=restaurants links to it. 390 + 320, ja.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/city-category.js
//   SHOTS=/tmp/ep-shots node tests/city-category.js
//
// Google Maps JS is an in-page stand-in (markers recorded); Places answers are generated per request.
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const near = (a, b, d = 0.03) => Math.abs(a - b) < d;
const NB = '[data-ccb="near"]', TRIP = '[data-ccb="trip"]', ITIN = '[data-ccb="itin"]';
const pick = async (page, key, v, box = NB) => { await page.click(`${box} [data-dd="${key}"] [data-dd-btn]`); await page.click(`${box} [data-dd="${key}"] [data-dd-v="${v}"]`); await page.waitForTimeout(250); };
const label = (page, key, box = NB) => page.textContent(`${box} [data-dd="${key}"] .dd-l`);
const overflow = (page, sel) => page.evaluate((sel) => {
  const cw = document.documentElement.clientWidth;
  return [...document.querySelectorAll(sel + ' *')].filter(e => {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return false; if (e.closest('[hidden],dialog:not([open])')) return false;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false;
    const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1;
  }).slice(0, 5).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.'));
}, sel);
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
    setCenter(c) { this.c = c; this._idle(); } setZoom(z) { this.z = z; fire(this, 'zoom_changed'); this._idle(); } getZoom() { return this.z; } getCenter() { return new LatLng(this.c.lat, this.c.lng); }
    fitBounds(b) { const c = b.getCenter(); this.c = { lat: c.lat(), lng: c.lng() }; this._idle(); }
    getBounds() { const h = 0.006 * Math.pow(2, 15 - this.z), w = h * 0.6; const b = new LatLngBounds(); b.extend({ lat: this.c.lat - h, lng: this.c.lng - w }); b.extend({ lat: this.c.lat + h, lng: this.c.lng + w }); return b; }
    setOptions() {}
  }
  window.__markers = [];
  class Marker { constructor(o) { this.o = o; this.on = !!o.map; window.__markers.push(this); } setMap(m) { this.on = !!m; } setIcon(i) { this.o.icon = i; } addListener() { return { remove() {} }; } }
  class InfoWindow { setContent() {} open() {} }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Size { constructor(w, h) { this.w = w; this.h = h; } }
  window.google = { maps: { Map, Marker, InfoWindow, LatLngBounds, LatLng, Point, Size, SymbolPath: { CIRCLE: 0 }, event: { trigger() {}, addListenerOnce: (o, ev, f) => { const h = on(o, ev, (a) => { h.remove(); f(a); }); return h; } } } };
}
const CITY = { tokyo: [35.68972, 139.69222], kyoto: [35.01164, 135.76803], osaka: [34.69374, 135.50218] };
const HOTELS = { 'park hotel tokyo': [35.6627, 139.7576], 'hotel granvia kyoto': [34.9858, 135.7588], 'cross hotel osaka': [34.6720, 135.5010], 'hotel gracery shinjuku': [35.6950, 139.7016] };
const PTYPE = { restaurant: 'ramen_restaurant', cafe: 'coffee_shop', bar: 'bar', tourist_attraction: 'buddhist_temple', shopping_mall: 'shopping_mall', lodging: 'hotel' };
const COLOR = { restaurants: 'E25A1C', cafes: '8A5A2B', bars: 'B0306A', sights: '0B7A8A', tours: '6741D9', shopping: '2F8A3E', hotels: '1E3A8A' };

async function mk(browser, w, lang = '') {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: lang || 'en-US' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(fakeGoogleMaps);
  const reqs = [];
  await page.route('https://places.googleapis.com/**', async (r) => {
    const url = r.request().url(); const b = JSON.parse(r.request().postData() || '{}'); reqs.push({ url, b });
    if (/searchText/.test(url) && b.textQuery) {
      const hit = Object.entries(HOTELS).find(([k]) => b.textQuery.toLowerCase().startsWith(k));
      if (hit) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: [{ id: 'h-' + hit[0].replace(/ /g, '-'), displayName: { text: hit[0] }, formattedAddress: 'Japan', location: { latitude: hit[1][0], longitude: hit[1][1] } }] }) });
    }
    const c = (b.locationRestriction || b.locationBias || {}).circle; const la = c ? c.center.latitude : 0, lo = c ? c.center.longitude : 0;
    const ty = (b.includedTypes || [])[0]; const tag = ty || b.textQuery || 'x';
    const out = Array.from({ length: 4 }, (_, i) => ({ id: `p-${tag}-${la.toFixed(3)}-${i}`, displayName: { text: `${tag} ${i} @${la.toFixed(2)}` }, location: { latitude: la + i * 0.0006, longitude: lo + i * 0.0004 },
      rating: [4.1, 4.7, 3.9, 4.5][i], userRatingCount: 100, priceLevel: ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_MODERATE'][i],
      currentOpeningHours: { openNow: i % 2 === 0 }, primaryType: ty ? PTYPE[ty] || ty : 'ramen_restaurant', primaryTypeDisplayName: { text: ty ? (PTYPE[ty] || ty).replace(/_/g, ' ') : 'Ramen restaurant' } }));
    if (b.textQuery === 'ramen') out.push({ id: 'far-ramen', displayName: { text: 'Far away ramen' }, location: { latitude: CITY.tokyo[0], longitude: CITY.tokyo[1] }, primaryType: 'ramen_restaurant', primaryTypeDisplayName: { text: 'Ramen restaurant' } });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: out }) });
  });
  await page.route(/overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon|maps\.googleapis|upload\.wikimedia/, r => r.abort());
  return { ctx, page, errors, reqs };
}
const lastSearch = (reqs) => [...reqs].reverse().find(x => /searchNearby|searchText/.test(x.url) && !Object.keys(HOTELS).some(k => (x.b.textQuery || '').toLowerCase().startsWith(k)));
const ctr = (x) => (x.b.locationRestriction || x.b.locationBias).circle.center;

(async () => {
  const browser = await chromium.launch();
  for (const w of [390, 320]) {
    const { ctx, page, errors, reqs } = await mk(browser, w);
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '?demo=japan#t=nearby'); await page.waitForSelector('[data-gp-body] .place-row', { timeout: 15000 }); await page.waitForTimeout(800);
    // ---- Nearby: the bar ----
    const cities = await page.$$eval(`${NB} [data-dd="city"] [data-dd-v]`, bs => bs.map(b => b.textContent));
    ok(cities.join() === 'Tokyo,Kyoto,Osaka', `@${w} City: the route cities, Tokyo once (${cities})`);
    const cats = await page.$$eval(`${NB} [data-dd="cat"] [data-dd-v]`, bs => bs.map(b => [b.dataset.ddV, b.textContent.trim(), (b.querySelector('.cci') || {}).style?.getPropertyValue('--cc')]));
    ok(cats.map(c => c[0]).join() === 'restaurants,cafes,bars,sights,tours,shopping,hotels' && cats.map(c => c[1]).join('|') === 'Restaurants|Cafés|Bars|Sights|Things to do|Shopping|Hotels', `@${w} Category: ${cats.map(c => c[1]).join(' | ')}`);
    ok(new Set(cats.map(c => c[2])).size === 7 && cats.every(c => c[2] === '#' + COLOR[c[0]]), `@${w} one icon color per category in the dropdown`);
    ok(await label(page, 'city') === 'Tokyo' && await label(page, 'cat') === 'Restaurants', `@${w} opens on Tokyo · Restaurants`);
    let s = lastSearch(reqs); ok(s.b.includedTypes.includes('restaurant') && near(ctr(s).latitude, HOTELS['park hotel tokyo'][0]), `@${w} Tokyo search starts at the Tokyo hotel`);
    ok(!(await page.$('.chips.stop-chips, .pf-cats')), `@${w} no chip rows for cities or categories`);
    // ---- City → that city's hotel, Category → the query ----
    await pick(page, 'city', '1'); await page.waitForTimeout(400);
    s = lastSearch(reqs); ok(near(ctr(s).latitude, HOTELS['hotel granvia kyoto'][0], 0.002) && near(ctr(s).longitude, HOTELS['hotel granvia kyoto'][1], 0.002) && s.b.includedTypes.includes('restaurant'), `@${w} Kyoto: restaurants around Hotel Granvia Kyoto ${JSON.stringify(ctr(s))}`);
    ok(near((await page.evaluate(() => window.__gmap.c)).lat, HOTELS['hotel granvia kyoto'][0], 0.002), `@${w} Kyoto: map re-centered on the Kyoto hotel`);
    ok(/Kyoto/.test(await page.textContent('[data-slot="hotel"]')), `@${w} Kyoto: the hotel bar follows`);
    ok(/[?&]city=kyoto/.test(page.url()), `@${w} the address bar carries city=kyoto (${page.url().split('?')[1]})`);
    ok(await page.getAttribute('[data-gp-q]', 'placeholder') === 'Search in Kyoto', `@${w} search box scoped to Kyoto`);
    await pick(page, 'cat', 'bars'); await page.waitForTimeout(300);
    s = lastSearch(reqs); ok(s.b.includedTypes.includes('bar') && near(ctr(s).latitude, HOTELS['hotel granvia kyoto'][0], 0.002), `@${w} Kyoto · Bars searched`);
    ok(/[?&]cat=bars/.test(page.url()), `@${w} the address bar carries cat=bars`);
    const rowCol = await page.$$eval('[data-gp-body] .place-row > .cci', xs => xs.map(x => x.style.getPropertyValue('--cc')));
    ok(rowCol.length === 4 && rowCol.every(c => c === '#' + COLOR.bars), `@${w} list rows carry the Bars icon`);
    const pinIc = await page.evaluate(() => window.__markers.filter(m => m.on && (m.o.zIndex || 500) === 500).map(m => decodeURIComponent((m.o.icon || {}).url || '')));
    ok(pinIc.length === 4 && pinIc.every(u => u.includes('#' + 'B0306A') && u.includes('stroke="#fff"')), `@${w} map markers: the Bars icon, white on its color`);
    for (const [k, test] of [['sights', (b) => (b.includedTypes || []).includes('tourist_attraction')], ['tours', (b) => b.textQuery === 'tours and experiences'], ['shopping', (b) => (b.includedTypes || []).includes('shopping_mall')], ['hotels', (b) => (b.includedTypes || []).includes('lodging')], ['cafes', (b) => (b.includedTypes || []).includes('cafe')]]) {
      await pick(page, 'cat', k); await page.waitForTimeout(250); s = lastSearch(reqs);
      ok(test(s.b) && near(ctr(s).latitude, HOTELS['hotel granvia kyoto'][0], 0.002), `@${w} Kyoto · ${k}: ${JSON.stringify(s.b.includedTypes || s.b.textQuery)}`);
    }
    // Osaka works the same (every city, not just the first)
    await pick(page, 'city', '2'); await page.waitForTimeout(400);
    s = lastSearch(reqs); ok(near(ctr(s).latitude, HOTELS['cross hotel osaka'][0], 0.002) && (s.b.includedTypes || []).includes('cafe'), `@${w} Osaka · Cafés around Cross Hotel Osaka`);
    // text search inside the city: "ramen" with Kyoto chosen
    await pick(page, 'city', '1'); await page.waitForTimeout(300);
    await page.fill('[data-gp-q]', 'ramen'); await page.click('[data-gp-go]'); await page.waitForTimeout(500);
    s = lastSearch(reqs); const names = await page.$$eval('[data-gp-body] .place-row b', bs => bs.map(b => b.textContent));
    ok(s.b.textQuery === 'ramen' && near(ctr(s).latitude, HOTELS['hotel granvia kyoto'][0], 0.002), `@${w} “ramen” searched around Kyoto`);
    ok(names.length === 4 && !names.includes('Far away ramen'), `@${w} only Kyoto's ramen listed (${names.length})`);
    ok(await label(page, 'cat') === 'Category', `@${w} a text search clears the category`);
    await page.click('[data-gp-q-clear]'); await page.waitForTimeout(200);
    await pick(page, 'cat', 'restaurants'); await page.waitForTimeout(300);
    // ---- Filters sheet + pills ----
    ok(!(await page.isVisible(`${NB} [data-gp-open]`)), `@${w} sub-filters folded into the sheet`);
    await page.click(`${NB} [data-cc-filters]`); await page.waitForTimeout(150);
    ok(await page.$eval(`${NB} .cc-sheet`, d => d.open && getComputedStyle(d).position === 'fixed'), `@${w} Filters opens a sheet`);
    const groups = await page.$$eval(`${NB} .cc-sheet .cc-g h3, ${NB} .cc-sheet .cc-sels .field > span`, hs => hs.map(h => h.textContent));
    ok(['Sort by', 'Hours', 'Rating', 'Price', 'Distance', 'Cuisine', 'Dietary'].every(g => groups.includes(g)), `@${w} sheet: ${groups.join(' · ')}`);
    await page.click(`${NB} [data-gp-open]`); await page.click(`${NB} [data-gp-stars="4"]`); await page.click(`${NB} [data-gp-sort="rating"]`); await page.waitForTimeout(150);
    const done = await page.textContent(`${NB} .cc-sheet [data-cc-close].primary`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/cc-sheet-${w}.png` });
    await page.click(`${NB} .cc-sheet [data-cc-close].primary`); await page.waitForTimeout(150);
    let pl = await page.$$eval(`${NB} [data-ccb-pills] .pill span`, ss => ss.map(s => s.textContent));
    const shown = await page.$$eval('[data-gp-body] .place-row b', bs => bs.map(b => b.textContent));
    ok(pl.join('|') === 'Open now|★ 4.0+|Top rated' && await page.textContent(`${NB} [data-cc-filters] .ccb-n`) === '3', `@${w} pills: ${pl.join(' | ')}, Filters shows 3`);
    ok(shown.length === 1 && done === 'Show 1 place', `@${w} open + 4★ → ${shown} (“${done}”)`);
    await page.click(`${NB} [data-cc-pill="open"]`); await page.waitForTimeout(150);
    const shown2 = await page.$$eval('[data-gp-body] .place-row', xs => xs.length);
    pl = await page.$$eval(`${NB} [data-ccb-pills] .pill span`, ss => ss.map(s => s.textContent));
    const order = await page.$$eval('[data-gp-body] .place-row .rt', xs => xs.map(x => parseFloat((x.textContent.match(/\d\.\d/) || [])[0])));
    ok(pl.join('|') === '★ 4.0+|Top rated' && shown2 === 3 && order.every((x, i) => !i || order[i - 1] >= x), `@${w} removing a pill drops just that filter (${shown2} places, by rating ${order})`);
    await page.click(`${NB} [data-ccb-pills] [data-gp-clear]`); await page.waitForTimeout(150);
    ok(!(await page.$(`${NB} [data-ccb-pills] .pill`)) && (await page.$$('[data-gp-body] .place-row')).length === 4, `@${w} Clear all`);
    // ---- markers: saved spots = category icon + gold star; legend only with several categories ----
    const saved = await page.evaluate(() => window.__markers.filter(m => m.on && m.o.zIndex === 4000).map(m => decodeURIComponent((m.o.icon || {}).url || '')));
    ok(saved.length >= 6 && saved.every(u => /#E8A100/.test(u)) && saved.some(u => u.includes('#8A5A2B')) && saved.some(u => u.includes('#E25A1C')), `@${w} saved spots: their category icon with a gold star (${saved.length})`);
    const leg = await page.$$eval('[data-slot="map-cats"] > span', xs => xs.map(x => x.textContent));
    ok(leg.join() === 'Restaurants,Cafés', `@${w} legend while two categories are on the map: ${leg}`);
    await page.evaluate(() => window.__gmap.setZoom(11)); await page.waitForTimeout(100);
    const sz = await page.evaluate(() => window.__markers.filter(m => m.on && (m.o.zIndex || 500) === 500).map(m => m.o.icon.scaledSize.w));
    ok(sz.length && sz.every(x => x < 30), `@${w} markers shrink when zoomed out (${sz[0]} px)`);
    // ---- dropdown fits the screen; no overflow ----
    await page.click(`${NB} [data-dd="cat"] [data-dd-btn]`);
    const pop = await page.$eval(`${NB} [data-dd="cat"] .dd-pop`, p => { const r = p.getBoundingClientRect(); return [r.left, r.right, document.documentElement.clientWidth, [...p.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 44)]; });
    ok(pop[0] >= 0 && pop[1] <= pop[2] && pop[3], `@${w} category list on screen, 44 px rows ${JSON.stringify(pop)}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/cc-cat-${w}.png` });
    await page.keyboard.press('Escape');
    ok((await overflow(page, '[data-panel="nearby"]')).length === 0, `@${w} Nearby: no overflow ${await overflow(page, '[data-panel="nearby"]')}`);
    // ---- remembered per trip ----
    await page.goto(BASE + '?demo=japan#t=nearby'); await page.waitForSelector('[data-gp-body] .place-row', { timeout: 15000 }); await page.waitForTimeout(500);
    ok(await label(page, 'city') === 'Kyoto' && await label(page, 'cat') === 'Restaurants', `@${w} reopened: still Kyoto · Restaurants`);
    ok((await page.$$eval('[data-gp-body] .place-row b', bs => bs.map(b => b.textContent))).every(x => /@34\.99/.test(x)), `@${w} reopened: Kyoto's places listed`);
    // ---- My trip: Kyoto · Restaurants ----
    await page.click('.ev-tabs [data-tab-go="mytrip"]'); await page.waitForSelector(`${TRIP} [data-dd="cat"]`);
    ok(await label(page, 'city', TRIP) === 'All cities' && await label(page, 'cat', TRIP) === 'All categories', `@${w} My trip opens on everything`);
    const allPlan = await page.$$eval('#sec-plan .plan-row', xs => xs.length);
    await pick(page, 'city', '1', TRIP); await pick(page, 'cat', 'restaurants', TRIP);
    const plan = await page.$$eval('#sec-plan .plan-row', xs => xs.map(x => x.querySelector('.plan-name, .plan-t > span:not(.cci)').textContent));
    ok(plan.join() === 'Nishiki Market', `@${w} Kyoto · Restaurants in Your itinerary: ${plan} (of ${allPlan})`);
    const spots = await page.$$eval('#sec-spots .sub-h', hs => hs.map(h => h.textContent)); const spotN = await page.$$eval('#sec-spots .spots li', xs => xs.map(x => x.querySelector('b').textContent.trim()));
    ok(spots.join() === 'Kyoto' && spotN.length === 1 && /Nishiki Market/.test(spotN[0]), `@${w} Saved spots: Kyoto only → ${spotN}`);
    ok(await page.$$eval('#sec-itinerary ul.bookings > li', xs => xs.every(x => x.hidden)) && await page.isVisible('#sec-itinerary .cc-none'), `@${w} bookings: none are Kyoto restaurants`);
    await pick(page, 'cat', 'hotels', TRIP);
    const bk = await page.$$eval('#sec-itinerary ul.bookings > li:not([hidden]) b', bs => bs.map(b => b.textContent));
    ok(bk.join() === 'Hotel Granvia Kyoto', `@${w} Kyoto · Hotels → ${bk}`);
    const catCounts = await page.$$eval(`${TRIP} [data-dd="cat"] [data-dd-v] small`, xs => xs.map(x => +x.textContent));
    ok(catCounts.length >= 3 && catCounts.every(n => n > 0), `@${w} category list shows Kyoto counts ${catCounts}`);
    // All cities · Cafés, then Saved only + search (focus kept while typing)
    await pick(page, 'city', '', TRIP); await pick(page, 'cat', 'cafes', TRIP);
    let cafes = await page.$$eval('#sec-plan .plan-row .plan-name', bs => bs.map(b => b.textContent));
    ok(cafes.sort().join() === '% Arabica Kyoto Arashiyama,Blue Bottle Coffee Kiyosumi-Shirakawa', `@${w} All cities · Cafés → ${cafes}`);
    await page.click(`${TRIP} [data-cc-filters]`); await page.click(`${TRIP} [data-cct-show="saved"]`); await page.click(`${TRIP} [data-cct-group="type"]`); await page.click(`${TRIP} .cc-sheet [data-cc-close].primary`);
    ok((await page.$$eval(`${TRIP} [data-ccb-pills] .pill span`, ss => ss.map(s => s.textContent))).join() === 'Saved only' && await page.textContent('#sec-plan .sub-h') === 'Cafés', `@${w} Saved only as a pill; grouped by type`);
    await page.click(`${TRIP} [data-cct-q]`); await page.keyboard.type('arab', { delay: 30 }); await page.waitForTimeout(300);
    cafes = await page.$$eval('#sec-plan .plan-row .plan-name', bs => bs.map(b => b.textContent));
    ok(cafes.join() === '% Arabica Kyoto Arashiyama' && await page.evaluate(() => document.activeElement.matches('[data-cct-q]')), `@${w} search “arab” → ${cafes} (focus kept)`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/cc-mytrip-${w}.png` });
    ok((await overflow(page, '[data-panel="mytrip"]')).length === 0, `@${w} My trip: no overflow ${await overflow(page, '[data-panel="mytrip"]')}`);
    // the Itinerary shares the selection
    await page.click('.ev-tabs [data-tab-go="event"]'); await page.waitForSelector(`${ITIN} [data-dd="cat"]`);
    ok(await label(page, 'cat', ITIN) === 'Cafés' && await page.inputValue(`${ITIN} [data-cct-q]`) === 'arab', `@${w} Itinerary shows the same selection`);
    await page.fill(`${ITIN} [data-cct-q]`, ''); await page.waitForTimeout(250);
    await page.click(`${ITIN} [data-cc-filters]`); await page.click(`${ITIN} [data-cct-show=""]`); await page.click(`${ITIN} .cc-sheet [data-cc-close].primary`);
    await pick(page, 'city', '1', ITIN); await pick(page, 'cat', 'restaurants', ITIN);
    const legs = await page.$$eval('#sec-schedule .leg-h b', bs => bs.map(b => b.textContent)); const items = await page.$$eval('#sec-schedule .tl li b', bs => bs.map(b => b.textContent.trim()));
    ok(legs.join() === 'Kyoto' && items.length >= 1 && items.every(x => /Nishiki/.test(x)), `@${w} Itinerary Kyoto · Restaurants: ${legs} → ${items.join(' | ')}`);
    await pick(page, 'cat', '', ITIN);
    const kyotoAll = await page.$$eval('#sec-schedule .tl li b', bs => bs.map(b => b.textContent.trim()));
    ok(kyotoAll.some(x => /Fushimi Inari/.test(x)) && !kyotoAll.some(x => /Tsukiji|Dotonbori/.test(x)), `@${w} Itinerary Kyoto · everything: ${kyotoAll.length} items, no Tokyo/Osaka`);
    if (SHOTS) await page.locator('#sec-schedule').screenshot({ path: `${SHOTS}/cc-itin-${w}.png` });
    ok((await overflow(page, '[data-panel="event"]')).length === 0, `@${w} Itinerary: no overflow`);
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  // ---- deep link: ?city=kyoto&cat=restaurants (no tab) → Nearby on Kyoto · Restaurants; My trip + Itinerary too ----
  {
    const { ctx, page, errors, reqs } = await mk(browser, 390);
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '?demo=japan&city=kyoto&cat=restaurants'); await page.waitForSelector('[data-gp-body] .place-row', { timeout: 15000 }); await page.waitForTimeout(500);
    ok(await page.isVisible('[data-panel="nearby"]') && await label(page, 'city') === 'Kyoto' && await label(page, 'cat') === 'Restaurants', 'link opens Nearby on Kyoto · Restaurants');
    const lists = reqs.filter(x => /searchNearby/.test(x.url) && (x.b.includedTypes || []).includes('restaurant') && x.b.maxResultCount === 20 && !x.b.rankPreference);
    ok(lists.length && lists.every(x => near(ctr(x).latitude, CITY.kyoto[0], 0.05)), `link: Kyoto restaurants searched, never Tokyo first (${lists.map(x => ctr(x).latitude.toFixed(3))})`);
    await page.click('.ev-tabs [data-tab-go="mytrip"]'); await page.waitForTimeout(200);
    ok(await label(page, 'city', TRIP) === 'Kyoto' && await label(page, 'cat', TRIP) === 'Restaurants', 'link: My trip on Kyoto · Restaurants');
    ok(errors.length === 0, `link: no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  // ---- Japanese ----
  {
    const { ctx, page, errors } = await mk(browser, 390, 'ja-JP');
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '?demo=japan&lang=ja#t=mytrip'); await page.waitForSelector(`${TRIP} [data-dd="cat"]`, { timeout: 15000 }); await page.waitForTimeout(400);
    ok(await label(page, 'city', TRIP) === 'すべての都市' && await label(page, 'cat', TRIP) === 'すべてのカテゴリ', `ja: ${await label(page, 'city', TRIP)} · ${await label(page, 'cat', TRIP)}`);
    const ph = await page.getAttribute(`${TRIP} [data-cct-q]`, 'placeholder'); ok(ph === '旅行内を検索', `ja: search placeholder ${ph}`);
    await page.click('.ev-tabs [data-tab-go="nearby"]'); await page.waitForSelector('[data-gp-body] .place-row', { timeout: 15000 });
    ok(/で検索$/.test(await page.getAttribute('[data-gp-q]', 'placeholder')) && await label(page, 'cat') !== 'Restaurants', `ja: Nearby “${await page.getAttribute('[data-gp-q]', 'placeholder')}” · ${await label(page, 'cat')}`);
    ok(errors.length === 0, `ja: no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
