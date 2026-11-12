// Trips: the host's Route (cities + dates) shows inside the Itinerary as legs — one block per stop with its date range
// (tap → Nearby for that stop), that stop's days listed under it, undated items after the legs. No separate Route
// section for trips (route documents move into the Itinerary). A 1-stop route renders; a route filled from a document
// (stops without map coordinates) renders. Non-trip pages and trips without a route render exactly as before.
// No horizontal overflow at 390 and 320.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/itinerary-route.js
//   OLD_BASE=http://127.0.0.1:18766/ node tests/itinerary-route.js   # also compare legacy pages against a previous build
//   SHOTS=/tmp/ep-shots node tests/itinerary-route.js
//
// Needs Playwright. Exit code 1 on any failure.
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const OLD_BASE = process.env.OLD_BASE || '';
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
const P = (name, lat, lon, from, to) => ({ name, address: name + ', Japan', lat, lon, city: name, region: '', country: 'Japan', cc: 'jp', from, to });
const JAPAN = {
  v: 2, type: 'Trip', title: 'Japan in spring', start: '2027-04-01', end: '2027-04-10', host: 'Dylan',
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, city: 'Tokyo', country: 'Japan', cc: 'jp' }, tz: 'Asia/Tokyo',
  stops: [P('Tokyo', 35.6762, 139.6503, '2027-04-01', '2027-04-04'), P('Kyoto', 35.0116, 135.7681, '2027-04-04', '2027-04-07'), P('Osaka', 34.6937, 135.5023, '2027-04-07', '2027-04-10')],
  schedule: [
    { date: '2027-04-01', time: '18:00', title: 'Land at Haneda', note: '' },
    { date: '2027-04-02', time: '', title: 'Shibuya and Harajuku', note: '' },
    { date: '2027-04-04', time: '10:00', title: 'Shinkansen to Kyoto', note: 'Nozomi 7' },
    { date: '2027-04-05', time: '', title: 'Fushimi Inari at dawn', note: '' },
    { date: '2027-04-08', time: '', title: 'Dotonbori food crawl', note: '' },
    { date: '2027-04-10', time: '12:00', title: 'Fly home from KIX', note: '' },
    { date: '', time: '', title: 'Pick up JR passes', note: '' },
  ],
  files: [{ id: 'r1', sec: 'route', name: 'Route map.pdf', url: 'https://example.com/route.pdf', type: 'pdf', size: 1000 }],
};

