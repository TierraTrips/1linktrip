// Example / shared pages: the top bar (brand, "Example page", Edit a copy / Customize this) never covers the page —
// on phones it scrolls away with the cover, on wide screens it sits above the tabs. Scrolled states at 320, 390, 1280.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/vbar.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
(async () => {
  const browser = await chromium.launch();
  for (const [w, h, mobile] of [[320, 640, true], [390, 844, true], [1280, 900, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru|functions\/v1/, r => r.abort());
    await page.goto(BASE + '#ex=japan-trip'); await page.waitForSelector('.vbar .btn');
    const box = () => page.evaluate(() => { const r = document.querySelector('.vbar').getBoundingClientRect(); const tabs = document.querySelector('.ev-tabs'); const tr = tabs && tabs.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, tabsTop: tr ? tr.top : null, tabsBottom: tr ? tr.bottom : null, title: document.querySelector('.ev-title').getBoundingClientRect().top }; });
    let b = await box(); ok(b.bottom <= b.title, `@${w} at the top: the bar sits above the title`);
    if (!mobile) ok(b.bottom <= b.tabsTop + 1, `@${w} the bar sits above the tabs`);
    await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(200);
    b = await box(); ok(b.bottom <= 0 || (!mobile && b.bottom <= b.tabsTop + 1), `@${w} scrolled: the bar is out of the way (${Math.round(b.top)}..${Math.round(b.bottom)})`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/vbar-scrolled-${w}.png` });
    await page.evaluate(() => window.scrollTo(0, 300)); await page.waitForTimeout(100); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
    b = await box(); ok(b.top >= 0 && b.bottom <= b.title, `@${w} scrolled back up: back at the top, not over the title`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/vbar-top-${w}.png` });
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
