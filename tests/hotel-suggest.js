// Invite link vs Share my trip: whose hotel is it? (Dylan 11/25: "When you do invite guests, it shows the hotels as selected
// already, but not in the itinerary … I thought it only shows as a suggested hotel, not already selected.")
//  1. Invite link (?e=<slug>), any type: the organizer's hotels are suggestions — labeled Suggested with one tap Choose;
//     nothing pre-selected (Nearby's Your hotel, map pins, My trip, Between stops, the plan's check-in rows).
//  2. Choose (Nearby list, the check-in row's sheet) → an ordinary hotel booking: in My trip, the plan's row says Yours,
//     the map pin is Your hotel, Between stops leaves from it.
//  3. Wedding (non-Trip): the organizer's own hotel never shows to guests at all (type rule), so nothing is selected.
//  4. Share my trip (?e=&s=) from the organizer of a Trip: their hotels arrive pre-selected AND in the recipient's itinerary.
//  5. The organizer's own page is unchanged (their hotels are theirs).
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/hotel-suggest.js     (SHOTS=<dir> for screenshots)
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TOKYO = { name: 'Tokyo', lat: 35.6812, lon: 139.7671, city: 'Tokyo', country: 'Japan', cc: 'jp' };
const KYOTO = { name: 'Kyoto', lat: 35.0116, lon: 135.7681, city: 'Kyoto', country: 'Japan', cc: 'jp' };
const TOOLS = { weather: false, travel: true, stay: true, nearby: true, tours: false, mytrip: true, packing: false, shopping: false };
const TRIP = { v: 2, type: 'Trip', title: 'Japan suggest test', start: '2027-04-01', end: '2027-04-07', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo Station', address: 'Marunouchi, Tokyo', lat: 35.6812, lon: 139.7671, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [{ ...TOKYO, from: '2027-04-01', to: '2027-04-04' }, { ...KYOTO, from: '2027-04-04', to: '2027-04-07' }], tools: TOOLS,
  schedule: [{ date: '2027-04-01', time: '15:00', title: 'Check in: Park Hyatt Tokyo', note: '' }, { date: '2027-04-02', time: '10:00', title: 'Senso-ji', note: '' },
    { date: '2027-04-04', time: '15:00', title: 'Check in: Ace Hotel Kyoto', note: '' }, { date: '2027-04-07', time: '11:00', title: 'Check out: Ace Hotel Kyoto', note: '' }] };
const WED = { v: 2, type: 'Wedding', title: 'Ana and Leo suggest', start: '2027-03-12', end: '2027-03-14', tz: 'America/Cancun',
  venue: { name: 'Hotel Esencia', address: 'Xpu-Ha, Quintana Roo', lat: 20.47, lon: -87.26, city: 'Xpu-Ha', country: 'Mexico', cc: 'mx' }, tools: TOOLS,
  schedule: [{ date: '2027-03-12', time: '19:00', title: 'Welcome drinks', note: '' }, { date: '2027-03-13', time: '16:00', title: 'Ceremony', note: '' },
    { date: '2027-03-11', time: '', title: 'Check in: Grand Hyatt Playa', note: 'Our room' }] };
const GEO = { 'park hyatt tokyo': { lat: 35.6856, lon: 139.6907, addr: 'Shinjuku, Tokyo' }, 'ace hotel kyoto': { lat: 35.0081, lon: 135.7593, addr: 'Nakagyo, Kyoto' }, 'grand hyatt playa': { lat: 20.63, lon: -87.07, addr: 'Playa del Carmen' } };

