// Delete from My pages, end to end against the real Supabase project (a throwaway user, deleted with its rows at the end;
// no one else's data is touched). Signed in: Delete on the home list and on #mine removes the account row and the device copy.
// Deleted while signed out: the account row goes on the next sign-in, and sign-in never uploads or pulls it back.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/page-delete.js
//   (needs the Management API token in secrets/supabase-pat, read here and never printed)
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
const PAT = fs.readFileSync(process.env.SUPABASE_PAT_FILE || __dirname + '/../../../../secrets/supabase-pat', 'utf8').trim();
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TS = Date.now().toString(36);
const EMAIL = `ep-delete-${TS}@example.com`; const PASS = 'T' + Math.random().toString(36).slice(2) + 'x9!';

(async () => {
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key;
  const admin = (path, init = {}) => fetch(SBURL + path, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const rows = async () => { if (!/^[0-9a-f-]{36}$/.test(USER_ID)) throw new Error('bad user id'); const x = await sql(`select id, slug, config from public.events where owner = '${USER_ID}'`); if (!Array.isArray(x)) throw new Error('query failed'); return x; };
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 500)); } };
  const u = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }) })).json();
  var USER_ID = u.id; ok(!!USER_ID, 'throwaway user created');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|functions\/v1/, r => r.abort());
    const page = await ctx.newPage(); const err = []; page.on('pageerror', e => err.push(String(e)));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    const signIn = () => page.evaluate(async ([e, p]) => { const c = await window.__ep.sb(); const r = await c.auth.signInWithPassword({ email: e, password: p }); localStorage.setItem('ep:signedIn', 'true'); return !!(r.data && r.data.session); }, [EMAIL, PASS]);
    const signOut = () => page.evaluate(async () => { const c = await window.__ep.sb(); await c.auth.signOut(); localStorage.removeItem('ep:signedIn'); });
    // a page made on this device (as setup leaves it); signed in, the next sync uploads it as its own row
    const make = async (title) => {
      await page.evaluate((t) => { const xs = JSON.parse(localStorage.getItem('ep:pages') || '[]'); xs.unshift({ pid: 'p' + Math.random().toString(36).slice(2, 10), cfg: { ...JSON.parse(JSON.stringify(window.EXAMPLES['chicago-10k'])), title: t }, url: '', hosted: null, updated: Date.now() }); localStorage.setItem('ep:pages', JSON.stringify(xs)); }, title);
      await page.evaluate(() => window.__ep.acctSyncAll());
      const r = await until(async () => (await rows()).find(r => r.config.title === title), 20000);
      await until(() => page.evaluate((t) => !!window.__ep.pagesAll().find(x => x.cfg.title === t && x.hosted && x.hosted.id), title)); return r; };
    const confirmDelete = async (sel) => { await page.click(sel); await page.waitForSelector('#confirmdlg[open]'); await page.click('#confirmdlg button[value="ok"]'); };
    const local = () => page.evaluate(() => JSON.parse(localStorage.getItem('ep:pages') || '[]').map(x => x.cfg.title));

    ok(await signIn(), 'signed in');
    const A = `Del home ${TS}`, Bt = `Del mine ${TS}`, C = `Del offline ${TS}`, K = `Keep ${TS}`;
    const ra = await make(A), rb = await make(Bt), rc = await make(C), rk = await make(K);
    ok(ra && rb && rc && rk && new Set([ra, rb, rc, rk].map(r => r && r.id)).size === 4, 'four account pages saved (four rows)');

    // 1. signed in, home list
    await page.goto(BASE + '?h1#'); await page.waitForSelector('#my-pages');
    const pidA = await page.evaluate((t) => window.__ep.pagesAll().find(x => x.cfg.title === t).pid, A);
    await confirmDelete(`[data-mp-del="${pidA}"]`);
    ok(!!(await until(async () => !(await rows()).some(r => r.id === ra.id))), 'home Delete → account row gone');
    ok(!(await local()).includes(A), 'home Delete → device copy gone');

    // 2. signed in, #mine list
    await page.goto(BASE + '?m1#mine'); await page.waitForSelector('.mine-list');
    await confirmDelete(`[data-mine-del="${rb.id}"]`);
    await page.waitForFunction((t) => !document.querySelector('.mine-list')?.textContent.includes(t), Bt, { timeout: 15000 });
    ok(!(await rows()).some(r => r.id === rb.id), '#mine Delete → account row gone');
    ok(!(await local()).includes(Bt), '#mine Delete → device copy gone');

    // 3. signed out: delete C on this device; sign in → row deleted, not pulled back down, not re-uploaded
    await signOut(); await page.goto(BASE + '?h2#'); await page.waitForSelector('#my-pages');
    const pidC = await page.evaluate((t) => window.__ep.pagesAll().find(x => x.cfg.title === t).pid, C);
    await confirmDelete(`[data-mp-del="${pidC}"]`); await page.waitForTimeout(400);
    ok(!(await local()).includes(C) && (await rows()).some(r => r.id === rc.id), 'signed out: gone here, row still on the account until sign-in');
    ok(await signIn(), 'signed in again');
    await page.evaluate(() => window.__ep.acctSyncAll());
    ok(!!(await until(async () => !(await rows()).some(r => r.id === rc.id))), 'sign-in sync deletes the row');
    await page.goto(BASE + '?m2#mine'); await page.waitForSelector('.mine-list');
    const ls = await local(), rr = (await rows()).map(r => r.config.title);
    ok(!ls.some(t => [A, Bt, C].includes(t)) && ls.includes(K), 'device list after sign-in: ' + ls.join(' | '));
    ok(rr.length === 1 && rr[0] === K, 'account rows after sign-in: ' + rr.join(' | '));
    ok(!err.length, 'no page errors ' + err.join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
    if (USER_ID) {
      await admin(`/auth/v1/admin/users/${USER_ID}`, { method: 'DELETE' });
      const left = await rows().catch(() => null);
      const gone = (await admin(`/auth/v1/admin/users/${USER_ID}`)).status === 404;
      ok(Array.isArray(left) && left.length === 0 && gone, 'cleanup: throwaway user and its rows deleted');
    }
  }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
