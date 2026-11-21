// Weddings: the room block (hotel, code, book-by date) also shows on the Event tab's Need to know, not only on
// Travel → Where to stay. When Travel has it, Need to know gets one compact row: "Room block · Hotel · Code X · Book
// by <date>" (dates formatted like the page's others), the row using the same plain link Travel already has (none
// when the organizer gave none). A book-by date that has passed says so plainly, on both tabs. No room block → no row.
// With Where to stay off, Need to know keeps the full Room block (one, not two). Guest strings translated.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/roomblock-know.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).length; });
const BLOCK = { blockHotel: 'Hotel Esencia', blockUrl: 'https://www.hotelesencia.com', blockCode: 'MAYALEO27', blockBy: '2027-01-15' };
const WED = (x, more = {}) => ({ v: 2, type: 'Wedding', title: 'Maya & Leo — Tulum', start: '2027-03-12', end: '2027-03-14', tz: 'America/Cancun',
  venue: { name: 'Hotel Esencia', address: '77734 Xpu Há, Quintana Roo, Mexico', lat: 20.48195, lon: -87.25616, city: 'Xpu Há', region: 'Quintana Roo', country: 'Mexico', cc: 'mx' },
  tools: { weather: false, travel: true, stay: true, nearby: false, tours: false, mytrip: true, packing: false, shopping: false }, off: {},
  schedule: [{ date: '2027-03-13', time: '16:30', title: 'Ceremony', note: '' }], x: { Wedding: { dress: 'Beach formal', ...x } }, ...more });

