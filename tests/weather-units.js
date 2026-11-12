// Weather °F / °C switch: the guest's saved choice wins (global, every page), else their locale picks the unit
// (°F for US-region / plain English browsers, °C for ja/es/fr/de/en-GB...). Every temperature converts client-side
// with no refetch; packing hints don't change with the unit; the switch doesn't fold the section; its label is
// translated; the Weather section doesn't overflow at 320/390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  SHOTS=/tmp/ep-shots node tests/weather-units.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };

// Open-Meteo stand-in: every day 68°F / 50°F (20°C / 10°C), whichever endpoint and date range is asked for.
function meteo(route) {
  const u = new URL(route.request().url()); const s = u.searchParams.get('start_date'), e = u.searchParams.get('end_date');
  const time = []; if (s && e) for (let d = new Date(s + 'T12:00:00Z'); d <= new Date(e + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) time.push(d.toISOString().slice(0, 10));
  const n = time.length || 1; const fill = (v) => Array(n).fill(v);
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ daily: { time: time.length ? time : ['2026-01-01'], temperature_2m_max: fill(68), temperature_2m_min: fill(50), weather_code: fill(1), precipitation_probability_max: fill(10), precipitation_sum: fill(0) } }) });
}
let meteoCalls = 0;
async function open(browser, locale, width = 390, init) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, serviceWorkers: 'block' });
  await ctx.route(/open-meteo/, r => { meteoCalls++; return meteo(r); });
  await ctx.route(/overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru|functions\/v1/, r => r.abort());
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(); page._errors = []; page.on('pageerror', e => page._errors.push(String(e)));
  return { ctx, page };
}
const wx = (page) => page.evaluate(() => {
  const s = document.querySelector('#sec-weather'); if (!s) return null;
  const g = s.querySelector('.wx-units');
  return { temps: [...s.querySelectorAll('.wx-t')].map(e => e.textContent.trim()), pressed: g && [...g.querySelectorAll('[aria-pressed="true"]')].map(b => b.dataset.tunit),
    label: g && g.getAttribute('aria-label'), lang: document.documentElement.lang, want: (window.EP_I18N[document.documentElement.lang] || {})['Temperature unit'] || 'Temperature unit',
    folded: s.classList.contains('cx-col'), saved: localStorage.getItem('ep:tempUnit') };
});
const ready = (page) => page.waitForSelector('#sec-weather .wx-units', { timeout: 20000 });
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('#sec-weather, #sec-weather *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.className).slice(0, 3); });

(async () => {
  const browser = await chromium.launch();
  try {
    // US English guest: °F by default
    let { ctx, page } = await open(browser, 'en-US');
    await page.goto(BASE + '?demo=japan'); await ready(page);
    let w = await wx(page);
    ok(w.pressed.join() === 'F' && w.temps.length && w.temps.every(x => x === '68°50°F'), `en-US defaults to °F (${w.temps[0]})`);
    const packF = await page.evaluate(() => window.__ep && document.querySelector('#sec-packing') ? document.querySelector('#sec-packing').textContent : '');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/wx-units-390-F.png`, fullPage: false, clip: await page.$eval('#sec-weather', e => { e.scrollIntoView(); const r = e.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top), width: 390, height: Math.min(r.height, 600) }; }) });
    // flip to °C: converts in place, no refetch, saved, focus stays, section stays open
    const calls = meteoCalls;
    await page.focus('#sec-weather [data-tunit="C"]'); await page.keyboard.press('Enter');
    w = await wx(page);
    ok(w.pressed.join() === 'C' && w.temps.every(x => x === '20°10°C'), `°C converts every day (${w.temps[0]})`);
    ok(meteoCalls === calls, 'no refetch when switching');
    ok(w.saved === '"C"', 'choice saved in localStorage');
    ok(!w.folded, 'switch does not fold the Weather section');
    ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.tunit === 'C'), 'focus stays on the switch');
    const packC = await page.evaluate(() => document.querySelector('#sec-packing') ? document.querySelector('#sec-packing').textContent : '');
    ok(packF.length > 0 && packF === packC, 'packing hints do not change with the unit');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/wx-units-390-C.png`, clip: await page.$eval('#sec-weather', e => { e.scrollIntoView(); const r = e.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top), width: 390, height: Math.min(r.height, 600) }; }) });
    // saved choice wins over the US locale, on reload and on every other page
    await page.reload(); await ready(page); w = await wx(page);
    ok(w.pressed.join() === 'C' && w.temps[0] === '20°10°C', 'saved °C survives reload');
    await page.goto(BASE + '?demo=wedding'); await ready(page); w = await wx(page);
    ok(w.pressed.join() === 'C' && w.temps[0] === '20°10°C', 'saved °C applies on another page');
    await page.click('#sec-weather [data-tunit="F"]'); w = await wx(page);
    ok(w.pressed.join() === 'F' && w.temps[0] === '68°50°F' && w.saved === '"F"', 'back to °F');
    ok(!page._errors.length, 'no page errors ' + page._errors.join(' | '));
    await ctx.close();

    // locale defaults
    for (const [loc, want] of [['ja-JP', 'C'], ['es-ES', 'C'], ['fr-FR', 'C'], ['de-DE', 'C'], ['en-GB', 'C'], ['es-US', 'F'], ['en', 'F']]) {
      ({ ctx, page } = await open(browser, loc));
      await page.goto(BASE + '?demo=japan'); await ready(page); w = await wx(page);
      ok(w.pressed.join() === want && w.temps[0] === (want === 'C' ? '20°10°C' : '68°50°F'), `${loc} defaults to °${want}`);
      ok(w.label === w.want, `${loc}: aria-label in ${w.lang} ("${w.label}")`);
      await ctx.close();
    }
    // translated label for every guest language
    ({ ctx, page } = await open(browser, 'en-US'));
    await page.goto(BASE + '?demo=japan'); await ready(page);
    const langs = await page.evaluate(() => Object.keys(window.EP_I18N));
    ok(langs.length >= 6 && await page.evaluate(() => Object.values(window.EP_I18N).every(d => d['Temperature unit'] && d['Temperature unit'] !== 'Temperature unit')), `"Temperature unit" translated in ${langs.join(',')}`);
    await ctx.close();

    // phones: no overflow, switch sits beside the heading line
    for (const width of [320, 390]) {
      ({ ctx, page } = await open(browser, 'ja-JP', width));
      await page.goto(BASE + '?demo=japan'); await ready(page);
      const of = await overflow(page); ok(!of.length, `${width}px: no overflow ${of.join(',')}`);
      const box = await page.$eval('#sec-weather .wx-units', e => { const r = e.getBoundingClientRect(), s = e.closest('.ev-sec').getBoundingClientRect(); return { right: r.right, sr: s.right, h: r.height }; });
      ok(box.right <= box.sr && box.h >= 32, `${width}px: switch inside the section, tappable (${Math.round(box.h)}px)`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/wx-units-${width}-ja.png`, clip: await page.$eval('#sec-weather', (e, w) => { e.scrollIntoView(); const r = e.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top), width: w, height: Math.min(r.height, 600) }; }, width) });
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
