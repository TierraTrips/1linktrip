// Every interface string is translated in every interface language (Dylan 11/25: "make them fully effective in other
// languages"). Three checks:
//  1. tables: es/fr/pt/de/it/ja carry the same keys; placeholders match the English; no " < > in a value; every
//     t('literal') in app.js has a translation in all six.
//  2. pseudo-locale (structural): every key renders as ⟦key⟧, so any English word still on screen that isn't the
//     organizer's own content (example text, place / airport / airline names) is a string that skipped t().
//     Guest demo (every tab, share sheet, a detail sheet, Nearby filters, My trip) and the organizer's own page
//     (an itinerary item sheet + its … menu, a stop sheet, Settings with every accordion open, a card, Share).
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
  [window.EXAMPLES, window.EXAMPLES_TR, window.OSM_SNAPSHOTS, window.AIRLINES, window.REGIONAL_AIRLINES].forEach(walk);
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
const WORD = /[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’]{2,}/g; const isL = (c) => !!c && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(c);
// remove the organizer's content / place data: the whole text when it is part of one, else each whole-word occurrence
const BRANDS = ['Open-Meteo', '1LinkTrip', 'LinkTrip', 'Wi-Fi'];
const strip = (s, D) => { let x = s; for (let y = ''; y !== x;) { y = x; x = x.replace(/⟦[^⟦⟧]*⟧/g, ' '); } for (const b of BRANDS) x = x.split(b).join(' ');
  if (/[A-Za-z]{3}/.test(x) && D.blob.includes(x.trim())) return '';
  if (/[A-Za-z]{3}/.test(x)) for (const d of D.segs) { if (!x.includes(d)) continue; let i = 0, out = ''; for (let j = x.indexOf(d); j >= 0; j = x.indexOf(d, j + 1)) { if (!isL(x[j - 1]) && !isL(x[j + d.length])) { out += x.slice(i, j) + ' '; i = j + d.length; } } x = out + x.slice(i); if (!/[A-Za-z]{3}/.test(x)) break; }
  // links, emails, codes (IATA, currency)
  return x.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+|\b[\w.-]+\.(com|net|org)\b/g, ' ').replace(/\b[A-Z]{2,4}\d*\b/g, ' '); };
const dataOf = (list) => { const segs = new Set(); for (const v of list) for (const p of v.split(/\n+|\s·\s|,\s/)) { const q = p.trim(); if (q.length > 2) segs.add(q); } return { blob: list.join('\u0001'), segs: [...segs].sort((a, b) => b.length - a.length) }; };

(async () => {
  const browser = await chromium.launch();
  const SCREENS = [['guest', '?demo=japan&lang=$L'], ['guest', '?demo=wedding&lang=$L'], ['owner', '#edit-ex=japan-trip'], ['owner', '#edit-ex=tulum-wedding']];
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
