// Per-guest fields (Guest list → Fields), offline from made-up data: the grid (sticky guest column, Table from seating),
// inline edit, number check, add a field (choice, guest-visible), bulk set, CSV out, CSV import (match by name, new
// columns → fields, bad choice skipped, unknown names reported), and the household's "Your details". Writes are answered
// by the test (a number field refuses text like the server does).   BASE=… SHOTS=<dir> node tests/fields.js
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
  X.setG({ eid: 'e0', ev: { id: 'e0', slug: 'cov-page', published: true }, cfg, filter: 'all', grp: '', by: false, sel: new Set(), tab: 'fld', hs, ps, rs, gs: [], hot: new Map(), opens: 0,
    st: { pend: false, grp: '', q: '', hh: false, fold: false, view: 'cards' }, tr, trips, ivOff: true, stOff: false, ts: [{ id: 't1', name: 'Rose', shape: 'round', capacity: 8, head: false, sort: 0 }], seat: { show: true }, fd: [{ id: 'f1', label: 'Bib', kind: 'number', choices: [], visible: 'guest', sort: 0, created_at: '2026-01-01' }, { id: 'f2', label: 'Wave', kind: 'choice', choices: ['A', 'B', 'C'], visible: 'guest', sort: 1, created_at: '2026-01-02' }], fv: [{ field_id: 'f1', person_id: 'p1', value: '214' }], sr: [{ id: 'r1', event_id: 'e0', name: null, from_place: 'CUN', to_place: 'Hacienda', depart_date: '2027-03-12', depart_time: '12:15', capacity: 2, vehicle: 'Van', meet: 'Arrivals hall, exit 3', notes: 'Look for the 1LinkTrip sign', sort: 0 }], srr: [{ run_id: 'r1', person_id: 'p3' }] });
  X.glMount();
})()`;
(async () => {
  const browser = await chromium.launch();
  for (const w of [1280, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, deviceScaleFactor: 2, isMobile: w < 600, hasTouch: w < 600, serviceWorkers: 'block', locale: 'en-US' });
    await ctx.route(/googleapis|gstatic|overpass|nominatim|open-meteo|tile\.openstreetmap|timeapi|photon/, r => r.abort());
    const writes = []; await ctx.route(/supabase\.co\/rest\/v1\//, r => { const q = r.request(); const body = q.postData() || ''; if (q.method() !== 'GET') writes.push(q.method() + ' ' + new URL(q.url()).pathname.split('/').pop() + ' ' + body);
      if (/guest_field_values/.test(q.url()) && /"field_id":"f1"[^}]*"value":"[^"0-9-]/.test(body)) return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'Bib takes a number' }) });
      return r.fulfill({ status: q.method() === 'POST' ? 201 : q.method() === 'GET' ? 200 : 204, contentType: 'application/json', body: q.method() === 'GET' ? '[]' : '' }); });
    await ctx.route(/supabase\.co\/auth/, r => r.abort());
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(BASE + '#edit-ex=tulum-wedding'); await page.waitForTimeout(1500); await page.evaluate(SETUP); await page.waitForTimeout(300);
    if (w === 1280) {
      const hd = await page.$$eval('.fd-grid thead th', xs => xs.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
      ok(/Table SHOWN TO GUESTS/i.test(hd[2]) && /Bib/.test(hd[3]) && /Wave/.test(hd[4]), 'columns: guest, Table (from seating), Bib, Wave: ' + hd.join(' | '));
      ok(await page.$eval('[data-fd-cell="f1|p1"]', i => i.value) === '214', 'existing value shown');
      ok((await page.$$eval('.fd-grid tr.fd-hh', xs => xs.length)) === 5, 'rows grouped by household');
      await page.fill('[data-fd-cell="f1|p2"]', '215'); await page.press('[data-fd-cell="f1|p2"]', 'Tab'); await page.waitForTimeout(400);
      ok(writes.some(x => /POST guest_field_values.*"person_id":"p2","value":"215"/.test(x)), 'inline edit saves (upsert)');
      await page.fill('[data-fd-cell="f1|p3"]', 'abc'); await page.press('[data-fd-cell="f1|p3"]', 'Tab'); await page.waitForTimeout(500);
      ok(await page.$eval('[data-fd-cell="f1|p3"]', i => i.value === '' && i.classList.contains('bad')), 'a number field refuses text (value put back, marked)');
      await page.selectOption('[data-fd-cell="f2|p1"]', 'B'); await page.waitForTimeout(300); ok(writes.some(x => /"field_id":"f2","person_id":"p1","value":"B"/.test(x)), 'choice cell saves');
      await page.selectOption('[data-fd-table="p3"]', 't1'); await page.waitForTimeout(300); ok(writes.some(x => /PATCH guest_people .*"table_id":"t1"/.test(x)), 'Table column seats the guest (seating chart)');
      // add a field
      await page.click('[data-fd-new]'); await page.fill('#gldlg [data-fde="label"]', 'Badge'); await page.click('#gldlg [data-fde-kind="choice"]'); await page.fill('#gldlg [data-fde="choices"]', 'Speaker\nSponsor\nAttendee'); await page.click('#gldlg [data-fde-vis="planners"]');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1280-field-editor.png` });
      await page.click('#gldlg [data-fde-ok]'); await page.waitForTimeout(400);
      ok(writes.some(x => /POST guest_fields .*"label":"Badge","kind":"choice","choices":\["Speaker","Sponsor","Attendee"\],"visible":"planners"/.test(x)), 'new choice field saved (organizers only)');
      ok((await page.$$eval('.fd-grid thead th', xs => xs.length)) === 6, 'Badge column added');
      // bulk
      await page.check('[data-fd-sel="p4"]'); await page.check('[data-fd-sel="p5"]'); await page.waitForTimeout(200);
      await page.selectOption('[data-fd-bf]', 'f2'); await page.waitForTimeout(200); await page.selectOption('[data-fd-bv]', 'C'); await page.click('[data-fd-bset]'); await page.waitForTimeout(400);
      ok(writes.some(x => /POST guest_field_values .*"person_id":"p4","value":"C".*"person_id":"p5","value":"C"/.test(x)) && await page.$eval('[data-fd-cell="f2|p5"]', s => s.value) === 'C', 'bulk set Wave C for 2 guests');
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/1280-fields.png`, fullPage: true });
      // CSV out
      await page.evaluate(() => { window.__csv = null; const o = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then(t => { window.__csv = t; }); return o(b); }; HTMLAnchorElement.prototype.click = function () {}; });
      await page.click('[data-fd-csv]'); await page.waitForTimeout(300); const csv = await page.evaluate(() => window.__csv || '');
      ok(/^\uFEFF?Household,Name,Table,Bib,Wave,Badge/.test(csv) && /The Garcias,Ana Garcia,,214,B,/.test(csv) && /The Kims,Jae Kim,,,C,/.test(csv), 'CSV out\n' + csv.split('\r\n').slice(0, 3).join('\n'));
      // CSV import
      const r = await page.evaluate(() => window.__ep.fd.fdImport('Name,Household,Bib,Wave,T-shirt\nBen Okafor,Ben Okafor,301,A,L\nMin Kim,,302,Z,M\nNobody Here,,1,A,S'));
      ok(r.n === 2 && r.missing.join() === 'Nobody Here' && r.made.join() === 'T-shirt' && r.bad.join() === 'Wave: Z', 'import: 2 matched, unknown name reported, new T-shirt field, bad choice skipped: ' + JSON.stringify(r));
      ok(writes.some(x => /"person_id":"p3","value":"301"/.test(x)) && writes.some(x => /"person_id":"p5","value":"302"/.test(x)) && !writes.some(x => /"value":"Z"/.test(x)), 'import wrote Bib 301/302 and no Z');
      await page.evaluate(() => window.__ep.fd.fdImportDlg()); await page.waitForTimeout(200); if (SHOTS) await page.screenshot({ path: `${SHOTS}/1280-fields-import.png` }); await page.evaluate(() => document.querySelector('#gldlg').close());
      const parsed = await page.evaluate(() => window.__ep.fd.fdParseCSV('Name;Note\n"Smith; Ann";"said ""hi"""\n'));
      ok(JSON.stringify(parsed) === JSON.stringify([['Name', 'Note'], ['Smith; Ann', 'said "hi"']]), 'CSV parser: semicolons, quotes');
      const card = await page.evaluate(() => window.__ep.fd.hhFieldsHTML({ people: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Luis' }], fields: [{ label: 'Bib', values: [{ person_id: 'a', value: '214' }, { person_id: 'b', value: '215' }] }, { label: 'Wave', values: [{ person_id: 'a', value: 'B' }] }] }));
      ok(/Your details/.test(card) && /Ana/.test(card) && /214/.test(card) && /Luis/.test(card) && /215/.test(card) && /Wave/.test(card), 'household card: Your details per person');
    } else {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/390-fields.png`, fullPage: true });
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(ov <= 1, `390: no sideways page scroll; the grid scrolls inside (${ov})`);
    }
    ok(!errs.length, `${w}: no page errors ${errs.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
