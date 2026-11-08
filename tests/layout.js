// Phone layout regression: no horizontal overflow, and the hero / viewer bar / ticket stub span the same width
// as the sections below, at common phone widths and after the viewport changes (rotation, zoom, resize).
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/layout.js
//   BASE=https://bbbot0209.github.io/eventpages/ node tests/layout.js
//   SHOTS=/tmp/ep-shots node tests/layout.js      # also saves a screenshot per case
//
// Needs Playwright (npm i playwright && npx playwright install chromium). Exit code 1 on any failure.
const { chromium } = require(process.env.PW || 'playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const WIDTHS = [320, 375, 390, 440];

async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement, cw = de.clientWidth, R = (s) => { const e = document.querySelector(s); return e && e.getBoundingClientRect(); };
    // anything poking past the right edge that isn't inside its own scroller (e.g. the weather strip scrolls by design)
    const off = [...document.querySelectorAll('body *')].filter(e => {
      if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return false;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false;
      const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1;
    }).slice(0, 5).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.'));
    const vis = (r) => r && r.width ? r : null; // tabs other than the event tab hide the hero
    const hero = vis(R('.ev-hero')), body = vis(R('.ev-body')), stub = R('.stub'), vbar = R('.vbar');
    const secs = [...document.querySelectorAll('.ev-body > *')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect());
    return { sw: de.scrollWidth, cw, off, hero: hero && hero.width, body: body && body.width,
      stubRight: stub && stub.right, vbarRight: vbar && vbar.right, secMax: secs.length ? Math.max(...secs.map(r => r.right)) : null };
  });
}

function check(m, label, fails) {
  const bad = [];
  if (m.sw > m.cw) bad.push(`scrollWidth ${m.sw} > clientWidth ${m.cw} (${m.off.join(', ')})`);
  // on phones the hero and the section column are both the full screen width (the column caps at 760px on wide screens)
  if (m.hero != null && m.body != null && m.cw <= 760 && Math.abs(m.hero - m.body) > 1) bad.push(`hero ${m.hero} != body ${m.body}`);
  if (m.hero != null && Math.abs(m.hero - m.cw) > 1) bad.push(`hero ${m.hero} != viewport ${m.cw}`);
  if (m.secMax != null && m.secMax > m.cw + 1) bad.push(`section right ${m.secMax} > ${m.cw}`);
  if (m.stubRight != null && m.stubRight > m.cw + 1) bad.push(`stub right ${m.stubRight} > ${m.cw}`);
  if (m.vbarRight != null && m.vbarRight > m.cw + 1) bad.push(`viewer bar right ${m.vbarRight} > ${m.cw}`);
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${label}  sw=${m.sw} cw=${m.cw}${bad.length ? '  ' + bad.join('; ') : ''}`);
  if (bad.length) fails.push(label);
}

(async () => {
  const browser = await chromium.launch();
  const fails = [];
  const ctxFor = (w) => browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  // a non-demo page: packed event in the hash, built from an example with the app's own packer
  const probe = await (await ctxFor(440)).newPage();
  await probe.goto(BASE); await probe.waitForFunction(() => window.__ep && window.EXAMPLES);
  const demos = await probe.evaluate(() => Object.keys(window.__ep.DEMOS));
  const packed = await probe.evaluate(() => { const k = Object.keys(window.EXAMPLES)[0]; return window.__ep.packEvent(window.EXAMPLES[k]); });
  await probe.context().close();
  const pages = [...demos.map(d => [`demo=${d}`, `?demo=${d}`]), ['demo=japan travel', '?demo=japan#t=travel'], ['demo=japan nearby', '?demo=japan#t=nearby'],
    ['packed', `#e=${packed}`], ['editor', `#edit=${packed}`], ['landing', '']];

  for (const [name, path] of pages) for (const w of WIDTHS) {
    const ctx = await ctxFor(w); const page = await ctx.newPage();
    await page.goto(BASE + path); await page.waitForTimeout(1800);
    check(await measure(page), `${name} @${w}`, fails);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name.replace(/\W+/g, '-')}-${w}.png` });
    await ctx.close();
  }

  // after load: resize (rotation / split view), then CDP page zoom, then back, on the page from the bug report
  const ctx = await ctxFor(440); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await page.goto(BASE + '?demo=japan'); await page.waitForTimeout(1800);
  for (const [w, h] of [[375, 812], [956, 440], [390, 844], [440, 956]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400);
    check(await measure(page), `japan resized to ${w}x${h}`, fails);
  }
  for (const s of [0.5, 2, 1]) {
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: s }); await page.waitForTimeout(300);
    check(await measure(page), `japan page scale ${s}`, fails);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }); await page.waitForTimeout(400);
  check(await measure(page), 'japan device metrics 390', fails);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/japan-after-resize.png` });
  await ctx.close();
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failing` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