(async () => {
  const browser = await chromium.launch();
  const ctxs = {};
  const mk = async (w) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon|supabase|unsplash|fonts\.|hotellook|travelpayouts|wikipedia|wikimedia/, r => r.abort());
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    return { ctx, page };
  };
  const open = async (page, cfg, q = '') => {
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), cfg);
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + q + '#e=' + packed); await page.waitForSelector('.ev-hero');
  };
  const ev = (page, sel) => page.$(`.ev-panel[data-panel="event"] ${sel}`);
  const evText = (page) => page.textContent('.ev-panel[data-panel="event"] #sec-details').catch(() => '');
  const travel = async (page) => { await page.click('[data-tab-go="travel"]'); await page.waitForSelector('.ev-panel[data-panel="travel"]:not([hidden])'); return page.textContent('.ev-panel[data-panel="travel"]'); };
  try {
    for (const w of [390, 320]) {
      const { ctx, page } = await mk(w);
      // ---- 1. wedding with a room block and Where to stay on: a compact row on Need to know ----
      await open(page, WED(BLOCK));
      const row = await ev(page, '#sec-details ul.block-know');
      ok(!!row, `@${w} Event → Need to know has the room block row`);
      const rt = row ? (await row.textContent()).replace(/\s+/g, ' ') : '';
      ok(/Room block/.test(rt) && /Hotel Esencia/.test(rt) && /Code MAYALEO27/.test(rt) && /Book by \w+, Jan 15, 2027/.test(rt), `@${w} row: hotel, code, book-by date ${JSON.stringify(rt)}`);
      ok(!/passed/.test(rt), `@${w} future date: not marked passed`);
      const links = row ? await row.$$eval('a', as => as.map(a => a.href)) : [];
      ok(links.length === 1 && links[0] === 'https://www.hotelesencia.com/', `@${w} the row's only link is the organizer's own plain link ${JSON.stringify(links)}`);
      ok((await page.$$('.ev-panel[data-panel="event"] #sec-details h3.sub-h')).length === 0 || !/Room block/.test(await page.$$eval('.ev-panel[data-panel="event"] #sec-details h3.sub-h', hs => hs.map(h => h.textContent).join('|'))), `@${w} compact: no separate Room block heading on Need to know`);
      ok(await overflow(page) === 0, `@${w} no overflow (Event)`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/roomblock-know-${w}.png`, fullPage: true });
      let tt = await travel(page);
      ok(!!(await page.$('.ev-panel[data-panel="travel"] .block-row')) && /MAYALEO27/.test(tt) && /Book by Jan 15/.test(tt), `@${w} Travel → Where to stay still has the room block`);
      ok(await overflow(page) === 0, `@${w} no overflow (Travel)`);
      // ---- 2. book-by date passed: said plainly on both tabs ----
      await open(page, WED({ ...BLOCK, blockBy: '2025-01-15' }));
      let t = (await evText(page)).replace(/\s+/g, ' ');
      ok(/The book-by date \(\w+, Jan 15, 2025\) has passed/.test(t) && !/Book by \w+, Jan 15/.test(t), `@${w} passed date said plainly on Need to know`);
      tt = await travel(page);
      ok(/The book-by date \(Jan 15\) has passed/.test(tt), `@${w} passed date said plainly on Travel`);
      // ---- 3. no link given: a note row, no link ----
      await open(page, WED({ blockHotel: 'Hotel Esencia', blockCode: 'MAYALEO27' }));
      const r3 = await ev(page, '#sec-details ul.block-know');
      ok(!!r3 && (await r3.$$('a')).length === 0 && /Hotel Esencia · Code MAYALEO27/.test(await r3.textContent()), `@${w} no booking link: note row with hotel + code, no link`);
      // ---- 4. no room block → no row ----
      await open(page, WED({}));
      t = await evText(page);
      ok(!(await ev(page, '.block-know')) && !/Room block/.test(t) && /Beach formal/.test(t), `@${w} no room block: no row (Need to know still shows the dress code)`);
      // ---- 5. Where to stay off: the full block stays on Need to know, once ----
      await open(page, WED(BLOCK, { tools: { weather: false, travel: true, stay: false, nearby: false, tours: false, mytrip: true, packing: false, shopping: false } }));
      t = (await evText(page)).replace(/\s+/g, ' ');
      ok(!(await ev(page, '.block-know')) && (t.match(/MAYALEO27/g) || []).length === 1 && /Room block/.test(t) && /Book by \w+, Jan 15, 2027/.test(t), `@${w} Where to stay off: one full Room block on Need to know`);
      // ---- 6. Need to know hidden → nothing ----
      await open(page, WED(BLOCK, { off: { details: true } }));
      ok(!(await page.$('.block-know')) && !/MAYALEO27/.test(await page.textContent('.ev-panel[data-panel="event"]')), `@${w} Need to know off: no row`);
      // ---- 7. a guest reading in Spanish ----
      await open(page, WED(BLOCK, { langs: ['es'] }), '?lang=es');
      t = ((await (await ev(page, '#sec-details ul.block-know'))?.textContent()) || '').replace(/\s+/g, ' ');
      ok(/Bloque de habitaciones/.test(t) && /Código MAYALEO27/.test(t) && /Reserva antes del/.test(t) && /2027/.test(t), `@${w} es: ${JSON.stringify(t)}`);
      await open(page, WED({ ...BLOCK, blockBy: '2025-01-15' }, { langs: ['es'] }), '?lang=es');
      t = ((await (await ev(page, '#sec-details ul.block-know'))?.textContent()) || '').replace(/\s+/g, ' ');
      ok(/La fecha límite para reservar \(.*2025.*\) ya pasó/.test(t), `@${w} es passed: ${JSON.stringify(t)}`);
      ok(await overflow(page) === 0, `@${w} no overflow (es)`);
      await open(page, WED({ ...BLOCK, blockBy: '2025-01-15' }, { langs: ['ja'] }), '?lang=ja');
      t = ((await (await ev(page, '#sec-details ul.block-know'))?.textContent()) || '');
      ok(/団体枠/.test(t) && /予約期限（.*）を過ぎています/.test(t), `@${w} ja passed: ${JSON.stringify(t)}`);
      ok(page._err.length === 0, `@${w} no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
  } catch (e) { ok(false, 'threw: ' + (e && e.stack || e)); }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
