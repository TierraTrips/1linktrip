// Guest tabs stay tidy: a Travel part the guest already booked folds to one line ("✓ Flight · NH 105 · Apr 1",
// "✓ Hotel · Park Hyatt Tokyo · Apr 1–4"), tap to open; every section has a collapse chevron (or tap its title) and a
// Hide that removes it for this guest, with "Hidden (n)" at the bottom of the tab to bring it back. Kept per guest per
// trip (localStorage; synced with My trip when signed in). 40px tap targets; 390 + 320.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/collapse.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => {
  const cw = document.documentElement.clientWidth;
  return [...document.querySelectorAll('body *')].filter(e => {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return false;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false;
    const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1;
  }).slice(0, 5).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.'));
});
const CFG = { v: 2, type: 'Trip', title: 'Japan in spring', start: '2027-04-01', end: '2027-04-10', tz: 'Asia/Tokyo',
  venue: { name: 'Park Hyatt Tokyo', address: 'Shinjuku, Tokyo', lat: 35.6856, lon: 139.6907, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  schedule: [{ date: '2027-04-02', time: '', title: 'Tsukiji outer market', note: '' }],
  tools: { nearby: false, weather: false, travel: true, stay: true, tours: false, mytrip: true, packing: false, shopping: false } };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);

(async () => {
  const browser = await chromium.launch();
  for (const w of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    const k = keyOf(CFG);
    await page.evaluate((k) => { localStorage.clear(); localStorage.setItem('ep:itin:' + k, JSON.stringify([
      { id: 'b1', kind: 'flight', name: 'ANA', flight: 'NH 105', start: '2027-04-01T10:30', end: '2027-04-02T14:00' },
      { id: 'b2', kind: 'hotel', name: 'Park Hyatt Tokyo', start: '2027-04-01T15:00', end: '2027-04-04T11:00', address: 'Shinjuku' }])); }, k);
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), CFG);
    await page.goto(BASE + '#e=' + packed + '&t=travel'); await page.waitForSelector('[data-panel="travel"] .cx-part'); await page.waitForTimeout(400);
    const part = (m) => page.evaluate((m) => { const el = document.querySelector(`[data-panel="travel"] [data-mode="${m}"]`); const h = el.previousElementSibling; return { col: el.classList.contains('cx-col'), vis: el.checkVisibility(), sum: h.querySelector('[data-cx-sum]').textContent, title: h.querySelector('.cx-t').textContent }; }, m);
    const fly = await part('fly');
    ok(fly.col && !fly.vis && fly.sum === '✓ Flight · NH 105 · Apr 1', `@${w} booked flight folds to one line: ${JSON.stringify(fly)}`);
    const car = await part('rental'); ok(!car.col && car.vis, `@${w} rental car (not booked) stays open`);
    const stay = await page.evaluate(() => { const s = document.querySelector('#sec-stay'); return { col: s.classList.contains('cx-col'), line: s.querySelector('.cx-sumline').textContent, body: s.querySelector('.sec-b').checkVisibility(), title: s.querySelector('.sec-h').textContent }; });
    ok(stay.col && !stay.body && stay.line === '✓ Hotel · Park Hyatt Tokyo · Apr 1–4' && stay.title === 'Where to stay', `@${w} booked hotel folds Where to stay: ${JSON.stringify(stay)}`);
    const sizes = await page.$$eval('[data-panel="travel"] .cx-tog, [data-panel="travel"] .cx-hide', bs => bs.map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    ok(sizes.length && sizes.every(x => x >= 40), `@${w} 40px tap targets (${Math.min(...sizes)})`);
    if (SHOTS) await page.locator('[data-panel="travel"]').screenshot({ path: `${SHOTS}/collapse-travel-${w}.png` });
    // open the flight part; the choice is kept
    await page.click('[data-cx-tog="m-fly"]'); ok((await part('fly')).vis, `@${w} tap opens the folded flight part`);
    await page.reload(); await page.waitForSelector('[data-panel="travel"] .cx-part'); await page.waitForTimeout(300);
    ok((await part('fly')).vis, `@${w} stays open after reload`);
    // hide Where to stay → Hidden (1) → show again
    await page.click('[data-cx-hide="stay"]');
    ok(!(await page.$eval('#sec-stay', s => s.checkVisibility())) && /Hidden \(1\)/.test(await page.textContent('[data-panel="travel"] .cx-hidden summary')), `@${w} Hide removes it; Hidden (1) at the bottom`);
    await page.click('[data-panel="travel"] .cx-hidden summary'); await page.click('[data-cx-show="stay"]');
    ok(await page.$eval('#sec-stay', s => s.checkVisibility()) && !(await page.$('[data-panel="travel"] .cx-hidden')), `@${w} Show brings it back`);
    // any section on the Event tab: chevron or the title collapses it
    await page.click('[data-tab-go="event"]'); await page.waitForSelector('#sec-schedule .cx-tog');
    await page.click('#sec-schedule .cx-tog');
    ok(!(await page.$eval('#sec-schedule .sec-b', b => b.checkVisibility())) && await page.$eval('#sec-schedule .sec-h', h => h.textContent) === 'Itinerary', `@${w} Itinerary collapses (title unchanged)`);
    await page.click('#sec-schedule .sec-h'); ok(await page.$eval('#sec-schedule .sec-b', b => b.checkVisibility()), `@${w} tapping the title opens it`);
    const of = await overflow(page); ok(of.length === 0, `@${w} no overflow ${of.join(' ')}`);
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:secui:' + k)), k);
    ok(saved && saved.c['m-fly'] === 0 && saved.c.schedule === 0 && !saved.h.stay, `@${w} kept per trip ${JSON.stringify(saved)}`);
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
