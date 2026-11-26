// Seating floor plan: tables never overlap, and the phone's Not seated tray folds once everyone coming has a seat.
// Offline (made-up organizer data in the page; table writes answered by a stub, nothing reaches the database).
//  - layout: N = 1..30 tables, mixed shapes / seat counts / head tables, some with stored spots (some piled on top of
//    each other, like an old layout), the rest unplaced → laid-out centers keep the minimum spacing, and the drawn tables
//    (plate, chairs, name, count) don't intersect on screen; the room is tall enough for all of them
//  - "Add 10 round tables of 8" twice onto a saved layout (the 11/25 Table 10-on-Table 4 case) → no overlap
//  - mouse drags of a table onto another (and 12 random drags) → it lands on the nearest free spot; spots are saved
//  - arrow keys into a neighbour → it hops past it
//  - 390 px: tray folds when all coming are seated (handle + Show stays), opens when someone isn't, Show/Hide is honoured
//   node tests/seating-floor.js            (starts tests/_pages-server.js on 18791; SHOTS=<dir> saves screenshots)
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const PORT = +(process.env.PORT || 18791); const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };

// made-up guest list: 12 people in 6 households, 11 coming (one can't come)
const SETUP = `(() => {
  const X = window.__ep.lists; const B = X.B(); const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  const hs = [1, 2, 3, 4, 5, 6].map(i => ({ id: 'h' + i, name: ['Garcia', 'Okafor', 'Kim', 'Chen', 'Diaz', 'Abele'][i - 1] + ' household', lang: '', plus_ones: 0, greeting: 'household', group_id: i % 2 ? 'g1' : 'g2', token: String(i).repeat(24), opens: 0, sort: i }));
  const names = ['Ana Garcia', 'Luis Garcia', 'Ben Okafor', 'Jae Kim', 'Min Kim', 'Mia Chen', 'Rosa Diaz', 'Zoe Abele', 'Max Abele', 'Ida Abele', 'Leo Chen', 'Sam Diaz'];
  const ps = names.map((n, i) => ({ id: 'p' + i, household_id: 'h' + (1 + Math.min(5, Math.floor(i / 2))), name: n, age: 'adult', plus_ones: 0, added_by: 'host', sort: i, created_at: ago(1000), table_id: null }));
  const rs = ps.map((p, i) => ({ person_id: p.id, attending: i !== 6, note: null, created_at: ago(60) }));
  window.__mkG = (ts) => ({ eid: 'e0', ev: { id: 'e0', slug: 'floor-test', published: true }, cfg: B.cfg, filter: 'all', grp: '', by: false, sel: new Set(), tab: 'seat',
    hs: JSON.parse(JSON.stringify(hs)), ps: JSON.parse(JSON.stringify(ps)), rs, gs: [{ id: 'g1', name: 'Family' }, { id: 'g2', name: 'Friends' }], hot: new Map(), opens: 0,
    ts, seat: { show: false }, st: { pend: false, grp: '', q: '', hh: false, fold: false, view: 'floor' } });
  localStorage.setItem('ep:signedIn', 'true');
})()`;
// a random table set: n tables, mixed, `placed` of them with stored spots (some deliberately on top of each other)
const mkTables = (n, seed, placed) => { let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: n }, (_, i) => { const head = i === 0 && n > 3; const shape = head || r() < 0.4 ? 'rect' : 'round'; const cap = head ? 2 + Math.floor(r() * 10) : 2 + Math.floor(r() * 15);
    const p = i < placed; const pile = p && i % 3 === 2; return { id: 't' + i, name: head ? 'Head table' : (i === 7 ? 'The very long table name by the window' : 'Table ' + i), shape, capacity: cap, head, sort: i,
      x: p ? (pile ? 500 : Math.round(r() * 1000)) : null, y: p ? (pile ? 300 : Math.round(r() * 700)) : null }; }); };
