// Day order in the Itinerary / schedule (Dylan's audit, item 3): every day reads in time order — the organizer's items,
// the guest's own bookings and their planned places together. An item without a time keeps its place in its own list
// (it follows the item before it there; first in the list → it opens the day); same time → the organizer's item first.
// The guest's booking for the hotel the organizer checks everyone into (same hotel, same day) folds into the organizer's
// "Check in: <hotel>" row — one row, marked Yours, which opens the booking — instead of a second row. A booking for another
// hotel, or the same hotel on another day, stays its own row. Same order in a day's sheet and on an event's schedule;
// "Event only" shows the organizer's rows without the mark. ?demo=japan Day 1: Land 3:30 → Check in: Park Hotel Tokyo 6:00 (Yours), once.
// No page errors, no overflow at 390 / 320.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/day-order.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).length; });
const P = (name, lat, lon, from, to) => ({ name, address: name + ', Japan', lat, lon, city: name, country: 'Japan', cc: 'jp', from, to });
const CFG = { v: 2, type: 'Trip', title: 'Day order trip', start: '2027-04-02', end: '2027-04-05', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 35.6764, 139.65, '2027-04-02', '2027-04-05')],
  // organizer order on purpose not by time; "Pick up rail passes" (no time) follows "Land at Haneda"; "Free morning" opens Apr 3
  schedule: [{ date: '2027-04-02', time: '18:00', title: 'Check in: Park Hotel Tokyo', note: 'Lobby on the 25th floor', kind: 'reservation' },
    { date: '2027-04-02', time: '15:30', title: 'Land at Haneda', note: '' }, { date: '2027-04-02', time: '', title: 'Pick up rail passes', note: '' },
    { date: '2027-04-03', time: '', title: 'Free morning', note: '' }, { date: '2027-04-03', time: '10:00', title: 'Museum', note: '' },
    { date: '2027-04-04', time: '12:00', title: 'Check in: Park Hotel Tokyo', note: '' }],
  tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const ITIN = [{ id: 'h1', kind: 'hotel', name: 'Park Hotel Tokyo', start: '2027-04-02T15:00', end: '2027-04-04T11:00', confNo: 'PK1' },
  { id: 'h2', kind: 'hotel', name: 'Hotel Gracery Shinjuku', start: '2027-04-02T18:00', end: '2027-04-03T11:00', confNo: 'GR2' },
  { id: 'f1', kind: 'flight', name: 'ANA 105', start: '2027-04-02T12:00', confNo: 'AN3' }];
