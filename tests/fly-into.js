// Fly-into airport (Dylan's audit, item 2): the default is no longer just the closest airport. A Tulum/Xpu-Há wedding
// (Hotel Esencia) said CZM — Cozumel, an island reached by ferry — instead of CUN, the Cancún hub. Now: among the
// airports within 1.5x the distance of the nearest large one, a big hub wins, and an island airport is never the default
// for a mainland venue (a venue ON the island gets its own airport). City venues with one obvious big airport are
// unchanged (Manhattan LGA, Tokyo HND). Builder → When and where → "Fly into" lets the organizer pin one (cfg.flyInto,
// kept by normalize / packed links); the ticket, Travel → flights + rental cars and My trip all follow it. A guest's own
// pick (or their booked flight's arrival) still beats it on their device.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/fly-into.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return false; for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.')).slice(0, 5); });
const ESENCIA = { name: 'Hotel Esencia', address: '77734 Xpu Há, Quintana Roo, Mexico', lat: 20.48195, lon: -87.25616, city: 'Xpu Há', region: 'Quintana Roo', country: 'Mexico', cc: 'mx' };
const CFG = { v: 2, type: 'Wedding', title: 'Maya & Leo — Tulum', start: '2027-03-12', end: '2027-03-14', tz: 'America/Cancun', venue: ESENCIA,
  tools: { weather: false, travel: true, stay: true, nearby: false, tours: false, mytrip: true, packing: false, shopping: false } };
