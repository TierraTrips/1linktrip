// Offline mode for guests. A shared trip page opened online is kept on the device (the app by the service worker; the
// page's config, its documents and photos in the 'ep-data' cache; My trip in localStorage). Offline (context.setOffline):
// the page, itinerary, bookings, saved spots, shopping list and documents open; Nearby shows an Offline note with the
// hotel + saved spots (no map tiles cached); an RSVP sent offline is kept and goes out when the connection is back;
// "Save for offline" in My trip is on by default and off removes this page's copies. 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node tests/offline.js
//
// The database and Storage are answered by context routes (also for the service worker's own requests).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const SBURL = 'https://mljzoujystouqkmmoemn.supabase.co';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const P = (name, lat, lon, from, to) => ({ name, address: name, lat, lon, city: name, country: 'Japan', cc: 'jp', from, to });
const DOC = SBURL + '/storage/v1/object/public/event-files/u1/japan-plan.pdf';
const CFG = { v: 2, type: 'Trip', title: 'Japan in spring', start: '2027-04-01', end: '2027-04-10', tz: 'Asia/Tokyo', off: {},
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 35.6764, 139.65, '2027-04-01', '2027-04-05'), P('Kyoto', 35.0116, 135.7681, '2027-04-05', '2027-04-10')],
  schedule: [{ date: '2027-04-01', time: '11:00', title: 'Flight LAX → HND', note: 'JL 61', kind: 'reservation' }, { date: '2027-04-06', time: '', title: 'Fushimi Inari at dawn', note: '' }],
  files: [{ id: 'f1', sec: 'route', name: 'Japan plan.pdf', url: DOC, type: 'pdf', size: 2000 }],
  tools: { nearby: true, weather: true, travel: false, stay: false, tours: false, mytrip: true, packing: true, shopping: true } };
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 32)]);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
  const rsvps = []; let restHits = 0; let net = true; // routes answer even when offline, so they follow the switch too
  await ctx.route(`${SBURL}/rest/v1/**`, async (r) => {
    if (!net) return r.abort('internetdisconnected'); const u = r.request().url(); restHits++;
    if (r.request().method() === 'POST' && /\/rsvps/.test(u)) { rsvps.push(JSON.parse(r.request().postData())); return r.fulfill({ status: 201, body: '' }); }
    if (/events\?slug=eq\.japan-trip-ab2cd/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ id: 'e1', slug: 'japan-trip-ab2cd', config: CFG, updated_at: '2026-11-12T00:00:00Z' }]) });
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
  });
  await ctx.route(`${SBURL}/storage/v1/object/public/**`, r => !net ? r.abort('internetdisconnected') : r.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: PDF }));
  await ctx.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru|functions\/v1|cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  await page.evaluate((c) => { localStorage.clear(); }, CFG);
  // first open, online: the service worker installs, the page and its document are kept
  await page.goto(BASE + '?e=japan-trip-ab2cd'); await page.waitForSelector('#sec-schedule');
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForSelector('#sec-schedule');
  ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');
  // My trip data the guest made
  const k = await page.evaluate(() => Object.keys(localStorage).find(x => x.startsWith('ep:modes:')) || '');
  await page.click('[data-tab-go="mytrip"]'); await page.waitForSelector('[data-offline]');
  ok(await page.$eval('[data-offline]', i => i.checked), 'Save for offline is on by default');
  await page.waitForFunction(() => /Saved on this device · 1 files/.test(document.querySelector('[data-offline-st]').textContent), null, { timeout: 10000 }).catch(() => {});
  ok(/Saved on this device · 1 files/.test(await page.textContent('[data-offline-st]')), `status: ${await page.textContent('[data-offline-st]')}`);
  await page.click('#sec-shop summary'); await page.fill('[data-shop-text]', 'Matcha'); await page.click('[data-shop-add]');
  await page.evaluate(() => { const key = Object.keys(localStorage).find(x => x.startsWith('ep:shop:')).replace('ep:shop:', ''); localStorage.setItem('ep:plan:' + key, JSON.stringify([{ id: 's1', src: 'osm', ref: 'n1', name: 'Tsukiji Outer Market', lat: 35.6655, lon: 139.7707, addr: '4 Chome Tsukiji', type: 'food', day: '' }])); });

  // ---------- offline ----------
  await ctx.setOffline(true); net = false;
  await page.reload(); await page.waitForSelector('#sec-schedule', { timeout: 15000 });
  ok(await page.textContent('.ev-title') === 'Japan in spring', 'page opens offline');
  ok(await page.evaluate(() => document.documentElement.classList.contains('is-offline')), 'Offline tag shown');
  ok((await page.$$eval('#sec-schedule .tl b', bs => bs.map(b => b.textContent))).join('|') === 'Flight LAX → HND|Fushimi Inari at dawn', 'itinerary offline');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/offline-event-390.png` });
  // the document opens from the saved copy
  // (a real popup resets the page's offline emulation in Playwright, so window.open is observed instead)
  await page.evaluate(() => { window.__opened = { location: { href: '' }, close() { this.closed = true; } }; window.open = () => window.__opened; });
  await page.click('#sec-schedule .route-docs .doc-main');
  await page.waitForFunction(() => /^blob:/.test(window.__opened.location.href), null, { timeout: 5000 }).catch(() => {});
  const blob = await page.evaluate(async () => { const u = window.__opened.location.href; if (!u) return ''; const t = await (await fetch(u)).text(); return t.slice(0, 8); });
  ok(blob === '%PDF-1.4', `document opens offline from the saved copy (${blob})`);
  // Nearby: Offline note + saved spots, not a broken map
  await page.click('[data-tab-go="nearby"]'); await page.waitForSelector('[data-slot="map-off"] .off-msg');
  ok(/Tsukiji Outer Market/.test(await page.textContent('[data-slot="map-off"]')), 'Nearby offline: saved spots listed');
  if (SHOTS) await page.locator('#sec-map').screenshot({ path: `${SHOTS}/offline-nearby-390.png` });
  // My trip
  await page.click('[data-tab-go="mytrip"]');
  ok(/Showing the copy saved on this device/.test(await page.textContent('[data-offline-st]')), 'My trip says it is the saved copy');
  await page.click('#sec-shop summary'); ok(/Matcha/.test(await page.textContent('#sec-shop')), 'shopping list offline');
  // RSVP offline → kept, sent when back online
  await page.click('[data-tab-go="event"]'); await page.waitForSelector('#rs-name');
  await page.fill('#rs-name', 'Sam'); await page.click('[data-rsvp="send"]'); await page.waitForSelector('[data-rsvp-pending]');
  ok(rsvps.length === 0 && (await page.evaluate(() => JSON.parse(localStorage.getItem('ep:outbox')).length)) === 1, 'RSVP kept on the device');
  net = true; await ctx.setOffline(false);
  await page.waitForFunction(() => !(JSON.parse(localStorage.getItem('ep:outbox') || '[]')).length, null, { timeout: 10000 }).catch(() => {});
  ok(rsvps.length === 1 && rsvps[0].name === 'Sam' && rsvps[0].event_id === 'e1', `RSVP sent once back online (${rsvps.length})`);
  ok(!(await page.$('[data-rsvp-pending]')), 'pending note cleared');
  // Save for offline off → this page's copies are removed
  await page.click('[data-tab-go="mytrip"]'); await page.click('.off-row .tool'); await page.waitForTimeout(500);
  const left = await page.evaluate(async () => (await (await caches.open('ep-data')).keys()).map(r => r.url));
  ok(!left.some(u => /japan-plan|japan-trip-ab2cd/.test(u)), `off removes the copies (${left.length} left)`);
  ok(/Needs a connection/.test(await page.textContent('[data-offline-st]')), 'status says it needs a connection');
  ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
