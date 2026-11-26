// Page names end to end on the LIVE site (https://1linktrip.com) with a throwaway organizer + page (backed up, deleted):
// the real RPCs under RLS (owner names it, a stranger and anon can't take or change it, rename keeps the alias),
// /<name> via 404.html in headless Chromium, then the Action's link-preview page (<name>.html: status 200 + og tags)
// once it lands, the old name's preview, and cleanup (the Action removes the preview pages on its next run).
// Needs the Supabase PAT (secrets/supabase-pat). Nothing visible; SHOTS=<dir> for screenshots; WAIT_MIN (default 15)
// = how long to wait for the Action.   node tests/page-names-live.js
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const REF = 'mljzoujystouqkmmoemn', SBURL = `https://${REF}.supabase.co`, SITE = 'https://1linktrip.com/';
const PAT = fs.readFileSync(process.env.PAT_FILE || __dirname + '/../../../../secrets/supabase-pat', 'utf8').trim();
const BACKUP = process.env.BACKUP || __dirname + '/../../../eventpages-supabase/backups';
const SHOTS = process.env.SHOTS || ''; const WAIT_MIN = +process.env.WAIT_MIN || 15;
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TS = Date.now().toString(36);
const NAME = `ep-test-${TS}`, NAME2 = `ep-test2-${TS}`, SLUG = `names-e2e-${TS}`;
const O = { email: `bbbot0209+names-${TS}@gmail.com`, pass: 'T!' + TS + 'x9Zq' }, S = { email: `bbbot0209+names2-${TS}@gmail.com`, pass: 'T!' + TS + 'y8Wq' };
const CFG = { v: 2, ek: 'modes:n' + TS, type: 'Party', title: `Names test party ${TS}`, tagline: 'A throwaway page for testing links', start: '2027-02-14', end: '2027-02-14',
  venue: { name: 'Brooklyn Bowl', address: 'Brooklyn, NY', lat: 40.7219, lon: -73.9575, city: 'Brooklyn', country: 'USA', cc: 'us' },
  cover: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Torii_path_with_lantern_at_Fushimi_Inari_Taisha_Shrine%2C_Kyoto%2C_Japan.jpg/1280px-Torii_path_with_lantern_at_Fushimi_Inari_Taisha_Shrine%2C_Kyoto%2C_Japan.jpg',
  schedule: [{ date: '2027-02-14', time: '19:00', title: 'Bowling', note: '' }], tools: { nearby: true, weather: true, travel: true, stay: true, mytrip: true } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const og = (html, p) => (html.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`)) || [])[1] || '';

(async () => {
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key, ANON = keys.find(k => k.name === 'anon').api_key;
  const admin = (p, init = {}) => fetch(SBURL + p, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const ids = [];
  for (const u of [O, S]) { const r = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: u.email, password: u.pass, email_confirm: true }) })).json(); u.id = r.id; ids.push(r.id); }
  ok(ids.every(x => /^[0-9a-f-]{36}$/.test(x || '')), 'throwaway organizer + stranger created');
  const token = async (u) => (await (await fetch(`${SBURL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: u.pass }) })).json()).access_token;
  const api = async (tok, p, body, method = 'POST') => { const r = await fetch(`${SBURL}/rest/v1/${p}`, { method, headers: { apikey: ANON, Authorization: `Bearer ${tok || ANON}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j }; };
  const browser = await chromium.launch();
  let EID = null;
  try {
    const ot = await token(O), st = await token(S);
    const ins = await api(ot, 'events', { slug: SLUG, config: CFG, published: true }); EID = ins.j && ins.j[0] && ins.j[0].id; ok(!!EID, 'throwaway page published');
    // ---- RLS / RPCs live ----
    ok((await api(null, 'rpc/page_name_set', { eid: EID, nm: NAME })).status >= 400, 'anon cannot name a page');
    ok((await api(st, 'rpc/page_name_set', { eid: EID, nm: NAME })).status >= 400, 'a stranger cannot name someone else\'s page');
    ok((await api(ot, 'rpc/page_name_check', { nm: 'admin', eid: EID })).j === 'reserved', 'reserved word');
    ok((await api(ot, 'rpc/page_name_check', { nm: NAME, eid: EID })).j === 'ok', 'available');
    let r = await api(ot, 'rpc/page_name_set', { eid: EID, nm: NAME2 }); ok(r.j === NAME2, 'owner names the page ' + JSON.stringify(r.j));
    r = await api(ot, 'rpc/page_name_set', { eid: EID, nm: NAME }); ok(r.j === NAME, 'owner renames it');
    ok((await api(st, 'rpc/page_name_check', { nm: NAME2, eid: null })).j === 'taken', 'the old name stays taken for others');
    ok((await api(null, 'page_names?select=name')).status >= 400, 'anon cannot read the table');
    ok(JSON.stringify((await api(st, 'page_names?select=name', null, 'GET')).j) === '[]', 'a stranger reads no name rows');
    r = await api(null, 'rpc/page_name_resolve', { nm: NAME2 }); ok(r.j && r.j[0] && r.j[0].slug === SLUG && r.j[0].name === NAME, 'anon resolves the old name to the page + current name');
    // ---- /<name> in the browser (404.html until the preview page lands) ----
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    let res = await page.goto(SITE + NAME + '#t=travel'); console.log(`     /${NAME}: status ${res.status()}`);
    await page.waitForSelector('#ev-root .ev-panel:not([hidden])', { timeout: 30000 }); await page.waitForTimeout(2000);
    ok((await page.textContent('#ev-root')).includes(CFG.title), `/${NAME} opens the page`);
    ok(await page.evaluate(() => location.pathname + location.hash) === `/${NAME}#t=travel`, 'address stays pretty, tab kept');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-name-travel.png` });
    await page.goto(SITE + NAME2); await page.waitForSelector('#ev-root .ev-panel:not([hidden])', { timeout: 30000 }); await page.waitForTimeout(1500);
    ok(await page.evaluate(() => location.pathname) === '/' + NAME, 'old name → current name');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-name-event.png` });
    await page.click('.ev [data-act="share"]'); await page.waitForSelector('#shr-dlg[open]');
    ok(await page.$eval('#shr-dlg [data-shr-p="plan"] input', i => i.value) === SITE + NAME, 'share sheet: the pretty link');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-name-share.png` });
    await page.goto(SITE + '?e=' + SLUG); await page.waitForSelector('#ev-root .ev-panel:not([hidden])', { timeout: 30000 }); ok((await page.textContent('#ev-root')).includes(CFG.title), '?e= link still works');
    ok(!errs.length, 'no page errors ' + errs.join(' | '));
    // ---- the Action's preview page ----
    const t0 = Date.now(); let html = '', code = 0;
    while (Date.now() - t0 < WAIT_MIN * 60000) { const x = await fetch(SITE + NAME + '?cb=' + Date.now(), { headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' } }); code = x.status; html = await x.text(); if (code === 200 && html.includes(SLUG)) break; await sleep(20000); }
    console.log(`     preview page after ${Math.round((Date.now() - t0) / 1000)}s: status ${code}`);
    ok(code === 200, `preview page answers 200 (${code})`);
    ok(og(html, 'title') === CFG.title, 'og:title = page title: ' + og(html, 'title'));
    ok(og(html, 'image') === CFG.cover.replace(/&/g, '&amp;'), 'og:image = cover');
    ok(/Feb 14, 2027/.test(og(html, 'description')), 'og:description: ' + og(html, 'description'));
    const old = await fetch(SITE + NAME2 + '?cb=' + Date.now()); const oh = await old.text(); ok(old.status === 200 && og(oh, 'url') === SITE + NAME, 'old name: 200, og:url = current name');
    if (code === 200) { await page.goto(SITE + NAME); await page.waitForSelector('#ev-root .ev-panel:not([hidden])', { timeout: 30000 }); await page.waitForTimeout(1500);
      ok((await page.textContent('#ev-root')).includes(CFG.title), 'preview page opens the app on the page'); if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-name-stub.png` }); }
    await ctx.close();
  } catch (e) { ok(false, 'crashed: ' + (e && e.stack || e)); }
  finally {
    const dump = { events: await sql(`select * from public.events where owner in ('${ids.join("','")}')`), page_names: await sql(`select * from public.page_names where event_id in (select id from public.events where owner in ('${ids.join("','")}'))`) };
    fs.mkdirSync(BACKUP, { recursive: true }); const bf = `${BACKUP}/names-e2e-${TS}.json`; fs.writeFileSync(bf, JSON.stringify(dump, null, 1)); fs.chmodSync(bf, 0o600); console.log('backup ' + bf);
    await sql(`delete from public.events where owner in ('${ids.join("','")}') and slug = '${SLUG}'`);
    for (const id of ids) if (id) await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    const left = await sql(`select (select count(*) from public.events where slug = '${SLUG}') e, (select count(*) from public.page_names where name in ('${NAME}','${NAME2}')) n, (select count(*) from auth.users where id in ('${ids.join("','")}')) u`);
    ok(Array.isArray(left) && +left[0].e === 0 && +left[0].n === 0 && +left[0].u === 0, 'test data deleted ' + JSON.stringify(left));
    await browser.close();
  }
  console.log(`names: ${NAME} ${NAME2}`);
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
