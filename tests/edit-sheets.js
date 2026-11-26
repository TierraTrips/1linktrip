// Owner edit sheets, one look (Dylan 11/25, Direction A + B's reorder list): a one-item sheet is the item as its own card —
// type icon, the title typed in place, date and time chips, Add a place (map crop once set), the note as a line, type
// tiles instead of a dropdown, … for Move to another day / Remove, Saved once an edit saved, Done only closes, Show all.
// The item sits among its neighbors in the city ("hold to reorder": drag, or the handle's arrow keys). The stop sheet:
// map band, the city big + Change, Arrive/Leave + nights −/+, the stop's hotel, … for Move earlier/later / Remove.
// Every other owner sheet has the same top (label · Saved · … · ×) and foot (Show all · Done); section moves and Hide
// section moved into …. Every capability the old sheets had is checked reachable here. 390 + 320 + desktop docking.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/edit-sheets.js
//   SHOTS=/tmp/ep-shots node tests/edit-sheets.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const draft = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
const settle = (page) => page.waitForTimeout(700);
const sheetOverflow = (page) => page.evaluate(() => { const d = document.querySelector('#sheet'); return d.scrollWidth - d.clientWidth; });

(async () => {
  const browser = await chromium.launch(); const errs = [];
  const ctxFor = (w) => browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: w < 900, hasTouch: w < 900, serviceWorkers: 'block' });
  // tile requests answered locally (a grey square): the crop is drawn from them, the test stays offline-safe
  const noTiles = (ctx) => ctx.route(/tile\.openstreetmap\.org/, r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ccc"/></svg>' }));
  const open = async (ctx, ex) => {
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES); await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '#edit-ex=' + ex); await page.waitForSelector('#preview .ev.onp'); await settle(page); return page;
  };
  const tap = async (page, ed) => { await page.$eval(`#preview [data-ed="${ed}"]`, e => e.click()); await page.waitForSelector('#sheet[open]'); await page.waitForTimeout(200); };
  const done = async (page) => { await page.click('#sheet .sh-foot [data-b="close"]'); await page.waitForFunction(() => !document.querySelector('#sheet[open]')); await settle(page); };
  const label = (page) => page.$eval('#sheet .sh-lbl', e => e.textContent);
  const menu = async (page) => { await page.click('#sheet [data-sh-more]'); await page.waitForSelector('#sheet .sh-menu:not([hidden])'); return page.$$eval('#sheet .sh-menu [role="menuitem"]', bs => bs.map(b => b.textContent.trim() + (b.disabled ? ' (off)' : ''))); };

  for (const w of [390, 320]) {
    const ctx = await ctxFor(w); await noTiles(ctx); const page = await open(ctx, 'japan-trip');
    let c = await draft(page); const si = c.schedule.findIndex(x => /Nishiki/.test(x.title)); const x0 = c.schedule[si];
    // ---------- the item ----------
    await tap(page, 's:' + si);
    ok(await label(page) === 'Day 5 · Kyoto', `@${w} item: label is the day and the city (${await label(page)})`);
    ok(await page.$eval('#sheet .es-title', e => e.tagName === 'TEXTAREA' && e.value) === x0.title, `@${w} item: the title is typed in place, big`);
    ok(await page.$('#sheet select[data-k="kind"]') === null && (await page.$$('#sheet [data-tp-kind]')).length === 3, `@${w} item: type is three tiles, no dropdown`);
    ok(await page.$eval('#sheet [data-chip="date"] [data-chip-t]', e => e.textContent) === 'Tue, Apr 6' && await page.$eval('#sheet [data-chip="time"] [data-chip-t]', e => e.textContent) === '12:30 PM', `@${w} item: date and time chips`);
    ok(await page.$eval('#sheet [data-sp-q]', e => e.placeholder) === 'Add a place' && await page.$eval('#sheet .es-note textarea', e => e.dataset.k) === 'note', `@${w} item: Add a place line and the note line`);
    ok(!(await page.$('#sheet .sheet-b [data-sdel]')) && !(await page.$('#sheet .sheet-b [data-tp-mv]')), `@${w} item: no Remove / ↑↓ buttons in the body`);
    ok(await page.$eval('#sheet .sh-saved', e => e.textContent.trim()) === '', `@${w} item: no Saved before an edit`);
    ok(await sheetOverflow(page) <= 0, `@${w} item: no sideways scroll`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/es-item-${w}.png` });
    // autosave: title, note
    await page.fill('#sheet .es-title', 'Lunch at Nishiki'); await page.fill('#sheet .es-note .rt-ed', 'Cash only stalls'); await page.waitForTimeout(900);
    c = await draft(page); ok(c.schedule[si].title === 'Lunch at Nishiki' && c.schedule[si].note === 'Cash only stalls', `@${w} item: title and note save as typed`);
    ok(/Saved/.test(await page.$eval('#sheet .sh-saved', e => e.textContent)), `@${w} item: Saved shows after the edit`);
    ok(/Lunch at Nishiki/.test(await page.$eval('#preview', e => e.textContent)), `@${w} item: the page behind updates`);
    // Enter in the title doesn't add a line
    await page.focus('#sheet .es-title'); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    ok(!/\n/.test((await draft(page)).schedule[si].title), `@${w} item: Enter in the title adds no line break`);
    // type tiles (click + arrow keys)
    await page.click('#sheet [data-tp-kind="reservation"]'); await page.waitForTimeout(300);
    c = await draft(page); ok(c.schedule[si].kind === 'reservation' && await page.$eval('#sheet [data-tp-kind="reservation"]', e => e.getAttribute('aria-checked')) === 'true', `@${w} item: Reservation tile sets the type`);
    await page.focus('#sheet [data-tp-kind="reservation"]'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300);
    ok((await draft(page)).schedule[si].kind === 'note' && !(await page.$('#sheet [data-sp-q]')), `@${w} item: arrow key → Note (no place line for a note)`);
    await page.click('#sheet [data-tp-kind="activity"]'); await page.waitForTimeout(300);
    ok((await draft(page)).schedule[si].kind === 'activity', `@${w} item: Activity tile`);
    // time chip: set, clear
    await page.fill('#sheet [data-chip="time"] input', '13:15'); await page.waitForTimeout(300);
    ok((await draft(page)).schedule[si].time === '13:15' && await page.$eval('#sheet [data-chip="time"] [data-chip-t]', e => e.textContent) === '1:15 PM', `@${w} item: time chip sets the time`);
    await page.click('#sheet [data-tp-notime]'); await page.waitForTimeout(300);
    ok((await draft(page)).schedule[si].time === '' && await page.$eval('#sheet [data-chip="time"]', e => e.classList.contains('ghost') && e.textContent.includes('Add a time')), `@${w} item: × takes the time off`);
    // place: an existing place shows with its map crop; tap → change; × → removed
    await page.fill('#sheet [data-sp-q]', 'Nishiki Market'); ok(await page.isVisible('#sheet [data-sp-find]'), `@${w} item: Find shows once something is typed`);
    // ---------- reorder: the item among its neighbors in Kyoto ----------
    const rows = async () => page.$$eval('#sheet .ro-it', ls => ls.map(l => l.querySelector('.ro-t').textContent + (l.classList.contains('me') ? '*' : '')));
    const r0 = await rows(); ok(r0.length >= 4 && r0.includes('Lunch at Nishiki*') && /In Kyoto · hold to reorder/.test(await page.$eval('#sheet .es-ro .es-lbl', e => e.textContent)), `@${w} reorder: Kyoto's items, this one marked (${r0.join(' | ')})`);
    const fu = r0.findIndex(t => /Fushimi/.test(t)); ok(fu === r0.indexOf('Lunch at Nishiki*') - 1, `@${w} reorder: untimed lunch sits after Fushimi`);
    // keyboard: the handle's arrow keys
    await page.focus(`#sheet [data-ro-grip="${si}"]`); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(500);
    c = await draft(page); let li = c.schedule.findIndex(x => x.title === 'Lunch at Nishiki'); const fi = c.schedule.findIndex(x => /Fushimi/.test(x.title));
    ok(li >= 0 && li < fi && c.schedule[li].date === x0.date, `@${w} reorder: ArrowUp → before Fushimi, same day`);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-ro-grip]') && document.activeElement.closest('.ro-it').classList.contains('me')), `@${w} reorder: focus stays on its handle`);
    ok(/Lunch at Nishiki: Tue, Apr 6, \d+ of \d+/.test(await page.$eval('#sheet [data-sh-live]', e => e.textContent)), `@${w} reorder: the move is announced`);
    await page.keyboard.press('ArrowUp'); await page.waitForTimeout(500);
    c = await draft(page); li = c.schedule.findIndex(x => x.title === 'Lunch at Nishiki');
    ok(c.schedule[li].date === '2027-04-05' && await label(page) === 'Day 4 · Kyoto' && await page.$eval('#sheet [data-chip="date"] [data-chip-t]', e => e.textContent) === 'Mon, Apr 5', `@${w} reorder: moving past Monday's check-in takes Monday (chip + label follow)`);
    const r1 = await rows(); ok(r1.indexOf('Lunch at Nishiki*') === r1.findIndex(t => /Check in/.test(t)) - 1, `@${w} reorder: listed just before the check-in (${r1.join(' | ')})`);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(500);
    ok((await draft(page)).schedule.find(x => x.title === 'Lunch at Nishiki').date === '2027-04-05' && (await rows()).indexOf('Lunch at Nishiki*') === (await rows()).findIndex(t => /Check in/.test(t)) + 1, `@${w} reorder: ArrowDown → after the check-in, still Monday`);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(500);
    ok((await draft(page)).schedule.find(x => x.title === 'Lunch at Nishiki').date === x0.date, `@${w} reorder: ArrowDown past Fushimi → back to Tuesday`);
    // drag with the mouse / finger on the handle: down past the next row
    const r2 = await rows(); const me = r2.indexOf('Lunch at Nishiki*'); const nextT = r2[me + 1];
    const g = await page.$('#sheet .ro-it.me .ro-grip'); const bx = await g.boundingBox(); const nx = await (await page.$$('#sheet .ro-it'))[me + 1].boundingBox();
    await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2 + (nx.y + nx.height * .8 - bx.y - bx.height / 2) * k / 6);
    ok(await page.$eval('#sheet .ro-it.me', e => e.classList.contains('drag')), `@${w} reorder: the row lifts while dragged`);
    await page.mouse.up(); await page.waitForTimeout(500);
    const r3 = await rows(); ok(r3.indexOf('Lunch at Nishiki*') === r3.indexOf(nextT) + 1, `@${w} reorder: dragged below "${nextT}" (${r3.join(' | ')})`);
    // a finger: hold the row (not the handle), then drag up one row
    const r4 = await rows(); const me4 = r4.indexOf('Lunch at Nishiki*'); const prevT = r4[me4 - 1];
    await page.evaluate(async () => { const li = document.querySelector('#sheet .ro-it.me .ro-t'); const prev = li.closest('.ro-it').previousElementSibling; const b = li.getBoundingClientRect(), pb = prev.getBoundingClientRect();
      const ev = (t, y) => li.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: b.left + 20, clientY: y }));
      ev('pointerdown', b.top + b.height / 2); await new Promise(r => setTimeout(r, 450));
      for (let k = 1; k <= 5; k++) ev('pointermove', b.top + b.height / 2 - (b.top + b.height / 2 - (pb.top + pb.height * .2)) * k / 5);
      ev('pointerup', pb.top + pb.height * .2); });
    await page.waitForTimeout(500); const r5 = await rows();
    ok(r5.indexOf('Lunch at Nishiki*') === r5.indexOf(prevT) - 1, `@${w} reorder: hold and drag with a finger moves it above "${prevT}" (${r5.join(' | ')})`);
    // a quick swipe on a row is a scroll, not a move
    await page.evaluate(() => { const li = document.querySelector('#sheet .ro-it.me .ro-t'); const b = li.getBoundingClientRect();
      const ev = (t, y) => li.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch', isPrimary: true, clientX: b.left + 20, clientY: y }));
      ev('pointerdown', b.top + 5); ev('pointermove', b.top + 60); ev('pointermove', b.top + 120); ev('pointerup', b.top + 120); });
    await page.waitForTimeout(400); ok((await rows()).join() === r5.join(), `@${w} reorder: a quick swipe doesn't move anything`);
    // … menu: Move to another day, Remove; Escape closes it
    const items = await menu(page); ok(items.join('|') === 'Move to another day|Remove', `@${w} item menu: ${items.join(', ')}`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    ok(await page.$eval('#sheet .sh-menu', e => e.hidden) && !!(await page.$('#sheet[open]')), `@${w} item menu: Escape closes the menu, not the sheet`);
    await menu(page); await page.click('#sheet .sh-menu [data-tp-day]'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'tp-date'), `@${w} item menu: Move to another day → the day picker`);
    await page.fill('#sheet #tp-date', '2027-04-07'); await page.waitForTimeout(400);
    ok((await draft(page)).schedule.find(x => x.title === 'Lunch at Nishiki').date === '2027-04-07' && await label(page) === 'Day 6 · Kyoto', `@${w} item: a new day saves; label follows`);
    // Show all: the whole itinerary with its old row controls (type select, ↑↓, + Add to this day, import)
    await page.click('#sheet [data-onp-all]'); await page.waitForTimeout(300);
    ok((await page.$$('#sheet select[data-k="kind"]')).length > 5 && !!(await page.$('#sheet [data-tp-mv]')) && !!(await page.$('#sheet [data-tp-add]')), `@${w} Show all: every item, type, ↑↓, Add to this day`);
    await done(page);
    // Remove from the menu (asks, deletes, Undo)
    c = await draft(page); li = c.schedule.findIndex(x => x.title === 'Lunch at Nishiki'); await tap(page, 's:' + li); await menu(page);
    await page.click('#sheet .sh-menu [data-sdel]'); await page.waitForSelector('#confirmdlg[open]'); await page.click('#confirmdlg .btn.primary, #confirmdlg [value="ok"], #confirmdlg button:has-text("Delete")'); await page.waitForTimeout(500);
    ok(!(await draft(page)).schedule.some(x => x.title === 'Lunch at Nishiki') && !(await page.$('#sheet[open]')), `@${w} item menu: Remove deletes it and closes`);
    await page.click('#undo button'); await page.waitForTimeout(500);
    ok((await draft(page)).schedule.some(x => x.title === 'Lunch at Nishiki'), `@${w} item: Undo puts it back`);
    // autosave persists: a fresh load of the page shows the edit
    await page.goto(BASE + '#new'); await page.reload(); await page.waitForSelector('#preview .ev.onp'); await settle(page);
    c = await draft(page); li = c.schedule.findIndex(x => x.title === 'Lunch at Nishiki'); await tap(page, 's:' + li);
    ok(await page.$eval('#sheet .es-title', e => e.value) === 'Lunch at Nishiki' && await page.$eval('#sheet .es-note textarea', e => e.value) === 'Cash only stalls', `@${w} autosave: reopened page keeps the edits`);
    await done(page);
    // a hotel check-in: bed icon, room details, notes, Remove hotel
    const hi = c.schedule.findIndex(x => /Check in: Hotel Granvia/.test(x.title)); await tap(page, 's:' + hi);
    ok(!!(await page.$('#sheet .it-card .hf-fold')) && !!(await page.$('#sheet .es-note textarea[data-k="note"]')) && (await menu(page)).includes('Remove hotel'), `@${w} hotel item: room details, notes, Remove hotel`);
    await page.keyboard.press('Escape'); await done(page);
    // a place already chosen: name + map crop + Directions; tap → change; × → removed
    await page.evaluate(([i]) => { const d = JSON.parse(localStorage.getItem('ep:draft')); d.schedule[i].place = { name: 'Nishiki Market', address: 'Nakagyo Ward, Kyoto', lat: 35.005, lon: 135.765 }; localStorage.setItem('ep:draft', JSON.stringify(d)); }, [li]);
    await page.goto(BASE + '#new'); await page.reload(); await page.waitForSelector('#preview .ev.onp'); await settle(page); await tap(page, 's:' + li);
    ok(await page.$eval('#sheet .s-place b', e => e.textContent) === 'Nishiki Market' && (await page.$$eval('#sheet .es-thumb img', is => is.map(i => i.src))).every(s => /tile\.openstreetmap\.org\/15\//.test(s)) && (await page.$$('#sheet .es-thumb img')).length > 0, `@${w} place: name + a real map crop`);
    ok(/maps\/dir/.test(await page.$eval('#sheet .es-place a', a => a.href)), `@${w} place: Directions`);
    await page.click('#sheet [data-sp-chg]'); await page.waitForSelector('#sheet [data-sp-q]'); ok(await page.$eval('#sheet [data-sp-q]', e => e.value) === 'Nishiki Market', `@${w} place: tap → change it`);
    await done(page); await tap(page, 's:' + li); await page.click('#sheet [data-sp-del]'); await page.waitForTimeout(300);
    ok(!(await draft(page)).schedule[li].place && !!(await page.$('#sheet [data-sp-q]')), `@${w} place: × removes it`);
    await done(page);

    // ---------- the stop ----------
    c = await draft(page); const ki = c.stops.findIndex(s => s.name === 'Kyoto');
    await tap(page, 'st:' + ki);
    ok(await label(page) === `Stop ${ki + 1} of ${c.stops.length}` && await page.$eval('#sheet .es-city', e => e.textContent) === 'Kyoto', `@${w} stop: Stop n of N, the city big`);
    ok((await page.$$('#sheet .es-band img')).length > 0 && /OpenStreetMap/.test(await page.$eval('#sheet .es-band', e => e.textContent)), `@${w} stop: map band (OpenStreetMap tiles, credited)`);
    ok(await page.$eval('#sheet .es-d:not(.r) b', e => e.textContent) === 'Mon, Apr 5' && await page.$eval('#sheet .es-d.r b', e => e.textContent) === 'Thu, Apr 8' && await page.$eval('#sheet .es-nights span', e => e.textContent) === '3 nights', `@${w} stop: Arrive / Leave / nights`);
    ok(/Hotel Granvia Kyoto/.test(await page.$eval('#sheet .es-go', e => e.textContent)), `@${w} stop: its hotel`);
    ok(await sheetOverflow(page) <= 0, `@${w} stop: no sideways scroll`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/es-stop-${w}.png` });
    await page.click('#sheet [data-st-n][data-dir="1"]'); await page.waitForTimeout(400);
    ok((await draft(page)).stops[ki].to === '2027-04-09' && await page.$eval('#sheet .es-nights span', e => e.textContent) === '4 nights', `@${w} stop: + adds a night`);
    await page.click('#sheet [data-st-n][data-dir="-1"]'); await page.waitForTimeout(400);
    ok((await draft(page)).stops[ki].to === '2027-04-08', `@${w} stop: − takes one off`);
    await page.fill(`#sheet #st-to-${ki}`, '2027-04-09'); await page.dispatchEvent(`#sheet #st-to-${ki}`, 'change'); await page.waitForTimeout(400);
    ok((await draft(page)).stops[ki].to === '2027-04-09', `@${w} stop: Leave date picked`);
    await page.fill(`#sheet #st-to-${ki}`, '2027-04-08'); await page.dispatchEvent(`#sheet #st-to-${ki}`, 'change'); await page.waitForTimeout(400);
    const sm = await menu(page); ok(sm.join('|') === 'Move earlier|Move later|Remove', `@${w} stop menu: ${sm.join(', ')}`);
    await page.keyboard.press('Escape');
    await page.click('#sheet .es-go'); await page.waitForTimeout(300);
    ok(/Check in: Hotel Granvia/.test(await page.$eval('#sheet .es-title', e => e.value)), `@${w} stop: hotel row opens that item`);
    await page.click('#sheet [data-onp-all]'); await page.waitForTimeout(200); await done(page);
    await tap(page, 'st:' + ki); await page.click('#sheet [data-st-clear]'); await page.waitForTimeout(300);
    ok(!!(await page.$(`#sheet #st-q-${ki}`)) && !!(await page.$(`#sheet [data-st-find="${ki}"]`)), `@${w} stop: Change → search for a city`);
    await done(page); await page.goto(BASE + '#edit-ex=japan-trip'); await page.waitForSelector('#preview .ev.onp'); await settle(page);
    // Show all from a stop: the whole route (insert, add, move trip dates)
    await tap(page, 'st:1'); await page.click('#sheet [data-onp-all]'); await page.waitForTimeout(200);
    ok((await page.$$('#sheet .st-row')).length >= 3 && !!(await page.$('#sheet [data-st-add]')) && !!(await page.$('#sheet [data-st-ins]')) && !!(await page.$('#sheet [data-sh="open"]')), `@${w} stop Show all: whole route, insert / add / move trip dates`);
    await done(page);
    // stop menu: Move later, Remove
    c = await draft(page); const n1 = c.stops[1].name; await tap(page, 'st:1'); await menu(page); await page.click('#sheet .sh-menu [data-st-del]'); await page.waitForSelector('#confirmdlg[open]');
    await page.click('#confirmdlg button:has-text("Delete")'); await page.waitForTimeout(400);
    ok(!(await draft(page)).stops.some(s => s.name === n1), `@${w} stop menu: Remove`);
    await page.click('#undo button'); await page.waitForTimeout(400);

    // ---------- the other sheets: same top and foot ----------
    await tap(page, 'when');
    ok(await label(page) === 'Dates and destination' && !!(await page.$('#sheet .es-when #sh-vname.es-title')) && !!(await page.$('#sheet [data-when="sd"]')) && !!(await page.$('#sheet #sh-fly')) && !!(await page.$('#sheet [data-b="clear-venue"]')), `@${w} dates and destination: name in place, dates, fly into, Change`);
    ok(!(await page.$('#sheet .hint')), `@${w} dates and destination: no explainer text`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/es-when-${w}.png` });
    await page.fill('#sheet #sh-vname', 'Tokyo!'); await page.waitForTimeout(500); ok((await draft(page)).venue.name === 'Tokyo!', `@${w} dates and destination: name saves`);
    await done(page);
    await tap(page, 'hero'); ok(!!(await page.$('#sheet #sh-title.es-title')) && !!(await page.$('#sheet #sh-tagline')) && !!(await page.$('#sheet #f-cover')), `@${w} title and photo: title in place, tagline, cover`);
    await page.fill('#sheet #sh-title', 'Japan, spring'); await page.waitForTimeout(500); ok((await draft(page)).title === 'Japan, spring', `@${w} title saves`); await done(page);
    await tap(page, 'sec:about'); const am = await menu(page);
    ok(am.join('|').includes('Move section up') && am.includes('Hide section') && !(await page.$('#sheet .sheet-b [data-sec-mv]')), `@${w} section: move / hide live in … (${am.join(', ')})`);
    await page.click('#sheet .sh-menu [data-onp-hide]'); await page.waitForTimeout(400); ok((await draft(page)).off.about === true, `@${w} section: Hide section`);
    await page.click('#undo button'); await page.waitForTimeout(400);
    const c2 = await draft(page); await tap(page, 'n:1'); const nm = await menu(page);
    ok(nm.join('|') === 'Move up|Move down (off)|Remove' && await page.$eval('#sheet .es-title', e => e.value) === c2.notes[1].label, `@${w} note: title in place; … Move up / Move down / Remove`);
    await page.click('#sheet .sh-menu [data-onp-mv][data-dir="-1"]'); await page.waitForTimeout(400);
    ok((await draft(page)).notes[0].label === c2.notes[1].label, `@${w} note: Move up`); await done(page);
    await page.close(); await ctx.close();
  }

  // ---------- desktop: the sheet docks beside the page ----------
  {
    const ctx = await ctxFor(1280); await noTiles(ctx); const page = await open(ctx, 'japan-trip');
    const c = await draft(page); const si = c.schedule.findIndex(x => /Nishiki/.test(x.title));
    await tap(page, 's:' + si);
    const r = await page.evaluate(() => { const s = document.querySelector('#sheet').getBoundingClientRect(), p = document.querySelector('.b-preview').getBoundingClientRect(); return { modal: document.querySelector('#sheet').matches(':modal'), sr: s.right, pl: p.left }; });
    ok(!r.modal && r.pl >= r.sr - 1, `desktop: item sheet docks beside the page ${JSON.stringify(r)}`);
    ok(await sheetOverflow(page) <= 0 && (await page.$$('#sheet .ro-it')).length >= 4, 'desktop: item card + reorder list fit');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/es-desktop.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200); ok(!(await page.$('#sheet[open]')), 'desktop: Escape closes the docked sheet');
    await page.close(); await ctx.close();
  }
  ok(!errs.length, `no page errors ${errs.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
