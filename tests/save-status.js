// Builder save clarity: the top bar only ever says "Saving…" then "Saved". Signed out, Saved is this device; signed in,
// Saved means the account has it (~2 s after the last change), and on a shared page that is also what guests see — there
// is no "Changes not live yet", Update page or "Live ✓". If the account save fails, it says "Saved on this device". 390 + 320.
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
  const q = (tbl) => { const st = { filters: [] };
    const b = { select: () => b, eq: (k, v) => { st.filters.push([k, v]); return b; }, order: () => b, limit: () => b, in: () => b, single: () => b, maybeSingle: () => { st.single = true; return b; },
      upsert: async () => ({ error: null }), delete: () => ({ eq: () => ({ not: async () => ({}) }) }), update: (row) => { st.op = 'update'; st.row = row; return b; }, insert: (row) => { st.op = 'insert'; st.row = row; return b; },
      then: (res, rej) => Promise.resolve().then(() => {
        if (localStorage.getItem('mock-fail') && st.op) return { data: null, error: { message: 'offline' } };
        if (st.op === 'update') { window.__pushed.push({ tbl, row: st.row, v: st.filters[0][1] }); return { data: [{ id: st.filters[0][1], slug: 'japan-trip-ab2cd', published: true }], error: null }; }
        if (st.op === 'insert') { window.__pushed.push({ tbl, row: st.row, v: 'insert' }); return { data: { id: 'e1', slug: 'japan-trip-ab2cd', published: false }, error: null }; }
        return { data: st.single ? null : [], error: null };
      }).then(res, rej) };
    return b; };
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
    // signed out
    await page.goto(BASE + '#edit-ex=japan-trip'); await page.waitForSelector('[data-save]', { state: 'attached' });
    ok(await st() === '', `@${w} nothing to say before a change`);
    await setTitle(page, 'Japan in spring 2027'); await page.waitForTimeout(60);
    ok(/Saving…/.test(await st()), `@${w} Saving… right after a change`);
    await page.waitForTimeout(500); ok(await st() === 'Saved', `@${w} signed out: then Saved: ${await st()}`);
    ok(!(await page.evaluate(() => window.__pushed.length)), `@${w} signed out: nothing sent anywhere`);
    // signed in, the page already shared
    const pid = await page.evaluate(() => localStorage.getItem('ep:draftId').replace(/"/g, ''));
    await page.evaluate((pid) => { const xs = JSON.parse(localStorage.getItem('ep:pages')); xs.find(x => x.pid === pid).hosted = { id: 'e1', slug: 'japan-trip-ab2cd', pub: true }; localStorage.setItem('ep:pages', JSON.stringify(xs)); localStorage.setItem('ep:signedIn', 'true'); }, pid);
    await page.goto(BASE + '#page=' + pid); await page.reload(); await page.waitForSelector('[data-save]', { state: 'attached' });
    await page.waitForFunction(() => window.__pushed.length >= 1); await page.evaluate(() => { window.__pushed = []; }); // opening it syncs it once
    await setTitle(page, 'Japan in spring (updated)'); await page.waitForTimeout(800);
    ok(await st() === 'Saving…', `@${w} signed in: Saving… until the account has it: ${await st()}`);
    await page.waitForFunction(() => document.querySelector('[data-save]').textContent.trim() === 'Saved', null, { timeout: 8000 });
    const pushed = await page.evaluate(() => window.__pushed); if (pushed.length !== 1) console.log(JSON.stringify(pushed).slice(0, 600));
    ok(pushed.length === 1 && pushed[0].tbl === 'events' && pushed[0].v === 'e1' && pushed[0].row.config.title === 'Japan in spring (updated)' && pushed[0].row.published === undefined, `@${w} the change went to the same row (config only)`);
    ok(!/not live|Update page|Live/.test(await page.textContent('.b-top')) && !(await page.$('[data-act="update-live"]')) && !(await page.$('#pub[open]')), `@${w} no Update page / not live / Live ✓, no share sheet`);
    const of = await overflow(page); ok(of.length === 0, `@${w} top bar fits ${of.join(' ')}`);
    if (SHOTS) await page.locator('.b-top').screenshot({ path: `${SHOTS}/save-saved-${w}.png` });
    // the account save fails (offline): honest about where it is
    await page.evaluate(() => localStorage.setItem('mock-fail', '1'));
    await setTitle(page, 'Japan again');
    await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('[data-save]').textContent), null, { timeout: 8000 });
    ok(true, `@${w} failed account save → Saved on this device`);
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
