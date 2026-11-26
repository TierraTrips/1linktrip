// Shuttle runs (Guest list → Shuttles), offline from made-up data: suggestions from the arrivals board (same airport + day,
// within the window), creating a run from one, adding riders (Add to… + drag), seat warning, delete rider, manifest
// (print sheet) + CSV per run, the household's "Your shuttle" card. Supabase writes are answered by the test.
//   BASE=http://127.0.0.1:18791/ SHOTS=<dir> node tests/shuttles.js
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
  X.setG({ eid: 'e0', ev: { id: 'e0', slug: 'cov-page', published: true }, cfg, filter: 'all', grp: '', by: false, sel: new Set(), tab: 'shut', hs, ps, rs, gs: [], hot: new Map(), opens: 0, ts: [], seat: { show: false },
    st: { pend: false, grp: '', q: '', hh: false, fold: false, view: 'cards' }, tr, trips, ivOff: true, stOff: true, sr: [{ id: 'r1', event_id: 'e0', name: null, from_place: 'CUN', to_place: 'Hacienda', depart_date: '2027-03-12', depart_time: '12:15', capacity: 2, vehicle: 'Van', meet: 'Arrivals hall, exit 3', notes: 'Look for the 1LinkTrip sign', sort: 0 }], srr: [{ run_id: 'r1', person_id: 'p3' }] });
  X.glMount();
})()`;
(async () => {
  const browser = await chromium.launch();
  for (const w of [1280, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, deviceScaleFactor: 2, isMobile: w < 600, hasTouch: w < 600, serviceWorkers: 'block', locale: 'en-US' });
    await ctx.route(/googleapis|gstatic|overpass|nominatim|open-meteo|tile\.openstreetmap|timeapi|photon/, r => r.abort());
    const writes = []; await ctx.route(/supabase\.co\/rest\/v1\//, r => { const q = r.request(); if (q.method() !== 'GET') writes.push(q.method() + ' ' + new URL(q.url()).pathname.split('/').pop() + ' ' + (q.postData() || '')); return r.fulfill({ status: q.method() === 'POST' ? 201 : q.method() === 'GET' ? 200 : 204, contentType: 'application/json', body: q.method() === 'GET' ? '[]' : '' }); });
    await ctx.route(/supabase\.co\/auth/, r => r.abort());
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '#edit-ex=tulum-wedding'); await page.waitForTimeout(1500); await page.evaluate(SETUP); await page.waitForTimeout(300);
    if (w === 1280) {
      ok(await page.$eval('[data-gl-tab="shut"]', b => b.getAttribute('aria-selected') === 'true'), 'Shuttles tab');
      const run = await page.$eval('.sh-run', e => e.innerText.replace(/\s+/g, ' ')); ok(/12:15 PM/.test(run) && /CUN → Hacienda/.test(run) && /1 of 2 seats/.test(run) && /Ben Okafor/.test(run) && /Meet: Arrivals hall, exit 3/.test(run), 'run card: time, route, seats, rider, meeting point: ' + run);
      const sug = await page.$$eval('.sh-sl li', xs => xs.map(x => x.innerText.replace(/\s+/g, ' ')));
      ok(sug.length === 2 && /TQO/.test(sug[0]) && /The Kims/.test(sug[0]) && /CUN/.test(sug[1]) && /The Garcias/.test(sug[1]) && !/Ben/.test(sug.join()), 'suggestions: TQO (Kims) and CUN (Garcias; Ben is already on a run): ' + sug.join(' || '));
      ok(/Run at 2:45 PM/.test(sug[0]) && /Run at 12:15 PM/.test(sug[1]), 'leaves 30 min after the last arrival, rounded up to 15 (14:05 → 2:45 PM; 11:45 → 12:15 PM)');
      const wait = await page.$$eval('.sh-wait li b', xs => xs.map(x => x.textContent)); ok(wait.join() === 'The Kims,The Garcias,Priya Shah', 'Not on a run: ' + wait);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1280-shuttles-before.png`, fullPage: true });
      // window 30 min: Ben's 11:10 vs Garcias 11:45 would split, but Ben is on a run → still 2
      await page.click('[data-sh-make="1"]'); await page.waitForTimeout(600);
      const runs = await page.$$eval('.sh-run', xs => xs.map(x => x.innerText.replace(/\s+/g, ' ')));
      ok(runs.length === 2 && runs.some(r => /12:15 PM/.test(r) && /Ana Garcia/.test(r) && /Luis Garcia/.test(r) && /2 of 4 seats/.test(r)), 'a suggestion becomes a run with the Garcias: ' + runs.join(' || '));
      ok(writes.some(x => /^POST shuttle_runs .*"from_place":"CUN"/.test(x)) && writes.some(x => /^POST shuttle_riders/.test(x)), 'run + riders written');
      // Add to… → over capacity on r1 (2 seats: Ben + 2 Kims = 3)
      await page.selectOption('.sh-wait li:has-text("The Kims") select', 'r1'); await page.waitForTimeout(500);
      const r1 = await page.$eval('[data-sh-drop="r1"]', e => e.innerText.replace(/\s+/g, ' ')); ok(/3 of 2 seats/.test(r1) && /1 over capacity/.test(r1) && await page.$eval('[data-sh-drop="r1"]', e => e.classList.contains('over')), 'over capacity warning: ' + r1);
      ok(/1 run is over capacity/.test(await page.textContent('.sh .ar-bar')), 'warning in the bar');
      // drag Priya onto r1
      const dt = await page.evaluateHandle(() => new DataTransfer());
      await page.dispatchEvent('.sh-wait li:has-text("Priya Shah")', 'dragstart', { dataTransfer: dt }); await page.dispatchEvent('[data-sh-drop="r1"]', 'dragover', { dataTransfer: dt }); await page.dispatchEvent('[data-sh-drop="r1"]', 'drop', { dataTransfer: dt }); await page.waitForTimeout(500);
      ok(/Priya Shah/.test(await page.$eval('[data-sh-drop="r1"]', e => e.innerText)), 'drag a household onto a run');
      await page.click('[data-sh-drop="r1"] [data-sh-rm$="|p7"]'); await page.waitForTimeout(400); ok(!/Priya Shah/.test(await page.$eval('[data-sh-drop="r1"]', e => e.innerText)) && writes.some(x => /^DELETE shuttle_riders/.test(x)), 'take a rider off');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1280-shuttles.png`, fullPage: true });
      // manifest
      const man = await page.evaluate(() => window.__ep.sh.shManifestHTML('r1'));
      ok(/Passenger manifest/.test(man) && /CUN → Hacienda/.test(man) && /Ben Okafor/.test(man) && /Jae Kim/.test(man) && /TRAIN 7|11:10/.test(man), 'manifest lists riders with their arrival');
      await page.evaluate(() => { window.print = () => {}; window.__ep.sh.shPrint('r1'); }); await page.waitForTimeout(200); await page.emulateMedia({ media: 'print' });
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1280-manifest-print.png`, fullPage: true });
      ok(await page.$eval('#st-print', e => getComputedStyle(e).display !== 'none' && e.querySelectorAll('tbody tr').length === 3), 'print sheet shows the manifest (3 riders)');
      await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => document.body.classList.remove('st-printing'));
      await page.evaluate(() => { window.__csv = null; const o = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then(t => { window.__csv = t; }); return o(b); }; HTMLAnchorElement.prototype.click = function () {}; });
      await page.click('[data-sh-csv="r1"]'); await page.waitForTimeout(300); const csv = await page.evaluate(() => window.__csv || '');
      ok(/Run,Leaves,Name,Household,Arriving/.test(csv) && /CUN → Hacienda,2027-03-12 12:15,Ben Okafor,Ben Okafor,2027-03-12 11:10 Cancun CUN,TRAIN 7/.test(csv), 'CSV manifest\n' + csv.split('\r\n').slice(0, 3).join('\n'));
      // edit dialog
      await page.click('[data-sh-edit="r1"]'); ok(await page.$$eval('#gldlg [data-she]', xs => xs.length) === 9, 'edit dialog'); if (SHOTS) await page.screenshot({ path: `${SHOTS}/1280-shuttle-edit.png` });
      // household card
      const card = await page.evaluate(() => window.__ep.sh.hhShuttleHTML({ people: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Luis' }], shuttles: [{ id: 'x', from: 'LIS', to: 'Quinta da Regaleira', date: '2027-06-11', time: '15:15', meet: 'Arrivals hall, exit 3', vehicle: 'Van', people: ['a', 'b'] }, { id: 'y', from: 'Quinta', to: 'LIS', date: '2027-06-14', time: '09:00', people: ['a'] }] }));
      ok(/Your shuttles/.test(card) && /3:15 PM/.test(card) && /from LIS to Quinta da Regaleira/.test(card) && /Meet: Arrivals hall, exit 3/.test(card) && />Ana</.test(card), 'household card: Your shuttles, time, route, meet, who (when not everyone)');
    } else {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/390-shuttles.png`, fullPage: true });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(ov <= 1, `390: no sideways scroll (${ov})`);
    }
    ok(!errs.length, `${w}: no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
