// A guest who switches the page to a language the host didn't publish gets the organizer's own text translated too
// (title, itinerary items and notes, sections, documents…), not just the interface: "Translating…" while ai-import
// mode translate runs (signed out: the public key), then the page re-renders; cached per page + language on the
// device (no second request). 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/translate-guest.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e))); const calls = [];
  await page.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru/, r => r.abort());
  await page.route('**/functions/v1/ai-import', async (r) => {
    if (r.request().method() !== 'POST') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"modes":["translate"]}' });
    const b = JSON.parse(r.request().postData()); calls.push({ auth: r.request().headers().authorization, b });
    await new Promise(res => setTimeout(res, 400));
    const tag = b.target.toUpperCase();
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'translate', data: { translations: Object.entries(b.fields).map(([key, v]) => ({ key, text: `[${tag}] ${v}` })) } }) });
  });
  await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '?lang=es#ex=japan-trip'); await page.waitForSelector('#sec-schedule');
  ok(await page.isVisible('.tr-note'), '"Translating…" while it runs');
  await page.waitForFunction(() => /\[ES\]/.test(document.querySelector('.ev-title').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/^\[ES\] /.test(await page.textContent('.ev-title')), `title translated: ${await page.textContent('.ev-title')}`);
  const items = await page.$$eval('#sec-schedule .tl b', bs => bs.map(b => b.textContent));
  ok(items.length && items.every(x => x.startsWith('[ES] ')), `itinerary items translated (${items[0]})`);
  ok(calls.length >= 1 && /sb_publishable_/.test(calls[0].auth) && calls[0].b.target === 'es' && 'schedule[0].note' in calls[0].b.fields, `asked once, signed out, with notes too (${calls.length})`);
  ok(!(await page.$('.tr-note')), 'note gone');
  const n = calls.length; await page.reload(); await page.waitForSelector('#sec-schedule'); await page.waitForTimeout(500);
  ok(calls.length === n && /^\[ES\] /.test(await page.textContent('.ev-title')) && !(await page.$('.tr-note')), 'cached: no second request');
  // switch to Japanese from the picker
  await page.selectOption('.lang-row select', 'ja'); await page.waitForFunction(() => /\[JA\]/.test(document.querySelector('.ev-title').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/^\[JA\] /.test(await page.textContent('.ev-title')), `Japanese: ${await page.textContent('.ev-title')}`);
  // back to the page's own language: as written, no request
  const m = calls.length; await page.selectOption('.lang-row select', 'en'); await page.waitForTimeout(400);
  ok(await page.textContent('.ev-title') === 'Japan in spring' && calls.length === m, 'English: as written');
  ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
