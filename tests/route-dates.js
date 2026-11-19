// Route dates made simple (builder → Route): stops stay in date order (a stop added for later dates moves to its place,
// undated stops keep theirs), "+ Insert a stop" between stops takes the gap's dates, an overlap offers "Move <stop> and
// later stops n days later" (stops, itinerary days and the trip's end move), a nights stepper, and "Move trip dates":
// new first day → preview old → new (bookings keep their dates and are named) → Move trip / Undo. Guests: their saved
// places follow the move once; a booking no longer on the trip's dates says so (card + sheet), its dates untouched.
// Map/name mismatch (Dylan 11/19: "Kyoto is showing up as Takayama"): a stop renamed without moving its point is looked
// up again at load; a hotel placed by date (or an old cached point) far from its city goes to the city it is in; stop
// ids survive renames and sorting.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/route-dates.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).length; });
const GEO = { hakone: [35.2324, 139.1069, 'Hakone', 'Kanagawa'], takayama: [36.1461, 137.2522, 'Takayama', 'Gifu'], arima: [34.7968, 135.2477, 'Kobe', 'Hyogo'], kyoto: [35.0116, 135.7681, 'Kyoto', 'Kyoto'], tokyo: [35.6764, 139.65, 'Tokyo', 'Tokyo'], osaka: [34.6937, 135.5023, 'Osaka', 'Osaka'] };
const P = (name, k, from, to) => ({ name, address: `${GEO[k][2]}, Japan`, lat: GEO[k][0], lon: GEO[k][1], city: GEO[k][2], region: GEO[k][3], country: 'Japan', cc: 'jp', from, to });
const CFG = { v: 2, type: 'Trip', title: 'Route dates trip', start: '2027-04-02', end: '2027-04-10', tz: 'Asia/Tokyo',
  venue: { name: 'Japan', address: 'Japan', lat: 36.2, lon: 138.25, city: '', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 'tokyo', '2027-04-02', '2027-04-05'), P('Kyoto', 'kyoto', '2027-04-05', '2027-04-08'), P('Osaka', 'osaka', '2027-04-08', '2027-04-10')],
  schedule: [{ date: '2027-04-03', time: '09:00', title: 'Asakusa', note: '' }, { date: '2027-04-06', time: '07:00', title: 'Fushimi Inari', note: '' }, { date: '2027-04-09', time: '18:00', title: 'Dotonbori', note: '' }],
  tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
async function setup(browser, w = 390) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.route(/nominatim\.openstreetmap\.org\/search/, r => { const q = decodeURIComponent(new URL(r.request().url()).searchParams.get('q') || '').toLowerCase(); const k = Object.keys(GEO).find(x => q.startsWith(x));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(k ? [{ name: k[0].toUpperCase() + k.slice(1), lat: String(GEO[k][0]), lon: String(GEO[k][1]), display_name: `${GEO[k][2]}, Japan`, addresstype: 'city', address: { city: GEO[k][2], state: GEO[k][3], country: 'Japan', country_code: 'jp' } }] : []) }); });
  await page.route(/googleapis|gstatic|overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|photon|functions\/v1/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  return { ctx, page };
}
const draft = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
const settle = (page) => page.waitForTimeout(450);
const rows = (page) => page.$$eval('#sheet .st-row', ls => ls.map(l => ({ n: (l.querySelector('.venue-sel b') || {}).textContent || '', from: l.querySelector('[data-k="from"]').value, to: l.querySelector('[data-k="to"]').value, nights: (l.querySelector('.st-nights span') || {}).textContent || '', note: (l.querySelector('.st-note') || {}).textContent || '' })));
const setDate = async (page, sel, v) => { await page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v); await settle(page); };

