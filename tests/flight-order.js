// Flights in date order everywhere, on a page whose stored dates are wrong (a real case: the page said Jun 2–3; the
// guest's flights are UA JFK → HND Apr 25 and HND → JFK Jun 2). The header shows Apr 25 – Jun 2, Day 1 is the
// outbound day, and the outbound flight comes first in the Itinerary, My trip → Your bookings and Your itinerary;
// a red-eye the night before a correct start doesn't move the trip; bookings keep their stored index for Edit. 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/flight-order.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const CFG = { v: 2, type: 'Trip', title: 'Japan 2027', start: '2027-06-02', end: '2027-06-03', tz: 'Asia/Tokyo',
  venue: { name: 'Japan', address: 'Japan', lat: 36.2048, lon: 138.2529, city: '', country: 'Japan', cc: 'jp' },
  schedule: [{ date: '2027-05-03', time: '', title: 'Fushimi Inari', note: '' }, { date: '2027-04-28', time: '', title: 'Senso-ji', note: '' }],
  tools: { nearby: false, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru|functions\/v1/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  const seed = (c, items) => page.evaluate(([k, items]) => { localStorage.clear(); localStorage.setItem('ep:itin:' + k, JSON.stringify(items)); }, [keyOf(c), items]);
  // stored in the order the guest added them: return first
  await seed(CFG, [{ id: 'b2', kind: 'flight', name: 'UA 7924 Tokyo HND → New York JFK', flight: 'UA 7924', start: '2027-06-02T22:45', end: '2027-06-02T22:55' },
    { id: 'b1', kind: 'flight', name: 'UA 7909 JFK → HND (Flight to Tokyo)', flight: 'UA 7909', start: '2027-04-25T13:30', end: '2027-04-26T16:55' }]);
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), CFG)); await page.waitForSelector('#sec-schedule');
  const stub = await page.textContent('.stub-cell b'); ok(/Apr 25/.test(stub) && /Jun 2/.test(stub), `header: ${stub}`);
  const tl = await page.$$eval('#sec-schedule .tl b', bs => bs.map(b => b.textContent));
  ok(/7909/.test(tl[0]) && /7924/.test(tl[tl.length - 1]), `itinerary: outbound first, return last (${tl.join(' | ')})`);
  ok(/^Day 1 /.test(await page.$eval('#sec-schedule .day-h', h => h.textContent)), 'Day 1 is the outbound day');
  await page.click('[data-tab-go="mytrip"]'); await page.waitForSelector('.bookings li');
  const bk = await page.$$eval('.bookings li b', bs => bs.map(b => b.textContent));
  ok(/7909/.test(bk[0]) && /7924/.test(bk[1]), `Your bookings: outbound first (${bk.join(' | ')})`);
  await page.click('.bookings li:first-child [data-itin-edit]'); await page.waitForSelector('#it-name');
  ok(/7909/.test(await page.inputValue('#it-name')), 'Edit on the first card opens the outbound flight');
  await page.click('[data-itin-cancel]');
  const plan = await page.$$eval('#sec-plan .sub-h', hs => hs.map(h => h.textContent));
  ok(plan.length === 2 && /Apr 25/.test(plan[0]) && /Jun 2/.test(plan[1]), `Your itinerary by day: in date order (${plan.join(' | ')})`);
  // a correct page with a red-eye the night before: dates unchanged
  const ok2 = { ...CFG, title: 'Japan B', start: '2027-04-26', end: '2027-06-02' };
  await seed(ok2, [{ id: 'b1', kind: 'flight', name: 'Red-eye', start: '2027-04-25T23:30' }]);
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), ok2)); await page.waitForSelector('.stub');
  ok(/Apr 26/.test(await page.textContent('.stub-cell b')), `a red-eye the night before doesn't move the trip: ${await page.textContent('.stub-cell b')}`);
  ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
