// One RSVP (Dylan's simplify review, items 1 and 2). Builder: a single "RSVP" card — "Collect replies here" (the form,
// with its questions) or "Use my own link", a reply-by date for both, or "No RSVP" — instead of an "RSVP" link card and
// an "RSVP form" card. Pages saved with either or both keep working: a link (with the form not asking anything) reads as
// "Use my own link", a form with questions on stays the form, the link and the questions are never dropped. Guest page:
// an RSVP button at the top beside Add to calendar / Directions / Share — the organizer's link, or a jump to the form
// (unfolding it); none on a long link in form mode (no form there) or on trips. ?demo=wedding: the button and a form
// whose replies stay on the device.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/rsvp-one.js
const { chromium } = require(process.env.PW || 'playwright');
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

const LINK = 'https://www.zola.com/wedding/mayaleo/rsvp';
const legacyLink = { ...WED, x: { Wedding: { rsvp: LINK, rsvpBy: '2027-01-15', dress: 'Beach formal' } } };
const legacyLinkOff = { ...legacyLink, off: { rsvp: true } };
const legacyBoth = { ...legacyLink, rsvpq: { meal: true, meals: ['Fish', 'Chicken'], diet: false, plus: false, events: false, evOff: [], qs: false, q: ['', ''] } };
const formOnly = { ...WED, x: { Wedding: { rsvpBy: '2027-01-15' } } };

