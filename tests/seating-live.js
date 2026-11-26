// Seating (guest list → Seating tab), end to end against the real Supabase project and a site (local or live):
// throwaway users (bbbot0209+seattest-…@gmail.com, made with the admin API, no emails), one throwaway wedding page with a
// small guest list; everything is backed up and deleted at the end. No one else's data is touched.
//   BASE=https://1linktrip.com/ SHOTS=<dir> node tests/seating-live.js
//   BASE=http://127.0.0.1:18790/ (LOCAL=1 starts tests/_pages-server.js on that port)
//   (needs the Management API token in secrets/supabase-pat, read here and never printed)
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'https://1linktrip.com/';
const SHOTS = process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
const PAT = fs.readFileSync(process.env.SUPABASE_PAT_FILE || __dirname + '/../../../../secrets/supabase-pat', 'utf8').trim();
const BACKUP = process.env.BACKUP || __dirname + '/../../../eventpages-supabase/backups';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TS = Date.now().toString(36);
const mkUser = (k) => ({ email: `bbbot0209+seattest-${TS}-${k}@gmail.com`, pass: 'T' + Math.random().toString(36).slice(2) + 'x9!' });
const O = mkUser('owner'), P = mkUser('planner'); const SLUG = `seat-e2e-${TS}`;
const CFG = { v: 2, ek: 'modes:seat' + TS, type: 'Wedding', title: `Lena & Sam ${TS}`, start: '2027-06-12', end: '2027-06-13', tz: 'Europe/Lisbon', lang: 'en',
  venue: { name: 'Quinta da Regaleira', address: 'Sintra, Portugal', lat: 38.796, lon: -9.396, city: 'Sintra', country: 'Portugal', cc: 'pt' },
  tools: { weather: false, travel: false, stay: false, nearby: false, tours: false, mytrip: true, packing: false, shopping: false },
  rsvp: { via: 'form' }, schedule: [{ date: '2027-06-13', time: '16:00', title: 'Ceremony', note: '' }, { date: '2027-06-13', time: '19:00', title: 'Dinner', note: '' }] };
const HH = [ // household, group, people [name, age], replies (y / n / -)
  ['The Garcias', 'Bride’s family', [['Ana Garcia', 'adult', 'y', ['vegetarian']], ['Luis Garcia', 'adult', 'y'], ['Sofi Garcia', 'child', 'y']]],
  ['Ben Okafor', 'Groom’s friends', [['Ben Okafor', 'adult', 'y']]],
  ['The Kims', 'Mutual friends', [['Jae Kim', 'adult', 'y'], ['Min Kim', 'adult', 'y', ['gluten_free']]]],
  ['Mia Chen', 'Work', [['Mia Chen', 'adult', '-']]],
  ['Rosa Diaz', 'Work', [['Rosa Diaz', 'adult', 'n']]],
  ['The Abeles', 'Bride’s family', [['Zoe Abele', 'adult', 'y'], ['Max Abele', 'adult', 'y'], ['Ida Abele', 'infant', 'y']]]];

