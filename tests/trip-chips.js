// My trip's category chips (Dylan 11/25): "hotels should be the first thing, then transportation, then restaurants. It
// should default to hotels ... allow ... multiple options selected. So you can easily see flights, trains, hotels all
// together." And transport subtypes: "Flight has a picture of a train ... different icons for cars, trains, bus, taxi,
// flights ... listed under transportation, but need sub categories."
//  - chips: All, Hotels, Transport, Restaurants, then the rest; Hotels pressed until the guest chooses; multi-select (the
//    union, still by date); the choice kept on this device; chip numbers = rows listed (11/24 rule).
//  - every transport item has a subtype (booking Type, else read from its words) and that subtype's icon in My trip,
//    the booking / place / Event-row sheets; the booking form's Type has Bus / Taxi or rideshare / Ferry.
//  - Transport selected + more than one subtype present → small subtype chips (multi-select) under the categories.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/trip-chips.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return false; for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.')).slice(0, 5); });
const CFG = { v: 2, type: 'Trip', title: 'Chips test', start: '2027-04-01', end: '2027-04-10', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo Station', address: 'Marunouchi, Tokyo', lat: 35.6812, lon: 139.7671, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  schedule: [{ date: '2027-04-10', time: '22:45', title: 'Depart Tokyo Haneda (HND) on UA 7924 (operated by All Nippon Airways)', note: '' }],
  tools: { weather: false, travel: true, stay: true, nearby: false, tours: false, mytrip: true, packing: false, shopping: false } };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
const K = keyOf(CFG);
const BK = [
  { id: 'f1', kind: 'flight', name: 'United', flight: 'UA 7924', start: '2027-04-01T08:00', end: '2027-04-01T12:00' },
  { id: 'h1', kind: 'hotel', name: 'Park Hyatt Tokyo', start: '2027-04-01T15:00', end: '2027-04-05T11:00' },
  { id: 't1', kind: 'train', name: 'Nozomi 21 to Kyoto', start: '2027-04-05T09:00' },
  { id: 'o1', kind: 'other', name: 'Airport limousine bus', start: '2027-04-01T13:00' },
  { id: 'h2', kind: 'hotel', name: 'Ace Hotel Kyoto', start: '2027-04-05T15:00', end: '2027-04-10T11:00' },
  { id: 'r1', kind: 'food', name: 'Sushi Saito', start: '2027-04-03T19:00' }];

async function setup(browser, ls) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route(/googleapis|gstatic|overpass|nominatim|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|photon|functions\/v1|auth\/v1|rest\/v1/, r => r.abort());
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.AIRPORTS);
  await page.evaluate((ls) => { localStorage.clear(); Object.entries(ls).forEach(([k, v]) => localStorage.setItem('ep:' + k, JSON.stringify(v))); }, ls);
  const packed = await page.evaluate((c) => window.__ep.packEvent(window.__ep.normalize(JSON.parse(JSON.stringify(c)))), CFG);
  page._url = BASE + '#e=' + packed + '&t=mytrip';
  await open(page); return { ctx, page };
}
async function open(page) { await page.goto(page._url); await page.reload(); await page.waitForSelector('[data-ccb="trip"]'); await page.waitForTimeout(400); }
const T = '[data-ccb="trip"]';
// which glyph an icon shows: its first shape's attributes, as written in the glyph
const ICON_OF = `(svg, ks) => { const f = svg.firstElementChild; const a = [...f.attributes].map(x => x.name + '="' + x.value + '"').join(' '); const sh = '<' + f.tagName.toLowerCase() + ' ' + a; return ks.find(k => window.__ep.ccIcon(k).includes(sh)) || ''; }`;
const chips = (page, key = 'cat') => page.$$eval(`${T} [data-dd="${key}"] .cc-chip`, cs => cs.map(c => ({ v: c.dataset.ddV, on: c.getAttribute('aria-pressed') === 'true', n: +((c.querySelector('small') || {}).textContent || 0) })));
const rows = (page) => page.$$eval('#sec-itinerary ul.bookings > li:not([hidden])', ls => ls.map(l => l.querySelector('.plan-t span').textContent));
const tap = async (page, key, v) => { await page.click(`${T} [data-dd="${key}"] [data-dd-v="${v}"]`); await page.waitForTimeout(250); };

