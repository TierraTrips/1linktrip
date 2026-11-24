// Schedule items at a different place (Dylan's audit, item 1): a wedding at Hotel Esencia (Xpu-Há) whose "Welcome party"
// is at Taboo Beach Club, Tulum. Each schedule item can carry its own place (Places search in the builder, the same flow as
// the venue picker): its sheet's Open in Google Maps / Directions go to that place (name, coords, Google place id); an item
// without one gets a Google Maps search of its title (+ the venue's city), never the main venue's pin. The place survives
// pack/unpack (normalize sanitizes it), shows under the item on the page, and wins over a trip item's "Find it" search.
// Builder: set a place on an item from the suggestions, Change / Remove it, Find (text search) without a suggestion;
// the on-page editor's item sheet has the same field. No overflow at 390 / 320, no page errors.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/sched-place.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).length; });
const ESENCIA = { name: 'Hotel Esencia', address: 'Carretera Cancún-Tulum Km 265, Xpu-Há, Q.R., Mexico', lat: 20.4626, lon: -87.2617, city: 'Xpu-Há', region: 'Quintana Roo', country: 'Mexico', cc: 'mx', gid: 'ChIJesencia' };
const TABOO = { name: 'Taboo Beach Club Tulum', address: 'Carretera Tulum-Boca Paila Km 4.5, Tulum, Q.R., Mexico', lat: 20.1795, lon: -87.4601, gid: 'ChIJtaboo_beach-1' };
const CFG = { v: 2, type: 'Wedding', title: 'Maya & Leo — Tulum', start: '2027-03-13T16:30', end: '', tz: 'America/Cancun', venue: ESENCIA,
  schedule: [{ date: '2027-03-12', time: '19:00', title: 'Welcome party', note: 'Dress: beach casual', place: TABOO },
    { date: '2027-03-13', time: '16:30', title: 'Ceremony', note: '' },
    { date: '2027-03-14', time: '11:00', title: 'Farewell brunch', note: 'Casa Jaguar, Tulum' }],
  tools: { nearby: false, weather: false, travel: false, stay: false, tours: false, mytrip: false, packing: false, shopping: false } };
const TRIP = { v: 2, type: 'Trip', title: 'Place trip', start: '2027-04-01', end: '2027-04-04', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  schedule: [{ date: '2027-04-02', time: '19:00', title: 'Dinner', note: '', kind: 'reservation', place: { name: 'Sushi Saito', address: '1-4-5 Roppongi, Minato City, Tokyo', lat: 35.6655, lon: 139.7398, gid: 'ChIJsaito' } },
    { date: '2027-04-03', time: '10:00', title: 'Asakusa', note: '' }],
  tools: { nearby: false, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };

async function setup(browser, w) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e))); page._gp = [];
  // Places: autocomplete "taboo" → one suggestion; details for it; text search "casa jaguar" → one place
  await page.route('https://places.googleapis.com/**', async (r) => { const u = r.request().url(); const b = JSON.parse(r.request().postData() || '{}'); page._gp.push(u);
    if (/places:autocomplete/.test(u)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ suggestions: /taboo/i.test(b.input || '') ? [{ placePrediction: { placeId: TABOO.gid, structuredFormat: { mainText: { text: TABOO.name }, secondaryText: { text: 'Tulum, Q.R., Mexico' } }, types: ['restaurant'] } }] : [] }) });
    if (/places:searchText/.test(u)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: /casa jaguar/i.test(b.textQuery || '') ? [{ id: 'ChIJjaguar', displayName: { text: 'Casa Jaguar' }, formattedAddress: 'Av. Tulum, Tulum, Q.R., Mexico', location: { latitude: 20.2094, longitude: -87.4655 }, types: ['restaurant'], addressComponents: [] }] : [] }) });
    if (/places\/ChIJtaboo/.test(u)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: TABOO.gid, displayName: { text: TABOO.name }, formattedAddress: TABOO.address, location: { latitude: TABOO.lat, longitude: TABOO.lon }, types: ['restaurant'], addressComponents: [{ longText: 'Tulum', shortText: 'Tulum', types: ['locality'] }] }) });
    return r.abort(); });
  await page.route(/gstatic|maps\.googleapis|overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon|functions\/v1/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  return { ctx, page };
}
const pack = (page, c) => page.evaluate((c) => window.__ep.packEvent(c), c);
const sheet = (page) => page.evaluate(() => { const d = document.querySelector('dialog.ds-sheet'); return d && d.open ? { title: d.querySelector('.ds-t').textContent, text: d.textContent.replace(/\s+/g, ' '), links: [...d.querySelectorAll('.ds-links a[href]')].map(a => ({ t: a.textContent.trim(), u: a.href })) } : null; });
const openDays = (page) => page.$$eval('#sec-schedule [data-day-tog][aria-expanded="false"]', bs => bs.forEach(b => b.click())); // Event tab days start closed
const openEv = async (page, i) => { await openDays(page); await page.click(`#sec-schedule [data-ds="ev:${i}"]`); await page.waitForSelector('dialog.ds-sheet[open]'); await page.waitForTimeout(200); return sheet(page); };
const closeSheet = async (page) => { await page.click('dialog.ds-sheet [data-ds-close]'); await page.waitForFunction(() => !document.querySelector('dialog.ds-sheet[open]')); };
const draft = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
const settle = (page) => page.waitForTimeout(450);