(async () => {
  let srv = null; if (process.env.LOCAL) srv = await require('./_pages-server.js').start(+new URL(BASE).port);
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key; const ANON = (keys.find(k => k.name === 'anon') || {}).api_key;
  const admin = (path, init = {}) => fetch(SBURL + path, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 600)); } };
  const ids = {};
  for (const [k, u, nm] of [['O', O, 'Olly Owner'], ['P', P, 'Pat Planner']]) { const r = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: u.email, password: u.pass, email_confirm: true, user_metadata: { full_name: nm } }) })).json(); ids[k] = r.id; }
  ok(Object.values(ids).every(id => /^[0-9a-f-]{36}$/.test(id || '')), 'throwaway users created');
  const inList = `('${ids.O}','${ids.P}')`;
  const browser = await chromium.launch();
  const mk = async (w = 390, touch = w < 600) => { const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 860 }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, serviceWorkers: 'block', acceptDownloads: true });
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon|basemaps|tile/, r => r.abort());
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => { page._err.push(String(e)); console.log('     [pageerror] ' + String(e).slice(0, 300)); }); page.on('dialog', d => d.accept());
    await page.goto(BASE + '?x=' + TS); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear()); return { ctx, page }; };
  const signIn = (page, u) => page.evaluate(async ([e, p]) => { const c = await window.__ep.sb(); const r = await c.auth.signInWithPassword({ email: e, password: p }); localStorage.setItem('ep:signedIn', 'true'); return !!(r.data && r.data.session); }, [u.email, u.pass]);
  const seatOf = async (name) => { const r = await sql(`select t.name from public.guest_people p left join public.guest_tables t on t.id = p.table_id where p.event_id = '${eid}' and p.name = '${name.replace(/'/g, "''")}'`); return r[0] ? r[0].name : undefined; };
  const openSeating = async (page) => { await page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=seat'); await page.waitForSelector('.seatv', { timeout: 30000 }); await page.waitForTimeout(500); };
  const center = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const mouseDrag = async (page, from, to, hold) => { await page.locator(to).first().evaluate(e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(150); const [x0, y0] = await center(page, from); await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x0 + 8, y0 + 6, { steps: 3 });
    const [x1, y1] = await center(page, to); await page.mouse.move(x1, y1, { steps: 12 }); if (hold) await hold(); await page.mouse.up(); };
  let eid = '';
  try {
    // ===== a published wedding page with a guest list and replies
    const o = await mk(1280); ok(await signIn(o.page, O), 'owner signed in');
    const ins = await o.page.evaluate(async ([cfg, slug]) => { const c = await window.__ep.sb(); const r = await c.from('events').insert({ slug, config: window.__ep.normalize(JSON.parse(JSON.stringify(cfg))), published: true }).select('id').single(); return r.data || r.error; }, [CFG, SLUG]);
    eid = ins && ins.id; ok(!!eid, 'throwaway wedding page published');
    const built = await o.page.evaluate(async ([eid, HH]) => { const c = await window.__ep.sb(); const gs = {}; let s = 0;
      for (const g of [...new Set(HH.map(h => h[1]))]) { const r = await c.from('event_groups').insert({ event_id: eid, name: g, sort: s++ }).select('id').single(); if (r.error) return r.error.message; gs[g] = r.data.id; }
      const out = {}; let k = 0;
      for (const [name, g, ps] of HH) { const hid = crypto.randomUUID(); let r = await c.from('guest_households').insert({ id: hid, event_id: eid, name, group_id: gs[g], sort: ++k }); if (r.error) return r.error.message;
        r = await c.from('guest_people').insert(ps.map(([n, age], i) => ({ id: crypto.randomUUID(), household_id: hid, name: n, age, sort: i }))); if (r.error) return r.error.message; }
      return 'ok'; }, [eid, HH]);
    ok(built === 'ok', `guest list built (6 households, 12 guests): ${built}`);
    const toks = await sql(`select h.name, h.token from public.guest_households h where h.event_id = '${eid}'`); const TOK = Object.fromEntries(toks.map(x => [x.name, x.token]));
    const PID = Object.fromEntries((await sql(`select name, id from public.guest_people where event_id = '${eid}'`)).map(x => [x.name, x.id]));
    for (const [name, , ps] of HH) { const replies = ps.filter(p => p[2] !== '-').map(([n, , a, ds]) => ({ person_id: PID[n], attending: a === 'y', note: ds ? `[[1lt:${JSON.stringify({ v: 1, diets: ds })}]]` : null }));
      if (replies.length) { const r = await fetch(`${SBURL}/rest/v1/rpc/household_rsvp`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ s: SLUG, tok: TOK[name], replies }) }); if (r.status >= 300) ok(false, 'rsvp ' + name + ' ' + await r.text()); } }
    ok(+(await sql(`select count(*) n from public.rsvps where event_id = '${eid}'`))[0].n === 10, 'household replies in (9 coming, 1 can’t come, Mia no reply)');
    // the co-planner (accepted)
    await sql(`insert into public.page_planners (event_id, email, name) values ('${eid}', '${P.email}', 'Pat')`);
    await sql(`update public.page_planners set user_id = '${ids.P}', accepted_at = now() where event_id = '${eid}'`);

    // ===== owner, desktop: the Seating tab, empty
    await openSeating(o.page);
    ok(/No tables yet/.test(await o.page.textContent('.seatv')), 'Seating tab opens with "No tables yet"');
    const unNames = await o.page.$$eval('.st-un [data-st-p] .st-pn', xs => xs.map(x => x.textContent));
    ok(unNames.length === 9 && !unNames.includes('Mia Chen') && !unNames.includes('Rosa Diaz'), `Not seated lists the 9 coming only (${unNames.length})`);
    await o.page.check('[data-st-pend]', { force: true }).catch(() => o.page.click('label:has([data-st-pend])')); await o.page.waitForTimeout(300);
    ok(await o.page.$$eval('.st-un [data-st-p]', xs => xs.length) === 10 && !!(await o.page.$(`.st-un [data-st-p="${PID['Mia Chen']}"]`)), 'Include no reply adds Mia (never Rosa, who can’t come)');
    await o.page.click('label:has([data-st-pend])'); await o.page.waitForTimeout(200);
    // group filter
    await o.page.click('.st-gchips [data-st-grp]:has-text("Bride")'); await o.page.waitForTimeout(200);
    ok(await o.page.$$eval('.st-un [data-st-p]', xs => xs.length) === 6, 'group filter: Bride’s family = 6');
    await o.page.click('.st-gchips [data-st-grp=""]');
    // quick add + a head table
    await o.page.click('[data-st-add10]'); await until(async () => +(await sql(`select count(*) n from public.guest_tables where event_id = '${eid}'`))[0].n === 10);
    ok(await o.page.$$eval('.st-t', xs => xs.length) === 10, 'Add 10 round tables of 8 → 10 cards');
    const t10 = await sql(`select name, shape, capacity from public.guest_tables where event_id = '${eid}' order by sort`); ok(t10[0].name === 'Table 1' && t10[9].name === 'Table 10' && t10.every(t => t.shape === 'round' && t.capacity === 8), 'tables 1–10, round, 8 seats');
    await o.page.click('[data-st-add]'); await o.page.waitForSelector('#gldlg[open] #ste-name');
    await o.page.fill('#ste-name', 'Head table'); await o.page.click('[data-ste-shape="rect"]'); await o.page.fill('#ste-cap', '6'); await o.page.click('#gldlg label:has(#ste-head)'); await o.page.click('[data-ste-save]');
    await until(async () => (await sql(`select count(*) n from public.guest_tables where event_id = '${eid}' and head and shape = 'rect' and capacity = 6`))[0].n === '1' || (await sql(`select count(*) n from public.guest_tables where event_id = '${eid}' and head`))[0].n == 1);
    ok(+(await sql(`select count(*) n from public.guest_tables where event_id = '${eid}' and head and shape = 'rect' and capacity = 6 and name = 'Head table'`))[0].n === 1, 'Add table: Head table, long, 6 seats');
    // reorder: head table to the front (Move earlier ×10 through the dialog)
    const headId = (await sql(`select id from public.guest_tables where event_id = '${eid}' and head`))[0].id;
    for (let i = 0; i < 10; i++) { await o.page.click(`[data-st-edit="${headId}"]`); await o.page.waitForSelector('#gldlg[open] [data-ste-mv="-1"]'); await o.page.click('[data-ste-mv="-1"]'); await o.page.waitForSelector('#gldlg[open] [data-ste-mv="-1"]'); await o.page.click('#gldlg [data-gl-x]'); }
    await o.page.waitForTimeout(800);
    const ord = await sql(`select name from public.guest_tables where event_id = '${eid}' order by sort, created_at limit 2`); ok(ord[0].name === 'Head table' && ord[1].name === 'Table 1', `reorder: ${ord.map(x => x.name).join(', ')} first`);
    const TID = Object.fromEntries((await sql(`select name, id from public.guest_tables where event_id = '${eid}'`)).map(x => [x.name, x.id]));
    // ===== mouse drag: Ben → Table 1
    await mouseDrag(o.page, `.st-un [data-st-p="${PID['Ben Okafor']}"]`, `[data-st-t="${TID['Table 1']}"]`);
    ok(await until(async () => (await seatOf('Ben Okafor')) === 'Table 1'), 'mouse drag: Ben → Table 1');
    // whole household by its header: the Garcias → Table 2
    await mouseDrag(o.page, `.st-un [data-st-hh]:has-text("The Garcias")`, `[data-st-t="${TID['Table 2']}"]`);
    ok(await until(async () => (await sql(`select count(*) n from public.guest_people where event_id = '${eid}' and table_id = '${TID['Table 2']}'`))[0].n == 3), 'household drag: the 3 Garcias → Table 2');
    // move between tables: Ana → Head table; mid-drag screenshot (desktop)
    await mouseDrag(o.page, `[data-st-t="${TID['Table 2']}"] [data-st-p="${PID['Ana Garcia']}"]`, `[data-st-t="${TID['Head table']}"]`, async () => {
      ok(await o.page.$eval(`[data-st-t="${TID['Head table']}"]`, e => e.classList.contains('st-hot')) && !!(await o.page.$('.st-ghost')), 'mid-drag: ghost + highlighted table');
      if (SHOTS) await o.page.screenshot({ path: `${SHOTS}/1280-mid-drag.png` }); });
    ok(await until(async () => (await seatOf('Ana Garcia')) === 'Head table'), 'move between tables: Ana → Head table');
    // "Move households together": dragging Luis takes Sofi (both at Table 2) with him
    await o.page.click('label:has([data-st-hhmode])');
    await mouseDrag(o.page, `[data-st-t="${TID['Table 2']}"] [data-st-p="${PID['Luis Garcia']}"]`, `[data-st-t="${TID['Head table']}"]`);
    ok(await until(async () => (await seatOf('Sofi Garcia')) === 'Head table' && (await seatOf('Luis Garcia')) === 'Head table'), 'Move households together: Luis + Sofi → Head table');
    await o.page.click('label:has([data-st-hhmode])');
    // unseat (× and drag back to the list)
    await o.page.click(`[data-st-unseat="${PID['Sofi Garcia']}"]`);
    ok(await until(async () => (await seatOf('Sofi Garcia')) === null), 'unseat with ×: Sofi back to Not seated');
    await mouseDrag(o.page, `[data-st-t="${TID['Head table']}"] [data-st-p="${PID['Luis Garcia']}"]`, '.st-un');
    ok(await until(async () => (await seatOf('Luis Garcia')) === null), 'drag onto Not seated unseats Luis');
    // Undo
    await mouseDrag(o.page, `.st-un [data-st-p="${PID['Luis Garcia']}"]`, `[data-st-t="${TID['Table 3']}"]`);
    await until(async () => (await seatOf('Luis Garcia')) === 'Table 3'); await o.page.click('#toast .toast-act');
    ok(await until(async () => (await seatOf('Luis Garcia')) === null), 'Undo puts Luis back');
    // keyboard: focus Jae, Enter → "Seat Jae Kim" list, the first free table is focused, Enter
    await o.page.focus(`.st-un [data-st-p="${PID['Jae Kim']}"]`); await o.page.keyboard.press('Enter');
    await o.page.waitForSelector('#gldlg[open] .st-pk'); await o.page.waitForTimeout(200); const ttl = await o.page.textContent('#gldlg h2'); const foc = await o.page.evaluate(() => document.activeElement.dataset.stTo);
    ok(/Seat Jae Kim/.test(ttl) && foc === TID['Head table'], `keyboard: "${ttl}", focus on the first table`);
    await o.page.keyboard.press('ArrowDown').catch(() => {}); await o.page.keyboard.press('Tab'); const foc2 = await o.page.evaluate(() => document.activeElement.dataset.stTo); await o.page.keyboard.press('Enter');
    ok(await until(async () => (await seatOf('Jae Kim')) === 'Table 1' && foc2 === TID['Table 1']), 'keyboard: Tab + Enter seats Jae at Table 1');
    ok(await o.page.evaluate((id) => document.activeElement && document.activeElement.dataset.stP === id, PID['Jae Kim']), 'keyboard: focus stays on Jae after the move');
    await o.page.keyboard.press('Delete'); ok(await until(async () => (await seatOf('Jae Kim')) === null), 'keyboard: Delete unseats Jae');
    // household "Seat all at…" (button path)
    await o.page.click(`.st-hh:has-text("The Abeles") [data-st-hpick]`);
    await o.page.waitForSelector('#gldlg[open] .st-pk'); await o.page.click(`#gldlg [data-st-to="${TID['Table 4']}"]`);
    ok(await until(async () => (await sql(`select string_agg(name, ',' order by name) n from public.guest_people where table_id = '${TID['Table 4']}'`))[0].n === 'Ida Abele,Max Abele,Zoe Abele'), 'Seat all at…: the Abeles (incl. the infant) → Table 4');
    // capacity: Head table down to 1 seat with Ana on it, then a second guest → over
    await o.page.click(`[data-st-edit="${TID['Head table']}"]`); await o.page.waitForSelector('#ste-cap'); await o.page.fill('#ste-cap', '1'); await o.page.click('[data-ste-save]'); await o.page.waitForTimeout(800);
    await mouseDrag(o.page, `.st-un [data-st-p="${PID['Min Kim']}"]`, `[data-st-t="${TID['Head table']}"]`, async () => { ok(await o.page.$eval(`[data-st-t="${TID['Head table']}"]`, e => e.classList.contains('st-full')), 'dragging onto a full table shows it red'); });
    await until(async () => (await seatOf('Min Kim')) === 'Head table'); await o.page.waitForTimeout(400);
    const alert = await o.page.textContent('.st-alert').catch(() => ''); const toastT = await o.page.textContent('#toast').catch(() => '');
    ok(/1 table is over capacity/.test(alert) && /Head table \(2\/1\)/.test(alert) && await o.page.$eval(`[data-st-t="${TID['Head table']}"]`, e => e.classList.contains('over')) && /over capacity/.test(toastT), `over capacity: "${alert.replace(/\s+/g, ' ')}" / toast "${toastT}"`);
    ok(await o.page.$$eval(`[data-st-t="${TID['Head table']}"] .st-seat.over`, xs => xs.length) === 1, 'the extra chair is drawn red');
    const icons = await o.page.$eval(`[data-st-t="${TID['Head table']}"]`, e => e.innerHTML); ok(/st-ic diet/.test(icons) && /Gluten-free|Vegetarian/.test(icons), 'dietary icon on seated guests');
    const kid = await o.page.$eval(`[data-st-t="${TID['Table 4']}"]`, e => e.textContent); ok(/Infant/.test(kid), 'infant tag on a seated guest');
    if (SHOTS) { await o.page.evaluate(() => window.scrollTo(0, 0)); await o.page.waitForTimeout(300); await o.page.screenshot({ path: `${SHOTS}/1280-over-capacity.png` }); }

    // ===== co-planner: sees the same seating; a stale move doesn't overwrite the owner's
    const p = await mk(1280); ok(await signIn(p.page, P), 'planner signed in');
    await openSeating(p.page); ok(!!(await p.page.$(`[data-st-t="${TID['Head table']}"] [data-st-p="${PID['Min Kim']}"]`)), 'planner sees Min at the Head table');
    await o.page.evaluate(async ([pid, tid]) => { const c = await window.__ep.sb(); await c.from('guest_people').update({ table_id: tid }).eq('id', pid); }, [PID['Min Kim'], TID['Table 5']]);
    await p.page.click(`[data-st-pick="${PID['Min Kim']}"]`); await p.page.waitForSelector('#gldlg[open] .st-pk'); await p.page.click(`#gldlg [data-st-to="${TID['Table 6']}"]`);
    const ct = await until(async () => { const x = await p.page.textContent('#toast').catch(() => ''); return /just moved by another planner/.test(x) ? x : null; }, 8000);
    ok(!!ct && (await seatOf('Min Kim')) === 'Table 5', `stale move refused, owner's move kept: "${ct}"`);
    ok(!!(await until(() => p.page.$(`[data-st-t="${TID['Table 5']}"] [data-st-p="${PID['Min Kim']}"]`))), 'planner\'s view shows the latest');
    // the owner's next move shows up on the planner's screen on its own (15 s poll)
    await o.page.evaluate(async ([pid, tid]) => { const c = await window.__ep.sb(); await c.from('guest_people').update({ table_id: tid }).eq('id', pid); }, [PID['Jae Kim'], TID['Table 5']]);
    ok(!!(await until(() => p.page.$(`[data-st-t="${TID['Table 5']}"] [data-st-p="${PID['Jae Kim']}"]`), 25000)), 'owner\'s move appears on the planner\'s open page');
    // planner can seat too
    await mouseDrag(p.page, `.st-un [data-st-p="${PID['Luis Garcia']}"]`, `[data-st-t="${TID['Table 2']}"]`);
    ok(await until(async () => (await seatOf('Luis Garcia')) === 'Table 2'), 'planner drag: Luis → Table 2');

    // ===== floor plan (desktop): move a table; drop a guest on a floor table
    await o.page.reload(); await o.page.waitForSelector('.seatv'); await o.page.click('[data-st-view="floor"]'); await o.page.waitForSelector('[data-st-room]');
    await o.page.$eval('[data-st-room]', e => { e.scrollIntoView({ block: 'start' }); window.scrollBy(0, -40); }); await o.page.waitForTimeout(200); const room = await o.page.locator('[data-st-room]').boundingBox();
    const [fx, fy] = await center(o.page, `[data-st-ft="${TID['Table 10']}"]`); await o.page.mouse.move(fx, fy); await o.page.mouse.down(); await o.page.mouse.move(fx + 10, fy + 5, { steps: 2 });
    await o.page.mouse.move(room.x + room.width * 0.9, room.y + room.height * 0.12, { steps: 10 }); await o.page.mouse.up();
    const pos = await until(async () => { const x = await sql(`select x, y from public.guest_tables where id = '${TID['Table 10']}'`); return x[0] && x[0].x != null ? x[0] : null; });
    ok(pos && pos.x > 600 && pos.y < 500, `floor plan: Table 10 moved to the top right (${JSON.stringify(pos)})`);
    { const all = await sql(`select name, x, y from public.guest_tables where event_id = '${eid}'`); const [W, H] = await o.page.evaluate(() => window.__ep.lists.FT); const clash = [];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (Math.abs(all[i].x - all[j].x) < W && Math.abs(all[i].y - all[j].y) < H) clash.push(all[i].name + '/' + all[j].name);
      ok(all.every(x => x.x != null) && !clash.length, `floor plan: dropped onto a table, it moved to a free spot; every table's spot saved, none overlap${clash.length ? ' — ' + clash.join(', ') : ''}`); }
    await mouseDrag(o.page, `.st-un [data-st-p="${PID['Sofi Garcia']}"]`, `[data-st-ft="${TID['Table 10']}"]`);
    ok(await until(async () => (await seatOf('Sofi Garcia')) === 'Table 10'), 'floor plan: Sofi dropped on Table 10');
    await o.page.focus(`[data-st-ft="${TID['Table 9']}"]`); for (let i = 0; i < 3; i++) await o.page.keyboard.press('ArrowLeft');
    ok(!!(await until(async () => { const x = await sql(`select x from public.guest_tables where id = '${TID['Table 9']}'`); return x[0] && x[0].x != null; })), 'floor plan: arrow keys move a table');
    if (SHOTS) await o.page.screenshot({ path: `${SHOTS}/1280-floor.png` });
    await o.page.click('[data-st-view="cards"]');
    if (SHOTS) { await o.page.waitForTimeout(300); await o.page.screenshot({ path: `${SHOTS}/1280-after.png` }); }

    // ===== phone (390, touch): long-press drag via real touch events, tray, tap-to-pick
    const m = await mk(390); ok(await signIn(m.page, O), 'owner on a phone');
    await openSeating(m.page);
    if (SHOTS) await m.page.screenshot({ path: `${SHOTS}/390-seating.png` });
    const cdp = await m.ctx.newCDPSession(m.page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await m.page.click(`[data-st-unseat="${PID['Ben Okafor']}"]`); await until(async () => (await seatOf('Ben Okafor')) === null); await m.page.waitForTimeout(400);
    await m.page.$eval(`[data-st-t="${TID['Table 3']}"]`, e => { e.scrollIntoView({ block: 'start' }); window.scrollBy(0, -20); }); await m.page.waitForTimeout(300);
    await m.page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('show', 'act'); });
    const [bx, by] = await center(m.page, `.st-un [data-st-p="${PID['Ben Okafor']}"]`);
    const [tx, ty] = await center(m.page, `[data-st-t="${TID['Table 3']}"] .st-plate`);
    await touch('touchStart', bx, by); await m.page.waitForTimeout(550);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', bx + (tx - bx) * i / 10, by + (ty - by) * i / 10); await m.page.waitForTimeout(30); }
    ok(!!(await m.page.$('.st-ghost')) && await m.page.$eval(`[data-st-t="${TID['Table 3']}"]`, e => e.classList.contains('st-hot')), 'touch long-press drag: ghost over Table 3');
    if (SHOTS) await m.page.screenshot({ path: `${SHOTS}/390-mid-drag.png` });
    await touch('touchEnd', tx, ty);
    ok(await until(async () => (await seatOf('Ben Okafor')) === 'Table 3'), 'touch: Ben → Table 3');
    // a quick swipe on a name scrolls, doesn't drag
    await m.page.click(`[data-st-unseat="${PID['Ben Okafor']}"]`); await until(async () => (await seatOf('Ben Okafor')) === null); await m.page.waitForTimeout(300);
    await m.page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('show', 'act'); });
    const [qx, qy] = await center(m.page, `.st-un [data-st-p="${PID['Ben Okafor']}"]`);
    await touch('touchStart', qx, qy); for (let i = 1; i <= 6; i++) { await touch('touchMove', qx, qy - i * 12); await m.page.waitForTimeout(16); } await touch('touchEnd', qx, qy - 72); await m.page.waitForTimeout(800);
    ok(!(await m.page.$('.st-ghost')) && (await seatOf('Ben Okafor')) === null, 'a quick swipe doesn\'t drag');
    // tap → "Seat at…"
    await m.page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('show', 'act'); });
    await m.page.tap(`.st-un [data-st-p="${PID['Ben Okafor']}"] .st-pn`); await m.page.waitForSelector('#gldlg[open] .st-pk');
    if (SHOTS) await m.page.screenshot({ path: `${SHOTS}/390-seat-at.png` });
    await m.page.tap(`#gldlg [data-st-to="${TID['Table 1']}"]`); ok(await until(async () => (await seatOf('Ben Okafor')) === 'Table 1'), 'tap a name → Seat at… → Table 1');
    await m.page.waitForTimeout(500); await m.page.locator(`[data-st-t="${TID['Head table']}"]`).scrollIntoViewIfNeeded(); await m.page.evaluate(() => window.scrollBy(0, -90)); await m.page.waitForTimeout(300);
    if (SHOTS) await m.page.screenshot({ path: `${SHOTS}/390-over-capacity.png` });
    const ov = await m.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); ok(ov, 'phone: no sideways overflow');

    // ===== exports: CSV + printable lists
    const [dl] = await Promise.all([o.page.waitForEvent('download'), o.page.click('[data-st-csv]')]); const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok(/^﻿?Table,Name,Household,Group,Age,Reply,Dietary needs/.test(csv) && /Head table,Ana Garcia,The Garcias,Bride’s family,Adult,Coming,Vegetarian/.test(csv) && /Table 4,Ida Abele,The Abeles,Bride’s family,Infant,Coming/.test(csv) && !/Rosa Diaz/.test(csv), 'seating CSV (by table, no one who can’t come)');
    await o.page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    await o.page.click('[data-st-print="table"]'); await o.page.waitForTimeout(200);
    const pt = await o.page.textContent('#st-print'); ok(/Seating by table/.test(pt) && /Head table/.test(pt) && /Ana Garcia/.test(pt) && await o.page.evaluate(() => window.__printed === 1), 'Print by table');
    if (SHOTS) { await o.page.emulateMedia({ media: 'print' }); await o.page.screenshot({ path: `${SHOTS}/print-by-table.png`, fullPage: true }); await o.page.emulateMedia({ media: 'screen' }); }
    await o.page.click('[data-st-print="abc"]'); await o.page.waitForTimeout(200);
    const abc = await o.page.$$eval('#st-print .sp-abc li span', xs => xs.map(x => x.textContent));
    ok(abc.length >= 8 && abc[0] === 'Ida Abele' && abc.indexOf('Ana Garcia') < abc.indexOf('Min Kim') && abc.join() === [...abc].sort((a, b) => (a.split(' ').pop() + a).localeCompare(b.split(' ').pop() + b)).join(), `Find your table: alphabetical by last name (${abc.slice(0, 4).join(', ')}…)`);
    if (SHOTS) { await o.page.emulateMedia({ media: 'print' }); await o.page.screenshot({ path: `${SHOTS}/print-find-your-table.png`, fullPage: true }); await o.page.emulateMedia({ media: 'screen' }); }

    // ===== guests: nothing until "Show table to guests"; then only their own table
    const g1 = await mk(390); await g1.page.goto(BASE + `?e=${SLUG}&g=${TOK['The Garcias']}`); await g1.page.waitForSelector('.hh-done, .hh-rsvp', { timeout: 30000 });
    ok(!(await g1.page.$('.hh-seat')), 'toggle off: the Garcias\' link shows no table');
    const off = await (await fetch(`${SBURL}/rest/v1/rpc/household_seats`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ s: SLUG, tok: TOK['Ben Okafor'] }) })).text();
    ok(off === 'null', `toggle off: household_seats → ${off}`);
    await o.page.click('label:has([data-st-show])');
    ok(!!(await until(async () => { const x = await sql(`select show_guests from public.guest_seating where event_id = '${eid}'`); return x[0] && x[0].show_guests; })), 'Show table to guests saved');
    await g1.page.reload(); await g1.page.waitForSelector('.hh-seat', { timeout: 30000 });
    const st = (await g1.page.innerText('.hh-seat')).replace(/\s+/g, ' ');
    ok(/Your tables/i.test(st) && /Ana Garcia Head table/.test(st) && /Luis Garcia Table 2/.test(st) && /Sofi Garcia Table 10/.test(st) && !/Min|Ben|Abele/.test(st), `Garcias' link: "${st}"`);
    if (SHOTS) { await g1.page.$eval('.hh-seat', e => e.scrollIntoView({ block: 'center' })); await g1.page.screenshot({ path: `${SHOTS}/390-guest-your-table.png` }); }
    const g2 = await mk(390); await g2.page.goto(BASE + `?e=${SLUG}&g=${TOK['The Abeles']}&lang=es`); await g2.page.waitForSelector('.hh-seat', { timeout: 30000 });
    ok(/Tu mesa\s*Table 4/i.test(await g2.page.innerText('.hh-seat')), 'Abeles (es): "Tu mesa · Table 4"');
    const on = JSON.parse(await (await fetch(`${SBURL}/rest/v1/rpc/household_seats`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ s: SLUG, tok: TOK['Ben Okafor'] }) })).text());
    ok(Array.isArray(on) && on.length === 1 && on[0].person_id === PID['Ben Okafor'] && Object.keys(on[0]).sort().join() === 'person_id,table', `household_seats (Ben): only his own seat ${JSON.stringify(on)}`);
    const bad = await (await fetch(`${SBURL}/rest/v1/rpc/household_seats`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ s: SLUG, tok: 'a'.repeat(24) }) })).text(); ok(bad === 'null', 'made-up token: nothing');
    for (const tb of ['guest_tables', 'guest_seating']) { const r = await fetch(`${SBURL}/rest/v1/${tb}?select=*`, { headers: { apikey: ANON } }); ok(r.status >= 400, `anon cannot read ${tb} (${r.status})`); }
    const anonP = await fetch(`${SBURL}/rest/v1/guest_people?select=table_id`, { headers: { apikey: ANON } }); ok(anonP.status >= 400, `anon cannot read seats (${anonP.status})`);
    // a signed-in stranger (the planner, removed) sees nothing
    await sql(`delete from public.page_planners where event_id = '${eid}'`);
    const after = await p.page.evaluate(async (id) => { const c = await window.__ep.sb(); const a = await c.from('guest_tables').select('id').eq('event_id', id); const u = await c.from('guest_tables').update({ name: 'hacked' }).eq('event_id', id).select('id'); const s = await c.from('guest_seating').select('*').eq('event_id', id); return (a.data || []).length + (u.data || []).length + (s.data || []).length; }, eid);
    ok(after === 0, 'removed planner: no tables, no edits, no setting');
    // delete a table → its guests go back to Not seated
    await o.page.click(`[data-st-edit="${TID['Table 4']}"]`); await o.page.waitForSelector('[data-ste-del]'); await o.page.click('[data-ste-del]'); await o.page.click('#confirmdlg [value="ok"]');
    ok(await until(async () => (await seatOf('Zoe Abele')) === null && (await sql(`select count(*) n from public.guest_tables where id = '${TID['Table 4']}'`))[0].n == 0), 'deleting Table 4 unseats the Abeles');
    for (const [n, x] of [['owner', o], ['planner', p], ['phone', m], ['garcias', g1], ['abeles', g2]]) ok(!x.page._err.length, `no page errors (${n}) ${x.page._err.join(' | ').slice(0, 300)}`);
  } catch (e) { ok(false, 'crashed: ' + (e && e.stack || e)); }
  finally {
    const z = eid || '00000000-0000-0000-0000-000000000000';
    const dump = { events: await sql(`select * from public.events where owner in ${inList}`), guest_tables: await sql(`select * from public.guest_tables where event_id = '${z}'`), guest_seating: await sql(`select * from public.guest_seating where event_id = '${z}'`),
      guest_households: await sql(`select * from public.guest_households where event_id = '${z}'`), guest_people: await sql(`select * from public.guest_people where event_id = '${z}'`), rsvps: await sql(`select * from public.rsvps where event_id = '${z}'`),
      event_groups: await sql(`select * from public.event_groups where event_id = '${z}'`), page_planners: await sql(`select * from public.page_planners where event_id = '${z}'`), users: ids };
    fs.mkdirSync(BACKUP, { recursive: true }); const bf = `${BACKUP}/seat-e2e-${TS}.json`; fs.writeFileSync(bf, JSON.stringify(dump, null, 1)); fs.chmodSync(bf, 0o600); console.log('backup ' + bf);
    await sql(`delete from public.events where owner in ${inList} and slug = '${SLUG}'`);
    await sql(`delete from public.trip_items where owner in ${inList}`);
    for (const id of Object.values(ids)) if (id) await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    const left = await sql(`select (select count(*) from public.events where slug = '${SLUG}') e, (select count(*) from public.guest_tables where event_id = '${z}') t, (select count(*) from public.guest_households where event_id = '${z}') h, (select count(*) from auth.users where id in ${inList}) u`);
    ok(Array.isArray(left) && +left[0].e === 0 && +left[0].t === 0 && +left[0].h === 0 && +left[0].u === 0, 'test data deleted ' + JSON.stringify(left));
    await browser.close(); if (srv) srv.close();
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