(async () => {
  const browser = await chromium.launch();
  try {
    // ---- inference (pure) ----
    {
      const { ctx, page } = await setup(browser, {});
      const r = await page.evaluate(() => { const S = window.__ep.tSubOfText, X = window.__ep.tSub; return {
        ua: S('Depart Tokyo Haneda (HND) on UA 7924 (operated by All Nippon Airways)'), land: S('Land at Haneda Airport'), fno: X({ kind: 'other', name: 'UA 7924' }),
        shinkansen: S('Shinkansen Tokyo to Kanazawa'), jr: S('JR Pass exchange'), nex: S('Narita Express to Shinjuku'), bus: S('Willer night bus to Osaka'), limo: S('Airport limousine bus'),
        car: S('Toyota Rent a Car pick-up'), hertz: S('Hertz at LAX'), taxi: S('Uber to the hotel'), cab: S('Taxi to Haneda Airport'), ferry: S('Ferry to Miyajima'), wtaxi: S('Water taxi to Burano'),
        chipsEmpty: document.querySelectorAll('[data-ccb="trip"] [data-dd="cat"]').length,
        none: S('Dinner at Sushi Saito'), metroMuseum: S('Metropolitan Museum'),
        kinds: ['flight', 'train', 'bus', 'car', 'taxi', 'ferry'].map(k => X({ kind: k, name: 'x' })).join(), explicit: X({ kind: 'other', tsub: 'ferry', name: 'Thing' }), other: X({ kind: 'other', name: 'Transfer' }) }; });
      ok(r.chipsEmpty === 0, `an empty My trip has no category chips (not a lone "All 0")`);
      ok(r.ua === 'flight' && r.land === 'flight' && r.fno === 'flight', `flight: UA 7924 line / Land at Haneda / a bare flight number ${JSON.stringify([r.ua, r.land, r.fno])}`);
      ok(r.shinkansen === 'train' && r.jr === 'train' && r.nex === 'train', `train: Shinkansen / JR / Narita Express`);
      ok(r.bus === 'bus' && r.limo === 'bus', `bus: night bus / airport limousine bus (not a flight)`);
      ok(r.car === 'car' && r.hertz === 'car', `car: Toyota Rent a Car / Hertz`);
      ok(r.taxi === 'taxi' && r.cab === 'taxi', `taxi: Uber / taxi to the airport (not a flight) ${r.cab}`);
      ok(r.ferry === 'ferry' && r.wtaxi === 'ferry', `ferry: ferry / water taxi`);
      ok(r.none === '' && r.metroMuseum === '' && r.other === 'other', `not transport: dinner, Metropolitan Museum; a plain Transfer = other`);
      ok(r.kinds === 'flight,train,bus,car,taxi,ferry' && r.explicit === 'ferry', `the booking Type wins (${r.kinds}); a stored subtype too`);
      await ctx.close();
    }
    // ---- chips: order, Hotels by default, multi-select union by date, kept; numbers = rows ----
    {
      const { ctx, page } = await setup(browser, { ['itin:' + K]: BK });
      let c = await chips(page);
      ok(c.map(x => x.v).join() === 'all,hotels,transport,restaurants,activities', `order: All, Hotels, Transport, Restaurants, Activities (${c.map(x => x.v)})`);
      ok(c.filter(x => x.on).map(x => x.v).join() === 'hotels', `Hotels pressed by default`);
      ok((await rows(page)).join() === 'Park Hyatt Tokyo,Ace Hotel Kyoto', `lists the hotels only: ${await rows(page)}`);
      ok(c.find(x => x.v === 'hotels').n === 2 && c.find(x => x.v === 'transport').n === 3 && c.find(x => x.v === 'all').n === 6, `numbers: ${JSON.stringify(c)}`);
      await tap(page, 'cat', 'transport'); c = await chips(page);
      ok(c.filter(x => x.on).map(x => x.v).join() === 'hotels,transport', `Transport adds to Hotels`);
      const u = await rows(page);
      ok(u.join() === 'United,Airport limousine bus,Park Hyatt Tokyo,Nozomi 21 to Kyoto,Ace Hotel Kyoto', `union, by date: ${u}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/trip-chips-union.png`, fullPage: false });
      await open(page); c = await chips(page);
      ok(c.filter(x => x.on).map(x => x.v).join() === 'hotels,transport', `kept after reload`);
      // icons: each transport row its own subtype icon
      const icons = await page.evaluate((F) => { const of = eval(F); const by = {}; document.querySelectorAll('#sec-itinerary ul.bookings > li:not([hidden])').forEach(l => { const s = l.querySelector('.cci svg'); by[l.querySelector('.plan-t span').textContent] = s ? of(s, ['flight', 'train', 'bus', 'car', 'taxi', 'ferry', 'transport', 'hotels']) : ''; }); return by; }, ICON_OF);
      ok(icons['United'] === 'flight' && icons['Nozomi 21 to Kyoto'] === 'train' && icons['Airport limousine bus'] === 'bus' && icons['Park Hyatt Tokyo'] === 'hotels', `row icons: ${JSON.stringify(icons)}`);
      // the subtype chips: Transport with flight + train + bus
      let s = await chips(page, 'tsub');
      ok(s.map(x => x.v).join() === 'flight,train,bus' && s.every(x => !x.on) && s.map(x => x.n).join() === '1,1,1', `subtype chips under Transport: ${JSON.stringify(s)}`);
      await tap(page, 'tsub', 'flight'); await tap(page, 'tsub', 'train');
      ok((await rows(page)).join() === 'United,Park Hyatt Tokyo,Nozomi 21 to Kyoto,Ace Hotel Kyoto', `Flights + Trains + Hotels together: ${await rows(page)}`);
      c = await chips(page); ok(c.find(x => x.v === 'transport').n === 2, `Transport's number follows its subtypes (${c.find(x => x.v === 'transport').n})`);
      const sz = await page.$$eval(`${T} [data-dd="tsub"] .cc-chip`, bs => bs.map(b => b.getBoundingClientRect().height)); ok(sz.every(h => h >= 34), `subtype chips tappable (${sz})`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/trip-chips-subs.png`, fullPage: false });
      const of = await overflow(page); ok(!of.length, `@390 no overflow ${of}`);
      await tap(page, 'cat', 'transport'); ok(!(await page.$(`${T} [data-dd="tsub"]`)) && (await rows(page)).join() === 'Park Hyatt Tokyo,Ace Hotel Kyoto', `Transport off: subtype chips gone, hotels only`);
      await tap(page, 'cat', 'transport'); s = await chips(page, 'tsub'); ok(s.every(x => !x.on), `Transport back on: all its subtypes (filter reset)`);
      await tap(page, 'cat', 'all'); c = await chips(page); ok(c.filter(x => x.on).map(x => x.v).join() === 'all' && (await rows(page)).length === 6, `All: everything`);
      // the booking form's Type lists the new subtypes
      const opts = await page.evaluate(() => { document.querySelector('[data-itin-add]').click(); return new Promise(r => setTimeout(() => { const m = document.querySelector('[data-itin-mode="manual"]'); if (m) m.click(); setTimeout(() => r([...document.querySelectorAll('#sec-itinerary [data-it="kind"] option')].map(o => o.value)), 200); }, 200)); });
      ok(['bus', 'taxi', 'ferry'].every(k => opts.includes(k)), `booking Type picker: ${opts}`);
      ok(!page._err.length, `no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
    // ---- Activities (Dylan 11/25): one chip after Restaurants for sights + things to do (saved spots + Tour bookings);
    //      multi-select with the others; its number = the rows it lists; an old "sights"/"tours" choice reads as Activities ----
    {
      const PL = [{ id: 'p1', src: 'g', ref: 'g1', name: 'Senso-ji', type: 'activity', cat: 'sights', day: '2027-04-02', lat: 35.7148, lon: 139.7967 },
        { id: 'p2', src: 'g', ref: 'g2', name: 'Tsukiji food tour', type: 'activity', cat: 'tours', day: '2027-04-03', time: '09:00', lat: 35.6655, lon: 139.7707 },
        { id: 'p3', src: 'g', ref: 'g3', name: 'Ichiran Shibuya', type: 'food', cat: 'restaurants', day: '2027-04-02', lat: 35.661, lon: 139.701 }];
      const BKA = BK.concat([{ id: 'a1', kind: 'tour', name: 'teamLab Planets', start: '2027-04-04T10:00' }]);
      const { ctx, page } = await setup(browser, { ['itin:' + K]: BKA, ['plan:' + K]: PL });
      let c = await chips(page);
      ok(c.map(x => x.v).join() === 'all,hotels,transport,restaurants,activities', `order with activities: ${c.map(x => x.v)}`);
      ok(!c.some(x => x.v === 'sights' || x.v === 'tours'), `no separate Sights / Things to do chips`);
      ok(c.find(x => x.v === 'activities').n === 3, `Activities number = 3 (Senso-ji, food tour, teamLab): ${JSON.stringify(c)}`);
      const plan = () => page.$$eval('#sec-plan .plan-row .plan-t span', xs => xs.map(x => x.textContent));
      await tap(page, 'cat', 'hotels'); await tap(page, 'cat', 'activities'); c = await chips(page);
      ok(c.filter(x => x.on).map(x => x.v).join() === 'activities', `Activities alone`);
      const pa = await plan(); ok(pa.length === 3 && ['Senso-ji', 'Tsukiji food tour', 'teamLab Planets'].every(n => pa.includes(n)), `lists the activities only: ${pa}`);
      ok(pa.length === c.find(x => x.v === 'activities').n, `chip number = rows listed (${pa.length})`);
      await tap(page, 'cat', 'restaurants'); c = await chips(page);
      const pr = await plan(); ok(c.filter(x => x.on).map(x => x.v).join() === 'restaurants,activities' && pr.length === 5 && pr.includes('Ichiran Shibuya') && pr.includes('Sushi Saito'), `Restaurants + Activities together: ${pr}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/trip-chips-activities.png`, fullPage: false });
      const of = await overflow(page); ok(!of.length, `@390 no overflow with 5 chips ${of}`);
      // a stored pre-11/25 choice (Things to do) opens as Activities
      await page.evaluate((k) => localStorage.setItem('ep:cc:trip:' + k, JSON.stringify({ cats: ['tours'] })), K); await open(page); c = await chips(page);
      ok(c.filter(x => x.on).map(x => x.v).join() === 'activities', `old "tours" choice → Activities (${c.filter(x => x.on).map(x => x.v)})`);
      ok(!page._err.length, `no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
    // ---- Activities with nothing saved: the chip is still there; tapping it says so and points to Nearby ----
    {
      const { ctx, page } = await setup(browser, { ['itin:' + K]: BK });
      await tap(page, 'cat', 'hotels'); await tap(page, 'cat', 'activities'); const c = await chips(page);
      ok(c.find(x => x.v === 'activities').n === 0 && c.find(x => x.v === 'activities').on, `Activities 0, pressed`);
      const msg = await page.textContent('#sec-plan .sec-b'); ok(/No activities saved yet/.test(msg), `empty Activities message: ${msg.trim().slice(0, 80)}`);
      await ctx.close();
    }
    // ---- one subtype only → no subtype chips; no hotels → nothing pre-picked ----
    {
      const { ctx, page } = await setup(browser, { ['itin:' + K]: BK.filter(x => x.kind === 'flight' || x.kind === 'food') });
      let c = await chips(page);
      ok(c.filter(x => x.on).map(x => x.v).join() === 'all', `no hotels: opens on All (${JSON.stringify(c)})`);
      await tap(page, 'cat', 'transport'); ok(!(await page.$(`${T} [data-dd="tsub"]`)), `one transport subtype: no subtype chips`);
      await ctx.close();
    }
    // ---- the Event tab's UA 7924 line: its sheet shows a plane ----
    {
      const { ctx, page } = await setup(browser, {});
      await page.click('[data-tab-go="event"]'); await page.waitForTimeout(300);
      await page.evaluate(() => { const d = [...document.querySelectorAll('#sec-schedule .day')].find(x => /UA 7924/.test(x.textContent) || x.dataset.day === '2027-04-10'); if (d && !d.classList.contains('open')) d.querySelector('[data-day-tog]').click(); });
      await page.click('#sec-schedule .tl-go:has-text("UA 7924")'); await page.waitForSelector('dialog.ds-sheet[open]');
      const ic = await page.evaluate((F) => { const s = document.querySelector('dialog.ds-sheet[open] .cci svg'); return s ? eval(F)(s, ['flight', 'train', 'transport', 'pin']) : 'none'; }, ICON_OF);
      ok(ic === 'flight', `(${ic}) `+`Event row "Depart Tokyo Haneda (HND) on UA 7924" → its sheet shows the plane`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/trip-chips-ua7924.png` });
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
