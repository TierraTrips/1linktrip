// Trip itinerary dates: Day N counts from the trip's start; every item sits on its own date. A document read in
// with a wrong year (2026 for a 2027 trip) or month/day swapped is moved to the reading inside the trip; an item with
// no date, or none that fits, is "Unscheduled" (never Day 1). Outbound flight first, return flight on the last day.
// The page's own copy of a misdated item is shown on the fitting day too. 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/trip-dates.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const P = (name, lat, lon, from, to) => ({ name, address: name, lat, lon, city: name, country: 'Japan', cc: 'jp', from, to });
const BASECFG = { v: 2, type: 'Trip', title: 'Japan in spring', start: '2027-04-01', end: '2027-04-15', venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 35.6764, 139.65, '2027-04-01', '2027-04-08'), P('Osaka', 34.6937, 135.5023, '2027-04-08', '2027-04-15')], schedule: [] };
// what a document reading gave back: return flight with last year's date, a swapped day/month, an undated item
const DOC = { start_date: '2027-04-01', end_date: '2027-04-15', schedule: [
  { date: '2026-04-15', time: '17:00', title: 'Flight KIX → LAX', note: 'JL 60', kind: 'reservation' },
  { date: '2027-04-01', time: '11:00', title: 'Flight LAX → HND', note: 'JL 61', kind: 'reservation' },
  { date: '2027-05-04', time: '', title: 'Sumo morning practice', note: '', kind: 'activity' },
  { date: '', time: '', title: 'Buy a Suica card', note: '', kind: 'activity' },
  { date: '2027-09-30', time: '', title: 'Something far away', note: '', kind: 'activity' } ] };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
  const items = await page.evaluate((d) => window.__ep.docItems(window.__ep.unpackEvent(window.__ep.packEvent({ v: 2, type: 'Trip', title: 'Japan in spring', start: '2027-04-01', end: '2027-04-15' })), d, 'schedule').map(x => [x.title, x.date]), DOC);
  const m = Object.fromEntries(items);
  ok(m['Flight KIX → LAX'] === '2027-04-15', `wrong year fixed: ${m['Flight KIX → LAX']}`);
  ok(m['Sumo morning practice'] === '2027-04-05', `swapped month/day fixed: ${m['Sumo morning practice']}`);
  ok(m['Buy a Suica card'] === '' && m['Something far away'] === '', 'undated / unfixable → no date (not Day 1)');
  const cfg = await page.evaluate(async ([c, d]) => { const base = window.__ep.unpackEvent(window.__ep.packEvent(c)); const its = window.__ep.docItems(base, d, 'schedule'); return window.__ep.docApply(base, its); }, [BASECFG, DOC]);
  ok(cfg.schedule.find(x => /KIX/.test(x.title)).date === '2027-04-15' && cfg.schedule.find(x => /Suica/.test(x.title)).date === '', 'applied with the fitting dates');
  // the page's own misdated item (stored before this fix) is shown on the fitting day
  cfg.schedule.push({ date: '2026-04-03', time: '', title: 'Ghibli Museum', note: '', kind: 'activity' });
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), cfg)); await page.waitForSelector('#sec-schedule');
  const days = await page.$$eval('#sec-schedule .day', ds => ds.map(d => [d.querySelector('.day-h').textContent.trim(), [...d.querySelectorAll('.tl b')].map(b => b.textContent.trim())]));
  const flat = days.map(([h, xs]) => `${h} :: ${xs.join(' | ')}`); console.log(flat.join('\n'));
  ok(/^Day 1 /.test(days[0][0]) && /LAX → HND/.test(days[0][1][0]), 'outbound flight first, on Day 1');
  const dated = days.filter(([h]) => /^Day/.test(h));
  ok(/^Day 15 /.test(dated.at(-1)[0]) && dated.at(-1)[1].some(x => /KIX → LAX/.test(x)), 'return flight on the last day (Day 15)');
  ok(days.some(([h, xs]) => /^Day 3 /.test(h) && xs.some(x => /Ghibli/.test(x))), 'misdated page item shown on Day 3');
  ok(days.some(([h, xs]) => /^Day 5 /.test(h) && xs.some(x => /Sumo/.test(x))), 'swapped date on Day 5');
  const un = days.find(([h]) => h === 'Unscheduled'); ok(un && un[1].join() === 'Buy a Suica card,Something far away' && days.at(-1)[0] === 'Unscheduled', 'Unscheduled at the end');
  // trip dates come from the route + flights: one misread date ("6/2" read as June 2) can't shrink the trip
  const doc2 = { start_date: '2027-06-02', end_date: '2027-06-03', stops: [{ city: 'Tokyo', country: 'Japan', arrive: '2027-04-01', leave: '2027-04-08' }, { city: 'Osaka', country: 'Japan', arrive: '2027-04-08', leave: '2027-04-15' }],
    schedule: [{ date: '2027-04-01', time: '11:00', title: 'Flight LAX → HND', note: '', kind: 'reservation' }, { date: '2027-06-04', time: '', title: 'Fushimi Inari', note: '', kind: 'activity' }, { date: '2027-04-15', time: '17:00', title: 'Flight KIX → LAX', note: '', kind: 'reservation' }] };
  const it2 = await page.evaluate((d) => window.__ep.docItems(window.__ep.unpackEvent(window.__ep.packEvent({ v: 2, type: 'Trip', title: 'Japan', start: '2027-06-02', end: '2027-06-03' })), d, 'auto').map(x => [x.sec, x.key, x.title, x.date, x.end]), doc2);
  const dt = it2.find(x => x[1] === 'dates');
  ok(dt && dt[3] === '2027-04-01' && dt[4] === '2027-04-15', `trip dates from route + flights: ${JSON.stringify(dt)}`);
  ok(it2.find(x => x[2] === 'Fushimi Inari')[3] === '2027-04-06', `a day/month-swapped item re-read inside the trip: ${JSON.stringify(it2.find(x => x[2] === 'Fushimi Inari'))}`);
  // the review shows the trip dates first, editable
  const same = await page.evaluate((d) => window.__ep.docItems(window.__ep.unpackEvent(window.__ep.packEvent({ v: 2, type: 'Trip', title: 'Japan', start: '2027-04-01', end: '2027-04-15' })), d, 'auto').some(x => x.key === 'dates'), doc2);
  ok(same, 'trip dates are listed for review even when they already match');
  // a page whose stored dates don't cover its own route shows the route's span (and Day N from it)
  const bad = { ...BASECFG, start: '2027-06-02', end: '2027-06-03', schedule: [{ date: '2027-04-02', time: '', title: 'Tsukiji', note: '' }] };
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), bad)); await page.waitForSelector('.stub');
  const stub = await page.textContent('.stub-cell b');
  ok(/Apr 1/.test(stub) && /15/.test(stub), `header shows the route's span: ${stub}`);
  ok(/^Day 2 /.test(await page.$eval('#sec-schedule .day-h', h => h.textContent)), 'Day numbers follow it');
  ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
