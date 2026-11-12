// "Flying into" airport pick: default order, one rental airport, and switching re-points the travel links.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/airport.js
//   SHOTS=/tmp/ep-shots node tests/airport.js     # also saves screenshots
//
// Needs Playwright. Exit code 1 on any failure.
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  // the example's sample bookings would fold the rental part; this test starts from an empty My trip
  await page.addInitScript(() => { let v; Object.defineProperty(window, 'EXAMPLES', { configurable: true, get: () => v, set: (x) => { Object.values(x).forEach(e => { delete e.demoTrip; }); v = x; } }); });
  await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.AIRPORTS);

  // pure default logic
  const r = await page.evaluate(() => {
    const { pickAirport } = window.__ep;
    const air = [{ iata: 'RGN', large: false, name: 'Regional Field', city: 'Smallville' }, { iata: 'TQO', large: true, name: 'Tulum Intl', city: 'Tulum' }, { iata: 'CZM', large: true, name: 'Cozumel International Airport', city: 'Cozumel' }, { iata: 'CUN', large: true, name: 'Cancún International Airport', city: 'Cancún' }];
    const fl = (o) => ({ kind: 'flight', start: '2026-12-01T10:00', ...o });
    return {
      none: pickAirport([], 'CUN', []),
      firstLarge: pickAirport(air, null, []).iata,
      saved: pickAirport(air, 'CUN', [fl({ note: 'JFK → CZM' })]).iata,
      savedUnknown: pickAirport(air, 'LAX', []).iata,
      itinArrow: pickAirport(air, null, [fl({ note: 'JFK → CUN', name: 'Delta 123' })]).iata,
      itinReturnIgnored: pickAirport(air, null, [fl({ start: '2026-12-01', note: 'JFK → CZM' }), fl({ start: '2026-12-05', note: 'CUN → JFK' })]).iata,
      itinName: pickAirport(air, null, [fl({ name: 'Flight to CUN' })]).iata,
      itinNoMatch: pickAirport(air, null, [fl({ note: 'JFK → LAX' }), { kind: 'hotel', name: 'Hotel CUN' }]).iata,
    };
  });
  ok(r.none === null, 'no airports → null');
  ok(r.firstLarge === 'TQO', `default = first large airport (${r.firstLarge})`);
  ok(r.saved === 'CUN', `saved pick wins over itinerary (${r.saved})`);
  ok(r.savedUnknown === 'TQO', `saved pick not nearby → default (${r.savedUnknown})`);
  ok(r.itinArrow === 'CUN', `itinerary flight arrival (${r.itinArrow})`);
  ok(r.itinReturnIgnored === 'CZM', `return flight's origin ignored (${r.itinReturnIgnored})`);
  ok(r.itinName === 'CUN', `itinerary flight named for the airport (${r.itinName})`);
  ok(r.itinNoMatch === 'TQO', `non-matching flight / hotel ignored (${r.itinNoMatch})`);

  // the Tulum demo: TQO, CZM, CUN nearby
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '?demo=wedding#t=travel'); await page.waitForSelector('[data-slot="rental"] a'); await page.waitForTimeout(800);
  const kayak = () => page.$$eval('[data-slot="rental"] a[href*="kayak.com/cars"]', as => as.map(a => a.href.match(/cars\/(\w+)\//)[1]));
  const state = () => page.evaluate(() => ({ chip: [...document.querySelectorAll('.ap-pick.on')].map(b => b.dataset.ap), sel: [...document.querySelectorAll('[data-ap-sel]')].map(s => s.value),
    stub: (document.querySelector('.stub-side .code') || {}).textContent, near: [...document.querySelectorAll('[data-slot="stay-links"] a')].some(a => /Hotels near/.test(a.textContent)),
    transfer: (document.querySelector('.ap-transfer a') || {}).href || '' }));
  let k = await kayak(); let s = await state();
  ok(k.length === 1 && k[0] === 'TQO', `rental shows one Kayak link, for TQO (${k})`);
  ok(s.chip.join() === 'TQO' && s.sel.every(x => x === 'TQO'), `TQO chosen in flights + rental picker (${JSON.stringify(s)})`);
  ok(!s.near, 'no "Hotels near" link for a 24 km airport');
  if (SHOTS) { await page.locator('[data-slot="flights"]').screenshot({ path: `${SHOTS}/flights-default.png` }); await page.locator('[data-slot="rental"]').screenshot({ path: `${SHOTS}/rental-default.png` }); }

  await page.click('[data-ap="CUN"]'); await page.waitForTimeout(300);
  k = await kayak(); s = await state();
  ok(k.length === 1 && k[0] === 'CUN', `after tapping CUN: Kayak link is CUN (${k})`);
  ok(s.chip.join() === 'CUN' && s.sel.every(x => x === 'CUN') && s.stub === 'CUN', `CUN synced to flights, rental picker, ticket (${JSON.stringify(s)})`);
  ok(s.near, '"Hotels near" Cancún link shown (110 km)');
  ok(/origin=21\.0/.test(s.transfer), 'transfer directions start at CUN');
  if (SHOTS) { await page.locator('[data-slot="flights"]').screenshot({ path: `${SHOTS}/flights-cun.png` }); await page.locator('[data-slot="rental"]').screenshot({ path: `${SHOTS}/rental-cun.png` }); await page.locator('#sec-stay').screenshot({ path: `${SHOTS}/stay-cun.png` }).catch(() => {}); }

  // rental picker → CZM
  await page.selectOption('[data-slot="rental"] [data-ap-sel]', 'CZM'); await page.waitForTimeout(300);
  k = await kayak(); s = await state();
  ok(k.join() === 'CZM' && s.chip.join() === 'CZM', `rental picker → CZM moves Kayak + flights chip (${k}, ${s.chip})`);

  // persists across reload, and shows in My trip
  await page.reload(); await page.waitForSelector('[data-slot="rental"] a'); await page.waitForTimeout(500);
  ok((await kayak()).join() === 'CZM', 'pick persists after reload');
  const mine = await page.$eval('[data-slot="ap-mine"] select', s => s.value).catch(() => null);
  ok(mine === 'CZM', `My trip shows Flying into CZM (${mine})`);

  // edit in My trip → travel sections follow
  await page.evaluate(() => { const s = document.querySelector('[data-slot="ap-mine"] select'); s.value = 'CUN'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(300);
  ok((await kayak()).join() === 'CUN', 'changing it in My trip re-points rentals');

  // Add to my trip from the rental section → prefilled card in My trip; save; edit; delete
  await page.click('[data-slot="rental"] [data-addtrip]'); await page.waitForTimeout(400);
  const form = await page.evaluate(() => { const g = (k) => (document.querySelector('#it-' + k) || {}).value; return { tab: !document.querySelector('[data-panel="mytrip"]').hidden, kind: g('kind'), name: g('name'), address: g('address'), start: g('start'), end: g('end') }; });
  ok(form.tab && form.kind === 'car' && /CUN/.test(form.name) && /Canc/.test(form.address) && /^\d{4}-\d\d-\d\d$/.test(form.start) && /^\d{4}-\d\d-\d\d$/.test(form.end), `prefilled rental card ${JSON.stringify(form)}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/mytrip-add-card.png` });
  await page.fill('#it-confNo', 'ABC123'); await page.click('[data-itin-save]'); await page.waitForTimeout(300);
  const saved = await page.$$eval('#sec-itinerary .bookings li', ls => ls.map(l => l.textContent));
  ok(saved.length === 1 && /ABC123/.test(saved[0]), `saved booking: ${saved}`);
  if (SHOTS) await page.locator('#sec-itinerary').screenshot({ path: `${SHOTS}/mytrip-saved.png` });
  await page.click('[data-itin-edit="0"]'); await page.click('[data-itin-del="0"]'); await page.waitForTimeout(300);
  ok((await page.$$('#sec-itinerary .bookings li')).length === 0, 'edit → remove deletes it');

  // a flight added from the flights list sets the pick
  await page.click('[data-tab-go="travel"]'); await page.click('[data-addtrip="flight"][data-iata="TQO"]'); await page.waitForTimeout(300);
  ok((await page.$eval('#it-kind', s => s.value)) === 'flight', 'flight card prefilled');
  ok((await kayak()).join() === 'TQO', 'adding a TQO flight sets Flying into TQO');

  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