(async () => {
  const browser = require('./_open-settings')(await chromium.launch());
  try {
    for (const w of [390, 320]) {
      // ---------- builder: one RSVP card ----------
      {
        const { ctx, page, errors } = await setup(browser, { w });
        await page.goto(BASE); await page.waitForFunction(() => window.__ep);
        const vis = (sel) => page.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight)).catch(() => false);
        const open = async (cfg) => { const packed = await page.evaluate((c) => window.__ep.packEvent(c), cfg); await page.evaluate(() => localStorage.clear()); await page.goto(BASE + '#edit=' + packed); await page.waitForSelector('[data-card="rsvp"]'); };
        const mode = () => page.$eval('#sheet [data-rsvp-via]:checked', i => i.dataset.rsvpVia).catch(() => '');
        const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));

        await open(legacyLink);
        const cards = await page.$$eval('.b-form .acard', bs => bs.map(b => b.querySelector('b').textContent));
        ok(cards.filter(t => /^RSVP/.test(t)).length === 1 && !cards.includes('RSVP form'), `@${w} one RSVP card (${cards.filter(t => /RSVP/.test(t)).join(', ')})`);
        ok(await page.$eval('.b-form .cards .acard', b => b.dataset.card) === 'rsvp', `@${w} RSVP leads For weddings`);
        ok(!(await page.$$eval('.b-form .acard span', ss => ss.some(s => /Short links only|Link, reply-by/.test(s.textContent)))), `@${w} the old card subtitles are gone`);
        await page.click('[data-card="rsvp"]'); await page.waitForSelector('#sheet [data-rsvp-via]');
        ok(await page.$$eval('#sheet [data-rsvp-via]', is => is.map(i => i.dataset.rsvpVia).join()) === 'form,link,off', `@${w} Collect replies here / Use my own link / No RSVP`);
        ok(await mode() === 'link' && await page.inputValue('#sheet [data-x="rsvp"]') === LINK && await page.inputValue('#sheet [data-x="rsvpBy"]') === '2027-01-15', `@${w} old link page opens as Use my own link, link + reply-by kept`);
        ok(!(await vis('#sheet .rq-ed')), `@${w} link mode hides the form's questions`);
        ok(!/short link/i.test(await page.textContent('#sheet .sheet-b')), `@${w} no "short link" explainer`);
        if (SHOTS) await page.locator('#sheet .sheet-in').screenshot({ path: `${SHOTS}/rsvp-card-link-${w}.png` });
        await page.click('#sheet [data-rsvp-via="form"]'); await page.waitForTimeout(400);
        let d = await draft();
        ok(await vis('#sheet .rq-ed') && !(await vis('#sheet [data-x="rsvp"]')) && await vis('#sheet [data-x="rsvpBy"]'), `@${w} Collect replies here: questions + reply-by, no link box`);
        ok(d.rsvpVia === 'form' && d.x.Wedding.rsvp === LINK && !d.off.rsvp, `@${w} switching keeps the link stored ${JSON.stringify({ v: d.rsvpVia, x: d.x.Wedding.rsvp })}`);
        await page.click('#sheet [data-rsvp-via="off"]'); await page.waitForTimeout(400); d = await draft();
        ok(d.off.rsvp === true && !(await vis('#sheet [data-x="rsvpBy"]')), `@${w} No RSVP turns it off`);
        await page.click('#sheet [data-b="close"]'); await page.waitForTimeout(300);
        ok(!(await page.$eval('.b-form [data-card="rsvp"]', b => b.classList.contains('on'))), `@${w} card not ticked when off`);
        await page.click('.b-form [data-card="rsvp"]'); await page.waitForSelector('#sheet [data-rsvp-via]');
        await page.click('#sheet [data-rsvp-via="link"]'); await page.fill('#sheet [data-x="rsvp"]', 'https://example.com/r'); await page.waitForTimeout(400); d = await draft();
        ok(d.rsvpVia === 'link' && !d.off.rsvp && d.x.Wedding.rsvp === 'https://example.com/r', `@${w} Use my own link saves the link`);
        await page.click('#sheet [data-b="close"]');

        await open(legacyLinkOff); await page.click('[data-card="rsvp"]'); await page.waitForSelector('#sheet [data-rsvp-via]');
        ok(await mode() === 'link', `@${w} old page: link with the form switched off → Use my own link (still on)`);
        await page.click('#sheet [data-b="close"]');
        await open(legacyBoth); await page.click('[data-card="rsvp"]'); await page.waitForSelector('#sheet [data-rsvp-via]');
        ok(await mode() === 'form' && await page.$eval('#sheet [data-rq="meal"]', i => i.checked) && await page.inputValue('#sheet [data-rq-meals]') === 'Fish\nChicken', `@${w} old page: form with questions + link → Collect replies here, questions kept`);
        await page.click('#sheet [data-rsvp-via="link"]'); ok(await page.inputValue('#sheet [data-x="rsvp"]') === LINK, `@${w} and its link is still there`);
        await page.click('#sheet [data-b="close"]');
        // a NEW page: RSVP is off except on weddings (Dylan 11/24 "Leave off by default"); the card switches it on
        const fresh = await page.evaluate(() => { const E = window.__ep; return E.TYPES.filter(t => t !== 'Trip').map(t => [t, E.rsvpOf(E.normalize({ ...E.freshEvent(t), title: 'X' })).on]); });
        ok(fresh.every(([t, on]) => on === (t === 'Wedding')), `@${w} new pages: RSVP on only for Wedding ${JSON.stringify(fresh.filter(([, on]) => on))}`);
        await open({ ...(await page.evaluate(() => window.__ep.freshEvent('Concert'))), title: 'Night show', start: '2027-05-01T19:00' });
        ok(!(await page.$eval('.b-form [data-card="rsvp"]', b => b.classList.contains('on'))) && !(await page.$('#preview .stub-actions a.btn.primary[href*="rsvp"], #preview #sec-rsvp')), `@${w} new Concert: RSVP card off, no RSVP on the page`);
        await page.click('[data-card="rsvp"]'); await page.waitForSelector('#sheet [data-rsvp-via]');
        ok(await mode() === 'off', `@${w} new Concert: the card reads No RSVP`);
        await page.click('#sheet [data-rsvp-via="form"]'); await page.waitForTimeout(400); d = await draft();
        ok(!d.off.rsvp && d.rsvpVia === 'form', `@${w} new Concert: Collect replies here switches it on`);
        await page.click('#sheet [data-b="close"]'); await page.waitForTimeout(500);
        ok(await page.$eval('.b-form [data-card="rsvp"]', b => b.classList.contains('on')) && (await page.evaluate(() => window.__ep.rsvpOf(JSON.parse(localStorage.getItem('ep:draft'))).on)), `@${w} new Concert: RSVP card ticked, guests get the form`);
        // an existing page of another type (saved before, no off.rsvp): keeps its RSVP — same card under For any event, the form by default
        await open({ v: 2, type: 'Party', title: 'Sam turns 30', start: '2027-05-01T19:00', venue: null });
        await page.click('[data-card="rsvp"]'); await page.waitForSelector('#sheet [data-rsvp-via]');
        ok(await mode() === 'form', `@${w} Party: Collect replies here by default`);
        await page.click('#sheet [data-rsvp-via="link"]'); await page.fill('#sheet [data-x="rsvp"]', 'https://example.com/party'); await page.fill('#sheet [data-x="rsvpBy"]', '2027-04-20'); await page.waitForTimeout(400);
        d = await draft(); ok(d.x.Party && d.x.Party.rsvp === 'https://example.com/party' && d.x.Party.rsvpBy === '2027-04-20', `@${w} Party: own link + reply-by saved`);
        await page.click('#sheet [data-b="close"]'); await page.waitForTimeout(500);
        ok(await page.$eval('#preview .stub-actions a.btn.primary', a => a.textContent.trim() + ' ' + a.href).catch(() => '') === 'RSVP https://example.com/party', `@${w} Party preview: RSVP button at the top`);
        ok(/Reply by/.test(await page.textContent('#preview #sec-details').catch(() => '')), `@${w} Party preview: reply-by in Need to know`);
        const ov = await overflow(page); ok(!ov.length, `@${w} builder: no overflow ${ov}`);
        ok(!errors.length, `@${w} builder: no page errors ${errors.join(' | ')}`);
        await ctx.close();
      }

      // ---------- guest: RSVP at the top ----------
      {
        const { ctx, page, errors, posted } = await setup(browser, { w, cfg: formOnly });
        await page.goto(BASE); await page.waitForFunction(() => window.__ep);
        const acts = () => page.$$eval('.stub-actions > *', es => es.map(e => (e.matches('details') ? e.querySelector('summary') : e).textContent.trim()));
        // the organizer's link (an old page), on a long link
        await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), legacyLink)); await page.waitForSelector('.stub-actions');
        ok((await acts())[0] === 'RSVP' && await page.$eval('.stub-actions a.btn.primary', a => a.href) === LINK, `@${w} own link: RSVP first at the top, opens the link (${(await acts()).join(' | ')})`);
        ok(/RSVP[\s\S]*Reply by/.test(await page.textContent('#sec-details')), `@${w} own link: Need to know still says Reply by`);
        // form on a long link: no form there → no button
        await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), formOnly)); await page.waitForSelector('.stub-actions');
        ok(!(await acts()).includes('RSVP'), `@${w} form on a long link: no RSVP button`);
        // a trip: none
        await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), { v: 2, type: 'Trip', title: 'Lisbon', start: '2027-06-01', end: '2027-06-05', venue: null })); await page.waitForSelector('.ev');
        ok(!(await page.$('[data-act="rsvp"]')), `@${w} trip: no RSVP button`);
        // the short link: the button jumps to the form, unfolding it
        await page.goto(BASE + '?e=' + SLUG); await page.waitForSelector('#rs-name');
        ok((await acts()).join(' | ').startsWith('RSVP | Add to calendar'), `@${w} short link: RSVP · Add to calendar · … (${(await acts()).join(' | ')})`);
        if (SHOTS) await page.locator('.stub').screenshot({ path: `${SHOTS}/rsvp-top-${w}.png` });
        await page.click('#sec-rsvp .sec-h'); ok(!(await page.$eval('#rs-name', e => e.checkVisibility())), `@${w} RSVP section folds by its title`);
        await page.evaluate(() => window.scrollTo(0, 0)); await page.click('[data-act="rsvp"]'); await page.waitForTimeout(700);
        const inView = await page.$eval('#sec-rsvp', s => { const r = s.getBoundingClientRect(); return r.top >= -2 && r.top < innerHeight / 2; });
        ok(await page.$eval('#rs-name', e => e.checkVisibility()) && inView, `@${w} RSVP button unfolds the form and scrolls to it`);
        ok(!posted.length, `@${w} nothing sent by tapping`);
        const ov = await overflow(page); ok(!ov.length, `@${w} guest: no overflow ${ov}`);
        // the wedding example: button + a form that stays on the device
        await page.goto(BASE + '?demo=wedding'); await page.waitForSelector('[data-act="rsvp"]');
        await page.click('[data-act="rsvp"]'); await page.waitForSelector('#rs-name');
        await page.fill('#rs-name', 'Demo Guest'); await page.click('[data-rsvp="send"]'); await page.waitForSelector('.rsvp-done');
        ok(/Demo Guest/.test(await page.textContent('.rsvp-done')) && posted.length === 0, `@${w} demo: reply shows thanks, nothing sent`);
        const dov = await overflow(page); ok(!dov.length, `@${w} demo: no overflow ${dov}`);
        ok(!errors.length, `@${w} guest: no page errors ${errors.join(' | ')}`);
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
