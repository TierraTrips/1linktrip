// My trip → Shopping list: things to buy at the destination, next to the Packing list. Add (Enter or Add), optional
// city (route stops) and note, check off (checked items sink to the bottom), delete; count in the collapsed header;
// kept per trip in localStorage across reloads and offline; host toggle "Shopping list" under Automatic for guests,
// on by default for trips only. Spanish UI. 390 + 320.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/shopping.js
//
// Needs Playwright. Exit code 1 on any failure.
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
const P = (name, lat, lon, from, to) => ({ name, address: name, lat, lon, city: name, country: 'Japan', cc: 'jp', from, to });
const TRIP = { v: 2, type: 'Trip', title: 'Japan in spring', start: '2027-04-01', end: '2027-04-10', venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 35.6762, 139.6503, '2027-04-01', '2027-04-05'), P('Kyoto', 35.0116, 135.7681, '2027-04-05', '2027-04-10')] };

(async () => {
  const browser = await chromium.launch();
  for (const w of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    const packed = await page.evaluate((c) => window.__ep.packEvent(window.__ep.unpackEvent(window.__ep.packEvent(c))), TRIP);
    await page.goto(BASE + '#e=' + packed + '&t=mytrip'); await page.waitForSelector('#sec-shop');
    const order = await page.$$eval('[data-panel="mytrip"] .ev-sec', ss => ss.map(s => s.id));
    ok(order.indexOf('sec-shop') === order.indexOf('sec-packing') - 1, `@${w} Shopping list sits next to the Packing list ${order.join(',')}`);
    await page.click('#sec-shop summary'); await page.waitForSelector('#sec-shop [data-shop-text]');
    ok(/Nothing on the list yet/.test(await page.textContent('#sec-shop [data-slot="shop-list"]')), `@${w} empty state`);
    ok((await page.$$eval('#sec-shop [data-shop-city] option', os => os.map(o => o.textContent))).join() === 'Any city,Tokyo,Kyoto', `@${w} city choices from the route`);
    await page.fill('[data-shop-text]', 'Matcha from Ippodo'); await page.selectOption('[data-shop-city]', 'Kyoto'); await page.fill('[data-shop-note]', 'the 40g tin'); await page.click('[data-shop-add]');
    await page.fill('[data-shop-text]', 'Pocket Wi-Fi'); await page.press('[data-shop-text]', 'Enter');
    await page.fill('[data-shop-text]', 'Kit Kats'); await page.selectOption('[data-shop-city]', 'Tokyo'); await page.click('[data-shop-add]');
    const items = () => page.$$eval('#sec-shop .shop li', ls => ls.map(l => [l.querySelector('.shop-t > span').textContent, (l.querySelector('.shop-city') || {}).textContent || '', (l.querySelector('small') || {}).textContent || '', l.classList.contains('done')].join('/')));
    ok((await items()).join('|') === 'Matcha from Ippodo/Kyoto/the 40g tin/false|Pocket Wi-Fi/Kyoto//false|Kit Kats/Tokyo//false', `@${w} added with city (stays picked for the next item) + note: ${(await items()).join('|')}`);
    const first = await page.$eval('#sec-shop [data-shop]', i => i.dataset.shop);
    await page.check(`[data-shop="${first}"]`); await page.waitForTimeout(100);
    ok((await items()).at(-1) === 'Matcha from Ippodo/Kyoto/the 40g tin/true', `@${w} checked item moves to the bottom`);
    ok(/1 of 3 bought/.test(await page.textContent('[data-slot="shop-sum"]')), `@${w} count in the header`);
    const wifi = await page.$$eval('#sec-shop .shop li', ls => ls.find(l => /Wi-Fi/.test(l.textContent)).querySelector('[data-shop-del]').dataset.shopDel);
    await page.click(`[data-shop-del="${wifi}"]`); await page.waitForTimeout(100);
    ok((await items()).length === 2, `@${w} delete`);
    const of = await overflow(page); ok(of.length === 0, `@${w} no overflow ${of.join(' ')}`);
    if (SHOTS && w === 390) await page.locator('#sec-shop').screenshot({ path: `${SHOTS}/shopping-390.png` });
    // survives a reload, and adding works with no connection (page offline: tests/offline.js)
    await page.reload(); await page.waitForSelector('#sec-shop'); await page.click('#sec-shop summary'); await ctx.setOffline(true);
    ok((await items()).join('|') === 'Kit Kats/Tokyo//false|Matcha from Ippodo/Kyoto/the 40g tin/true', `@${w} kept after reload`);
    await page.fill('[data-shop-text]', 'Onsen towel'); await page.click('[data-shop-add]');
    ok((await items()).length === 3, `@${w} adding works offline`);
    await ctx.setOffline(false);
    // Spanish
    await page.goto(BASE + '?lang=es#e=' + packed + '&t=mytrip'); await page.waitForSelector('#sec-shop');
    ok(/Lista de compras/.test(await page.textContent('#sec-shop .sec-h')) && /de 3 comprados/.test(await page.textContent('[data-slot="shop-sum"]')), `@${w} Spanish`);
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  // host side: toggle + defaults; other types don't get it
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); const page = await ctx.newPage();
    await page.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '#edit-ex=japan-trip'); await page.waitForSelector('[data-tool="shopping"]');
    ok(await page.$eval('[data-tool="shopping"]', i => i.checked && i.closest('label').textContent.trim() === 'Shopping list'), 'builder: Shopping list toggle, on for a trip');
    const party = await page.evaluate(() => window.__ep.unpackEvent(window.__ep.packEvent({ v: 2, type: 'Party', title: 'x', start: '2027-06-12T15:00' })).tools.shopping);
    ok(party === false, 'off by default for other event types');
    const off = await page.evaluate((c) => window.__ep.packEvent({ ...c, tools: { mytrip: true, packing: true, shopping: false } }), TRIP);
    await page.goto(BASE + '#e=' + off + '&t=mytrip'); await page.waitForSelector('#sec-packing');
    ok(!(await page.$('#sec-shop')), 'host turned it off → no Shopping list');
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
