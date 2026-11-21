// RSVP questions (Dylan's approved audit, item 12): the organizer turns on, in builder → RSVP form, a meal choice (their
// own options), dietary needs, names of everyone in the party, which events (the page's titled schedule items, all by
// default, any left out), and up to two questions of their own. Guests who are coming see only what is on — nothing new
// is required — and the answers ride in the reply's `note` after the guest's own note as "[[1lt:{"v":1,…}]]" (rsvps has
// no other column for them; note's check allows 1000 characters). My pages → Replies shows them in columns, with meal
// and event headcounts, and the CSV has the same columns; replies without them read as before. Everything is off by
// default on every type, so pages that never turn them on are unchanged.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/rsvp-extra.js
//
// Needs Playwright. Exit code 1 on any failure.
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.tagName + '.' + e.className).slice(0, 5); });

const EID = '11111111-1111-4111-8111-111111111111', SLUG = 'maya-leo-k7m2q';
const HOST = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', email: 'host@example.com' };
const SCHED = [{ date: '2027-03-11', time: '19:00', title: 'Welcome dinner', note: '' }, { date: '2027-03-12', time: '16:00', title: 'Ceremony', note: '' },
  { date: '2027-03-12', time: '18:00', title: 'Reception', note: '' }, { date: '2027-03-13', time: '10:00', title: 'Farewell brunch', note: '' }, { date: '2027-03-13', time: '12:00', title: '', note: 'untitled' }];
const WED = { v: 2, type: 'Wedding', title: 'Maya & Leo', host: 'Maya and Leo', start: '2027-03-12T16:00', end: '2027-03-14', venue: null, schedule: SCHED, tools: { mytrip: true } };
const RQ = { meal: true, meals: ['Chicken', 'Fish', 'Vegetarian'], diet: true, plus: true, events: true, evOff: ['Farewell brunch'], qs: true, q: ['Need a ride from the hotel?', ''] };

