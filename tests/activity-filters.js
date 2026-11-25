// Activities sort + filter (Dylan 11/25: "for activities, is there a way to sort through them?").
//  A. Nearby (Google): Sights / Things to do get kind chips under the category row (Museums, Temples & landmarks, Parks &
//     outdoors, Zoos & theme parks, Shows & nightlife, Tours …; only kinds in the list, multi-select, numbers = rows they
//     list with the other filters); the Filters sheet sorts by Distance / Rating / Name and has Open now. Category change
//     and Clear filters reset the kinds; Restaurants has no kind chips.
//  B. Things to do → "Sights near the venue" list (Nearby off): Kind chips in its Filters sheet + Sort by Name.
//  C. actKind() table (pure).
// Google Places answers are generated; no network.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/activity-filters.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return false; for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.')).slice(0, 5); });

const V = { name: 'Tokyo Station', address: 'Marunouchi, Tokyo', lat: 35.6812, lon: 139.7671, city: 'Tokyo', country: 'Japan', cc: 'jp' };
// [name, primaryType, types, rating, openNow]
const SIGHTS = [
  ['Senso-ji', 'buddhist_temple', ['buddhist_temple', 'place_of_worship', 'tourist_attraction'], 4.5, true],
  ['Meiji Jingu', 'shinto_shrine', ['shinto_shrine', 'place_of_worship'], 4.6, true],
  ['Tokyo National Museum', 'museum', ['museum', 'tourist_attraction'], 4.5, false],
  ['Mori Art Museum', 'art_museum', ['art_museum', 'museum'], 4.3, true],
  ['Ueno Park', 'park', ['park', 'tourist_attraction'], 4.4, true],
  ['Shinjuku Gyoen', 'garden', ['garden', 'park'], 4.7, false],
  ['Tokyo Tower', 'observation_deck', ['observation_deck', 'tourist_attraction'], 4.4, true],
  ['Sunshine Aquarium', 'aquarium', ['aquarium'], 4.2, true],
  ['teamLab Planets', 'tourist_attraction', ['tourist_attraction', 'point_of_interest'], 4.6, true],
  ['Kabukiza Theatre', 'performing_arts_theater', ['performing_arts_theater'], 4.5, false]];
const TOURS = [
  ['Tsukiji Food Tour', 'tour_agency', ['tour_agency'], 4.9, true],
  ['Tokyo Bike Tours', 'tour_agency', ['tour_agency'], 4.8, true],
  ['Sushi Making Class', 'cooking_class', ['cooking_class'], 4.9, true],
  ['Mt Fuji day trip', 'travel_agency', ['travel_agency'], 4.4, false]];
const place = (x, i) => ({ id: 'p-' + x[0].replace(/\W+/g, '-'), displayName: { text: x[0] }, location: { latitude: V.lat + (i + 1) * 0.003, longitude: V.lon + 0.001 }, rating: x[3], userRatingCount: 100 + i, primaryType: x[1], primaryTypeDisplayName: { text: x[1].replace(/_/g, ' ') }, types: x[2], currentOpeningHours: { openNow: x[4] }, shortFormattedAddress: 'Tokyo' });

async function newPage(browser, w, cfg, tab) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: w < 600, hasTouch: w < 600, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.route('https://places.googleapis.com/**', (r) => {
    const b = JSON.parse(r.request().postData() || '{}'); const ty = (b.includedTypes || [])[0]; let xs = [];
    if (/searchText/.test(r.request().url()) && /tours and experiences/.test(b.textQuery || '')) xs = TOURS;
    else if (ty === 'tourist_attraction') xs = SIGHTS;
    else if (ty === 'restaurant') xs = [['Sushi Dai', 'sushi_restaurant', ['sushi_restaurant', 'restaurant'], 4.5, true], ['Ichiran', 'ramen_restaurant', ['ramen_restaurant', 'restaurant'], 4.3, true]];
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: xs.map(place) }) });
  });
  await page.route(/open-meteo|overpass|maps\.mail\.ru|tile\.openstreetmap|timeapi|nominatim|photon|maps\.googleapis|gstatic|functions\/v1|auth\/v1|rest\/v1/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  await page.evaluate(() => localStorage.clear());
  const packed = await page.evaluate((c) => window.__ep.packEvent(window.__ep.normalize(c)), cfg);
  await page.goto(BASE + '#e=' + packed + '&t=' + tab); await page.reload();
  return { ctx, page };
}
const NEAR = '[data-ccb="near"]';
const names = (page) => page.$$eval('[data-gp-body] .place-row b', bs => bs.map(b => b.textContent));
const kchips = (page) => page.$$eval(`${NEAR} [data-dd="atype"] .cc-chip`, cs => cs.map(c => ({ v: c.dataset.ddV, l: c.querySelector('span').textContent, on: c.getAttribute('aria-pressed') === 'true', n: +(c.querySelector('small') || {}).textContent })));
const tapK = async (page, v) => { await page.click(`${NEAR} [data-dd="atype"] [data-dd-v="${v}"]`); await page.waitForTimeout(150); };
const cat = async (page, v) => { await page.click(`${NEAR} [data-dd="cat"] [data-dd-v="${v}"]`); await page.waitForSelector('[data-gp-body] .place-row, [data-gp-body] .muted'); await page.waitForTimeout(250); };
const sheet = async (page, sel) => { await page.click(`${NEAR} [data-cc-filters]`); await page.waitForTimeout(150); await page.click(`${NEAR} .cc-sheet ${sel}`); await page.waitForTimeout(100); await page.click(`${NEAR} .cc-sheet [data-cc-close].primary`); await page.waitForTimeout(150); };