(async () => {
  const browser = await chromium.launch();
  const mk = async (state) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript((geo) => { if (!localStorage.getItem('ep:hgeo:park hyatt tokyo')) Object.entries(geo).forEach(([k, v]) => localStorage.setItem('ep:hgeo:' + k, JSON.stringify(v))); }, GEO);
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon|functions\/v1|auth\/v1/, r => r.abort());
    await ctx.route(/\/rest\/v1\//, async r => { const u = r.request().url();
      if (/\/events\?/.test(u)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(state.event ? [state.event] : []) });
      if (/rpc\/trip_share_get/.test(u)) { const tok = JSON.parse(r.request().postData() || '{}').tok; return r.fulfill({ contentType: 'application/json', body: JSON.stringify(state.share && state.share.token === tok ? [state.share] : []) }); }
      return r.fulfill({ contentType: 'application/json', body: '[]' }); });
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.AIRPORTS);
    return { ctx, page };
  };
  const norm = (page, c) => page.evaluate((c) => window.__ep.normalize(JSON.parse(JSON.stringify(c))), c);
  const keyOf = (page, c) => page.evaluate((c) => window.__ep.syncKey(c), c);
  const itin = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k) || '[]'), k);
  const rows = (page) => page.evaluate(() => { document.querySelectorAll('.day:not(.open) [data-day-tog]').forEach(b => b.click()); return [...document.querySelectorAll('[data-panel="event"] .tl li')].map(l => l.textContent.replace(/\s+/g, ' ').trim()); });
  const tab = async (page, k) => { await page.click(`[data-tab-go="${k}"][role="tab"]`); await page.waitForTimeout(600); };
  const txt = (page, sel) => page.$eval(sel, e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
  const pins = (page) => page.evaluate(() => ({ own: document.querySelectorAll('.hpin:not(.sug)').length, sug: document.querySelectorAll('.hpin.sug').length }));
  const between = (page) => page.$$eval('[data-slot="trains"] a[href*="maps/dir"]', as => as.map(a => decodeURIComponent(a.href)).join(' || '));
  const mytripHotels = (page) => page.$eval('#sec-itinerary', e => e.textContent.replace(/\s+/g, ' ')).catch(() => '');
  const host = (cfg, slug) => ({ id: 'e0000000-0000-4000-8000-0000000000' + (slug.length % 90 + 10), slug, config: cfg, updated_at: new Date().toISOString(), published: true });

  // ---------- 1+2. Trip, invite link: suggestions only; Choose makes it theirs everywhere ----------
  {
    const state = {}; const { ctx, page } = await mk(state);
    const cfg = await norm(page, TRIP); const K = await keyOf(page, cfg); state.event = host(cfg, 'japan-suggest-x1');
    await page.goto(BASE + '?e=japan-suggest-x1'); await page.waitForSelector('.ev'); await page.waitForTimeout(400);
    let rs = (await rows(page)).filter(r => /Check in/.test(r));
    ok(rs.length === 2 && rs.every(r => /Suggested/.test(r) && !/Yours/.test(r)), `plan's check-in rows read Suggested: ${rs.join(' | ')}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sug-trip-event.png`, fullPage: true });
    await tab(page, 'nearby'); await page.waitForSelector('[data-slot="hotel"] .hb-box'); await page.waitForTimeout(600);
    let bar = await txt(page, '[data-slot="hotel"]');
    ok(/No hotel yet/.test(bar) && /Suggested/.test(bar) && /Park Hyatt Tokyo/.test(bar) && !/From the itinerary/.test(bar), `Nearby: no hotel yet + Park Hyatt suggested: ${bar}`);
    ok(await page.$('[data-slot="hotel"] .hb-sugs [data-hs-set]') && (await txt(page, '[data-slot="hotel"] .hb-sugs [data-hs-set]')) === 'Choose', 'Nearby: one tap Choose on the suggestion');
    let pn = await pins(page); ok(pn.own === 0 && pn.sug >= 1, `map: suggested pin only, no Your hotel pin ${JSON.stringify(pn)}`);
    ok(!/Your hotel/.test(await txt(page, '[data-slot="map-key"]')), 'map key: no Your hotel');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sug-trip-nearby.png` });
    await tab(page, 'mytrip'); let mt = await mytripHotels(page);
    ok(!/Park Hyatt|Ace Hotel/.test(mt), `My trip: no hotel counted ${mt.slice(0, 120)}`);
    ok(!(await page.$('[data-panel="mytrip"] [data-cc-cat="hotels"]')), 'My trip: no Hotels chip');
    await tab(page, 'travel'); let bw = await between(page);
    ok(/origin=35\.6812,139\.7671&destination=35\.0116,135\.7681/.test(bw), `Between stops: from the stop, not a suggested hotel: ${bw.slice(0, 160)}`);
    ok((await itin(page, K)).length === 0, 'nothing written to the guest\'s bookings');

    // Choose in Nearby
    await tab(page, 'nearby'); await page.click('[data-slot="hotel"] .hb-sugs [data-hs-set]'); await page.waitForTimeout(800);
    let xs = await itin(page, K); const ph = xs.find(x => x.name === 'Park Hyatt Tokyo');
    ok(xs.length === 1 && ph && ph.start === '2027-04-01' && ph.end === '2027-04-04', `Choose: a hotel booking for the suggestion's nights ${JSON.stringify(xs.map(x => [x.name, x.start, x.end]))}`);
    bar = await txt(page, '[data-slot="hotel"]');
    ok(/Park Hyatt Tokyo/.test(bar) && !/No hotel yet/.test(bar) && !/Suggested/.test(bar), `Nearby: Park Hyatt is Your hotel now: ${bar}`);
    pn = await pins(page); ok(pn.own === 1, `map: Your hotel pin ${JSON.stringify(pn)}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sug-trip-nearby-chosen.png` });
    await tab(page, 'mytrip'); mt = await mytripHotels(page);
    ok(/Park Hyatt Tokyo/.test(mt), 'My trip: Park Hyatt in the itinerary');
    await tab(page, 'travel'); bw = await between(page); ok(/origin=35\.6856,139\.6907&/.test(bw), `Between stops leaves from Park Hyatt: ${bw.slice(0, 160)}`);
    await tab(page, 'event'); rs = (await rows(page)).filter(r => /Check in/.test(r));
    ok(/Park Hyatt Tokyo.*Yours/.test(rs.join(' | ')) && /Ace Hotel Kyoto.*Suggested/.test(rs.join(' | ')), `rows: Park Hyatt Yours, Ace still Suggested: ${rs.join(' | ')}`);

    // Choose from the check-in row's sheet
    await page.locator('[data-panel="event"] .tl-go', { hasText: 'Ace Hotel Kyoto' }).first().click(); await page.waitForSelector('dialog.ds-sheet[open]'); await page.waitForTimeout(200);
    const sh = await txt(page, 'dialog.ds-sheet[open]');
    ok(/Suggested hotel/.test(sh) && /Choose this hotel/.test(sh), `sheet: Suggested hotel + Choose this hotel: ${sh.slice(0, 140)}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sug-trip-sheet.png` });
    await page.click('dialog.ds-sheet[open] [data-hs-set]'); await page.waitForTimeout(800);
    xs = await itin(page, K); const ace = xs.find(x => x.name === 'Ace Hotel Kyoto');
    ok(ace && ace.start === '2027-04-04' && ace.end === '2027-04-07', `sheet Choose: Ace booked for its nights ${JSON.stringify(ace)}`);
    ok(!/Suggested hotel/.test(await txt(page, 'dialog.ds-sheet[open]')), 'the sheet is their booking now');
    await page.evaluate(() => document.querySelector('dialog.ds-sheet[open]')?.close());
    rs = (await rows(page)).filter(r => /Check in/.test(r)); ok(rs.every(r => /Yours/.test(r) && !/Suggested/.test(r)), `rows: both Yours: ${rs.join(' | ')}`);
    await tab(page, 'mytrip'); mt = await mytripHotels(page); ok(/Ace Hotel Kyoto/.test(mt) && /Park Hyatt Tokyo/.test(mt), 'My trip: both hotels');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sug-trip-mytrip-chosen.png`, fullPage: true });
    ok(!page._err.length, 'no page errors (trip guest) ' + page._err.join(' ')); await ctx.close();
  }

  // ---------- 3. wedding, invite link: the organizer's hotel isn't shown, nothing selected ----------
  {
    const state = {}; const { ctx, page } = await mk(state);
    const cfg = await norm(page, WED); const K = await keyOf(page, cfg); state.event = host(cfg, 'wed-suggest-x1');
    await page.goto(BASE + '?e=wed-suggest-x1'); await page.waitForSelector('.ev'); await page.waitForTimeout(400);
    const rs = (await rows(page)).join(' | '); ok(/Ceremony/.test(rs) && !/Grand Hyatt/.test(rs), `wedding rows: no organizer hotel: ${rs}`);
    await tab(page, 'nearby'); await page.waitForSelector('[data-slot="hotel"] .hb-box'); await page.waitForTimeout(500);
    const bar = await txt(page, '[data-slot="hotel"]'); ok(/No hotel yet/.test(bar) && !/Grand Hyatt/.test(bar), `wedding Nearby: no hotel, nothing suggested from the private line: ${bar}`);
    const pn = await pins(page); ok(pn.own === 0 && pn.sug === 0, `wedding map: no hotel pins ${JSON.stringify(pn)}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sug-wedding-nearby.png` });
    ok((await itin(page, K)).length === 0, 'wedding: nothing pre-selected');
    ok(!page._err.length, 'no page errors (wedding guest) ' + page._err.join(' ')); await ctx.close();
  }

  // ---------- 4. Share my trip from the Trip's organizer: pre-selected + in the recipient's itinerary ----------
  {
    const state = {}; const { ctx, page } = await mk(state);
    const cfg = await norm(page, TRIP); const K = await keyOf(page, cfg); state.event = host(cfg, 'japan-suggest-x2');
    const data = await page.evaluate((c) => window.__ep.shareData(c, true), cfg);
    ok(data.bk.map(x => x.name).sort().join() === 'Ace Hotel Kyoto,Park Hyatt Tokyo' && data.bk.every(x => x.kind === 'hotel'), `owner's share carries the plan's hotels ${JSON.stringify(data.bk.map(x => [x.name, x.start, x.end]))}`);
    const g = await page.evaluate((c) => window.__ep.shareData(c, false), cfg); ok(g.bk.length === 0, 'a guest\'s share carries only their own bookings');
    const dd = await page.evaluate(([c, k]) => { localStorage.setItem('ep:itin:' + k, JSON.stringify([{ id: 'own1', kind: 'hotel', name: 'Park Hyatt', start: '2027-04-01T15:00', end: '2027-04-04T11:00', confNo: 'PH1' }])); const d = window.__ep.shareData(c, true); localStorage.removeItem('ep:itin:' + k); return d.bk.map(x => x.id + ':' + x.name); }, [cfg, K]);
    ok(dd.length === 2 && dd.includes('own1:Park Hyatt') && dd.some(x => /Ace Hotel Kyoto/.test(x)), `a stay the organizer booked themselves goes once (their booking) ${dd}`);
    state.share = { token: 'a'.repeat(32), event_id: state.event.id, slug: 'japan-suggest-x2', name: 'Dylan', data, updated_at: new Date().toISOString() };
    await page.goto(BASE + '?e=japan-suggest-x2&s=' + 'a'.repeat(32)); await page.waitForSelector('.ev'); await page.waitForTimeout(600);
    const xs = await itin(page, K); ok(xs.length === 2, `recipient: both hotels pre-selected (${xs.map(x => x.name)})`);
    await tab(page, 'mytrip'); const mt = await mytripHotels(page); ok(/Park Hyatt Tokyo/.test(mt) && /Ace Hotel Kyoto/.test(mt), 'recipient: both in their itinerary');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sug-share-mytrip.png`, fullPage: true });
    await tab(page, 'event'); const rs = (await rows(page)).filter(r => /Check in/.test(r));
    ok(rs.length === 2 && rs.every(r => /Yours/.test(r) && !/Suggested/.test(r)), `recipient rows: Yours (no duplicates): ${rs.join(' | ')}`);
    await tab(page, 'nearby'); await page.waitForSelector('[data-slot="hotel"] .hb-box'); await page.waitForTimeout(500);
    const bar = await txt(page, '[data-slot="hotel"]'); ok(/Park Hyatt Tokyo/.test(bar) && !/Suggested|No hotel yet/.test(bar), `recipient Nearby: Your hotel Park Hyatt: ${bar}`);
    const pn = await pins(page); ok(pn.own >= 1 && pn.sug === 0, `recipient map: Your hotel pins ${JSON.stringify(pn)}`);
    ok(!page._err.length, 'no page errors (recipient) ' + page._err.join(' ')); await ctx.close();
  }

  // ---------- 5. the organizer's own page: unchanged ----------
  {
    const state = {}; const { ctx, page } = await mk(state);
    const cfg = await norm(page, TRIP);
    const r = await page.evaluate((c) => { const E = window.__ep; const own = E.hotelsNow(c); const gv = E.guestView(c, {}); return { own: own.flat().map(h => h.src + ':' + h.name), guest: E.hotelsNow(gv).flat().length, sug: E.hotelsNow(gv, { sug: true }).flat().map(h => h.src + ':' + h.name) }; }, cfg);
    ok(r.own.join() === 'host:Park Hyatt Tokyo,host:Ace Hotel Kyoto', `organizer: their hotels are theirs ${r.own}`);
    ok(r.guest === 0 && r.sug.join() === 'sug:Park Hyatt Tokyo,sug:Ace Hotel Kyoto', `guest view: none own, both suggested ${JSON.stringify(r)}`);
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), cfg);
    await page.goto(BASE + '#edit=' + packed); await page.waitForSelector('#preview .ev.onp', { timeout: 15000 }); await page.waitForTimeout(400);
    const rs = await page.$$eval('#preview [data-panel="event"] .tl li', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ')).filter(t => /Check in/.test(t)));
    ok(rs.length === 2 && rs.every(t => !/Suggested/.test(t)), `organizer's rows: no Suggested tag ${rs.join(' | ')}`);
    ok(!page._err.length, 'no page errors (organizer) ' + page._err.join(' ')); await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