(async () => {
  const browser = await chromium.launch();
  try {
    // ---- normalize: the place is kept (sanitized) through pack / unpack; junk is dropped ----
    {
      const { ctx, page } = await setup(browser, 390);
      const r = await page.evaluate(([c, t]) => {
        const un = window.__ep.normalize(JSON.parse(JSON.stringify(c)));
        const junk = window.__ep.normalize({ v: 2, type: 'Party', title: 'x', schedule: [null, { title: 'a', place: { name: '  Bar   One ', address: 5, lat: '40.1234567', lon: 'x', gid: 'bad id<script>' } }, { title: 'b', place: 'Somewhere' }, { title: 'c', place: { name: '', address: '' } }, { title: 'd', place: { name: 'N'.repeat(500), lat: 95, lon: 10, gid: 'ok_id-1' } }] });
        return { un: un.schedule[0].place, none: 'place' in un.schedule[1], junk: junk.schedule, t };
      }, [CFG]);
      ok(JSON.stringify(r.un) === JSON.stringify({ name: TABOO.name, address: TABOO.address, lat: TABOO.lat, lon: TABOO.lon, gid: TABOO.gid }) && !r.none, `normalize keeps a place {name,address,lat,lon,gid} ${JSON.stringify(r.un)}`);
      const j = r.junk;
      ok(j.length === 4 && JSON.stringify(j[0].place) === JSON.stringify({ name: 'Bar One', address: '' }) && !('place' in j[1]) && !('place' in j[2]) && j[3].place.name.length === 120 && j[3].place.lat === undefined && j[3].place.gid === 'ok_id-1',
        `normalize sanitizes: null item dropped, bad lat/lon/gid/address dropped, string/empty place dropped, name capped ${JSON.stringify(j.map(x => x.place))}`);
      const rt = await page.evaluate(async (c) => { const s = window.__ep.packEvent(window.__ep.normalize(JSON.parse(JSON.stringify(c)))); location.hash = 'e=' + s; return s; }, CFG);
      await page.goto(BASE + '#e=' + rt); await page.waitForSelector('.ev');
      const un2 = await page.evaluate(() => { const h = location.hash.slice(3); const LZ = window.LZString; return JSON.parse(LZ.decompressFromEncodedURIComponent(h)).schedule[0].place; });
      ok(un2 && un2.gid === TABOO.gid && un2.lat === TABOO.lat, 'the place travels in the packed link');
      await ctx.close();
    }
    for (const w of [390, 320]) {
      const { ctx, page } = await setup(browser, w);
      // ---- guest: item with a place → its sheet points there ----
      await page.goto(BASE + '#e=' + await pack(page, CFG)); await page.waitForSelector('#sec-schedule');
      const row0 = await page.textContent('#sec-schedule [data-ds="ev:0"]');
      ok(/Taboo Beach Club Tulum · Dress: beach casual/.test(row0), `@${w} the item shows its place on the page (${row0.trim().replace(/\s+/g, ' ')})`);
      let s = await openEv(page, 0);
      const maps = s.links.find(l => l.t === 'Open in Google Maps'), dir = s.links.find(l => l.t === 'Directions');
      ok(s.title === 'Welcome party' && /Taboo Beach Club Tulum/.test(s.text) && /Boca Paila/.test(s.text), `@${w} Welcome party sheet: Taboo's name + address`);
      ok(maps && maps.u.startsWith('https://www.google.com/maps/search/?api=1&query=') && /Taboo/.test(decodeURIComponent(maps.u)) && maps.u.includes('query_place_id=' + TABOO.gid), `@${w} Open in Google Maps → Taboo with its place id (${maps && decodeURIComponent(maps.u)})`);
      ok(dir && dir.u.startsWith('https://www.google.com/maps/dir/?api=1&destination=') && /Taboo/.test(decodeURIComponent(dir.u)) && dir.u.includes('destination_place_id=' + TABOO.gid), `@${w} Directions → Taboo (${dir && decodeURIComponent(dir.u)})`);
      ok(!s.links.some(l => /Esencia|Xpu|20\.4626/.test(decodeURIComponent(l.u))), `@${w} nothing points to the main venue`);
      ok(await page.$eval('dialog.ds-sheet [data-ds-map]', m => m.dataset.lat === String(20.1795)), `@${w} the small map is on Taboo`);
      ok(await overflow(page) === 0, `@${w} no overflow (sheet)`);
      await closeSheet(page);
      // ---- item without a place → a Maps search of its title (+ the venue's city), not the venue ----
      s = await openEv(page, 1);
      const m1 = s.links.find(l => l.t === 'Open in Google Maps'), d1 = s.links.find(l => l.t === 'Directions');
      ok(m1 && decodeURIComponent(m1.u) === 'https://www.google.com/maps/search/?api=1&query=Ceremony, Xpu-Há' && !m1.u.includes('place_id'), `@${w} no place: Maps searches the title + city (${m1 && decodeURIComponent(m1.u)})`);
      ok(d1 && decodeURIComponent(d1.u) === 'https://www.google.com/maps/dir/?api=1&destination=Ceremony, Xpu-Há', `@${w} no place: Directions to the same search`);
      ok(/Find it/.test(s.text) && !/Carretera Cancún/.test(s.text), `@${w} no place: "Find it", not the venue's address`);
      await closeSheet(page);
      ok(await overflow(page) === 0, `@${w} no overflow (page)`);
      // ---- a trip: a set place wins over "Find it" ----
      await page.goto(BASE + '#e=' + await pack(page, TRIP)); await page.waitForSelector('#sec-schedule'); await openDays(page);
      await page.click('#sec-schedule [data-ds="ev:0"]'); await page.waitForSelector('dialog.ds-sheet[open]'); s = await sheet(page);
      const tm = s.links.find(l => l.t === 'Open in Google Maps');
      ok(/Location/.test(s.text) && !/Find it/.test(s.text) && tm && /Sushi Saito/.test(decodeURIComponent(tm.u)) && tm.u.includes('query_place_id=ChIJsaito'), `@${w} trip item with a place: Location → the place (${tm && decodeURIComponent(tm.u)})`);
      await closeSheet(page);
      await page.click('#sec-schedule [data-ds="ev:1"]'); await page.waitForSelector('dialog.ds-sheet[open]'); s = await sheet(page);
      ok(/Find it/.test(s.text) && s.links.some(l => /query=Asakusa/.test(l.u)), `@${w} trip item without one: Find it (title + city), as before`);
      await closeSheet(page);
      // ---- builder: set a place from the suggestions, Change, Remove; Find without a suggestion ----
      await page.evaluate(() => localStorage.clear());
      const noPlace = JSON.parse(JSON.stringify(CFG)); delete noPlace.schedule[0].place;
      await page.goto(BASE + '#edit=' + await pack(page, noPlace)); await page.waitForSelector('[data-card="schedule"]');
      await page.click('[data-card="schedule"]'); await page.waitForSelector('#sheet [data-sp-q="0"]');
      ok((await page.$$('#sheet [data-sp-q]')).length === 3, `@${w} each item has an optional Place search`);
      await page.click('#sheet [data-sp-q="0"]'); await page.keyboard.type('Taboo'); await page.waitForSelector('#sheet .gp-sugg:not([hidden]) [data-ac-pick]', { timeout: 5000 });
      await page.click('#sheet .gp-sugg [data-ac-pick]'); await page.waitForSelector('#sheet .s-place', { timeout: 5000 }); await settle(page);
      let dr = await draft(page);
      ok(/Taboo Beach Club Tulum/.test(await page.textContent('#sheet .s-place b')) && dr.schedule[0].place && dr.schedule[0].place.gid === TABOO.gid && dr.schedule[0].place.lat === TABOO.lat, `@${w} picked a suggestion → the item's place (name + Change/Remove) ${JSON.stringify(dr.schedule[0].place)}`);
      ok(await overflow(page) === 0, `@${w} no overflow (builder schedule with a place)`);
      await page.click('#sheet [data-sp-chg="0"]'); await page.waitForSelector('#sheet [data-sp-q="0"]');
      ok(await page.$eval('#sheet [data-sp-q="0"]', i => i.value) === TABOO.name && (await draft(page)).schedule[0].place, `@${w} Change → search again, the place kept until a new pick`);
      await page.evaluate(() => document.querySelector('#sheet [data-b="close"]').click()); await page.click('[data-card="schedule"]'); await page.waitForSelector('#sheet [data-sp-del="0"]');
      await page.click('#sheet [data-sp-del="0"]'); await settle(page); dr = await draft(page);
      ok(!dr.schedule[0].place && await page.$('#sheet [data-sp-q="0"]'), `@${w} Remove → no place, the search is back`);
      // Find (text search) on the brunch
      await page.fill('#sheet [data-sp-q="2"]', 'Casa Jaguar'); await page.click('#sheet [data-sp-find="2"]');
      await page.waitForFunction(() => /Casa Jaguar/.test((document.querySelector('#sheet .s-place b') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {}); await settle(page);
      dr = await draft(page);
      ok(dr.schedule[2].place && dr.schedule[2].place.name === 'Casa Jaguar' && dr.schedule[2].place.gid === 'ChIJjaguar', `@${w} Find → the best text match ${JSON.stringify(dr.schedule[2].place)}`);
      ok(await overflow(page) === 0, `@${w} no overflow (builder)`);
      await page.evaluate(() => document.querySelector('#sheet [data-b="close"]').click());
      // the guest preview of the brunch now points to Casa Jaguar
      const html = await page.evaluate((c) => { const x = window.__ep.normalize(JSON.parse(localStorage.getItem('ep:draft'))); return window.__ep.dsHTML(x, 'ev:2'); });
      ok(/query_place_id=ChIJjaguar/.test(html) && /destination_place_id=ChIJjaguar/.test(html), `@${w} the brunch's sheet now goes to Casa Jaguar`);
      // ---- trip planner editor + on-page editor have the field too ----
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + '#edit=' + await pack(page, TRIP)); await page.waitForSelector('[data-card="schedule"]');
      await page.click('[data-card="schedule"]'); await page.waitForSelector('#sheet .plan-item');
      ok(/Sushi Saito/.test(await page.textContent('#sheet .plan-item .s-place b')) && (await page.$$('#sheet .plan-item [data-sp-q]')).length === 1, `@${w} trip planner: the place shown on its item, a search on the other`);
      ok(await overflow(page) === 0, `@${w} no overflow (trip planner)`);
      await page.evaluate(() => document.querySelector('#sheet [data-b="close"]').click());
      if (await page.$('.seg [data-tab="preview"]')) await page.click('.seg [data-tab="preview"]').catch(() => {});
      const ed = await page.waitForSelector('#preview .ev.onp [data-ed="s:1"]', { timeout: 8000 }).catch(() => null);
      if (ed) { await page.waitForTimeout(500); await page.click('#preview [data-ed="s:1"]'); await page.waitForSelector('#sheet[open]'); await page.waitForTimeout(150);
        ok((await page.$$('#sheet [data-sp-q]')).length === 1 && (await page.$$('#sheet .rowed')).length === 1, `@${w} on-page editor: the item's sheet has the Place search`); }
      else ok(false, `@${w} on-page editor: item mark found`);
      ok(page._err.length === 0, `@${w} no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
