// Travel tab: hide what you don't need (Dylan 11/25: "once we have our airport selected, there should be a way to
// hide/remove the others"). Personal view state, per device — never the event.
//  - Flights: once an airport is settled (the guest's pick, a booked flight's arrival, or the organizer's Fly into) the
//    list folds to that one airport + one Change; Change brings the others back, a pick folds again.
//  - Travel modes: a choice made earlier shows as just the chosen modes + Change (stays open while tapping).
//  - Hide on Where to stay, Airlines, Hotels near the venue, Rental counters; one "Show hidden (N)" restores them.
// Also Between stops (Dylan: "it just opens up Google Maps between hotels"): each leg runs from the hotel at the stop
// being left to the hotel at the next stop — the guest's own hotel (the organizer's check-in is a suggestion); no hotel → the stop.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/travel-hide.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return false; for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.')).slice(0, 5); });
const TOKYO = { name: 'Tokyo', lat: 35.6812, lon: 139.7671, city: 'Tokyo', country: 'Japan', cc: 'jp' };
const KYOTO = { name: 'Kyoto', lat: 35.0116, lon: 135.7681, city: 'Kyoto', country: 'Japan', cc: 'jp' };
const OSAKA = { name: 'Osaka', lat: 34.6937, lon: 135.5023, city: 'Osaka', country: 'Japan', cc: 'jp' };
const CFG = { v: 2, type: 'Trip', title: 'Japan hide test', start: '2027-04-01', end: '2027-04-10', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo Station', address: 'Marunouchi, Tokyo', lat: 35.6812, lon: 139.7671, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [{ ...TOKYO, from: '2027-04-01', to: '2027-04-04' }, { ...KYOTO, from: '2027-04-04', to: '2027-04-07' }, { ...OSAKA, from: '2027-04-07', to: '2027-04-10' }],
  tools: { weather: false, travel: true, stay: true, nearby: false, tours: false, mytrip: true, packing: false, shopping: false } };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
const K = keyOf(CFG);
const PARK = { id: 'h1', kind: 'hotel', name: 'Park Hyatt Tokyo', address: 'Shinjuku, Tokyo', lat: 35.6856, lon: 139.6907, start: '2027-04-01T15:00', end: '2027-04-04T11:00' };
const ACE = { id: 'h2', kind: 'hotel', name: 'Ace Hotel Kyoto', address: 'Nakagyo, Kyoto', lat: 35.0081, lon: 135.7593, start: '2027-04-04T15:00', end: '2027-04-07T11:00', confNo: 'X1' };

async function setup(browser, cfg = CFG, ls = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route(/googleapis|gstatic|overpass|nominatim|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|photon|functions\/v1|auth\/v1|rest\/v1/, r => r.abort());
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.AIRPORTS);
  await page.evaluate((ls) => { localStorage.clear(); Object.entries(ls).forEach(([k, v]) => localStorage.setItem('ep:' + k, JSON.stringify(v))); }, ls);
  const packed = await page.evaluate((c) => window.__ep.packEvent(window.__ep.normalize(JSON.parse(JSON.stringify(c)))), cfg);
  page._url = BASE + '#e=' + packed + '&t=travel';
  await open(page);
  return { ctx, page };
}
async function open(page) { await page.goto(page._url); await page.reload(); await page.waitForSelector('[data-panel="travel"] [data-slot="flights"] .airports'); await page.waitForTimeout(300); }
const aps = (page) => page.evaluate(() => { const f = document.querySelector('[data-slot="flights"]'); return {
  codes: [...f.querySelectorAll('.airports li')].filter(l => l.checkVisibility()).map(l => l.querySelector('.ap-code').textContent).join(),
  head: f.querySelector('.sub-h').textContent, change: !!f.querySelector('[data-ap-change]'), picks: f.querySelectorAll('.ap-pick').length }; });
const modes = (page) => page.evaluate(() => [...document.querySelectorAll('.mode-bar .chip')].filter(b => b.checkVisibility()).map(b => b.textContent.trim()).join('|'));
const shown = (page) => page.evaluate(() => { const v = (s) => { const e = document.querySelector('[data-panel="travel"] ' + s); return !!e && e.checkVisibility(); };
  const b = document.querySelector('[data-th-show]'); return { stay: v('#sec-stay'), airlines: v('.airline-pick'), hotels: v('.th-hotels'), show: b && b.checkVisibility() ? b.textContent : '' }; });

