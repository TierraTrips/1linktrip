// "The cover photo only shows when I edit, not when I open the trip": a shared (short-link) page shows what was last
// pushed with Update page; edits made since are saved on the organizer's device only. The cover itself survives every
// path (share link, short link). The organizer's device now says so where they look: a "Your latest changes aren't
// live yet · Update page" bar on their own page, and "changes not live yet" on the My pages card. Guests never see it.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/cover-live.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const IMG = 'https://images.unsplash.com/photo-test.jpg';
const CFG = { v: 2, type: 'Trip', title: 'Cover test', start: '2027-04-25', end: '2027-05-02', venue: { name: 'Tokyo', address: 'Tokyo', lat: 35.68, lon: 139.76, city: 'Tokyo', country: 'Japan', cc: 'jp' }, cover: '' };
(async () => {
  const browser = await chromium.launch();
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|functions\/v1|auth\/v1/, r => r.abort());
    await ctx.route(/images\.unsplash/, r => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>' }));
    await ctx.route(/\/rest\/v1\/events/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 'ev1', slug: 'cover-test-abcde', config: published, updated_at: '' }]) }));
    await ctx.route(/\/rest\/v1\/(?!events)/, r => r.fulfill({ contentType: 'application/json', body: '[]' }));
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e))); return { ctx, page };
  };
  let published = CFG;
  const { ctx, page } = await mk();
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  await page.evaluate((cfg) => { localStorage.clear(); localStorage.setItem('ep:pages', JSON.stringify([{ pid: 'p1', cfg, url: '', hosted: { id: 'ev1', slug: 'cover-test-abcde' }, updated: 1 }])); }, CFG);
  // in sync: the owner's page has no bar
  await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
  await page.goto(BASE + '?e=cover-test-abcde'); await page.waitForSelector('.ev-hero');
  ok(!(await page.$('.own-stale')), 'in sync: no "not live" bar on the owner\'s page');
  // add a cover in the builder
  await page.goto(BASE + '?e=cover-test-abcde#page=p1'); await page.waitForSelector('.b-form');
  await page.click('[data-acc="design"] summary'); await page.fill('#f-cover', IMG); await page.dispatchEvent('#f-cover', 'change'); await page.waitForTimeout(700);
  ok(!!(await page.$('#preview .ev-cover')), 'builder preview shows the cover');
  ok(/Changes not live yet/.test(await page.textContent('[data-save]')), 'builder: Changes not live yet → Update page');
  const edited = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:pages'))[0].cfg);
  ok(edited.cover === IMG, 'cover saved in the page');
  // open the trip (short link) before Update page: the old version, and the owner is told
  await page.goto(BASE + '?e=cover-test-abcde'); await page.waitForSelector('.ev-hero');
  ok(!(await page.$('.ev-cover')), 'short link shows the last pushed version (no cover yet)');
  ok(/aren’t live yet/.test(await page.textContent('.own-stale').catch(() => '')) && !!(await page.$('.own-stale [data-own-update]')), 'owner sees "Your latest changes aren’t live yet · Update page"');
  await page.screenshot({ path: (process.env.SHOTS || '/tmp') + '/cover-stale-390.png' });
  await page.goto(BASE + '?x#'); await page.waitForSelector('.mp-list');
  ok(/changes not live yet/.test(await page.textContent('.mp-list .mp-t span')), 'My pages card: changes not live yet');
  // the share link carries the cover; a fresh device shows it
  const { ctx: c2, page: p2 } = await mk();
  await p2.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), edited)); await p2.waitForSelector('.ev-hero');
  ok(!!(await p2.$('.ev-cover')), 'share link (#e=) opened fresh shows the cover');
  // after Update page (pushed + marked live): the short link shows the cover, no bar; a guest never sees the bar
  published = edited;
  // Update page = publish + record what's live: here, via the builder (it records the opened config as live when none is stored)
  await page.evaluate(() => { const xs = JSON.parse(localStorage.getItem('ep:pages')); delete xs[0].live; localStorage.setItem('ep:pages', JSON.stringify(xs)); });
  await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
  ok(await page.evaluate(() => { const x = JSON.parse(localStorage.getItem('ep:pages'))[0]; return !!x.live && !window.__ep.pageStale(x); }), 'recorded live hash matches the saved page (no false "not live")');
  await page.goto(BASE + '?e=cover-test-abcde'); await page.waitForSelector('.ev-hero');
  ok(!!(await page.$('.ev-cover')) && !(await page.$('.own-stale')), 'after Update page: short link shows the cover, no bar');
  await p2.goto(BASE + '?e=cover-test-abcde'); await p2.waitForSelector('.ev-hero');
  ok(!!(await p2.$('.ev-cover')) && !(await p2.$('.own-stale')), 'guest device: cover, never the owner bar');
  ok(!page._err.length && !p2._err.length, 'no page errors ' + page._err.concat(p2._err).join(' | '));
  await c2.close(); await ctx.close(); await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