// overlap checks: laid-out centers (units) and drawn boxes (px: the union of every part of each table)
const CHECK = `(() => { const X = window.__ep.lists; const G = X.G(); const L = X.stLayout(); const [W, H] = X.FT; const bad = [];
  const ids = [...L.keys()]; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = L.get(ids[i]), b = L.get(ids[j]); if (Math.abs(a[0] - b[0]) < W && Math.abs(a[1] - b[1]) < H) bad.push('units ' + ids[i] + '/' + ids[j]); }
  const boxes = [...document.querySelectorAll('[data-st-ft]')].map(el => { let l = 1e9, t = 1e9, r = -1e9, b = -1e9; for (const c of [el.querySelector('.st-plate'), ...el.querySelectorAll('.st-seat, .st-top, b, span')]) { const q = c.getBoundingClientRect(); if (!q.width) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); } return { id: el.dataset.stFt, l, t, r, b }; });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], c = boxes[j]; if (a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b - 0.5 && c.t < a.b - 0.5) bad.push('drawn ' + a.id + '/' + c.id); }
  const room = document.querySelector('[data-st-room]').getBoundingClientRect(); const out = boxes.filter(x => x.l < room.left - 1 || x.r > room.right + 1 || x.t < room.top - 1 || x.b > room.bottom + 1).map(x => 'outside ' + x.id);
  return { bad: [...bad, ...out], n: boxes.length, tables: G.ts.length }; })()`;

