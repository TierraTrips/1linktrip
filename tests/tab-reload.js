// A reload keeps the tab you were on (Dylan 11/25: "When you refresh, it always brings you back to the 'Event' tab").
// The open tab rides in the address bar via replaceState (?e=<slug>#t=nearby, ?demo=japan#t=mytrip, owner #page=<pid>&t=…;
// Event = no tab part), so it also survives a bookmark / share sheet without adding history entries; the scroll position
// within the tab comes back on a reload (sessionStorage). Links that ask for a tab still win: ?city=&cat= opens Nearby,
// a freshly opened plain link opens on Event. Guest (hosted ?e=, demo), owner (builder preview, Preview as guest), and
// offline through the service worker. 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/tab-reload.js
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SBURL = 'https://mljzoujystouqkmmoemn.supabase.co';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const P = (name, lat, lon, from, to) => ({ name, address: name, lat, lon, city: name, country: 'Japan', cc: 'jp', from, to });
const CFG = { v: 2, type: 'Trip', title: 'Japan in spring', start: '2027-04-01', end: '2027-04-10', tz: 'Asia/Tokyo', off: {},
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 35.6764, 139.65, '2027-04-01', '2027-04-05'), P('Kyoto', 35.0116, 135.7681, '2027-04-05', '2027-04-10')],
  schedule: [{ date: '2027-04-01', time: '11:00', title: 'Flight LAX → HND', note: 'JL 61', kind: 'reservation' }, { date: '2027-04-06', time: '', title: 'Fushimi Inari at dawn', note: '' }],
  tools: { nearby: true, weather: true, travel: true, stay: true, tours: false, mytrip: true, packing: true, shopping: true } };
const SLUG = 'japan-trip-ab2cd';
const cur = (page, root = '#ev-root') => page.$eval(`${root} [role="tab"][aria-selected="true"]`, b => b.dataset.tabGo).catch(() => '');
const shown = (page, root = '#ev-root') => page.$eval(`${root} .ev-panel:not([hidden])`, p => p.dataset.panel).catch(() => '');
const hash = (page) => page.evaluate(() => location.hash);

async function mk(browser, sw) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: sw ? 'allow' : 'block' });
  const st = { net: true, hist: 0 };
  await ctx.route(`${SBURL}/rest/v1/**`, (r) => {
    if (!st.net) return r.abort('internetdisconnected');
    const body = /events\?.*slug=eq\.japan-trip-ab2cd/.test(r.request().url()) ? [{ id: 'e1', slug: SLUG, config: CFG, updated_at: '2026-11-12T00:00:00Z', published: true }] : [];
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await ctx.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru|functions\/v1|supabase\.co\/(auth|storage)/, r => r.abort());
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  return { ctx, page, st };
}
const open = async (page, url, root = '#ev-root') => { await page.goto(BASE + url); await page.waitForSelector(`${root} .ev-panel:not([hidden])`); await page.waitForTimeout(600); };
const reload = async (page, root = '#ev-root') => { await page.reload(); await page.waitForSelector(`${root} .ev-panel:not([hidden])`); await page.waitForTimeout(800); };
const tab = async (page, k, root = '#ev-root') => { await page.click(`${root} [role="tab"][data-tab-go="${k}"]`); await page.waitForTimeout(300); };

