// Hotels near the venue (Google Places): price level chips ($ … $$$$ from priceLevel, only the levels present, several can
// be on), minimum rating (★ 4+ / ★ 4.5+), and per hotel one "See prices" button → Google / Expedia / Booking.com with the
// stay's nights + guests filled in (Expedia: that city's hotels — it doesn't resolve a hotel name). Each route city in
// "Stays along the route" gets the same menu with its own leg's dates. 390 + 320, no overflow.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/hotel-prices.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page, sel) => page.evaluate((sel) => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll(sel + ' *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.className || e.tagName); }, sel);
const HOTELS = [['Hotel Avenida', 4.2, 'PRICE_LEVEL_MODERATE'], ['Pousada de Lisboa', 4.7, 'PRICE_LEVEL_VERY_EXPENSIVE'], ['Memmo Alfama', 4.6, 'PRICE_LEVEL_EXPENSIVE'], ['Lisbon Hostel', 3.9, 'PRICE_LEVEL_INEXPENSIVE'],
  ['Hotel Mundial', 4.1, 'PRICE_LEVEL_MODERATE'], ['Pestana Palace', 4.5, 'PRICE_LEVEL_EXPENSIVE'], ['Corinthia', 4.4, 'PRICE_LEVEL_EXPENSIVE'], ['Bairro Alto Hotel', 4.8, 'PRICE_LEVEL_VERY_EXPENSIVE'], ['Myriad', 4.3, ''], ['Olissippo', 3.6, 'PRICE_LEVEL_MODERATE']];
