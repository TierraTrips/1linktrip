// Arrivals board (Guest list → Arrivals), offline from made-up data: timeline by day → airport → hour, list, filters
// (airport, day, no info yet), departures, CSV, flight-status links (plain FlightAware), the organizer's edit dialog, and
// bookings shared by a guest who opted in filling the blanks of RSVP travel. 390 + 1280 screenshots to SHOTS.
//   python3 -m http.server 18791 --bind 127.0.0.1 &  BASE=http://127.0.0.1:18791/ SHOTS=<dir> node tests/arrivals.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/'; const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const SETUP = `(() => {
  localStorage.setItem('ep:signedIn', 'true'); const X = window.__ep.lists; const B = X.B(); X.buildForm(); const cfg = B.cfg; // tulum wedding: 2027-03-13
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const H = (id, name) => ({ id, name, lang: '', plus_ones: 0, greeting: 'household', group_id: null, token: id.padEnd(24, 'a'), opens: 0, sort: 0 });
  const hs = [H('h1', 'The Garcias'), H('h2', 'Ben Okafor'), H('h3', 'The Kims'), H('h4', 'Dee Nolan'), H('h5', 'Priya Shah')];
  const P = (id, hid, name) => ({ id, household_id: hid, name, age: 'adult', plus_ones: 0, added_by: 'host', sort: 0, created_at: ago(1000), table_id: null });
  const ps = [P('p1', 'h1', 'Ana Garcia'), P('p2', 'h1', 'Luis Garcia'), P('p3', 'h2', 'Ben Okafor'), P('p4', 'h3', 'Jae Kim'), P('p5', 'h3', 'Min Kim'), P('p6', 'h4', 'Dee Nolan'), P('p7', 'h5', 'Priya Shah')];
  const rs = [{ person_id: 'p6', attending: false, note: null, created_at: ago(5) }];
  const tr = [{ household_id: 'h1', arr_date: '2027-03-12', arr_time: '11:45', arr_place: 'CUN', arr_no: 'AA 1350', dep_date: '2027-03-15', dep_time: '18:20', dep_place: 'cun', dep_no: 'AA 1351', stay: 'Hotel Esencia', updated_by: 'guest' },
    { household_id: 'h2', arr_date: '2027-03-12', arr_time: '11:10', arr_place: 'Cancun CUN', arr_no: 'TRAIN 7', stay: '', updated_by: 'guest' },
    { household_id: 'h4', arr_date: '2027-03-12', arr_time: '09:00', arr_place: 'CUN', updated_by: 'guest' }];
  // the Kims' own bookings, shared (opt-in): a flight in on the 11th into TQO, the hotel, and the flight home
  const trips = [{ user_id: 'u3', household_id: 'h3', name: 'Jae Kim', items: [{ kind: 'flight', name: 'United UA 990', flight: 'UA 990', start: '2027-03-11T07:00', end: '2027-03-11T14:05', from: 'SFO', to: 'TQO' },
    { kind: 'hotel', name: 'Azulik', start: '2027-03-11', end: '2027-03-15' }, { kind: 'flight', name: 'United UA 991', flight: 'UA 991', start: '2027-03-15T15:30', end: '2027-03-15T22:00', from: 'TQO', to: 'SFO' }, { kind: 'flight', name: 'Old trip', flight: 'UA 1', start: '2026-01-01T10:00', from: 'SFO', to: 'JFK' }] },
    { user_id: 'u9', household_id: null, name: 'Walk-in Wren', items: [{ kind: 'train', name: 'Tren Maya 12', start: '2027-03-12T08:00', end: '2027-03-12T10:30', from: 'Merida', to: 'Tulum' }] }];
  window.__fakeData = [...hs.map(h => h.name), 'Hotel Esencia', 'Azulik', 'Walk-in Wren', 'Jae Kim'];
  X.setG({ eid: 'e0', ev: { id: 'e0', slug: 'cov-page', published: true }, cfg, filter: 'all', grp: '', by: false, sel: new Set(), tab: 'arr', hs, ps, rs, gs: [], hot: new Map(), opens: 0, ts: [], seat: { show: false },
    st: { pend: false, grp: '', q: '', hh: false, fold: false, view: 'cards' }, tr, trips, ivOff: true, stOff: true });
  X.glMount();
})()`;
(async () => {
  const browser = await chromium.launch();
  for (const w of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, deviceScaleFactor: 2, isMobile: w < 600, hasTouch: w < 600, serviceWorkers: 'block', locale: 'en-US' });
    await ctx.route(/googleapis|gstatic|overpass|nominatim|open-meteo|tile\.openstreetmap|timeapi|photon|supabase\.co/, r => r.abort());
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(BASE + '#edit-ex=tulum-wedding'); await page.waitForTimeout(1500); await page.evaluate(SETUP); await page.waitForTimeout(300);
    const txt = () => page.$eval('.ar', e => e.innerText.replace(/\s+/g, ' '));
    if (w === 1280) {
      ok(await page.$eval('[data-gl-tab="trav"]', b => b.getAttribute('aria-selected') === 'true' && !b.hidden), 'the arrivals board is on the Travel tab (11/26: travel first)');
      const days = await page.$$eval('.ar-day:not(.ar-und) .ar-dh span', xs => xs.map(x => x.textContent));
      ok(days.length === 2 && /March 11/.test(days[0]) && /March 12/.test(days[1]), `timeline by day: ${days.join(' | ')}`);
      const ports = await page.$$eval('.ar-day:not(.ar-und)', ds => ds.map(d => [...d.querySelectorAll('.ar-code > b')].map(b => b.getAttribute('aria-label') || b.textContent).join(',')));
      ok(ports[0] === 'TQO' && ports[1] === 'CUN,TULUM', `grouped by airport ("cun" / "Cancun CUN" → CUN; shared flight → TQO): ${JSON.stringify(ports)}`);
      const cunPort = '.ar-day:not(.ar-und) .ar-port:has(.ar-code > b[aria-label="CUN"])'; const cun = await page.$$eval(cunPort + ' .ar-tag .ar-who b', xs => xs.map(x => x.textContent));
      ok(JSON.stringify(cun) === JSON.stringify(['Ben Okafor', 'The Garcias']), `CUN in time order, decliner left out: ${cun.join(', ')}`);
      const hrs = await page.$$eval(cunPort + ' .ar-h', xs => xs.map(x => x.textContent)); ok(hrs.join() === '11:00 AM', `hour rows: ${hrs}`);
      const link = await page.$eval('.ar-tag a.ar-no', a => [a.href, a.target, a.rel]).catch(() => null);
      ok(link && link[0] === 'https://www.flightaware.com/live/flight/UA990' && link[1] === '_blank', `flight status = plain FlightAware link, no tracking: ${link}`);
      ok(!(await page.$$eval('.ar-tag .ar-no', xs => xs.map(x => x.tagName + x.textContent))).some(s => /^A.*TRAIN/.test(s)), 'a train number is shown, not linked');
      ok(/Shared trip/i.test(await page.$eval('.ar-day', e => e.innerText)), 'bookings from an opted-in guest are marked Shared trip');
      ok(/Walk-in Wren/.test(await txt()), 'a sharing guest who is not on the guest list still shows (by their name)');
      ok(/No arrival yet/.test(await txt()) && /Priya Shah/.test(await page.$eval('.ar-und', e => e.innerText)), 'households without an arrival are listed under No arrival yet');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1280-arrivals-timeline.png`, fullPage: true });
      // filters
      await page.click('[data-ar-place="CUN"]'); ok(!/Kim/.test(await page.$eval('.ar-day', e => e.innerText)) && (await page.$$('.ar-day:not(.ar-und)')).length === 1, 'airport filter: CUN only');
      ok(/CUN 3/.test(await page.$eval('[data-ar-place="CUN"]', b => b.innerText.replace(/\s+/g, ' '))), 'airport chip counts guests: CUN 3 (Garcias 2 + Ben 1; Dee declined)');
      await page.click('[data-ar-place=""]'); await page.click('[data-ar-day="2027-03-11"]'); ok((await page.$$('.ar-day:not(.ar-und)')).length === 1 && /March 11/.test(await page.$eval('.ar-dh', e => e.innerText)), 'day filter');
      await page.click('[data-ar-day=""]'); await page.click('[data-ar-none]'); const none = await page.$$eval('.ar-plain li b', xs => xs.map(x => x.textContent)); ok(JSON.stringify(none) === '["Priya Shah"]', `No info yet: ${none}`);
      await page.click('[data-ar-none]');
      // departures
      await page.click('[data-ar-dir="dep"]'); const dep = await page.$$eval('.ar-day:not(.ar-und) .ar-dh span', xs => xs.map(x => x.textContent));
      ok(dep.length === 1 && /March 15/.test(dep[0]) && /UA 991/.test(await txt()) && /AA 1351/.test(await txt()), `departures: ${dep}`);
      await page.click('[data-ar-dir="arr"]');
      // list + CSV
      await page.click('[data-ar-view="list"]'); ok((await page.$$('.ar-tr:not(.ar-th)')).length === 5, 'list: one row per household / sharer (decliner left out)');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1280-arrivals-list.png`, fullPage: true });
      await page.evaluate(() => { window.__csv = null; const o = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then(t => { window.__csv = t; }); return o(b); }; HTMLAnchorElement.prototype.click = function () {}; });
      await page.click('[data-ar-csv]'); await page.waitForTimeout(300); const csv = await page.evaluate(() => window.__csv || '');
      ok(/^﻿?Household,Guests,Arriving date,Arriving time,Arriving at/.test(csv) && /The Garcias,2,2027-03-12,11:45,CUN,AA 1350,2027-03-15,18:20,cun,AA 1351,Hotel Esencia,RSVP/.test(csv) && /The Kims,2,2027-03-11,14:05,TQO,UA 990,2027-03-15,15:30,TQO,UA 991,Azulik,Shared trip/.test(csv), 'CSV: one line per household with both legs + source\n' + csv.split('\r\n').slice(0, 4).join('\n'));
      // edit dialog (planner)
      await page.click('[data-ar-view="time"]'); await page.evaluate(() => window.__ep.ar.arEditDlg('h5')); await page.waitForTimeout(200);
      ok(await page.$$eval('#gldlg [data-are]', xs => xs.length) === 9, 'edit dialog has the 9 travel fields');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1280-arrivals-edit.png` });
      // arFromTrips edge: nothing near the dates → nothing
      const far = await page.evaluate(() => window.__ep.ar.arFromTrips([{ kind: 'flight', flight: 'UA 1', start: '2026-01-01T10:00', to: 'JFK' }], window.__ep.lists.G().cfg));
      ok(!far.arr && !far.dep, 'a booking far from the event dates is not an arrival');
    } else {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/390-arrivals-timeline.png`, fullPage: true });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(ov <= 1, `390: no sideways scroll (${ov})`);
      await page.click('[data-ar-view="list"]'); if (SHOTS) await page.screenshot({ path: `${SHOTS}/390-arrivals-list.png`, fullPage: true });
    }
    ok(!errs.length, `${w}: no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