(async () => {
  const browser = await chromium.launch();
  try {
    // ---------- guest, hosted link ----------
    { const { ctx, page } = await mk(browser);
      await open(page, '?e=' + SLUG);
      ok(await cur(page) === 'event' && await hash(page) === '', 'hosted: a plain link opens on Event, no tab in the address');
      const h0 = await page.evaluate(() => history.length);
      await tab(page, 'nearby'); ok(await hash(page) === '#t=nearby', `hosted: Nearby → address #t=nearby (${await hash(page)})`);
      await tab(page, 'mytrip'); await tab(page, 'nearby');
      ok(await page.evaluate(() => history.length) === h0, 'hosted: switching tabs adds no history entries');
      await reload(page); ok(await cur(page) === 'nearby' && await shown(page) === 'nearby', `hosted: reload stays on Nearby (${await cur(page)})`);
      await tab(page, 'travel'); await reload(page); ok(await cur(page) === 'travel', 'hosted: reload stays on Travel');
      await tab(page, 'mytrip'); await reload(page); ok(await cur(page) === 'mytrip', 'hosted: reload stays on My trip');
      await tab(page, 'event'); ok(await hash(page) === '', 'hosted: back on Event the tab part is dropped');
      await reload(page); ok(await cur(page) === 'event', 'hosted: reload stays on Event');
      // Nearby's city + category come back too (kept per trip on the device, mirrored in the address)
      await tab(page, 'nearby');
      const cityBtn = (await page.$$('[data-ccb="near"] [data-dd="city"] [data-dd-v]'))[1];
      if (cityBtn) { await cityBtn.click(); await page.waitForTimeout(300); }
      const catBtn = await page.$('[data-ccb="near"] [data-dd="cat"] [data-dd-v="cafes"]');
      if (catBtn) { await catBtn.click(); await page.waitForTimeout(300); }
      const sel = () => page.$$eval('[data-ccb="near"] [aria-selected="true"], [data-ccb="near"] [aria-pressed="true"]', bs => bs.map(b => b.dataset.ddV).join());
      const before = await sel(); await reload(page);
      ok(await cur(page) === 'nearby' && await sel() === before && !!cityBtn, `hosted: reload keeps Nearby's city/category (${before} → ${await sel()})`);
      // the address now has ?city=&cat=: Event is written out so a reload doesn't fall back to Nearby
      await tab(page, 'event'); ok(await hash(page) === '#t=event', `hosted: Event with ?city/cat in the address is #t=event (${await hash(page)})`);
      await reload(page); ok(await cur(page) === 'event', 'hosted: …and a reload stays on Event');
      // a freshly opened plain link: Event, whatever this device did before
      await open(page, '?e=' + SLUG); ok(await cur(page) === 'event', 'hosted: opening the plain link again → Event');
      // an explicit city/category link: Nearby (it asks for it), even after the last tab was My trip
      await tab(page, 'mytrip'); await open(page, `?e=${SLUG}&city=kyoto&cat=restaurants`);
      ok(await cur(page) === 'nearby', `hosted: ?city=&cat= link opens Nearby (${await cur(page)})`);
      await open(page, `?e=${SLUG}&cat=transport`); ok(await cur(page) === 'mytrip', 'hosted: ?cat=transport link opens My trip');
      ok(!page._err.length, 'hosted: no page errors ' + page._err.slice(0, 2));
      await ctx.close(); }

    // ---------- demo page + scroll position ----------
    { const { ctx, page } = await mk(browser);
      await open(page, '?demo=japan'); ok(await cur(page) === 'event', 'demo: opens on Event');
      await tab(page, 'mytrip'); ok(await hash(page) === '#t=mytrip', 'demo: #t=mytrip');
      const H = await page.evaluate(() => document.documentElement.scrollHeight);
      const y = Math.min(900, H - 844 - 10);
      await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(400);
      await reload(page); await page.waitForTimeout(800);
      const y2 = await page.evaluate(() => scrollY);
      ok(await cur(page) === 'mytrip' && y > 200 && Math.abs(y2 - y) < 4, `demo: reload stays on My trip at the same scroll (${y} → ${y2})`);
      await tab(page, 'event'); await reload(page); ok(await cur(page) === 'event' && await page.evaluate(() => scrollY) === 0, 'demo: back on Event, reload → Event at the top');
      await open(page, '?demo=japan'); await tab(page, 'mytrip'); await page.evaluate(() => window.scrollTo(0, 600)); await page.waitForTimeout(300);
      await open(page, '?demo=japan&lang=en#t=mytrip'); ok(await page.evaluate(() => scrollY) === 0, 'demo: a new navigation (not a reload) starts at the top');
      ok(!page._err.length, 'demo: no page errors ' + page._err.slice(0, 2));
      await ctx.close(); }

    // ---------- the organizer's own page (builder preview at its link, #page=, Preview as guest) ----------
    { const { ctx, page } = await mk(browser);
      await page.goto(BASE); await page.evaluate(([c, slug]) => { localStorage.clear(); localStorage.setItem('ep:pages', JSON.stringify([{ pid: 'p1', cfg: c, hosted: { id: 'e1', slug, pub: true }, edited: Date.parse('2026-11-12T00:00:00Z') }])); }, [CFG, SLUG]);
      await open(page, '?e=' + SLUG, '#preview');
      ok(await cur(page, '#preview') === 'event', 'owner: their page opens on Event');
      await tab(page, 'nearby', '#preview'); ok(await hash(page) === '#t=nearby', `owner: preview Nearby → #t=nearby (${await hash(page)})`);
      await reload(page, '#preview'); await page.waitForTimeout(600); ok(await cur(page, '#preview') === 'nearby', `owner: reload stays on Nearby (${await cur(page, '#preview')})`);
      await page.click('[data-guest-tg]', { force: true }).catch(() => page.check('[data-guest-tg]', { force: true })); await page.waitForTimeout(700);
      await tab(page, 'mytrip', '#preview'); ok(await hash(page) === '#t=mytrip', 'owner: Preview as guest My trip → #t=mytrip');
      await reload(page, '#preview'); await page.waitForTimeout(600); ok(await cur(page, '#preview') === 'mytrip', 'owner: reload (from Preview as guest) stays on My trip');
      await open(page, '#page=p1', '#preview'); await page.waitForTimeout(500); await tab(page, 'travel', '#preview');
      ok(await hash(page) === '#page=p1&t=travel', `owner: #page=p1 Travel → ${await hash(page)}`);
      await reload(page, '#preview'); await page.waitForTimeout(600); ok(await cur(page, '#preview') === 'travel', 'owner: #page= reload stays on Travel');
      ok(!page._err.length, 'owner: no page errors ' + page._err.slice(0, 2));
      await ctx.close(); }

    // ---------- offline (service worker) ----------
    { const { ctx, page, st } = await mk(browser, true);
      await open(page, '?e=' + SLUG); await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
      await reload(page); await tab(page, 'nearby');
      st.net = false; await ctx.setOffline(true);
      await reload(page); ok(await cur(page) === 'nearby', `offline: reload stays on Nearby (${await cur(page)})`);
      await tab(page, 'mytrip'); await reload(page); ok(await cur(page) === 'mytrip', 'offline: reload stays on My trip');
      await ctx.setOffline(false); await ctx.close(); }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
