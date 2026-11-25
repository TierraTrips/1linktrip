// Vendors and payments (Dylan: "For weddings we need it to be able to add vendors and keep track of vendor payments").
// Builder → Vendors (on by default for Weddings; any page turns it on in Sections → Just for you): add a vendor (category
// chip, business, contact, phone, email, website, contract total, notes), its payments (amount, due, paid date or Mark
// paid, method/note); the overview shows Committed / Paid / Remaining and a Next due list (overdue red, ≤14 days amber).
// Organizer-only: never in the page config (anyone with the link reads that) — on this device per page and, signed in,
// in event_private (owner-only RLS, supabase/schema-4.sql). A second device of the owner pulls it; guests never see it.
// An invoice/contract file fills a vendor + payments via ai-import mode "vendor". 390 + 320, no overflow.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/vendors.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return false; for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.tagName + '.' + e.className).slice(0, 5); });
const pad = (n) => String(n).padStart(2, '0');
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const USER = { id: 'u0000000-0000-4000-8000-0000000000aa', email: 'host@example.com' };
const WED = { v: 2, type: 'Wedding', title: 'Maya & Leo', host: 'Maya and Leo', start: '2027-03-12T16:00', end: '2027-03-14', venue: null, ek: 'k-wed',
  schedule: [{ date: '2027-03-12', time: '16:00', title: 'Ceremony', note: '' }, { date: '2027-03-12', time: '18:00', title: 'Reception', note: '' }] };
const PARTY = { v: 2, type: 'Party', title: 'Reunion', start: '2027-05-01T18:00', venue: null, ek: 'k-party' };

