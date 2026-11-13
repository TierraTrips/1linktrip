// "Airlines serving <airport>": the country's own carriers (airlines.js) ahead of the international majors.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/regional-airlines.js
//   SHOTS=/tmp/ep-shots node tests/regional-airlines.js     # also saves 390 / 320 screenshots
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
  await page.addInitScript(() => { let v; Object.defineProperty(window, 'EXAMPLES', { configurable: true, get: () => v, set: (x) => { Object.values(x).forEach(e => { delete e.demoTrip; }); v = x; } }); });
  await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.AIRPORTS && window.REGIONAL_AIRLINES);

  // data table: every entry well-formed, https, no duplicate names/codes per country, and every country has airports
  const data = await page.evaluate(() => {
    const R = window.REGIONAL_AIRLINES; const ccs = new Set(window.AIRPORTS.map(a => a[3])); const bad = [];
    for (const [cc, xs] of Object.entries(R)) {
      if (!ccs.has(cc)) bad.push(`${cc}: no airports`);
      const names = new Set(), codes = new Set();
      for (const x of xs) {
        if (!Array.isArray(x) || x.length !== 3 || !/^([A-Z0-9]{2})?$/.test(x[0]) || !x[1]) bad.push(`${cc}: malformed ${JSON.stringify(x)}`);
        if (!/^https:\/\/[^/]+\.[a-z]{2,}(\/|$)/i.test(x[2])) bad.push(`${cc}: not https ${x[2]}`);
        if (names.has(x[1])) bad.push(`${cc}: dup name ${x[1]}`); names.add(x[1]);
        if (x[0] && codes.has(x[0])) bad.push(`${cc}: dup code ${x[0]}`); if (x[0]) codes.add(x[0]);
      }
    }
    return { n: Object.keys(R).length, bad };
  });
  ok(data.n >= 150, `${data.n} countries covered`);
  ok(!data.bad.length, `table well-formed (${data.bad.slice(0, 5).join('; ')})`);

  // per airport: regional first, majors after, deduped, all https
  const ap = (iata) => page.evaluate((iata) => { const a = window.AIRPORTS.find(x => x[0] === iata); const xs = window.__ep.airlinesFor({ iata, name: a[1], city: a[2], cc: a[3] }); return xs.map(x => ({ code: x.code, name: x.name, regional: x.regional })); }, iata);
  const names = (xs) => xs.map(x => x.name);
  const noDupes = (xs) => new Set(xs.map(x => x.name.toLowerCase())).size === xs.length && new Set(xs.filter(x => x.code).map(x => x.code)).size === xs.filter(x => x.code).length;
  const cases = { CUN: ['Aeroméxico', 'Volaris', 'Viva Aerobus', 'Aeroméxico Connect'], HND: ['JAL', 'ANA', 'Peach', 'Jetstar Japan', 'Skymark', 'ZIPAIR'], YYZ: ['Air Canada', 'WestJet', 'Porter', 'Flair'],
    GRU: ['LATAM', 'GOL', 'Azul'], DEL: ['IndiGo', 'Air India', 'Akasa Air', 'SpiceJet'], MAD: ['Iberia', 'Vueling', 'Air Europa', 'Volotea', 'Binter'] };
  for (const [iata, want] of Object.entries(cases)) {
    const xs = await ap(iata); const ns = names(xs);
    ok(want.every(w => ns.includes(w)), `${iata}: ${want.join(', ')} present (${ns.slice(0, 10).join(', ')})`);
    ok(noDupes(xs), `${iata}: no duplicate airlines`);
    const firstMajor = xs.findIndex(x => !x.regional); ok(firstMajor > 0 && xs.slice(firstMajor).every(x => !x.regional), `${iata}: country's airlines listed before the majors`);
    ok(xs.some(x => x.name === 'Emirates'), `${iata}: international majors still listed`);
  }
  const jl = (await ap('HND')).filter(x => x.code === 'JL'); ok(jl.length === 1, 'JAL once (table + majors deduped by code)');

  // rendered: Tulum demo (Mexico) → heading names the airport, chips are https links, 6 shown + More
  await page.goto(BASE + '?demo=wedding#t=travel'); await page.waitForSelector('.airline-pick'); await page.waitForTimeout(600);
  const r = async () => page.$eval('.airline-pick', el => ({ h: el.querySelector('.al-h').textContent, all: [...el.querySelectorAll('.al-chips a')].map(a => ({ t: a.textContent, href: a.href, vis: !!a.offsetParent, target: a.target })), more: !!el.querySelector('[data-more]') }));
  let s = await r();
  ok(/^Airlines serving .+\([A-Z]{3}\)$/.test(s.h), `heading: ${s.h}`);
  ok(s.all.filter(x => x.vis).length === 6 && s.more, `6 chips visible + More (${s.all.filter(x => x.vis).length})`);
  ok(s.all.every(x => x.href.startsWith('https://') && x.target === '_blank'), 'every chip is an https link in a new tab');
  ok(['Aeroméxico', 'Volaris', 'Viva Aerobus'].every(n => s.all.slice(0, 6).some(x => x.t === n)), `Mexican carriers in the first six (${s.all.slice(0, 6).map(x => x.t)})`);
  const box = await page.$eval('.al-chips a', a => { const r = a.getBoundingClientRect(); return { h: r.height, right: r.right }; });
  ok(box.h >= 36, `chip tap height ${box.h}`);
  if (SHOTS) await page.locator('.airline-pick').screenshot({ path: `${SHOTS}/airlines-390.png` });
  await page.click('.airline-pick [data-more]'); await page.waitForTimeout(200);
  s = await r(); ok(!s.more && s.all.every(x => x.vis), `More shows all ${s.all.length}`);
  // switching the airport keeps the list (same country) and re-points deep links
  await page.click('[data-ap="CUN"]'); await page.waitForTimeout(300); s = await r();
  ok(/\(CUN\)/.test(s.h), `heading follows the airport pick (${s.h})`);
  const ua = s.all.find(x => x.t === 'United'); ok(ua && /t=CUN/.test(ua.href), 'United keeps its route deep link to CUN');

  // 320 px: no horizontal overflow
  await page.setViewportSize({ width: 320, height: 760 }); await page.waitForTimeout(300);
  const ov = await page.evaluate(() => { const el = document.querySelector('.airline-pick'); const w = document.documentElement.clientWidth; return [...el.querySelectorAll('a,button')].filter(a => a.offsetParent && a.getBoundingClientRect().right > w + 1).length; });
  ok(ov === 0, `320 px: no chip past the edge (${ov})`);
  if (SHOTS) await page.locator('.airline-pick').screenshot({ path: `${SHOTS}/airlines-320.png` });

  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
