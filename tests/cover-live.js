// "The cover photo only shows when I edit, not when I open the trip": a shared (short-link) page used to show only what
// was last pushed with Update page. Now an edit (a new cover) is saved to the account a moment later and the short link
// shows it with no button; there is no "not live yet" bar or card label anywhere. The cover survives the share link (#e=)
// and the short link, and guests on another device see it.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/cover-live.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const IMG = 'https://images.unsplash.com/photo-test.jpg';
const CFG = { v: 2, type: 'Trip', title: 'Cover test', start: '2027-04-25', end: '2027-05-02', venue: { name: 'Tokyo', address: 'Tokyo', lat: 35.68, lon: 139.76, city: 'Tokyo', country: 'Japan', cc: 'jp' }, cover: '' };
const USER = { id: 'u0000000-0000-4000-8000-0000000000aa', email: 'host@example.com' };
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
  let store = '[]'; // the "server": shared by both devices
  const mk = async (user) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript(fakeSupabase);
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|functions\/v1|auth\/v1/, r => r.abort());
    await ctx.route(/images\.unsplash/, r => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>' }));
    await ctx.route(/\/rest\/v1\/events/, r => { const slug = (r.request().url().match(/slug=eq\.([^&]+)/) || [])[1]; r.fulfill({ contentType: 'application/json', body: JSON.stringify(JSON.parse(store).filter(x => x.slug === slug && x.published)) }); });
    await ctx.route(/\/rest\/v1\/(?!events)/, r => r.fulfill({ contentType: 'application/json', body: '[]' }));
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
    page._sync = async () => { store = await page.evaluate(() => localStorage.getItem('mock-events') || '[]'); };
    return { ctx, page };
  };
  const { ctx, page } = await mk();
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  const row = { id: 'ev1', slug: 'cover-test-abcde', owner: USER.id, published: true, config: { ...CFG, ek: 'k-cover' }, updated_at: new Date(Date.now() - 60000).toISOString() };
  await page.evaluate(([cfg, row, u]) => { localStorage.clear(); localStorage.setItem('mock-events', JSON.stringify([row])); localStorage.setItem('mock-user', JSON.stringify(u)); localStorage.setItem('ep:signedIn', 'true');
    localStorage.setItem('ep:pages', JSON.stringify([{ pid: 'p1', cfg, url: '', hosted: { id: 'ev1', slug: 'cover-test-abcde', owner: u.id, pub: true }, updated: 1, edited: 1 }])); }, [{ ...CFG, ek: 'k-cover' }, row, USER]);
  await page._sync();
  await page.goto(BASE + '?e=cover-test-abcde'); await page.waitForSelector('.ev-hero');
  ok(!(await page.$('.own-stale')) && !(await page.$('.ev-cover')), 'owner’s shared page: no bar, no cover yet');
  // add a cover in the builder
  await page.goto(BASE + '?e=cover-test-abcde#page=p1'); await page.waitForSelector('.b-form');
  await page.click('[data-acc="design"] summary'); await page.fill('#f-cover', IMG); await page.dispatchEvent('#f-cover', 'change');
  await page.waitForFunction(() => document.querySelector('[data-save]').textContent.trim() === 'Saved', null, { timeout: 10000 });
  ok(!!(await page.$('#preview .ev-cover')), 'builder preview shows the cover');
  ok(!/not live|Update page/.test(await page.textContent('[data-save]')), 'builder: Saved, nothing to push');
  const edited = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:pages'))[0].cfg);
  ok(edited.cover === IMG, 'cover saved in the page');
  await page._sync();
  ok(JSON.parse(store)[0].config.cover === IMG, 'cover saved to the account row');
  // the short link shows it right away: no Update page
  await page.goto(BASE + '?e=cover-test-abcde'); await page.waitForSelector('.ev-hero');
  ok(!!(await page.$('.ev-cover')) && !(await page.$('.own-stale')), 'short link shows the cover, no bar');
  await page.goto(BASE + '?x#'); await page.waitForSelector('.mp-list');
  ok(!/not live/.test(await page.textContent('.mp-list')), 'My pages card: no "changes not live yet"');
  // the share link carries the cover; a guest on another device sees it on the short link too, never an owner bar
  const { ctx: c2, page: p2 } = await mk();
  await p2.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), edited)); await p2.waitForSelector('.ev-hero');
  ok(!!(await p2.$('.ev-cover')), 'share link (#e=) opened fresh shows the cover');
  await p2.goto(BASE + '?e=cover-test-abcde'); await p2.waitForSelector('.ev-hero');
  ok(!!(await p2.$('.ev-cover')) && !(await p2.$('.own-stale')) && /Edit a copy/.test(await p2.textContent('.vbar')), 'guest device: cover, no owner UI');
  ok(!page._err.length && !p2._err.length, 'no page errors ' + page._err.concat(p2._err).join(' | '));
  await c2.close(); await ctx.close(); await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