(async () => {
  const browser = await chromium.launch();
  try {
    for (const w of [390, 320]) {
      const { ctx, page } = await setup(browser, w);
      const packed = await page.evaluate((c) => window.__ep.packEvent(c), CFG);
      // the organizer's own booking on this device (a confirmed hotel)
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + '#edit=' + packed); await page.waitForSelector('[data-card="route"]');
      const key = await page.evaluate((c) => window.__ep.itinKeyOf(window.__ep.normalize(JSON.parse(JSON.stringify(c)))).slice(5), CFG);
      await page.evaluate((k) => localStorage.setItem('ep:itin:' + k, JSON.stringify([{ id: 'b1', kind: 'hotel', name: 'Hotel Granvia Kyoto', start: '2027-04-05T15:00', end: '2027-04-08T11:00', confNo: 'GV1' }])), key);
      await page.click('[data-card="route"]'); await page.waitForSelector('#sheet .st-row');
      let r = await rows(page);
      ok(r.map(x => x.n).join() === 'Tokyo,Kyoto,Osaka' && r[0].nights === '3 nights' && /Apr 2–10, 2027/.test(await page.textContent('#sheet .rt-sum')), `@${w} route card: trip dates, stops with nights ${JSON.stringify(r.map(x => x.nights))}`);
      ok((await page.$$('#sheet .st-ins button')).length === 2, `@${w} "+ Insert a stop" between stops`);
      // add a stop, find it, give it dates that belong in the middle → it moves there
      await page.click('#sheet [data-st-add]'); await page.fill('#sheet [data-st-q="3"]', 'Hakone'); await page.click('#sheet [data-st-find="3"]'); await page.waitForFunction(() => /Hakone/.test(document.querySelector('#sheet .route-ed').textContent), null, { timeout: 8000 });
      ok((await rows(page))[3].from === '2027-04-10', `@${w} a new stop starts where the route ends`);
      await setDate(page, '#sheet #st-from-3', '2027-04-05'); // it moves to its place right away (leave day = the next morning)
      const hi = (await rows(page)).findIndex(x => x.n === 'Hakone'); ok(hi === 1 && (await rows(page))[1].to === '2027-04-06', `@${w} Arrive set → in place with one night`);
      await setDate(page, `#sheet #st-to-${hi}`, '2027-04-06');
      r = await rows(page);
      ok(r.map(x => x.n).join() === 'Tokyo,Hakone,Kyoto,Osaka', `@${w} Hakone (Apr 5–6) moved to its place: ${r.map(x => x.n)}`);
      ok(await page.$eval('#sheet .st-row.flash .venue-sel b', b => b.textContent).catch(() => '') === 'Hakone', `@${w} the moved stop is highlighted`);
      ok(/Overlaps Hakone by 1 night/.test(r[2].note), `@${w} Kyoto overlaps Hakone, said gently: ${r[2].note}`);
      // Make room
      await page.click('#sheet [data-st-push="2"]'); await settle(page); r = await rows(page); let c = await draft(page);
      ok(r[2].from === '2027-04-06' && r[2].to === '2027-04-09' && r[3].from === '2027-04-09' && r[3].to === '2027-04-11' && r[0].to === '2027-04-05' && !r[2].note, `@${w} Make room: Kyoto and Osaka 1 day later ${JSON.stringify(r.map(x => x.from + '…' + x.to))}`);
      ok(c.schedule.map(x => x.date).join() === '2027-04-03,2027-04-07,2027-04-10' && c.end.slice(0, 10) === '2027-04-11' && c.start === '2027-04-02', `@${w} their itinerary days moved too, trip ends Apr 11 ${c.schedule.map(x => x.date)} ${c.end}`);
      // Insert a stop between Tokyo and Hakone: the gap's dates (none → one night from Tokyo's last day)
      await page.click('#sheet [data-st-ins="0"]'); await settle(page); r = await rows(page);
      ok(r.length === 5 && r[1].n === '' && r[1].from === '2027-04-05' && r[1].to === '2027-04-06' && await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-st-q="1"]')), `@${w} Insert a stop: new row after Tokyo, Apr 5–6, search focused`);
      await page.click('#sheet [data-st-del="1"]'); await settle(page);
      // nights stepper
      await page.click('#sheet [data-st-n="0"][data-dir="-1"]'); await settle(page); r = await rows(page);
      ok(r[0].to === '2027-04-04' && r[0].nights === '2 nights' && /1 night with no stop after Tokyo/.test(r[1].note), `@${w} − a night: Tokyo leaves Apr 4, the gap is noted ${r[1].note}`);
      await page.click('#sheet [data-st-n="0"][data-dir="1"]'); await settle(page); ok((await rows(page))[0].to === '2027-04-05', `@${w} + a night`);
      if (SHOTS && w === 390) await page.locator('#sheet .sheet-in').screenshot({ path: `${SHOTS}/route-editor-390.png` });
      // Move trip dates
      await page.click('#sheet [data-sh="open"]'); await setDate(page, '#sheet #sh-start', '2027-05-06');
      const pv = await page.textContent('#sheet [data-sh-panel]');
      ok(/Apr 2–11, 2027\s*→\s*May 6–15, 2027/.test(pv) && /34 days later/.test(pv) && /Tokyo: Apr 2–5, 2027 → May 6–9, 2027/.test(pv) && /3 itinerary items/.test(pv), `@${w} preview old → new ${pv.replace(/\s+/g, ' ').slice(0, 160)}`);
      ok(/Bookings keep their dates/.test(pv) && /Hotel Granvia Kyoto \(Apr 5–8\)/.test(pv), `@${w} preview names the booking that won't move`);
      if (SHOTS && w === 390) await page.locator('#sheet .sheet-in').screenshot({ path: `${SHOTS}/move-trip-390.png` });
      await page.click('#sheet [data-sh="apply"]'); await settle(page); c = await draft(page);
      ok(c.start === '2027-05-06' && c.end.slice(0, 10) === '2027-05-15' && c.stops.map(s => s.from).join() === '2027-05-06,2027-05-09,2027-05-10,2027-05-13' && c.schedule.map(x => x.date).join() === '2027-05-07,2027-05-11,2027-05-14', `@${w} whole trip moved +34 days`);
      ok(c.ek && c.shifts && c.shifts.length === 2 && c.shifts[1].d === 34 && c.shifts[1].from === '', `@${w} page key pinned, the move recorded for guests ${JSON.stringify(c.shifts)}`);
      const bk = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k)), key); ok(bk[0].start === '2027-04-05T15:00', `@${w} the confirmed hotel kept its dates`);
      await page.click('#sheet [data-sh="undo"]'); await settle(page); c = await draft(page);
      ok(c.start === '2027-04-02' && c.stops[0].from === '2027-04-02' && c.shifts.length === 1, `@${w} Undo puts it all back`);
      await page.click('#sheet [data-sh="open"]'); await setDate(page, '#sheet #sh-start', '2027-05-06'); await page.click('#sheet [data-sh="apply"]'); await settle(page); c = await draft(page);
      ok(await overflow(page) === 0, `@${w} route card: no overflow`);
      ok(!page._err.length, `@${w} builder: no page errors ${page._err}`);
      // ---- the guest after the move: saved places follow once; the old booking is flagged, not changed ----
      const g = { ...c }; const gk = await page.evaluate((x) => window.__ep.itinKeyOf(x).slice(5), g);
      await page.evaluate(([k]) => { localStorage.clear(); localStorage.setItem('ep:plan:' + k, JSON.stringify([{ id: 'p1', src: 'osm', ref: 'n1', name: 'Ichiran', lat: 35.69, lon: 139.7, type: 'food', day: '2027-04-03', time: '', note: '' }, { id: 'p2', src: 'osm', ref: 'n2', name: 'Later spot', lat: 35.69, lon: 139.7, type: 'food', day: '', time: '', note: '' }]));
        localStorage.setItem('ep:itin:' + k, JSON.stringify([{ id: 'b1', kind: 'hotel', name: 'Hotel Granvia Kyoto', start: '2027-04-05T15:00', end: '2027-04-08T11:00', confNo: 'GV1' }])); }, [gk]);
      const gp = await page.evaluate((x) => window.__ep.packEvent(x), g);
      await page.goto(BASE + '#e=' + gp + '&t=mytrip'); await page.waitForSelector('#sec-itinerary');
      let pl = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:plan:' + k)), gk);
      ok(pl[0].day === '2027-05-07' && pl[1].day === '', `@${w} guest: saved place's day moved with the trip (Apr 3 → May 7, +1 +34) ${pl.map(x => x.day)}`);
      await page.reload(); await page.waitForSelector('#sec-itinerary'); pl = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:plan:' + k)), gk);
      ok(pl[0].day === '2027-05-07', `@${w} applied once (reload keeps it)`);
      ok(/Not on the trip dates/.test(await page.textContent('#sec-itinerary .bookings')), `@${w} the old hotel booking is flagged on its card`);
      await page.click('#sec-itinerary [data-ds="bk:b1"]'); await page.waitForSelector('dialog.ds-sheet[open]');
      { const wt = await page.textContent('dialog.ds-sheet .ds-warn').catch(() => 'none'); ok(/These dates don’t match the trip \(May 6–15, 2027\)/.test(wt), `@${w} …and in its sheet: ${wt}`); }
      const ib = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k)), gk); ok(ib[0].start === '2027-04-05T15:00', `@${w} guest booking dates untouched`);
      ok(!page._err.length, `@${w} guest: no page errors ${page._err}`);
      await ctx.close();
    }

    // ---- map/name mismatch: a stop renamed without moving its point; a hotel cached in the old city ----
    { const { ctx, page } = await setup(browser, 390);
      const bad = { ...CFG, title: 'Renamed trip', stops: [P('Tokyo', 'tokyo', '2027-04-02', '2027-04-05'), { ...P('Takayama', 'kyoto', '2027-04-05', '2027-04-08') }, { ...P('Arima Onsen', 'osaka', '2027-04-08', '2027-04-10') }],
        schedule: [{ date: '2027-04-05', time: '15:00', title: 'Check in: Hotel Granvia Kyoto', note: '' }] };
      await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ep:hgeo:hotel granvia kyoto', JSON.stringify({ lat: 34.985, lon: 135.758, addr: 'Kyoto', ref: '' })); });
      const gp = await page.evaluate((x) => window.__ep.packEvent(x), bad);
      await page.goto(BASE + '#e=' + gp + '&t=nearby'); await page.waitForSelector('[data-panel="nearby"]'); await page.waitForTimeout(3500);
      const tabs = await page.$$eval('[data-panel="nearby"] [data-dd="city"] [data-dd-v], [data-panel="nearby"] .dd-city [data-dd-v]', bs => bs.map(b => b.textContent.trim()));
      const center = async () => page.evaluate(() => { const m = document.querySelector('[data-slot="map"]')._leafletMap; if (!m) return null; const c = m.getCenter(); return [c.lat, c.lng]; });
      const tk = await page.$('[data-panel="nearby"] [data-dd-v="1"]');
      if (tk) { await tk.click(); await page.waitForTimeout(800); }
      const c1 = await center();
      ok(tabs.join().includes('Takayama') && c1 && Math.abs(c1[0] - 36.146) < 0.3 && Math.abs(c1[1] - 137.25) < 0.3, `Takayama tab shows Takayama, not Kyoto (center ${c1}) tabs ${tabs}`);
      const v = await page.evaluate((x) => { const c = window.__ep.normalize(JSON.parse(JSON.stringify(x))); c.stops[1] = { ...c.stops[1], lat: 36.1461, lon: 137.2522, city: 'Takayama', address: 'Takayama, Japan' }; c.stops[2] = { ...c.stops[2], lat: 34.7968, lon: 135.2477, city: 'Kobe', address: 'Arima Onsen, Kobe, Japan' }; const hs = window.__ep.hotelsNow(c); return hs.map(h => h.map(x => x.name)); }, bad);
      ok(!v[1].includes('Hotel Granvia Kyoto'), `a hotel cached in Kyoto is not "your hotel in Takayama" ${JSON.stringify(v)}`);
      const sus = await page.evaluate(() => [window.__ep.stopSuspect({ name: 'Takayama', city: 'Kyoto', address: 'Kyoto, Japan', lat: 35 }), window.__ep.stopSuspect({ name: 'Arima Onsen', city: 'Kobe', address: 'Arima Onsen, Kobe', lat: 34 }), window.__ep.stopSuspect({ name: 'Kyoto', city: 'Kyoto', address: 'Kyoto, Japan', lat: 35 })]);
      ok(sus.join() === 'true,false,false', `a stop whose name isn't its place is looked up again (${sus})`);
      // ids: renaming keeps the id, sorting moves whole stops (name + point + id together)
      const s = await page.evaluate((x) => { const c = window.__ep.normalize(JSON.parse(JSON.stringify(x))); const ids = c.stops.map(y => y.id); c.stops[0].from = '2027-04-20'; window.__ep.sortStops(c); return { ids, after: c.stops.map(y => [y.id, y.name, y.lat]) }; }, CFG);
      ok(new Set(s.ids).size === 3 && s.after.map(x => x[1]).join() === 'Kyoto,Osaka,Tokyo' && s.after[2][0] === s.ids[0] && s.after[2][2] === 35.6764, `sorting moves whole stops with their ids and points ${JSON.stringify(s.after)}`);
      ok(!page._err.length, `no page errors ${page._err}`); await ctx.close(); }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