async function setup(browser, w = 390) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, serviceWorkers: 'block' });
  await ctx.route(/googleapis|gstatic|overpass|nominatim|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|photon|functions\/v1|auth\/v1|rest\/v1/, r => r.abort());
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.AIRPORTS);
  return { ctx, page };
}
const pack = (page, c) => page.evaluate((c) => window.__ep.packEvent(window.__ep.normalize(JSON.parse(JSON.stringify(c)))), c);
// everything on the guest page that names "the" airport
const guest = (page) => page.evaluate(() => ({
  stub: (document.querySelector('.stub-side .code') || {}).textContent || '',
  chip: [...document.querySelectorAll('[data-slot="flights"] .airports li.on .ap-code')].map(b => b.textContent).join(), // the chosen airport (a settled one is folded to it + Change)
  sel: [...document.querySelectorAll('[data-ap-sel]')].map(s => s.value),
  kayak: [...document.querySelectorAll('[data-slot="rental"] a[href*="kayak.com/cars"]')].map(a => (a.href.match(/cars\/(\w+)\//) || [])[1]).join(),
  rentalHead: [...document.querySelectorAll('[data-slot="rental"] a')].map(a => a.textContent).find(t => /Rental cars near/.test(t)) || '',
  transfer: (document.querySelector('.ap-transfer a') || {}).textContent || '',
  list: [...document.querySelectorAll('[data-slot="flights"] .ap-code')].map(e => e.textContent).join(),
}));

(async () => {
  const browser = require('./_open-settings')(await chromium.launch());
  try {
    // ---- the default pick ----
    {
      const { ctx, page } = await setup(browser);
      const r = await page.evaluate(() => {
        const n = (lat, lon) => { const a = window.__ep.nearestAirports(lat, lon); return { list: a.map(x => x.iata).join(), def: a.def, pick: window.__ep.pickAirport(a, null, []).iata }; };
        return { esencia: n(20.48195, -87.25616), playa: n(20.6296, -87.0739), tulum: n(20.2114, -87.4654), cozumel: n(20.5083, -86.9458), manhattan: n(40.758, -73.9855), tokyo: n(35.6764, 139.65), osaka: n(34.6937, 135.5023) };
      });
      ok(r.esencia.pick === 'CUN' && /CZM/.test(r.esencia.list) && /TQO/.test(r.esencia.list), `Hotel Esencia, Xpu-Há → CUN, not CZM (list ${r.esencia.list})`);
      ok(r.playa.pick === 'CUN', `Playa del Carmen (CZM 20 km across the water) → CUN (${r.playa.pick})`);
      ok(r.tulum.pick === 'TQO', `Tulum town → TQO, the airport 21 km away; CUN is 111 km (${r.tulum.pick})`);
      ok(r.cozumel.pick === 'CZM', `a venue on Cozumel → its own CZM (${r.cozumel.pick})`);
      ok(r.manhattan.pick === 'LGA' && r.tokyo.pick === 'HND' && r.osaka.pick === 'ITM', `city venues unchanged: Manhattan ${r.manhattan.pick}, Tokyo ${r.tokyo.pick}, Osaka ${r.osaka.pick}`);
      // normalize: the organizer's pick is kept, junk dropped
      const n = await page.evaluate((c) => { const N = (f, v = c.venue) => window.__ep.normalize({ ...JSON.parse(JSON.stringify(c)), venue: v, flyInto: f }).flyInto;
        return { ok: N('CUN'), low: N(' tqo '), unknown: N('QQQ'), junk: N('<b>'), num: N(5), novenue: N('CUN', null), none: N('none'), noneUp: N(' None '), noneNoVenue: N('none', null) }; }, CFG);
      ok(n.ok === 'CUN' && n.low === 'TQO' && n.unknown === undefined && n.junk === undefined && n.num === undefined && n.novenue === undefined, `normalize keeps a real code, drops junk ${JSON.stringify(n)}`);
      ok(n.none === 'none' && n.noneUp === 'none' && n.noneNoVenue === 'none', `normalize keeps No airport ('none'), with or without a venue ${JSON.stringify(n)}`);
      ok(!page._err.length, `no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }

    for (const w of [390, 320]) {
      // ---- guest page, automatic: CUN everywhere ----
      let { ctx, page } = await setup(browser, w);
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + '#e=' + await pack(page, CFG) + '&t=travel'); await page.waitForSelector('[data-slot="rental"] a'); await page.waitForTimeout(500);
      let g = await guest(page);
      ok(g.stub === 'CUN' && g.chip === 'CUN' && g.sel.length && g.sel.every(x => x === 'CUN') && g.kayak === 'CUN' && /CUN/.test(g.transfer), `@${w} guest, automatic: ticket, flights, rental picker, Kayak cars, transfer all CUN ${JSON.stringify(g)}`);
      ok(/CZM/.test(g.list) && /TQO/.test(g.list), `@${w} CZM and TQO still listed to pick (${g.list})`);
      ok((await overflow(page)).length === 0, `@${w} Travel tab: no overflow ${(await overflow(page)).join(' ')}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/fly-travel-auto-${w}.png`, fullPage: true });

      // ---- builder: When and where → Fly into ----
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + '#edit=' + await pack(page, CFG)); await page.waitForSelector('[data-acc="when"]');
      await page.evaluate(() => { document.querySelector('[data-acc="when"]').open = true; }); await page.waitForSelector('#f-fly');
      const opts = await page.$$eval('#f-fly option', os => os.map(o => [o.value, o.textContent]));
      ok(opts[0][0] === '' && /^Automatic \(CUN · Cancún\)$/.test(opts[0][1]) && ['CUN', 'CZM', 'TQO'].every(c => opts.some(o => o[0] === c)), `@${w} builder Fly into: Automatic (CUN) + nearby airports ${JSON.stringify(opts.slice(0, 5))}`);
      ok(opts[1][0] === 'none' && /^No airport/.test(opts[1][1]), `@${w} builder Fly into: "No airport" right under Automatic ${JSON.stringify(opts[1])}`);
      ok(await page.$eval('#f-fly', s => s.value) === '', `@${w} starts on Automatic`);
      ok((await overflow(page)).length === 0, `@${w} builder When and where: no overflow ${(await overflow(page)).join(' ')}`);
      if (SHOTS) await page.locator('[data-acc="when"]').screenshot({ path: `${SHOTS}/fly-builder-${w}.png` });
      await page.selectOption('#f-fly', 'TQO'); await page.waitForTimeout(700);
      const dr = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
      ok(dr && dr.flyInto === 'TQO', `@${w} picking TQO stores flyInto in the draft (${dr && dr.flyInto})`);
      ok(await page.$eval('.b-frame .stub-side .code', e => e.textContent).catch(() => '') === 'TQO', `@${w} builder preview ticket follows: TQO`);
      // the draft, packed and opened again in the builder, keeps it
      await page.goto(BASE + '#edit=' + await pack(page, dr)); await page.reload(); await page.waitForSelector('[data-acc="when"]'); await page.evaluate(() => { document.querySelector('[data-acc="when"]').open = true; }); await page.waitForSelector('#f-fly');
      ok(await page.$eval('#f-fly', s => s.value) === 'TQO', `@${w} builder reopened from the packed draft keeps TQO`);
      // No airport: stored, the preview ticket drops "Fly into" for the date, kept through a packed draft
      await page.selectOption('#f-fly', 'none'); await page.waitForTimeout(600);
      const drn = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
      const pv = await page.evaluate(() => ({ lbl: (document.querySelector('.b-frame .stub-side .lbl') || {}).textContent || '', code: (document.querySelector('.b-frame .stub-side .code') || {}).textContent || '' }));
      ok(drn.flyInto === 'none' && pv.lbl !== 'Fly into' && pv.code === 'MAR', `@${w} No airport → draft flyInto 'none', preview ticket shows the date ${JSON.stringify([drn.flyInto, pv])}`);
      await page.goto(BASE + '#edit=' + await pack(page, drn)); await page.reload(); await page.waitForSelector('[data-acc="when"]'); await page.evaluate(() => { document.querySelector('[data-acc="when"]').open = true; }); await page.waitForSelector('#f-fly');
      ok(await page.$eval('#f-fly', s => s.value) === 'none', `@${w} builder reopened from the packed draft keeps No airport`);
      await page.selectOption('#f-fly', 'TQO'); await page.waitForTimeout(500);
      // back to Automatic clears it
      await page.selectOption('#f-fly', ''); await page.waitForTimeout(500);
      ok(!(await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).flyInto)), `@${w} Automatic clears the pick`);
      await page.selectOption('#f-fly', 'TQO'); await page.waitForTimeout(500);
      // Change venue drops it (the next venue gets its own automatic airport)
      await page.click('[data-acc="when"] [data-b="clear-venue"]'); await page.waitForTimeout(400);
      ok(!(await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).flyInto)) && !(await page.$('#f-fly')), `@${w} Change venue drops Fly into`);
      // a new venue (Tulum town) → its own automatic airport, TQO
      await page.route(/nominatim\.openstreetmap\.org\/search/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ name: 'Tulum', lat: '20.2114', lon: '-87.4654', display_name: 'Tulum, Quintana Roo, Mexico', addresstype: 'town', address: { town: 'Tulum', state: 'Quintana Roo', country: 'Mexico', country_code: 'mx' } }]) }));
      await page.fill('#vq', 'Tulum'); await page.click('[data-acc="when"] [data-b="search"]'); await page.waitForSelector('[data-pick="0"]', { timeout: 8000 });
      await page.click('[data-pick="0"]'); await page.waitForSelector('#f-fly'); await page.waitForTimeout(400);
      const nv = await page.evaluate(() => ({ auto: document.querySelector('#f-fly option').textContent, val: document.querySelector('#f-fly').value, d: JSON.parse(localStorage.getItem('ep:draft')) }));
      ok(/^Automatic \(TQO/.test(nv.auto) && nv.val === '' && nv.d.venue && nv.d.venue.city === 'Tulum' && !nv.d.flyInto, `@${w} new venue Tulum: Automatic (TQO), no old pick ${JSON.stringify([nv.auto, nv.val, nv.d.flyInto])}`);
      // No airport is about the event, not the venue: it survives Change venue
      await page.selectOption('#f-fly', 'none'); await page.waitForTimeout(400);
      await page.click('[data-acc="when"] [data-b="clear-venue"]'); await page.waitForTimeout(400);
      ok(await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).flyInto) === 'none', `@${w} Change venue keeps No airport`);
      ok(!page._err.length, `@${w} builder: no page errors ${page._err.join(' | ')}`);
      await ctx.close();

      // ---- on-page editing (Dylan 11/24: "the fly into under events doesn't seem to be editable"): the ticket's Fly into
      // is a tap target in the builder preview → a "Fly into" sheet; No airport → back to an airport from the same spot ----
      ({ ctx, page } = await setup(browser, w));
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + '#edit=' + await pack(page, { ...CFG, flyInto: 'TQO' })); await page.waitForSelector('.b-form');
      await page.click('.b-set-h [data-act="settings"]'); await page.waitForSelector('#preview .ev.onp .stub-side[data-ed="fly"] .onp-mk'); await page.waitForTimeout(500);
      await page.click('#preview .stub-side .code'); await page.waitForSelector('#sheet[open] #sh-fly');
      ok(await page.$eval('#sheet h2', e => e.firstChild.textContent) === 'Fly into' && await page.$eval('#sh-fly', s => s.value) === 'TQO', `@${w} on-page: tap the ticket's Fly into → Fly into sheet on TQO`);
      await page.selectOption('#sh-fly', 'none'); await page.waitForTimeout(600); await page.click('#sheet .btn.primary.big'); await page.waitForTimeout(500);
      ok(await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).flyInto) === 'none' && await page.$eval('#preview .stub-side', e => !/Fly into/.test(e.textContent) && e.dataset.ed === 'fly'), `@${w} on-page: No airport saved; the ticket shows the date and stays editable`);
      await page.click('#preview .stub-side[data-ed="fly"]'); await page.waitForSelector('#sheet[open] #sh-fly');
      await page.selectOption('#sh-fly', 'CUN'); await page.waitForTimeout(600); await page.click('#sheet .btn.primary.big'); await page.waitForTimeout(500);
      ok(await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).flyInto) === 'CUN' && await page.$eval('#preview .stub-side .code', e => e.textContent) === 'CUN', `@${w} on-page: back to CUN from the ticket`);
      await page.click('#preview .stub-main[data-ed="when"]'); await page.waitForSelector('#sheet[open]');
      ok(await page.$eval('#sh-fly', s => s.value).catch(() => null) === 'CUN', `@${w} on-page: Date and place sheet has Fly into too`);
      ok((await overflow(page)).length === 0, `@${w} on-page Fly into: no overflow ${(await overflow(page)).join(' ')}`);
      ok(!page._err.length, `@${w} on-page: no page errors ${page._err.join(' | ')}`);
      await ctx.close();

      // ---- guest page with the organizer's pick: pack → unpack → every consumer ----
      ({ ctx, page } = await setup(browser, w));
      await page.evaluate(() => localStorage.clear());
      const packed = await pack(page, { ...CFG, flyInto: 'TQO' });
      const un = await page.evaluate((s) => JSON.parse(window.LZString.decompressFromEncodedURIComponent(s)).flyInto, packed);
      ok(un === 'TQO', `@${w} flyInto travels in the packed link (${un})`);
      await page.goto(BASE + '#e=' + packed + '&t=travel'); await page.waitForSelector('[data-slot="rental"] a'); await page.waitForTimeout(500);
      g = await guest(page);
      ok(g.stub === 'TQO' && g.chip === 'TQO' && g.sel.every(x => x === 'TQO') && g.kayak === 'TQO' && /TQO/.test(g.rentalHead) && /TQO/.test(g.transfer), `@${w} organizer picked TQO: ticket, flights, rental, transfer follow ${JSON.stringify(g)}`);
      const gfl = await page.$$eval('[data-slot="flights"] li.on a[href*="google.com/travel/flights"]', as => as.map(a => decodeURIComponent(a.href)));
      ok(gfl.length && gfl.every(h => /Flights to TQO/.test(h)) && gfl.every(h => !/[?&](utm_|aff|ref=)/.test(h)), `@${w} the chosen airport's Google Flights search is TQO, plain link (${gfl[0]})`);
      // My trip doesn't presume flying: no "Flying into" until the guest picks an airport (or books a flight)
      await page.click('[data-tab-go="mytrip"]'); await page.waitForTimeout(300);
      ok(!(await page.$('[data-slot="ap-mine"] select')) && !(await page.isVisible('[data-slot="ap-mine"]').catch(() => false)), `@${w} My trip: no Flying into before the guest says they fly`);
      // a guest's own pick still wins on their device
      await page.click('[data-tab-go="travel"]'); await page.click('[data-ap="CZM"]'); await page.waitForTimeout(300);
      g = await guest(page);
      ok(g.kayak === 'CZM' && g.stub === 'CZM', `@${w} a guest's own pick (CZM) beats the organizer's on their device ${JSON.stringify(g)}`);
      await page.click('[data-tab-go="mytrip"]'); await page.waitForTimeout(300);
      ok(await page.$eval('[data-slot="ap-mine"] select', s => s.value).catch(() => null) === 'CZM', `@${w} My trip: Flying into CZM once picked`);
      await page.click('[data-tab-go="travel"]');
      ok((await overflow(page)).length === 0, `@${w} Travel with a pick: no overflow`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/fly-travel-pinned-${w}.png`, fullPage: true });

      // an airport that isn't one of the 3 nearest (Mérida, ~280 km) still becomes the one
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + '#e=' + await pack(page, { ...CFG, flyInto: 'MID' }) + '&t=travel'); await page.waitForSelector('[data-slot="rental"] a'); await page.waitForTimeout(400);
      g = await guest(page);
      ok(g.stub === 'MID' && g.chip === 'MID' && g.kayak === 'MID' && /MID/.test(g.list), `@${w} organizer pick outside the nearest three (MID) is listed and used ${JSON.stringify(g)}`);
      ok(!page._err.length, `@${w} guest: no page errors ${page._err.join(' | ')}`);

      // ---- No airport: nothing presumes flying ----
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + '#e=' + await pack(page, { ...CFG, flyInto: 'none' }) + '&t=travel'); await page.waitForSelector('[data-slot="rental"] a'); await page.waitForTimeout(500);
      const nf = await page.evaluate(() => ({
        side: [...document.querySelectorAll('.stub-side > *')].map(e => e.textContent),
        aps: document.querySelectorAll('[data-ap-sel], .ap-pick, .ap-code, .ap-transfer, [data-slot="ap-mine"] select').length,
        kayakCars: document.querySelectorAll('a[href*="kayak.com/cars"]').length,
        nearAp: [...document.querySelectorAll('[data-slot="stay-links"] a')].some(a => /Hotels near/.test(a.textContent)),
        modes: [...document.querySelectorAll('.mode-bar [data-tmode]')].filter(b => !b.hidden).map(b => b.dataset.tmode),
        order: [...document.querySelectorAll('#sec-travel [data-mode]')].map(e => e.dataset.mode),
        flights: [...document.querySelectorAll('[data-slot="flights"] a')].map(a => [a.textContent, decodeURIComponent(a.href)]),
        rental: [...document.querySelectorAll('[data-slot="rental"] a')].map(a => a.textContent),
      }));
      ok(nf.side[0] !== 'Fly into' && nf.side.join(' ') === 'Fri MAR 12', `@${w} No airport: ticket shows the date, not Fly into (${nf.side.join(' ')})`);
      ok(nf.aps === 0 && nf.kayakCars === 0 && !nf.nearAp, `@${w} No airport: no airport list, picker, transfer, airport rentals or Hotels near airport ${JSON.stringify(nf)}`);
      ok(nf.order[0] === 'drive' && nf.order[nf.order.length - 1] === 'fly' && nf.modes[0] === 'all' && nf.modes[1] === 'drive' && nf.modes[nf.modes.length - 1] === 'fly', `@${w} No airport: Getting there leads with Driving, flights last (sections ${nf.order}, pills ${nf.modes})`);
      ok(nf.flights.length === 1 && /Flights to Xpu Há/.test(nf.flights[0][0]) && /Flights to Xpu Há/.test(nf.flights[0][1]) && !/[?&](utm_|aff|ref=)/.test(nf.flights[0][1]) && !/\b(CUN|CZM|TQO)\b/.test(nf.flights[0][1]), `@${w} No airport: one plain flight search to the town ${JSON.stringify(nf.flights)}`);
      ok(nf.rental.some(t => /Rental desks near the venue/.test(t)), `@${w} No airport: rental desks near the venue stay ${JSON.stringify(nf.rental)}`);
      await page.click('[data-tab-go="mytrip"]'); await page.waitForTimeout(300);
      ok(!(await page.$('[data-slot="ap-mine"] select')), `@${w} No airport: My trip has no Flying into`);
      await page.click('[data-tab-go="travel"]'); await page.waitForTimeout(200);
      ok((await overflow(page)).length === 0, `@${w} No airport: no overflow ${(await overflow(page)).join(' ')}`);
      if (SHOTS) { await page.click('[data-tab-go="event"]'); await page.waitForTimeout(200); await page.locator('.stub').screenshot({ path: `${SHOTS}/fly-none-ticket-${w}.png` }); }
      ok(!page._err.length, `@${w} No airport: no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
