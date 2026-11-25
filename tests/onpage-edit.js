// Tap-to-edit on the owner's page (no Edit/Preview modes): the organizer opens their page (My pages → Open, the builder
// routes, or their own short link) and sees the page as guests do; every part they can edit is ONE tap target (the row,
// the cover, the ticket, a section heading — light hover/press tint, a small pencil mark on blocks, never a second
// button) that opens that part's existing sheet. Edits show live and save; deletes ask first and can be undone; + buttons
// add items; "+ Add section" opens the gallery; sections move/hide from their sheet. "Preview as guest" removes every
// affordance. Settings (one header button) holds the page-wide settings — every accordion and card of the old Edit tab —
// so nothing the old edit mode exposed is unreachable. Guests' pages are unchanged (byte-identical to OLD_BASE when set)
// and carry no affordances; non-organizers on a short link get "Edit a copy". No overflow at 320/390; desktop side sheet.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/onpage-edit.js
//   OLD_BASE=http://127.0.0.1:18766/ node tests/onpage-edit.js   # guest page identical to a previous build
//   SHOTS=/tmp/ep-shots node tests/onpage-edit.js
//
// Needs Playwright. Exit code 1 on any failure.
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const OLD_BASE = process.env.OLD_BASE || '';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => {
  const cw = document.documentElement.clientWidth;
  return [...document.querySelectorAll('body *')].filter(e => {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return false;
    if (e.closest('.b-set') && getComputedStyle(e.closest('.b-set')).display === 'none') return false;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false;
    const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1;
  }).slice(0, 5).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.'));
});
const draft = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
const sheetRows = (page) => page.$$eval('#sheet .sheet-b .rowed', es => es.length);
const settle = (page) => page.waitForTimeout(700); // preview re-render is debounced 350ms
const AFF = '#preview [data-ed], #preview .onp, #preview .onp-mk, #preview .onp-add';