// a tiny in-page stand-in for the parts of supabase-js the app uses (as tests/messages.js)
function fakeSupabase(seed) {
  const db = window.__db = JSON.parse(JSON.stringify(seed.db)); window.__user = seed.user;
  const qb = (name) => {
    const fs = []; let op = 'select', one = 0, head = false; const ord = [];
    const run = () => {
      const T = db[name] = db[name] || []; let data = T.filter(r => fs.every(f => f(r)));
      if (op !== 'select') return { data: [], error: null };
      for (const [k, asc] of ord.slice().reverse()) data.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
      if (head) return { data: null, count: data.length, error: null };
      if (one) return { data: data[0] || null, error: null };
      return { data, error: null };
    };
    const q = { select: (_c, o) => { if (o && o.head) head = true; return q; }, insert: () => { op = 'insert'; return q; }, update: () => { op = 'update'; return q; }, delete: () => { op = 'delete'; return q; },
      eq: (k, v) => { fs.push(r => r[k] === v); return q; }, in: () => q, is: () => q, not: () => q, gte: () => q, neq: () => q,
      order: (k, o) => { ord.push([k, !o || o.ascending !== false]); return q; }, limit: () => q,
      single: () => { one = 2; return Promise.resolve(run()); }, maybeSingle: () => { one = 1; return Promise.resolve(run()); }, then: (res, rej) => Promise.resolve(run()).then(res, rej) };
    return q;
  };
  const client = { from: qb, auth: { getSession: async () => ({ data: { session: window.__user ? { user: window.__user, access_token: 'tok' } : null } }), signOut: async () => ({}), signInWithOtp: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
  window.supabase = { createClient: () => client };
}

async function setup(browser, { w = 390, cfg = WED, user = null, db = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage(); const errors = []; const posted = [];
  page.on('pageerror', e => errors.push(String(e)));
  const full = { events: [{ id: EID, slug: SLUG, owner: HOST.id, config: cfg, published: true }], rsvps: [], announcements: [], ...db };
  await page.addInitScript(fakeSupabase, { db: full, user });
  const J = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  await page.route('**/*.supabase.co/**', (route) => {
    const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
    if (m === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p.includes('/functions/')) return J(route, 404, {});
    const tbl = p.split('/rest/v1/')[1];
    if (tbl === 'events') return J(route, 200, full.events.filter(e => u.search.includes(e.slug)).map(e => ({ ...e, updated_at: '2026-11-01T00:00:00Z' })));
    if (tbl === 'announcements') return J(route, 200, []);
    if (tbl === 'rsvps' && m === 'POST') { posted.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' }); }
    return J(route, 404, { code: 'PGRST205', message: 'not here' }); // event_groups etc.: schema-3 not installed
  });
  await page.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon|unsplash|fonts\./, r => r.abort());
  return { ctx, page, errors, posted };
}
const parse = (page, note) => page.evaluate((n) => window.__ep.rqParse(n), note);

(async () => {
  const browser = await chromium.launch();
  try {
    for (const w of [390, 320]) {
      // ---------- builder → RSVP form: each question ----------
      {
        const { ctx, page, errors } = await setup(browser, { w });
        await page.goto(BASE); await page.waitForFunction(() => window.__ep);
        const packed = await page.evaluate((c) => window.__ep.packEvent(c), WED);
        await page.evaluate(() => localStorage.clear());
        await page.goto(BASE + '#edit=' + packed); await page.waitForSelector('[data-card="replies"]');
        await page.click('[data-card="replies"]'); await page.waitForSelector('#sheet .rq-ed');
        const vis = (sel) => page.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight)).catch(() => false);
        ok(await vis('#sheet .rq-ed') && /Questions on the form/.test(await page.textContent('#sheet .rq-ed')), `@${w} builder: RSVP form card has "Questions on the form"`);
        ok((await page.$$eval('#sheet [data-rq]', is => is.filter(i => i.checked).length)) === 0 && !(await vis('#sheet [data-rq-sub="meal"]')), `@${w} builder: all questions off by default, options hidden`);
        await page.click('#sheet [data-rq="meal"]'); ok(await vis('#sheet [data-rq-meals]'), `@${w} builder: Meal choice on → options box`);
        await page.fill('#sheet [data-rq-meals]', 'Chicken\nFish\n\nVegetarian\n');
        await page.click('#sheet [data-rq="diet"]'); await page.click('#sheet [data-rq="plus"]');
        await page.click('#sheet [data-rq="events"]');
        const evs = await page.$$eval('#sheet [data-rq-ev]', is => is.map(i => i.dataset.rqEv + ':' + i.checked));
        ok(evs.join('|') === 'Welcome dinner:true|Ceremony:true|Reception:true|Farewell brunch:true', `@${w} builder: events = every titled schedule item, all asked by default: ${evs.join('|')}`);
        await page.click('#sheet [data-rq-ev="Farewell brunch"]');
        await page.click('#sheet [data-rq="qs"]'); ok(await vis('#sheet [data-rq-q="0"]') && await vis('#sheet [data-rq-q="1"]'), `@${w} builder: Your own questions → two boxes`);
        await page.fill('#sheet [data-rq-q="0"]', 'Need a ride from the hotel?');
        await page.waitForTimeout(500);
        const d = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).rsvpq);
        ok(d && d.meal && d.meals.join('|') === 'Chicken|Fish|Vegetarian' && d.diet && d.plus && d.events && d.evOff.join() === 'Farewell brunch' && d.qs && d.q[0] === 'Need a ride from the hotel?' && d.q[1] === '', `@${w} builder: saved in the page ${JSON.stringify(d)}`);
        await page.click('#sheet [data-rq="diet"]'); await page.waitForTimeout(400);
        ok((await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).rsvpq.diet)) === false, `@${w} builder: a question turns off again`);
        await page.click('#sheet [data-rsvp-on]'); ok(!(await vis('#sheet .rq-ed')), `@${w} builder: RSVP form off hides its questions`);
        await page.click('#sheet [data-rsvp-on]'); ok(await vis('#sheet .rq-ed'), `@${w} builder: and back on shows them`);
        if (SHOTS) await page.locator('#sheet .sheet-in').screenshot({ path: `${SHOTS}/rq-builder-${w}.png` });
        const ov = await overflow(page); ok(!ov.length, `@${w} builder: no overflow ${ov}`);
        // another type: the same card, all off
        const party = await page.evaluate(() => window.__ep.packEvent({ v: 2, type: 'Party', title: 'Sam turns 30', start: '2027-05-01T19:00', venue: null }));
        await page.evaluate(() => localStorage.clear()); await page.goto(BASE + '#edit=' + party); await page.waitForSelector('[data-card="replies"]');
        await page.click('[data-card="replies"]'); await page.waitForSelector('#sheet .rq-ed');
        ok((await page.$$eval('#sheet [data-rq]', is => is.filter(i => i.checked).length)) === 0, `@${w} builder: a Party page has the questions too, all off`);
        ok(!errors.length, `@${w} builder: no page errors ${errors.join(' | ')}`);
        await ctx.close();
      }

      // ---------- guest: the form asks only what is on; answers in note ----------
      {
        const { ctx, page, errors, posted } = await setup(browser, { w, cfg: { ...WED, rsvpq: RQ } });
        await page.goto(BASE + '?e=' + SLUG); await page.waitForSelector('#rs-name');
        ok(!!(await page.$('#rs-meal')) && !!(await page.$('#rs-diet')) && !!(await page.$('#rs-q0')) && !(await page.$('#rs-q1')), `@${w} guest: meal, dietary needs, question 1 (question 2 blank → not asked)`);
        ok((await page.$$eval('#rs-meal option', os => os.map(o => o.textContent).join('|'))) === 'Choose…|Chicken|Fish|Vegetarian', `@${w} guest: the organizer's meal options`);
        ok((await page.$$eval('[data-rs-ev]', is => is.map(i => i.nextElementSibling.textContent + ':' + i.checked).join('|'))) === 'Welcome dinner:true|Ceremony:true|Reception:true', `@${w} guest: events asked, all ticked, the left-out one and the untitled one missing`);
        ok(!(await page.$('[data-rs-plus]')), `@${w} guest: no name boxes for a party of 1`);
        ok(/Need a ride from the hotel\?/.test(await page.textContent('label[for="rs-q0"]')), `@${w} guest: the organizer's question is the label`);
        ok(await page.$$eval('.rsvp [required]', xs => xs.map(x => x.id).join()) === 'rs-name', `@${w} guest: still only the name is required`);
        await page.click('[data-rsvp-att="0"]'); ok(await page.$eval('[data-rsvp-x]', e => e.hidden && !e.offsetHeight), `@${w} guest: Can't make it hides the questions`);
        await page.click('[data-rsvp-att="1"]'); ok(await page.$eval('[data-rsvp-x]', e => !e.hidden), `@${w} guest: Yes shows them again`);
        await page.fill('#rs-guests', '3'); await page.waitForSelector('[data-rs-plus="1"]');
        ok((await page.$$('[data-rs-plus]')).length === 2 && (await page.$$('[data-rs-pmeal]')).length === 2, `@${w} guest: party of 3 → 2 name boxes, each with a meal`);
        await page.fill('[data-rs-plus="0"]', 'Ana Ruiz'); await page.selectOption('[data-rs-pmeal="0"]', '2');
        await page.fill('#rs-guests', '2'); await page.waitForTimeout(100);
        ok((await page.$$('[data-rs-plus]')).length === 1 && (await page.inputValue('[data-rs-plus="0"]')) === 'Ana Ruiz' && (await page.inputValue('[data-rs-pmeal="0"]')) === '2', `@${w} guest: changing the count keeps what was typed`);
        await page.fill('#rs-guests', '3'); await page.fill('[data-rs-plus="1"]', 'Ben Okafor');
        await page.fill('#rs-name', 'Gia Park'); await page.selectOption('#rs-meal', '1'); await page.fill('#rs-diet', 'No nuts');
        await page.click('[data-rs-ev="0"]'); await page.fill('#rs-q0', 'Yes, two seats'); await page.fill('#rs-note', 'Can’t wait!');
        if (SHOTS) await page.locator('#sec-rsvp').screenshot({ path: `${SHOTS}/rq-guest-${w}.png` });
        let ov = await overflow(page); ok(!ov.length, `@${w} guest: no overflow ${ov}`);
        await page.click('[data-rsvp="send"]'); await page.waitForSelector('.rsvp-done');
        const r = posted[0] || {}; const p = await parse(page, r.note);
        ok(posted.length === 1 && Object.keys(r).sort().join() === 'attending,email,event_id,guests,name,note' && r.guests === 3, `@${w} payload: the same columns as before ${Object.keys(r)}`);
        ok(p.text === 'Can’t wait!' && p.x && p.x.v === 1 && p.x.meal === 'Fish' && p.x.diet === 'No nuts' && p.x.plus.join('|') === 'Ana Ruiz|Ben Okafor' && p.x.pmeal.join('|') === 'Vegetarian|' && p.x.events.join('|') === 'Ceremony|Reception' && p.x.q1 === 'Yes, two seats' && !('q2' in p.x), `@${w} payload: answers in note after the guest's note ${JSON.stringify(p)}`);
        ok(r.note.length <= 1000 && /^Can’t wait!\n\n\[\[1lt:\{/.test(r.note), `@${w} payload: note stays within its 1000 characters (${r.note.length})`);
        await page.click('[data-rsvp="again"]'); await page.waitForSelector('#rs-meal');
        ok((await page.inputValue('#rs-meal')) === '1' && (await page.inputValue('#rs-diet')) === 'No nuts' && (await page.inputValue('[data-rs-plus="1"]')) === 'Ben Okafor' && !(await page.isChecked('[data-rs-ev="0"]')) && (await page.inputValue('#rs-note')) === 'Can’t wait!', `@${w} guest: Change my reply keeps the answers`);
        // a long note and a long party still fit
        await page.fill('#rs-note', 'x'.repeat(1000)); await page.fill('#rs-guests', '20'); await page.waitForSelector('[data-rs-plus="18"]');
        for (let k = 0; k < 19; k++) await page.fill(`[data-rs-plus="${k}"]`, 'Guest name number ' + k + ' with a very long surname here');
        await page.click('[data-rsvp="send"]'); await page.waitForSelector('.rsvp-done');
        const big = posted[1] || {}; const pb = await parse(page, big.note);
        ok(big.note.length <= 1000 && pb.x && pb.x.plus.length === 19 && pb.x.meal === 'Fish' && pb.text.startsWith('xxx'), `@${w} payload: 1000-char note + 19 names still fits (${big.note.length}), answers kept`);
        // can't make it: nothing extra
        await page.click('[data-rsvp="again"]'); await page.waitForSelector('#rs-name'); await page.fill('#rs-note', ''); await page.click('[data-rsvp-att="0"]');
        await page.click('[data-rsvp="send"]'); await page.waitForSelector('.rsvp-done');
        ok(posted[2] && posted[2].note === null && posted[2].attending === false, `@${w} payload: Can't make it → no answers, note empty as before`);
        ok(!errors.length, `@${w} guest: no page errors ${errors.join(' | ')}`);
        await ctx.close();
      }
    }

    // ---------- guest: page without the questions is unchanged ----------
    {
      const { ctx, page, errors, posted } = await setup(browser, { cfg: { ...WED, rsvpq: { ...RQ, meal: false, diet: false, plus: false, events: false, qs: false } } });
      await page.goto(BASE + '?e=' + SLUG); await page.waitForSelector('#rs-name');
      ok(!(await page.$('[data-rsvp-x]')), 'all off: no extra fields');
      await page.fill('#rs-name', 'Sam'); await page.fill('#rs-note', 'See you there'); await page.click('[data-rsvp="send"]'); await page.waitForSelector('.rsvp-done');
      ok(posted[0] && posted[0].note === 'See you there', 'all off: note sent exactly as typed');
      ok(!errors.length, 'all off: no page errors ' + errors.join(' | '));
      await ctx.close();
    }
    {
      const { ctx, page, posted } = await setup(browser, { cfg: { ...WED } });
      await page.goto(BASE + '?e=' + SLUG); await page.waitForSelector('#rs-name');
      ok(!(await page.$('[data-rsvp-x]')), 'page that never set questions: no extra fields');
      await page.fill('#rs-name', 'Sam'); await page.click('[data-rsvp="send"]'); await page.waitForSelector('.rsvp-done');
      ok(posted[0] && posted[0].note === null, 'page that never set questions: empty note stays null');
      await ctx.close();
    }

    // ---------- guest in Spanish ----------
    {
      const tr = {}; const cfg = { ...WED, rsvpq: RQ, langs: ['es'] };
      const { ctx, page, errors, posted } = await setup(browser, { cfg });
      await page.goto(BASE); await page.waitForFunction(() => window.__ep);
      const H = await page.evaluate(() => ({ c: window.__ep.hashStr('Chicken'), f: window.__ep.hashStr('Fish'), v: window.__ep.hashStr('Vegetarian'), q: window.__ep.hashStr('Need a ride from the hotel?'), r: window.__ep.hashStr('Reception') }));
      tr['rsvpq.meals[0]'] = { h: H.c, t: 'Pollo' }; tr['rsvpq.meals[1]'] = { h: H.f, t: 'Pescado' }; tr['rsvpq.meals[2]'] = { h: H.v, t: 'Vegetariano' }; tr['rsvpq.q[0]'] = { h: H.q, t: '¿Necesitas transporte desde el hotel?' }; tr['schedule[2].title'] = { h: H.r, t: 'Recepción' };
      await ctx.close();
      const s2 = await setup(browser, { cfg: { ...cfg, tr: { es: tr } } });
      const pg = s2.page;
      await pg.goto(BASE + '?e=' + SLUG + '&lang=es'); await pg.waitForSelector('#rs-meal');
      ok((await pg.textContent('label[for="rs-meal"]')) === 'Menú' && (await pg.textContent('label[for="rs-diet"]')) === 'Necesidades alimentarias (opcional)' && /¿A qué eventos irás\?/.test(await pg.textContent('.rs-evs legend')), 'Spanish: Menú, Necesidades alimentarias, ¿A qué eventos irás?');
      ok((await pg.$$eval('#rs-meal option', os => os.map(o => o.textContent).join('|'))) === 'Elige…|Pollo|Pescado|Vegetariano', 'Spanish: the organizer’s meal options translated');
      ok(/¿Necesitas transporte/.test(await pg.textContent('label[for="rs-q0"]')) && /Recepción/.test(await pg.textContent('.rs-evs')), 'Spanish: the question and event titles translated');
      await pg.fill('#rs-guests', '2'); await pg.waitForSelector('[data-rs-plus="0"]');
      ok((await pg.getAttribute('[data-rs-plus="0"]', 'placeholder')) === 'Invitado 2' && /Nombres de tus acompañantes/.test(await pg.textContent('[data-rsvp-plus]')), 'Spanish: Nombres de tus acompañantes, Invitado 2');
      await pg.fill('#rs-name', 'Lucía'); await pg.selectOption('#rs-meal', '0'); await pg.click('[data-rsvp="send"]'); await pg.waitForSelector('.rsvp-done');
      const p = await parse(pg, s2.posted[0].note);
      ok(p.x && p.x.meal === 'Chicken' && p.x.events.join('|') === 'Welcome dinner|Ceremony|Reception', 'Spanish: answers stored in the organizer’s words ' + JSON.stringify(p.x));
      const ov = await overflow(pg); ok(!ov.length, 'Spanish: no overflow ' + ov);
      ok(!s2.errors.length && !errors.length, 'Spanish: no page errors ' + s2.errors.join(' | '));
      await s2.ctx.close();
    }

    // ---------- organizer: My pages → Replies ----------
    for (const w of [390, 320]) {
      const pack = async (note, x) => { const { ctx, page } = await setup(browser); await page.goto(BASE); await page.waitForFunction(() => window.__ep); const s = await page.evaluate(([n, x]) => window.__ep.rqPack(n, x), [note, x]); await ctx.close(); return s; };
      const n1 = await pack('So excited', { v: 1, meal: 'Fish', diet: 'No nuts', plus: ['Ana Ruiz', ''], pmeal: ['Vegetarian', 'Chicken'], events: ['Ceremony', 'Reception'], q1: 'Yes please' });
      const n2 = await pack('', { v: 1, meal: 'Fish', events: [] });
      const rsvps = [{ id: 'r1', event_id: EID, name: 'Gia Park', email: 'gia@example.com', attending: true, guests: 3, note: n1, created_at: '2026-11-10T00:00:00Z' },
        { id: 'r2', event_id: EID, name: 'Old Reply', email: null, attending: true, guests: 2, note: 'Plain old note', created_at: '2026-11-09T00:00:00Z' },
        { id: 'r3', event_id: EID, name: 'No Note', email: null, attending: false, guests: 0, note: null, created_at: '2026-11-08T00:00:00Z' },
        { id: 'r4', event_id: EID, name: 'Sol', email: null, attending: true, guests: 1, note: n2, created_at: '2026-11-07T00:00:00Z' }];
      const { ctx, page, errors } = await setup(browser, { w, user: HOST, cfg: { ...WED, rsvpq: RQ }, db: { rsvps } });
      await page.addInitScript(() => localStorage.setItem('ep:signedIn', 'true'));
      await page.goto(BASE + '#mine/' + EID); await page.waitForSelector('.rs-tbl');
      const heads = await page.$$eval('.rs-tbl th', ts => ts.map(t => t.textContent));
      ok(heads.join('|') === 'Name|Reply|Party|Meal|Dietary needs|Party names|Events|Need a ride from the hotel?|Email|Note', `@${w} replies: a column per answered question ${heads.join('|')}`);
      const row = (name) => page.$$eval('.rs-tbl tbody tr', (trs, n) => { const tr = trs.find(t => t.cells[0].textContent === n); return tr ? [...tr.cells].map(c => c.textContent) : null; }, name);
      const g = await row('Gia Park');
      ok(g && g[3] === 'Fish' && g[4] === 'No nuts' && g[5] === 'Ana Ruiz (Vegetarian), Guest 3 (Chicken)' && g[6] === 'Ceremony, Reception' && g[7] === 'Yes please' && g[9] === 'So excited', `@${w} replies: Gia's answers, note without the stored answers ${JSON.stringify(g)}`);
      const o = await row('Old Reply');
      ok(o && o[9] === 'Plain old note' && o.slice(3, 8).every(c => c === ''), `@${w} replies: an old reply renders as before ${JSON.stringify(o)}`);
      ok((await row('No Note'))[9] === '' && (await row('Sol'))[6] === 'None' && (await row('Sol'))[9] === '', `@${w} replies: no note, and no events ticked → None`);
      ok(!/\[\[1lt/.test(await page.textContent('.mine')), `@${w} replies: the stored form never shows`);
      const sum = (await page.$$eval('.rs-sum2', ps => ps.map(p => p.textContent.replace(/\s+/g, ' ').trim()))).join(' / ');
      ok(sum === 'Meals: Fish 2 · Vegetarian 1 · Chicken 1 / Events: Ceremony 3 · Reception 3', `@${w} replies: meal and event headcounts "${sum}"`);
      if (SHOTS) await page.locator('.mine').screenshot({ path: `${SHOTS}/rq-replies-${w}.png` });
      const ov = await overflow(page); ok(!ov.length, `@${w} replies: no overflow (table scrolls in its box) ${ov}`);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-rs="csv"]')]);
      const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').split('\r\n');
      ok(csv[0] === 'Name,Reply,Party,Meal,Dietary needs,Party names,Events,Need a ride from the hotel?,Email,Note,Sent', `@${w} CSV: same columns ${csv[0]}`);
      ok(csv.some(l => l.startsWith('Gia Park,Coming,3,Fish,No nuts,"Ana Ruiz (Vegetarian), Guest 3 (Chicken)","Ceremony, Reception",Yes please,gia@example.com,So excited,')) && csv.some(l => l.startsWith('Old Reply,Coming,2,,,,,,,Plain old note,')), `@${w} CSV: answers and the old reply ${csv.slice(1, 3).join(' // ')}`);
      ok(!errors.length, `@${w} replies: no page errors ${errors.join(' | ')}`);
      await ctx.close();
    }
    // only old replies → the table is exactly as before
    {
      const { ctx, page, errors } = await setup(browser, { user: HOST, cfg: WED, db: { rsvps: [{ id: 'r2', event_id: EID, name: 'Old Reply', email: null, attending: true, guests: 2, note: 'Plain old note', created_at: '2026-11-09T00:00:00Z' }] } });
      await page.addInitScript(() => localStorage.setItem('ep:signedIn', 'true'));
      await page.goto(BASE + '#mine/' + EID); await page.waitForSelector('.rs-tbl');
      ok((await page.$$eval('.rs-tbl th', ts => ts.map(t => t.textContent).join('|'))) === 'Name|Reply|Party|Email|Note' && !(await page.$('.rs-sum2')), 'old replies only: the same columns as before, no headcounts');
      ok(!errors.length, 'old replies only: no page errors ' + errors.join(' | '));
      await ctx.close();
    }
  } catch (e) { ok(false, 'crashed: ' + (e && e.stack || e)); }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