// in-memory supabase-js stand-in: events + event_private in localStorage, owner-only rules like the real RLS
function fakeSupabase() {
  const get = (t) => JSON.parse(localStorage.getItem('mock-' + t) || '[]'); const put = (t, xs) => localStorage.setItem('mock-' + t, JSON.stringify(xs));
  const user = () => { const u = localStorage.getItem('mock-user'); return u ? JSON.parse(u) : null; };
  const val = (r, k) => k.includes('->>') ? ((r[k.split('->>')[0]] || {})[k.split('->>')[1]]) : r[k];
  const q = (table) => { const st = { op: 'select', filters: [], single: false };
    const run = async () => {
      const u = user(); const ownsEv = (id) => !!u && get('events').some(e => e.id === id && e.owner === u.id);
      if (table === 'event_private') {
        if (!u) return { data: null, error: { message: 'permission denied', code: '42501' } };
        let xs = get('event_private'); const match = (r) => st.filters.every(([k, v]) => r[k] === v);
        if (st.op === 'upsert') { const row = st.row; if (!ownsEv(row.event_id)) return { data: null, error: { message: 'rls', code: '42501' } };
          xs = xs.filter(r => r.event_id !== row.event_id); xs.push({ ...row, updated_at: new Date().toISOString() }); put('event_private', xs); window.__ups = (window.__ups || 0) + 1; return { data: null, error: null }; }
        const hit = xs.filter(r => match(r) && ownsEv(r.event_id)); return { data: st.single ? hit[0] || null : hit, error: null };
      }
      if (table !== 'events') return { data: [], error: null };
      let xs = get('events'); const match = (r) => st.filters.every(([k, v]) => val(r, k) === v);
      const visible = (r) => r.published || (u && r.owner === u.id); const mine = (r) => u && r.owner === u.id;
      if (st.op === 'insert') { if (!u) return { data: null, error: { message: 'not signed in' } }; const r = { id: 'ev' + (xs.length + 1), owner: u.id, published: true, ...st.row, updated_at: new Date().toISOString() }; xs.push(r); put('events', xs); return { data: st.single ? r : [r], error: null }; }
      if (st.op === 'update') { const hit = xs.filter(r => match(r) && mine(r)); hit.forEach(r => Object.assign(r, st.row, { updated_at: new Date().toISOString() })); put('events', xs); return { data: hit, error: null }; }
      if (st.op === 'delete') { put('events', xs.filter(r => !(match(r) && mine(r)))); return { data: null, error: null }; }
      const hit = xs.filter(r => match(r) && visible(r)); return { data: st.single ? hit[0] || null : hit, error: null };
    };
    const b = { select() { return b; }, eq(k, v) { st.filters.push([k, v]); return b; }, order() { return b; }, limit() { return b; }, in() { return b; },
      insert(row) { st.op = 'insert'; st.row = row; return b; }, upsert(row) { st.op = 'upsert'; st.row = row; return b; }, update(row) { st.op = 'update'; st.row = row; return b; }, delete() { st.op = 'delete'; return b; },
      single() { st.single = true; return b; }, maybeSingle() { st.single = true; return b; }, then(res, rej) { return run().then(res, rej); } };
    return b; };
  window.supabase = { createClient: () => ({ from: q, storage: { from: () => ({}) }, rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => { const u = user(); return { data: { session: u ? { user: u, access_token: 'a.b.c' } : null } }; }, signInWithOtp: async () => ({ error: null }), signOut: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
}

(async () => {
  const browser = require('./_open-settings')(await chromium.launch());
  let store = { events: '[]', event_private: '[]' }; // the "server", shared by devices
  const mk = async (w = 390) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript(fakeSupabase);
    await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('mock-events', s.events); localStorage.setItem('mock-event_private', s.event_private); } }, store);
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|auth\/v1|unsplash|fonts\./, r => r.abort());
    await ctx.route(/functions\/v1\//, r => r.abort()); // (routes added later win: ai-import below)
    await ctx.route(/functions\/v1\/ai-import/, r => {
      if (r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, ready: true, modes: ['url', 'text', 'file', 'doc', 'vendor'] }) });
      const b = JSON.parse(r.request().postData() || '{}'); ctx._ai = b;
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'vendor', data: { vendor: { category: 'Florist', name: 'Petal & Stem', contact: 'Ana Ruiz', phone: '+1 305 555 0100', email: 'ana@petalstem.example', website: 'https://petalstem.example', total: 3200, currency: 'USD', notes: 'Bridal bouquet, 12 centerpieces' },
        payments: [{ amount: 800, due: day(-40), paid: day(-40), note: 'Deposit, card' }, { amount: 1200, due: day(10), paid: '', note: '' }, { amount: 1200, due: day(90), paid: '', note: 'Final' }] } }) });
    });
    await ctx.route(/\/rest\/v1\/events/, r => { const slug = (r.request().url().match(/slug=eq\.([^&]+)/) || [])[1]; r.fulfill({ contentType: 'application/json', body: JSON.stringify(JSON.parse(store.events).filter(x => x.slug === slug && x.published).map(x => ({ ...x }))) }); });
    await ctx.route(/\/rest\/v1\/(?!events)/, r => r.fulfill({ status: 404, contentType: 'application/json', body: '{"code":"PGRST205"}' }));
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
    page._sync = async () => { const s = await page.evaluate(() => ({ events: localStorage.getItem('mock-events') || '[]', event_private: localStorage.getItem('mock-event_private') || '[]' })); store = s; };
    return { ctx, page };
  };
  const seedPage = (page, pid, cfg, extra = {}) => page.evaluate(([pid, cfg, extra]) => { Object.entries(extra).forEach(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
    const xs = JSON.parse(localStorage.getItem('ep:pages') || '[]').filter(x => x.pid !== pid); xs.unshift({ pid, cfg, url: '', hosted: extra.__hosted || null, updated: 1, edited: 1 }); localStorage.setItem('ep:pages', JSON.stringify(xs)); }, [pid, cfg, extra]);
  const openVendors = async (page) => { await page.waitForSelector('[data-acc="vendors"]'); if (!(await page.$('[data-acc="vendors"][open]'))) await page.click('[data-acc="vendors"] summary'); };
  const totals = (page) => page.$$eval('[data-vn-tot] b', xs => xs.map(x => x.textContent));
  const addVendor = async (page, { cat, name, total, pays }) => {
    await page.click('[data-vn-add]'); await page.waitForSelector('#sheet[open] #vn-name');
    await page.click(`#sheet [data-vn-cat="${cat}"]`); await page.fill('#vn-name', name); await page.fill('#vn-total', String(total));
    for (const p of pays) {
      await page.click('#sheet [data-vn-padd]'); await page.waitForTimeout(60);
      const n = (await page.$$('#sheet [data-vn-pay]')).length - 1;
      await page.fill(`#sheet [data-vnp="${n}"][data-vnk="amt"]`, String(p.amt)); await page.fill(`#sheet [data-vnp="${n}"][data-vnk="due"]`, p.due);
      if (p.note) await page.fill(`#sheet [data-vnp="${n}"][data-vnk="note"]`, p.note);
      if (p.paid) { await page.click(`#sheet [data-vn-mark="${n}"]`); await page.waitForTimeout(60); }
    }
  };
  const closeSheet = async (page) => { await page.click('#sheet h2 [data-b="close"]'); await page.waitForFunction(() => !document.querySelector('#sheet[open]')); };

  try {
    // ---------- signed out: a wedding draft ----------
    for (const w of [390, 320]) {
      const { ctx, page } = await mk(w);
      await page.goto(BASE); await page.waitForFunction(() => window.__ep);
      await page.evaluate(() => localStorage.clear());
      await seedPage(page, 'pw', WED);
      await page.goto(BASE + '#page=pw'); await page.waitForSelector('.b-form');
      ok(!!(await page.$('[data-acc="vendors"]')), `${w}: wedding builder has Vendors`);
      await openVendors(page);
      await addVendor(page, { cat: 'Photographer', name: 'Lumen Studio', total: 5000, pays: [{ amt: 1500, due: day(-30), paid: true, note: 'Deposit, Zelle' }, { amt: 2000, due: day(7) }, { amt: 1500, due: day(60) }] });
      ok(/Paid \$1,500 · Remaining \$3,500 · Next \$2,000/.test(await page.textContent('#sheet [data-vn-k]')), `${w}: vendor sheet shows paid / remaining / next due`);
      ok(await page.$eval('#sheet [data-vn-pay="1"]', e => e.classList.contains('soon')), `${w}: payment due in 7 days is highlighted`);
      ok(await page.$eval('#sheet [data-vn-pay="0"]', e => e.classList.contains('paid')) && !!(await page.$('#sheet [data-vnp="0"][data-vnk="paid"]')), `${w}: marked-paid payment shows its paid date`);
      if (w === 390 && SHOTS) await page.screenshot({ path: SHOTS + '/vendors-sheet-390.png' });
      ok(!(await overflow(page)).length, `${w}: vendor sheet fits (${await overflow(page)})`);
      await page.selectOption('#vn-sched', 'Ceremony');
      await closeSheet(page);
      await addVendor(page, { cat: 'Florist', name: 'Bloom Co', total: 1200, pays: [{ amt: 600, due: day(-3) }] });
      await closeSheet(page);
      // an added-then-abandoned vendor disappears
      await page.click('[data-vn-add]'); await page.waitForSelector('#sheet[open] #vn-name'); await closeSheet(page);
      await page.waitForTimeout(400);
      ok((await page.$$('.vn-list li')).length === 2, `${w}: empty vendor dropped on close`);
      ok(JSON.stringify(await totals(page)) === JSON.stringify(['$6,200', '$1,500', '$4,700']), `${w}: overview committed / paid / remaining (${await totals(page)})`);
      const due = await page.$$eval('.vn-due li', xs => xs.map(x => [x.className, x.querySelector('.vn-n').textContent, x.querySelector('b').textContent]));
      ok(due.length === 3 && due[0][0] === 'over' && due[0][1] === 'Bloom Co' && due[1][0] === 'soon' && due[2][0] === '', `${w}: next due sorted; overdue red, ≤14 days amber (${JSON.stringify(due)})`);
      ok(await page.$eval('.vn-due li.over', e => getComputedStyle(e).backgroundColor !== getComputedStyle(e.parentElement).backgroundColor), `${w}: overdue row is colored`);
      ok(/Overdue/.test(await page.textContent('.vn-due li.over')), `${w}: overdue says so`);
      ok(await page.$eval('[data-acc="vendors"] summary .st', e => e.classList.contains('due')), `${w}: Vendors header flags an overdue payment`);
      ok(/Photographer · Ceremony/.test(await page.textContent('.vn-list')), `${w}: vendor linked to a schedule item`);
      if (w === 390 && SHOTS) { await page.$eval('[data-acc="vendors"]', e => e.scrollIntoView()); await page.screenshot({ path: SHOTS + '/vendors-overview-390.png' }); }
      ok(!(await overflow(page)).length, `${w}: builder fits (${await overflow(page)})`);
      // Mark paid from the overview, then Undo
      await page.click('.vn-due li.over [data-vn-paid]'); await page.waitForTimeout(100);
      ok(JSON.stringify(await totals(page)) === JSON.stringify(['$6,200', '$2,100', '$4,100']) && !(await page.$('.vn-due li.over')), `${w}: Mark paid from Next due`);
      await page.click('#undo button'); await page.waitForTimeout(100);
      ok(JSON.stringify(await totals(page)) === JSON.stringify(['$6,200', '$1,500', '$4,700']), `${w}: Undo`);
      // currency
      await page.selectOption('[data-vn-cursel]', 'EUR'); await page.waitForTimeout(100);
      ok((await totals(page))[0] === '€6,200', `${w}: per-page currency`);
      await page.selectOption('[data-vn-cursel]', 'USD');
      // persistence on this device
      await page.reload(); await page.waitForSelector('.b-form'); await openVendors(page);
      ok(JSON.stringify(await totals(page)) === JSON.stringify(['$6,200', '$1,500', '$4,700']), `${w}: kept on this device after reload`);
      const P = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:priv:pw')));
      ok(P && P.vendors.length === 2 && P.vendors[0].pays[0].note === 'Deposit, Zelle' && P.vendors[0].pays[0].paid === day(0), `${w}: stored per page with notes and paid date`);
      // never in the page config, the builder preview, or the guest page
      const cfgText = await page.evaluate(() => localStorage.getItem('ep:draft') + localStorage.getItem('ep:pages'));
      ok(!/Lumen|Bloom|Zelle|vendors/i.test(cfgText), `${w}: no vendor data in the page config`);
      await page.waitForTimeout(500);
      ok(!/Lumen|Bloom|Vendor/i.test(await page.textContent('#preview')), `${w}: builder preview (guest page) shows no vendors`);
      if (w === 390) {
        // the guest page from the shared config
        const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
        store.events = JSON.stringify([{ id: 'evg', slug: 'maya-leo-abcde', owner: 'someone', published: true, config: draft, updated_at: new Date().toISOString() }]);
        const g = await mk(390); await g.page.goto(BASE + '?e=maya-leo-abcde'); await g.page.waitForSelector('.ev-hero'); await g.page.waitForTimeout(800);
        const txt = await g.page.evaluate(() => document.body.innerText + document.body.innerHTML);
        ok(!/Lumen|Bloom|Zelle|vn-|Vendors/i.test(txt), 'guest view: no vendor data');
        if (SHOTS) await g.page.screenshot({ path: SHOTS + '/vendors-guest-390.png' });
        ok(!g.page._err.length, 'guest view: no errors ' + g.page._err.join(' | '));
        await g.ctx.close(); store.events = '[]';
      }
      ok(!page._err.length, `${w}: no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }

    // ---------- other types: off by default, on from Sections ----------
    {
      const { ctx, page } = await mk(390);
      await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
      await seedPage(page, 'pp', PARTY); await page.goto(BASE + '#page=pp'); await page.waitForSelector('.b-form');
      ok(!(await page.$('[data-acc="vendors"]')), 'party: no Vendors by default');
      await page.click('[data-acc="sections"] summary'); await page.click('label.tool:has([data-vn-on])');
      await page.waitForSelector('[data-acc="vendors"]');
      ok(!!(await page.$('[data-acc="vendors"]')), 'party: Sections → Vendors and payments turns it on');
      ok((await page.evaluate(() => JSON.parse(localStorage.getItem('ep:priv:pp')))).on === true, 'party: the switch is kept with the private data');
      ok(!/vn|vendor/i.test(await page.evaluate(() => localStorage.getItem('ep:draft'))), 'party: the switch is not in the page config');
      await page.click('label.tool:has([data-vn-on])'); await page.waitForTimeout(100);
      ok(!(await page.$('[data-acc="vendors"]')), 'party: and off again');
      await ctx.close();
    }

    // ---------- signed in: saved to the owner's private row, pulled on another device; invoice import ----------
    {
      store = { events: JSON.stringify([{ id: 'ev1', slug: 'maya-leo-k7m2q', owner: USER.id, published: true, config: WED, updated_at: new Date(Date.now() - 60000).toISOString() }]), event_private: '[]' };
      const hosted = { id: 'ev1', slug: 'maya-leo-k7m2q', owner: USER.id, pub: true };
      const A = await mk(390);
      await A.page.goto(BASE); await A.page.waitForFunction(() => window.__ep);
      await A.page.evaluate((u) => { localStorage.setItem('mock-user', JSON.stringify(u)); localStorage.setItem('ep:signedIn', 'true'); }, USER);
      await seedPage(A.page, 'p1', WED, { __hosted: hosted });
      await A.page.evaluate((h) => { const xs = JSON.parse(localStorage.getItem('ep:pages')); xs[0].hosted = h; localStorage.setItem('ep:pages', JSON.stringify(xs)); }, hosted);
      await A.page.goto(BASE + '?e=maya-leo-k7m2q#page=p1'); await A.page.waitForSelector('.b-form');
      await openVendors(A.page);
      await A.page.waitForSelector('[data-vn-root] [data-vn-file]', { timeout: 8000 }).catch(() => {});
      ok(!!(await A.page.$('[data-vn-root] [data-vn-file]')), 'signed in + importer lists "vendor": Fill from invoice');
      await addVendor(A.page, { cat: 'Venue', name: 'Casa Azul', total: 12000, pays: [{ amt: 4000, due: day(-60), paid: true }] });
      await closeSheet(A.page); await A.page.waitForTimeout(1800);
      await A.page._sync();
      const row = JSON.parse(store.event_private).find(r => r.event_id === 'ev1');
      ok(row && row.data.vendors[0].name === 'Casa Azul' && row.data.vendors[0].pays[0].amt === 4000, 'saved to event_private for the owner’s page');
      ok(!/Casa Azul/.test(store.events), 'the account’s page config has no vendor data');
      // invoice → a new vendor with its payments
      await A.page.setInputFiles('[data-vn-root] [data-vn-file]', { name: 'invoice.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
      await A.page.waitForSelector('#sheet[open] .vn-sheet', { timeout: 8000 });
      ok(A.ctx._ai && A.ctx._ai.mode === 'vendor' && A.ctx._ai.files.length === 1, 'invoice sent to ai-import mode "vendor"');
      ok(await A.page.inputValue('#vn-name') === 'Petal & Stem' && await A.page.inputValue('#vn-total') === '3200' && await A.page.inputValue('#vn-email') === 'ana@petalstem.example', 'invoice fills the vendor');
      ok((await A.page.$$('#sheet [data-vn-pay]')).length === 3 && await A.page.$eval('#sheet [data-vn-pay="0"]', e => e.classList.contains('paid')), 'invoice fills its payments (deposit paid)');
      ok(!!(await A.page.$('#sheet .chip.on[data-vn-cat="Florist"]')), 'invoice picks the category');
      await closeSheet(A.page); await A.page.waitForTimeout(1800); await A.page._sync();
      ok(JSON.parse(store.event_private)[0].data.vendors.length === 2, 'imported vendor synced');
      ok(!A.page._err.length, 'device A: no errors ' + A.page._err.join(' | '));
      // device B: the same account, a fresh browser
      const Bd = await mk(390);
      await Bd.page.goto(BASE); await Bd.page.waitForFunction(() => window.__ep);
      await Bd.page.evaluate((u) => { localStorage.setItem('mock-user', JSON.stringify(u)); localStorage.setItem('ep:signedIn', 'true'); }, USER);
      await seedPage(Bd.page, 'pB', WED); await Bd.page.evaluate((h) => { const xs = JSON.parse(localStorage.getItem('ep:pages')); xs[0].hosted = h; localStorage.setItem('ep:pages', JSON.stringify(xs)); }, hosted);
      await Bd.page.goto(BASE + '?e=maya-leo-k7m2q#page=pB'); await Bd.page.waitForSelector('.b-form'); await openVendors(Bd.page);
      await Bd.page.waitForFunction(() => document.querySelectorAll('.vn-list li').length === 2, null, { timeout: 8000 }).catch(() => {});
      ok(/Casa Azul/.test(await Bd.page.textContent('[data-vn-root]')) && /Petal & Stem/.test(await Bd.page.textContent('[data-vn-root]')), 'another device of the owner pulls the vendors');
      // signed out on B: a draft's vendors stay local, and go up once signed in with the page on the account
      await Bd.ctx.close(); await A.ctx.close();
      // a different signed-in user never gets them (owner-only, like the RLS)
      const C = await mk(390); await C.page.goto(BASE); await C.page.waitForFunction(() => window.__ep);
      const theirs = await C.page.evaluate(async () => { localStorage.setItem('mock-user', JSON.stringify({ id: 'other-user', email: 'x@y.z' })); const c = await window.__ep.sb(); return (await c.from('event_private').select('data').eq('event_id', 'ev1')).data; });
      ok(Array.isArray(theirs) && theirs.length === 0, 'another account reads nothing');
      await C.ctx.close();
    }

    // ---------- signed-out draft → signed in: the device's vendors go to the account ----------
    {
      store = { events: '[]', event_private: '[]' };
      const D = await mk(390);
      await D.page.goto(BASE); await D.page.waitForFunction(() => window.__ep); await D.page.evaluate(() => localStorage.clear());
      await seedPage(D.page, 'pd', { ...WED, ek: 'k-draft' }); await D.page.goto(BASE + '#page=pd'); await D.page.waitForSelector('.b-form'); await openVendors(D.page);
      await addVendor(D.page, { cat: 'Cake', name: 'Sugar Moon', total: 900, pays: [] }); await closeSheet(D.page);
      await D.page.evaluate((u) => { localStorage.setItem('mock-user', JSON.stringify(u)); localStorage.setItem('ep:signedIn', 'true'); }, USER);
      await D.page.reload(); await D.page.waitForSelector('.b-form');
      await D.page.waitForFunction(() => JSON.parse(localStorage.getItem('mock-event_private') || '[]').length === 1, null, { timeout: 10000 }).catch(() => {});
      await D.page._sync();
      const ev = JSON.parse(store.events)[0]; const pr = JSON.parse(store.event_private)[0];
      ok(ev && pr && pr.event_id === ev.id && pr.data.vendors[0].name === 'Sugar Moon', 'signed-out vendors move to the account on sign-in');
      ok(ev && !/Sugar Moon/.test(JSON.stringify(ev.config)), '… and not into the page config');
      ok(!D.page._err.length, 'draft→account: no errors ' + D.page._err.join(' | '));
      await D.ctx.close();
    }

    // ---------- pure helpers ----------
    {
      const { ctx, page } = await mk(390); await page.goto(BASE); await page.waitForFunction(() => window.__epv);
      const r = await page.evaluate(([a, b]) => { const V = window.__epv; const v = { pays: [{ amt: 100, due: a, paid: a }, { amt: 50, due: b, paid: '' }], total: null };
        const n = V.vnNorm({ vendors: [{ name: 'X', cat: 'Weird', total: '1,250.50', pays: [{ amt: '$300', due: 'nope' }] }], cur: 'XXX' });
        return { k: V.vnCalc(v), n, st: [V.vnDueSt('2020-01-01', '2026-01-10'), V.vnDueSt('2026-01-20', '2026-01-10'), V.vnDueSt('2026-03-01', '2026-01-10')] }; }, [day(-1), day(3)]);
      ok(r.k.total === 150 && r.k.paid === 100 && r.k.left === 50 && r.k.next.amt === 50, 'no contract total: payments add up to the total');
      ok(r.n.vendors[0].total === 1250.5 && r.n.vendors[0].cat === 'Other' && r.n.vendors[0].pays[0].amt === 300 && r.n.vendors[0].pays[0].due === '' && r.n.cur === 'USD', 'stored data is cleaned');
      ok(JSON.stringify(r.st) === '["over","soon",""]', 'due states');
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