(async () => {
  const srv = await require('./_pages-server.js').start(PORT);
  const browser = await chromium.launch();
  const saved = []; // PATCH bodies the app sent for guest_tables
  const mk = async (w) => { const touch = w < 600; const ctx = await browser.newContext({ viewport: { width: w, height: touch ? 844 : 900 }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, serviceWorkers: 'block' });
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon|basemaps|tile/, r => r.abort());
    await ctx.route(/supabase\.co\/(rest|auth)\//, async r => { const q = r.request(); const m = q.method();
      if (/guest_tables/.test(q.url()) && m === 'PATCH') { saved.push([q.url(), q.postDataJSON()]); return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); }
      if (/guest_tables/.test(q.url()) && m === 'POST') { const b = q.postDataJSON(); return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify((Array.isArray(b) ? b : [b]).map(x => ({ x: null, y: null, created_at: new Date().toISOString(), ...x }))) }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: m === 'GET' ? '[]' : '{}' }); });
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => { page._err.push(String(e)); console.log('     [pageerror] ' + String(e).slice(0, 300)); });
    await page.goto(BASE + '#edit-ex=tulum-wedding'); await page.waitForFunction(() => window.__ep && window.__ep.lists.B().cfg); await page.waitForTimeout(400); await page.evaluate(SETUP); return { ctx, page }; };
  const show = (page, ts) => page.evaluate((ts) => { const X = window.__ep.lists; X.setG(window.__mkG(ts)); X.glMount(); X.glPaint(); }, ts);
  const check = (page) => page.evaluate(CHECK);
  const ft = (page, id) => page.locator(`[data-st-ft="${id}"]`);
  const mid = async (page, id) => { const b = await ft(page, id).locator('.st-plate').boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const drag = async (page, from, to) => { await ft(page, from).scrollIntoViewIfNeeded(); const [x0, y0] = await mid(page, from); const [x1, y1] = to;
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x0 + 6, y0 + 4, { steps: 2 }); await page.mouse.move(x1, y1, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(250); };
  try {
    const { page } = await mk(1280);
    // ===== layout, N = 1..30
    let worst = [];
    for (let n = 1; n <= 30; n++) for (const placed of [0, Math.floor(n / 2), n]) {
      await show(page, mkTables(n, n * 7 + placed + 1, placed)); const r = await check(page);
      if (r.bad.length || r.n !== n) worst.push(`n=${n} placed=${placed}: ${r.n} drawn, ${r.bad.slice(0, 4).join(', ')}`);
    }
    ok(!worst.length, `layout N=1..30 (none / half / all with stored spots, some piled up): no overlaps, all inside the room${worst.length ? ' — ' + worst.slice(0, 6).join(' | ') : ''}`);
    await show(page, mkTables(30, 3, 0)); const rh = await page.evaluate(() => { const r = document.querySelector('[data-st-room]').getBoundingClientRect(); return { h: r.height, w: r.width, k: getComputedStyle(document.querySelector('[data-st-room]')).getPropertyValue('--k') }; });
    ok(rh.h > rh.w * 0.8 && +rh.k > 0.5, `30 tables: the room grows to fit (${Math.round(rh.w)}×${Math.round(rh.h)} px, --k ${rh.k})`);

    // ===== the 11/25 case: 10 tables saved by the old 4-column layout (+ the head table), then Add 10 round tables twice
    const old = mkTables(11, 5, 0).map((t, i) => i < 10 ? { ...t, x: Math.round(((i % 4) + 0.5) * 250), y: Math.round((Math.floor(i / 4) + 0.5) * 640 / 3) } : t);
    await show(page, old); let r = await check(page); ok(!r.bad.length, `old saved layout + 1 unplaced: no overlap (${r.bad.join(', ')})`);
    await page.click('[data-st-add10]'); await page.waitForFunction(() => window.__ep.lists.G().ts.length === 21); await page.waitForTimeout(200);
    r = await check(page); ok(!r.bad.length && r.n === 21, `Add 10 round tables of 8 → 21 tables, none overlapping (${r.n}; ${r.bad.join(', ')})`);
    await page.evaluate(() => window.__ep.lists.G().ts.splice(20)); await page.evaluate(() => window.__ep.lists.glPaint()); // 20 for the screenshot

    // ===== drag a table onto another
    saved.length = 0; const ids = await page.$$eval('[data-st-ft]', xs => xs.map(x => x.dataset.stFt));
    const [a, b] = [ids[12], ids[3]]; const before = await page.evaluate(() => [...window.__ep.lists.stLayout()]);
    await drag(page, a, await mid(page, b)); await page.waitForTimeout(300);
    r = await check(page); const L = new Map(await page.evaluate(() => [...window.__ep.lists.stLayout()])); const B4 = new Map(before);
    const dist = Math.hypot(L.get(a)[0] - B4.get(b)[0], L.get(a)[1] - B4.get(b)[1]);
    ok(!r.bad.length, `dragged ${a} onto ${b}: no overlap (${r.bad.join(', ')})`);
    // nothing free (on a 10-unit lattice inside the room's bounds) is nearer the drop point than where it landed
    const closer = await page.evaluate(([a, at, d]) => { const [W, H] = window.__ep.lists.FT; const L = window.__ep.lists.stLayout(); L.delete(a); let n = 0;
      for (let x = 74; x <= 926; x += 10) for (let y = 88; y < 3000; y += 10) { if (Math.hypot(x - at[0], y - at[1]) >= d - 10) continue; if ([...L.values()].every(([p, q]) => Math.abs(p - x) >= W || Math.abs(q - y) >= H)) n++; } return n; }, [a, B4.get(b), dist]);
    ok(!closer && (L.get(a)[0] !== B4.get(a)[0] || L.get(a)[1] !== B4.get(a)[1]) && String(L.get(b)) === String(B4.get(b)), `…it lands on the nearest free spot to ${b} (${Math.round(dist)} units away; ${closer} free spots nearer), ${b} stays put`);
    const tsNow = await page.evaluate(() => window.__ep.lists.G().ts.map(t => [t.id, t.x, t.y]));
    ok(tsNow.every(([id, x, y]) => x != null && String([x, y]) === String(L.get(id))) && saved.length >= 1 && saved.some(([u, body]) => u.includes(a) && body.x === L.get(a)[0]), `every table's shown spot is kept and saved (${saved.length} saves)`);
    if (SHOTS) { await page.waitForFunction(() => !document.querySelector('.toast.show, #toast.show, .toast:not([hidden])') || true); await page.waitForTimeout(4500); await page.locator('.seatv').scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollTo(0, document.querySelector('.st-bar').getBoundingClientRect().top + scrollY - 10)); await page.screenshot({ path: SHOTS + '/1280-floor-20-after-drag.png', fullPage: true }); }
    // mid-drag over another table: the clash outline
    { const [x0, y0] = await mid(page, ids[5]); const [x1, y1] = await mid(page, ids[6]); await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x0 + 6, y0 + 4, { steps: 2 }); await page.mouse.move(x1 + 5, y1 + 5, { steps: 8 });
      ok(await ft(page, ids[5]).evaluate(e => e.classList.contains('st-clash')), 'mid-drag over another table: the dragged one shows it will move aside');
      if (SHOTS) await page.screenshot({ path: SHOTS + '/1280-floor-mid-drag-clash.png' });
      await page.mouse.up(); await page.waitForTimeout(300); r = await check(page); ok(!r.bad.length, `…and dropped there: no overlap (${r.bad.join(', ')})`); }
    // 12 random drags, some onto tables, some to the edges
    let rbad = []; for (let k = 0; k < 12; k++) { const ids2 = await page.$$eval('[data-st-ft]', xs => xs.map(x => x.dataset.stFt)); const s = ids2[(k * 7) % ids2.length]; const tgt = ids2[(k * 5 + 3) % ids2.length];
      const room = await page.locator('[data-st-room]').boundingBox(); const to = k % 3 === 2 ? [room.x + (k % 2 ? 2 : room.width - 2), room.y + room.height - 3] : await mid(page, tgt);
      await drag(page, s, to); r = await check(page); if (r.bad.length) rbad.push(`drag ${k} ${s}→${tgt}: ${r.bad.join(', ')}`); }
    ok(!rbad.length, `12 more drags (onto tables, to the room's edges): never an overlap${rbad.length ? ' — ' + rbad.slice(0, 4).join(' | ') : ''}`);
    // arrow keys into a neighbour: hops past
    { await show(page, [{ id: 'k1', name: 'Table 1', shape: 'round', capacity: 8, head: false, sort: 0, x: 300, y: 200 }, { id: 'k2', name: 'Table 2', shape: 'rect', capacity: 10, head: false, sort: 1, x: 460, y: 200 }]);
      await ft(page, 'k1').focus(); for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(60); }
      const p = await page.evaluate(() => [...window.__ep.lists.stLayout()]); const m = new Map(p); r = await check(page);
      ok(!r.bad.length && m.get('k1')[0] > 460 && m.get('k2')[0] === 460, `arrow keys into a neighbour hop past it (Table 1 at ${m.get('k1')}, Table 2 at ${m.get('k2')})`);
      ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.stFt) === 'k1', '…and keep focus on the moved table'); }
    ok(!page._err.length, `desktop: no page errors${page._err.length ? ' — ' + page._err.slice(0, 2).join(' | ') : ''}`);

    // ===== 390: the Not seated tray
    const { page: ph } = await mk(390);
    const seatAll = (on) => ph.evaluate((on) => { const X = window.__ep.lists; const G = X.G(); G.ps.forEach((p, i) => { p.table_id = on || i > 3 ? 't' + (i % 3) : null; }); X.glPaint(); }, on);
    await show(ph, mkTables(3, 9, 0)); await ph.evaluate(() => { window.__ep.lists.G().st.view = 'cards'; window.__ep.lists.glPaint(); });
    await seatAll(false); const st = () => ph.evaluate(() => { const u = document.querySelector('.st-un'); const ub = u.querySelector('.st-ub'); return { fold: u.classList.contains('fold'), body: getComputedStyle(ub).display !== 'none', h: Math.round(u.getBoundingClientRect().height), btn: u.querySelector('[data-st-fold]').textContent, vis: getComputedStyle(u.querySelector('[data-st-fold]')).display !== 'none' }; });
    let s1 = await st(); ok(!s1.fold && s1.body, `phone: some coming not seated → tray open (${s1.h}px)`);
    await seatAll(true); s1 = await st(); ok(s1.fold && !s1.body && s1.vis && s1.h < 80, `everyone coming seated → tray folds to its handle (${s1.h}px, “${s1.btn}” to reopen)`);
    if (SHOTS) await ph.screenshot({ path: SHOTS + '/390-tray-folded.png' });
    await ph.click('[data-st-fold]'); s1 = await st(); ok(!s1.fold && s1.body, 'tap Show → it opens (and stays open while everyone is still seated)');
    await ph.evaluate(() => window.__ep.lists.glPaint()); s1 = await st(); ok(!s1.fold, '…through a repaint');
    if (SHOTS) await ph.screenshot({ path: SHOTS + '/390-tray-reopened.png' });
    await seatAll(false); s1 = await st(); ok(!s1.fold && s1.body, 'someone unseated → open');
    await seatAll(true); s1 = await st(); ok(s1.fold, 'all seated again → folds again');
    await ph.click('[data-st-fold]'); await ph.click('[data-st-fold]'); s1 = await st(); ok(s1.fold, 'Show then Hide → folded');
    await show(ph, mkTables(3, 9, 0)); s1 = await st(); ok(!s1.fold, 'nobody seated → open');
    await ph.evaluate(() => { const X = window.__ep.lists; X.G().rs.forEach(r => { r.attending = false; }); X.glPaint(); }); s1 = await st(); ok(!s1.fold, 'no one coming yet → stays open (the Include no reply switch is in it)');
    ok(!ph._err.length, `phone: no page errors${ph._err.length ? ' — ' + ph._err.slice(0, 2).join(' | ') : ''}`);
  } finally { await browser.close(); srv.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