const P = (name, lat, lon, from, to, country = 'Japan', cc = 'jp') => ({ name, address: name, lat, lon, city: name, country, cc, from, to });
(async () => {
  const browser = await chromium.launch();
  const venue = { name: 'Praça do Comércio', address: 'Lisbon', lat: 38.7075, lon: -9.1364, city: 'Lisbon', country: 'Portugal', cc: 'pt' };
  const cfg = { v: 2, type: 'Party', title: 'Lisbon prices', start: '2027-05-14T19:00', end: '2027-05-16', tz: 'Europe/Lisbon', venue, tools: { travel: true, stay: true, tours: false, nearby: false, weather: false, mytrip: false, packing: false } };
  const trip = { v: 2, type: 'Trip', title: 'Japan prices', start: '2027-04-01', end: '2027-04-10', tz: 'Asia/Tokyo', venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
    stops: [P('Tokyo', 35.6764, 139.65, '2027-04-01', '2027-04-04'), P('Kyoto', 35.0116, 135.7681, '2027-04-04', '2027-04-08'), P('Osaka', 34.6937, 135.5023, '2027-04-08', '2027-04-10')], schedule: [],
    tools: { travel: true, stay: true, tours: false, nearby: false, weather: false, mytrip: false, packing: false } };
  for (const w of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route('https://places.googleapis.com/**', (r) => {
      const b = JSON.parse(r.request().postData() || '{}'); const c = ((b.locationRestriction || b.locationBias || {}).circle || { center: { latitude: 0, longitude: 0 } }).center; const ty = (b.includedTypes || [])[0];
      const places = ty === 'lodging' ? HOTELS.map(([n, rt, pl], i) => ({ id: `h-${i}`, displayName: { text: n }, location: { latitude: c.latitude + (i + 1) * 0.0015, longitude: c.longitude }, types: ['lodging'], rating: rt, userRatingCount: 300, ...(pl ? { priceLevel: pl } : {}) })) : [];
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places }) });
    });
    await page.route(/open-meteo|overpass|maps\.mail\.ru|tile\.openstreetmap|timeapi|nominatim|photon|maps\.googleapis/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), cfg) + '&t=travel'); await page.waitForSelector('[data-lf-box="hotels"] [data-lf-q]', { timeout: 15000 });
    const box = '[data-lf-box="hotels"]';
    const chips = await page.$$eval(`${box} [data-lf-chip]`, bs => bs.map(b => b.textContent));
    ok(chips.join('|') === 'Walking distance|$|$$|$$$|$$$$|★ 4+|★ 4.5+', `@${w} hotel chips: ${chips.join(' | ')}`);
    const names = () => page.$$eval(`${box} ul.plist > li:not(.more-li) > div > b`, bs => bs.map(b => b.textContent));
    await page.click(`${box} [data-cc-filters]`); // the filters live in the Filters sheet
    await page.click(`${box} [data-lf-chip="p:$$"]`); let n = await names();
    ok(n.sort().join() === 'Hotel Avenida,Hotel Mundial,Olissippo', `@${w} $$ → ${n}`);
    await page.click(`${box} [data-lf-chip="p:$$$$"]`); n = await names();
    ok(n.length === 5 && n.includes('Bairro Alto Hotel') && n.includes('Pousada de Lisboa'), `@${w} $$ + $$$$ → ${n.length}`);
    await page.click(`${box} [data-lf-chip="r:4.5"]`); n = await names();
    ok(n.sort().join() === 'Bairro Alto Hotel,Pousada de Lisboa', `@${w} + ★ 4.5+ → ${n}`);
    await page.click(`${box} [data-lf-chip="r:4"]`); n = await names();
    ok(n.length === 4 && await page.$eval(`${box} [data-lf-chip="r:4.5"]`, b => b.getAttribute('aria-pressed')) === 'false' && await page.$eval(`${box} [data-lf-chip="r:4"]`, b => b.getAttribute('aria-pressed')) === 'true', `@${w} ★ 4+ replaces 4.5+ → ${n.length}`);
    await page.click(`${box} .cc-sheet [data-cc-close].primary`);
    const pl = await page.$$eval(`${box} [data-ccb-pills] .pill span`, ss => ss.map(s => s.textContent)); ok(pl.join('|') === '$$|$$$$|★ 4+', `@${w} pills under the bar: ${pl.join(' | ')}`);
    await page.click(`${box} [data-ccb-pills] [data-lf-unchip="p:$$$$"]`); n = await names(); const pl2 = await page.$$eval(`${box} [data-ccb-pills] .pill span`, ss => ss.map(s => s.textContent));
    ok(n.length >= 1 && n.every(x => ['Hotel Avenida', 'Hotel Mundial', 'Olissippo'].includes(x)) && pl2.join('|') === '$$|★ 4+' && await page.$eval(`${box} [data-lf-chip="p:$$$$"]`, b => b.getAttribute('aria-pressed')) === 'false', `@${w} removing the $$$$ pill → ${n} (${pl2.join(' | ')})`);
    await page.click(`${box} [data-cc-filters]`); await page.click(`${box} .cc-sheet [data-lf-clear]`); await page.click(`${box} .cc-sheet [data-cc-close].primary`);
    n = await names(); ok(n.length >= 3 && !(await page.$(`${box} [data-lf-chip].on`)) && !(await page.$(`${box} [data-ccb-pills] .pill`)), `@${w} Clear filters`);
    // See prices
    const row = `${box} ul.plist > li:first-child`;
    const first = await page.$eval(`${row} > div > b`, b => b.textContent);
    await page.click(`${row} .sp-menu > summary`); await page.waitForTimeout(150);
    const links = await page.$$eval(`${row} .sp-menu .menu-pop a`, as => as.map(a => [a.dataset.sp, a.href, a.target, a.offsetParent !== null]));
    ok(links.map(l => l[0]).join() === 'Google,Expedia,Booking.com' && links.every(l => l[2] === '_blank' && l[3]), `@${w} See prices → Google / Expedia / Booking.com`);
    const [g, e, bk] = links.map(l => new URL(l[1]));
    ok(g.origin + g.pathname === 'https://www.google.com/travel/hotels' && g.searchParams.get('q') === `${first}, Lisbon, Portugal May 13, 2027 to May 17, 2027`, `@${w} Google: hotel + nights in the query (${g.searchParams.get('q')})`);
    ok(e.pathname === '/Hotel-Search' && e.searchParams.get('destination') === 'Lisbon, Portugal' && e.searchParams.get('startDate') === '2027-05-13' && e.searchParams.get('endDate') === '2027-05-17' && e.searchParams.get('adults') === '2', `@${w} Expedia: Lisbon + dates + adults (${e.search})`);
    ok(bk.pathname === '/searchresults.html' && bk.searchParams.get('ss') === `${first}, Lisbon, Portugal` && bk.searchParams.get('checkin') === '2027-05-13' && bk.searchParams.get('checkout') === '2027-05-17' && bk.searchParams.get('group_adults') === '2', `@${w} Booking.com: hotel + dates + adults (${bk.search})`);
    ok(/May 13 – 17, 2027|May 13–17, 2027|May 13 - 17/.test(await page.textContent(`${row} .sp-when`)) && /2 guests/.test(await page.textContent(`${row} .sp-when`)), `@${w} menu says the nights + guests: ${await page.textContent(`${row} .sp-when`)}`);
    if (SHOTS) await page.locator('[data-slot="hotels"]').screenshot({ path: `${SHOTS}/hotel-prices-${w}.png` });
    ok((await overflow(page, '.ev')).length === 0, `@${w} open menu: no overflow ${(await overflow(page, '.ev')).join(' ')}`);
    // guests from the trip bar
    await page.fill('#ep-guests', '3'); await page.dispatchEvent('#ep-guests', 'change'); await page.waitForSelector(`${box} ul.plist > li:first-child .sp-menu`);
    const bk3 = new URL(await page.$eval(`${box} ul.plist > li:first-child .sp-menu a[data-sp="Booking.com"]`, a => a.href)); const e3 = new URL(await page.$eval(`${box} ul.plist > li:first-child .sp-menu a[data-sp="Expedia"]`, a => a.href));
    ok(bk3.searchParams.get('group_adults') === '3' && e3.searchParams.get('adults') === '3', `@${w} 3 guests → the links follow`);
    // route cities
    await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), trip) + '&t=travel'); await page.waitForSelector('.sp-row', { timeout: 15000 });
    const rows = await page.$$eval('.sp-row', rs => rs.map(r => ({ t: r.querySelector('b').textContent, links: [...r.querySelectorAll('.menu-pop a')].map(a => a.href) })));
    ok(rows.length === 3 && rows.map(r => r.t).join() === 'Hotels in Tokyo,Hotels in Kyoto,Hotels in Osaka', `@${w} a See prices per route city ${rows.map(r => r.t)}`);
    const k = rows[1].links.map(u => new URL(u));
    ok(k[0].searchParams.get('q') === 'hotels in Kyoto, Japan Apr 4, 2027 to Apr 8, 2027' && k[1].searchParams.get('destination') === 'Kyoto, Japan' && k[1].searchParams.get('startDate') === '2027-04-04' && k[2].searchParams.get('ss') === 'Kyoto, Japan' && k[2].searchParams.get('checkout') === '2027-04-08', `@${w} Kyoto: its own leg dates on all three`);
    await page.click('.sp-row:nth-of-type(2) .sp-menu > summary').catch(async () => page.click('.sp-row >> nth=1 >> .sp-menu > summary')); await page.waitForTimeout(150);
    ok((await overflow(page, '.ev')).length === 0, `@${w} city menu open: no overflow ${(await overflow(page, '.ev')).join(' ')}`);
    if (SHOTS) await page.locator('.sp-row >> nth=1').screenshot({ path: `${SHOTS}/city-prices-${w}.png` }).catch(() => {});
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
