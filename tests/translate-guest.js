// A guest who switches the page to a language the host didn't publish gets the organizer's own text translated too
// (title, description, itinerary items and their notes, Need-to-know notes, custom sections…), not just the interface.
//  1. A real page (share link, English): "Translating…" while ai-import mode translate runs (signed out: the public
//     key), then the page re-renders; cached per page + language on the device (no second request); picker → Japanese
//     translates again; back to English shows it as written with no request.
//  2. Example pages ship pre-translated (examples-tr.js): ?demo=japan in Spanish/Japanese shows the host's text
//     translated with no AI request at all.
// 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/translate-guest.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const CFG = { title: 'Weekend at the lake', start: '2027-07-10', end: '2027-07-12', venue: { name: 'Lake Tahoe' },
  description: 'Join us for a relaxed weekend by the water with friends and family.',
  schedule: [{ date: '2027-07-10', time: '15:00', title: 'Check in and welcome drinks', note: 'Meet on the back deck after you drop your bags.' },
    { date: '2027-07-11', time: '09:00', title: 'Morning hike to the waterfall', note: 'About two hours round trip; wear hiking boots.' }],
  notes: [{ label: 'Parking', text: 'Park on the gravel lot behind the house, not on the street.' }],
  custom: [{ title: 'House rules', text: 'Please take your shoes off inside and keep the noise down after ten at night.' }] };
const BODY = [CFG.description, CFG.schedule[0].note, CFG.schedule[1].note, CFG.notes[0].label, CFG.notes[0].text, CFG.custom[0].title, CFG.custom[0].text];
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
  const packed = await page.evaluate((c) => window.__ep.packEvent(c), CFG);
  const text = () => page.$eval('#ev-root', e => e.textContent);
  const allTagged = async (tag) => { const t0 = await text(); return BODY.filter(s => !t0.includes(`[${tag}] ${s}`)); };

  // 1. a real page, on demand
  await page.goto(BASE + '?lang=es#e=' + packed); await page.waitForSelector('#sec-schedule');
  ok(await page.isVisible('.tr-note'), '"Translating…" while it runs');
  await page.waitForFunction(() => /\[ES\]/.test(document.querySelector('.ev-title').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/^\[ES\] /.test(await page.textContent('.ev-title')), `title translated: ${await page.textContent('.ev-title')}`);
  const items = await page.$$eval('#sec-schedule .tl b', bs => bs.map(b => b.textContent));
  ok(items.length === 2 && items.every(x => x.startsWith('[ES] ')), `itinerary items translated (${items[0]})`);
  const miss = await allTagged('ES');
  ok(!miss.length, `body text translated: description, item notes, notes, custom section${miss.length ? ' — missing: ' + miss.join(' | ') : ''}`);
  const f = (calls[0] && calls[0].b.fields) || {};
  ok(calls.length === 1 && /sb_publishable_/.test(calls[0].auth) && calls[0].b.target === 'es' && calls[0].b.source === 'en'
    && ['description', 'schedule[0].note', 'notes[0].text', 'custom[0].text'].every(k => k in f), `asked once, signed out, with every text field (${calls.length})`);
  ok(!(await page.$('.tr-note')), 'note gone');
  const n = calls.length; await page.reload(); await page.waitForSelector('#sec-schedule'); await page.waitForTimeout(500);
  ok(calls.length === n && /^\[ES\] /.test(await page.textContent('.ev-title')) && !(await page.$('.tr-note')) && !(await allTagged('ES')).length, 'cached: no second request');
  // switch to Japanese from the picker
  await page.selectOption('.vbar [data-lang]', 'ja'); await page.waitForFunction(() => /\[JA\]/.test(document.querySelector('.ev-title').textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/^\[JA\] /.test(await page.textContent('.ev-title')) && !(await allTagged('JA')).length && calls.length === n + 1 && calls[n].b.target === 'ja', `Japanese: ${await page.textContent('.ev-title')}`);
  // back to the page's own language: as written, no request
  const m = calls.length; await page.selectOption('.vbar [data-lang]', 'en'); await page.waitForTimeout(400);
  ok(await page.textContent('.ev-title') === CFG.title && (await text()).includes(CFG.custom[0].text) && !/\[(ES|JA)\]/.test(await text()) && calls.length === m, 'English: as written');

  // 2. examples ship pre-translated: no AI call
  await page.evaluate(() => localStorage.clear()); const c0 = calls.length;
  for (const lang of ['es', 'ja']) {
    await page.goto('about:blank'); await page.goto(BASE + `?demo=japan&lang=${lang}`); await page.waitForSelector('#sec-schedule'); await page.waitForTimeout(600);
    const exp = await page.evaluate((l) => { const src = window.EXAMPLES['japan-trip'], tr = window.EXAMPLES_TR['japan-trip'][l];
      return { title: tr.title.t, en: src.schedule.map(x => x.title), tr: src.schedule.map((x, i) => tr[`schedule[${i}].title`] && tr[`schedule[${i}].title`].t) }; }, lang);
    ok(await page.textContent('.ev-title') === exp.title, `example ${lang}: title ${exp.title}`);
    const host = await page.$$eval('#sec-schedule .tl li:not(.mine) b', bs => bs.map(b => b.textContent.trim()));
    // every item is its shipped translation (a name like 'teamLab Planets' may stay the same), and nearly all read differently
    const same = host.filter(x => exp.en.includes(x));
    ok(host.length >= 5 && host.every(x => exp.tr.includes(x)) && same.length <= 2, `example ${lang}: itinerary items translated (${host.length}: ${host[1]}; unchanged: ${same.join(', ') || 'none'})`);
  }
  ok(calls.length === c0 && !(await page.$('.tr-note')), 'examples: no AI request');
  ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
