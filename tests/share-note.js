// Share without signing in: the long link (#e=…) carries the page but no RSVP form, guest messages or live updates —
// those go through the account, so only the short link has them. When the page has the RSVP form (or guest messages)
// on, the share dialog says so plainly before that link is copied, next to the share action (not a modal): a line
// under "Share without signing in", and on the long link itself a note with "Sign in for the short link". Nothing
// when RSVP and messages are off, or when the page already has a short link.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/share-note.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).length; });
const WED = { v: 2, type: 'Wedding', title: 'Maya & Leo', start: '2027-03-12', end: '2027-03-14', venue: { name: 'Hotel Esencia', address: 'Xpu-Há, Quintana Roo, Mexico', lat: 20.47, lon: -87.26, city: 'Xpu-Há', country: 'Mexico', cc: 'mx' }, cover: '' };

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
  const mk = async (w) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript(fakeSupabase);
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon|functions\/v1|auth\/v1|unsplash|fonts\./, r => r.abort());
    await ctx.route(/\/rest\/v1\//, r => r.fulfill({ contentType: 'application/json', body: '[]' }));
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
    return { ctx, page };
  };
  const visible = (page, sel) => page.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight)).catch(() => false);
  const open = async (page, cfg, hosted) => {
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await page.evaluate((pages) => { localStorage.clear(); localStorage.setItem('ep:pages', JSON.stringify(pages)); }, [{ pid: 'p1', cfg, url: '', hosted: hosted || null, updated: 1 }]);
    await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
    await page.click('.b-top [data-act="publish"]'); await page.waitForSelector('#pub .signin');
  };
  const host = (page) => page.textContent('#pub .pub-host');
  try {
    for (const w of [390, 320]) {
      // ---- 1. a wedding with its RSVP form on (the default), signed out ----
      {
        const { ctx, page } = await mk(w);
        await open(page, WED);
        let t = await host(page);
        ok(/Sign in to share/.test(t) && !!(await page.$('#pub .pub-alt [data-long-note]')), `@${w} sign-in step: a note under "Share without signing in"`);
        ok(/That link has no RSVP form or live updates, and won’t show later edits\./.test(t), `@${w} sign-in step note says what the long link lacks: ${JSON.stringify(t.slice(t.indexOf('That link')))}`);
        await page.click('#pub [data-ph="long"]');
        const url = await page.inputValue('#pub-url');
        ok(/#e=/.test(url) && await visible(page, '#pub [data-act="copy"]'), `@${w} long link shown with Copy`);
        ok(await visible(page, '#pub div.long-note'), `@${w} long link: the note is shown next to Copy`);
        t = await page.textContent('#pub div.long-note');
        ok(/This link has no RSVP form or live updates\./.test(t) && /only the short link has them/.test(t), `@${w} note text + why: ${JSON.stringify(t)}`);
        ok(/won’t show later edits/.test(await host(page)), `@${w} still says it won't show later edits`);
        const btn = await page.$('#pub div.long-note [data-ph="go"]');
        ok(!!btn && /Sign in for the short link/.test(await btn.textContent()) && /primary/.test(await btn.getAttribute('class')), `@${w} primary action: Sign in for the short link`);
        ok(!(await page.$('dialog[open]:not(#pub)')), `@${w} no extra modal`);
        // the note sits inside the share dialog, between the link and its buttons, and fits
        const box = await page.evaluate(() => { const d = document.querySelector('#pub'), n = document.querySelector('#pub div.long-note'), u = document.querySelector('#pub-url'), c = document.querySelector('#pub [data-act="copy"]'); const r = n.getBoundingClientRect(), dr = d.getBoundingClientRect(); return { inside: r.left >= dr.left - 1 && r.right <= dr.right + 1, order: u.getBoundingClientRect().bottom <= r.top + 1 && r.bottom <= c.getBoundingClientRect().top + 1 }; });
        ok(box.inside && box.order, `@${w} note inside the dialog, between link and Copy ${JSON.stringify(box)}`);
        ok(await overflow(page) === 0, `@${w} no overflow (long link + note)`);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-note-${w}.png` });
        await page.click('#pub div.long-note [data-ph="go"]'); await page.waitForSelector('#pub .signin');
        ok(/Sign in to share/.test(await host(page)) && !(await visible(page, '#pub-url')), `@${w} Sign in for the short link → the sign-in step`);
        ok(page._err.length === 0, `@${w} no page errors ${page._err.join(' | ')}`);
        await ctx.close();
      }
      // ---- 2. RSVP on + guest messages on → both named ----
      {
        const { ctx, page } = await mk(w);
        await open(page, { ...WED, guestMessages: true });
        await page.click('#pub [data-ph="long"]');
        const t = await page.textContent('#pub div.long-note');
        ok(/This link has no RSVP form, guest messages or live updates\./.test(t), `@${w} messages on: named too ${JSON.stringify(t)}`);
        ok(page._err.length === 0, `@${w} no page errors (messages)`);
        await ctx.close();
      }
      // ---- 3. RSVP off, messages off → no note (only "won't show later edits") ----
      {
        const { ctx, page } = await mk(w);
        await open(page, { ...WED, off: { rsvp: true } });
        ok(!(await page.$('#pub [data-long-note]')) && /That link won’t show later edits/.test(await host(page)), `@${w} RSVP off: sign-in step has no note`);
        await page.click('#pub [data-ph="long"]');
        ok(/#e=/.test(await page.inputValue('#pub-url')) && !(await page.$('#pub [data-long-note]')) && /This link won’t show later edits/.test(await host(page)), `@${w} RSVP off: long link without the note`);
        ok(await overflow(page) === 0, `@${w} no overflow (RSVP off)`);
        await ctx.close();
      }
      // ---- 3b. RSVP off but guest messages on → note for messages only ----
      {
        const { ctx, page } = await mk(w);
        await open(page, { ...WED, off: { rsvp: true }, guestMessages: true });
        await page.click('#pub [data-ph="long"]');
        const t = await page.textContent('#pub div.long-note').catch(() => '');
        ok(/This link has no guest messages or live updates\./.test(t) && !/RSVP/.test(t), `@${w} RSVP off, messages on: ${JSON.stringify(t)}`);
        await ctx.close();
      }
      // ---- 4. the page already has a short link (signed out on this device) → no note ----
      {
        const { ctx, page } = await mk(w);
        await open(page, WED, { id: 'ev1', slug: 'maya-leo-ab12c', owner: 'u1', pub: true });
        ok(!(await page.$('#pub [data-long-note]')), `@${w} short link exists: sign-in step has no note`);
        await page.click('#pub [data-ph="long"]');
        ok(/#e=/.test(await page.inputValue('#pub-url')) && !(await page.$('#pub [data-long-note]')), `@${w} short link exists: long link without the note`);
        ok(page._err.length === 0, `@${w} no page errors (short link exists)`);
        await ctx.close();
      }
    }
  } catch (e) { ok(false, 'threw: ' + (e && e.stack || e)); }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
