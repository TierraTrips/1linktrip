// On-page editing: in the builder preview the host taps a part of the page (title, dates, a section, one itinerary item,
// a note, a route stop, a custom section) and a sheet opens with only that part's fields; edits show on the page live and
// save; deletes ask first (in-app dialog) and can be undone; + buttons add items; "+ Add section" opens the gallery;
// sections move up/down or hide from their sheet. The guest page is unchanged (byte-identical to the previous build with
// OLD_BASE), and the preview with "Tap to edit" off has no edit marks. The organizer's own short-link page offers
// "Edit page" (opens the builder on the page); others still get "Edit a copy". No overflow at 320/390; desktop side sheet.
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
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false;
    const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1;
  }).slice(0, 5).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.'));
});
const draft = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
const sheetRows = (page) => page.$$eval('#sheet .sheet-b .rowed', es => es.length);
const settle = (page) => page.waitForTimeout(700); // preview re-render is debounced 350ms

(async () => {
  const browser = await chromium.launch();
  const ctxFor = (w) => browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: w < 900, hasTouch: w < 900, serviceWorkers: 'block' });
  const errs = [];
  const open = async (ctx, ex) => {
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES); await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '#edit-ex=' + ex); await page.waitForSelector('.b-form');
    if ((page.viewportSize() || {}).width < 980) await page.click('.seg [data-tab="preview"]');
    await page.waitForSelector('#preview .ev.onp'); await settle(page); return page;
  };
  const tap = async (page, ed) => { await page.click(`#preview [data-ed="${ed}"]`); await page.waitForSelector('#sheet[open]'); await page.waitForTimeout(150); };
  const done = async (page) => { await page.click('#sheet .btn.primary.big'); await page.waitForFunction(() => !document.querySelector('#sheet[open]')); await settle(page); };

  // ---------- guest page untouched ----------
  {
    const ctx = await ctxFor(390); const page = await ctx.newPage();
    await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES);
    for (const ex of ['tulum-wedding', 'japan-trip', 'chicago-10k']) {
      const body = async (b) => { await page.goto(b + '#ex=' + ex); await page.waitForSelector('.ev-body'); await page.waitForTimeout(500); return page.$eval('.ev-panel[data-panel="event"]', e => e.innerHTML.replace(/<div data-slot="weather">[\s\S]*?<\/section>/, '').split(encodeURIComponent(location.origin)).join('').split(location.origin).join('')); };
      const now = await body(BASE);
      ok(!/data-ed=|onp-/.test(now), `${ex} guest page: no edit marks`);
      if (OLD_BASE) ok(now === await body(OLD_BASE), `${ex} guest page: Event tab identical to the previous build`);
    }
    await ctx.close();
  }

  // ---------- wedding at 390 ----------
  let ctx = await ctxFor(390); let page = await open(ctx, 'tulum-wedding');
  const eds = await page.$$eval('#preview [data-ed]', es => [...new Set(es.map(e => e.dataset.ed))]);
  ok(['hero', 'when', 'sec:about', 'sec:details', 'sec:schedule', 'gallery', 'add:n', 'add:s'].every(x => eds.includes(x)) && eds.some(x => /^s:\d/.test(x)) && eds.some(x => /^n:\d/.test(x)) && eds.some(x => /^x:/.test(x)) && eds.some(x => /^sec:c-/.test(x)), `wedding: edit targets ${eds.join(' ')}`);
  ok(await page.$$eval('#preview .onp-sec .sec-h .onp-pen', es => es.length) >= 4, 'pencils on section headers');
  ok(await page.$eval('#preview .onp-pen', e => { const r = e.getBoundingClientRect(); return r.width >= 40 && r.height >= 40; }), 'pencil tap target ≥ 40px');
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

  // one schedule item: just that item; edit; delete asks, then Undo brings it back
  let c0 = await draft(page); const si = c0.schedule.findIndex(x => x.title);
  const t0 = c0.schedule[si].title; const nItems = await page.$$eval('#preview #sec-schedule li[data-ed]', es => es.length);
  await tap(page, 's:' + si);
  ok(await sheetRows(page) === 1 && await page.$eval(`#sheet [data-s="${si}"][data-k="title"]`, e => e.value) === t0, `item tap → one row (“${t0}”)`);
  ok(!!(await page.$('#sheet [data-onp-all]')) && !(await page.$('#sheet [data-b="add-sched"]')), 'item sheet: Show all, no Add');
  await page.fill(`#sheet [data-s="${si}"][data-k="title"]`, 'Welcome drinks');
  await page.waitForTimeout(800);
  ok(/Welcome drinks/.test(await page.textContent('#preview #sec-schedule')), 'item edit shows on the page live');
  await page.click(`#sheet [data-sdel="${si}"]`); await page.waitForSelector('#confirmdlg[open]');
  ok(/Delete “Welcome drinks”\?/.test(await page.textContent('#confirmdlg h2')), 'delete asks first (in-app dialog)');
  await page.click('#confirmdlg button[value="ok"]'); await page.waitForFunction(() => !document.querySelector('#sheet[open]')); await settle(page);
  ok(await page.$$eval('#preview #sec-schedule li[data-ed]', es => es.length) === nItems - 1 && !/Welcome drinks/.test(await page.textContent('#preview #sec-schedule')), 'deleted: gone from the page, sheet closed');
  ok(await page.isVisible('#undo button'), 'Undo shows');
  await page.click('#undo button'); await settle(page);
  ok(await page.$$eval('#preview #sec-schedule li[data-ed]', es => es.length) === nItems && /Welcome drinks/.test(await page.textContent('#preview #sec-schedule')), 'Undo puts it back');
  ok((await draft(page)).schedule.some(x => x.title === 'Welcome drinks'), 'Undo saved');

  // Show all: the whole schedule
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
  // note: tap → just it, move up
  await tap(page, 'n:' + ni);
  ok(await sheetRows(page) === 1 && await page.textContent('#sheet h2') === 'Sunscreen×', 'note tap → that note');
  if (ni > 0) { await page.click(`#sheet [data-onp-mv="${ni}"][data-dir="-1"]`); await page.waitForTimeout(500); ok((await draft(page)).notes[ni - 1].label === 'Sunscreen' && await sheetRows(page) === 1, 'note moved up, still focused'); }
  await done(page);

  // type-specific row → its card
  const xs = await page.$$eval('#preview [data-ed^="x:"]', es => es.map(e => e.dataset.ed));
  if (xs.includes('x:dress')) { await tap(page, 'x:dress'); ok(await page.textContent('#sheet h2') === 'Dress code×', 'dress code row → Dress code card'); await done(page); }

  // hero and date/place
  await tap(page, 'hero');
  ok(await page.textContent('#sheet h2') === 'Title and photo×' && !!(await page.$('#sheet #sh-title')) && !!(await page.$('#sheet #f-cover')), 'hero → title, tagline, cover');
  await page.fill('#sheet #sh-title', 'Ana & Leo in Tulum'); await page.waitForTimeout(800);
  ok(await page.textContent('#preview .ev-title') === 'Ana & Leo in Tulum', 'title edit live');
  await done(page);
  await tap(page, 'when');
  ok(await page.textContent('#sheet h2') === 'Date and place×' && !!(await page.$('#sheet [data-when="sd"]')) && !!(await page.$('#sheet #sh-vname')), 'date/place card → dates + venue');
  await done(page);

  // custom section: just it; move; hide + Undo
  const csId = eds.find(x => /^sec:c-/.test(x)).slice(4);
  await tap(page, 'sec:' + csId);
  ok(await page.$$eval('#sheet .cs-row', es => es.length) === 1 && !(await page.$('#sheet [data-b="add-custom"]')), 'custom section → just that section');
  const ord0 = await page.$$eval('#preview .ev-panel[data-panel="event"] [data-sec]', es => es.map(e => e.dataset.sec));
  if (ord0.indexOf(csId) > 0) {
    await page.click(`#sheet [data-sec-mv="${csId}"][data-dir="-1"]`); await settle(page);
    const ord1 = await page.$$eval('#preview .ev-panel[data-panel="event"] [data-sec]', es => es.map(e => e.dataset.sec));
    ok(ord1.indexOf(csId) === ord0.indexOf(csId) - 1, `section moved up on the page: ${ord1.join()}`);
  }
  await page.click(`#sheet [data-onp-hide="${csId}"]`); await page.waitForFunction(() => !document.querySelector('#sheet[open]')); await settle(page);
  ok(!(await page.$(`#preview #sec-${csId}`)) && (await draft(page)).off[csId] === true, 'Hide section: gone from the page');
  await page.click('#undo button'); await settle(page);
  ok(!!(await page.$(`#preview #sec-${csId}`)), 'Undo: section back');

  // + Add section → gallery → a card
  await tap(page, 'gallery');
  ok(await page.textContent('#sheet h2') === 'Add to your page×' && await page.$$eval('#sheet [data-card]', es => es.length) >= 6, 'Add section → the gallery');
  await page.click('#sheet [data-card="bring"]'); await page.waitForTimeout(200);
  ok(!!(await page.$('#sheet #f-bring')), 'gallery card opens its sheet');
  await done(page);

  // Tap to edit off: preview is the plain page
  await page.click('.onp-tg'); await settle(page);
  ok(!(await page.$('#preview [data-ed], #preview .onp')), 'Tap to edit off: no edit marks');
  await page.click('#preview #sec-about'); await page.waitForTimeout(300); ok(!(await page.$('#sheet[open]')), 'Tap to edit off: tapping does nothing');
  await page.click('.onp-tg'); await settle(page); ok(!!(await page.$('#preview .ev.onp')), 'Tap to edit back on');
  // the builder form still edits the same page
  await page.click('.seg [data-tab="edit"]'); await page.click('details[data-acc="basics"] summary').catch(() => {});
  await page.fill('#f-title', 'From the form'); await page.click('.seg [data-tab="preview"]'); await settle(page);
  ok(await page.textContent('#preview .ev-title') === 'From the form', 'builder form edits still show in the preview');
  await page.close(); await ctx.close();

  // ---------- trip at 320 ----------
  ctx = await ctxFor(320); page = await open(ctx, 'japan-trip');
  ok((await overflow(page)).length === 0, `trip preview @320: no overflow ${(await overflow(page)).join()}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onp-trip-320.png` });
  const day = await page.$eval('#preview [data-ed^="day:"]', e => e.dataset.ed.slice(4));
  await tap(page, 'day:' + day);
  const c1 = await draft(page); const nDay = c1.schedule.filter(x => x.date === day).length;
  ok(await page.$$eval('#sheet .plan-day', es => es.length) === 1 && await sheetRows(page) === nDay && /^Day \d+ · /.test(await page.textContent('#sheet h2')), `day header → just that day (${nDay} items)`);
  ok((await overflow(page)).length === 0, 'day sheet @320: no overflow');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onp-day-sheet-320.png` });
  await page.click('#sheet [data-onp-all]'); await page.waitForTimeout(200);
  ok(await page.$$eval('#sheet .plan-day', es => es.length) > 3, 'Show all → whole day-by-day plan');
  await done(page);
  const ti = c1.schedule.findIndex(x => x.date === day && x.title);
  await tap(page, 's:' + ti);
  ok(await sheetRows(page) === 1 && await page.$eval('#sheet #tp-date', e => e.value) === day, 'trip item → one item with its day');
  const nextDay = await page.evaluate((d) => { const x = new Date(d + 'T00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }, day);
  await page.fill('#sheet #tp-date', nextDay); await done(page);
  ok((await draft(page)).schedule[ti].date === nextDay, 'moved the item to the next day');
  // per-day add
  const nBefore = (await draft(page)).schedule.length;
  await tap(page, 'add:s:' + nextDay); await page.fill('#sheet [data-k="title"]', 'Ramen at Ichiran'); await done(page);
  const c2 = await draft(page); ok(c2.schedule.length === nBefore + 1 && c2.schedule.some(x => x.title === 'Ramen at Ichiran' && x.date === nextDay), '+ Add to this day');
  ok(/Ramen at Ichiran/.test(await page.textContent('#preview #sec-schedule')), 'new plan on the page');
  // a route stop
  const st = await page.$eval('#preview [data-ed^="st:"]', e => e.dataset.ed);
  await tap(page, st);
  ok(await page.$$eval('#sheet .route-ed > li', es => es.length) === 1 && !(await page.$('#sheet [data-st-add]')), 'route stop → just that stop');
  await done(page);
  ok((await overflow(page)).length === 0, 'trip @320 after edits: no overflow');
  await page.close(); await ctx.close();

  // ---------- desktop: side sheet next to the live page ----------
  ctx = await ctxFor(1280); page = await open(ctx, 'tulum-wedding');
  await tap(page, 'sec:about');
  const geo = await page.evaluate(() => { const s = document.querySelector('#sheet').getBoundingClientRect(), p = document.querySelector('.b-preview').getBoundingClientRect(); return { modal: document.querySelector('#sheet').matches(':modal'), sl: s.left, sr: s.right, pl: p.left }; });
  ok(!geo.modal && geo.sl === 0 && geo.sr <= geo.pl + 1, `desktop: side sheet over the form column, page visible ${JSON.stringify(geo)}`);
  await page.click('#preview [data-ed="hero"]'); await page.waitForTimeout(200);
  ok(await page.textContent('#sheet h2') === 'Title and photo×', 'desktop: tapping another part switches the sheet');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/onp-desktop.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200); ok(!(await page.$('#sheet[open]')), 'Escape closes the side sheet');
  await page.close(); await ctx.close();

  // ---------- the organizer's short-link page: Edit page → builder on the page ----------
  ctx = await ctxFor(390); page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES);
  const cfg = await page.evaluate(() => window.EXAMPLES['tulum-wedding']);
  const row = { id: '11111111-2222-3333-4444-555555555555', slug: 'ana-leo-test', config: cfg, updated_at: '2026-11-12T00:00:00Z' };
  await page.route(/\/rest\/v1\/events\?/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) }));
  await page.route(/\/rest\/v1\/(announcements|groups|messages)/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '?e=ana-leo-test'); await page.waitForSelector('.ev-body');
  ok(await page.textContent('.vbar a.btn') === 'Edit a copy', 'short link, not the organizer: Edit a copy');
  await page.evaluate((r) => localStorage.setItem('ep:pages', JSON.stringify([{ pid: 'p-test', cfg: r.config, hosted: { id: r.id, slug: r.slug }, url: '', updated: Date.now() }])), row);
  await page.goto(BASE + '?e=ana-leo-test#'); await page.reload(); await page.waitForSelector('.ev-body');
  ok(await page.textContent('.vbar a.btn') === 'Edit page' && !(await page.$('.ev-body [data-ed]')), 'organizer: Edit page (and the page itself has no edit marks)');
  await page.click('.vbar [data-onp-open]'); await page.waitForSelector('#preview .ev.onp'); await settle(page);
  ok(await page.$eval('.builder', e => e.dataset.tab) === 'preview' && await page.isVisible('#preview [data-ed="sec:about"]'), 'Edit page → builder showing the page, tap to edit');
  await page.close(); await ctx.close();

  ok(!errs.length, `no page errors ${errs.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
