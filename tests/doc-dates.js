// Itinerary dates from an uploaded document land on the document's days. Regression for "the flight says April 25 and it
// shows as April 2": a page made with Customize this on the Japan example kept the example's sample itinerary (Fri Apr 2
// "Land at Haneda" … Apr 11) next to the imported trip, so the itinerary opened on Apr 2 and the trip-span repair stretched
// the trip's dates back to it; an Itinerary-only fill on that page squeezed the document's dates into the example's ten
// days (Unscheduled). Now the example's verbatim sample items / stops are dropped once the trip's own plans are wholly
// apart from them — on import and, for pages saved before, on load — and dates that came from the sample become the trip's.
// Also: pasted confirmations read every common date style (Apr 25, 25 Apr, 04/25/2027, 2027-04-25, airline 25APR / 25APR27).
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/doc-dates.js
//
// supabase-js is faked in the page; ai-import answers are canned in the shape the live function returns. Exit 1 on failure.
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };

// what ai-import mode "doc" returned (live, v17) for a Japan itinerary: UA 7909 EWR→HND Apr 25, UA 7924 HND→EWR Jun 2
const DOC = {
  title: 'Japan trip', type: 'Trip', tagline: '', host: '', description: '', start_date: '2027-04-25', start_time: '', end_date: '2027-06-02', end_time: '',
  venue_name: '', venue_address: '', rsvp_url: '', rsvp_by: '', dress_code: '', hotel_blocks: [], faqs: [], links: [], details: {}, extras: [], sections: [], bring: '',
  access: { dropoff: '', entrance: '', parking: '', restrooms: '', notes: '' },
  stops: [{ city: 'Tokyo', country: 'Japan', arrive: '2027-04-26', leave: '2027-05-03' }, { city: 'Kyoto', country: 'Japan', arrive: '2027-05-03', leave: '2027-05-10' },
    { city: 'Osaka', country: 'Japan', arrive: '2027-05-10', leave: '2027-05-20' }, { city: 'Tokyo', country: 'Japan', arrive: '2027-05-20', leave: '2027-06-02' }],
  schedule: [{ date: '2027-04-25', time: '11:00', title: 'Flight UA 7909 EWR to HND', note: 'Arrives Apr 26 2:25 PM. Conf K7Q2LM', kind: 'reservation' },
    { date: '2027-04-26', time: '', title: 'Check in: Park Hyatt Tokyo', note: '', kind: 'reservation' },
    { date: '2027-05-03', time: '10:00', title: 'Shinkansen Nozomi 23 Tokyo to Kyoto', note: '', kind: 'reservation' },
    { date: '2027-05-10', time: '', title: 'Check in: Conrad Osaka', note: '', kind: 'reservation' },
    { date: '2027-06-02', time: '18:40', title: 'Flight UA 7924 HND to EWR', note: 'Arrives Jun 2 6:55 PM', kind: 'reservation' }],
};

