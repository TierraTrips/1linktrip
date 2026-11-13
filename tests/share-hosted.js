// Share = the page's one short link, always current. Signed in, every page is saved to the account as you edit (no
// "Update page", no "Changes not live yet"); Share publishes it and hands out ?e=<slug>, and later edits reach that same
// link on their own. Signed out: "Sign in to share", with a small "Share without signing in" (a one-time long link
// that says it won't show later edits). The organizer's own long link offers "Save to My pages" (sign in first when
// needed), which gives it the short link; other guests on a long link see the page as before. Any failure says why.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/share-hosted.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const CFG = { v: 2, type: 'Trip', title: 'Share test trip', start: '2027-04-25', end: '2027-05-02', venue: { name: 'Tokyo', address: 'Tokyo', lat: 35.68, lon: 139.76, city: 'Tokyo', country: 'Japan', cc: 'jp' }, cover: '' };

// in-memory stand-in for supabase-js: events insert/update/select/delete under RLS-like rules, a session from localStorage['mock-user']
function fakeSupabase() {
  const db = () => JSON.parse(localStorage.getItem('mock-events') || '[]'); const put = (xs) => localStorage.setItem('mock-events', JSON.stringify(xs));
  const user = () => { const u = localStorage.getItem('mock-user'); return u ? JSON.parse(u) : null; };
  const val = (r, k) => k.includes('->>') ? ((r[k.split('->>')[0]] || {})[k.split('->>')[1]]) : r[k];
  const q = (table) => { const st = { op: 'select', filters: [], single: false };
    const run = async () => {
      if (table !== 'events') return { data: [], error: null };
      const fail = localStorage.getItem('mock-fail'); if (fail && st.op !== 'select') return { data: null, error: { message: fail, code: '42501' } };
      const u = user(); let xs = db(); const match = (r) => st.filters.every(([k, v]) => val(r, k) === v);
      const visible = (r) => r.published || (u && r.owner === u.id); const mine = (r) => u && r.owner === u.id;
      const log = (o) => { window.__ops = (window.__ops || []).concat(o); };
      if (st.op === 'insert') { if (!u) return { data: null, error: { message: 'not signed in' } }; const r = { id: 'ev' + (xs.length + 1), owner: u.id, published: true, ...st.row, updated_at: new Date().toISOString() }; xs.push(r); put(xs); log('insert'); return { data: st.single ? r : [r], error: null }; }
      if (st.op === 'update') { const hit = xs.filter(r => match(r) && mine(r)); hit.forEach(r => Object.assign(r, st.row, { updated_at: new Date().toISOString() })); put(xs); log('update'); return { data: hit, error: null }; }
      if (st.op === 'delete') { put(xs.filter(r => !(match(r) && mine(r)))); log('delete'); return { data: null, error: null }; }
      const hit = xs.filter(r => match(r) && visible(r)); return { data: st.single ? hit[0] || null : hit, error: null };
    };
    const b = { select() { return b; }, eq(k, v) { st.filters.push([k, v]); return b; }, order() { return b; }, limit() { return b; }, in() { return b; },
      insert(row) { st.op = 'insert'; st.row = row; return b; }, update(row) { st.op = 'update'; st.row = row; return b; }, delete() { st.op = 'delete'; return b; }, single() { st.single = true; return b; }, maybeSingle() { st.single = true; return b; },
      then(res, rej) { return run().then(res, rej); } };
    return b; };
  window.supabase = { createClient: () => ({ from: q, storage: { from: () => ({}) }, functions: { invoke: async () => ({ data: null, error: { message: 'off' } }) }, rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => { const u = user(); return { data: { session: u ? { user: u, access_token: 'a.b.c' } : null } }; }, signInWithOtp: async () => ({ error: null }), signOut: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
}

(async () => {
  const browser = await chromium.launch();
  const USER = { id: 'u0000000-0000-4000-8000-0000000000aa', email: 'host@example.com' };
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript(fakeSupabase);
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|functions\/v1|auth\/v1/, r => r.abort());
    // guests read a hosted page over plain REST (anon: published rows only), from the same in-memory store
    await ctx.route(/\/rest\/v1\/events/, async r => { const slug = (r.request().url().match(/slug=eq\.([^&]+)/) || [])[1]; const xs = JSON.parse(await (ctx._ev || (() => '[]'))()); r.fulfill({ contentType: 'application/json', body: JSON.stringify(xs.filter(x => x.slug === slug && x.published)) }); });
    await ctx.route(/\/rest\/v1\/(?!events)/, r => r.fulfill({ contentType: 'application/json', body: '[]' }));
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
    ctx._ev = () => page.evaluate(() => localStorage.getItem('mock-events') || '[]');
    return { ctx, page };
  };
  const seed = (page, pages, user) => page.evaluate(([pages, user]) => { localStorage.clear(); localStorage.setItem('ep:pages', JSON.stringify(pages)); if (user) { localStorage.setItem('mock-user', JSON.stringify(user)); localStorage.setItem('ep:signedIn', 'true'); } }, [pages, user]);
  const status = (page) => page.textContent('[data-save]');
  const edit = async (page, title) => { await page.evaluate((v) => { const i = document.querySelector('#f-title'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, title); };
  const visible = (page, sel) => page.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight)).catch(() => false);
  const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ep:pages'))[0]);
  const events = async (page) => JSON.parse(await page.evaluate(() => localStorage.getItem('mock-events') || '[]'));
  const noOldUI = async (page, where) => { const txt = await page.textContent('body'); ok(!/not live|Update page|Make this link updatable|Share new link/.test(txt), `${where}: no "not live" / Update page / Make this link updatable`); };

  // ---- 1. signed in: the page is on the account before any Share; Share → short link; edits reach it with no button ----
  {
    const { ctx, page } = await mk();
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await seed(page, [{ pid: 'p1', cfg: CFG, url: '', hosted: null, updated: 1 }], USER);
    await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('mock-events') || '[]')).length === 1, null, { timeout: 10000 });
    let ev = await events(page);
    ok(ev.length === 1 && ev[0].published === false && ev[0].config.title === CFG.title, 'opening the page saved it to the account, not shared yet');
    ok(!!ev[0].config.ek, 'page key stored with it (matches the same page from other devices)');
    await page.click('.b-top [data-act="publish"]');
    await page.waitForSelector('#pub .pub-host.ok', { timeout: 20000 });
    const url = await page.inputValue('#pub-url');
    ok(/\?e=share-test-trip-[a-z0-9]{5}$/.test(url), 'Share gives the short link ' + url);
    ok(!/#e=/.test(url), 'no long link handed out');
    ok(/automatically/.test(await page.textContent('#pub .pub-host')), 'sheet: edits show up on this link automatically');
    ev = await events(page); ok(ev.length === 1 && ev[0].published === true && url.endsWith(ev[0].slug), 'Share published the same row (no second page)');
    let r = await rec(page); ok(r.hosted && r.hosted.slug === ev[0].slug && r.hosted.pub, 'device copy knows its link');
    await page.click('#pub button.ghost'); // Close
    await page.waitForSelector('.b-host'); ok(/Your link/.test(await page.textContent('.b-host')), 'builder: Your link: ?e=…');
    await edit(page, 'Share test trip 2');
    ok(/Saving…/.test(await status(page)), 'edit → Saving…');
    await page.waitForFunction(() => document.querySelector('[data-save]').textContent.trim() === 'Saved', null, { timeout: 10000 });
    ok(true, 'then Saved (no Update page, no "not live")');
    await noOldUI(page, 'builder');
    ev = await events(page);
    ok(ev.length === 1 && ev[0].config.title === 'Share test trip 2', 'the edit is on the row');
    ok((await page.evaluate(() => window.__ops)).filter(x => x === 'insert').length === 1, 'one insert in all');
    await page.goto(BASE + '?e=' + ev[0].slug); await page.waitForSelector('.ev-hero');
    ok(/Share test trip 2/.test(await page.textContent('.ev-hero')), 'the short link shows the edit');
    ok(!(await page.$('.own-stale')), 'shared page: no owner bar');
    await noOldUI(page, 'short link');
    await page.goto(BASE + '?x#'); await page.waitForSelector('.mp-list');
    ok(/shared/.test(await page.textContent('.mp-list .mp-t span')) && !/on this device/.test(await page.textContent('#my-pages h2')), 'My pages: shared, one account list');
    await noOldUI(page, 'My pages');
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }

  // ---- 2. signed out: Sign in to share; the long-link option says it won't update; the owner's own long link → Save to My pages ----
  let longUrl = '';
  {
    const { ctx, page } = await mk();
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await seed(page, [{ pid: 'p1', cfg: CFG, url: '', hosted: null, updated: 1 }], null);
    await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
    await page.click('.b-top [data-act="publish"]'); await page.waitForSelector('#pub .signin');
    ok(/Sign in to share/.test(await page.textContent('#pub .pub-host')), 'signed out: "Sign in to share"');
    ok(!(await visible(page, '#pub-url')) && !(await visible(page, '#pub [data-act="copy"]')), 'no link or Copy until a choice is made');
    ok(!!(await page.$('#pub [data-ph="long"]')) && /won’t show later edits/.test(await page.textContent('#pub .pub-host')), 'secondary: Share without signing in (won’t show later edits)');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/share-signin-390.png' });
    await page.click('#pub [data-ph="long"]');
    longUrl = await page.inputValue('#pub-url');
    ok(/#e=/.test(longUrl) && await visible(page, '#pub-url') && await visible(page, '#pub [data-act="copy"]'), 'long link shown with Copy');
    let r = await rec(page); ok(r.url === longUrl && !r.hosted, 'page records the long link');
    await page.click('#pub button.ghost');
    await edit(page, 'Share test trip edited'); await page.waitForTimeout(600);
    ok((await status(page)).trim() === 'Saved', 'signed out edit → Saved');
    await noOldUI(page, 'builder after a long link');
    // the owner opens the long link: one button, Save to My pages
    await page.goto(longUrl); await page.waitForSelector('.ev-hero');
    ok(!!(await page.$('.vbar [data-save-mine]')) && !(await page.$('.own-stale')), 'owner on own long link: Save to My pages, nothing else');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/long-save-390.png' });
    await page.click('.vbar [data-save-mine]'); await page.waitForSelector('#sidlg[open] .signin');
    ok(/Sign in to save/.test(await page.textContent('#sidlg')), 'signed out: Save asks to sign in');
    await page.fill('#si-email', 'host@example.com'); await page.click('#sidlg [data-si="send"]'); await page.waitForSelector('#sidlg .signin.sent');
    ok((await page.evaluate(() => JSON.parse(localStorage.getItem('ep:pendingSave')))).packed === longUrl.split('#e=')[1], 'sending the sign-in link remembers to save this page after sign-in');
    // signed in now (stand-in for the magic link): Save → the page joins the account with its short link, URL switches to it
    await page.evaluate((u) => { localStorage.setItem('mock-user', JSON.stringify(u)); }, USER);
    await page.click('#sidlg [data-si-close]');
    await page.click('.vbar [data-save-mine]'); await page.waitForURL(/\?e=/, { timeout: 15000 }); await page.waitForSelector('.ev-hero');
    const ev = await events(page);
    ok(ev.length === 1 && ev[0].published === true && page.url().endsWith('?e=' + ev[0].slug), 'Save to My pages → short link, live (its long link was already shared) ' + page.url());
    ok(ev[0].config.title === 'Share test trip edited', 'the saved page is the latest version from this device');
    ok(/Edit page/.test(await page.textContent('.vbar')), 'the short link is the owner’s page (Edit page)');
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }

  // ---- 3. a guest opening that long link sees no owner UI ----
  {
    const { ctx, page } = await mk();
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    await page.goto(longUrl); await page.waitForSelector('.ev-hero');
    ok(!(await page.$('.own-stale')) && !(await page.$('[data-save-mine]')) && /Edit a copy/.test(await page.textContent('.vbar')), 'guest: no owner UI, Edit a copy');
    await ctx.close();
  }

  // ---- 4. failure: the reason shows, never silent; autosave failure keeps the device copy and says so ----
  {
    const { ctx, page } = await mk();
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await seed(page, [{ pid: 'p1', cfg: CFG, url: '', hosted: null, updated: 1 }], USER);
    await page.evaluate(() => localStorage.setItem('mock-fail', 'new row violates row-level security policy'));
    await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
    await page.click('.b-top [data-act="publish"]'); await page.waitForSelector('#pub .pub-host[role="alert"]', { timeout: 20000 });
    ok(/row-level security/.test(await page.textContent('#toast')) && /Couldn’t share/.test(await page.textContent('#toast')), 'toast says why: ' + await page.textContent('#toast'));
    ok(/row-level security/.test(await page.textContent('#pub .pub-host')) && !!(await page.$('#pub [data-ph="go"]')), 'sheet: reason + Try again');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/share-error-390.png' });
    await page.click('#pub button.ghost');
    await edit(page, 'Share test trip 3');
    await page.waitForFunction(() => /Saved on this device/.test(document.querySelector('[data-save]').textContent), null, { timeout: 10000 });
    ok(true, 'autosave failure → Saved on this device');
    await page.evaluate(() => localStorage.removeItem('mock-fail'));
    await page.click('.b-top [data-act="publish"]'); await page.waitForSelector('#pub .pub-host.ok', { timeout: 20000 });
    ok(/\?e=/.test(await page.inputValue('#pub-url')), 'Try again → short link');
    const ev = await events(page); ok(ev.length === 1 && ev[0].config.title === 'Share test trip 3', 'the page saved on this device went up with it');
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
