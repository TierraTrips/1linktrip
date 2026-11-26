// Page names: https://1linktrip.com/<name> (Dylan 11/25: "customizable URLs, e.g. dylansparty.1linktrip.com — don't really
// care if it comes before or after 1linktrip"). Path style. Covers, against a GitHub-Pages-like server (unknown path →
// 404.html with status 404; /<name> → <name>.html when the link-preview page exists):
//  guests: /<name> via 404.html and via the preview page (no lookup), query + hash passthrough, old name → current name,
//    upper case / trailing slash / "&g=" glued on, unknown + invalid names, tabs + reload on the pretty address, ?e= links
//    still work and their share sheet shows the pretty link, offline through the service worker;
//  organizers: first Share names the page from its title, Settings → change the link (live check: taken / reserved /
//    invalid / available), the old name stays an alias, a page shared before is offered a name (not given one), My pages
//    shows the pretty link, Share my trip link from a pretty base;
//  .github/names.mjs: escaping, stale-file cleanup, never touches other files.
//
//   node tests/page-names.js        (starts its own server on 18766)
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const PORT = +process.env.PORT || 18766; const BASE = `http://127.0.0.1:${PORT}/`;
const SBURL = 'https://mljzoujystouqkmmoemn.supabase.co';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const CFG = { v: 2, type: 'Trip', title: 'Dylan’s NYE party', start: '2026-12-31', end: '2027-01-01', tz: 'America/New_York', off: {},
  venue: { name: 'The Loft', address: 'New York', lat: 40.72, lon: -74.0, city: 'New York', country: 'USA', cc: 'us' },
  schedule: [{ date: '2026-12-31', time: '20:00', title: 'Doors', note: '' }], cover: '',
  tools: { nearby: true, weather: true, travel: true, stay: true, tours: false, mytrip: true, packing: false, shopping: false } };
const SLUG = 'dylans-nye-party-ab2cd';
const NAMES = { 'dylans-nye': 'dylans-nye', dylansparty: 'dylans-nye' }; // name → current name, all for SLUG