(async () => {
  const browser = await chromium.launch();
  const mk = async (w) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route(/open-meteo|overpass|nominatim|googleapis\.com\/(?!css)|tile\.openstreetmap|timeapi|photon|ai-import/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES); await page.evaluate(() => localStorage.clear());
    return { ctx, page, errors };
  };
  const open = async (page, packed, b = BASE) => { await page.goto(b + '#e=' + packed); await page.waitForSelector('.ev-body'); await page.waitForTimeout(400); };
  const legs = (page) => page.$$eval('#sec-schedule .leg', ls => ls.map(l => ({ name: l.querySelector('.leg-h b').textContent, range: (l.querySelector('.leg-h small') || {}).textContent || '', btn: l.querySelector('.leg-h').tagName === 'BUTTON', items: [...l.querySelectorAll('.tl li b')].map(b => b.textContent) })));

  // ---------- 3-city trip with dates + schedule items, at 390 and 320 ----------
  for (const w of [390, 320]) {
    const { ctx, page, errors } = await mk(w);
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), JAPAN);
    await open(page, packed);
    ok(!(await page.$('#sec-route')), `@${w} no separate Route section`);
    ok(await page.$eval('#sec-schedule .sec-h', e => e.textContent) === 'Itinerary', `@${w} section is called Itinerary`);
    const L = await legs(page);
    ok(L.map(l => l.name).join() === 'Tokyo,Kyoto,Osaka', `@${w} legs: ${L.map(l => l.name).join()}`);
    ok(L.every(l => l.range && l.btn), `@${w} each leg shows dates and is tappable ${JSON.stringify(L.map(l => l.range))}`);
    ok(L[0].items.join('|') === 'Land at Haneda|Shibuya and Harajuku', `@${w} Tokyo items ${L[0].items.join('|')}`);
    ok(L[1].items.join('|') === 'Shinkansen to Kyoto|Fushimi Inari at dawn', `@${w} Kyoto items (leave day → next city) ${L[1].items.join('|')}`);
    ok(L[2].items.join('|') === 'Dotonbori food crawl|Fly home from KIX', `@${w} Osaka items (last day stays) ${L[2].items.join('|')}`);
    const after = await page.$$eval('#sec-schedule .legs ~ .day', ds => ds.map(d => d.textContent));
    ok(after.length === 1 && /Anytime/.test(after[0]) && /Pick up JR passes/.test(after[0]), `@${w} undated items after the legs ${JSON.stringify(after)}`);
    ok(!!(await page.$('#sec-schedule .route-docs li')) && await page.$eval('#sec-schedule .route-docs b', e => e.textContent) === 'Route map.pdf', `@${w} route document inside the Itinerary`);
    ok(await page.$eval('#sec-schedule .day-h', e => !e.querySelector('.day-city')), `@${w} no repeated city tag on days inside a leg`);
    const of = await overflow(page); ok(of.length === 0, `@${w} no overflow ${of.join(' ')}`);
    if (SHOTS) { await page.locator('#sec-schedule').scrollIntoViewIfNeeded(); await page.locator('#sec-schedule').screenshot({ path: `${SHOTS}/itin-route-${w}.png` }); }
    if (w === 390) {
      // the Itinerary takes the Route's slot (route is first in the Trip order)
      ok(await page.$eval('.ev-panel[data-panel="event"] .ev-body', b => b.querySelector('.ev-sec').id) === 'sec-schedule', 'Itinerary is the first section (Route slot)');
      await page.click('#sec-schedule [data-route-stop="1"]'); await page.waitForTimeout(300);
      ok(await page.$eval('.ev-panel[data-panel="nearby"]', p => !p.hidden), 'tapping Kyoto opens Nearby');
    }
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }

  // ---------- route only (no schedule items), 1 stop ----------
  {
    const { ctx, page, errors } = await mk(390);
    const one = { ...JAPAN, schedule: [], files: [], stops: [JAPAN.stops[0]] };
    await open(page, await page.evaluate((c) => window.__ep.packEvent(c), one));
    const L = await legs(page);
    ok(L.length === 1 && L[0].name === 'Tokyo' && L[0].items.length === 0, `1-stop route, no items: ${JSON.stringify(L)}`);
    ok(errors.length === 0, `1-stop: no page errors ${errors.join(' ')}`);
    await ctx.close();
  }

  // ---------- route filled from a document (docApply; place lookup unavailable → stops have no coordinates) ----------
  {
    const { ctx, page, errors } = await mk(390);
    const filled = await page.evaluate(async (c) => {
      const base = { ...c, stops: [], venue: null, files: [], schedule: c.schedule.slice(0, 3) };
      const items = [['Tokyo', '2027-04-01', '2027-04-04'], ['Kyoto', '2027-04-04', '2027-04-07'], ['Osaka', '2027-04-07', '2027-04-10']].map(([title, date, end]) => ({ sec: 'route', title, country: 'Japan', date, end }));
      return window.__ep.docApply(window.__ep.unpackEvent(window.__ep.packEvent(base)), items);
    }, JAPAN);
    ok(filled.stops.length === 3 && filled.stops.every(s => s.lat == null && s.from), `docApply stored ${JSON.stringify(filled.stops)}`);
    await open(page, await page.evaluate((c) => window.__ep.packEvent(c), filled));
    const L = await legs(page);
    ok(L.map(l => l.name).join() === 'Tokyo,Kyoto,Osaka' && L.every(l => !l.btn && l.range), `doc-filled route renders as legs (not tappable without a map point) ${JSON.stringify(L)}`);
    ok(L[0].items.length === 2 && L[1].items[0] === 'Shinkansen to Kyoto', `doc-filled: items under legs ${JSON.stringify(L.map(l => l.items))}`);
    const one = await page.evaluate((c) => window.__ep.docApply(window.__ep.unpackEvent(window.__ep.packEvent({ ...c, stops: [], venue: null, files: [], schedule: [] })), [{ sec: 'route', title: 'Lisbon', country: 'Portugal', date: '2027-04-01', end: '2027-04-05' }]), JAPAN);
    await open(page, await page.evaluate((c) => window.__ep.packEvent(c), one));
    ok((await legs(page)).map(l => l.name).join() === 'Lisbon', 'doc-filled 1-stop route renders');
    ok(errors.length === 0, `doc-filled: no page errors ${errors.join(' ')}`);
    await ctx.close();
  }

  // ---------- legacy: non-trip pages and trips without a route render as before ----------
  {
    const { ctx, page } = await mk(390);
    const party = { v: 2, type: 'Party', title: 'Lake weekend', start: '2027-06-12T15:00', host: 'Sam', schedule: [{ date: '2027-06-12', time: '16:00', title: 'Swim', note: '' }], stops: JAPAN.stops };
    const trip0 = { ...JAPAN, stops: [], files: [] };
    for (const [n, c] of [['party', party], ['trip without route', trip0]]) {
      const packed = await page.evaluate((x) => window.__ep.packEvent(x), c);
      const body = async (b) => { await open(page, packed, b); return page.$eval('.ev-panel[data-panel="event"] .ev-body', e => e.innerHTML.replace(/<div data-slot="weather">[\s\S]*?<\/section>/, '')); };
      const now = await body(BASE);
      ok(!/class="route legs"/.test(now), `${n}: no legs`);
      if (OLD_BASE) ok(now === await body(OLD_BASE), `${n}: Event tab identical to the previous build`);
    }
    await ctx.close();
  }

  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