function fakeSupabase(user) {
  window.__ai = [];
  const client = { storage: { from: () => ({}) }, from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    auth: { getSession: async () => ({ data: { session: user ? { user, access_token: 'a.b.c' } : null } }), signInWithOtp: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
  window.supabase = { createClient: () => client };
}
const USER = { id: 'u0000000-0000-4000-8000-000000000001', email: 'host@example.com' };
const pdf = () => ({ name: 'japan-itinerary.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 32)]) });

(async () => {
  const browser = await chromium.launch();
  const mk = async (answer = () => DOC) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(fakeSupabase, USER);
    await page.route(/open-meteo|overpass|nominatim|googleapis\.com\/(?!css)|tile\.openstreetmap|timeapi|photon/, r => r.abort());
    await page.route('**/functions/v1/ai-import', async (r) => {
      if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ready: true, modes: ['url', 'text', 'edit', 'translate', 'file', 'doc'] }) });
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, body: 'ok' });
      const body = JSON.parse(r.request().postData() || '{}');
      if (body.mode === 'translate') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'translate', data: { translations: [] } }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'event', data: answer(body) }) });
    });
    await page.route('https://mljzoujystouqkmmoemn.supabase.co/rest/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ep:signedIn', 'true'); localStorage.setItem('ep:aiReady', JSON.stringify({ t: Date.now(), ok: true })); });
    return { ctx, page, errors };
  };
  const draft = async (page) => { await page.waitForTimeout(450); return page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft'))); };
  const guest = async (page, cfg) => { // the guest page for a config: first day header + its first item
    await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), cfg)); await page.waitForSelector('.ev-hero'); await page.waitForTimeout(300);
    return page.evaluate(() => ({ days: [...document.querySelectorAll('.day-h')].map(x => x.textContent.replace(/\s+/g, ' ').trim()), first: ((document.querySelector('.day .tl li') || {}).textContent || '').replace(/\s+/g, ' ').trim(), body: document.body.textContent }));
  };
  const SAMPLE = /Land at Haneda|Park Hotel Tokyo|Shinjuku Gyoen|Fly home from Haneda/;
  try {
    // ---------- pasted confirmations: every date style reads as the same day ----------
    {
      const { ctx, page } = await mk();
      const read = (s) => page.evaluate((s) => window.__ep.parseReservation(s, '2027-04-01').start.slice(0, 10), s);
      for (const s of ['United UA 7909 Departs Apr 25 11:00 AM EWR', 'United UA 7909 Departs April 25, 2027 at 11:00 AM', 'United UA 7909 Departs 25 Apr 11:00 EWR', 'United UA 7909 Departs 25 April 2027 11:00',
        'United UA 7909 Departs 04/25/2027 11:00 EWR', 'United UA 7909 Departs 2027-04-25 11:00 EWR', 'United UA 7909 Departs Sun, 25APR 1100 EWR', 'Flight UA7909\nDate: 25APR27\nDepart 11:00'])
        ok(await read(s) === '2027-04-25', `"${s.replace(/\n/g, ' / ')}" → ${await read(s)}`);
      for (const s of ['United UA 7924 Departs Jun 2 6:40 PM HND', 'United UA 7924 Departs 2 Jun 18:40 HND', 'United UA 7924 Departs 06/02/2027 18:40', 'United UA 7924 Departs 2027-06-02 18:40', 'United UA 7924 Departs Wed, 02JUN 1840 HND'])
        ok(await read(s) === '2027-06-02', `"${s}" → ${await read(s)}`);
      await ctx.close();
    }

    // ---------- Customize this on the Japan example → Upload a document (whole page) ----------
    {
      const { ctx, page, errors } = await mk();
      await page.goto(BASE + '#edit-ex=japan-trip'); await page.waitForSelector('[data-doc-key="main"] [data-doc-pick]', { state: 'attached' });
      await page.setInputFiles('[data-doc-pick]', pdf()); await page.waitForSelector('[data-doc-go="fill"]:not([hidden])');
      await page.click('[data-doc-go="fill"]'); await page.waitForSelector('[data-doc-key="main"] [data-sheet="doc-review"]');
      const td = (await page.textContent('[data-doc-key="main"] .dr-dates')).replace(/\s+/g, ' ');
      ok(/Apr 25\s*–\s*Jun 2, 2027/.test(td), `review: trip dates ${td}`);
      await page.click('[data-doc-key="main"] [data-doc-apply]'); await page.waitForSelector('[data-doc-key="main"] [data-doc-undo]');
      const c = await draft(page);
      ok(c.start === '2027-04-25' && c.end === '2027-06-02', `page dates ${c.start} – ${c.end}`);
      const fl = c.schedule.filter(x => /^Flight UA/.test(x.title)).map(x => `${x.date} ${x.title}`);
      ok(fl.join(' | ') === '2027-04-25 Flight UA 7909 EWR to HND | 2027-06-02 Flight UA 7924 HND to EWR', `flights: ${fl.join(' | ')}`);
      ok(!c.schedule.some(x => SAMPLE.test(x.title)) && c.schedule.length === 5, `the example's sample itinerary is gone (${c.schedule.length} items: ${c.schedule.map(x => x.date + ' ' + x.title).join(', ')})`);
      ok(c.stops.map(s => `${s.name} ${s.from}–${s.to}`).join(', ') === 'Tokyo 2027-04-26–2027-05-03, Kyoto 2027-05-03–2027-05-10, Osaka 2027-05-10–2027-05-20, Tokyo 2027-05-20–2027-06-02', `route ${c.stops.map(s => s.name + ' ' + s.from).join(', ')}`);
      const g = await guest(page, c);
      ok(/^Day 1 · Sun, Apr 25/.test(g.days[0] || '') && /Flight UA 7909/.test(g.first), `guest itinerary opens "${g.days[0]}" with "${g.first.slice(0, 40)}"`);
      ok(!SAMPLE.test(g.body) && !/Apr 2\b(?!\d)/.test(g.days.join(' ')), 'no Apr 2 / sample items on the guest page');
      ok(!errors.length, 'no page errors ' + errors.join(' | '));
      await ctx.close();
    }

    // ---------- Itinerary-only fill on the example: the document's days, not Unscheduled ----------
    {
      const { ctx, page, errors } = await mk((b) => ({ ...DOC, stops: [] }));
      await page.goto(BASE + '#edit-ex=japan-trip'); await page.waitForSelector('[data-doc-key="main"]', { state: 'attached' });
      const c0 = await draft(page);
      const items = await page.evaluate((d) => window.__ep.docItems(JSON.parse(localStorage.getItem('ep:draft')), d, 'schedule'), { ...DOC, stops: [] });
      const c = await page.evaluate(async (items) => window.__ep.docApply(JSON.parse(localStorage.getItem('ep:draft')), items), items);
      ok(c0.start === '2027-04-02', 'starts on the example');
      const fl = c.schedule.filter(x => /^Flight UA/.test(x.title)).map(x => x.date);
      ok(fl.join() === '2027-04-25,2027-06-02', `flights keep their days (${fl.join()})`);
      ok(c.start === '2027-04-25' && c.end === '2027-06-02' && !c.schedule.some(x => SAMPLE.test(x.title)) && !c.stops.length, `dates ${c.start} – ${c.end}, sample items + stops gone (${c.schedule.length}, ${c.stops.length})`);
      ok(!errors.length, 'no page errors ' + errors.join(' | '));
      await ctx.close();
    }

    // ---------- saved before the fix: sample itinerary + the document's, dates stretched to Apr 1 ----------
    {
      const { ctx, page, errors } = await mk();
      const ex = await page.evaluate(() => JSON.parse(JSON.stringify(window.EXAMPLES['japan-trip'])));
      const old = { ...ex, start: '2027-04-01', end: '2027-06-02', stops: DOC.stops.map(s => ({ name: s.city, from: s.arrive, to: s.leave })), schedule: ex.schedule.concat(DOC.schedule.map(x => ({ date: x.date, time: x.time, title: x.title, note: x.note }))) };
      delete old.demoTrip;
      const f = await page.evaluate((c) => window.__ep.spanFixed(c), old);
      ok(f.start === '2027-04-25' && f.end === '2027-06-02' && f.schedule.length === 5 && !f.schedule.some(x => SAMPLE.test(x.title)), `load repair: ${f.start} – ${f.end}, ${f.schedule.length} items`);
      ok(/^modes:/.test(f.ek || ''), `page key pinned so guests' data stays with it (${f.ek})`);
      const g = await guest(page, old);
      ok(/^Day 1 · Sun, Apr 25/.test(g.days[0] || '') && /Flight UA 7909/.test(g.first) && !SAMPLE.test(g.body), `guest page: "${g.days[0]}" · "${g.first.slice(0, 30)}"`);
      // a page still built on the example keeps it: the example itself, and the example with one item of the host's own
      const same = await page.evaluate((ex) => { const E = window.__ep; const a = E.spanFixed(ex); const one = { ...ex, schedule: ex.schedule.concat([{ date: '2027-06-10', time: '', title: 'Our own plan' }]) }; const b = E.spanFixed(one);
        const near = { ...ex, stops: [{ name: 'Nara', from: '2027-04-08', to: '2027-04-09' }], schedule: ex.schedule.concat([{ date: '2027-04-08', time: '', title: 'Deer park' }, { date: '2027-04-09', time: '', title: 'Todai-ji' }]) }; const c = E.spanFixed(near);
        return [a === ex, b.schedule.length === one.schedule.length, c.schedule.length === near.schedule.length]; }, ex);
      ok(same.every(Boolean), `example kept when it is still the plan (example, one stray item, overlapping own plans): ${same}`);
      ok(!errors.length, 'no page errors ' + errors.join(' | '));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
