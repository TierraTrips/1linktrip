// Organizer layouts by event type (Dylan 11/26: "Why is the race layout similar to the wedding? … The wedding stuff doesn't
// apply at all"; "lots of optional features … but it shouldn't be the default"; "it's still primarily a travel site"):
//  - race: Travel · Runners · Race weekend · Updates (+ Shuttles, Volunteers turned on in the demo); no Seating / Invitations /
//    Dietary / Groups / RSVP / households; dashboard Runners · Out of town · Arrivals shared · Hotel chosen · Volunteers
//  - conference: Travel · Attendees · Agenda · Updates (+ Shuttles, Badges); dated ahead (2027), not in the past
//  - wedding: unchanged screens, as add-ons (Guest list & RSVP, Dietary, Seating, Invitations, Shuttles)
//  - Add features: a feature turned on shows its tab, turned off hides it (its data stays)
//  - roster import: a RunSignup-style export is matched by column names (First/Last Name, Bib Num, Event, City + State, Team)
//  - volunteers: a shift added shows with its filled / needed count
//  - every organizer tab and every demo-bar link is in sight at 390 (the "4 tabs" you couldn't see: the tab row scrolled
//    its tabs off the edge with no scrollbar); the logo and "← Examples" lead home
//  - travel-only page: the event's website up top, no RSVP / About / schedule, the 4 guest tabs
//  - demo: zero Supabase requests, zero notify calls, nothing in localStorage
//   node tests/_pages-server.js 18765 &  node tests/org-types.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
(async () => {
  const browser = await chromium.launch();
  const open = async (w) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const net = { sb: [], notify: 0 }; const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => { const u = r.url(); if (/supabase\.(co|in)\b/.test(u)) net.sb.push(r.method() + ' ' + u.replace(/\?.*/, '')); if (/\/functions\/v1\/notify/.test(u)) net.notify++; });
    await page.route(/open-meteo|overpass|nominatim|tile\.openstreetmap|photon|timeapi|maps\.mail\.ru/, r => r.abort());
    return { ctx, page, net, errors };
  };
  const tab = async (page, k) => { await page.click(`[data-gl-tab="${k}"]`); await page.waitForTimeout(300); };
  const tabs = (page) => page.$$eval('[data-gl-tab]', xs => xs.map(x => x.dataset.glTab));
  const labels = (page) => page.$$eval('[data-gl-tab]', xs => xs.map(x => x.textContent.trim()));
  const sum = (page) => page.$$eval('[data-gl-sum] div', ds => Object.fromEntries(ds.map(d => [d.querySelector('small').textContent, d.querySelector('b').textContent])));
  const inView = (page, sel) => page.$$eval(sel, (xs) => { const cw = document.documentElement.clientWidth; return xs.filter(x => x.offsetParent).map(x => { const r = x.getBoundingClientRect(); return [x.textContent.trim(), r.left >= -1 && r.right <= cw + 1 && r.width > 0]; }); });
  const WEDDINGY = /Seating|Invitations|Dietary|Groups|RSVP|Household|Guests\b/;

  for (const w of [390, 1280]) {
    // ---------- race ----------
    { const { ctx, page, net, errors } = await open(w); const L = `race ${w}:`;
      await page.goto(`${BASE}?demo=race&view=organizer`); await page.waitForSelector('[data-gl-tab]', { timeout: 30000 }); await page.waitForTimeout(400);
      ok(JSON.stringify(await tabs(page)) === JSON.stringify(['trav', 'list', 'info', 'shut', 'vol', 'upd']), `${L} tabs Travel · Runners · Race weekend · Shuttles · Volunteers · Updates (${(await labels(page)).join(' · ')})`);
      ok(!(await labels(page)).some(l => WEDDINGY.test(l)), `${L} no Seating / Invitations / Dietary / Groups / RSVP / Guests tab`);
      const s = await sum(page);
      ok(+s.Runners >= 140 && +s['Out of town'] > 40 && +s['Arrivals shared'] > 20 && +s['Hotel chosen'] > 20 && /^\d+\/\d+$/.test(s.Volunteers) && !('Invites' in s) && !('Opened' in s) && !('Coming' in s) && !('No reply' in s), `${L} race dashboard (${JSON.stringify(s)})`);
      ok((await page.textContent('h1')).trim() === 'Runners', `${L} the screen is called Runners`);
      const tv = await inView(page, '[data-gl-tab]'); ok(tv.every(x => x[1]), `${L} every tab is in sight${tv.filter(x => !x[1]).length ? ' — hidden: ' + tv.filter(x => !x[1]).map(x => x[0]).join(', ') : ''}`);
      const bar = await inView(page, '#org-bar a'); ok(bar.length >= 6 && bar.every(x => x[1]), `${L} every demo-bar link is in sight (${bar.map(x => x[0] + (x[1] ? '' : ' ✗')).join(' | ')})`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/race-${w}-trav.png` });
      await tab(page, 'list');
      ok((await page.$$eval('.ro-r:not(.ro-h)', xs => xs.length)) >= 140, `${L} roster lists the runners`);
      ok(!(await page.$('.gl-h, .gl-trail, [data-gl-f="norsvp"]')), `${L} no households, RSVP trail or RSVP filters`);
      ok((await page.$$eval('[data-ro-seg]', xs => xs.map(x => x.textContent))).join(' ').match(/5K.*10K.*Half marathon/), `${L} distance chips`);
      if (w === 1280) ok(JSON.stringify(await page.$$eval('.ro-h span', xs => xs.map(x => x.textContent.trim()).filter(Boolean))) === JSON.stringify(['Name', 'Bib', 'Distance', 'Wave', 'Start time', 'Hometown', 'Club']), `${L} roster columns Name · Bib · Distance · Wave · Start time · Hometown · Club`);
      else ok(/#\d+ · .+ · Wave /.test(await page.textContent('.ro-r:not(.ro-h) .ro-m')), `${L} phone row: bib · distance · wave`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/race-${w}-list.png` });
      await tab(page, 'info');
      ok((await page.$$eval('.ot-waves li', xs => xs.length)) >= 6, `${L} race weekend: waves with start times`);
      ok(/Fri May 14, 12–7 PM/.test(await page.textContent('.ot-grid')) && /Gear check/.test(await page.textContent('.ot-grid')) && /Buckingham Fountain/.test(await page.textContent('.ot-grid')), `${L} race weekend: packet pickup over two days, gear check, course start`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/race-${w}-info.png` });
      await tab(page, 'vol');
      const vt = await page.textContent('.vl'); ok(/\d+ of \d+ places filled/.test(vt) && (await page.$$eval('.vl-shifts li', xs => xs.length)) >= 8, `${L} volunteers: shifts with filled / needed`);
      await tab(page, 'upd'); ok((await page.$$eval('.ot-to [data-ot-to]', xs => xs.map(x => x.textContent))).join(' ').includes('Half marathon'), `${L} updates: send to everyone or one distance`);
      if (w === 1280) {
        // Add features: Seating on → its tab; off → gone
        await page.click('[data-mod-open]'); await page.waitForSelector('dialog[open] [data-mod]');
        const order = await page.$$eval('dialog[open] [data-mod]', xs => xs.map(x => x.dataset.mod)); ok(order.slice(0, 4).join() === 'vol,shut,groups,fld', `${L} Add features: race suggestions first (${order.join(',')})`);
        await page.$eval('dialog[open] [data-mod="seat"]', x => x.click()); await page.waitForTimeout(400);
        ok((await tabs(page)).includes('seat'), `${L} Seating turned on → its tab`);
        await page.$eval('dialog[open] [data-mod="seat"]', x => x.click()); await page.waitForTimeout(400);
        ok(!(await tabs(page)).includes('seat'), `${L} Seating turned off → gone`);
        ok(await page.evaluate(() => (window.__orgDemo.db.events[0].config.org.mods || {}).seat === false), `${L} the choice is saved with the page (in the demo's stand-in)`);
        await page.click('dialog[open] [data-gl-x]');
        // import: a RunSignup-style export
        await tab(page, 'list'); await page.click('[data-gl-add]'); await page.waitForSelector('#ro-paste');
        await page.fill('#ro-paste', 'Registration ID,First Name,Last Name,Bib Num,Event,Wave,City,State,Team Name,Email\n901,Ines,Moreau,2101,10K,B,Lyon,,Club Lyon,ines@example.com\n902,Pat,Kowal,5101,5K,D,Chicago,IL,,pat@example.com\n903,Theo,Cho,1,Half marathon,1,Chicago,IL,,theo.cho@example.com');
        await page.waitForTimeout(300);
        const map = await page.$$eval('[data-ro-col]', xs => xs.map(x => x.value));
        ok(JSON.stringify(map) === JSON.stringify(['', 'first', 'last', 'bib', 'dist', 'wave', 'home', 'state', 'club', 'email']), `${L} import: columns matched by name (${map.join(',')})`);
        ok(/Add 3/.test(await page.textContent('[data-ro-go]')), `${L} import: 3 rows read`);
        await page.click('[data-ro-go]'); await page.waitForTimeout(800);
        ok(/2 runners · 1 already on the list/.test(await page.textContent('#toast')), `${L} import: 2 added, the duplicate skipped (${await page.textContent('#toast')})`);
        await page.fill('[data-ro-q]', 'Ines Moreau'); await page.waitForTimeout(500);
        ok(/Ines Moreau[\s\S]*2101[\s\S]*10K[\s\S]*B[\s\S]*Lyon[\s\S]*Club Lyon/.test(await page.textContent('.ro-t')), `${L} import: Ines with bib, distance, wave, hometown, club`);
        ok(await page.evaluate(() => { const S = window.__orgDemo; const h = S.db.guest_households.find(x => x.name === 'Ines Moreau'); const g = S.db.event_groups.find(x => x.id === h.group_id); return g && g.name === '10K'; }), `${L} import: Ines is in the 10K group (updates by distance)`);
        // volunteers: add a shift
        await tab(page, 'vol'); await page.click('[data-vl-new]'); await page.waitForSelector('#vl-task');
        await page.fill('#vl-task', 'Bike lead'); await page.fill('#vl-cap', '2'); await page.click('[data-vl-save]'); await page.waitForTimeout(500);
        ok(/Bike lead[\s\S]*0\/2/.test(await page.textContent('.vl')), `${L} volunteers: a new shift shows 0/2`);
        // home: the logo leaves the demo; ← Examples
        ok(await page.$eval('.gl-page .brand', a => !/demo=/.test(a.href)), `${L} the logo goes to the real home page`);
        ok(await page.$eval('#org-bar .org-back', a => /#examples$/.test(a.href)), `${L} the demo bar has ← Examples`);
      }
      ok(!(await page.$$eval('.gl-page', xs => xs.some(x => x.scrollWidth > document.documentElement.clientWidth + 1))), `${L} no sideways overflow`);
      ok(net.sb.length === 0, `${L} zero requests to Supabase${net.sb.length ? ' — ' + net.sb.slice(0, 3).join(' | ') : ''}`);
      ok(net.notify === 0, `${L} zero notify calls`);
      ok(await page.evaluate(() => Object.keys(localStorage).filter(x => x.startsWith('ep:')).length === 0), `${L} nothing written to localStorage`);
      ok(!errors.length, `${L} no page errors${errors.length ? ' — ' + errors.slice(0, 2).join(' | ') : ''}`);
      await ctx.close(); }
    // ---------- conference ----------
    { const { ctx, page, net, errors } = await open(w); const L = `conference ${w}:`;
      await page.goto(`${BASE}?demo=conference&view=organizer`); await page.waitForSelector('[data-gl-tab]', { timeout: 30000 }); await page.waitForTimeout(400);
      ok(JSON.stringify(await tabs(page)) === JSON.stringify(['trav', 'list', 'info', 'shut', 'badge', 'upd']), `${L} tabs Travel · Attendees · Agenda · Shuttles · Badges · Updates (${(await labels(page)).join(' · ')})`);
      ok(!(await labels(page)).some(l => WEDDINGY.test(l)), `${L} no wedding tabs`);
      const s = await sum(page); ok(+s.Attendees >= 60 && +s.Speakers >= 10 && +s['Out of town'] > 20 && !('Invites' in s), `${L} conference dashboard (${JSON.stringify(s)})`);
      const tv = await inView(page, '[data-gl-tab]'); ok(tv.every(x => x[1]), `${L} every tab is in sight`);
      const bar = await inView(page, '#org-bar a'); ok(bar.every(x => x[1]), `${L} every demo-bar link is in sight (${bar.map(x => x[0] + (x[1] ? '' : ' ✗')).join(' | ')})`);
      const days = await page.evaluate(() => [...document.querySelectorAll('.ar-day .ar-dh span')].map(x => x.textContent));
      ok(days.filter(d => /\d/.test(d)).length && days.filter(d => /\d/.test(d)).every(d => /November 1[5-9]/.test(d)), `${L} arrivals in November (${days.join(', ')})`);
      ok(await page.evaluate(() => (window.__orgDemo.db.guest_travel || []).every(r => !r.arr_date || r.arr_date >= '2027-01-01') && window.__orgDemo.db.shuttle_runs.every(r => r.depart_date >= '2027-01-01')), `${L} arrivals and shuttles are in 2027, not the past`);
      await tab(page, 'list'); ok((await page.$$eval('.ro-r:not(.ro-h)', xs => xs.length)) >= 60, `${L} attendee roster`);
      ok((await page.$$eval('[data-ro-seg]', xs => xs.map(x => x.textContent))).join(' ').match(/Speaker.*Sponsor/), `${L} type chips (speaker, sponsor…)`);
      await tab(page, 'info'); ok(/Thursday, Nov 18[\s\S]*Opening keynote[\s\S]*Friday, Nov 19/.test(await page.textContent('.ot-grid')), `${L} agenda by day`);
      ok(/Amara Okafor/.test(await page.textContent('.ot-grid')), `${L} speakers from the roster`);
      await tab(page, 'badge'); ok((await page.$$eval('.bd-card', xs => xs.length)) >= 10, `${L} badges preview`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/conference-${w}-badge.png` });
      ok(net.sb.length === 0 && net.notify === 0, `${L} zero Supabase / notify requests`);
      ok(!errors.length, `${L} no page errors${errors.length ? ' — ' + errors.slice(0, 2).join(' | ') : ''}`);
      await ctx.close(); }
    // ---------- wedding: the full set, as add-ons ----------
    { const { ctx, page, errors } = await open(w); const L = `wedding ${w}:`;
      await page.goto(`${BASE}?demo=wedding&view=organizer`); await page.waitForSelector('[data-gl-tab]', { timeout: 30000 }); await page.waitForTimeout(400);
      const ts = await tabs(page); ok(['trav', 'list', 'diet', 'seat', 'inv', 'shut', 'upd'].every(k => ts.includes(k)), `${L} wedding keeps Guests, Dietary, Seating, Invitations, Shuttles (${ts.join(',')})`);
      await tab(page, 'list'); ok((await page.$$eval('.gl-h', xs => xs.length)) >= 25, `${L} households with RSVP trail`);
      const s = await sum(page); ok('Invites' in s && 'Coming' in s && 'No reply' in s, `${L} wedding dashboard unchanged (${Object.keys(s).join(', ')})`);
      const tv = await inView(page, '[data-gl-tab]'); ok(tv.every(x => x[1]), `${L} every tab is in sight`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/wedding-${w}-guests.png` });
      ok(!errors.length, `${L} no page errors${errors.length ? ' — ' + errors.slice(0, 2).join(' | ') : ''}`);
      await ctx.close(); }
    // ---------- guest example: the way back, the 4 tabs ----------
    { const { ctx, page } = await open(w); const L = `guest example ${w}:`;
      for (const k of ['conference', 'race', 'wedding']) {
        await page.goto(`${BASE}?demo=${k}`); await page.waitForSelector('.ev-tabs', { timeout: 30000 }); await page.waitForTimeout(300);
        const t4 = await inView(page, '.ev-tabs [data-tab-go]'); ok(t4.length === 4 && t4.every(x => x[1]), `${L} ${k}: the 4 guest tabs in sight (${t4.map(x => x[0]).join(' · ')})`);
        ok(await page.$eval('.vbar a.vbar-note', a => /#examples$/.test(a.href) && /Examples/.test(a.textContent)).catch(() => false), `${L} ${k}: ← Examples`);
      }
      await ctx.close(); }
    // ---------- travel-only page ----------
    { const { ctx, page } = await open(w); const L = `travel-only ${w}:`;
      await page.goto(BASE + '#examples'); await page.waitForSelector('#for-planners');
      await page.evaluate(() => { const c = JSON.parse(JSON.stringify(window.EXAMPLES['tulum-wedding'])); c.travelOnly = true; c.site = 'https://example.com/maya-and-theo'; location.hash = '#e=' + LZString.compressToEncodedURIComponent(JSON.stringify(c)); });
      await page.waitForSelector('.to-card', { timeout: 30000 }); await page.waitForTimeout(300);
      ok(await page.$eval('.to-card a.to-site', a => a.href === 'https://example.com/maya-and-theo' && a.target === '_blank'), `${L} the event's own website up top`);
      ok(!(await page.$('[data-panel="event"] #sec-about, [data-panel="event"] #sec-schedule, [data-panel="event"] .rsvp, [data-panel="event"] #sec-details')), `${L} no About / schedule / RSVP / details`);
      ok((await page.$$eval('.to-go [data-tab-go]', xs => xs.length)) >= 2 && (await inView(page, '.ev-tabs [data-tab-go]')).length === 4, `${L} travel buttons + the 4 tabs`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/travel-only-${w}.png` });
      await ctx.close(); }
  }
  // the import matcher on its own: other exporters' column names
  { const { ctx, page } = await open(1280); await page.goto(BASE + '#examples'); await page.waitForSelector('#for-planners');
    const g = await page.evaluate(() => { const X = window.__ep.ot; return [X.roGuess(['Participant First Name', 'Participant Last Name', 'Event', 'Bib Number', 'Email', 'City', 'Province/State', 'Team'], X.OT_RACE),
      X.roGuess(['First Name', 'Last Name', 'Email', 'Ticket Type', 'Company', 'City'], X.OT_CONF), X.roGuess(['Name', 'Email', 'City'], X.OT_GUEST)]; });
    ok(g[0].join() === 'first,last,dist,bib,email,home,state,club', `import: Race Roster columns (${g[0].join()})`);
    ok(g[1].join() === 'first,last,email,kind,company,home', `import: Eventbrite-style attendee columns (${g[1].join()})`);
    ok(g[2].join() === 'name,email,home', `import: a plain guest list (${g[2].join()})`);
    // a runner's personal link: their race details, shuttle and travel; no replies
    const h = await page.evaluate(() => { const X = window.__ep.ot; const cfg = { type: 'Race' }; const H = { name: 'Maya Patel', people: [{ id: 'p1', name: 'Maya Patel' }], travel: { arr_date: '2027-05-15', arr_place: 'ORD' },
      fields: [{ label: 'Bib', values: [{ person_id: 'p1', value: '1042' }] }, { label: 'Wave', values: [{ person_id: 'p1', value: 'B' }] }, { label: 'Start time', values: [{ person_id: 'p1', value: '07:25' }] }], shuttles: [] };
      return [X.otGuestNoRsvp(cfg), X.otGuestNoRsvp({ type: 'Race', org: { mods: { rsvp: true } } }), X.otGuestNoRsvp({ type: 'Wedding' }), X.otYour(cfg), X.hhInfoHTML(cfg, H)]; });
    ok(h[0] === true && h[1] === false && h[2] === false && h[3] === 'Your race', 'personal link: race/conference pages skip RSVP unless Guest list & RSVP is on; the section is “Your race”');
    ok(/1042/.test(h[4]) && /07:25/.test(h[4]) && /data-hh="travel"/.test(h[4]) && !/data-hh="send"|Replying for/.test(h[4]), 'personal link: bib, wave, start time and a travel form, no reply buttons');
    await ctx.close(); }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
