// Example pages show the app's range: the Japan trip has a 4-leg route that returns to Tokyo, a day-by-day itinerary
// with times and notes behind a tap, a document, sections, and a sample My trip (flights + hotels "via" a booking site
// with conf #, a train, a rental car, a tour ticket, saved spots, shopping and packing). The wedding, race and
// conference have their type details plus sample bookings, saved spots and a document. Sample My trip data is shown
// without being written to storage and never travels into "Customize this". Examples open translated (es/ja) without
// asking ai-import. Screenshots at 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  SHOTS=/tmp/ep-shots node tests/examples.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.className).slice(0, 3); });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e))); let ai = 0;
  await page.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru/, r => r.abort());
  await page.route('**/functions/v1/**', r => { if (r.request().method() === 'POST') ai++; r.abort(); });
  await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
  const mine = () => page.evaluate(() => Object.keys(localStorage).filter(k => /^ep:(itin|plan|shop|pack):/.test(k)));
  // Japan
  await page.goto(BASE + '?demo=japan'); await page.waitForSelector('#sec-schedule');
  ok((await page.$$eval('#sec-schedule .leg-h b', bs => bs.map(b => b.textContent))).join() === 'Tokyo,Kyoto,Osaka,Tokyo', 'Japan: route returns to Tokyo');
  ok((await page.$$('#sec-schedule details.tl-d')).length >= 10 && !!(await page.$('#sec-schedule .route-docs a')), 'Japan: notes behind a tap, the trip plan PDF in the itinerary');
  ok(!!(await page.$('#sec-c-getaround')) && !!(await page.$('#sec-c-sos')), 'Japan: custom sections');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ex-japan-event-390.png` });
  await page.click('[data-tab-go="mytrip"]'); await page.waitForSelector('#sec-itinerary');
  const bk = await page.$$eval('.bookings li', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ')));
  ok(bk.length === 9 && bk.some(x => /via Expedia · Conf\. SAMPLE1/.test(x)) && bk.some(x => /via Booking\.com/.test(x)) && bk.some(x => /Rental car/.test(x)), `Japan: 9 sample bookings with Booked through (${bk.length})`);
  ok(/Ichiran[\s\S]*Kuromon/.test(await page.textContent('#sec-spots')), 'Japan: saved spots per city');
  ok((await page.$$('#sec-shop .shop li')).length === 4 && /Coin purse/.test(await page.textContent('#sec-packing')), 'Japan: shopping + packing samples');
  ok((await mine()).length === 0, 'Japan: sample My trip not written to storage by looking');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ex-japan-mytrip-390.png`, fullPage: false });
  ok((await overflow(page)).length === 0, 'Japan: no overflow');
  // Customize this → no sample My trip in the copy
  await page.goto(BASE + '#edit-ex=japan-trip'); await page.waitForSelector('.b-form'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => !('demoTrip' in JSON.parse(localStorage.getItem('ep:draft')))), 'Customize this: the copy has no sample My trip');
  // wedding, race, conference
  for (const [d, title, spot] of [['wedding', 'Maya & Theo', 'Hartwood'], ['race', 'Lakefront 10K', 'Wildberry'], ['conference', 'Signal & Noise 2026', "Joe's Pizza"]]) {
    await page.goto(BASE + '?demo=' + d); await page.waitForSelector('.ev-title');
    ok(await page.textContent('.ev-title') === title && !!(await page.$('.docs a[href$=".pdf"]')) && !!(await page.$('.ev-sec.cs')), `${d}: page with a document and a section`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/ex-${d}-390.png` });
    await page.click('[data-tab-go="mytrip"]'); await page.waitForSelector('#sec-itinerary');
    ok((await page.$$('.bookings li')).length >= 1 && new RegExp(spot).test(await page.textContent('#sec-spots')), `${d}: sample booking + saved spot`);
    ok((await overflow(page)).length === 0, `${d}: no overflow`);
  }
  ok((await mine()).length === 0, 'no sample data written');
  // translated examples, no AI calls
  await page.goto(BASE + '?lang=ja&demo=japan'); await page.waitForFunction(() => document.querySelector('.ev-title') && document.querySelector('.ev-title').textContent === '春の日本', null, { timeout: 8000 }).catch(() => {});
  ok(await page.textContent('.ev-title') === '春の日本', `Japanese example title: ${await page.textContent('.ev-title')}`);
  const it = await page.$$eval('#sec-schedule .tl b', bs => bs.map(b => b.textContent)); ok(it.length && /[ぁ-んァ-ン一-龥]/.test(it[0]), `Japanese itinerary: ${it[0]}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ex-japan-ja-390.png` });
  await page.goto(BASE + '?lang=es&demo=wedding'); await page.waitForTimeout(800);
  ok(/playa|Tulum/i.test(await page.textContent('.ev-tagline')) && !/Getting married/.test(await page.textContent('.ev-tagline')), `Spanish wedding: ${await page.textContent('.ev-tagline')}`);
  ok(ai === 0, `no translate calls for examples (${ai})`);
  ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
