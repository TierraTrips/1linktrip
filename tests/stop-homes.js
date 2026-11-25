// Each route stop owns its map, its hotel and its saved spots (Dylan 11/20: "Kyoto is still showing the arima map and
// saved places. We need a better system/redesign"). A city's map centers on its own point (or its hotel when that hotel
// is IN the city); hotels and saved spots are tied to a stop id and checked against where they are — never by the city's
// position in the route, its name/`city` text or a hotel-name cache.
//   Part 1: a legacy page like Dylan's Japan trip (no stop ids, Takayama added last, an "Arima onsen: ryokan" check-in
//           dated during Kyoto that his device had found at Arima, an old map pick with a position-in-route `city`, saved
//           spots with no stop) heals at load: tabs in date order, Kyoto centers on Kyoto with Kyoto's hotel and spots.
//   Part 2: the editor — Insert a stop, Change Kyoto → Takayama, Move trip dates — with the guest's spots saved per city
//           before the edits: every tab centers on its own stop, nothing of Kyoto's shows under Takayama.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/stop-homes.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const GEO = { hakone: [35.2324, 139.1069, 'Hakone', 'Kanagawa'], takayama: [36.1461, 137.2522, 'Takayama', 'Gifu'], 'arima onsen': [34.7968, 135.2477, 'Kobe', 'Hyogo'], kyoto: [35.0116, 135.7681, 'Kyoto', 'Kyoto'], tokyo: [35.6764, 139.65, 'Tokyo', 'Tokyo'], osaka: [34.6937, 135.5023, 'Osaka', 'Osaka'], kanazawa: [36.5597, 136.652, 'Kanazawa', 'Ishikawa'],
  'osaka: the royal park': [34.6855, 135.5005, 'Osaka', 'Osaka'], 'tokyo: hotel metropolitan': [35.7016, 139.7446, 'Tokyo', 'Tokyo'] };