(async () => {
  const browser = await chromium.launch();
  try {
    // ---- airports: nothing settled → all; a pick folds; reload keeps it; Change restores; a new pick folds again ----
    {
      const { ctx, page } = await setup(browser);
      let a = await aps(page);
      ok(a.codes.split(',').length >= 2 && !a.change && a.head === 'Nearest airports', `nothing chosen: every airport, no Change ${JSON.stringify(a)}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/travel-hide-before.png`, fullPage: true });
      const other = await page.$eval('[data-slot="flights"] .ap-pick:not(.on)', b => b.dataset.ap);
      await page.click(`[data-slot="flights"] [data-ap="${other}"]`); await page.waitForTimeout(200);
      a = await aps(page);
      ok(a.codes === other && a.change && a.picks === 0 && a.head === 'Flying into', `pick ${other}: only it + Change ${JSON.stringify(a)}`);
      const rental = await page.$eval('[data-slot="rental"] [data-ap-sel]', s => s.value).catch(() => '');
      ok(rental === other, `rental picker follows the pick (${rental})`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/travel-hide-picked.png`, fullPage: true });
      await open(page); a = await aps(page);
      ok(a.codes === other && a.change, `reload: still folded to ${other} ${JSON.stringify(a)}`);
      await page.click('[data-ap-change]'); await page.waitForTimeout(200); a = await aps(page);
      ok(a.codes.split(',').length >= 2 && !a.change && a.picks >= 2, `Change: the others are back ${JSON.stringify(a)}`);
      const third = await page.$eval('[data-slot="flights"] .ap-pick:not(.on)', b => b.dataset.ap);
      await page.click(`[data-slot="flights"] [data-ap="${third}"]`); await page.waitForTimeout(200); a = await aps(page);
      ok(a.codes === third && a.change, `a new pick folds again to ${third}`);
      const sz = await page.$eval('[data-ap-change]', b => { const r = b.getBoundingClientRect(); return r.height; });
      ok(sz >= 36, `Change is tappable (${sz}px)`);
      ok(!page._err.length, `no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
    // ---- the organizer's Fly into folds the list by default; Change still works ----
    {
      const { ctx, page } = await setup(browser, { ...CFG, flyInto: 'NRT' });
      let a = await aps(page); ok(a.codes === 'NRT' && a.change, `organizer Fly into NRT: folded to it ${JSON.stringify(a)}`);
      await page.click('[data-ap-change]'); await page.waitForTimeout(200); a = await aps(page);
      ok(a.codes.split(',').length >= 2 && a.codes.includes('HND'), `Change shows the rest ${JSON.stringify(a)}`);
      await ctx.close();
    }
    // ---- travel modes: open while choosing; settled after a reload; Change restores; leaving the tab settles ----
    {
      const { ctx, page } = await setup(browser);
      const all = await modes(page); ok(/^All\|Flying\|Train\|Rental car/.test(all) && !/Change/.test(all), `modes start open: ${all}`);
      await page.click('.mode-bar [data-tmode="fly"]'); await page.click('.mode-bar [data-tmode="train"]');
      ok(await modes(page) === all, `still open while choosing`);
      ok(!(await page.$eval('[data-slot="rental"]', e => e.checkVisibility())), `the unchosen Rental car part is hidden`);
      await open(page); const m = await modes(page);
      ok(m === 'Flying|Train|Change', `reload: just the chosen modes + Change (${m})`);
      await page.click('[data-tmode-change]'); ok(await modes(page) === all, `Change: every mode back`);
      await page.click('[data-tab-go="event"]'); await page.click('[data-tab-go="travel"]');
      ok(await modes(page) === 'Flying|Train|Change', `leaving the tab settles the choice again`);
      await page.click('.mode-bar [data-tmode="fly"]'); await page.click('.mode-bar [data-tmode="train"]');
      ok(await modes(page) === all, `deselecting everything = All, open`);
      await ctx.close();
    }
    // ---- Hide + Show hidden (N), kept across reloads ----
    {
      const { ctx, page } = await setup(browser);
      let s = await shown(page); ok(s.stay && s.airlines && s.hotels && !s.show, `everything shown, no Show hidden ${JSON.stringify(s)}`);
      const hides = await page.$$eval('[data-panel="travel"] [data-th-hide]', bs => bs.filter(b => b.checkVisibility()).map(b => b.dataset.thHide));
      ok(['stay', 'airlines', 'hotels'].every(x => hides.includes(x)), `Hide on Where to stay, Airlines, Hotels near the venue (${hides})`);
      await page.click('.airline-pick [data-th-hide]'); await page.click('.th-hotels [data-th-hide]');
      s = await shown(page); ok(!s.airlines && !s.hotels && s.stay && s.show === 'Show hidden (2)', `two hidden ${JSON.stringify(s)}`);
      const col0 = await page.$eval('#sec-stay', e => e.classList.contains('cx-col'));
      await page.click('#sec-stay [data-th-hide]');
      s = await shown(page); ok(!s.stay && s.show === 'Show hidden (3)', `Where to stay hidden (its fold untouched) ${JSON.stringify(s)}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/travel-hide-hidden.png`, fullPage: true });
      const of = await overflow(page); ok(!of.length, `@390 no overflow ${of.join(' ')}`);
      await open(page); s = await shown(page);
      ok(!s.stay && !s.airlines && !s.hotels && s.show === 'Show hidden (3)', `reload: still hidden ${JSON.stringify(s)}`);
      await page.click('[data-th-show]'); s = await shown(page);
      ok(s.stay && s.airlines && s.hotels && !s.show, `Show hidden restores all ${JSON.stringify(s)}`);
      ok(await page.$eval('#sec-stay', e => e.classList.contains('cx-col')) === col0, `the fold state was not touched by Hide`);
      const hdr = await page.$$eval('#sec-stay > .sec-h button', bs => bs.map(b => b.className).join());
      ok(/cx-h/.test(hdr) && /th-hide/.test(hdr) && hdr.split(',').length === 2, `Where to stay title row: fold + Hide (${hdr})`);
      const ev = await page.evaluate(() => Object.keys(localStorage).filter(k => /thide:/.test(k)));
      ok(!ev.length, `cleared from this device after Show hidden (${ev})`);
      ok(!page._err.length, `no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
    // ---- Between stops: hotel to hotel ----
    {
      const dir = (page) => page.$$eval('[data-slot="trains"] a[href*="maps/dir"]', as => as.map(a => decodeURIComponent(a.href)));
      const q = (u, k) => (new URL(u).searchParams.get(k) || '');
      // the guest's two hotels: Tokyo → Kyoto runs Park Hyatt → Ace; Kyoto → Osaka (no hotel in Osaka) Ace → Osaka's point
      {
        const { ctx, page } = await setup(browser, CFG, { ['itin:' + K]: [PARK, ACE] });
        const d = await dir(page);
        ok(d.length === 2 && q(d[0], 'origin') === '35.6856,139.6907' && q(d[0], 'destination') === '35.0081,135.7593' && q(d[0], 'travelmode') === 'transit', `hotel → hotel: ${d[0]}`);
        ok(q(d[1], 'origin') === '35.0081,135.7593' && q(d[1], 'destination') === `${OSAKA.lat},${OSAKA.lon}`, `no hotel at the next stop → that stop: ${d[1]}`);
        await ctx.close();
      }
      // the organizer's check-in for Kyoto, and the guest's own Kyoto booking beats it
      const HOST = { ...CFG, schedule: [{ date: '2027-04-04', time: '15:00', title: 'Check in: Hotel Granvia Kyoto', note: '' }] };
      const GEO = { 'hgeo:hotel granvia kyoto': { lat: 34.9858, lon: 135.7588, addr: 'Kyoto Station' } };
      {
        const { ctx, page } = await setup(browser, HOST, GEO);
        const d = await dir(page);
        // invite link (Dylan 11/25): the organizer's check-in is only a suggestion until the guest chooses it → stop to stop
        ok(q(d[0], 'destination') === `${KYOTO.lat},${KYOTO.lon}` && q(d[0], 'origin') === `${TOKYO.lat},${TOKYO.lon}`, `organizer's suggested hotel is not the guest's: stop → stop: ${d[0]}`);
        await ctx.close();
      }
      {
        const { ctx, page } = await setup(browser, HOST, { ...GEO, ['itin:' + K]: [ACE] });
        const d = await dir(page);
        ok(q(d[0], 'destination') === '35.0081,135.7593', `the guest's booking beats the organizer's hotel: ${d[0]}`);
        await ctx.close();
      }
      // no hotels at all: city to city, as before
      {
        const { ctx, page } = await setup(browser);
        const d = await dir(page);
        ok(d.length === 2 && q(d[0], 'origin') === `${TOKYO.lat},${TOKYO.lon}` && q(d[0], 'destination') === `${KYOTO.lat},${KYOTO.lon}`, `no hotels → stop to stop: ${d[0]}`);
        // a Google place id goes with the hotel's name (Maps opens the place, not a dropped pin)
        const u = await page.evaluate(([c, h]) => { const cfg = window.__ep.normalize(JSON.parse(JSON.stringify(c))); const ss = cfg.stops; return window.__ep.legDirURL(cfg, ss[0], ss[1], [[h], [], []], window.__ep.hotelStops(cfg)); }, [CFG, { name: 'Park Hyatt Tokyo', addr: 'Shinjuku, Tokyo', ref: 'ChIJN1t_tDeuEmsRUsoyG83frY4', lat: 35.6856, lon: 139.6907, from: '2027-04-01', to: '2027-04-04' }]);
        ok(q(u, 'origin') === 'Park Hyatt Tokyo, Shinjuku, Tokyo' && q(u, 'origin_place_id') === 'ChIJN1t_tDeuEmsRUsoyG83frY4', `place id → name + origin_place_id: ${decodeURIComponent(u)}`);
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
