// Groups: one shared page, each guest's own version. The organizer adds Stay options (arrive/leave + hotel) and turns
// sections on/off in Builder → Sections; a guest taps one option (or "Make it mine" → own dates + hotel) and the page
// fits around them: "Your stay" under the ticket, shared days outside their stay dimmed, their hotel in My trip and in
// place of the room block. Kept on this device per page (synced with My trip when signed in); 390 + 320, no overflow.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/groups.js
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
const WED = { v: 2, type: 'Wedding', title: 'Ana & Leo', start: '2027-06-05T16:00', end: '2027-06-05T23:00', tz: 'America/Cancun',
  venue: { name: 'Playa Paraíso', address: 'Tulum', lat: 20.20404, lon: -87.43127, city: 'Tulum', country: 'Mexico', cc: 'mx' },
  x: { Wedding: { blockHotel: 'Hotel Esencia', blockCode: 'ANALEO', blockBy: '2027-04-01' } },
  schedule: [{ date: '2027-06-03', time: '19:00', title: 'Welcome dinner', note: '' }, { date: '2027-06-05', time: '16:00', title: 'Ceremony', note: '' }, { date: '2027-06-06', time: '11:00', title: 'Farewell brunch', note: '' }],
  presets: [{ id: 'thu', a: '2027-06-03', l: '2027-06-06', h: { name: 'Hotel Esencia' } }, { id: 'fri', a: '2027-06-04', l: '2027-06-06', h: { name: 'Casa Malca' } }],
  tools: { weather: false, travel: true, stay: true, nearby: false, tours: false, mytrip: true, packing: false, shopping: false } };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
const ROUTE = /open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru|supabase\.co/;