// in-memory supabase-js for the organizer: events + page_names + the name RPCs, with the server's rules
function fakeSupabase() {
  const J = (k, d) => JSON.parse(localStorage.getItem(k) || d); const S = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const user = () => J('mock-user', 'null');
  const RE = /^(?!.*--)[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/; const RES = ['admin', 'mine', 'settings', 'supabase', 'assets'];
  const mine = (eid) => { const u = user(); return !!u && J('mock-events', '[]').some(e => e.id === eid && e.owner === u.id); };
  const check = (nm, eid) => { nm = String(nm || '').trim().toLowerCase(); if (!RE.test(nm)) return 'invalid'; const r = J('mock-names', '[]').find(x => x.name === nm);
    if (r) return eid && r.event_id === eid && mine(eid) ? (r.is_current ? 'yours' : 'alias') : 'taken'; return RES.includes(nm) ? 'reserved' : 'ok'; };
  const rpc = async (fn, a) => {
    window.__rpc = (window.__rpc || []).concat(fn);
    if (fn === 'page_name_check') return { data: user() ? check(a.nm, a.eid) : null, error: user() ? null : { message: 'denied' } };
    if (fn === 'page_name_set') {
      if (!mine(a.eid)) return { data: null, error: { message: 'Only this page’s organizers can change its link.' } };
      const nm = String(a.nm).trim().toLowerCase(); const st = check(nm, a.eid);
      if (st === 'taken') return { data: null, error: { message: 'That link is taken. Try another.' } };
      if (st === 'invalid' || st === 'reserved') return { data: null, error: { message: 'bad name' } };
      const xs = J('mock-names', '[]'); xs.forEach(x => { if (x.event_id === a.eid) x.is_current = false; });
      const hit = xs.find(x => x.name === nm); if (hit) hit.is_current = true; else xs.push({ name: nm, event_id: a.eid, is_current: true }); S('mock-names', xs);
      return { data: nm, error: null };
    }
    if (fn === 'page_name_resolve') { const xs = J('mock-names', '[]'); const r = xs.find(x => x.name === a.nm); if (!r) return { data: [], error: null };
      const e = J('mock-events', '[]').find(x => x.id === r.event_id); const c = xs.find(x => x.event_id === r.event_id && x.is_current); return { data: e ? [{ slug: e.slug, name: c ? c.name : r.name }] : [], error: null }; }
    return { data: null, error: null };
  };
  const q = (table) => { const st = { op: 'select', filters: [], ins: null, single: false };
    const run = async () => {
      const u = user(); const match = (r) => st.filters.every(([k, v]) => r[k] === v) && (!st.ins || st.ins[1].includes(r[st.ins[0]]));
      if (table === 'page_names') { const xs = J('mock-names', '[]').filter(r => mine(r.event_id) && match(r)); return { data: st.single ? xs[0] || null : xs, error: null }; }
      if (table !== 'events') return { data: [], error: null };
      let xs = J('mock-events', '[]');
      const visible = (r) => r.published || (u && r.owner === u.id); const own = (r) => u && r.owner === u.id;
      if (st.op === 'insert') { if (!u) return { data: null, error: { message: 'not signed in' } }; const r = { id: 'ev' + (xs.length + 1), owner: u.id, published: true, ...st.row, updated_at: new Date().toISOString() }; xs.push(r); S('mock-events', xs); return { data: st.single ? r : [r], error: null }; }
      if (st.op === 'update') { const hit = xs.filter(r => match(r) && own(r)); hit.forEach(r => Object.assign(r, st.row, { updated_at: new Date().toISOString() })); S('mock-events', xs); return { data: hit, error: null }; }
      if (st.op === 'delete') { S('mock-events', xs.filter(r => !(match(r) && own(r)))); return { data: null, error: null }; }
      const hit = xs.filter(r => match(r) && visible(r)); return { data: st.single ? hit[0] || null : hit, error: null };
    };
    const b = { select() { return b; }, eq(k, v) { st.filters.push([k, v]); return b; }, order() { return b; }, limit() { return b; }, in(k, v) { st.ins = [k, v]; return b; },
      insert(row) { st.op = 'insert'; st.row = row; return b; }, update(row) { st.op = 'update'; st.row = row; return b; }, delete() { st.op = 'delete'; return b; }, single() { st.single = true; return b; }, maybeSingle() { st.single = true; return b; },
      then(res, rej) { return run().then(res, rej); } };
    return b; };
  window.supabase = { createClient: () => ({ from: q, rpc, storage: { from: () => ({}) }, functions: { invoke: async () => ({ data: null, error: { message: 'off' } }) },
    auth: { getSession: async () => { const u = user(); return { data: { session: u ? { user: u, access_token: 'a.b.c' } : null } }; }, signInWithOtp: async () => ({ error: null }), signOut: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
}

(async () => {
  const pages = require('./_pages-server'); const virtual = new Map();
  // .github/names.mjs (ESM) makes the link-preview page the way the Action does
  const gen = await import(path.join(__dirname, '..', '.github', 'names.mjs'));
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  fs.writeFileSync(path.join(__dirname, '..', '404.html'), gen.page404(index)); // as the Action keeps it
  virtual.set('stubname', gen.namePage(index, { name: 'stubname', current_name: 'stubname', slug: SLUG, title: CFG.title, tagline: '', description: '', image: 'https://example.com/c.jpg', start_at: CFG.start, end_at: CFG.end, place: 'The Loft' }));
  virtual.set('oldstub', gen.namePage(index, { name: 'oldstub', current_name: 'stubname', slug: SLUG, title: CFG.title, tagline: '', description: '', image: '', start_at: '', end_at: '', place: '' }));
  const srv = await pages.start(PORT, virtual);
  const browser = require('./_open-settings')(await chromium.launch());
  const mk = async (opt = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: opt.sw ? 'allow' : 'block' });
    const st = { net: true, resolve: [], nameFor: 0 };
    if (opt.owner) await ctx.addInitScript(fakeSupabase);
    await ctx.route(`${SBURL}/rest/v1/**`, async (r) => {
      if (!st.net) return r.abort('internetdisconnected');
      const u = r.request().url(); let body = [];
      if (/rpc\/page_name_resolve/.test(u)) { const nm = JSON.parse(r.request().postData() || '{}').nm; st.resolve.push(nm); body = NAMES[nm] ? [{ slug: SLUG, name: NAMES[nm] }] : nm === 'stubname' || nm === 'oldstub' ? [{ slug: SLUG, name: 'stubname' }] : []; }
      else if (/rpc\/page_name_for/.test(u)) { st.nameFor++; body = JSON.parse(r.request().postData() || '{}').sl === SLUG ? 'dylans-nye' : null; }
      else if (/events\?.*slug=eq\./.test(u)) { const sl = decodeURIComponent(u.match(/slug=eq\.([^&]+)/)[1]); body = sl === SLUG ? [{ id: 'e1', slug: SLUG, config: CFG, updated_at: '2026-11-12T00:00:00Z', published: true }] : [];
        if (opt.owner) { const xs = JSON.parse(await ctx._ev()); body = xs.filter(x => x.slug === sl && x.published); } }
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru|functions\/v1|supabase\.co\/(auth|storage)|unpkg\.com\/leaflet|jsdelivr/, r => {
      if (/lz-string|leaflet/.test(r.request().url()) && st.net) return r.continue(); return r.abort(); });
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
    if (opt.owner) ctx._ev = () => page.evaluate(() => localStorage.getItem('mock-events') || '[]').catch(() => '[]');
    return { ctx, page, st };
  };
  const loc = (page) => page.evaluate(() => location.pathname + location.search + location.hash);
  const rendered = (page) => page.waitForSelector('#ev-root .ev-panel:not([hidden])', { timeout: 15000 }).then(() => true).catch(() => false);
  const cur = (page) => page.$eval('#ev-root [role="tab"][aria-selected="true"]', b => b.dataset.tabGo).catch(() => '');
  const hasTitle = async (page) => (await page.textContent('#ev-root').catch(() => '')).includes('NYE party');

  try {
    // ---------- guests ----------
    { const { ctx, page, st } = await mk();
      const res = await page.goto(BASE + 'dylans-nye');
      ok(res.status() === 404, `no preview page yet: GitHub Pages answers 404.html (status ${res.status()})`);
      ok(await rendered(page) && await hasTitle(page), '/dylans-nye opens the page (404.html boots the app)');
      ok(await loc(page) === '/dylans-nye', `address stays pretty (${await loc(page)})`);
      ok(st.resolve.join() === 'dylans-nye', 'one lookup of the name');
      ok(/NYE party/.test(await page.title()), 'tab title is the page');
      // tabs + reload on the pretty address
      await page.click('#ev-root [role="tab"][data-tab-go="nearby"]'); await page.waitForTimeout(300);
      ok(await loc(page) === '/dylans-nye#t=nearby', `Nearby → /dylans-nye#t=nearby (${await loc(page)})`);
      st.resolve = []; await page.reload(); await rendered(page); await page.waitForTimeout(400);
      ok(await cur(page) === 'nearby', 'reload on the pretty address keeps the tab');
      ok(st.resolve.length <= 1, 'reload: the name is known on this device (at most a background check)');
      // share sheet shows the pretty link
      await page.click('#ev-root [role="tab"][data-tab-go="event"]'); await page.waitForTimeout(200);
      if (await page.$('.ev [data-act="share"]')) { await page.click('.ev [data-act="share"]'); await page.waitForSelector('#shr-dlg[open]');
        const v = await page.$eval('#shr-dlg [data-shr-p="plan"] input', i => i.value); ok(v === BASE + 'dylans-nye', `share sheet: ${v}`); await page.click('#shr-dlg [data-shr-x]'); }
      else ok(false, 'share button on the guest page');
      // query + hash passthrough
      await page.goto(BASE + 'dylans-nye?lang=es#t=travel'); await rendered(page); await page.waitForTimeout(300);
      ok(await cur(page) === 'travel', 'hash #t=travel passes through');
      ok(await page.evaluate(() => document.documentElement.lang) === 'es', '?lang=es passes through');
      ok(await loc(page) === '/dylans-nye?lang=es#t=travel', `address kept (${await loc(page)})`);
      // old name → current name, keeping query + hash
      await page.goto(BASE + 'dylansparty?g=tok123#t=travel'); await rendered(page); await page.waitForTimeout(300);
      ok(await loc(page) === '/dylans-nye?g=tok123#t=travel', `old name moves to the current one, query + hash kept (${await loc(page)})`);
      ok(await cur(page) === 'travel' && await hasTitle(page), 'old name opens the same page');
      // case, trailing slash, glued "&g="
      await page.goto(BASE + 'DylansParty/'); await rendered(page); await page.waitForTimeout(300);
      ok(await loc(page) === '/dylans-nye', `/DylansParty/ → /dylans-nye (${await loc(page)})`);
      await page.goto(BASE + 'dylans-nye&g=abc123'); await rendered(page); await page.waitForTimeout(200);
      ok(await loc(page) === '/dylans-nye?g=abc123', `/dylans-nye&g=abc123 → ?g= (${await loc(page)})`);
      await page.goto(BASE + 'dylans-nye/extra/bits'); await rendered(page);
      ok((await loc(page)).startsWith('/dylans-nye') && await hasTitle(page), 'extra path segments fall back to the name');
      // unknown / invalid
      for (const p of ['nobody-here', 'a_b', 'ab', 'x--y']) { await page.goto(BASE + p); await page.waitForSelector('.broken h1', { timeout: 10000 }).catch(() => {});
        ok(/isn’t available/.test(await page.textContent('body')), `/${p}: "This page isn’t available"`); }
      ok(await page.$('.broken a.btn[href="' + BASE + '"]') !== null, 'with a way to the app');
      // the app itself and ?e= links are unchanged
      await page.goto(BASE + '?e=' + SLUG); ok(await rendered(page) && await hasTitle(page), '?e= link still opens the page');
      ok(await loc(page) === '/?e=' + SLUG, '?e= address unchanged');
      await page.click('.ev [data-act="share"]'); await page.waitForSelector('#shr-dlg[open]');
      ok(await page.$eval('#shr-dlg [data-shr-p="plan"] input', i => i.value) === BASE + 'dylans-nye', '?e= page: share sheet gives the pretty link');
      await page.click('#shr-dlg [data-shr-x]');
      await page.goto(BASE); await page.waitForSelector('.land'); ok(await loc(page) === '/', 'the app home is unchanged');
      ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
      await ctx.close(); }

    // ---------- the link-preview page: status 200, the page's own tags, no lookup ----------
    { const { ctx, page, st } = await mk();
      const res = await page.goto(BASE + 'stubname');
      ok(res.status() === 200, 'preview page answers 200');
      const html = await res.text();
      ok(/<meta property="og:title" content="Dylan’s NYE party">/.test(html), 'og:title = the page title');
      ok(/<meta property="og:image" content="https:\/\/example\.com\/c\.jpg">/.test(html) && /og:description" content="Dec 31, 2026 – Jan 1, 2027 · The Loft"/.test(html), 'og:image + description (dates · place)');
      ok(await rendered(page) && await hasTitle(page), 'preview page opens the page');
      ok(st.resolve.length === 0, 'no name lookup: the preview page says which page it is');
      await page.goto(BASE + 'oldstub#t=travel'); await rendered(page); await page.waitForTimeout(200);
      ok(await loc(page) === '/stubname#t=travel', `old name's preview page moves to the current name (${await loc(page)})`);
      ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
      await ctx.close(); }

    // ---------- offline through the service worker ----------
    { const { ctx, page, st } = await mk({ sw: true });
      await page.goto(BASE + 'dylans-nye'); await rendered(page);
      await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
      await page.reload(); await rendered(page); await page.waitForTimeout(1500); // controlled now: the app + the page's data are kept
      st.net = false; await ctx.setOffline(true);
      await page.reload().catch(() => {}); const r = await rendered(page);
      ok(r && await hasTitle(page), 'offline: /dylans-nye still opens (service worker + this device knows the name)');
      ok(await loc(page) === '/dylans-nye', 'offline: address unchanged');
      await ctx.setOffline(false); await ctx.close(); }

    // ---------- organizers ----------
    const USER = { id: 'u0000000-0000-4000-8000-0000000000aa', email: 'host@example.com' };
    const seed = (page, pg, extra = {}) => page.evaluate(([pg, user, extra]) => { localStorage.clear(); localStorage.setItem('ep:pages', JSON.stringify(pg)); localStorage.setItem('mock-user', JSON.stringify(user)); localStorage.setItem('ep:signedIn', 'true'); Object.entries(extra).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v))); }, [pg, USER, extra]);
    const OC = { ...CFG, title: 'Share test trip' };
    { const { ctx, page } = await mk({ owner: true });
      await page.goto(BASE); await page.waitForFunction(() => window.__ep);
      await seed(page, [{ pid: 'p1', cfg: OC, url: '', hosted: null, updated: 1 }], { 'mock-names': [{ name: 'taken-name', event_id: 'other', is_current: true }] });
      await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('mock-events') || '[]').length === 1, null, { timeout: 10000 });
      await page.click('.b-top [data-act="publish"]'); await page.waitForSelector('#pub .pub-host.ok', { timeout: 20000 });
      const url = await page.inputValue('#pub-url');
      ok(url === BASE + 'share-test-trip', `first Share: the page gets its name from the title (${url})`);
      ok(/share-test-trip/.test(await page.textContent('#pub .pn')), 'sheet shows the link name with Change');
      ok(await page.getAttribute('#pub-open', 'href') === url, 'Open page uses the pretty link');
      await page.click('#pub button.ghost');
      await page.waitForSelector('.b-host'); ok((await page.textContent('.b-host')).includes(`127.0.0.1:${PORT}/share-test-trip`), 'Settings: Your link shows the pretty link');
      // change it in Settings
      await page.click('.b-host [data-pn-open]'); await page.waitForSelector('.b-host [data-pn-in]');
      const typeName = async (v) => { await page.fill('.b-host [data-pn-in]', v); await page.waitForTimeout(700); return [await page.textContent('.b-host [data-pn-st]'), await page.$eval('.b-host [data-pn-save]', b => b.disabled)]; };
      let [m, dis] = await typeName('taken-name'); ok(/Taken/.test(m) && dis, `taken: "${m}", Save off`);
      [m, dis] = await typeName('admin'); ok(/reserved/.test(m) && dis, `reserved: "${m}"`);
      [m, dis] = await typeName('ab'); ok(/3–40/.test(m) && dis, `too short: "${m}"`);
      [m] = await typeName('Dylans Party!'); ok(await page.inputValue('.b-host [data-pn-in]') === 'dylans-party-', 'typing is cleaned to a-z 0-9 - as you go');
      [m, dis] = await typeName('dylans-party'); ok(/Available/.test(m) && !dis, `available: "${m}", Save on`);
      await page.click('.b-host [data-pn-save]'); await page.waitForFunction(() => /dylans-party/.test(document.querySelector('.b-host').textContent));
      const names = await page.evaluate(() => JSON.parse(localStorage.getItem('mock-names')));
      ok(names.some(x => x.name === 'share-test-trip' && !x.is_current) && names.some(x => x.name === 'dylans-party' && x.is_current), 'renamed; the old name stays as an alias');
      ok((await page.textContent('.b-host')).includes(`/dylans-party`) && !(await page.textContent('.b-host')).includes('?e='), 'Settings shows the new link');
      await page.click('.b-host [data-pn-open]'); [m, dis] = await typeName('share-test-trip'); ok(/earlier link/.test(m) && !dis, `the page's old name can be taken back: "${m}"`);
      await page.click('.b-host [data-pn-cancel]');
      // Share again: same name, no new one
      await page.click('.b-top [data-act="publish"]'); await page.waitForSelector('#pub .pub-host.ok', { timeout: 20000 });
      ok(await page.inputValue('#pub-url') === BASE + 'dylans-party', 'Share again: the current name');
      await page.click('#pub [data-shr-tab="trip"]').catch(() => {}); await page.waitForTimeout(300);
      await page.click('#pub button.ghost').catch(() => {});
      // My pages
      await page.goto(BASE + '#mine'); await page.waitForTimeout(1200);
      const mineTxt = await page.textContent('#app'); ok(mineTxt.includes(`127.0.0.1:${PORT}/dylans-party`), 'My pages shows the pretty link');
      // the organizer opening their own pretty link gets their page (editable)
      await page.goto(BASE + 'dylans-party'); await page.waitForSelector('.builder', { timeout: 15000 }).catch(() => {});
      ok(!!(await page.$('.builder')), 'organizer at their own /<name>: their editable page');
      ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
      await ctx.close(); }

    // a page shared before names existed: offered a name, not given one
    { const { ctx, page } = await mk({ owner: true });
      await page.goto(BASE); await page.waitForFunction(() => window.__ep);
      await seed(page, [{ pid: 'p2', cfg: { ...OC, title: 'Old page' }, url: '', hosted: { id: 'ev1', slug: 'old-page-zz9zz', owner: USER.id, pub: true }, updated: 1 }],
        { 'mock-events': [{ id: 'ev1', slug: 'old-page-zz9zz', owner: USER.id, published: true, config: { ...OC, title: 'Old page' }, updated_at: '2026-11-01T00:00:00Z' }] });
      await page.goto(BASE + '#page=p2'); await page.waitForSelector('.b-form');
      await page.click('.b-top [data-act="publish"]'); await page.waitForSelector('#pub .pub-host.ok', { timeout: 20000 });
      ok(await page.inputValue('#pub-url') === BASE + '?e=old-page-zz9zz', 'already shared: link unchanged (no name given)');
      await page.waitForFunction(() => { const i = document.querySelector('#pub [data-pn-in]'); return i && i.value === 'old-page'; }, null, { timeout: 5000 }).catch(() => {});
      ok(await page.$eval('#pub [data-pn-in]', i => i.value).catch(() => '') === 'old-page', 'a name is offered from the title');
      ok(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-names') || '[]').length) === 0, 'nothing claimed until they choose');
      await page.waitForFunction(() => !document.querySelector('#pub [data-pn-save]').disabled, null, { timeout: 5000 }).catch(() => {});
      await page.click('#pub [data-pn-save]'); await page.waitForFunction(() => /\/old-page$/.test(document.querySelector('#pub-url').value), null, { timeout: 5000 }).catch(() => {});
      ok(await page.inputValue('#pub-url') === BASE + 'old-page', '"Use this link" → the sheet shows the pretty link');
      ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
      await ctx.close(); }

    // ---------- .github/names.mjs ----------
    { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-names-'));
      fs.writeFileSync(path.join(dir, 'index.html'), index); fs.copyFileSync(path.join(__dirname, '..', 'supabase-config.js'), path.join(dir, 'supabase-config.js'));
      fs.writeFileSync(path.join(dir, 'keep.html'), '<p>not generated</p>'); fs.mkdirSync(path.join(dir, 'setup'));
      fs.writeFileSync(path.join(dir, 'gone-name.html'), gen.namePage(index, { name: 'gone-name', current_name: 'gone-name', slug: 'a-bcd' }));
      const rows = [{ name: 'evil-page', current_name: 'evil-page', slug: 'evil-abcde', title: '"><script>alert(1)</script>', tagline: '', description: '', image: 'javascript:alert(1)', start_at: '', end_at: '', place: '' },
        { name: '../escape', current_name: 'x-y-z', slug: 'a-b' }, { name: 'setup', current_name: 'setup', slug: 'a-bcd', title: 'x' }, { name: 'keep', current_name: 'keep', slug: 'a-bcd', title: 'x' }];
      fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(rows));
      const out = execFileSync('node', [path.join(__dirname, '..', '.github', 'names.mjs'), '--json', path.join(dir, 'rows.json')], { cwd: dir, encoding: 'utf8' });
      const ev = fs.readFileSync(path.join(dir, 'evil-page.html'), 'utf8');
      ok(!/<script>alert/.test(ev) && /&lt;script&gt;/.test(ev), 'titles are escaped');
      ok(!/javascript:/.test(ev) && /og:image" content="https:\/\/1linktrip\.com\/icon-512\.png"/.test(ev), 'non-https image → the site icon');
      ok(!fs.existsSync(path.join(dir, 'gone-name.html')), 'a page for a name that is gone is removed');
      ok(fs.readFileSync(path.join(dir, 'keep.html'), 'utf8') === '<p>not generated</p>', 'a site file of the same name is never overwritten');
      ok(!fs.existsSync(path.join(dir, 'setup.html')), 'no page for a name that is a site folder');
      ok(!fs.readdirSync(path.dirname(dir)).includes('escape.html') && fs.readdirSync(dir).filter(f => f.endsWith('.html')).sort().join() === '404.html,evil-page.html,index.html,keep.html', 'only valid names become files: ' + fs.readdirSync(dir).join(','));
      ok(/404\.html/.test(out) || fs.existsSync(path.join(dir, '404.html')), '404.html written');
      const again = execFileSync('node', [path.join(__dirname, '..', '.github', 'names.mjs'), '--json', path.join(dir, 'rows.json')], { cwd: dir, encoding: 'utf8' });
      ok(/changed: nothing/.test(again), 'second run changes nothing (no empty commits)');
      fs.rmSync(dir, { recursive: true, force: true }); }
  } finally { await browser.close(); srv.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