const PLAN = [{ id: 'p1', src: 'osm', ref: 'n1', name: 'Blue Bottle Coffee', lat: 35.68, lon: 139.8, addr: 'Tokyo', type: 'food', cat: 'cafes', day: '2027-04-03', time: '09:00', note: '', booked: false, conf: '', rating: 0, count: 0, hours: '' }];
const WED = { v: 2, type: 'Wedding', title: 'Day order wedding', start: '2027-06-12T17:00', end: '2027-06-13', tz: 'America/Cancun',
  venue: { name: 'Hotel Esencia', address: 'Xpu-Ha, Quintana Roo, Mexico', lat: 20.47, lon: -87.26, city: 'Xpu-Ha', country: 'Mexico', cc: 'mx' },
  schedule: [{ date: '2027-06-12', time: '17:00', title: 'Ceremony at Hotel Esencia', note: '' }, { date: '2027-06-12', time: '14:00', title: 'Check in: Hotel Esencia', note: '' }],
  tools: { nearby: false, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const WITIN = [{ id: 'w1', kind: 'hotel', name: 'Hotel Esencia', start: '2027-06-12T15:00', end: '2027-06-14T11:00', confNo: 'ES1' }];

async function setup(browser, w) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.route(/googleapis|gstatic|overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon|functions\/v1|wikimedia|supabase/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  return { ctx, page };
}
const open = async (page, cfg, itin, plan) => {
  const key = await page.evaluate((c) => window.__ep.itinKeyOf(window.__ep.normalize(JSON.parse(JSON.stringify(c)))).slice(5), cfg);
  await page.evaluate(([k, it, pl]) => { localStorage.clear(); localStorage.setItem('ep:itin:' + k, JSON.stringify(it)); localStorage.setItem('ep:plan:' + k, JSON.stringify(pl)); }, [key, itin, plan]);
  const packed = await page.evaluate((c) => window.__ep.packEvent(c), cfg);
  await page.goto(BASE + '#e=' + packed); await page.waitForSelector('#sec-schedule .day'); await page.waitForTimeout(300);
};
// the rows of one day in the Itinerary: [time, title, mine?]
const dayRows = (page, n) => page.$$eval('#sec-schedule .day', (ds, n) => [...ds[n].querySelectorAll('.tl > li')].map(l => ({ time: (l.querySelector('time') || {}).textContent || '',
  title: (l.querySelector('b') || {}).textContent.replace(/\s+/g, ' ').trim(), mine: l.classList.contains('mine'), yours: !!l.querySelector('.yours'), ref: (l.querySelector('[data-ds]') || { dataset: {} }).dataset.ds || '' })), n);
const dayIdx = (page, re) => page.$$eval('#sec-schedule .day', (ds, re) => ds.findIndex(d => new RegExp(re).test(d.querySelector('.day-h').textContent)), re);
const mins = (s) => { const m = String(s).match(/(\d+):(\d+)\s*(AM|PM)?/i); if (!m) return null; let h = +m[1] % 12; if (/pm/i.test(m[3] || '')) h += 12; return h * 60 + +m[2]; };
const inOrder = (rows) => { const ts = rows.map(r => mins(r.time)).filter(x => x != null); return ts.every((t, i) => !i || t >= ts[i - 1]); };
const sheet = (page) => page.evaluate(() => { const d = document.querySelector('dialog.ds-sheet'); return d && d.open ? { title: d.querySelector('.ds-t').textContent, text: d.textContent.replace(/\s+/g, ' ') } : null; });
const closeSheet = async (page) => { await page.click('dialog.ds-sheet [data-ds-close]'); await page.waitForTimeout(250); };

(async () => {
  const browser = await chromium.launch();
  try {
    for (const w of [390, 320]) {
      const { ctx, page } = await setup(browser, w);

      // ---- the example Japan trip, as Dylan saw it ----
      await page.goto(BASE + '?demo=japan'); await page.waitForSelector('#sec-schedule .day'); await page.waitForTimeout(500);
      let d = await dayIdx(page, 'Day 1'); let r = await dayRows(page, d);
      ok(r.map(x => x.title).join(' / ') === 'Land at Haneda / Check in: Park Hotel Tokyo Yours' && inOrder(r), `@${w} demo Day 1: Land 3:30 → Check in 6:00, in time order ${JSON.stringify(r.map(x => x.time + ' ' + x.title))}`);
      ok(r.filter(x => /Park Hotel/.test(x.title)).length === 1 && r[1].yours && r[1].mine, `@${w} demo Day 1: Park Hotel Tokyo once, folded into the check-in row and marked Yours`);
      ok(await page.$$eval('#sec-schedule .day', ds => ds.every(d => { const ts = [...d.querySelectorAll('.tl > li time')].map(t => t.textContent.trim()).filter(Boolean).map(s => { const m = s.match(/(\d+):(\d+)\s*(AM|PM)/i); return (+m[1] % 12 + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + +m[2]; }); return ts.every((t, i) => !i || t >= ts[i - 1]); })), `@${w} demo: every day in time order`);
      await page.click(`#sec-schedule .day >> nth=${d} >> [data-ds="${r[1].ref}"]`); await page.waitForSelector('dialog.ds-sheet[open]');
      let s = await sheet(page); ok(s && s.title === 'Park Hotel Tokyo' && /Confirmation\s*SAMPLE2/.test(s.text) && /Edit booking/.test(s.text), `@${w} demo: the check-in row opens the guest's booking (${s && s.text.slice(0, 90)})`);
      await closeSheet(page);
      ok(await overflow(page) === 0, `@${w} demo: no overflow`);

      // ---- a constructed trip ----
      await open(page, CFG, ITIN, PLAN);
      await page.click('#sec-schedule .sched-all').catch(() => {});
      d = await dayIdx(page, 'Apr 2'); r = await dayRows(page, d);
      const want = ['ANA 105 Yours', 'Land at Haneda', 'Pick up rail passes', 'Check in: Park Hotel Tokyo Yours', 'Hotel Gracery Shinjuku Yours'];
      ok(r.map(x => x.title).join(' / ') === want.join(' / ') && inOrder(r), `@${w} Apr 2: flight 12:00, Land 3:30, rail passes (no time, after Land), check-in 6:00, other hotel 6:00 ${JSON.stringify(r.map(x => x.time + ' ' + x.title))}`);
      ok(r.filter(x => /Park Hotel/.test(x.title)).length === 1 && r[3].yours && r[3].time && mins(r[3].time) === 18 * 60, `@${w} check-in + matching booking → one row, the organizer's 6:00, marked Yours`);
      ok(r[4].mine && r[4].ref === 'bk:h2' && mins(r[4].time) === 18 * 60, `@${w} a different hotel at the same time stays its own row, after the organizer's`);
      d = await dayIdx(page, 'Apr 3'); r = await dayRows(page, d);
      ok(r.map(x => x.title).join(' / ') === 'Free morning / Blue Bottle Coffee Saved / Museum / Check out · Hotel Gracery Shinjuku', `@${w} Apr 3: untimed first item opens the day, then 9:00 plan, 10:00, 11:00 check-out ${JSON.stringify(r.map(x => x.time + ' ' + x.title))}`);
      d = await dayIdx(page, 'Apr 4'); r = await dayRows(page, d);
      ok(r.some(x => /^Check out/.test(x.title)) && r.some(x => x.title === 'Check in: Park Hotel Tokyo' && !x.yours) && inOrder(r), `@${w} Apr 4: same hotel, another day → not folded; check-out 11:00 before 12:00 ${JSON.stringify(r.map(x => x.time + ' ' + x.title))}`);
      // the folded row opens the booking for that day
      d = await dayIdx(page, 'Apr 2'); r = await dayRows(page, d);
      await page.click(`#sec-schedule [data-ds="${r[3].ref}"]`); await page.waitForSelector('dialog.ds-sheet[open]');
      s = await sheet(page); ok(s && s.title === 'Park Hotel Tokyo' && /Confirmation\s*PK1/.test(s.text), `@${w} the folded row opens the booking (${s && s.text.slice(0, 80)})`);
      await closeSheet(page);
      // the day's sheet: same order, the hotel once
      await page.click('#sec-schedule [data-ds="day:2027-04-02"]'); await page.waitForSelector('dialog.ds-sheet[open]');
      const dr = await page.$$eval('dialog.ds-sheet .ds-day .ds-row b', bs => bs.map(b => b.textContent.trim()));
      ok(dr.slice(0, 5).join(' / ') === 'ANA 105 / Land at Haneda / Pick up rail passes / Check in: Park Hotel Tokyo / Hotel Gracery Shinjuku' && dr.filter(x => /Park Hotel/.test(x)).length === 1, `@${w} day sheet: same order, Park Hotel once ${JSON.stringify(dr)}`);
      ok(/Yours · Conf\. PK1/.test(await page.textContent('dialog.ds-sheet .ds-day')), `@${w} day sheet: the check-in row says Yours + confirmation`);
      await closeSheet(page);
      ok(await overflow(page) === 0, `@${w} trip: no overflow`);
      // ---- an event (wedding): same fold + order ----
      await open(page, WED, WITIN, []);
      r = await dayRows(page, 0);
      ok(r.length === 2 && /^Check in: Hotel Esencia/.test(r[0].title) && r[0].yours && /^Ceremony/.test(r[1].title) && !r[1].yours, `@${w} wedding: check-in folded (Yours), before the 5:00 "Ceremony at Hotel Esencia" (not a check-in, not folded) ${JSON.stringify(r.map(x => x.time + ' ' + x.title))}`);
      await page.click(`#sec-schedule [data-ds="${r[0].ref}"]`); await page.waitForSelector('dialog.ds-sheet[open]');
      s = await sheet(page); ok(s && s.title === 'Hotel Esencia' && /Confirmation\s*ES1/.test(s.text), `@${w} wedding: the row opens the booking`);
      await closeSheet(page);
      // Event only: the organizer's rows, no mark
      await page.click('#sec-schedule [data-sched="event"]'); await page.waitForTimeout(200); r = await dayRows(page, 0);
      ok(r.length === 2 && /^Check in: Hotel Esencia/.test(r[0].title) && !r[0].yours && !r[0].mine, `@${w} Event only: the organizer's check-in row, no Yours ${JSON.stringify(r.map(x => x.title))}`);
      await page.click('#sec-schedule [data-sched="all"]'); await page.waitForTimeout(200);
      ok(await overflow(page) === 0, `@${w} wedding: no overflow`);

      ok(!page._err.length, `@${w} no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
  } catch (e) { ok(false, 'threw: ' + (e && e.stack || e)); }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
