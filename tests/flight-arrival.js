// Flight arrival day from both airports' time zones: HND→JFK (eastbound over the date line) lands the SAME calendar
// day, JFK→HND the next, LAX→SYD two days later, SYD→LAX the same day (or "the day before" for a late departure),
// a short domestic hop the same day. A plausible stored arrival date is kept; an implausible one is corrected.
// The guest card reads "Arrives 10:55 PM" or "Arrives 6:05 AM (+2)".
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/flight-arrival.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
(async () => {
  const browser = await chromium.launch(); const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|functions\/v1|auth\/v1|rest\/v1/, r => r.abort());
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.AIRPORT_TZ);
  const fix = (x) => page.evaluate((x) => window.__ep.flightArriveFix({ kind: 'flight', ...x }).end, x);
  ok(await page.evaluate(() => [window.__ep.apZone('HND'), window.__ep.apZone('jfk'), window.__ep.apZone('SYD'), window.__ep.apZone('LAX')].join()) === 'Asia/Tokyo,America/New_York,Australia/Sydney,America/Los_Angeles', 'airport zones');
  // UA 7924 HND→JFK Jun 2: stored (naively) as arriving Jun 3 22:55 → same day
  ok(await fix({ start: '2027-06-02T18:40', end: '2027-06-03T22:55', note: 'HND → JFK' }) === '2027-06-02T22:55', 'HND→JFK lands the same day (stored +1 corrected)');
  ok(await fix({ start: '2027-06-02T18:40', end: '2027-06-02T22:55', note: 'HND → JFK' }) === '2027-06-02T22:55', 'HND→JFK correct date kept');
  ok(await fix({ start: '2027-05-25T11:00', end: '2027-05-25T14:25', note: 'JFK → HND' }) === '2027-05-26T14:25', 'JFK→HND +1');
  ok(await fix({ start: '2027-05-25T22:30', end: '2027-05-25T06:05', from: 'LAX', to: 'SYD' }) === '2027-05-27T06:05', 'LAX→SYD +2');
  ok(await fix({ start: '2027-06-10T09:45', end: '2027-06-11T06:15', from: 'SYD', to: 'LAX' }) === '2027-06-10T06:15', 'SYD→LAX morning: lands "before" it left (same day, earlier clock)');
  ok(await fix({ start: '2027-06-10T01:30', end: '2027-06-10T21:50', from: 'SYD', to: 'LAX' }) === '2027-06-09T21:50', 'SYD→LAX after midnight: −1');
  ok(await fix({ start: '2027-06-10T07:00', end: '2027-06-11T08:25', note: 'SFO → LAX' }) === '2027-06-10T08:25', 'short domestic: same day');
  ok(await fix({ start: '2027-06-10T23:10', end: '2027-06-10T07:30', note: 'SFO → JFK' }) === '2027-06-11T07:30', 'red-eye: +1');
  ok(await fix({ start: '2027-06-10T07:00', end: '2027-06-12T08:25', note: 'Somewhere' }) === '2027-06-12T08:25', 'unknown airports: unchanged');
  ok(await fix({ start: '2027-06-10T07:00', end: '2027-06-10T09:25', to: 'Los Angeles' }) === '2027-06-10T09:25', 'no departure airport: unchanged');
  // the organizer's own schedule lines (Dylan's Japan Trip, 11/25): "Arrive New York JFK" was stored a day late
  const sched = (lines) => page.evaluate((l) => window.__ep.schedFlightFix(JSON.parse(JSON.stringify(l))).map(x => x.date).join(), lines);
  const DEP = { date: '2027-06-02', time: '22:45', title: 'Depart Tokyo Haneda (HND) on UA 7924 (operated by All Nippon Airways)', note: 'Nonstop, overnight' };
  ok(await sched([DEP, { date: '2027-06-03', time: '22:55', title: 'Arrive New York JFK', note: 'Local times as shown; flight duration 13h 10m.' }]) === '2027-06-02,2027-06-02', 'schedule HND→JFK: stored Jun 3 arrival → Jun 2 (13h 10m)');
  ok(await sched([DEP, { date: '2027-06-03', time: '22:55', title: 'Arrive New York JFK' }]) === '2027-06-02,2027-06-02', 'schedule HND→JFK without a duration: same day');
  ok(await sched([{ date: '2027-06-02', time: '22:45', title: 'Depart Tokyo Haneda (HND)' }, { date: '2027-06-02', time: '22:55', title: 'Arrive New York JFK' }]) === '2027-06-02,2027-06-02', 'schedule HND→JFK correct date kept');
  ok(await sched([{ date: '2027-06-02', time: '11:05', title: 'Fly NRT → JFK on JL 4' }, { date: '2027-06-03', time: '10:40', title: 'Arrive JFK' }]) === '2027-06-02,2027-06-02', 'schedule NRT→JFK: lands the same day, earlier clock');
  ok(await sched([{ date: '2027-04-25', time: '11:00', title: 'Depart JFK on NH 9' }, { date: '2027-04-25', time: '14:25', title: 'Land at Tokyo Haneda (HND)' }]) === '2027-04-25,2027-04-26', 'schedule JFK→HND westbound: +1');
  ok(await sched([{ date: '2027-04-25', time: '11:00', title: 'Depart JFK' }, { date: '2027-04-26', time: '14:25', title: 'Land at Haneda (HND)' }]) === '2027-04-25,2027-04-26', 'schedule JFK→HND correct +1 kept');
  ok(await sched([{ date: '2027-04-25', time: '', title: 'Fly out to Japan' }, { date: '2027-04-26', time: '16:55', title: 'Land at Haneda Airport' }]) === '2027-04-25,2027-04-26', 'schedule: no codes / no times → unchanged');
  ok(await page.evaluate(() => [window.__ep.schedZone({ title: 'Arrive New York JFK' }), window.__ep.schedZone(  { title: 'Depart Tokyo Haneda (HND) on UA 7924' }), window.__ep.schedZone({ title: 'Dinner at NEW place' })].join()) === 'America/New_York,Asia/Tokyo,', 'flight line zones');
  { // the page itself: event tab day list and .ics (arrival at 22:55 New York time = 02:55Z next day)
    const JC = { v: 2, type: 'Trip', title: 'Japan', start: '2027-05-28', end: '2027-06-02', tz: 'Asia/Tokyo', venue: { name: 'Tokyo', address: 'Tokyo', lat: 35.68, lon: 139.76, city: 'Tokyo', country: 'Japan', cc: 'jp' },
      schedule: [DEP, { date: '2027-06-03', time: '22:55', title: 'Arrive New York JFK', note: 'flight duration 13h 10m' }] };
    const ics = await page.evaluate((c) => window.__ep.icsText(window.__ep.normalize(c), 'x'), JC);
    ok(/DTSTART:20270602T134500Z/.test(ics) && /DTSTART:20270603T025500Z/.test(ics), '.ics: departure in Tokyo time, arrival in New York time');
    await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), JC)); await page.waitForSelector('.ev-hero');
    const t2 = await page.evaluate(() => document.body.innerText);
    ok(!/Jun 3/.test(t2) && /Arrive New York JFK/.test(t2), 'event tab: JFK arrival listed under Jun 2, no Jun 3');
  }
  // the guest's My trip card and timeline
  const CFG = { v: 2, type: 'Trip', title: 'Japan', start: '2027-05-25', end: '2027-06-02', venue: { name: 'Tokyo', address: 'Tokyo', lat: 35.68, lon: 139.76, city: 'Tokyo', country: 'Japan', cc: 'jp' }, tools: { mytrip: true, travel: true } };
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), CFG)); await page.waitForSelector('.ev-hero');
  await page.evaluate((c) => { const k = 'ep:' + window.__ep.itinKeyOf(c); localStorage.setItem(k, JSON.stringify([
    { kind: 'flight', name: 'United UA 7924', flight: 'UA 7924', start: '2027-06-02T18:40', end: '2027-06-03T22:55', note: 'HND → JFK', to: 'JFK' },
    { kind: 'flight', name: 'United UA 7925', flight: 'UA 7925', start: '2027-05-25T11:00', end: '2027-05-25T14:25', note: 'JFK → HND', to: 'HND' }])); }, CFG);
  await page.reload(); await page.waitForSelector('.ev-hero');
  const txt = await page.evaluate(() => document.body.textContent);
  ok(/Arrives 10:55 PM(?! \()/.test(txt), 'return flight reads "Arrives 10:55 PM" (no +1)');
  ok(/Arrives 2:25 PM \(\+1\)/.test(txt), 'outbound reads "Arrives 2:25 PM (+1)"');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await browser.close(); console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