(async () => {
  const browser = await chromium.launch();
  try {
    // ---- C. kinds (pure) ----
    {
      const { ctx, page } = await newPage(browser, 390, { v: 2, type: 'Trip', title: 'Kinds', start: '2027-04-01', end: '2027-04-05', tz: 'Asia/Tokyo', venue: V, tools: { nearby: true, travel: false, stay: false, tours: false, mytrip: false, weather: false, packing: false } }, 'event');
      const k = await page.evaluate((S) => S.map(x => window.__ep.actKind({ name: x[0], ptype: x[1], types: x[2] })), SIGHTS.concat(TOURS));
      ok(k.join() === 'landmarks,landmarks,museums,museums,outdoors,outdoors,landmarks,family,family,shows,tours,tours,tours,tours', `kinds: ${k.join()}`);
      const k2 = await page.evaluate(() => ['amusement_park', 'water_park', 'national_park', 'spa', 'public_bath', 'night_club', 'market'].map(t => window.__ep.actKind({ name: 'x', ptype: t, types: [t] })));
      ok(k2.join() === 'family,family,outdoors,wellness,wellness,shows,shopping', `amusement/water park are theme parks, not parks; spa/bath/club/market: ${k2.join()}`);
      const k3 = await page.evaluate(() => ['Kinkaku-ji', '伏見稲荷大社', 'Gion evening walk', 'Random Place'].map(n => window.__ep.actKind({ name: n, ptype: 'tourist_attraction', types: ['tourist_attraction'] })));
      ok(k3.join() === 'other,landmarks,tours,other', `by name when the type is generic: ${k3.join()}`);
      await ctx.close();
    }
    // ---- A. Nearby (Google) ----
    for (const w of [390, 1280]) {
      const cfg = { v: 2, type: 'Trip', title: 'Activities ' + w, start: '2027-04-01', end: '2027-04-05', tz: 'Asia/Tokyo', venue: V, tools: { nearby: true, travel: false, stay: false, tours: false, mytrip: false, weather: false, packing: false } };
      const { ctx, page } = await newPage(browser, w, cfg, 'nearby');
      await page.waitForSelector(`${NEAR} [data-dd="cat"]`);
      await cat(page, 'sights');
      let n = await names(page); ok(n.length === 10, `@${w} sights: 10 rows (${n.length})`);
      let k = await kchips(page);
      ok(k.map(x => x.v).join() === 'museums,landmarks,outdoors,family,shows', `@${w} kind chips (only kinds present, in order): ${k.map(x => x.l + ' ' + x.n).join(' | ')}`);
      ok(k.map(x => x.n).join() === '2,3,2,2,1' && k.every(x => !x.on), `@${w} kind numbers ${k.map(x => x.n)}`);
      await tapK(page, 'museums'); n = await names(page);
      ok(n.join() === 'Tokyo National Museum,Mori Art Museum', `@${w} Museums → ${n}`);
      await tapK(page, 'landmarks'); n = await names(page);
      ok(n.length === 5 && n.includes('Senso-ji') && n.includes('Tokyo Tower') && n.includes('Mori Art Museum'), `@${w} Museums + Temples & landmarks (multi-select) → ${n}`);
      ok(/5 places/.test(await page.textContent('[data-gp-body] .pf-count')), `@${w} count line follows (5 places)`);
      // sort by name, then rating, from the Filters sheet
      await sheet(page, '[data-gp-sort="name"]'); n = await names(page);
      ok(n.join() === [...n].sort((a, b) => a.localeCompare(b)).join() && n[0] === 'Meiji Jingu', `@${w} Sort by Name → ${n}`);
      const pills = await page.$$eval(`${NEAR} [data-ccb-pills] .pill span`, ss => ss.map(s => s.textContent)); ok(pills.includes('A–Z'), `@${w} A–Z pill (${pills})`);
      await sheet(page, '[data-gp-sort="rating"]'); n = await names(page);
      ok(n[0] === 'Meiji Jingu' && n[n.length - 1] === 'Mori Art Museum', `@${w} Sort by Rating → ${n}`);
      // open now narrows, and the kind numbers follow it
      await sheet(page, '[data-gp-open]'); n = await names(page); k = await kchips(page);
      ok(n.length === 4 && !n.includes('Tokyo National Museum'), `@${w} + Open now → ${n}`);
      ok(k.find(x => x.v === 'museums').n === 1 && k.find(x => x.v === 'outdoors').n === 1, `@${w} kind numbers with Open now: ${k.map(x => x.v + ' ' + x.n).join(', ')}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/nearby-sights-${w}.png`, fullPage: false });
      ok(!(await overflow(page)).length, `@${w} no overflow ${await overflow(page)}`);
      // Clear filters resets kinds + sort + open
      await page.click('[data-gp-body] [data-gp-clear]'); await page.waitForTimeout(150); n = await names(page); k = await kchips(page);
      ok(n.length === 10 && k.every(x => !x.on), `@${w} Clear filters → all 10, no kind on`);
      // Things to do: tours, a cooking class, a travel agency → one kind only → no chips
      await tapK(page, 'outdoors'); await cat(page, 'tours'); n = await names(page); k = await kchips(page);
      ok(n.length === 4 && !k.length, `@${w} Things to do: 4 rows, one kind → no chips (${k.map(x => x.v)})`);
      await sheet(page, '[data-gp-sort="name"]'); n = await names(page); ok(n[0] === 'Mt Fuji day trip' && n[3] === 'Tsukiji Food Tour', `@${w} Things to do by name → ${n}`);
      await cat(page, 'sights'); k = await kchips(page); ok(k.length && k.every(x => !x.on), `@${w} back on Sights: kinds reset`);
      await cat(page, 'restaurants'); ok(!(await page.$(`${NEAR} [data-dd="atype"]`)), `@${w} Restaurants: no kind chips`);
      ok(!page._err.length, `@${w} no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
    // ---- B. Things to do → Sights near the venue (Nearby off) ----
    {
      const cfg = { v: 2, type: 'Party', title: 'Sights list', start: '2027-04-02T19:00', end: '2027-04-03', tz: 'Asia/Tokyo', venue: V, tools: { nearby: false, travel: false, stay: false, tours: true, mytrip: false, weather: false, packing: false } };
      const { ctx, page } = await newPage(browser, 390, cfg, 'nearby');
      await page.waitForSelector('[data-lf-box="sights"] [data-lf-q]', { timeout: 15000 });
      const sn = () => page.$$eval('[data-lf-box="sights"] [data-lf-list] li:not(.more-li) b', bs => bs.map(b => b.textContent));
      await page.click('[data-lf-box="sights"] [data-cc-filters]'); await page.waitForTimeout(150);
      const kinds = await page.$$eval('[data-lf-box="sights"] .cc-sheet [data-lf-chip^="k:"]', cs => cs.map(c => c.dataset.lfChip + ' ' + c.textContent));
      ok(kinds.length >= 4 && kinds.some(x => /^k:museums Museums/.test(x)) && kinds.some(x => /^k:landmarks/.test(x)), `sights list: Kind chips in its sheet (${kinds.join(' | ')})`);
      const sorts = await page.$$eval('[data-lf-box="sights"] [data-lf-sort] option', os => os.map(o => o.value)); ok(sorts.join() === 'dist,rating,name', `sorts: ${sorts}`);
      await page.click('[data-lf-box="sights"] .cc-sheet [data-lf-chip="k:museums"]');
      await page.selectOption('[data-lf-box="sights"] [data-lf-sort]', 'name');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/sights-list-sheet-390.png` });
      await page.click('[data-lf-box="sights"] .cc-sheet [data-cc-close].primary'); await page.waitForTimeout(150);
      let n = await sn(); ok(n.join() === 'Mori Art Museum,Tokyo National Museum', `Museums by name → ${n}`);
      const pills = await page.$$eval('[data-lf-box="sights"] [data-ccb-pills] .pill span', ss => ss.map(s => s.textContent)); ok(pills.join('|') === 'Museums|Name', `pills: ${pills.join('|')}`);
      await page.click('[data-lf-box="sights"] [data-lf-unchip="k:museums"]'); n = await sn(); ok(n.length >= 8, `removing the Museums pill → all again (${n.length})`);
      if (SHOTS) await page.locator('[data-slot="sights"]').screenshot({ path: `${SHOTS}/sights-list-390.png` });
      ok(!(await overflow(page)).length, `sights list: no overflow`);
      ok(!page._err.length, `no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
