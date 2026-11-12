// Builder save clarity: the top bar says "Saving…" then "Saved on this device" after each change. On a page that is
// already shared, a change shows "Changes not live yet" + Update page, which pushes the same publish as Share (no share
// sheet) and then says "Live ✓"; the next change brings the notice back. A never-shared page never shows it. 390 + 320.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/save-status.js
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
function fakeSupabase() {
  window.__pushed = [];
  const user = { id: 'u0000000-0000-4000-8000-000000000001', email: 'host@example.com' };
  const q = (tbl) => ({ update: (row) => ({ eq: (k, v) => ({ select: async () => { window.__pushed.push({ tbl, row, v }); return { data: [{ id: v, slug: 'japan-trip-ab2cd' }], error: null }; } }) }),
    insert: (row) => ({ select: () => ({ single: async () => ({ data: { id: 'e1', slug: 'japan-trip-ab2cd' }, error: null }) }) }),
    select: () => ({ eq: () => Promise.resolve({ data: [], error: null }), in: () => Promise.resolve({ data: [], error: null }) }), upsert: async () => ({ error: null }), delete: () => ({ eq: () => ({ not: async () => ({}) }) }) });
  const client = { from: q, storage: { from: () => ({}) }, auth: { getSession: async () => ({ data: { session: { user, access_token: 'a.b.c' } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
  window.supabase = { createClient: () => client };
}
const setTitle = (page, v) => page.evaluate((v) => { const i = document.querySelector('#f-title'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, v);
(async () => {
  const browser = await chromium.launch();
  for (const w of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(fakeSupabase);
    await page.route(/open-meteo|overpass|nominatim|googleapis\.com\/(?!css)|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru|functions\/v1/, r => r.abort());
    await page.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    const st = () => page.$eval('[data-save]', e => e.textContent.replace(/\s+/g, ' ').trim());
    // a page that was never shared
    await page.goto(BASE + '#edit-ex=japan-trip'); await page.waitForSelector('[data-save]', { state: 'attached' });
    ok(await st() === '', `@${w} nothing to say before a change`);
    await setTitle(page, 'Japan in spring 2027'); await page.waitForTimeout(60);
    ok(/Saving…/.test(await st()), `@${w} Saving… right after a change`);
    await page.waitForTimeout(500); ok(await st() === 'Saved on this device', `@${w} then Saved on this device: ${await st()}`);
    ok(!(await page.$('[data-act="update-live"]')), `@${w} never-shared page: no Update page`);
    // the same page, already shared
    const pid = await page.evaluate(() => localStorage.getItem('ep:draftId').replace(/"/g, ''));
    await page.evaluate((pid) => { const xs = JSON.parse(localStorage.getItem('ep:pages')); xs.find(x => x.pid === pid).hosted = { id: 'e1', slug: 'japan-trip-ab2cd' }; localStorage.setItem('ep:pages', JSON.stringify(xs)); localStorage.setItem('ep:signedIn', 'true'); }, pid);
    await page.goto(BASE + '#page=' + pid); await page.reload(); await page.waitForSelector('[data-save]', { state: 'attached' });
    ok(await st() === '', `@${w} shared page as opened: live, nothing pending`);
    await setTitle(page, 'Japan in spring (updated)'); await page.waitForTimeout(500);
    ok(/Changes not live yet/.test(await st()) && !!(await page.$('[data-act="update-live"]')), `@${w} change → Changes not live yet + Update page: ${await st()}`);
    const of = await overflow(page); ok(of.length === 0, `@${w} top bar fits ${of.join(' ')}`);
    if (SHOTS) await page.locator('.b-top').screenshot({ path: `${SHOTS}/save-dirty-${w}.png` });
    await page.click('[data-act="update-live"]'); await page.waitForFunction(() => /Live ✓/.test(document.querySelector('[data-save]').textContent));
    const pushed = await page.evaluate(() => window.__pushed);
    ok(pushed.length === 1 && pushed[0].tbl === 'events' && pushed[0].v === 'e1' && pushed[0].row.config.title === 'Japan in spring (updated)', `@${w} Update page pushed the page`);
    ok(!(await page.$('#pub[open]')), `@${w} no share sheet`);
    if (SHOTS) await page.locator('.b-top').screenshot({ path: `${SHOTS}/save-live-${w}.png` });
    await page.reload(); await page.waitForSelector('[data-save]', { state: 'attached' }); ok(await st() === '', `@${w} after reload: still live, nothing pending`);
    await setTitle(page, 'Japan again'); await page.waitForTimeout(500);
    ok(/Changes not live yet/.test(await st()), `@${w} the next change brings the notice back`);
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
