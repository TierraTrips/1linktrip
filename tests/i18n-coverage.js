// Every interface string is translated in every interface language (Dylan 11/25: "make them fully effective in other
// languages"). Three checks:
//  1. tables: es/fr/pt/de/it/ja carry the same keys; placeholders match the English; no " < > in a value; every
//     t('literal') in app.js has a translation in all six.
//  2. pseudo-locale (structural): every key renders as ⟦key⟧, so any English word still on screen that isn't the
//     organizer's own content (example text, place / airport / airline names) is a string that skipped t().
//     Guest demo (every tab, share sheet, a detail sheet, Nearby filters, My trip) and the organizer's own page
//     (an itinerary item sheet + its … menu, a stop sheet, Settings with every accordion open, a card, Share), and the
//     organizers' list screens from made-up data: Settings → Planners + Guest list, the merge prompt, the guest list
//     (Guests, Dietary, Groups, Seating) with its dialogs and the printed seating lists.
//  3. each real language: the same screens rendered in es/fr/pt/de/it/ja; no t() lookup misses its table, and no
//     English-only word is left (ja: no Latin word outside the brand / code allow-list).
// 390 px, offline (third-party data APIs aborted).
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/i18n-coverage.js
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs'); const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const LANGS = (process.env.LANGS || 'es,fr,pt,de,it,ja').split(',');
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const ROOT = path.join(__dirname, '..');
global.window = {}; eval(fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8')); const I = window.EP_I18N;
const SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
// brands, formats and codes that stay as they are in every language
const ALLOW = new Set(('google maps flights hotels calendar agenda kalender booking com agoda airbnb expedia kayak priceline trip vrbo getyourguide opentable '
  + 'amex chase costco travel uber lyft rome2rio amtrak trainline smartex group apple outlook ics csv pdf gpx png jpg url qr dj wi-fi wifi '
  + 'leaflet openstreetmap open-meteo meteo linktrip english español français português deutsch italiano hyrox rsvp gmail whatsapp '
  + 'faq ok sample1 sample2 sample3 sample4 sample5 sample6 aa').split(' '));
const PH = (s) => (s.match(/\{\w+\}/g) || []).sort().join();

// ---------- 1. the tables ----------
{
  const ks = (l) => Object.keys(I[l] || {});
  const base = new Set(ks(LANGS[0]));
  for (const l of LANGS) { const s = new Set(ks(l)); const miss = [...base].filter(k => !s.has(k)), extra = [...s].filter(k => !base.has(k));
    ok(!miss.length && !extra.length, `${l}: same keys as ${LANGS[0]} (${s.size})${miss.length ? ' — missing: ' + miss.slice(0, 5).join(' | ') : ''}${extra.length ? ' — extra: ' + extra.slice(0, 5).join(' | ') : ''}`); }
  for (const l of LANGS) { const bad = Object.entries(I[l]).filter(([k, v]) => typeof v !== 'string' || !v.trim() || /["<>]/.test(v) || PH(k) !== PH(v)).map(([k]) => k);
    ok(!bad.length, `${l}: values are plain text with the key's placeholders${bad.length ? ' — ' + bad.slice(0, 5).join(' | ') : ''}`); }
  const lit = new Set(); for (const m of SRC.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) lit.add(m[1].replace(/\\'/g, "'").replace(/\\n/g, '\n'));
  const untr = [...lit].filter(k => k && LANGS.some(l => !I[l][k]));
  ok(!untr.length, `every t('…') literal in app.js is translated in ${LANGS.join('/')} (${lit.size})${untr.length ? ' — missing: ' + untr.slice(0, 8).join(' | ') : ''}`);
}

// in-page: the organizer's content and place data, so it can be told apart from interface text
const DATA_JS = `(() => { const out = new Set(); const walk = (v) => { if (typeof v === 'string') { if (v.length > 1) out.add(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  [window.EXAMPLES, window.EXAMPLES_TR, window.OSM_SNAPSHOTS, window.AIRLINES, window.REGIONAL_AIRLINES, window.__fakeData].forEach(walk);
  (window.AIRPORTS || []).forEach(a => { out.add(a[1]); out.add(a[2]); });
  return [...out].sort((a, b) => b.length - a.length); })()`;
const COLLECT = () => {
  const out = new Set(); const vis = (el) => { if (!el || !el.getClientRects().length) return false; return getComputedStyle(el).visibility !== 'hidden'; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const p = n.parentElement; if (!p || /SCRIPT|STYLE|NOSCRIPT|TEXTAREA/.test(p.tagName)) continue; const s = n.textContent.trim(); if (!s) continue;
    if (p.closest('.leaflet-control-attribution,[contenteditable="true"]')) continue; if (p.tagName === 'OPTION' ? vis(p.parentElement) : vis(p)) out.add(s); }
  for (const el of document.querySelectorAll('[aria-label],[placeholder],[title],img[alt]')) { if (!vis(el)) continue; for (const a of ['aria-label', 'placeholder', 'title', 'alt']) { const v = el.getAttribute(a); if (v && v.trim()) out.add(v.trim()); } }
  // the organizer's own values in inputs are content; option labels of the language picker are language names
  return [...out];
};
// words of the English interface that no target language uses (es "hotel" = en "hotel" is fine)
const EN_WORDS = new Set((Object.keys(I.es).join(' ') + ' ' + (SRC.match(/'[A-Z][a-z][^']{2,80}'/g) || []).join(' ')).toLowerCase().match(/[a-z][a-z'’]{2,}/g));
const tgtWords = (l) => new Set(Object.values(I[l]).join(' ').toLowerCase().match(/[\p{L}][\p{L}'’]*/gu) || []);

async function newCtx(browser, lang, mode) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: lang });
  await ctx.route(/googleapis|gstatic|overpass|nominatim|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|photon|supabase\.co/, r => r.abort());
  // mode 'pseudo': every key → ⟦key⟧; 'real': the table, misses recorded
  await ctx.addInitScript(([L, mode]) => { let v; window.__miss = [];
    Object.defineProperty(window, 'EP_I18N', { configurable: true, get: () => v, set: (o) => { const tb = o[L] || {};
      o[L] = new Proxy(tb, { get: (t, k) => { if (typeof k !== 'string') return t[k]; if (mode === 'pseudo') return '⟦' + k + '⟧'; if (!(k in t)) window.__miss.push(k); return t[k]; } }); v = o; } }); }, [lang, mode]);
  return ctx;
}
async function screens(page, kind, url, cb) {
  await page.goto(BASE); await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + url); await page.waitForTimeout(1800);
  if (!await page.evaluate(() => !!window.EXAMPLES_TR)) await page.addScriptTag({ url: BASE + 'examples-tr.js' }).catch(() => {});
  const shots = [];
  const grab = async (where) => shots.push([where, await page.evaluate(COLLECT), await page.evaluate(() => window.__miss.splice(0))]);
  const click = (sel) => page.evaluate((s) => { const el = [...document.querySelectorAll(s)].find(e => e.getClientRects().length); if (el) { el.click(); return true; } return false; }, sel);
  const close = () => page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); });
  if (kind === 'guest') {
    await grab('event');
    if (await click('.vbar [data-act="share"], [data-act="share"]')) { await page.waitForTimeout(400); await grab('share sheet'); await close(); }
    if (await click('#ev-root [data-ds]')) { await page.waitForTimeout(500); await grab('event detail sheet'); await close(); }
    for (const tab of ['travel', 'nearby', 'mytrip']) {
      await page.evaluate(k => document.querySelector(`[data-tab-go="${k}"]`)?.click(), tab); await page.waitForTimeout(1200); await grab(tab);
      if (tab === 'nearby' && await click('[data-pf-open]')) { await page.waitForTimeout(400); await grab('nearby filters'); await close(); }
      if (tab === 'mytrip' && await click('.ev-panel[data-panel="mytrip"] [data-ds]')) { await page.waitForTimeout(500); await grab('my trip detail sheet'); await close(); }
    }
  } else if (kind === 'lists') {
    // the organizers' list screens from made-up data, offline: Settings → Planners + Guest list (a hosted page with a team),
    // the merge prompt, then #guests: Guests (selection bar, group by), Dietary, Groups, Seating, and their dialogs
    await page.evaluate(LISTS_JS); await page.waitForTimeout(300);
    await click('.b-top [data-act="settings"]'); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelectorAll('details[data-acc="team"], details[data-acc="guests"]').forEach(d => { d.open = true; })); await page.waitForTimeout(200);
    await grab('settings: planners + guest list');
    await page.evaluate(() => { const X = window.__ep.lists; X.conflictDlg('Ana', [X.partName(X.B().cfg, 'f:title'), X.partName(X.B().cfg, 'f:tagline')]); }); await page.waitForTimeout(200); await grab('merge prompt');
    await page.evaluate(() => { const d = document.querySelector('#mergedlg'); d.onclose = null; d.close(); });
    const L = (body) => page.evaluate(`(() => { const X = window.__ep.lists; const G = X.G(); ${body} })()`);
    await page.evaluate(() => { const X = window.__ep.lists; X.setG(window.__fakeG()); X.glMount(); const G = X.G(); G.sel.add(G.hs[0].id); X.glPaint(); }); await page.waitForTimeout(300); await grab('guest list');
    await L('G.sel.clear(); G.by = true; G.filter = "norsvp"; X.glPaint();'); await grab('guest list by group');
    for (const tab of ['diet', 'groups', 'seat']) { await L(`G.tab = '${tab}'; X.glPaint();`); await page.waitForTimeout(200); await grab('guest list ' + tab); }
    await L('G.st.pend = true; G.ts[0].capacity = 1; X.glPaint();'); await grab('seating over capacity + no reply');
    await L('G.ts = []; X.glPaint();'); await grab('seating, no tables'); await page.evaluate(() => { const X = window.__ep.lists; X.setG(window.__fakeG()); X.G().tab = 'seat'; X.glPaint(); });
    const dlgs = ['X.glImportDlg(); const ta = document.querySelector("#gl-paste"); ta.value = "Ana Garcia, ana@example.com" + String.fromCharCode(10) + "Ben Okafor"; ta.dispatchEvent(new Event("input", { bubbles: true }));',
      'X.glEditDlg(G.hs[0].id);', 'X.stPickDlg([G.ps[0].id], X.t("Seat {n}", { n: G.ps[0].name }), G.ps[0].id);', 'X.stEditDlg(G.ts[0].id);', 'X.stEditDlg(null);'];
    for (const js of dlgs) { await L(js); await page.waitForTimeout(250); await grab('dialog ' + js.slice(0, 14)); await close(); }
    await L('document.querySelector("#st-print")?.remove(); window.print = () => {}; X.stPrint("table");'); await page.waitForTimeout(150); await page.evaluate(() => { document.querySelector('#st-print').style.display = 'block'; }); await grab('print by table');
    await L('X.stPrint("abc");'); await page.waitForTimeout(150); await grab('print find your table');
    // Invitations: empty (two ways in), the builder (and in a guest language), a saved design with sends + the queue
    await page.evaluate(() => { document.querySelector('#st-print')?.remove(); const X = window.__ep.lists; X.setG(window.__fakeG()); const G = X.G(); G.tab = 'inv'; G.iv = Object.assign(X.ivBlank(), { st: { ok: true, left: 3, dailyCap: 100 } }); X.glPaint(); }); await page.waitForTimeout(400); await grab('invitations: start');
    // the builder's placeholders are the card's own words (page / guest language, not the interface): content
    const cardWords = 'window.__fakeData.push(...[...document.querySelectorAll("[data-iv-t]")].map(x => x.placeholder).filter(Boolean));';
    await L('window.__ep.iv.ivOpenBuilder("invitation");' + cardWords); await page.waitForTimeout(600); await grab('invitations: builder');
    await L('G.iv.build.lang = "es"; X.glPaint();' + cardWords); await page.waitForTimeout(400); await grab('invitations: builder in a guest language');
    await L(`G.iv.build = null; G.iv.rows = [{ id: 'i1', kind: 'invitation', source: 'template', design: {}, images: { en: { path: 'e0/inv-en-abcdef.jpg', w: 1200, h: 1680 }, es: { path: 'e0/inv-es-abcdef.jpg', w: 1200, h: 1680 } }, show_on_page: true }];
      G.iv.sends = [{ id: 's1', household_id: 'h1', invitation_id: 'i1', kind: 'invitation', channel: 'email', status: 'delivered', sent_at: new Date(Date.now() - 864e5).toISOString(), delivered_at: new Date().toISOString(), queued_at: new Date(Date.now() - 864e5).toISOString() },
        { id: 's2', household_id: 'h2', invitation_id: 'i1', kind: 'invitation', channel: 'email', status: 'queued', queued_at: new Date().toISOString() }, { id: 's3', household_id: 'h3', invitation_id: 'i1', kind: 'invitation', channel: 'text', status: 'sent', sent_at: new Date().toISOString(), queued_at: new Date().toISOString() }];
      G.iv.st = { ok: true, left: 0, dailyCap: 100, next_at: new Date(Date.now() + 36e5).toISOString() }; G.iv.rf = 'all'; G.iv.sel = null; X.glPaint();`); await page.waitForTimeout(400); await grab('invitations: saved, sent, queued');
    await L('G.iv.kind = "save_the_date"; G.iv.rows[0].kind = "x"; X.glPaint();'); await page.waitForTimeout(300); await grab('invitations: save the date start');
    await L('G.tab = "list"; G.iv.kind = "invitation"; G.iv.rows[0].kind = "invitation"; X.glPaint();'); await page.waitForTimeout(300); await grab('guest list with sends'); 
    // arrivals board: RSVP travel + one opted-in guest's own bookings, timeline / list / no info / departures / edit dialog
    await L(`const d = (n) => { const x = new Date(G.cfg.start.slice(0, 10) + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
      G.tr = [{ household_id: 'h1', arr_date: d(-1), arr_time: '11:45', arr_place: 'CUN', arr_no: 'AA 1350', dep_date: d(2), dep_time: '18:20', dep_place: 'CUN', dep_no: 'AA 1351', stay: 'Hotel Esencia', updated_by: 'guest' }];
      G.trips = [{ user_id: 'u3', household_id: 'h3', name: 'Jae Kim', items: [{ kind: 'flight', name: 'UA 990', flight: 'UA 990', start: d(-2) + 'T07:00', end: d(-2) + 'T14:05', from: 'SFO', to: 'TQO' }, { kind: 'hotel', name: 'Azulik', start: d(-2), end: d(2) }] }];
      window.__fakeData.push('Hotel Esencia', 'Azulik', 'Jae Kim', 'CUN', 'TQO', 'AA 1350', 'AA 1351', 'UA 990', 'AA', 'UA');
      G.tab = 'arr'; X.glPaint();`); await page.waitForTimeout(300); await grab('arrivals timeline');
    await L('G.ar.view = "list"; X.glPaint();'); await grab('arrivals list');
    await L('G.ar.none = true; X.glPaint();'); await grab('arrivals no info');
    await L('G.ar.none = false; G.ar.dir = "dep"; G.ar.view = "time"; X.glPaint();'); await grab('departures');
    await L('window.__ep.ar.arEditDlg("h2");'); await page.waitForTimeout(200); await grab('arrivals edit dialog'); await close();
    await L(`G.sr = [{ id: 'r1', event_id: 'e0', name: null, from_place: 'CUN', to_place: 'Hacienda', depart_date: G.tr[0].arr_date, depart_time: '12:15', capacity: 1, vehicle: 'Van', meet: 'Exit 3', notes: null, sort: 0 }];
      G.srr = [{ run_id: 'r1', person_id: 'p1' }, { run_id: 'r1', person_id: 'p2' }]; window.__fakeData.push('Hacienda', 'Van', 'Exit 3'); G.tab = 'shut'; X.glPaint();`); await page.waitForTimeout(300); await grab('shuttles');
    await L('G.sh.dir = "dep"; X.glPaint();'); await grab('shuttles departures');
    await L('window.__ep.sh.shEditDlg("r1");'); await page.waitForTimeout(200); await grab('shuttle edit dialog'); await close();
    await L('G.sr = []; G.srr = []; X.glPaint();'); await grab('shuttles empty');
    await L('G.tab = "list"; X.glPaint();');
  } else {
    await grab('owner page');
    for (const ed of ['s:', 'st:', 'sec:details', 'hero', 'when']) {
      if (!await click(`#preview [data-ed^="${ed}"]`)) continue; await page.waitForSelector('#sheet[open]', { timeout: 3000 }).catch(() => {}); await page.waitForTimeout(300); await grab('sheet ' + ed);
      if (await click('#sheet [data-sh-more]')) { await page.waitForTimeout(200); await grab('sheet menu ' + ed); }
      await close(); }
    await click('.b-top [data-act="settings"]'); await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelectorAll('.b-form details').forEach(d => { d.open = true; })); await page.waitForTimeout(300); await grab('settings');
    for (const card of ['rsvp', 'stays', 'route', 'notes']) if (await click(`.b-form [data-card="${card}"]`)) { await page.waitForTimeout(400); await grab('card ' + card); await close(); }
    await click('.b-top [data-act="settings"]'); await page.waitForTimeout(300);
    if (await click('.b-top [data-act="publish"]')) { await page.waitForTimeout(600); await grab('share dialog'); await close(); }
    if (await click('[data-guest-tg]')) { await page.waitForTimeout(800); await grab('preview as guest'); }
  }
  return shots;
}
// made-up organizer data for the 'lists' screens (names, groups and tables are the organizer's own content)
const LISTS_JS = `(() => {
  localStorage.setItem('ep:signedIn', 'true'); const X = window.__ep.lists; const B = X.B(); const buildForm = X.buildForm;
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
  B.hosted = { id: 'e0', slug: 'cov-page', url: '', pub: true };
  B.team = { me: 'u1', rows: [{ id: null, role: 'owner', name: 'Olly Owner', email: 'olly@example.com', joined: true, me: true }, { id: 'p1', role: 'planner', name: 'Ana Ruiz', email: 'ana@example.com', joined: true, me: false, token: 'a'.repeat(32) }, { id: 'p2', role: 'planner', name: '', email: 'sam@example.com', joined: false, me: false, token: 'b'.repeat(32) }],
    act: [{ actor: 'u2', actor_name: 'Ana Ruiz', keys: ['f:title', 'f:tagline'], at: ago(5) }, { actor: 'u2', actor_name: 'Ana Ruiz', keys: ['sc-:zz'], at: ago(200) }, { actor: 'u1', actor_name: 'Olly Owner', keys: ['f:venue'], at: ago(3000) }] };
  B.glSum = { n: 12, opened: 7 };
  buildForm();
  const gs = [{ id: 'g1', name: 'Bride family' }, { id: 'g2', name: 'Work friends' }];
  const hs = [{ id: 'h1', name: 'Garcia household', lang: 'es', plus_ones: 1, greeting: 'names', group_id: 'g1', email: 'garcia@example.com', token: 'c'.repeat(24), first_opened_at: ago(90), opens: 3, sort: 1 },
    { id: 'h2', name: 'Okafor household', lang: '', plus_ones: 0, greeting: 'household', group_id: 'g2', token: 'd'.repeat(24), opens: 0, sort: 2 },
    { id: 'h3', name: 'Kim household', lang: '', plus_ones: 0, greeting: 'household', group_id: null, token: 'e'.repeat(24), opens: 0, sort: 3 }];
  const P = (id, hid, name, age, extra) => ({ id, household_id: hid, name, age, plus_ones: 0, added_by: 'host', sort: 0, created_at: ago(1000), table_id: null, ...(extra || {}) });
  const ps = [P('p1', 'h1', 'Ana Garcia', 'adult', { plus_ones: 1, table_id: 't1' }), P('p2', 'h1', 'Sofi Garcia', 'child', { table_id: 't1' }), P('p3', 'h1', 'Marta Ruiz', 'adult', { added_by: 'guest', plus_of: 'p1' }),
    P('p4', 'h2', 'Ben Okafor', 'adult'), P('p5', 'h3', 'Jae Kim', 'adult'), P('p6', 'h3', 'Ida Kim', 'infant', { table_id: 't2' })];
  const note = (x) => '[[1lt:' + JSON.stringify({ v: 1, ...x }) + ']]';
  const rs = [{ person_id: 'p1', attending: true, note: note({ diets: ['vegetarian'], meal: 'Fish', diet: 'Sesame allergy' }), created_at: ago(60) }, { person_id: 'p2', attending: true, note: note({ diets: ['nut_allergy'] }), created_at: ago(60) },
    { person_id: 'p3', attending: true, note: null, created_at: ago(60) }, { person_id: 'p4', attending: false, note: null, created_at: ago(30) }, { person_id: 'p6', attending: true, note: null, created_at: ago(20) }];
  const ts = [{ id: 't1', name: 'Rose', shape: 'round', capacity: 8, head: false, sort: 0, x: null, y: null }, { id: 't2', name: 'Lily', shape: 'rect', capacity: 6, head: true, sort: 1, x: null, y: null }];
  window.__fakeData = ['Olly Owner', 'Ana Ruiz', 'Ana', 'Olly', 'Fish', 'Sesame allergy', ...gs.map(g => g.name), ...hs.map(h => h.name), ...ps.map(p => p.name), ...ps.map(p => p.name.split(' ')[0]), ...ts.map(t => t.name), 'GG', 'AG', 'SG', 'IK', 'garcia@example.com', '?e=cov-page', 'cov-page'];
  window.__fakeG = () => ({ eid: 'e0', ev: { id: 'e0', slug: 'cov-page', published: false }, cfg: B.cfg, filter: 'all', grp: '', by: false, sel: new Set(), tab: 'list',
    hs: JSON.parse(JSON.stringify(hs)), ps: JSON.parse(JSON.stringify(ps)), rs, gs, hot: new Map([['h1', true], ['h2', false]]), opens: 3, ts: JSON.parse(JSON.stringify(ts)), seat: { show: true },
    st: { pend: false, grp: '', q: '', hh: false, fold: false, view: 'cards' } });
})()`;
const WORD = /[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’]{2,}/g; const isL = (c) => !!c && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(c);
// remove the organizer's content / place data: the whole text when it is part of one, else each whole-word occurrence
const BRANDS = ['Open-Meteo', '1LinkTrip', 'LinkTrip', 'Wi-Fi'];
const strip = (s, D) => { let x = s; for (let y = ''; y !== x;) { y = x; x = x.replace(/⟦[^⟦⟧]*⟧/g, ' '); } x = x.replace(/^[^⟦]*⟧/, ' ').replace(/⟦[^⟧]*$/, ' '); /* a phrase split by markup inside it (a bold number, a bold name) */ for (const b of BRANDS) x = x.split(b).join(' ');
  if (/[A-Za-z]{3}/.test(x) && D.blob.includes(x.trim())) return '';
  if (/[A-Za-z]{3}/.test(x)) for (const d of D.segs) { if (!x.includes(d)) continue; let i = 0, out = ''; for (let j = x.indexOf(d); j >= 0; j = x.indexOf(d, j + 1)) { if (!isL(x[j - 1]) && !isL(x[j + d.length])) { out += x.slice(i, j) + ' '; i = j + d.length; } } x = out + x.slice(i); if (!/[A-Za-z]{3}/.test(x)) break; }
  // links, emails, codes (IATA, currency)
  return x.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+|\b[\w.-]+\.(com|net|org)\b/g, ' ').replace(/\b[A-Z]{2,4}\d*\b/g, ' '); };