(async () => {
  const browser = require('./_open-settings')(await chromium.launch());
  const mk = async (w) => { const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e))); await page.route(ROUTE, r => r.abort()); return { ctx, page }; };

  // ---- organizer: Stay options + Sections on/off ----
  {
    const { ctx, page } = await mk(390);
    await page.goto(BASE + '#edit-ex=tulum-wedding'); await page.waitForSelector('.b-form [data-acc="sections"]');
    await page.evaluate(() => { document.querySelector('[data-acc="sections"]').open = true; });
    const secs = await page.$$eval('[data-acc="sections"] .order [data-sec-on]', is => is.map(i => [i.dataset.secOn, i.checked]));
    ok(secs[0][0] === 'mine' && secs[0][1] && secs.length >= 8, `Sections: Make it mine first, on for a wedding (${secs.map(x => x.join(':')).join(' ')})`);
    const tools = await page.$$eval('[data-acc="sections"] [data-tool]', is => is.map(i => i.dataset.tool));
    ok(tools.includes('travel') && tools.includes('stay') && tools.includes('mytrip') && !tools.includes('weather'), `Sections: every tab has a switch (${tools.join(',')})`);
    ok(!(await page.$('.b-form > .tools')), 'no separate "Automatic for guests" list');
    // turn off About and Nearby
    await page.click('[data-acc="sections"] label:has([data-sec-on="about"])'); await page.waitForTimeout(500);
    await page.click('[data-acc="sections"] label:has([data-tool="nearby"])'); await page.waitForTimeout(300);
    await page.click('[data-acc="sections"] label:has([data-tool="tours"])'); await page.waitForTimeout(500);
    let cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
    ok(cfg.off.about === true && cfg.tools.nearby === false && cfg.tools.tours === false, 'switches write cfg.off.about / cfg.tools.nearby / cfg.tools.tours');
    ok(await page.$('[data-acc="sections"]').then(d => d.evaluate(x => x.open)), 'Sections stays open after a switch');
    const pv = await page.evaluate(() => ({ about: !!document.querySelector('#preview #sec-about'), near: !!document.querySelector('#preview [data-tab-go="nearby"]') }));
    ok(!pv.about && !pv.near, `preview drops them: ${JSON.stringify(pv)}`);
    if (SHOTS) await page.locator('[data-acc="sections"]').screenshot({ path: `${SHOTS}/groups-sections-390.png` });
    ok((await overflow(page)).length === 0, `builder @390: no overflow ${(await overflow(page)).join(' ')}`);
    // Stay options card: two options
    await page.click('[data-card="stays"]'); await page.waitForSelector('#sheet [data-b="add-preset"]');
    await page.click('#sheet [data-b="add-preset"]'); await page.waitForSelector('#sheet [data-pr="0"][data-k="a"]');
    await page.fill('#sheet [data-pr="0"][data-k="a"]', '2027-03-11'); await page.fill('#sheet [data-pr="0"][data-k="l"]', '2027-03-15');
    await page.fill('#sheet [data-pr="0"][data-k="h"]', 'Papaya Playa Project');
    await page.click('#sheet [data-b="add-preset"]'); await page.waitForSelector('#sheet [data-pr="1"][data-k="a"]');
    const pre1 = await page.$eval('#sheet [data-pr="1"][data-k="h"]', i => i.value);
    ok(pre1 === 'Papaya Playa Project', `a new option starts from the last one's hotel (${pre1})`);
    await page.fill('#sheet [data-pr="1"][data-k="a"]', '2027-03-12'); await page.fill('#sheet [data-pr="1"][data-k="l"]', '2027-03-14'); await page.fill('#sheet [data-pr="1"][data-k="h"]', 'Casa Malca');
    if (SHOTS) await page.locator('#sheet').screenshot({ path: `${SHOTS}/groups-presets-sheet-390.png` });
    ok((await overflow(page)).length === 0, `stay options sheet @390: no overflow ${(await overflow(page)).join(' ')}`);
    await page.click('#sheet .btn.primary.big'); await page.waitForTimeout(500);
    ok(await page.$eval('[data-card="stays"] .plus', e => e.textContent) === '✓', 'Stay options card shows done');
    cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
    ok(cfg.presets.length === 2 && cfg.presets[0].a === '2027-03-11' && cfg.presets[0].h.name === 'Papaya Playa Project' && cfg.presets[1].h.name === 'Casa Malca', `saved in the page: ${JSON.stringify(cfg.presets)}`);
    const pvOpts = await page.$$eval('#preview .mi-opt b', bs => bs.map(b => b.textContent));
    ok(pvOpts.length === 2 && /Mar 11/.test(pvOpts[0]), `preview shows the options under the ticket (${pvOpts.join(' | ')})`);
    await page.click('.b-set-h [data-act="settings"]'); await page.waitForSelector('#preview .mi-opt'); await page.waitForTimeout(500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/groups-builder-preview-390.png` });
    await page.click('#preview .mi-opt'); await page.waitForSelector('#sheet[open] [data-b="add-preset"]');
    ok(true, 'tapping the options in the preview opens Stay options');
    await page.click('#sheet .btn.primary.big');
    ok(!page._err.length, `builder: no page errors ${page._err.join(' ')}`);
    await ctx.close();
  }

  // ---- guest: one tap on an option; then their own dates and hotel ----
  for (const w of [390, 320]) {
    const { ctx, page } = await mk(w);
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), WED);
    await page.goto(BASE + '#e=' + packed); await page.waitForSelector('.mi-bar'); await page.waitForTimeout(300);
    const opts = await page.$$eval('.mi-opt', bs => bs.map(b => b.textContent));
    ok(opts.length === 2 && /Thu, Jun 3.*Sun, Jun 6.*Hotel Esencia/.test(opts[0]) && /Casa Malca/.test(opts[1]), `@${w} two stay options under the ticket: ${opts.join(' | ')}`);
    ok(!!(await page.$('.mi-bar [data-mine-edit]')), `@${w} plus "Other dates or hotel"`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/groups-guest-options-${w}.png` });
    ok((await overflow(page)).length === 0, `@${w} no overflow (options) ${(await overflow(page)).join(' ')}`);
    // one tap: Fri–Sun at Casa Malca
    await page.click('.mi-opt[data-mine-pick="fri"]'); await page.waitForSelector('.mi-bar.is-set');
    const sum = await page.$eval('.mi-sum', b => b.textContent);
    ok(/Fri, Jun 4/.test(sum) && /Sun, Jun 6/.test(sum) && /Casa Malca/.test(sum), `@${w} one tap → Your stay: ${sum}`);
    const days = await page.$$eval('#sec-schedule .day', ds => ds.map(d => [d.querySelector('.day-h').textContent.trim(), d.classList.contains('d-out')]));
    ok(days.length >= 3 && days.find(d => /Jun 3/.test(d[0]))[1] === true && days.find(d => /Jun 5/.test(d[0]))[1] === false, `@${w} Thursday (before they arrive) is dimmed: ${JSON.stringify(days)}`);
    const yours = await page.$$eval('#sec-schedule li.mine', ls => ls.map(l => l.textContent));
    ok(yours.some(x => /Casa Malca/.test(x)), `@${w} their hotel is in the itinerary (${yours.join(' | ')})`);
    const know = await page.$eval('#sec-details', s => s.textContent);
    ok(/Your hotel/.test(know) && /Casa Malca/.test(know) && !/ANALEO/.test(know), `@${w} Need to know: their hotel in place of the room block`);
    const itin = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k)), keyOf(WED));
    ok(itin.length === 1 && itin[0].kind === 'hotel' && itin[0].name === 'Casa Malca' && itin[0].start === '2027-06-04' && itin[0].end === '2027-06-06', `@${w} one hotel booking in My trip: ${JSON.stringify(itin)}`);
    const arrive = await page.$eval('.tripbar [data-k="arrive"]', i => i.value).catch(() => '');
    ok(!arrive || arrive === '2027-06-04', `@${w} Travel searches use their dates (${arrive})`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/groups-guest-picked-${w}.png`, fullPage: true });
    // reload: kept
    await page.reload(); await page.waitForSelector('.mi-bar.is-set');
    ok(/Casa Malca/.test(await page.$eval('.mi-sum', b => b.textContent)), `@${w} kept after reload`);
    // edit: own dates, room block hotel
    await page.click('.mi-sum'); await page.waitForSelector('.mi-bar.is-ed');
    await page.fill('#mi-a', '2027-06-05'); await page.fill('#mi-l', '2027-06-07');
    await page.click('.mi-hs .chip:has-text("Hotel Esencia")');
    ok(await page.$eval('.mi-hs .chip:has-text("Hotel Esencia")', b => b.classList.contains('on')), `@${w} tap a hotel chip selects it`);
    if (SHOTS) await page.locator('.mi-bar').screenshot({ path: `${SHOTS}/groups-guest-edit-${w}.png` });
    ok((await overflow(page)).length === 0, `@${w} no overflow (editor) ${(await overflow(page)).join(' ')}`);
    await page.click('[data-mine-save]'); await page.waitForSelector('.mi-bar.is-set');
    const sum2 = await page.$eval('.mi-sum', b => b.textContent);
    ok(/Sat, Jun 5/.test(sum2) && /Mon, Jun 7/.test(sum2) && /Hotel Esencia/.test(sum2), `@${w} custom dates + hotel: ${sum2}`);
    const know2 = await page.$eval('#sec-details', s => s.textContent);
    ok(/ANALEO/.test(know2) && !/Your hotel/.test(know2), `@${w} staying at the room block hotel: the room block line is back`);
    const itin2 = await page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k)), keyOf(WED));
    ok(itin2.length === 1 && itin2[0].name === 'Hotel Esencia' && itin2[0].start === '2027-06-05', `@${w} still one hotel booking, replaced: ${JSON.stringify(itin2.map(x => x.name + ' ' + x.start))}`);
    // a typed hotel
    await page.click('.mi-sum'); await page.waitForSelector('#mi-hq'); await page.fill('#mi-hq', 'Airbnb in town'); await page.click('[data-mine-save]'); await page.waitForSelector('.mi-bar.is-set');
    ok(/Airbnb in town/.test(await page.$eval('.mi-sum', b => b.textContent)), `@${w} any hotel can be typed`);
    // clear: back to the shared page
    await page.click('.mi-sum'); await page.click('[data-mine-clear]'); await page.waitForSelector('.mi-opt');
    const after = await page.evaluate((k) => ({ itin: JSON.parse(localStorage.getItem('ep:itin:' + k) || '[]'), mine: localStorage.getItem('ep:mine:' + k), out: document.querySelectorAll('.day.d-out').length }), keyOf(WED));
    ok(!after.itin.length && !after.mine && !after.out, `@${w} Clear removes their version: ${JSON.stringify(after)}`);
    ok(!page._err.length, `@${w} no page errors ${page._err.join(' ')}`);
    await ctx.close();
  }

  // ---- back-compat + switches ----
  {
    const { ctx, page } = await mk(390);
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    const open = async (c) => { await page.evaluate(() => localStorage.clear()); const p = await page.evaluate((x) => window.__ep.packEvent(x), c); await page.goto(BASE + '#e=' + p); await page.waitForSelector('.ev-body'); await page.waitForTimeout(200); };
    const { presets, ...plain } = WED;
    await open(plain);
    const bar = await page.$$eval('.mi-bar button', bs => bs.map(b => b.textContent.trim()));
    ok(bar.length === 1 && bar[0] === 'Make it mine', `no options: one "Make it mine" button (${bar.join('|')})`);
    await page.click('.mi-go'); await page.waitForSelector('#mi-a');
    const dflt = await page.evaluate(() => [document.querySelector('#mi-a').value, document.querySelector('#mi-l').value]);
    ok(dflt[0] === '2027-06-04' && dflt[1] === '2027-06-06', `editor starts on the day before → day after (${dflt})`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/groups-guest-make-it-mine-390.png` });
    await open({ ...WED, off: { details: true } });
    ok(!(await page.$('#sec-details')), 'a section switched off is gone for guests');
    await page.click('#sec-schedule .sec-h'); await page.waitForTimeout(200);
    ok(!(await page.$eval('#sec-schedule .sec-b', b => b.checkVisibility())) && !!(await page.$('.mi-bar')), 'the sections left still fold on a title tap; Make it mine stays');
    await open({ ...WED, off: { mine: true } });
    ok(!(await page.$('.mi-bar')), 'organizer switched it off: no bar');
    await open({ ...plain, type: 'Trip', x: {} });
    ok(!(await page.$('.mi-bar')), 'a personal trip without options: no bar (until switched on)');
    await open({ ...WED, type: 'Trip', x: {} });
    ok(!!(await page.$('.mi-opt')), 'a group trip with options: options show');
    // normalize keeps only sane options
    const n = await page.evaluate(() => window.__ep.normalize({ v: 2, type: 'Wedding', presets: [{ a: 'x', l: '2027-01-02', h: { name: '  ' } }, 5, { id: 'ok', a: '2027-01-01', l: '2027-01-03', h: { name: 'H', lat: 'no' } }] }).presets);
    ok(n.length === 2 && n[1].id === 'ok' && n[1].h.name === 'H' && n[1].h.lat === undefined && n[0].a === '' && !n[0].h, `normalize: ${JSON.stringify(n)}`);
    ok(!page._err.length, `no page errors ${page._err.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
