// "I can't find Update page": Share used to hand out the long (#e=) link first and made the short link a second, optional
// button, so no page was ever hosted and later edits never reached the link guests had. Now Share makes the short link
// (?e=<slug>) whenever it can: signed in → straight to it; signed out → "Sign in to get a link you can update later", or
// "Share without signing in" for a one-time long link that says edits need a new link. A page already shared as a long
// link shows "Changes not live yet · Share new link" after edits and offers "Make this link updatable"; the owner's own
// long link says when it's behind. Any publish failure shows its reason (toast + the sheet), never silently.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/share-hosted.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const CFG = { v: 2, type: 'Trip', title: 'Share test trip', start: '2027-04-25', end: '2027-05-02', venue: { name: 'Tokyo', address: 'Tokyo', lat: 35.68, lon: 139.76, city: 'Tokyo', country: 'Japan', cc: 'jp' }, cover: '' };

// in-memory stand-in for supabase-js: events insert/update/select, a session that follows localStorage['mock-user']
function fakeSupabase() {
  const db = () => JSON.parse(localStorage.getItem('mock-events') || '[]'); const put = (xs) => localStorage.setItem('mock-events', JSON.stringify(xs));
  const user = () => { const u = localStorage.getItem('mock-user'); return u ? JSON.parse(u) : null; };
  const q = (table) => { const st = { op: 'select', filters: [], single: false };
    const run = async () => {
      if (table !== 'events') return { data: [], error: null };
      const fail = localStorage.getItem('mock-fail'); if (fail && st.op !== 'select') return { data: null, error: { message: fail, code: '42501' } };
      let xs = db(); const match = (r) => st.filters.every(([k, v]) => r[k] === v);
      if (st.op === 'insert') { const u = user(); if (!u) return { data: null, error: { message: 'not signed in' } }; const r = { id: 'ev' + (xs.length + 1), owner: u.id, published: true, updated_at: new Date().toISOString(), ...st.row }; xs.push(r); put(xs); window.__ops = (window.__ops || []).concat('insert'); return { data: st.single ? r : [r], error: null }; }
      if (st.op === 'update') { const hit = xs.filter(match); hit.forEach(r => Object.assign(r, st.row)); put(xs); window.__ops = (window.__ops || []).concat('update'); return { data: hit, error: null }; }
      const hit = xs.filter(match); return { data: st.single ? hit[0] || null : hit, error: null };
    };
    const b = { select() { return b; }, eq(k, v) { st.filters.push([k, v]); return b; }, order() { return b; }, limit() { return b; }, in() { return b; },
      insert(row) { st.op = 'insert'; st.row = row; return b; }, update(row) { st.op = 'update'; st.row = row; return b; }, single() { st.single = true; return b; }, maybeSingle() { st.single = true; return b; },
      then(res, rej) { return run().then(res, rej); } };
    return b; };
  window.supabase = { createClient: () => ({ from: q, storage: { from: () => ({}) }, functions: { invoke: async () => ({ data: null, error: { message: 'off' } }) }, rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => { const u = user(); return { data: { session: u ? { user: u, access_token: 'a.b.c' } : null } }; }, signInWithOtp: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
}

(async () => {
  const browser = await chromium.launch();
  const USER = { id: 'u0000000-0000-4000-8000-0000000000aa', email: 'host@example.com' };
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript(fakeSupabase);
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|functions\/v1|auth\/v1/, r => r.abort());
    // guests read a hosted page over plain REST: serve it from the same in-memory store (the test copies it in)
    await ctx.route(/\/rest\/v1\/events/, async r => { const slug = (r.request().url().match(/slug=eq\.([^&]+)/) || [])[1]; const xs = JSON.parse(await (ctx._ev || (() => '[]'))()); r.fulfill({ contentType: 'application/json', body: JSON.stringify(xs.filter(x => x.slug === slug)) }); });
    await ctx.route(/\/rest\/v1\/(?!events)/, r => r.fulfill({ contentType: 'application/json', body: '[]' }));
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
    ctx._ev = () => page.evaluate(() => localStorage.getItem('mock-events') || '[]');
    return { ctx, page };
  };
  const seed = (page, pages, user) => page.evaluate(([pages, user]) => { localStorage.clear(); localStorage.setItem('ep:pages', JSON.stringify(pages)); if (user) { localStorage.setItem('mock-user', JSON.stringify(user)); localStorage.setItem('ep:signedIn', 'true'); } }, [pages, user]);
  const status = (page) => page.textContent('[data-save]');
  const edit = async (page, title) => { await page.evaluate((v) => { const i = document.querySelector('#f-title'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, title); await page.waitForTimeout(800); };
  const visible = (page, sel) => page.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight)).catch(() => false);
  const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ep:pages'))[0]);

  // ---- 1. signed in: Share → short link, then edit → Update page pushes to the same link ----
  {
    const { ctx, page } = await mk();
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await seed(page, [{ pid: 'p1', cfg: CFG, url: '', hosted: null, updated: 1 }], USER);
    await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
    await page.click('.b-top [data-act="publish"]');
    await page.waitForSelector('#pub .pub-host.ok', { timeout: 20000 });
    const url = await page.inputValue('#pub-url');
    ok(/\?e=share-test-trip-[a-z0-9]{5}$/.test(url), 'signed in: Share gives the short link ' + url);
    ok(await page.textContent('#pub h2') === 'Your short link is ready', 'sheet title: short link ready');
    ok(!/#e=/.test(url), 'no long link handed out');
    ok(/Update page/.test(await page.textContent('#pub .pub-host')), 'sheet explains Update page keeps the link current');
    let r = await rec(page); ok(r.hosted && r.hosted.slug && url.endsWith(r.hosted.slug) && !!r.live, 'page saved as hosted, live recorded');
    ok(!!r.cfg.ek, 'page key pinned on share');
    await page.click('#pub button.ghost'); // Close
    await page.waitForSelector('.b-host'); ok(/Editing your page at/.test(await page.textContent('.b-host')), 'builder: Editing your page at ?e=…');
    await edit(page, 'Share test trip 2');
    ok(/Changes not live yet/.test(await status(page)) && !!(await page.$('[data-save] [data-act="update-live"]')), 'edit → Changes not live yet · Update page');
    await page.click('[data-save] [data-act="update-live"]'); await page.waitForFunction(() => /Live/.test(document.querySelector('[data-save]').textContent));
    const ev = JSON.parse(await page.evaluate(() => localStorage.getItem('mock-events')));
    ok(ev.length === 1 && ev[0].config.title === 'Share test trip 2', 'Update page updated the same row (no second page)');
    ok((await page.evaluate(() => window.__ops)).join() === 'insert,update', 'one insert then an update');
    // the short link shows the change
    await page.goto(BASE + '?e=' + ev[0].slug); await page.waitForSelector('.ev-hero');
    ok(/Share test trip 2/.test(await page.textContent('.ev-hero')), 'short link shows the update');
    ok(!(await page.$('.own-stale')), 'in sync: no owner bar');
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }

  // ---- 2. signed out: sign-in prompt; Share without signing in → long link that says it's a snapshot ----
  let longUrl = '';
  {
    const { ctx, page } = await mk();
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await seed(page, [{ pid: 'p1', cfg: CFG, url: '', hosted: null, updated: 1 }], null);
    await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
    await page.click('.b-top [data-act="publish"]'); await page.waitForSelector('#pub .signin');
    ok(/Sign in to get a link you can update later/.test(await page.textContent('#pub .pub-host')), 'signed out: "Sign in to get a link you can update later"');
    ok(!(await visible(page, '#pub-url')) && !(await visible(page, '#pub [data-act="copy"]')), 'no link or Copy until a choice is made');
    ok(!!(await page.$('#pub [data-ph="long"]')) && /Edits you make later need a new link/.test(await page.textContent('#pub .pub-host')), 'secondary: Share without signing in (edits need a new link)');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/share-signin-390.png' });
    await page.click('#pub [data-ph="long"]');
    longUrl = await page.inputValue('#pub-url');
    ok(/#e=/.test(longUrl) && await visible(page, '#pub-url') && await visible(page, '#pub [data-act="copy"]'), 'long link shown with Copy');
    ok(/snapshot/.test(await page.textContent('#pub .pub-host')) && !!(await page.$('#pub [data-ph="go"]')), 'says it is a snapshot; offers a link you can update');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/share-long-390.png' });
    let r = await rec(page); ok(r.url === longUrl && !!r.shared && !r.hosted, 'page records the long link and what it shows');
    await page.click('#pub button.ghost');
    ok(!/Changes not live yet/.test(await status(page)), 'right after sharing: nothing pending');
    ok(!!(await page.$('.b-long [data-act="make-hosted"]')), 'builder offers Make this link updatable');
    await edit(page, 'Share test trip edited');
    ok(/Changes not live yet/.test(await status(page)) && /Share new link/.test(await status(page)), 'edit after a long link → Changes not live yet · Share new link');
    await page.goto(BASE + '?x#'); await page.waitForSelector('.mp-list');
    ok(/changes not live yet/.test(await page.textContent('.mp-list .mp-t span')), 'My pages card: changes not live yet');
    // the owner opens the long link: told it's behind, Edit page (not Edit a copy)
    await page.goto(longUrl); await page.waitForSelector('.ev-hero');
    ok(/aren’t in this link/.test(await page.textContent('.own-stale').catch(() => '')) && !!(await page.$('.own-stale [data-own-share]')), 'owner on own long link: "Your latest changes aren’t in this link · Share new link"');
    ok(!!(await page.$('.vbar [data-onp-open]')), 'owner gets Edit page on the long link');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/long-own-stale-390.png' });
    // Share new link from that bar while signed out → builder + sign-in prompt
    await page.click('.own-stale [data-own-share]'); await page.waitForSelector('#pub[open] .signin');
    ok(true, 'Share new link opens the share sheet (sign-in first)');
    // sign in, then one tap: Make this link updatable → short link
    await page.evaluate((u) => { localStorage.setItem('mock-user', JSON.stringify(u)); }, USER);
    await page.click('#pub button.ghost');
    await page.click('.b-long [data-act="make-hosted"]'); await page.waitForSelector('#pub .pub-host.ok', { timeout: 20000 });
    const short = await page.inputValue('#pub-url');
    ok(/\?e=share-test-trip-edited-[a-z0-9]{5}$/.test(short), 'Make this link updatable → new short link ' + short);
    await page.click('#pub button.ghost');
    ok(/Editing your page at/.test(await page.textContent('.b-host')) && !(await page.$('.b-long')), 'builder now edits the hosted page');
    ok(!/Changes not live yet/.test(await status(page)), 'nothing pending after publishing');
    // the old long link now points the owner to the page's short link
    await page.goto(BASE + '?x#'); await page.goto(longUrl); await page.waitForSelector('.ev-hero');
    ok(/older link/.test(await page.textContent('.own-stale').catch(() => '')) && (await page.getAttribute('.own-stale a', 'href')) === short, 'old long link → "older link" bar opening the short link');
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }

  // ---- 3. a guest opening that long link sees no owner UI ----
  {
    const { ctx, page } = await mk();
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    await page.goto(longUrl); await page.waitForSelector('.ev-hero');
    ok(!(await page.$('.own-stale')) && /Edit a copy/.test(await page.textContent('.vbar')), 'guest: no owner bar, Edit a copy');
    await ctx.close();
  }

  // ---- 4. a page shared as a long link before this change (no record of what the link shows) ----
  {
    const { ctx, page } = await mk();
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    const oldUrl = await page.evaluate((c) => location.origin + location.pathname + '#e=' + window.__ep.packEvent(c), CFG);
    await seed(page, [{ pid: 'p1', cfg: { ...CFG, cover: 'https://images.unsplash.com/photo-new.jpg' }, url: oldUrl, hosted: null, updated: 1 }], USER);
    await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
    ok(/Changes not live yet/.test(await status(page)) && /Share new link/.test(await status(page)), 'older long-link page with a new cover: Changes not live yet · Share new link');
    ok(!!(await page.$('.b-long [data-act="make-hosted"]')), 'and Make this link updatable');
    await page.goto(oldUrl); await page.waitForSelector('.ev-hero');
    ok(/aren’t in this link/.test(await page.textContent('.own-stale').catch(() => '')), 'its old link tells the owner');
    await page.evaluate((c) => { const xs = JSON.parse(localStorage.getItem('ep:pages')); xs[0].cfg = c; localStorage.setItem('ep:pages', JSON.stringify(xs)); }, CFG);
    await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
    ok(!/Changes not live yet/.test(await status(page)), 'unchanged since that link: nothing pending (no false alarm)');
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }

  // ---- 5. publish failure: the reason shows, never silent ----
  {
    const { ctx, page } = await mk();
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await seed(page, [{ pid: 'p1', cfg: CFG, url: '', hosted: null, updated: 1 }], USER);
    await page.evaluate(() => localStorage.setItem('mock-fail', 'new row violates row-level security policy'));
    await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
    await page.click('.b-top [data-act="publish"]'); await page.waitForSelector('#pub .pub-host[role="alert"]', { timeout: 20000 });
    ok(/row-level security/.test(await page.textContent('#toast')) && /Couldn’t create your short link/.test(await page.textContent('#toast')), 'toast says why: ' + await page.textContent('#toast'));
    ok(/row-level security/.test(await page.textContent('#pub .pub-host')) && !!(await page.$('#pub [data-ph="go"]')) && !!(await page.$('#pub [data-ph="long"]')), 'sheet: reason + Try again + Share without signing in');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/share-error-390.png' });
    await page.evaluate(() => localStorage.removeItem('mock-fail'));
    await page.click('#pub [data-ph="go"]'); await page.waitForSelector('#pub .pub-host.ok', { timeout: 20000 });
    ok(/\?e=/.test(await page.inputValue('#pub-url')), 'Try again → short link');
    // hosted update failure also says why
    await page.click('#pub button.ghost'); await edit(page, 'Share test trip 3');
    await page.evaluate(() => localStorage.setItem('mock-fail', 'JWT expired'));
    await page.click('[data-save] [data-act="update-live"]'); await page.waitForFunction(() => /JWT expired/.test(document.querySelector('#toast').textContent));
    ok(/Changes not live yet/.test(await status(page)), 'failed update keeps Changes not live yet');
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
