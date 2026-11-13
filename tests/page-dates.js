// A page imported before the trip-span fix (stored Jun 2–3; the trip's own flights say Apr 25 – Jun 2) shows the real
// span everywhere dates are listed (My pages card, Duplicate), and opening it in the builder saves the corrected dates
// into the page for good (a shared page saves it to the account like any edit; no Update page), and the guest's My trip
// bookings stay with the corrected page (same page key). A page with right dates is left untouched. 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/page-dates.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const CFG = { v: 2, type: 'Trip', title: 'Japan 2027', start: '2027-06-02', end: '2027-06-03', tz: 'Asia/Tokyo',
  venue: { name: 'Japan', address: 'Japan', lat: 36.2048, lon: 138.2529, city: '', country: 'Japan', cc: 'jp' },
  schedule: [{ date: '2027-05-03', time: '', title: 'Fushimi Inari', note: '' }, { date: '2027-04-28', time: '', title: 'Senso-ji', note: '' }],
  tools: { nearby: false, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const GOOD = { ...CFG, title: 'Kyoto week', start: '2027-04-26', end: '2027-06-02' };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
const FLIGHTS = [{ id: 'b2', kind: 'flight', name: 'UA 7924 Tokyo HND → New York JFK', flight: 'UA 7924', start: '2027-06-02T22:45', end: '2027-06-02T22:55' },
  { id: 'b1', kind: 'flight', name: 'UA 7909 JFK → HND (Flight to Tokyo)', flight: 'UA 7909', start: '2027-04-25T13:30', end: '2027-04-26T16:55' }];
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru|functions\/v1|supabase/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  await page.evaluate(([cfg, good, k, flights]) => {
    localStorage.clear();
    localStorage.setItem('ep:itin:' + k, JSON.stringify(flights));
    localStorage.setItem('ep:pages', JSON.stringify([
      { pid: 'pbad', cfg, url: '', hosted: { id: 'ev-1', slug: 'japan27' }, updated: 2 },
      { pid: 'pgood', cfg: good, url: '', hosted: null, updated: 1 }]));
  }, [CFG, GOOD, keyOf(CFG), FLIGHTS]);
  await page.goto(BASE + '?x=1#'); await page.waitForSelector('.mp-list');
  const cards = await page.$$eval('.mp-list .mp-t span', ss => ss.map(s => s.textContent));
  ok(/Apr 25/.test(cards[0]) && /Jun 2/.test(cards[0]) && !/Jun 3/.test(cards[0]), `My pages card shows the trip's span: ${cards[0]}`);
  ok(/Apr 26/.test(cards[1]), `a page with right dates is unchanged: ${cards[1]}`);
  // builder: the corrected dates are saved into the page; the shared page needs an update
  await page.goto(BASE + '#page=pbad'); await page.waitForSelector('[data-save]', { state: 'attached' });
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('ep:pages')).find(x => x.pid === 'pbad'); return { draft: JSON.parse(localStorage.getItem('ep:draft')), saved: p.cfg, live: p.live, bar: document.querySelector('[data-save]').textContent }; });
  ok(st.draft.start === '2027-04-25' && st.draft.end === '2027-06-02' && st.saved.start === '2027-04-25', `builder saves the corrected dates (${st.saved.start} – ${st.saved.end})`);
  ok(!/not live|Update page/.test(st.bar), `shared page: no "not live" / Update page (edits save to the page itself): "${st.bar}"`);
  // the corrected page keeps the guest's bookings (same key)
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), st.saved)); await page.waitForSelector('.stub');
  ok(/Apr 25/.test(await page.textContent('.stub-cell b')), 'guest page of the corrected page: Apr 25');
  await page.click('[data-tab-go="mytrip"]'); await page.waitForSelector('.bookings li', { timeout: 5000 }).catch(() => {});
  ok((await page.$$('.bookings li')).length === 2, 'guest bookings still there after the fix');
  // reopening doesn't change it again; the good page is untouched by the builder
  await page.goto(BASE + '#page=pgood'); await page.waitForSelector('[data-save]', { state: 'attached' }); await page.waitForTimeout(400);
  const g = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:pages')).find(x => x.pid === 'pgood').cfg);
  ok(g.start === '2027-04-26' && !g.ek, 'right dates: builder leaves the page alone');
  // Duplicate of the old stored page gets the real dates (fresh page: no pinned key)
  await page.evaluate(([cfg]) => { const xs = JSON.parse(localStorage.getItem('ep:pages')); xs.push({ pid: 'pold', cfg: { ...cfg, title: 'Japan 2027' }, url: '', hosted: null, updated: 0 }); localStorage.setItem('ep:pages', JSON.stringify(xs)); }, [CFG]);
  await page.goto(BASE + '#dup=pold'); await page.waitForSelector('[data-save]', { state: 'attached' });
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
  ok(d.start === '2027-04-25' && d.end === '2027-06-02' && !d.ek && /\(copy\)/.test(d.title), `Duplicate: ${d.title} ${d.start} – ${d.end}`);
  ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