(async () => {
  const browser = await chromium.launch();
  const ctxFor = (w) => browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: w < 900, hasTouch: w < 900, serviceWorkers: 'block' });
  const errs = [];
  const open = async (ctx, ex) => {
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES); await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '#edit-ex=' + ex); await page.waitForSelector('#preview .ev.onp'); await settle(page); return page;
  };
  const tap = async (page, ed) => { await page.click(`#preview [data-ed="${ed}"]`); await page.waitForSelector('#sheet[open]'); await page.waitForTimeout(150); };
  const done = async (page) => { await page.click('#sheet .btn.primary.big'); await page.waitForFunction(() => !document.querySelector('#sheet[open]')); await settle(page); };
  const more = async (page) => { await page.click('#sheet [data-sh-more]'); await page.waitForSelector('#sheet .sh-menu:not([hidden])'); }; // move / remove / hide live in the sheet's … menu
  const openDay = (page, d) => page.evaluate((d) => { const b = document.querySelector(`#preview [data-day-tog="${d}"]`); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); }, d);

  // ---------- guest pages: untouched, no affordances ----------
  {
    const ctx = await ctxFor(390); const page = await ctx.newPage();
    await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES);
    for (const ex of ['tulum-wedding', 'japan-trip', 'chicago-10k']) {
      const body = async (b) => { await page.goto(b + '#ex=' + ex); await page.waitForSelector('.ev-body'); await page.waitForTimeout(500); return page.$eval('.ev-panel[data-panel="event"]', e => e.innerHTML.replace(/<div data-slot="weather">[\s\S]*?<\/section>/, '').split(encodeURIComponent(location.origin)).join('').split(location.origin).join('')); };
      const now = await body(BASE);
      ok(!/data-ed=|onp-|role="button"/.test(now), `${ex} guest page: no edit affordances`);
      if (OLD_BASE) ok(now === await body(OLD_BASE), `${ex} guest page: Event tab identical to the previous build`);
    }
    await ctx.close();
  }

  // ---------- owner, wedding at 390 ----------
  let ctx = await ctxFor(390); let page = await open(ctx, 'tulum-wedding');
  ok(!(await page.$('.seg, [data-tab="edit"], [data-onp-tg]')) && !(await page.isVisible('.b-form')) && await page.isVisible('#preview .ev-hero'), 'owner lands on the page itself: no Edit/Preview tabs, no Tap-to-edit switch, form not shown');
  const eds = await page.$$eval('#preview [data-ed]', es => [...new Set(es.map(e => e.dataset.ed))]);
  ok(['hero', 'when', 'sec:about', 'sec:details', 'sec:schedule', 'gallery', 'add:n', 'add:s'].every(x => eds.includes(x)) && eds.some(x => /^s:\d/.test(x)) && eds.some(x => /^n:\d/.test(x)) && eds.some(x => /^x:/.test(x)) && eds.some(x => /^sec:c-/.test(x)), `wedding: edit targets ${eds.join(' ')}`);
  ok(!(await page.$('#preview .onp-pen')) && await page.$$eval('#preview .onp-mk', es => es.every(e => e.getAttribute('aria-hidden') === 'true' && e.tagName === 'I')), 'pencil is a mark inside the target, not a second button');
  ok(await page.$$eval('#preview .sec-h .onp-mk', es => es.length) >= 4 && !!(await page.$('#preview .ev-hero > .onp-mk')) && !!(await page.$('#preview .stub-main > .onp-mk')), 'marks on cover, ticket and section headings');
  ok(await page.$$eval('#preview [data-ed]', es => es.every(e => { const ed = e.dataset.ed; return ![...e.querySelectorAll('[data-ed]')].some(c => c.dataset.ed === ed); })), 'one control per action: no nested target for the same edit');
  ok(await page.$$eval('#preview [data-ed]:not(.onp-add)', es => es.every(e => e.tabIndex >= 0)), 'every target reachable by keyboard');
  ok(await page.$eval('#preview .ev-panel[data-panel="event"] .sched-days', e => e.classList.contains('dlist')), 'itinerary in the guest layout (day list), not a separate editing layout');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onp-wedding-390.png` });

  // About: only the About fields; live preview + saved
  await tap(page, 'sec:about');
  ok(await page.textContent('#sheet h2') === 'About×' && !!(await page.$('#sheet #f-desc')) && !(await page.$('#sheet [data-s]')), 'About section → About sheet only');
  await page.fill('#sheet #f-desc', 'Sunset vows on the beach.');
  await page.waitForTimeout(800);
  ok(/Sunset vows on the beach/.test(await page.textContent('#preview #sec-about')), 'About edit shows on the page live (sheet still open)');
  ok((await draft(page)).description === 'Sunset vows on the beach.', 'About edit autosaved');
  ok(/Saved/.test(await page.textContent('[data-save]')), 'top bar says Saved');
  ok(await page.$$eval('#sheet [data-sec-mv="about"]', es => es.length) === 2 && !!(await page.$('#sheet [data-onp-hide="about"]')), 'About sheet: move up/down and Hide section');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onp-about-sheet-390.png` });
  ok((await overflow(page)).length === 0, 'About sheet @390: no overflow');
  await done(page);

  // a day toggle inside the schedule section still opens/closes the day (a section is only a target where nothing else is)
  const togs = await page.$$eval('#preview [data-day-tog]', es => es.map(e => [e.dataset.dayTog, e.getAttribute('aria-expanded')]));
  if (togs.length) {
    const [d0, ex0] = togs.find(x => x[1] === 'false') || togs[0];
    await page.click(`#preview [data-day-tog="${d0}"]`); await page.waitForTimeout(200);
    ok(!(await page.$('#sheet[open]')) && await page.getAttribute(`#preview [data-day-tog="${d0}"]`, 'aria-expanded') !== ex0, 'day toggle toggles the day, no sheet');
  }
  // one schedule item: just that item; edit; delete asks, then Undo brings it back
  let c0 = await draft(page); const si = c0.schedule.findIndex(x => x.title);
  await openDay(page, c0.schedule[si].date); await page.waitForTimeout(100);
  const t0 = c0.schedule[si].title; const nItems = await page.$$eval('#preview #sec-schedule li[data-ed]', es => es.length);
  await tap(page, 's:' + si);
  ok(await sheetRows(page) === 1 && await page.$eval(`#sheet [data-s="${si}"][data-k="title"]`, e => e.value) === t0, `item tap → one row (“${t0}”)`);
  ok(!!(await page.$('#sheet [data-onp-all]')) && !(await page.$('#sheet [data-b="add-sched"]')), 'item sheet: Show all, no Add');
  await page.fill(`#sheet [data-s="${si}"][data-k="title"]`, 'Welcome drinks');
  await page.waitForTimeout(800);
  ok(/Welcome drinks/.test(await page.textContent('#preview #sec-schedule')), 'item edit shows on the page live');
  await more(page); await page.click(`#sheet [data-sdel="${si}"]`); await page.waitForSelector('#confirmdlg[open]');
  ok(/Delete “Welcome drinks”\?/.test(await page.textContent('#confirmdlg h2')), 'delete asks first (in-app dialog)');
  await page.click('#confirmdlg button[value="ok"]'); await page.waitForFunction(() => !document.querySelector('#sheet[open]')); await settle(page);
  ok(!/Welcome drinks/.test(await page.textContent('#preview #sec-schedule')), 'deleted: gone from the page, sheet closed');
  ok(await page.isVisible('#undo button'), 'Undo shows');
  await page.click('#undo button'); await settle(page);
  ok(/Welcome drinks/.test(await page.textContent('#preview #sec-schedule')), 'Undo puts it back');
  ok((await draft(page)).schedule.some(x => x.title === 'Welcome drinks'), 'Undo saved');

  // Show all: the whole schedule
  await openDay(page, (await draft(page)).schedule[si].date); await page.waitForTimeout(100);
  await tap(page, 's:' + si); await page.click('#sheet [data-onp-all]'); await page.waitForTimeout(200);
  ok(await sheetRows(page) === (await draft(page)).schedule.length && !!(await page.$('#sheet [data-b="add-sched"]')), 'Show all → every item + Add item');
  await done(page);

  // + Add note → a new note's sheet; a blank one is dropped on close
  const nNotes = (await draft(page)).notes.length;
  await tap(page, 'add:n'); await page.waitForTimeout(400); ok(await sheetRows(page) === 1 && (await draft(page)).notes.length === nNotes + 1, '+ Add note → one new note');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.matches('#sheet [data-n][data-k="label"]')), 'new note: title field focused');
  await done(page); ok((await draft(page)).notes.length === nNotes, 'blank new note dropped on close');
  await tap(page, 'add:n'); const ni = nNotes;
  await page.fill(`#sheet [data-n="${ni}"][data-k="label"]`, 'Sunscreen'); await page.fill(`#sheet [data-n="${ni}"][data-k="text"]`, 'Reef-safe only');
  await done(page);
  ok(/Sunscreen/.test(await page.textContent('#preview #sec-details')) && (await draft(page)).notes.length === nNotes + 1, 'new note on the page and saved');
  await tap(page, 'n:' + ni);
  ok(await sheetRows(page) === 1 && await page.textContent('#sheet h2') === 'Sunscreen×', 'note tap → that note');
  if (ni > 0) { await more(page); await page.click(`#sheet [data-onp-mv="${ni}"][data-dir="-1"]`); await page.waitForTimeout(500); ok((await draft(page)).notes[ni - 1].label === 'Sunscreen' && await sheetRows(page) === 1, 'note moved up, still focused'); }
  await done(page);

  // type-specific row → its card
  const xs = await page.$$eval('#preview [data-ed^="x:"]', es => es.map(e => e.dataset.ed));
  if (xs.includes('x:dress')) { await tap(page, 'x:dress'); ok(await page.textContent('#sheet h2') === 'Dress code×', 'dress code row → Dress code card'); await done(page); }

  // hero and date/place (keyboard too)
  await tap(page, 'hero');
  ok(await page.textContent('#sheet h2') === 'Title and photo×' && !!(await page.$('#sheet #sh-title')) && !!(await page.$('#sheet #f-cover')), 'hero → title, tagline, cover');
  await page.fill('#sheet #sh-title', 'Ana & Leo in Tulum'); await page.waitForTimeout(800);
  ok(await page.textContent('#preview .ev-title') === 'Ana & Leo in Tulum', 'title edit live');
  await done(page);
  await page.focus('#preview [data-ed="when"]'); await page.keyboard.press('Enter'); await page.waitForSelector('#sheet[open]');
  ok(await page.textContent('#sheet h2') === 'Date and place×' && !!(await page.$('#sheet [data-when="sd"]')) && !!(await page.$('#sheet #sh-vname')), 'ticket (Enter key) → dates + venue');
  await done(page);

  // custom section: just it; move; hide + Undo
  const csId = eds.find(x => /^sec:c-/.test(x)).slice(4);
  await page.click(`#preview #sec-${csId} .sec-h`); await page.waitForSelector('#sheet[open]'); await page.waitForTimeout(150);
  ok(await page.$$eval('#sheet .cs-row', es => es.length) === 1 && !(await page.$('#sheet [data-b="add-custom"]')), 'custom section heading → just that section');
  const ord0 = await page.$$eval('#preview .ev-panel[data-panel="event"] [data-sec]', es => es.map(e => e.dataset.sec));
  if (ord0.indexOf(csId) > 0) {
    await more(page); await page.click(`#sheet [data-sec-mv="${csId}"][data-dir="-1"]`); await settle(page);
    const ord1 = await page.$$eval('#preview .ev-panel[data-panel="event"] [data-sec]', es => es.map(e => e.dataset.sec));
    ok(ord1.indexOf(csId) === ord0.indexOf(csId) - 1, `section moved up on the page: ${ord1.join()}`);
  }
  await more(page); await page.click(`#sheet [data-onp-hide="${csId}"]`); await page.waitForFunction(() => !document.querySelector('#sheet[open]')); await settle(page);
  ok(!(await page.$(`#preview #sec-${csId}`)) && (await draft(page)).off[csId] === true, 'Hide section: gone from the page');
  await page.click('#undo button'); await settle(page);
  ok(!!(await page.$(`#preview #sec-${csId}`)), 'Undo: section back');

  // + Add section → gallery → a card
  await tap(page, 'gallery');
  ok(await page.textContent('#sheet h2') === 'Add to your page×' && await page.$$eval('#sheet [data-card]', es => es.length) >= 6, 'Add section → the gallery');
  const galleryCards = await page.$$eval('#sheet [data-card]', es => es.map(e => e.dataset.card).sort());
  await page.click('#sheet [data-card="bring"]'); await page.waitForTimeout(200);
  ok(!!(await page.$('#sheet #f-bring')), 'gallery card opens its sheet');
  await done(page);

  // Preview as guest: every affordance gone, taps do what they do for guests; back on
  await page.click('.onp-tg'); await settle(page);
  ok(!(await page.$(AFF)), 'Preview as guest: no edit targets, marks or + buttons');
  await page.click('#preview #sec-about'); await page.waitForTimeout(300); ok(!(await page.$('#sheet[open]')), 'Preview as guest: tapping does nothing');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onp-guest-preview-390.png` });
  await page.click('.onp-tg'); await settle(page); ok(!!(await page.$('#preview .ev.onp [data-ed="hero"]')), 'Preview as guest off: tap to edit back');

  // Settings: every accordion and card of the old Edit tab, editing the same page
  await page.click('.b-top [data-act="settings"]'); await page.waitForTimeout(200);
  ok(await page.isVisible('.b-form') && await page.getAttribute('.b-top [data-act="settings"]', 'aria-expanded') === 'true', 'Settings opens the page settings panel');
  const accs = await page.$$eval('.b-form details[data-acc]', es => es.map(e => e.dataset.acc));
  ok(['basics', 'when', 'design', 'sections'].every(a => accs.includes(a)) && !!(await page.$('.b-form [data-doc-pick]')), `Settings: ${accs.join(', ')} + Upload a document`);
  const formCards = await page.$$eval('.b-form [data-card]', es => es.map(e => e.dataset.card).sort());
  ok(formCards.every(c => galleryCards.includes(c)), `every card of the old Edit tab is also on the page's + Add section (${formCards.join(' ')})`);
  ok((await overflow(page)).length === 0, `Settings @390: no overflow ${(await overflow(page)).join()}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onp-settings-390.png` });
  await page.click('details[data-acc="basics"] summary').catch(() => {});
  await page.fill('#f-title', 'From settings'); await page.click('.b-set-h [data-act="settings"]'); await settle(page);
  ok(!(await page.isVisible('.b-form')) && await page.textContent('#preview .ev-title') === 'From settings', 'Settings → Done: back on the page, edit shown');
  await page.close(); await ctx.close();

  // ---------- trip at 320: guest layout, items per day, per-day add, stops via city headings, own bookings ----------
  ctx = await ctxFor(320);
  { const p0 = await ctx.newPage(); await p0.goto(BASE); await p0.waitForFunction(() => window.__ep && window.EXAMPLES);
    const k = await p0.evaluate(() => { const c = window.__ep.normalize(JSON.parse(JSON.stringify(window.EXAMPLES['japan-trip']))); delete c.demoTrip; return window.__ep.itinKeyOf(c); });
    await p0.close(); page = await open(ctx, 'japan-trip');
    const c = await draft(page);
    await page.evaluate(([k, d]) => localStorage.setItem('ep:' + k, JSON.stringify([{ id: 'bk-own-1', kind: 'hotel', name: 'Hotel Gracery Shinjuku', start: d + 'T15:00', end: d + 'T11:00' }])), [await page.evaluate(() => window.__ep.itinKeyOf(JSON.parse(localStorage.getItem('ep:draft')))), c.start.slice(0, 10)]);
    void k;
  }
  await page.evaluate(() => { localStorage.setItem('ep:draft', localStorage.getItem('ep:draft')); }); await page.reload(); await page.waitForSelector('#preview .ev.onp'); await settle(page);
  ok((await overflow(page)).length === 0, `trip @320: no overflow ${(await overflow(page)).join()}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onp-trip-320.png` });
  const c1 = await draft(page);
  const ti = c1.schedule.findIndex(x => x.title && x.date); const day = c1.schedule[ti].date;
  await openDay(page, day); await page.waitForTimeout(150);
  await tap(page, 's:' + ti);
  ok(await sheetRows(page) === 1 && await page.$eval('#sheet #tp-date', e => e.value) === day, 'trip item → one item with its day');
  const nextDay = await page.evaluate((d) => { const x = new Date(d + 'T00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }, day);
  await page.fill('#sheet #tp-date', nextDay); await done(page);
  ok((await draft(page)).schedule[ti].date === nextDay, 'moved the item to the next day');
  const nBefore = (await draft(page)).schedule.length;
  await openDay(page, nextDay); await page.waitForTimeout(150);
  ok(await page.isVisible(`#preview [data-ed="add:s:${nextDay}"]`), '+ Add to this day inside an open day');
  await tap(page, 'add:s:' + nextDay); await page.fill('#sheet [data-k="title"]', 'Ramen at Ichiran'); await done(page);
  const c2 = await draft(page); ok(c2.schedule.length === nBefore + 1 && c2.schedule.some(x => x.title === 'Ramen at Ichiran' && x.date === nextDay), '+ Add to this day');
  ok(/Ramen at Ichiran/.test(await page.textContent('#preview #sec-schedule')), 'new plan on the page');
  const st = await page.$eval('#preview .city-h[data-ed^="st:"]', e => e.dataset.ed);
  await tap(page, st);
  ok(await page.$$eval('#sheet .st-row', es => es.length) === 1 && !!(await page.$('#sheet .es-stop')) && !(await page.$('#sheet [data-st-add]')), 'city heading → just that stop');
  await done(page);
  ok(await page.isVisible('#preview [data-ed="add:st"]'), '+ Add a stop');
  // the owner's own bookings (My trip) keep their own sheets and Edit form
  await page.click('#preview [data-tab-go="mytrip"]'); await page.waitForTimeout(400);
  const bk = await page.$('#preview #sec-itinerary [data-ds="bk:bk-own-1"]');
  ok(!!bk, 'My trip: own booking listed on the owner page');
  if (bk) {
    await bk.click(); await page.waitForTimeout(300);
    ok(!!(await page.$('dialog.ds-sheet[open]')) && !(await page.$('#sheet[open]')), 'booking row → its booking sheet');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.click('#preview #sec-itinerary [data-itin-edit="0"]'); await page.waitForTimeout(300);
    ok(!!(await page.$('#preview #sec-itinerary [data-slot="itin-form"] input')), 'booking Edit → the booking form');
  }
  ok((await overflow(page)).length === 0, 'trip @320 after edits: no overflow');
  await page.close(); await ctx.close();

  // ---------- desktop: side sheet next to the live page; Settings as a column ----------
  ctx = await ctxFor(1280); page = await open(ctx, 'tulum-wedding');
  ok(await page.evaluate(() => document.querySelector('.b-preview').getBoundingClientRect().left) < 2, 'desktop: page full width until Settings');
  await tap(page, 'sec:about');
  const geo = await page.evaluate(() => { const s = document.querySelector('#sheet').getBoundingClientRect(), f = document.querySelector('.b-frame').getBoundingClientRect(); return { modal: document.querySelector('#sheet').matches(':modal'), sl: s.left, sr: s.right, fl: f.left, fr: f.right, vw: innerWidth }; });
  ok(!geo.modal && geo.sl === 0 && geo.sr < geo.vw / 2, `desktop: docked side sheet, page visible ${JSON.stringify(geo)}`);
  await page.click('#preview [data-ed="hero"]', { position: { x: 600, y: 60 } }); await page.waitForTimeout(200);
  ok(await page.textContent('#sheet h2') === 'Title and photo×', 'desktop: tapping another part switches the sheet');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onp-desktop.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200); ok(!(await page.$('#sheet[open]')), 'Escape closes the side sheet');
  await page.click('.b-top [data-act="settings"]'); await page.waitForTimeout(200);
  const g2 = await page.evaluate(() => ({ f: document.querySelector('.b-set').getBoundingClientRect().right, p: document.querySelector('.b-preview').getBoundingClientRect().left }));
  ok(g2.f > 300 && g2.p >= g2.f - 1, `desktop Settings: a column beside the page ${JSON.stringify(g2)}`);
  await page.close(); await ctx.close();

  // ---------- short link: the organizer gets their page with tap-to-edit right there; others the guest page ----------
  ctx = await ctxFor(390); page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES);
  const cfg = await page.evaluate(() => window.EXAMPLES['tulum-wedding']);
  const row = { id: '11111111-2222-3333-4444-555555555555', slug: 'ana-leo-test', config: cfg, updated_at: '2026-11-12T00:00:00Z' };
  await page.route(/\/rest\/v1\/events\?/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) }));
  await page.route(/\/rest\/v1\/(announcements|groups|messages)/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '?e=ana-leo-test'); await page.waitForSelector('.ev-body');
  ok(await page.textContent('.vbar a.btn') === 'Edit a copy' && !(await page.$('[data-ed], .onp, .onp-mk, .b-top')), 'short link, not the organizer: guest page, Edit a copy, no affordances');
  await page.evaluate((r) => localStorage.setItem('ep:pages', JSON.stringify([{ pid: 'p-test', cfg: r.config, hosted: { id: r.id, slug: r.slug }, url: '', updated: Date.now(), edited: 1 }])), row);
  await page.goto(BASE + '?e=ana-leo-test#'); await page.reload(); await page.waitForSelector('#preview .ev.onp'); await settle(page);
  ok(/\?e=ana-leo-test/.test(page.url()) && !(await page.$('.vbar-edit')) && await page.isVisible('#preview [data-ed="sec:about"]'), 'organizer on their short link: the page with tap to edit, no Edit page step');
  await tap(page, 'hero'); ok(await page.textContent('#sheet h2') === 'Title and photo×', 'organizer short link: tap → editor'); await done(page);
  await page.click('.onp-tg'); await settle(page);
  ok(!(await page.$(AFF)), 'organizer short link: Preview as guest hides every affordance');
  ok(await page.getAttribute('.b-top a.brand', 'href') !== '#', 'brand link leaves the ?e= page');
  await page.close(); await ctx.close();

  // ---------- My pages: one Open per page (no View / Edit pair) ----------
  ctx = await ctxFor(390); page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES);
  await page.evaluate((c) => { localStorage.clear(); localStorage.setItem('ep:pages', JSON.stringify([{ pid: 'p-mine', cfg: c, hosted: null, url: '', updated: Date.now() }])); }, cfg);
  await page.reload(); await page.waitForSelector('#my-pages');
  const btns = await page.$$eval('#my-pages .mp-b > *', es => es.map(e => e.textContent.trim()));
  ok(btns.includes('Open') && !btns.includes('View') && !btns.includes('Edit'), `My pages: ${btns.join(' / ')}`);
  await page.click('#my-pages a:text("Open")'); await page.waitForSelector('#preview .ev.onp');
  ok(await page.isVisible('#preview [data-ed="hero"]'), 'Open → the page with tap to edit');
  await page.close(); await ctx.close();

  ok(!errs.length, `no page errors ${errs.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
