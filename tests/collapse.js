// Guest tabs stay tidy: a Travel part the guest already booked folds to one line ("✓ Flight · NH 105 · Apr 1",
// "✓ Hotel · Park Hyatt Tokyo · Apr 1–4"), tap to open. ONE way to fold (Dylan's simplify review, item 4): tap the
// section's title row — a single button with aria-expanded and one chevron; no second arrow, also for
// the nested Travel parts (Getting there → Flights). Kept per guest per trip (localStorage; synced with My trip when
// signed in); a section hidden with the old Hide button comes back folded. 40px tap targets; 390 + 320.
// Since 11/25 (Dylan: "more hide buttons on the travel part") Travel's optional blocks have a separate Hide (.th-hide,
// tests/travel-hide.js) — a different action from folding; it is not a second fold control.
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
const CFG = { v: 2, type: 'Trip', title: 'Japan in spring', description: 'Ten days, three cities.', start: '2027-04-01', end: '2027-04-10', tz: 'Asia/Tokyo',
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
    const stay = await page.evaluate(() => { const s = document.querySelector('#sec-stay'); return { col: s.classList.contains('cx-col'), line: s.querySelector('.cx-sumline').textContent, body: s.querySelector('.sec-b').checkVisibility(), title: s.querySelector('.sec-h .cx-tt').textContent }; });
    ok(stay.col && !stay.body && stay.line === '✓ Hotel · Park Hyatt Tokyo · Apr 1–4' && stay.title === 'Where to stay', `@${w} booked hotel folds Where to stay: ${JSON.stringify(stay)}`);
    // one control per header: the title row button, no Hide, no second arrow
    const ctl = await page.evaluate(() => [...document.querySelectorAll('.ev-sec[data-sec], .cx-part')].filter(x => x.checkVisibility()).map(x => {
      const btns = [...x.querySelectorAll(':scope > .sec-h button:not(.th-hide), :scope > button, :scope > .cx > button')];
      return { id: x.dataset.sec || x.textContent.trim().slice(0, 12), n: btns.length, exp: btns.map(b => b.getAttribute('aria-expanded')).join(), chev: x.querySelectorAll(':scope > .sec-h .cx-chev, :scope > button .cx-chev').length };
    }));
    ok(ctl.length >= 4 && ctl.every(c => c.n === 1 && /^(true|false)$/.test(c.exp) && c.chev === 1), `@${w} each section / part header = one button with aria-expanded and one chevron ${JSON.stringify(ctl)}`);
    ok(!(await page.$('.cx-hide, [data-cx-hide], .cx-hidden')) && !(await page.$$eval('.ev button', bs => bs.some(b => b.checkVisibility() && !b.matches('.th-hide') && /^(Hide|Ocultar)$/.test(b.textContent.trim())))), `@${w} no fold-style Hide buttons (Travel's .th-hide is its own action)`);
    const sizes = await page.$$eval('[data-panel="travel"] [data-cx-tog]', bs => bs.map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    ok(sizes.length && sizes.every(x => x >= 40), `@${w} 40px tap targets (${Math.min(...sizes)})`);
    const fullRow = await page.$eval('#sec-stay .sec-h', h => { const b = h.querySelector('button').getBoundingClientRect(), r = h.getBoundingClientRect(); const x = h.querySelector('.th-hide'); const end = x ? x.getBoundingClientRect().left : r.right; return [b.left, b.right, r.left, r.right, end].map(Math.round); }); // fills the row up to Travel's Hide at its right end
    ok(fullRow[1] >= fullRow[4] - 12 && fullRow[1] - fullRow[0] > (fullRow[4] - fullRow[2]) * 0.8, `@${w} the button spans the title row ${fullRow}`);
    if (SHOTS) await page.locator('[data-panel="travel"]').screenshot({ path: `${SHOTS}/collapse-travel-${w}.png` });
    // open the flight part; the choice is kept
    await page.click('[data-panel="travel"] .cx-part:has([data-cx-tog="m-fly"]) .cx-t'); ok((await part('fly')).vis, `@${w} tapping the Flights title opens the folded part`);
    await page.reload(); await page.waitForSelector('[data-panel="travel"] .cx-part'); await page.waitForTimeout(300);
    ok((await part('fly')).vis, `@${w} stays open after reload`);
    // a section on the Event tab: tap the title to fold, again to open; keyboard works the same
    await page.click('[data-tab-go="event"]'); await page.waitForSelector('#sec-schedule [data-cx-tog]');
    await page.click('#sec-schedule .sec-h');
    ok(!(await page.$eval('#sec-schedule .sec-b', b => b.checkVisibility())) && await page.$eval('#sec-schedule .sec-h', h => h.textContent) === 'Itinerary' && await page.getAttribute('#sec-schedule [data-cx-tog]', 'aria-expanded') === 'false', `@${w} tapping the Itinerary title folds it (title unchanged, aria-expanded=false)`);
    await page.click('#sec-schedule .sec-h'); ok(await page.$eval('#sec-schedule .sec-b', b => b.checkVisibility()), `@${w} tapping the title again opens it`);
    await page.focus('#sec-schedule [data-cx-tog]'); await page.keyboard.press('Enter');
    ok(await page.getAttribute('#sec-schedule [data-cx-tog]', 'aria-expanded') === 'false', `@${w} Enter on the focused title folds it`);
    await page.keyboard.press('Space'); ok(await page.getAttribute('#sec-schedule [data-cx-tog]', 'aria-expanded') === 'true', `@${w} Space opens it again`);
    // a section hidden with the old Hide button comes back folded (not gone); opening it forgets the old hide
    await page.evaluate((k) => { const x = JSON.parse(localStorage.getItem('ep:secui:' + k)); x.h = { about: 1 }; localStorage.setItem('ep:secui:' + k, JSON.stringify(x)); }, k);
    await page.reload(); await page.waitForSelector('#sec-schedule [data-cx-tog]'); await page.waitForTimeout(300);
    {
      ok(await page.$eval('#sec-about', s => s.checkVisibility() && s.classList.contains('cx-col')), `@${w} old hidden About shows folded`);
      await page.click('#sec-about .sec-h'); ok(await page.$eval('#sec-about .sec-b', b => b.checkVisibility()), `@${w} and opens with a tap`);
    }
    const of = await overflow(page); ok(of.length === 0, `@${w} no overflow ${of.join(' ')}`);
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:secui:' + k)), k);
    ok(saved && saved.c['m-fly'] === 0 && saved.c.schedule === 0 && !(saved.h && saved.h.about), `@${w} kept per trip ${JSON.stringify(saved)}`);
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
