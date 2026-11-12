// Guest lists with search + filters: Rental car counters (search by company, At the airport / In town, Open now, sort by
// Distance / Rating), Hotels near the venue and Sights (search by name, Walking distance, sort). Typing keeps focus (only
// the list re-renders), Clear filters resets, labels translate, no overflow at 390/320. Google Places answers are generated.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/list-filters.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page, sel) => page.evaluate((sel) => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll(sel + ' *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).slice(0, 4).map(e => e.tagName + '.' + e.className); }, sel);

const CARS_AIR = ['Hertz Lisbon Airport', 'Avis Aeroporto', 'Sixt Lisboa Aeroporto', 'Europcar Airport', 'Goldcar Lisbon', 'Centauro Rent a Car', 'Drivalia', 'Enterprise Rent-A-Car'];
const CARS_TOWN = ['Hertz Baixa', 'Avis Marquês', 'Guerin Rent a Car', 'Bolt Drive Centro'];
(async () => {
  const browser = await chromium.launch();
  const venue = { name: 'Praça do Comércio', address: 'Lisbon', lat: 38.7075, lon: -9.1364, city: 'Lisbon', country: 'Portugal', cc: 'pt' };
  const cfg = { v: 2, type: 'Party', title: 'Lisbon weekend', start: '2027-05-14T19:00', end: '2027-05-16', tz: 'Europe/Lisbon', venue, tools: { travel: true, stay: true, tours: true, nearby: false, weather: false, mytrip: false, packing: false } };
  for (const [w, lang] of [[390, ''], [320, 'es']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route('https://places.googleapis.com/**', (r) => {
      const b = JSON.parse(r.request().postData() || '{}'); const c = b.locationRestriction.circle.center; const ty = (b.includedTypes || [])[0];
      const mk = (names, extra = () => ({})) => ({ places: names.map((n, i) => ({ id: `${ty}-${c.latitude.toFixed(2)}-${i}`, displayName: { text: n }, location: { latitude: c.latitude + (i + 1) * 0.002, longitude: c.longitude + (i % 3) * 0.001 }, types: [ty], ...extra(i) })) });
      let body = { places: [] };
      if (ty === 'car_rental') body = mk(c.latitude > 38.75 ? CARS_AIR : CARS_TOWN, (i) => ({ rating: [4.6, 3.9, 4.2, 3.1, 2.8, 4.8, 4.0, 3.5][i % 8], userRatingCount: 50 + i, currentOpeningHours: { openNow: i % 2 === 0 } }));
      else if (ty === 'lodging') body = mk(Array.from({ length: 12 }, (_, i) => ['Hotel Avenida', 'Pousada de Lisboa', 'Memmo Alfama', 'Lisbon Hostel', 'Hotel Mundial', 'Pestana Palace', 'Corinthia', 'Bairro Alto Hotel', 'Myriad', 'Tivoli Oriente', 'Sana Metropolitan', 'Olissippo'][i]), (i) => ({ rating: 3.5 + (i % 5) / 4, userRatingCount: 200 }));
      else if (ty === 'tourist_attraction') body = mk(Array.from({ length: 11 }, (_, i) => ['Belém Tower', 'Jerónimos Monastery', 'São Jorge Castle', 'Oceanário', 'Gulbenkian Museum', 'Santa Justa Lift', 'LX Factory', 'MAAT', 'Tile Museum', 'Rossio', 'Miradouro da Graça'][i]), (i) => ({ rating: 4.2 + (i % 3) / 10, userRatingCount: 1000 }));
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route(/open-meteo|overpass|maps\.mail\.ru|tile\.openstreetmap|timeapi|nominatim|photon|maps\.googleapis/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), cfg);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + (lang ? `?lang=${lang}` : '') + '#e=' + packed + '&t=travel'); await page.waitForSelector('[data-lf-box="cars"] .cars li', { timeout: 15000 });
    const L = lang ? { air: 'En el aeropuerto', town: 'En la ciudad', open: 'Abierto ahora' } : { air: 'At the airport', town: 'In town', open: 'Open now' };
    const chips = await page.$$eval('[data-lf-box="cars"] [data-lf-chip]', bs => bs.map(b => b.textContent));
    ok(chips.join('|') === [L.air, L.town, L.open].join('|'), `@${w} rental chips: ${chips.join(' | ')}`);
    const names = () => page.$$eval('[data-lf-box="cars"] .cars li b', bs => bs.map(b => b.textContent));
    let n = await names(); ok(n.length === 8 && n[0] === 'Hertz', `@${w} airport counters by distance: ${n.join(', ')}`);
    // search keeps focus and filters as you type
    await page.click('[data-lf-box="cars"] [data-lf-q]'); await page.keyboard.type('av');
    n = await names(); ok(n.join() === 'Avis' && await page.evaluate(() => document.activeElement.matches('[data-lf-box="cars"] [data-lf-q]')), `@${w} search “av” → ${n.join()} (focus kept)`);
    ok(/1 /.test(await page.textContent('[data-lf-box="cars"] .pf-count')), `@${w} count shown`);
    await page.click('[data-lf-box="cars"] [data-lf-clear]'); n = await names(); ok(n.length === 8 && await page.inputValue('[data-lf-box="cars"] [data-lf-q]') === '', `@${w} Clear filters`);
    await page.click(`[data-lf-box="cars"] [data-lf-chip="open"]`); n = await names(); ok(n.length === 4, `@${w} Open now → ${n.length}`);
    await page.click(`[data-lf-box="cars"] [data-lf-chip="open"]`);
    await page.selectOption('[data-lf-box="cars"] [data-lf-sort]', 'rating'); n = await names(); ok(n[0] === 'Centauro Rent a Car', `@${w} sort by rating → ${n[0]}`);
    await page.click(`[data-lf-box="cars"] [data-lf-chip="town"]`); n = await names();
    ok(n.length === 4 && n.includes('Guerin Rent a Car') && await page.$eval('[data-lf-chip="town"]', b => b.getAttribute('aria-pressed')) === 'true' && await page.$eval('[data-lf-chip="airport"]', b => b.getAttribute('aria-pressed')) === 'false', `@${w} In town → ${n.join(', ')}`);
    const link = await page.$eval('[data-lf-box="cars"] .cars li b a', a => a.href); ok(/^https:/.test(link), `@${w} counter links out (${link})`);
    if (SHOTS) await page.locator('[data-slot="rental"]').screenshot({ path: `${SHOTS}/rental-${w}.png` });
    ok((await overflow(page, '[data-slot="rental"]')).length === 0, `@${w} rental: no overflow`);
    // hotels
    await page.waitForSelector('[data-lf-box="hotels"] [data-lf-q]');
    const hn = () => page.$$eval('[data-lf-box="hotels"] li:not(.more):not(.more-li) b', bs => bs.map(b => b.textContent));
    ok((await hn()).length === 3 && !!(await page.$('[data-lf-box="hotels"] [data-more]')), `@${w} hotels: 3 then Show more`);
    await page.fill('[data-lf-box="hotels"] [data-lf-q]', 'pestana'); ok((await hn()).join() === 'Pestana Palace', `@${w} hotel search → ${await hn()}`);
    await page.fill('[data-lf-box="hotels"] [data-lf-q]', ''); await page.click('[data-lf-box="hotels"] [data-lf-chip="walk"]');
    const walk = await hn(); ok(walk.length > 0 && walk.length < 12, `@${w} Walking distance → ${walk.length} hotels`);
    await page.selectOption('[data-lf-box="hotels"] [data-lf-sort]', 'rating');
    const rated = await page.$$eval('[data-lf-box="hotels"] li span', ss => ss.map(s => (s.textContent.match(/★ ([\d.]+)/) || [])[1]).filter(Boolean).map(Number));
    ok(rated.length && rated.every((x, i) => i === 0 || rated[i - 1] >= x), `@${w} hotels by rating ${rated.join(',')}`);
    // sights (Nearby off; tours on → shown on Travel? they live where the page puts them)
    await page.click('.ev-tabs [data-tab-go="nearby"]'); await page.waitForTimeout(300);
    const sights = await page.$('[data-lf-box="sights"] [data-lf-q]');
    ok(!!sights, `@${w} sights have the search bar`);
    if (sights) { await page.fill('[data-lf-box="sights"] [data-lf-q]', 'museum'); const sn = await page.$$eval('[data-lf-box="sights"] li b', bs => bs.map(b => b.textContent)); ok(sn.join() === 'Gulbenkian Museum,Tile Museum', `@${w} sights search → ${sn.join(', ')}`); }
    if (SHOTS) await page.locator('[data-slot="sights"]').screenshot({ path: `${SHOTS}/sights-${w}.png` });
    await page.click('.ev-tabs [data-tab-go="travel"]'); await page.waitForTimeout(200);
    if (SHOTS) await page.locator('[data-slot="hotels"]').screenshot({ path: `${SHOTS}/hotels-${w}.png` });
    ok((await overflow(page, '.ev')).length === 0, `@${w} page: no overflow ${(await overflow(page, '.ev')).join(' ')}`);
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failing` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