const dataOf = (list) => { const segs = new Set(); for (const v of list) for (const p of v.split(/\n+|\s·\s|,\s/)) { const q = p.trim(); if (q.length > 2) segs.add(q); } return { blob: list.join('\u0001'), segs: [...segs].sort((a, b) => b.length - a.length) }; };

(async () => {
  const browser = await chromium.launch();
  const SCREENS = [['guest', '?demo=japan&lang=$L'], ['guest', '?demo=wedding&lang=$L'], ['owner', '#edit-ex=japan-trip'], ['owner', '#edit-ex=tulum-wedding'], ['lists', '#edit-ex=tulum-wedding']];
  try {
    // ---------- 2. pseudo-locale ----------
    {
      const ctx = await newCtx(browser, 'ja', 'pseudo'); const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
      for (const [kind, u] of SCREENS) {
        const shots = await screens(page, kind, u.replace('$L', 'ja')); const data = dataOf(await page.evaluate(DATA_JS));
        const left = []; for (const [where, txt] of shots) for (const s of txt) { const x = strip(s, data); const w = (x.match(WORD) || []).filter(v => !ALLOW.has(v.toLowerCase())); if (w.length) left.push(`${where}: “${s.slice(0, 80)}” [${w.join(' ')}]`); }
        ok(!left.length, `pseudo ${kind} ${u.replace('$L', 'ja')}: every interface string goes through t() (${shots.length} screens)${left.length ? '\n      ' + [...new Set(left)].slice(0, 25).join('\n      ') : ''}`);
      }
      ok(!errs.length, `pseudo: no page errors${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
      await ctx.close();
    }
    // ---------- 3. each language ----------
    for (const L of LANGS) {
      const ctx = await newCtx(browser, L, 'real'); const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
      const tw = tgtWords(L);
      for (const [kind, u] of SCREENS) {
        const url = u.replace('$L', L); const shots = await screens(page, kind, url); const data = dataOf(await page.evaluate(DATA_JS));
        const miss = [...new Set(shots.flatMap(x => x[2]))].filter(k => k.trim() && !/^[\d\s.,:·–—-]*$/.test(k) && !ALLOW.has(k.toLowerCase()));
        ok(!miss.length, `${L} ${kind} ${url}: every string looked up has a ${L} translation${miss.length ? ' — missing: ' + miss.slice(0, 12).join(' | ') : ''}`);
        const left = []; for (const [where, txt] of shots) for (const s of txt) { const x = strip(s, data);
          const w = (x.match(WORD) || []).filter(v => { const k = v.toLowerCase().replace(/[’']s$/, ''); if (ALLOW.has(k) || tw.has(k)) return false; return L === 'ja' || EN_WORDS.has(k); });
          if (w.length) left.push(`${where}: “${s.slice(0, 80)}” [${w.join(' ')}]`); }
        ok(!left.length, `${L} ${kind} ${url}: no English left on screen (${shots.length} screens)${left.length ? '\n      ' + [...new Set(left)].slice(0, 25).join('\n      ') : ''}`);
      }
      ok(!errs.length, `${L}: no page errors${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