const P = (name, k, from, to) => ({ name, address: `${GEO[k][2]}, Japan`, lat: GEO[k][0], lon: GEO[k][1], city: GEO[k][2], region: GEO[k][3], country: 'Japan', cc: 'jp', from, to });
const km = (a, b) => { const r = Math.PI / 180, x = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
const TOOLS = { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false };
async function setup(browser, w = 390) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.route(/nominatim\.openstreetmap\.org\/search/, r => { const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q') || '').toLowerCase(); const k = Object.keys(GEO).sort((a, b) => b.length - a.length).find(x => q.startsWith(x));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(k ? [{ name: k[0].toUpperCase() + k.slice(1), lat: String(GEO[k][0]), lon: String(GEO[k][1]), display_name: `${GEO[k][2]}, Japan`, addresstype: 'city', address: { city: GEO[k][2], state: GEO[k][3], country: 'Japan', country_code: 'jp' } }] : []) }); });
  await page.route(/googleapis|gstatic|overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|photon|functions\/v1|supabase\.co/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  return { ctx, page };
}
const keyOf = (page, c) => page.evaluate((x) => window.__ep.itinKeyOf(window.__ep.normalize(JSON.parse(JSON.stringify(x)))).slice(5), c);
const center = (page) => page.evaluate(() => { const m = document.querySelector('[data-slot="map"]')._leafletMap; if (!m) return null; const c = m.getCenter(); return [c.lat, c.lng]; });
// every Nearby city tab: [label, map center, hotel bar text]
async function tabs(page) {
  const opts = await page.$$eval('[data-panel="nearby"] [data-dd="city"] [data-dd-v]', bs => bs.map(b => [b.dataset.ddV, b.textContent.trim()]));
  const out = [];
  for (const [v, l] of opts) { await page.click(`[data-panel="nearby"] [data-dd="city"] [data-dd-v="${v}"]`); await page.waitForTimeout(700);
    out.push({ l, c: await center(page), bar: await page.$eval('[data-slot="hotel"]', e => e.textContent.replace(/\s+/g, ' ')).catch(() => '') }); }
  return out;
}
const homes = (page) => page.evaluate(() => { const c = window.__epCfg; return window.__ep.spotsByCity(c).map(g => ({ city: g.city, hotels: g.hotels.map(h => h.name), spots: g.spots.map(x => x.name) })); });
const grab = (page, packed) => page.evaluate((p) => { window.__epCfg = window.__ep.unpackEvent ? window.__ep.unpackEvent(p) : null; return !!window.__epCfg; }, packed);

(async () => {
  const browser = require('./_open-settings')(await chromium.launch());
  try {
    // ---------------- Part 1: Dylan's legacy Japan page heals at load ----------------
    { const { ctx, page } = await setup(browser, 390);
      const LEG = { v: 2, type: 'Trip', title: 'Japan Trip (legacy)', start: '2027-04-25', end: '2027-06-02', tz: 'Asia/Tokyo',
        venue: { name: 'Japan', address: 'Japan', lat: 36.20482, lon: 138.25292, city: '', country: 'Japan', cc: 'jp' },
        stops: [P('Tokyo', 'tokyo', '2027-04-26', '2027-05-02'), P('Kanazawa', 'kanazawa', '2027-05-02', '2027-05-06'), P('Kyoto', 'kyoto', '2027-05-10', '2027-05-22'), P('Osaka', 'osaka', '2027-05-22', '2027-05-28'), P('Tokyo', 'tokyo', '2027-05-28', '2027-06-02'), P('Takayama', 'takayama', '2027-05-06', '2027-05-10')],
        schedule: [{ date: '2027-04-26', time: '', title: 'Tokyo: Hotel Metropolitan Edmont Tokyo (Iidabashi), 6 nights', note: '' }, { date: '2027-05-20', time: '', title: 'Arima onsen: ryokan, 2 nights (not chosen yet)', note: '' }, { date: '2027-05-22', time: '', title: 'Osaka: The Royal Park Hotel Iconic Osaka Midosuji, 6 nights', note: '' }],
        tools: TOOLS };
      LEG.stops.forEach(s => delete s.id);
      const k = await keyOf(page, LEG);
      await page.evaluate(([k]) => { localStorage.clear();
        // Dylan's device: the Arima ryokan was found at Arima (it was "Kyoto's hotel"), spots saved with no stop
        localStorage.setItem('ep:hgeo:arima onsen: ryokan, 2 nights (not chosen yet)', JSON.stringify({ lat: 34.7968, lon: 135.2477, addr: 'Arima Onsen, Kobe', ref: '' }));
        localStorage.setItem('ep:plan:' + k, JSON.stringify([
          { id: 'p1', src: 'osm', ref: 'n1', name: 'Kinkaku-ji', lat: 35.0394, lon: 135.7292, type: 'sight', day: '', time: '', note: '' },
          { id: 'p2', src: 'osm', ref: 'n2', name: 'Kin no Yu', lat: 34.7975, lon: 135.2478, type: 'sight', day: '', time: '', note: '' },
          { id: 'p3', src: 'osm', ref: 'n3', name: 'Sanmachi Suji', lat: 36.1408, lon: 137.2595, type: 'sight', day: '', time: '', note: '' },
          { id: 'p4', src: 'osm', ref: 'n4', name: 'Senso-ji', lat: 35.7148, lon: 139.7967, type: 'sight', day: '', time: '', note: '' }]));
        // an old map pick in Kyoto: city = its position in the route back then (2 = Kyoto; Takayama now sorts before it)
        localStorage.setItem('ep:itin:' + k, JSON.stringify([{ id: 'h1', kind: 'hotel', name: 'Hotel Kanra Kyoto', address: 'Kyoto', lat: 34.996, lon: 135.760, city: 2, pin: 1, guess: 1, start: '2027-05-10', end: '2027-05-22' }])); }, [k]);
      const gp = await page.evaluate((x) => window.__ep.packEvent(x), LEG);
      await page.goto(BASE + '#e=' + gp + '&t=nearby'); await page.waitForSelector('[data-panel="nearby"]'); await page.waitForTimeout(3000);
      const ts = await tabs(page);
      ok(ts.map(x => x.l).join() === 'Tokyo,Kanazawa,Takayama,Kyoto,Osaka', `tabs in date order (Takayama was added last): ${ts.map(x => x.l)}`);
      const want = { Tokyo: GEO.tokyo, Kanazawa: GEO.kanazawa, Takayama: GEO.takayama, Kyoto: GEO.kyoto, Osaka: GEO.osaka };
      ts.forEach(x => ok(x.c && km(x.c, want[x.l]) < 25, `${x.l} tab: map on ${x.l} (${x.c && km(x.c, want[x.l]).toFixed(1)} km from it)`));
      const ky = ts.find(x => x.l === 'Kyoto');
      ok(ky && km(ky.c, GEO['arima onsen']) > 40 && !/Arima/.test(ky.bar) && /Hotel Kanra Kyoto/.test(ky.bar) && /Your hotel in Kyoto/.test(ky.bar), `Kyoto: not the Arima map; its own hotel: ${ky && ky.bar.slice(0, 90)}`);
      ok(!ts.some(x => /Arima/.test(x.bar)), `the Arima ryokan (not chosen, in no route city) is no city's hotel`);
      ok(/Hotel Kanra/.test(ky.bar) && !/Hotel Kanra/.test(ts.find(x => x.l === 'Takayama').bar), `the old map pick stays in Kyoto, not route position 2 (now Takayama)`);
      const it = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k)), k);
      const pl = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:plan:' + k)), k);
      await grab(page, gp);
      const ids = await page.evaluate(() => window.__ep.ccCities(window.__epCfg).reduce((o, c) => (o[c.l] = c.id, o), {}));
      ok(!('city' in it[0]) && it[0].stopId === ids.Kyoto, `migrated: the map pick is tied to Kyoto's stop id (${it[0].stopId} / ${ids.Kyoto}), its route position dropped`);
      ok(pl.find(x => x.id === 'p1').stopId === ids.Kyoto && pl.find(x => x.id === 'p3').stopId === ids.Takayama && pl.find(x => x.id === 'p4').stopId === ids.Tokyo && pl.find(x => x.id === 'p2').stopId === ids.Osaka, `migrated: saved spots tied to the stop they are in (Arima's → nearest, Osaka) ${JSON.stringify(pl.map(x => [x.name, x.stopId]))}`);
      const h = await homes(page);
      const g = (c) => h.find(x => x.city === c) || { hotels: [], spots: [] };
      ok(g('Kyoto').spots.join() === 'Kinkaku-ji' && g('Kyoto').hotels.join() === 'Hotel Kanra Kyoto', `Saved spots → Kyoto: Kyoto's own ${JSON.stringify(g('Kyoto'))}`);
      ok(g('Takayama').spots.join() === 'Sanmachi Suji' && g('Tokyo').spots.join() === 'Senso-ji' && !h.some(x => x.city !== 'Osaka' && x.spots.includes('Kin no Yu')), `Saved spots per city ${JSON.stringify(h)}`);
      if (SHOTS) { await page.click('[data-panel="nearby"] [data-dd="city"] [data-dd-v="3"]'); await page.waitForTimeout(600); await page.screenshot({ path: `${SHOTS}/stop-homes-kyoto.png` }); }
      // reload: nothing moves again
      await page.reload(); await page.waitForSelector('[data-panel="nearby"]'); await page.waitForTimeout(800);
      ok(JSON.stringify(await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:plan:' + k)), k)) === JSON.stringify(pl), `reload: the migration is stable`);
      ok(!page._err.length, `legacy page: no page errors ${page._err}`); await ctx.close(); }

    // ---------------- Part 2: editor edits after spots were saved per city ----------------
    { const { ctx, page } = await setup(browser, 390);
      const CFG = { v: 2, type: 'Trip', title: 'Homes trip', start: '2027-04-02', end: '2027-04-10', tz: 'Asia/Tokyo',
        venue: { name: 'Japan', address: 'Japan', lat: 36.2, lon: 138.25, city: '', country: 'Japan', cc: 'jp' },
        stops: [P('Tokyo', 'tokyo', '2027-04-02', '2027-04-05'), P('Kyoto', 'kyoto', '2027-04-05', '2027-04-08'), P('Osaka', 'osaka', '2027-04-08', '2027-04-10')],
        schedule: [{ date: '2027-04-05', time: '15:00', title: 'Check in: Hotel Granvia Kyoto', note: '' }], tools: TOOLS };
      const k = await keyOf(page, CFG);
      const ids0 = await page.evaluate((x) => window.__ep.normalize(JSON.parse(JSON.stringify(x))).stops.map(s => s.id), CFG);
      await page.evaluate(([k, ids]) => { localStorage.clear();
        localStorage.setItem('ep:hgeo:hotel granvia kyoto', JSON.stringify({ lat: 34.985, lon: 135.758, addr: 'Kyoto', ref: '' }));
        localStorage.setItem('ep:plan:' + k, JSON.stringify([
          { id: 'q1', src: 'osm', ref: 'm1', name: 'Asakusa', lat: 35.7148, lon: 139.7967, type: 'sight', stopId: ids[0], day: '', time: '', note: '' },
          { id: 'q2', src: 'osm', ref: 'm2', name: 'Fushimi Inari', lat: 34.9671, lon: 135.7727, type: 'sight', stopId: ids[1], day: '', time: '', note: '' },
          { id: 'q3', src: 'osm', ref: 'm3', name: 'Dotonbori', lat: 34.6687, lon: 135.5013, type: 'food', stopId: ids[2], day: '', time: '', note: '' }]));
        localStorage.setItem('ep:itin:' + k, JSON.stringify([{ id: 'h2', kind: 'hotel', name: 'Piece Hostel Sanjo', address: 'Kyoto', lat: 35.009, lon: 135.771, stopId: ids[1], pin: 1, guess: 1, start: '2027-04-05', end: '2027-04-08' }])); }, [k, ids0]);
      const packed = await page.evaluate((c) => window.__ep.packEvent(c), CFG);
      await page.goto(BASE + '#edit=' + packed); await page.waitForSelector('[data-card="route"]');
      await page.click('[data-card="route"]'); await page.waitForSelector('#sheet .st-row');
      // Insert a stop after Tokyo → Hakone
      await page.click('#sheet [data-st-ins="0"]'); await page.waitForTimeout(400);
      await page.fill('#sheet [data-st-q="1"]', 'Hakone'); await page.click('#sheet [data-st-find="1"]'); await page.waitForFunction(() => /Hakone/.test(document.querySelector('#sheet .route-ed').textContent), null, { timeout: 8000 });
      // Change Kyoto → Takayama (same dates, same stop id, new place)
      const ki = await page.$$eval('#sheet .st-row', ls => ls.findIndex(l => /Kyoto/.test((l.querySelector('.venue-sel b') || {}).textContent || '')));
      await page.click(`#sheet [data-st-clear="${ki}"]`); await page.waitForTimeout(300);
      await page.fill(`#sheet [data-st-q="${ki}"]`, 'Takayama'); await page.click(`#sheet [data-st-find="${ki}"]`); await page.waitForFunction(() => /Takayama/.test(document.querySelector('#sheet .route-ed').textContent), null, { timeout: 8000 });
      // Move trip dates +34 days
      await page.click('#sheet [data-sh="open"]'); await page.$eval('#sheet #sh-start', (el) => { el.value = '2027-05-06'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(400);
      await page.click('#sheet [data-sh="apply"]'); await page.waitForTimeout(500);
      const c = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
      const by = Object.fromEntries(c.stops.map(s => [s.name, s]));
      ok(c.stops.map(s => s.name).join() === 'Tokyo,Hakone,Takayama,Osaka' && by.Takayama.id === ids0[1] && by.Tokyo.id === ids0[0] && by.Osaka.id === ids0[2] && by.Hakone.id && !ids0.includes(by.Hakone.id), `ids: Takayama keeps Kyoto's stop id, Hakone has its own ${JSON.stringify(c.stops.map(s => [s.name, s.id, s.from]))}`);
      ok(Math.abs(by.Takayama.lat - 36.1461) < 0.01 && by.Takayama.city === 'Takayama' && c.stops[0].from === '2027-05-06', `Takayama's point is Takayama's; dates moved`);
      // the guest page of the edited trip
      const gp = await page.evaluate((x) => window.__ep.packEvent(x), c);
      await page.goto(BASE + '#e=' + gp + '&t=nearby'); await page.waitForSelector('[data-panel="nearby"]'); await page.waitForTimeout(2500);
      const ts = await tabs(page);
      ok(ts.map(x => x.l).join() === 'Tokyo,Hakone,Takayama,Osaka', `guest tabs ${ts.map(x => x.l)}`);
      const want = { Tokyo: GEO.tokyo, Hakone: GEO.hakone, Takayama: GEO.takayama, Osaka: GEO.osaka };
      ts.forEach(x => ok(x.c && km(x.c, want[x.l]) < 25, `${x.l} tab: map on ${x.l} (${x.c && km(x.c, want[x.l]).toFixed(1)} km)`));
      const tk = ts.find(x => x.l === 'Takayama');
      ok(!/Piece Hostel|Granvia/.test(tk.bar), `Takayama: Kyoto's hotels (the map pick with Kyoto's old stop id, the host's Granvia) are not its hotel: ${tk.bar.slice(0, 80)}`);
      await grab(page, gp); const h = await homes(page); const g = (n) => h.find(x => x.city === n) || { hotels: [], spots: [] };
      ok(!g('Takayama').spots.length && !g('Takayama').hotels.length, `Takayama has none of Kyoto's spots ${JSON.stringify(h)}`);
      ok(g('Osaka').spots.includes('Fushimi Inari') && g('Osaka').spots.includes('Dotonbori') && g('Tokyo').spots.join() === 'Asakusa' && !g('Hakone').spots.length, `Kyoto's spot re-homes to the nearest city (Osaka); others stay ${JSON.stringify(h)}`);
      // a reorder (sort) and a rename keep homes by id: Osaka's stop moved first still owns Dotonbori
      const r = await page.evaluate(() => { const c = JSON.parse(JSON.stringify(window.__epCfg)); const o = c.stops.find(s => s.name === 'Osaka'); o.from = '2027-05-01'; o.to = '2027-05-06'; window.__ep.sortStops(c);
        o.name = 'Osaka (Namba)'; return window.__ep.spotsByCity(c).map(g => [g.city, g.spots.map(x => x.name).join('+')]); });
      ok(JSON.stringify(r).includes('["Osaka (Namba)","Fushimi Inari+Dotonbori"]') && r[0][0] === 'Osaka (Namba)', `reordered + renamed: spots follow the stop ${JSON.stringify(r)}`);
      ok(!page._err.length, `editor + guest: no page errors ${page._err}`); await ctx.close(); }

    // ---------------- unit: homeCity rules ----------------
    { const { ctx, page } = await setup(browser, 390);
      const r = await page.evaluate(() => { const E = window.__ep; const c = E.normalize({ v: 2, type: 'Trip', title: 'u', start: '2027-04-02', end: '2027-04-12', venue: { name: 'Japan', lat: 36, lon: 138 },
        stops: [{ name: 'Kyoto', lat: 35.0116, lon: 135.7681, city: 'Kyoto', from: '2027-04-02', to: '2027-04-06' }, { name: 'Osaka', lat: 34.6937, lon: 135.5023, city: 'Osaka', from: '2027-04-06', to: '2027-04-09' }, { name: 'Arima Onsen', lat: 34.7968, lon: 135.2477, city: 'Kobe', from: '2027-04-09', to: '2027-04-10' }, { name: 'Kobe', lat: 34.6901, lon: 135.1955, city: 'Kobe', from: '2027-04-10', to: '2027-04-12' }] });
        const ids = c.stops.map(s => s.id);
        return { cities: E.ccCities(c).map(x => x.l),
          arimaRyokanInKyotoDates: E.homeCity(c, { lat: 34.7968, lon: 135.2477 }, { day: '2027-04-03', span: ['2027-04-03', '2027-04-05'], hotel: true }),
          kyotoHotelById: E.homeCity(c, { lat: 34.985, lon: 135.758 }, { stopId: ids[2], hotel: true }),
          farHotel: E.homeCity(c, { lat: 35.77, lon: 140.39 }, { day: '2027-04-03', hotel: true }),
          spotSavedUnderOsakaInKyoto: E.homeCity(c, { lat: 35.0394, lon: 135.7292 }, { stopId: ids[1] }),
          spotNoId: E.homeCity(c, { lat: 34.80, lon: 135.25 }, {}),
          unresolvedByDay: E.homeCity(c, null, { day: '2027-04-07', hotel: true }) }; });
      ok(r.cities.join() === 'Kyoto,Osaka,Arima Onsen,Kobe', `Arima Onsen and Kobe are two cities though both say city "Kobe" ${r.cities}`);
      ok(r.arimaRyokanInKyotoDates === -1, `an Arima ryokan dated during Kyoto is not Kyoto's hotel (${r.arimaRyokanInKyotoDates})`);
      ok(r.kyotoHotelById === 0, `a hotel tied to Arima's stop but in Kyoto is Kyoto's (${r.kyotoHotelById})`);
      ok(r.farHotel === -1, `a hotel near no route city is no city's hotel (${r.farHotel})`);
      ok(r.spotSavedUnderOsakaInKyoto === 0 && r.spotNoId === 2, `spots: far from their stop → the city they are in (${r.spotSavedUnderOsakaInKyoto}, ${r.spotNoId})`);
      ok(r.unresolvedByDay === 1, `a hotel not found on the map yet goes by its dates (${r.unresolvedByDay})`);
      await ctx.close(); }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
