// Pages live on the account, end to end against the real Supabase project (a throwaway user, deleted with its rows at
// the end). Signed in: a page is on the account as soon as it's made (not shared), every edit is saved there a moment
// later, and once shared the short link shows each edit with no button; pages made on a device signed out are uploaded
// when you sign in; an old long link (#e=) becomes an account page with "Save to My pages" (the owner's own page keeps
// one row and goes live; anyone else gets their own unshared copy); two browsers signed in as the same user list the
// same My pages.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/autosave-account.js
//   (needs the Management API token in secrets/supabase-pat, read here and never printed)
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
const PAT = fs.readFileSync(process.env.SUPABASE_PAT_FILE || __dirname + '/../../../../secrets/supabase-pat', 'utf8').trim();
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TS = Date.now().toString(36);
const EMAIL = `ep-autosave-${TS}@example.com`; const PASS = 'T' + Math.random().toString(36).slice(2) + 'x9!';
const PUB = 'sb_publishable_JHJJ_LFXQUBClNc68Eyi_A_b6se1P_a';

(async () => {
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key;
  const admin = (path, init = {}) => fetch(SBURL + path, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  // the events table is granted to anon/authenticated only: read it as the database owner over the Management API
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const rows = async () => { if (!/^[0-9a-f-]{36}$/.test(USER_ID)) throw new Error('bad user id'); const x = await sql(`select id, slug, config, published, updated_at from public.events where owner = '${USER_ID}' order by updated_at desc`); if (!Array.isArray(x)) throw new Error('query failed'); return x; };
  const anon = async (slug) => (await fetch(`${SBURL}/rest/v1/events?slug=eq.${slug}&select=slug,config`, { headers: { apikey: PUB } })).json();
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 500)); } };
  const u = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }) })).json();
  var USER_ID = u.id; ok(!!USER_ID, 'throwaway user created');
  const browser = await chromium.launch();
  try {
    const mk = async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      await ctx.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|functions\/v1/, r => r.abort());
      const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
      await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
      return { ctx, page };
    };
    const signIn = (page) => page.evaluate(async ([e, p]) => { const c = await window.__ep.sb(); const r = await c.auth.signInWithPassword({ email: e, password: p }); localStorage.setItem('ep:signedIn', 'true'); return !!(r.data && r.data.session); }, [EMAIL, PASS]);
    const setTitle = (page, v) => page.evaluate((v) => { const i = document.querySelector('#f-title'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    const saved = (page) => page.waitForFunction(() => document.querySelector('[data-save]').textContent.trim() === 'Saved', null, { timeout: 15000 });

    // ---- 1. browser A, signed in: create → the row exists (not shared); Share; edit → the short link shows it, no button ----
    const A = await mk();
    ok(await signIn(A.page), 'A: signed in');
    await A.page.goto(BASE + '#edit-ex=japan-trip'); await A.page.waitForSelector('.b-form');
    const T1 = `Autosave trip ${TS}`; await setTitle(A.page, T1); await saved(A.page);
    let rs = await until(async () => { const x = await rows(); return x.find(r => r.config.title === T1) && x; });
    const r1 = rs && rs.find(r => r.config.title === T1);
    ok(!!r1 && r1.published === false, 'create → the row exists on the account, not shared');
    ok(rs && rs.length === 1, `one row for the page (${rs && rs.length})`);
    ok(r1 && (await anon(r1.slug)).length === 0, 'not shared: the public can’t read it');
    await A.page.click('.b-top [data-act="publish"]'); await A.page.waitForSelector('#pub .pub-host.ok', { timeout: 30000 });
    const short = await A.page.inputValue('#pub-url');
    ok(r1 && short.endsWith('?e=' + r1.slug), 'Share → the same row’s short link ' + short);
    ok((await anon(r1.slug)).length === 1, 'shared: the public can read it');
    await A.page.click('#pub button.ghost');
    const T2 = T1 + ' (edited)'; await setTitle(A.page, T2); await saved(A.page);
    ok(!(await A.page.$('[data-act="update-live"]')) && !/not live|Update page/.test(await A.page.textContent('.builder')), 'no Update page / not live anywhere in the builder');
    const pub = await until(async () => { const x = await anon(r1.slug); return x[0] && x[0].config.title === T2 && x; });
    ok(!!pub, 'edit → the public short link has it (no button)');
    const G = await mk(); await G.page.goto(short); await G.page.waitForSelector('.ev-hero');
    ok((await G.page.textContent('.ev-hero')).includes(T2) && /Edit a copy/.test(await G.page.textContent('.vbar')), 'a guest browser opening the short link sees the edit');
    await G.ctx.close();

    // ---- 2. browser B: a page made signed out stays on the device, then is uploaded on sign-in ----
    const B = await mk();
    const T3 = `Device draft ${TS}`;
    const DCFG = { v: 2, type: 'Trip', title: T3, start: '2027-06-01', end: '2027-06-05', venue: { name: 'Kyoto', address: 'Kyoto', lat: 35.01, lon: 135.77, city: 'Kyoto', country: 'Japan', cc: 'jp' } };
    await B.page.evaluate((c) => localStorage.setItem('ep:pages', JSON.stringify([{ pid: 'pdev', cfg: c, url: '', hosted: null, updated: Date.now() }])), DCFG);
    await B.page.goto(BASE + '#page=pdev'); await B.page.waitForSelector('.b-form'); await B.page.waitForTimeout(1500);
    ok(!(await rows()).some(r => r.config.title === T3), 'signed out: the page is only on the device');
    ok(await signIn(B.page), 'B: signed in');
    await B.page.goto(BASE + '#mine'); await B.page.waitForSelector('.mine-list', { timeout: 30000 });
    ok((await B.page.textContent('.mine-list')).includes(T3), 'after sign-in: My pages lists the device page');
    rs = await rows(); const r3 = rs.find(r => r.config.title === T3);
    ok(!!r3 && r3.published === false, 'it was uploaded to the account (not shared)');

    // ---- 3. long links: someone else's → their own unshared copy; the owner's own → the same row, live ----
    const LCFG = { v: 2, type: 'Trip', title: `Long link trip ${TS}`, start: '2027-07-01', end: '2027-07-04', venue: { name: 'Osaka', address: 'Osaka', lat: 34.69, lon: 135.5, city: 'Osaka', country: 'Japan', cc: 'jp' } };
    const longUrl = await A.page.evaluate((c) => location.origin + location.pathname + '#e=' + window.__ep.packEvent(c), LCFG);
    await A.page.goto(BASE + '?x#'); await A.page.goto(longUrl); await A.page.waitForSelector('.ev-hero');
    ok(!!(await A.page.$('.vbar [data-save-mine]')), 'signed in on a long link: Save to My pages');
    await A.page.click('.vbar [data-save-mine]'); await A.page.waitForURL(/\?e=/, { timeout: 30000 }); await A.page.waitForSelector('.ev-hero');
    rs = await rows(); const r4 = rs.find(r => r.config.title === LCFG.title);
    ok(!!r4 && A.page.url().endsWith('?e=' + r4.slug) && r4.published === false, 'Save to My pages → account copy, URL switched to its short link (not shared: it isn’t this user’s page) ' + A.page.url());
    ok(/Only you can see this page/.test(await A.page.textContent('.viewer')) && /Edit page/.test(await A.page.textContent('.vbar')), 'its owner sees it at the short link: Only you can see this page, Edit page');
    // the owner's own page shared earlier as a long link from browser B
    const own = await B.page.evaluate(() => JSON.parse(localStorage.getItem('ep:pages')).find(x => x.pid === 'pdev').cfg);
    const ownLong = await B.page.evaluate((c) => location.origin + location.pathname + '#e=' + window.__ep.packEvent(c), own);
    await B.page.evaluate((u) => { const xs = JSON.parse(localStorage.getItem('ep:pages')); xs.find(x => x.pid === 'pdev').url = u; localStorage.setItem('ep:pages', JSON.stringify(xs)); }, ownLong);
    await B.page.goto(BASE + '?x#'); await B.page.goto(ownLong); await B.page.waitForSelector('.vbar [data-save-mine]');
    await B.page.click('.vbar [data-save-mine]'); await B.page.waitForURL(/\?e=/, { timeout: 30000 }); await B.page.waitForSelector('.ev-hero');
    rs = await rows(); const same = rs.filter(r => r.config.title === T3);
    ok(same.length === 1 && same[0].published === true && B.page.url().endsWith('?e=' + same[0].slug), 'owner’s long link → the same row (no duplicate), now live at its short link');
    ok((await anon(same[0].slug)).length === 1, 'the public can open it');
    // the same long link opened in a browser without the device draft (A, same account) joins that page instead of copying it
    await A.page.goto(BASE + '?x#'); await A.page.goto(ownLong); await A.page.waitForSelector('.vbar [data-save-mine]');
    await A.page.click('.vbar [data-save-mine]'); await A.page.waitForURL(/\?e=/, { timeout: 30000 });
    ok((await rows()).filter(r => r.config.title === T3).length === 1 && A.page.url().endsWith('?e=' + same[0].slug), 'from the other browser: same page, same short link');

    // ---- 4. two browsers, same user: the same My pages ----
    const list = async (p) => { await p.goto(BASE + '?y#mine'); await p.waitForSelector('.mine-list', { timeout: 30000 }); return (await p.$$eval('.mine-list li b', bs => bs.map(b => b.textContent))).sort(); };
    const la = await list(A.page), lb = await list(B.page);
    ok(la.length === 3 && JSON.stringify(la) === JSON.stringify(lb), `A and B list the same pages: ${la.join(' | ')}`);
    await A.page.goto(BASE + '?z#'); await A.page.waitForSelector('#my-pages');
    await A.page.waitForFunction((t) => document.querySelector('#my-pages').textContent.includes(t), T3, { timeout: 15000 });
    ok(!/on this device/.test(await A.page.textContent('#my-pages h2')), 'home list on A has B’s page too (one account list)');
    ok(!A.page._err.length && !B.page._err.length, 'no page errors ' + A.page._err.concat(B.page._err).join(' | '));
    await A.ctx.close(); await B.ctx.close();
  } finally {
    await browser.close();
    if (USER_ID) {
      await admin(`/auth/v1/admin/users/${USER_ID}`, { method: 'DELETE' }); // its pages go with it (events.owner … on delete cascade)
      const left = await rows().catch(() => null);
      const gone = (await admin(`/auth/v1/admin/users/${USER_ID}`)).status === 404;
      ok(Array.isArray(left) && left.length === 0 && gone, 'cleanup: throwaway user and its rows deleted');
    }
  }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
