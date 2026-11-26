/* 1LinkTrip — static event microsite builder. No backend: events live in the URL hash. */
(() => {
'use strict';

// ---------- small utilities ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const clone = (o) => JSON.parse(JSON.stringify(o));
const pad = (n) => String(n).padStart(2, '0');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
// ---------- light formatting (Dylan 11/25: "highlight/bold/italic text to make certain things stand out") ----------
// Kept in the plain text as a tiny markdown subset: **bold**, *italic*, ==highlight==. rtHTML escapes every character of
// the text and only ever emits <strong>, <em>, <mark> of its own, so nothing typed can become HTML. A marker needs text
// right next to it (no space) and a partner on the same line; anything unmatched stays as typed ("5 * 3", "*sold out").
// A single * between two Latin letters/digits stays a star (2*3*4); CJK text needs no spaces around markers.
const RT_TAG = { '**': 'strong', '*': 'em', '==': 'mark' };
function rtParse(s, emit) {
  s = String(s ?? ''); const out = [], st = []; let buf = '', i = 0;
  const word = (c) => !!c && /[A-Za-z0-9À-ɏ]/.test(c); const sp = (c) => !c || /\s/.test(c);
  const flush = () => { if (buf) { out.push(emit.text(buf)); buf = ''; } };
  const unwind = (k = 0) => { while (st.length > k) { const o = st.pop(); out[o.at] = emit.text(o.m); } };
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') { flush(); unwind(); out.push('\n'); i++; continue; }
    if (c !== '*' && c !== '=') { buf += c; i++; continue; }
    let j = i; while (s[j] === c) j++; let n = j - i; const prev = s[i - 1], next = s[j];
    if ((c === '=' && n !== 2) || n > 3) { buf += s.slice(i, j); i = j; continue; }
    flush();
    if (!sp(prev)) { // close: the nearest open marker this run can end (markers opened inside it and left open stay as typed)
      for (;;) {
        if (!n) break; let k = -1, m = '';
        for (let x = st.length - 1; x >= 0; x--) { const o = st[x];
          if (c === '=' && o.m === '==') { k = x; m = '=='; break; }
          if (c === '*' && o.m === '**' && n >= 2) { k = x; m = '**'; break; }
          if (c === '*' && o.m === '*' && (n > 1 || !word(next))) { k = x; m = '*'; break; } }
        if (k < 0 || out.length === st[k].at + 1) break; // nothing between the markers: not formatting
        unwind(k + 1); const o = st.pop(); out[o.at] = emit.open(RT_TAG[m]); out.push(emit.close(RT_TAG[m])); n -= m.length;
      }
    }
    if (n && !sp(next) && (c === '=' || n > 1 || !word(prev))) { // open
      const ms = c === '=' ? ['=='] : n === 3 ? ['**', '*'] : n === 2 ? ['**'] : ['*'];
      ms.forEach(m => { st.push({ m, at: out.length }); out.push(''); }); n = 0;
    }
    if (n) out.push(emit.text(c.repeat(n)));
    i = j;
  }
  flush(); unwind(); return out.join('');
}
const RT_H = { text: esc, open: (t) => `<${t}>`, close: (t) => `</${t}>` };
const RT_P = { text: (s) => s, open: () => '', close: () => '' };
const rtHTML = (s) => rtParse(s, RT_H); // one line or several (\n kept): safe HTML
const rtPlain = (s) => rtParse(s, RT_P); // the text without its markers: calendar files, previews, titles
const rtBr = (s) => rtHTML(s).replace(/\n/g, '<br>');
const rtParas = (s) => String(s || '').split(/\n\s*\n/).filter(p => p.trim()).map(p => `<p>${rtBr(p.trim())}</p>`).join('');
// translation: markers travel as <b>/<i>/<mark> (models keep tags around the right words); back to markers after, with an
// unmatched tag dropped and spaces moved outside the markers
const RT_TR = { '**': 'b', '*': 'i', '==': 'mark' };
const rtToTags = (s) => rtParse(s, { text: (x) => x, open: (t) => `<${RT_TR[Object.keys(RT_TAG).find(k => RT_TAG[k] === t)]}>`, close: (t) => `</${RT_TR[Object.keys(RT_TAG).find(k => RT_TAG[k] === t)]}>` });
function rtFromTags(s) {
  const M = { b: '**', i: '*', mark: '==' }; const out = [], st = []; let last = 0; s = String(s ?? '');
  for (const m of s.matchAll(/<(\/?)(b|i|mark)>/gi)) {
    out.push(s.slice(last, m.index)); last = m.index + m[0].length; const tag = m[2].toLowerCase();
    if (!m[1]) { st.push({ tag, at: out.length }); continue; }
    const k = st.map(o => o.tag).lastIndexOf(tag); if (k < 0) continue;
    const o = st[k]; st.length = k; const seg = out.splice(o.at).join(''); const w = seg.match(/^(\s*)([\s\S]*?)(\s*)$/);
    out.push(w[2] ? w[1] + M[tag] + w[2] + M[tag] + w[3] : seg);
  }
  out.push(s.slice(last)); return out.join('');
}
// the formatting toolbar: select text in a formattable field → B / I / highlight above it (below it on touch screens,
// clear of the phone's own copy/paste bar); Cmd/Ctrl+B and Cmd/Ctrl+I. Toggles the markers around the selection.
const RT_FIELDS = '#f-desc, textarea[data-cs][data-k="text"], [data-n][data-k="text"], [data-s][data-k="note"], [data-hk="note"], [data-it="note"], [data-dsp="note"], #ov-note, [data-rt]';
function rtToggle(el, m) {
  let a = el.selectionStart, b = el.selectionEnd; const v = el.value; if (a == null || a === b) return false;
  while (a < b && /\s/.test(v[a])) a++; while (b > a && /\s/.test(v[b - 1])) b--; if (a === b) return false;
  const L = m.length; let nv, na, nb;
  const wrapped = (x, y) => v.slice(x - L, x) === m && v.slice(y, y + L) === m && (m !== '*' || (v[x - L - 1] !== '*' && v[y + L] !== '*') || (v.slice(x - 3, x) === '***' && v.slice(y, y + 3) === '***'));
  if (wrapped(a, b)) { nv = v.slice(0, a - L) + v.slice(a, b) + v.slice(b + L); na = a - L; nb = b - L; } // just inside the markers
  else if (v.slice(a, a + L) === m && v.slice(b - L, b) === m && b - a > 2 * L && (m !== '*' || (v[a + 1] !== '*' && v[b - 2] !== '*'))) { nv = v.slice(0, a) + v.slice(a + L, b - L) + v.slice(b); na = a; nb = b - 2 * L; } // markers selected too
  else { // per line: a marker can't span a line break
    const parts = v.slice(a, b).split('\n').map(l => { const w = l.match(/^(\s*)(.*?)(\s*)$/); return w[2] ? w[1] + m + w[2] + m + w[3] : l; }).join('\n');
    nv = v.slice(0, a) + parts + v.slice(b); na = a + L; nb = a + parts.length - L;
  }
  if (el.maxLength > 0 && nv.length > el.maxLength) { toast(t('That’s over this field’s length limit.')); return true; }
  el.focus(); el.value = nv; el.setSelectionRange(na, nb);
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true;
}
// where the selection's start sits on screen, via a mirror of the field
function rtCaret(el, pos) {
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); const d = document.createElement('div');
  ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'textIndent', 'wordSpacing'].forEach(k => { d.style[k] = cs[k]; });
  Object.assign(d.style, { position: 'fixed', visibility: 'hidden', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', whiteSpace: el.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre', overflowWrap: 'break-word', overflow: 'hidden' });
  d.textContent = el.value.slice(0, pos); const sEl = document.createElement('span'); sEl.textContent = el.value.slice(pos, pos + 1) || '.'; d.appendChild(sEl); document.body.appendChild(d);
  const sr = sEl.getBoundingClientRect(); d.remove();
  return { x: Math.min(Math.max(sr.left - el.scrollLeft, r.left), r.right), top: Math.max(sr.top - el.scrollTop, r.top), bottom: Math.min(sr.bottom - el.scrollTop, r.bottom) };
}
let rtBar = null, rtEl = null;
function rtHide() { if (rtBar) rtBar.hidden = true; rtEl = null; }
function rtShow(el) {
  if (!rtBar) {
    rtBar = document.createElement('div'); rtBar.className = 'rt-bar'; rtBar.setAttribute('role', 'toolbar'); rtBar.setAttribute('aria-label', t('Format text')); rtBar.hidden = true;
    rtBar.innerHTML = [['**', '<b>B</b>', 'Bold', '⌘B'], ['*', '<i>I</i>', 'Italic', '⌘I'], ['==', '<mark>H</mark>', 'Highlight', '']].map(([m, l, a, k]) => `<button type="button" data-rt-m="${m}" aria-label="${esc(t(a))}" title="${esc(t(a) + (k ? ' (' + (/Mac|iPhone|iPad/.test(navigator.platform) ? k : k.replace('⌘', 'Ctrl+')) + ')' : ''))}">${l}</button>`).join('');
    // keep the field's selection: the bar never takes focus
    rtBar.addEventListener('pointerdown', (e) => e.preventDefault()); rtBar.addEventListener('mousedown', (e) => e.preventDefault());
    rtBar.addEventListener('click', (e) => { const b = e.target.closest('[data-rt-m]'); if (!b || !rtEl) return; const el = rtEl; rtToggle(el, b.dataset.rtM); requestAnimationFrame(() => rtShow(el)); });
  }
  const host = el.closest('dialog[open]') || document.body; if (rtBar.parentNode !== host) host.appendChild(rtBar); // inside an open sheet: above its backdrop
  rtEl = el; rtBar.hidden = false;
  const c = rtCaret(el, el.selectionStart); const touch = matchMedia('(pointer: coarse)').matches; const w = rtBar.offsetWidth || 120, h = rtBar.offsetHeight || 40;
  const e2 = touch ? rtCaret(el, Math.max(el.selectionStart, el.selectionEnd - 1)) : c;
  let y = touch ? e2.bottom + 10 : c.top - h - 8; if (!touch && y < 4) y = rtCaret(el, el.selectionEnd).bottom + 8; if (y + h > innerHeight - 4) y = Math.max(4, c.top - h - 8);
  const x = Math.min(Math.max(4, c.x - w / 2 + 8), innerWidth - w - 4);
  rtBar.style.left = x + 'px'; rtBar.style.top = y + 'px';
}
function rtWatch() {
  if (document._rtOn) return; document._rtOn = true;
  const check = () => { const el = document.activeElement; if (el && el.matches && el.matches(RT_FIELDS) && el.selectionStart !== el.selectionEnd && /\S/.test(el.value.slice(el.selectionStart, el.selectionEnd))) rtShow(el); else rtHide(); };
  document.addEventListener('selectionchange', () => requestAnimationFrame(check));
  ['select', 'mouseup', 'keyup', 'touchend'].forEach(ev => document.addEventListener(ev, (e) => { if (e.target && e.target.matches && e.target.matches(RT_FIELDS)) setTimeout(check, 0); }, true));
  document.addEventListener('focusout', () => setTimeout(check, 0), true);
  document.addEventListener('scroll', () => { if (rtEl) check(); }, true); addEventListener('resize', () => { if (rtEl) check(); });
  document.addEventListener('keydown', (e) => {
    const el = e.target; if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || !el.matches || !el.matches(RT_FIELDS)) return;
    const m = { b: '**', i: '*' }[e.key.toLowerCase()]; if (!m) return; e.preventDefault(); if (rtToggle(el, m)) requestAnimationFrame(check);
  }, true);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const LS = {
  get(k, d = null) { try { const v = localStorage.getItem('ep:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ep:' + k, JSON.stringify(v)); } catch { /* quota */ } if (window.__shTouch) window.__shTouch(k); }, // a shared trip follows its bookings
  del(k) { try { localStorage.removeItem('ep:' + k); } catch {} }
};

// ---------- page names: https://1linktrip.com/<name> (Dylan 11/25: "customizable URLs") ----------
// A hosted page can have a name (page_names, supabase/schema-names.sql). /<name> is served either by <name>.html — a copy
// of index.html carrying that page's title/image for link previews, written by .github/workflows/names.yml — or, until
// that file exists, by 404.html (the same app). Either way the app reads the name from the path and opens the page as if
// the address were ?e=<slug>, keeping the pretty address. ?e= links keep working; a page's old names keep opening it and
// move the address to its current name. "/<name>&g=…" (a ?e= style suffix glued on) is read as "/<name>?g=…".
const APP_ROOT = (() => { try { const s = document.currentScript && document.currentScript.src; if (s) return new URL('./', s).pathname; } catch {} return '/'; })();
const NAME_RE = /^(?!.*--)[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
// kept in step with ep_private.name_reserved() (the server has the final say)
const NAME_RESERVED = new Set(('about account accounts admin administrator ai api app apps apple-touch-icon assets auth billing blog book booking brand ' +
  'callback cdn contact css dashboard demo dns-inbound docs domain download downloads edit email event events example examples faq favicon files ' +
  'fonts google guest guests help home icon icons images img inbox index invite invites join js legal linktrip login logout mail manifest me mine my ' +
  'new null oauth official onelinktrip page pages planner planners pricing privacy proposal public register resend robots root rsvp security settings ' +
  'setup share shared sign-in sign-up signin signup sitemap static status support supabase sw system team terms test tests trip trips undefined ' +
  'upload uploads user users www 1linktrip 404 500').split(' '));
const NAME_BAD = /(fuck|shit|cunt|nigg|fagg|rape|nazi)/;
const nameClean = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40);
const nameProblem = (n) => !NAME_RE.test(n) ? 'invalid' : NAME_RESERVED.has(n) || NAME_BAD.test(n) ? 'reserved' : '';
// what this device knows: n = name → slug (opens /<name> offline / without a round trip), s = slug → current name (links)
const pnGet = () => { const m = LS.get('pn') || {}; return { n: m.n || {}, s: m.s || {} }; };
function pnRemember(name, slug, current) {
  const m = pnGet(); if (name && slug) m.n[name] = slug; if (current && slug) { m.n[current] = slug; m.s[slug] = current; } LS.set('pn', m);
}
function pnForget(name) { const m = pnGet(); delete m.n[name]; LS.set('pn', m); }
const pnName = (slug) => pnGet().s[slug] || '';
const SLUG_RE0 = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
// the page the address names, if it is a /<name> address: { name, slug } (slug '' = not known yet), { bad } = not a name
let PATH = (() => {
  const p = location.pathname; if (!p.startsWith(APP_ROOT)) return null;
  let rest = p.slice(APP_ROOT.length); try { rest = decodeURIComponent(rest); } catch { /* as typed */ }
  rest = rest.replace(/\/+$/, '').replace(/\.html$/i, '');
  if (!rest || /^index$/i.test(rest)) return null;
  let extra = ''; const amp = rest.indexOf('&'); if (amp > 0) { extra = rest.slice(amp + 1); rest = rest.slice(0, amp); }
  const name = rest.toLowerCase();
  if (!NAME_RE.test(name)) return { bad: true, name: '', path: p };
  const meta = document.querySelector('meta[name="ep-page"]'); // the preview copy for this name says which page it is
  let slug = meta && meta.dataset.name === name && SLUG_RE0.test(meta.content || '') ? meta.content : '';
  const cur = meta && slug && NAME_RE.test(meta.dataset.current || '') ? meta.dataset.current : name;
  if (slug) pnRemember(name, slug, cur); else slug = pnGet().n[name] || '';
  const q = new URLSearchParams(location.search); if (extra) new URLSearchParams(extra).forEach((v, k) => { if (!q.has(k)) q.set(k, v); });
  const qs = q.toString(); const want = APP_ROOT + cur + (qs ? '?' + qs : '') + location.hash;
  if (want !== p + location.search + location.hash) try { history.replaceState(history.state, '', want); } catch { /* keep */ }
  return { name: cur, slug, fresh: !!(meta && slug), path: APP_ROOT + cur };
})();
// the address's query, with e=<slug> when the address is /<name>
function locQ() { const q = new URLSearchParams(location.search); if (PATH && PATH.slug && !q.has('e')) q.set('e', PATH.slug); return q; }
const withQ = (url, k, v) => url + (url.includes('?') ? '&' : '?') + k + '=' + encodeURIComponent(v);

// the toast sits in the open sheet when there is one (a modal <dialog> is the top layer: a toast behind it can't be
// tapped — "Replaced A with B · Undo" from a place sheet was unreachable), else in the page
function toastEl() {
  let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); } // a sheet re-render took it with it
  const ds = [...document.querySelectorAll('dialog[open]')]; const top = ds[ds.length - 1];
  const host = top && top.matches(':modal') ? top : document.body; if (el.parentElement !== host) host.appendChild(el); return el;
}
function toast(msg) {
  const el = toastEl(); el.textContent = msg; el.classList.remove('act'); el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- dates (all event times are wall-clock in the venue's time zone) ----------
const asUTC = (s) => new Date((s.length === 10 ? s + 'T00:00' : s) + ':00Z');
const LOCALES = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', de: 'de-DE', it: 'it-IT', ja: 'ja-JP' };
const fmt = (s, o) => { try { return new Intl.DateTimeFormat(LOCALES[LANG] || LANG || 'en-US', { timeZone: 'UTC', ...o }).format(asUTC(s)); } catch { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(asUTC(s)); } };
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s, n) => { const d = asUTC(s.slice(0, 10)); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const todayYMD = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const daysBetween = (a, b) => Math.round((asUTC(b.slice(0, 10)) - asUTC(a.slice(0, 10))) / 864e5);
// a number in the interface language (1.5 / 1,5)
const nfix = (x, d) => { try { return Number(x).toLocaleString(LOCALES[LANG] || 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); } catch { return Number(x).toFixed(d); } };
const fmtTime = (hm) => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return LANG === 'en' ? `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}` : `${pad(h)}:${pad(m)}`; };

function dateRange(start, end) {
  if (!start) return t('Date to be announced');
  const s = start.slice(0, 10), e = (end || start).slice(0, 10);
  if (s === e) return fmt(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (LANG !== 'en') { try { return new Intl.DateTimeFormat(LOCALES[LANG], { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).formatRange(asUTC(s), asUTC(e)); } catch { /* fall through */ } }
  const sy = s.slice(0, 4), ey = e.slice(0, 4), sm = s.slice(5, 7), em = e.slice(5, 7);
  if (sy === ey && sm === em) return `${fmt(s, { month: 'short', day: 'numeric' })}–${fmt(e, { day: 'numeric' })}, ${sy}`;
  if (sy === ey) return `${fmt(s, { month: 'short', day: 'numeric' })} – ${fmt(e, { month: 'short', day: 'numeric' })}, ${sy}`;
  return `${fmt(s, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(e, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
function timeRange(start, end) {
  if (!start || start.length < 16) return '';
  const st = fmtTime(start.slice(11, 16));
  if (!end || end.length < 16) return st;
  return `${st} – ${fmtTime(end.slice(11, 16))}`;
}
// offset (ms) of tz at a given UTC instant
function tzOffset(utcMs, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
  } catch { return 0; }
}
function wallToUTC(s, tz) {
  const guess = asUTC(s).getTime();
  if (!tz) return new Date(guess);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return new Date(t);
}
const icsStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// ---------- geo ----------
function distM(a1, o1, a2, o2) {
  const R = 6371e3, r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const x = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const IMPERIAL = new Set(['us', 'gb', 'lr', 'mm']);
function fmtDist(m, cc) {
  if (IMPERIAL.has(cc)) { const mi = m / 1609.34; return mi < 0.1 ? `${Math.round(m * 3.281 / 10) * 10} ft` : `${mi < 10 ? nfix(mi, 1) : Math.round(mi)} mi`; }
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${nfix(m / 1000, m < 10000 ? 1 : 0)} km`;
}
const walkMin = (m) => Math.max(1, Math.round(m * 1.25 / 80)); // straight-line x1.25 detour, 80 m/min
const walkTxt = (m) => t('{n} min walk', { n: walkMin(m) });

// Fly-into default. airports.js only knows large vs regional, and in places like the Riviera Maya three "large" airports
// sit within 80 km (CZM 36 km, TQO 52 km, CUN 76 km from Xpu-Há) — the closest is an island and the smallest. So:
// HUBS = the big passenger airports (about 10M+ passengers a year in published airport/ACI traffic figures; hand list,
// Nov 2026 — a size signal, not a ranking). Among the airports within 1.5x the distance of the nearest large one, a hub
// wins, then the nearest. Airports in ISLAND_APS (islands reached only by ferry or plane) are skipped as the default
// unless the venue is on that island (its box: south, north, west, east) — then that airport is the default; they
// still show in the list to pick.
const HUBS = new Set(('ATL LAX ORD DFW DEN JFK SFO SEA LAS MCO EWR CLT PHX IAH MIA BOS MSP FLL DTW PHL LGA BWI SLC SAN IAD DCA MDW TPA BNA AUS HNL DAL PDX STL RDU HOU SMF MSY SJC SNA MCI OAK SAT RSW ' +
  'YYZ YVR YUL YYC MEX CUN GDL MTY TIJ SJU PTY BOG MDE LIM SCL GRU GIG CGH BSB VCP EZE AEP ' +
  'LHR LGW STN LTN MAN BHX EDI DUB CDG ORY NCE AMS FRA MUC DUS HAM BER CGN MAD BCN PMI AGP ALC VLC LPA TFS LIS OPO FCO MXP BGY VCE NAP BLQ ZRH GVA VIE BRU CPH OSL ARN HEL IST SAW AYT ATH PRG WAW BUD OTP KEF SVO DME VKO LED ' +
  'TLV DXB AUH DOH JED RUH CAI JNB CPT ADD ' +
  'HND NRT KIX ITM FUK CTS OKA ICN GMP CJU PUS PEK PKX PVG SHA CAN SZX CTU TFU KMG XIY CKG HGH NKG WUH CSX XMN HKG TPE SIN KUL BKK DMK HKT CGK DPS SUB MNL SGN HAN DEL BOM BLR MAA HYD CCU COK AMD ' +
  'SYD MEL BNE PER AKL').split(' '));
const ISLAND_APS = { CZM: [20.25, 20.62, -87.04, -86.70], ACK: [41.22, 41.33, -70.26, -69.95], BWK: [43.24, 43.42, 16.38, 16.89] };
const apTier = (a) => HUBS.has(a.iata) ? 2 : a.large ? 1 : 0;
const offIsland = (a, lat, lon) => { const b = ISLAND_APS[a.iata]; return !!b && !(lat >= b[0] && lat <= b[1] && lon >= b[2] && lon <= b[3]); };
function defaultAirport(cands, lat, lon) {
  if (!cands.length) return null;
  const home = cands.find(a => ISLAND_APS[a.iata] && !offIsland(a, lat, lon)); if (home) return home; // a venue on the island: its own airport
  const land = cands.filter(a => !offIsland(a, lat, lon)); const pool = (land.length ? land : cands).slice().sort((a, b) => a.d - b.d);
  const base = (pool.find(a => a.large) || pool[0]).d;
  return pool.filter(a => a.d <= base * 1.5 + 1).sort((a, b) => apTier(b) - apTier(a) || a.d - b.d)[0];
}
const apRow = (a, lat, lon) => ({ iata: a[0], name: a[1], city: a[2], cc: a[3], lat: a[4], lon: a[5], large: !!a[6], d: distM(lat, lon, a[4], a[5]) });
// the airports near a venue (up to 3, nearest first); .def = the one guests fly into by default, .auto = the automatic
// pick. `pin` = the organizer's "Fly into" choice (cfg.flyInto): added to the list if it isn't nearby, and the default.
function nearestAirports(lat, lon, pin) {
  const all = (window.AIRPORTS || []).map(a => apRow(a, lat, lon));
  const large = all.filter(a => a.large && a.d < 220e3).sort((a, b) => a.d - b.d);
  const medium = all.filter(a => !a.large && a.d < 110e3).sort((a, b) => a.d - b.d);
  // regional fields only fill in when there are fewer than three big airports, or sit far closer than the nearest big one
  let out = large.slice(0, 3).concat(medium.filter(m => large.length < 2 || m.d < (large[0]?.d ?? Infinity) * 0.35)).sort((a, b) => a.d - b.d).slice(0, 3);
  const auto = defaultAirport(large.concat(medium), lat, lon);
  if (auto && !out.some(a => a.iata === auto.iata)) out = out.slice(0, out.length < 3 ? 3 : 2).concat(auto).sort((a, b) => a.d - b.d);
  const pa = pin && (out.find(a => a.iata === pin) || (airportByCode(pin) && apRow(airportByCode(pin), lat, lon)));
  if (pa && !out.includes(pa)) out = out.concat(pa).sort((a, b) => a.d - b.d);
  out.auto = auto ? auto.iata : ''; out.def = pa ? pa.iata : out.auto;
  return out;
}
// the organizer's choices for "Fly into" in the builder: airports within reach of the venue, the automatic pick included
function airportChoices(lat, lon) {
  const all = (window.AIRPORTS || []).map(a => apRow(a, lat, lon)).filter(a => a.d < (a.large ? 320e3 : 130e3)).sort((a, b) => a.d - b.d);
  const near = nearestAirports(lat, lon); const xs = all.slice(0, 8);
  near.forEach(a => { if (!xs.some(x => x.iata === a.iata)) xs.push(a); });
  return { list: xs.sort((a, b) => a.d - b.d), auto: near.auto };
}
function searchAirports(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const res = [];
  for (const a of window.AIRPORTS || []) {
    const code = a[0].toLowerCase(), city = (a[2] || '').toLowerCase(), name = a[1].toLowerCase();
    let s = 0;
    if (code === q) s = 100; else if (city.startsWith(q)) s = 60; else if (name.startsWith(q)) s = 50; else if (city.includes(q) || name.includes(q)) s = 30;
    if (s) res.push([s + (a[6] ? 10 : 0), a]);
  }
  return res.sort((x, y) => y[0] - x[0]).slice(0, 6).map(x => x[1]);
}
const airportByCode = (c) => (window.AIRPORTS || []).find(a => a[0] === c);

// ---------- fetching with caching ----------
const memo = new Map();
async function getJSON(url, { ttl = 3600e3, init, timeout = 20000, key } = {}) {
  key = key || url + (init && init.body ? '|' + init.body : '');
  if (memo.has(key)) return memo.get(key);
  const p = (async () => {
    const cached = LS.get('c:' + key);
    if (cached && (Date.now() - cached.t < ttl || navigator.onLine === false)) return cached.d;
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { ...init, signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (cached && !/HTTP 4/.test(e.message)) return cached.d; throw e; }
    finally { clearTimeout(tm); }
  })();
  memo.set(key, p);
  p.catch(() => memo.delete(key));
  return p;
}
function cacheSet(key, d) { LS.set('c4:' + key, { t: Date.now(), d }); }

// ---------- external integrations ----------
// Address and venue search: Google Places (Text Search) first; Nominatim only when Google has no key or refuses it.
async function geocode(q) {
  if (GKEY && !gpBroken) {
    try { return await gGeocode(q); }
    catch (e) { if (/places 4(00|03|29)/.test(e.message)) gpBroken = true; }
  }
  return osmGeocode(q);
}
let lastNominatim = 0;
async function osmGeocode(q) {
  const wait = 1100 - (Date.now() - lastNominatim); if (wait > 0) await sleep(wait); // Nominatim: max 1 req/s
  lastNominatim = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=en&q=${enc(q)}`;
  const data = await getJSON(url, { ttl: 864e5 * 7 });
  return data.map(r => {
    const a = r.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || a.county || '';
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const name = r.name || street || city;
    if (!city && r.name && /^(state|region|province|county|island|archipelago|administrative)$/.test(r.addresstype || r.type || '')) a.city = r.name; // a region as a trip destination
    const address = [street && street !== name ? street : '', city, a.state, a.postcode].filter(Boolean).join(', ') || r.display_name;
    return { name, address, display: r.display_name, lat: +(+r.lat).toFixed(5), lon: +(+r.lon).toFixed(5), city: city || a.city || '', region: a.state || '', country: a.country || '', cc: (a.country_code || '').toLowerCase() };
  });
}
async function lookupTZ(lat, lon) {
  const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1&daily=weather_code`, { ttl: 864e5 * 30 });
  return d.timezone;
}

const WMO = (c) => c === 0 ? ['Clear', 'sun'] : c <= 2 ? ['Partly cloudy', 'part'] : c === 3 ? ['Overcast', 'cloud'] : c <= 48 ? ['Fog', 'fog']
  : c <= 57 ? ['Drizzle', 'rain'] : c <= 67 ? ['Rain', 'rain'] : c <= 77 ? ['Snow', 'snow'] : c <= 82 ? ['Showers', 'rain'] : c <= 86 ? ['Snow showers', 'snow'] : ['Thunderstorms', 'storm'];
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  part: '<circle cx="9" cy="9" r="3.4"/><path d="M9 2.6v1.4M2.6 9h1.4M4.5 4.5l1 1M13.5 4.5l-1 1"/><path d="M8.5 19.5h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.4 1.4A2.8 2.8 0 0 0 8.5 19.5z"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.8A3.2 3.2 0 0 0 7 18.5z"/>',
  fog: '<path d="M4 9h16M2.5 13h19M4 17h16"/>',
  rain: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.8A3.2 3.2 0 0 0 7 15z"/><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
  snow: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.8A3.2 3.2 0 0 0 7 14.5z"/><path d="M8 18.5h.01M12 20h.01M16 18.5h.01M10 21.5h.01M14 21.5h.01" stroke-width="2.4"/>',
  storm: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.8A3.2 3.2 0 0 0 7 14.5z"/><path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>'
};
const icon = (k) => `<svg class="wx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ICONS.cloud}</svg>`;

async function weatherFor(cfg) {
  const { lat, lon } = cfg.venue; const tz = cfg.tz || 'auto';
  const s = cfg.start.slice(0, 10); let e = (cfg.end || cfg.start).slice(0, 10);
  if (daysBetween(s, e) > 6) e = addDays(s, 6);
  const today = todayYMD(), horizon = addDays(today, 15);
  const vars = 'temperature_2m_max,temperature_2m_min,weather_code';
  if (s <= horizon && e >= addDays(today, -60)) {
    const ee = e > horizon ? horizon : e;
    const ss = s < addDays(today, -60) ? addDays(today, -60) : s;
    const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${vars},precipitation_probability_max&temperature_unit=fahrenheit&timezone=${enc(tz)}&start_date=${ss}&end_date=${ee}`, { ttl: 3 * 3600e3 });
    return { kind: s < today ? 'recent' : 'forecast', partial: e > horizon, days: d.daily.time.map((t, i) => ({ date: t, hi: d.daily.temperature_2m_max[i], lo: d.daily.temperature_2m_min[i], code: d.daily.weather_code[i], pop: d.daily.precipitation_probability_max?.[i] })) };
  }
  if (e < addDays(today, -60)) {
    const d = await getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=${vars},precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=${enc(tz)}&start_date=${s}&end_date=${e}`, { ttl: 864e5 * 30 });
    return { kind: 'past', days: d.daily.time.map((t, i) => ({ date: t, hi: d.daily.temperature_2m_max[i], lo: d.daily.temperature_2m_min[i], code: d.daily.weather_code[i], precip: d.daily.precipitation_sum[i] })) };
  }
  // Beyond the 16-day forecast: typical weather from the same dates in the previous five complete years.
  const cutoff = addDays(today, -7); const years = [];
  for (let y = +s.slice(0, 4) - 1; years.length < 5 && y > 1990; y--) {
    const ys = `${y}${s.slice(4)}`, ye = `${y + (e.slice(0, 4) - s.slice(0, 4))}${e.slice(4)}`;
    if (ye <= cutoff) years.push([ys, ye, y]);
  }
  const runs = await Promise.all(years.map(([a, b]) => getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=${enc(tz)}&start_date=${a}&end_date=${b}`, { ttl: 864e5 * 30 }).catch(() => null)));
  const ok = runs.filter(Boolean); if (!ok.length) throw new Error('no history');
  const n = daysBetween(s, e) + 1; const days = [];
  for (let i = 0; i < n; i++) {
    const his = [], los = [], wet = [];
    ok.forEach(r => { const hi = r.daily.temperature_2m_max[i], lo = r.daily.temperature_2m_min[i], p = r.daily.precipitation_sum[i]; if (hi != null) his.push(hi); if (lo != null) los.push(lo); if (p != null) wet.push(p >= 0.04); });
    const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    days.push({ date: addDays(s, i), hi: avg(his), lo: avg(los), wet: wet.filter(Boolean).length, of: wet.length });
  }
  const yrs = years.filter((_, i) => runs[i]).map(y => y[2]);
  return { kind: 'typical', from: Math.min(...yrs), to: Math.max(...yrs), days };
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
function osmQuery(lat, lon) {
  const A = (r) => `(around:${r},${lat},${lon})`;
  return `[out:json][timeout:60];(
nwr["amenity"~"^(restaurant|cafe|bar|pub|fast_food)$"]["name"]${A(900)};
nwr["amenity"="pharmacy"]["name"]${A(1200)};
nwr["shop"~"^(supermarket|convenience|greengrocer)$"]["name"]${A(800)};
nwr["tourism"~"^(hotel|hostel|guest_house|motel)$"]["name"]${A(2500)};
nwr["railway"~"^(station|halt|tram_stop)$"]${A(1500)};
node["public_transport"="station"]${A(1500)};
node["highway"="bus_stop"]${A(400)};
nwr["amenity"="bicycle_rental"]${A(700)};
nwr["amenity"="ferry_terminal"]${A(2000)};
nwr["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park)$"]["name"]${A(3000)};
);out center tags;`;
}
const osmKey = (lat, lon) => `osm:${(+lat).toFixed(4)},${(+lon).toFixed(4)}`;
// Hotels, sights and stations around the venue: Google Places first; the OpenStreetMap servers only when Google has no key or refuses it.
async function nearby(lat, lon) {
  if (GKEY && !gpBroken) {
    try { return await gNearbyAll(lat, lon); }
    catch (e) { if (/places 4(00|03|29)/.test(e.message)) gpBroken = true; }
  }
  return osmNearby(lat, lon);
}
async function osmNearby(lat, lon) {
  const key = osmKey(lat, lon);
  const snap = window.OSM_SNAPSHOTS && window.OSM_SNAPSHOTS[key]; if (snap) return snap;
  const c = LS.get('c4:' + key); if (c && Date.now() - c.t < 864e5) return c.d;
  if (memo.has(key)) return memo.get(key);
  const q = osmQuery(lat, lon);
  // Public servers, gently hedged: ask the next server only if the current one fails or is still busy after 12 s.
  const p = new Promise((resolve, reject) => {
    let i = 0, pending = 0, done = false, lastErr;
    const next = () => {
      if (done) return;
      if (i >= OVERPASS.length) { if (!pending) reject(lastErr || new Error('Overpass unavailable')); return; }
      const ep = OVERPASS[i++]; pending++; const hedge = setTimeout(next, 12000);
      getJSON(ep, { key: key + ep, ttl: 0, timeout: 90000, init: { method: 'POST', body: 'data=' + enc(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } })
        .then(d => { clearTimeout(hedge); if (done) return; done = true; const out = classify(d.elements || [], lat, lon); cacheSet(key, out); resolve(out); })
        .catch(e => { clearTimeout(hedge); lastErr = e; pending--; next(); });
    };
    next();
  });
  memo.set(key, p); p.catch(() => memo.delete(key));
  return p;
}
function classify(els, lat, lon) {
  const food = [], places = [], hotels = [], sights = [], transit = { subway: [], rail: [], tram: [], bus: [], bike: [], ferry: [] };
  for (const el of els) {
    const t = el.tags || {}; const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon; if (la == null) continue;
    const d = distM(lat, lon, la, lo);
    const base = { name: t.name || '', wheelchair: t.wheelchair || '', lat: la, lon: lo, d, website: t.website || t['contact:website'] || '', street: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') };
    const more = { city: t['addr:city'] || '', hours: t.opening_hours || '', phone: t.phone || t['contact:phone'] || '' };
    if (/^(restaurant|cafe|bar|pub|fast_food)$/.test(t.amenity)) {
      const diet = {}; ['gluten_free', 'vegan', 'vegetarian', 'halal', 'kosher'].forEach(k => { if (t['diet:' + k]) diet[k] = t['diet:' + k]; });
      const cuisines = (t.cuisine || '').split(';').map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 4);
      food.push({ ...base, ...more, kind: t.amenity === 'pub' ? 'bar' : t.amenity, cuisine: cuisines.slice(0, 2).map(x => x.replace(/_/g, ' ')).join(', '), cuisines, diet,
        price: t['price:range'] || t.price_range || '', outdoor: t.outdoor_seating || '', takeaway: t.takeaway || '' });
    } else if (t.amenity === 'pharmacy') {
      places.push({ ...base, ...more, kind: 'pharmacy' });
    } else if (/^(supermarket|convenience|greengrocer)$/.test(t.shop)) {
      places.push({ ...base, ...more, kind: 'grocery' });
    } else if (/^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park)$/.test(t.tourism)) {
      sights.push({ ...base, kind: t.tourism.replace('_', ' ') });
    } else if (t.tourism) {
      hotels.push({ ...base, kind: t.tourism.replace('_', ' '), stars: t.stars || '' });
    } else if (t.amenity === 'bicycle_rental') {
      transit.bike.push({ ...base, name: t.name || [t.network || t.operator, t.ref].filter(Boolean).join(' ') || 'Bike rental', line: t.network || t.operator || '' });
    } else if (t.amenity === 'ferry_terminal') {
      transit.ferry.push({ ...base, name: t.name || 'Ferry terminal', line: t.operator || '' });
    } else if (t.highway === 'bus_stop') {
      if (t.name) transit.bus.push({ ...base, line: t.route_ref || '' });
    } else if (t.name) {
      const line = t.line || t.route_ref || t.network || '';
      const subway = t.station === 'subway' || t.subway === 'yes';
      const tram = t.railway === 'tram_stop' || t.station === 'light_rail' || t.light_rail === 'yes' || t.tram === 'yes';
      if (subway) transit.subway.push({ ...base, line });
      else if (tram) transit.tram.push({ ...base, line });
      else if (t.railway === 'station' || t.railway === 'halt' || t.train === 'yes') transit.rail.push({ ...base, line });
    }
  }
  const dedupe = (arr, n) => { const seen = new Set(); return arr.sort((a, b) => a.d - b.d).filter(x => { const k = x.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, n); };
  const r = { food: dedupe(food, 150), places: dedupe(places, 40), hotels: dedupe(hotels, 30), sights: dedupe(sights, 12), transit: {} };
  for (const k in transit) r.transit[k] = dedupe(transit[k], k === 'bus' ? 4 : 3);
  return r;
}

// ---------- deep links ----------
const enDay = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(asUTC(d)).replace(',', '');
const L = {
  gflights: (to, from, d1, d2) => `https://www.google.com/travel/flights?q=${enc(`Flights to ${to}${from ? ' from ' + from : ''} on ${d1} through ${d2}`)}`,
  kayak: (from, to, d1, d2) => `https://www.kayak.com/flights/${from}-${to}/${d1}/${d2}`,
  // Google Hotels only honours dates written into the query
  ghotels: (q, d1, d2) => `https://www.google.com/travel/hotels?q=${enc(`${q} hotels ${enDay(d1)} to ${enDay(d2)}`)}`,
  booking: (q, d1, d2, n) => `https://www.booking.com/searchresults.html?ss=${enc(q)}&checkin=${d1}&checkout=${d2}&group_adults=${n}&no_rooms=1`,
  airbnb: (q, d1, d2, n) => `https://www.airbnb.com/s/${enc(q.replace(/, /g, '--').replace(/ /g, '-'))}/homes?checkin=${d1}&checkout=${d2}&adults=${n}`,
  gyg: (q, d1, d2) => `https://www.getyourguide.com/s/?q=${enc(q)}&date_from=${d1}&date_to=${d2}`,
  airbnbExp: (q, d1, d2) => `https://www.airbnb.com/s/${enc(q.replace(/, /g, '--').replace(/ /g, '-'))}/experiences?checkin=${d1}&checkout=${d2}`,
  kayakCars: (iata, d1, d2) => `https://www.kayak.com/cars/${iata}/${d1}/${d2}`,
  rome2rio: (from, to) => `https://www.rome2rio.com/map/${enc(from.replace(/ /g, '-'))}/${enc(to.replace(/ /g, '-'))}`,
  transit: (from, v) => `https://www.google.com/maps/dir/?api=1&origin=${enc(from)}&destination=${v.lat},${v.lon}&travelmode=transit`,
  route: (a, v) => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lon}&destination=${v.lat},${v.lon}&travelmode=driving`,
  dir: (v, mode) => `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lon}&travelmode=${mode}`,
  place: (name, extra) => `https://www.google.com/maps/search/?api=1&query=${enc([name, extra].filter(Boolean).join(', '))}`,
  uber: (v, name) => `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Blatitude%5D=${v.lat}&dropoff%5Blongitude%5D=${v.lon}&dropoff%5Bnickname%5D=${enc(name)}`,
  lyft: (v) => `https://lyft.com/ride?id=lyft&destination%5Blatitude%5D=${v.lat}&destination%5Blongitude%5D=${v.lon}`,
  opentable: (name, v, date, n) => `https://www.opentable.com/s?term=${enc(name)}&latitude=${v.lat}&longitude=${v.lon}&covers=${n}${date ? `&dateTime=${date}T19%3A00` : ''}`,
  gcal: (cfg, url) => {
    const w = eventSpan(cfg); const dates = w.allDay ? `${w.s.replace(/-/g, '')}/${w.e.replace(/-/g, '')}` : `${icsStamp(w.s)}/${icsStamp(w.e)}`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(cfg.title)}&dates=${dates}&details=${enc((cfg.tagline ? cfg.tagline + '\n\n' : '') + url)}&location=${enc(venueLine(cfg.venue))}${cfg.tz ? '&ctz=' + enc(cfg.tz) : ''}`;
  }
};
const LYFT_CC = new Set(['us', 'ca']);
const TRAINLINE_CC = new Set(['gb', 'fr', 'de', 'it', 'es', 'nl', 'be', 'at', 'ch', 'pt', 'ie', 'dk', 'se', 'cz', 'pl', 'lu']);
const venueLine = (v) => v ? [v.name, v.address && !v.address.startsWith(v.name) ? v.address : (v.address && v.address !== v.name ? v.address : '')].filter(Boolean).join(', ') : '';
const placeLabel = (v) => [v.city, v.cc === 'us' ? v.region : v.country].filter(Boolean).join(', ');

// brand lockup: one tilted chain link (three solid sides, the fourth a dotted coral leg back to the start dot), then "1LinkTrip" with a coral 1
const BRAND = '<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><g transform="rotate(-45 20 20)"><path d="M13 27.2 H27 A7.2 7.2 0 0 0 27 12.8 H13" fill="none" stroke="#0F4A50" stroke-width="4.2" stroke-linecap="round"/><path d="M13 12.8 A7.2 7.2 0 0 0 13 27.2" fill="none" stroke="#E35B47" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="0.1 4.4"/><circle cx="13" cy="27.2" r="3.6" fill="#0F4A50"/></g></svg><span class="wm"><span class="one">1</span>LinkTrip</span>';
// ---------- event model ----------
const FONTS = {
  field: { label: 'Classic', css: "'Newsreader', Georgia, serif", gf: null },
  grotesk: { label: 'Modern', css: "'Bricolage Grotesque', system-ui, sans-serif", gf: 'Bricolage+Grotesque:opsz,wght@12..96,400..800' },
  serif: { label: 'Elegant', css: "'Fraunces', Georgia, serif", gf: 'Fraunces:opsz,wght@9..144,400..800' },
  classic: { label: 'Formal', css: "'Cormorant Garamond', Georgia, serif", gf: 'Cormorant+Garamond:wght@500;600;700' },
  condensed: { label: 'Bold', css: "'Big Shoulders Display', 'Arial Narrow', sans-serif", gf: 'Big+Shoulders+Display:wght@600..900' },
  wide: { label: 'Wide', css: "'Unbounded', system-ui, sans-serif", gf: 'Unbounded:wght@400..800' }
};
const TYPES = ['Wedding', 'Conference', 'Concert', 'Performance', 'Race', 'Hyrox', 'Sporting event', 'Festival', 'Bachelor party', 'Bachelorette party', 'Birthday', 'Reunion', 'Retreat', 'Meetup', 'Party', 'Other', 'Trip'];
const TYPE_LABEL = { Trip: 'Vacation / Trip' };
// a trip has a destination instead of a venue, a day-by-day itinerary instead of a schedule, and no RSVP
const isTrip = (cfg) => cfg && cfg.type === 'Trip';
// ---------- type-specific details: fields appear in the editor only for that type; on the page only if filled ----------
// field: [key, label, kind, placeholder]; kinds: text, url, date, time, datetime, place {q,lat,lon}, links [{label,url}], lines
const TYPE_FIELDS = {
  Trip: { name: 'Trip details', fields: [['stops', 'Other stops', 'lines', 'One place per line, e.g. Sintra'], ['companions', 'Travelling together', 'text', 'Names']] },
  Wedding: { name: 'Wedding details', fields: [
    ['rsvp', 'RSVP link', 'url', 'https://…'], ['rsvpBy', 'RSVP by', 'date'], ['dress', 'Dress code', 'text', 'Beach formal'],
    ['registry', 'Registry', 'links'],
    ['blockHotel', 'Room block hotel', 'text', 'Hotel name'], ['blockUrl', 'Room block booking link', 'url', 'https://…'],
    ['blockCode', 'Room block code', 'text', 'Group code'], ['blockBy', 'Book the room block by', 'date']] },
  Race: { name: 'Race day', fields: [
    ['startAt', 'Start', 'place', 'Start line location'], ['finishAt', 'Finish', 'place', 'Finish line location'],
    ['packet', 'Packet pickup', 'text', 'Where'], ['packetWhen', 'Packet pickup time', 'datetime'],
    ['course', 'Course map', 'url', 'Link, GPX or image URL'], ['spots', 'Spectator spots', 'lines', 'One per line'],
    ['closures', 'Road closures', 'text', 'Which roads, and when'], ['closuresUrl', 'Road closures link', 'url', 'https://…']] },
  Concert: { name: 'Show info', fields: [
    ['doors', 'Doors', 'time'], ['opener', 'Opener', 'text', 'Act name'], ['openerAt', 'Opener on at', 'time'],
    ['headliner', 'Headliner', 'text', 'Act name'], ['headlinerAt', 'Headliner on at', 'time'],
    ['setlist', 'Setlist', 'url', 'https://…'], ['bags', 'Bag policy', 'text', 'Clear bags only'],
    ['parking', 'Parking', 'text'], ['pickup', 'Rideshare pickup spot', 'text']] },
  Performance: { name: 'Show info', fields: [
    ['performer', 'Performer', 'text', 'Name'], ['doors', 'Doors', 'time'], ['showtime', 'Showtime', 'time'],
    ['callTime', 'Performer call time', 'time'], ['slot', 'Performer\'s slot', 'text', 'Act 2, no. 14'], ['program', 'Program or run order', 'url', 'https://…'],
    ['tickets', 'Tickets', 'url', 'https://…'], ['flowers', 'Flowers and gifts', 'text', 'Welcome after the show'],
    ['photo', 'Photo and video policy', 'text', 'No flash, no video'], ['parking', 'Parking', 'text']] },
  Hyrox: { name: 'Race day', fields: [
    ['division', 'Division', 'text', 'Open, Pro, Doubles or Relay'], ['wave', 'Wave start', 'time'],
    ['checkin', 'Check-in and wristband pickup', 'text', 'Where'], ['checkinWhen', 'Check-in time', 'datetime'],
    ['bagdrop', 'Bag drop', 'text', 'Where, what to leave'], ['spectators', 'Spectator info', 'text', 'Tickets, where to watch'],
    ['results', 'Live results', 'url', 'https://…'], ['parking', 'Parking', 'text']] },
  'Sporting event': { name: 'Game day', fields: [
    ['seating', 'Seating chart', 'url', 'https://…'], ['teams', 'Teams', 'links'],
    ['tailgate', 'Tailgating', 'text'], ['parking', 'Parking', 'text'], ['bags', 'Bag policy', 'text', 'Clear bags only']] },
  Conference: { name: 'Attending', fields: [
    ['badge', 'Badge pickup', 'text', 'Where'], ['badgeWhen', 'Badge pickup time', 'datetime'],
    ['agenda', 'Full agenda', 'url', 'https://…'], ['speakers', 'Speakers', 'lines', 'One per line: Name, talk']] }
};
const typeSpec = (cfg) => TYPE_FIELDS[cfg.type] || null;
const typeData = (cfg) => (cfg.x && cfg.x[cfg.type]) || {};
const filled = (kind, val) => kind === 'links' ? (val || []).some(l => l.label && l.url) : kind === 'place' ? !!(val && val.q) : !!(val && String(val).trim());
const hasTypeInfo = (cfg) => { const sp = typeSpec(cfg), d = typeData(cfg); return !!sp && sp.fields.some(([k, , kind]) => filled(kind, d[k])); };
const LAGOON = '#0F4A50'; // default accent (brand Lagoon); replaced the earlier Forest #1F3A2E
const SWATCHES = [LAGOON, '#0B7A75', '#FF6B35', '#C2185B', '#6D28D9', '#B8860B', '#1F2937', '#2E7D32'];

const packEvent = (c) => LZString.compressToEncodedURIComponent(JSON.stringify(c));
function unpackEvent(s) { try { const j = LZString.decompressFromEncodedURIComponent(s); return j ? normalize(JSON.parse(j)) : null; } catch { return null; } }
const shareURL = (c) => `${location.origin}${location.pathname}#e=${packEvent(c)}`;

function loadFont(key) {
  const f = FONTS[key]; if (!f || !f.gf || document.querySelector(`link[data-font="${key}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.font = key;
  l.href = `https://fonts.googleapis.com/css2?family=${f.gf}&display=swap`; document.head.appendChild(l);
}
function onAccent(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff';
  const n = parseInt(m[1], 16), ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.36 ? '#111318' : '#ffffff';
}
const themeStyle = (t) => `--accent:${t.accent};--on-accent:${onAccent(t.accent)};--display:${FONTS[t.font]?.css || FONTS.field.css}`;

// ---------- ICS ----------
function icsText(cfg, url) {
  const escI = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = (line) => { const out = []; let cur = ''; for (const ch of line) { if (new Blob([cur + ch]).size > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch; } out.push(cur); return out.join('\r\n'); };
  const now = icsStamp(new Date()); const uidBase = Math.abs([...cfg.title + cfg.start].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
  const ev = (uid, title, s, e, desc, loc) => ['BEGIN:VEVENT', `UID:${uid}-${uidBase}@eventpages`, `DTSTAMP:${now}`, ...(typeof s === 'string' ? [`DTSTART;VALUE=DATE:${s.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${e.replace(/-/g, '')}`] : [`DTSTART:${icsStamp(s)}`, `DTEND:${icsStamp(e)}`]), `SUMMARY:${escI(title)}`, `LOCATION:${escI(loc || venueLine(cfg.venue))}`, `DESCRIPTION:${escI(desc)}`, `URL:${url}`, 'END:VEVENT'];
  const { s, e } = eventSpan(cfg);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//1LinkTrip//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escI(cfg.title)}`];
  lines.push(...ev('main', cfg.title, s, e, [cfg.tagline, url].filter(Boolean).join('\n\n')));
  cfg.schedule.filter(x => x.date && x.time && x.title).forEach((x, i) => {
    const st = wallToUTC(`${x.date}T${x.time}`, schedZone(x) || cfg.tz); // a flight line's time is local at its airport
    lines.push(...ev('s' + i, `${x.title} · ${cfg.title}`, st, new Date(st.getTime() + 3600e3), [rtPlain(x.note), url].filter(Boolean).join('\n\n'), x.place ? [x.place.name, x.place.address !== x.place.name ? x.place.address : ''].filter(Boolean).join(', ') : ''));
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n');
}
function downloadICS(cfg) {
  const blob = new Blob([icsText(cfg, location.href)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = (cfg.title || 'event').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.ics';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- event page rendering ----------
const ext = (href, label, cls = 'btn') => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const arrow = '<svg class="arr" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11L11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
let renderSeq = 0;
const maps = new Set();

const loading = (what) => `<div class="skel" role="status"><span></span><span></span><span></span><em>${t('Loading {w}…', { w: what })}</em><em class="slow">${t('The map servers are busy. This can take up to a minute.')}</em></div>`;

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function typeInfoHTML(cfg, opt = {}) {
  const sp = typeSpec(cfg) || { fields: [] }, d = typeData(cfg); const R = rsvpOf(cfg);
  const v = cfg.venue; const lab = Object.fromEntries(sp.fields.map(([k, l]) => [k, l]));
  const has = (k) => { const f = sp.fields.find(x => x[0] === k); return f && filled(f[2], d[k]); };
  const dt = (s) => s ? (s.length > 10 ? `${fmt(s.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(s.slice(11, 16))}` : fmt(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })) : '';
  const linkRow = (label, url, sub) => `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><b>${esc(t(label))}</b><span>${esc(sub || hostOf(url))}</span>${arrow}</a></li>`;
  const noteRow = (label, text) => `<li class="note"><b>${esc(t(label))}</b><span>${esc(text)}</span></li>`;
  const placeURL = (p) => p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}` : L.place(p.q, v ? placeLabel(v) : '');
  const rows = []; const out = [];
  // time-line style rows (concert running order)
  const tl = [];
  if (has('callTime')) tl.push([d.callTime, t('Performer call time')]);
  if (has('doors')) tl.push([d.doors, t('Doors')]);
  if (has('showtime')) tl.push([d.showtime, t('Showtime')]);
  if (has('wave')) tl.push([d.wave, t('Wave start')]);
  if (has('openerAt') || has('opener')) tl.push([d.openerAt || '', d.opener || t(lab.opener)]);
  if (has('headlinerAt') || has('headliner')) tl.push([d.headlinerAt || '', d.headliner || t(lab.headliner)]);
  if (ONP) tl.forEach(x => { x[2] = ['callTime', 'doors', 'showtime', 'wave', 'openerAt', 'headlinerAt'].find(k => has(k) && d[k] === x[0]) || (x[1] === d.opener ? 'opener' : x[1] === d.headliner ? 'headliner' : 'doors'); });
  if (tl.length) out.push(`<ol class="tl">${tl.sort((a, b) => (a[0] || '99').localeCompare(b[0] || '99')).map(([tm, n, ek]) => `<li${ek ? edA('x:' + ek) : ''}><time>${esc(fmtTime(tm)) || '—'}</time><div><b>${esc(n)}</b></div></li>`).join('')}</ol>`);
  for (const [k, label, kind] of sp.fields) {
    if (['stops', 'doors', 'opener', 'openerAt', 'headliner', 'headlinerAt', 'rsvp', 'rsvpBy', 'blockHotel', 'blockUrl', 'blockCode', 'blockBy', 'packetWhen', 'badgeWhen', 'checkinWhen', 'callTime', 'showtime', 'wave', 'closuresUrl', 'spots', 'speakers'].includes(k) || !filled(kind, d[k])) continue;
    const val = d[k]; const r0 = rows.length, o0 = out.length;
    if (k === 'course' && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(val)) out.push(`<a class="course-img" href="${esc(val)}" target="_blank" rel="noopener noreferrer"><img src="${esc(val)}" alt="${t('Course map')}" loading="lazy" referrerpolicy="no-referrer"></a>`);
    else if (k === 'course') rows.push(linkRow('Course map', val, /\.gpx(\?|$)/i.test(val) ? t('GPX file') : ''));
    else if (k === 'closures') rows.push(d.closuresUrl ? linkRow('Road closures', d.closuresUrl, val) : noteRow('Road closures', val));
    else if (k === 'packet' || k === 'badge' || k === 'checkin') { const w = d[k + 'When']; rows.push(`<li><a href="${esc(L.place(val, v ? placeLabel(v) : ''))}" target="_blank" rel="noopener noreferrer"><b>${esc(t(label))}</b><span>${esc([val, dt(w)].filter(Boolean).join(' · '))}</span>${arrow}</a></li>`); }
    else if (kind === 'place') rows.push(`<li><a href="${esc(placeURL(val))}" target="_blank" rel="noopener noreferrer"><b>${esc(t(label))}</b><span>${esc(val.q)}</span>${arrow}</a></li>`);
    else if (kind === 'links') val.filter(l => l.label && l.url).forEach(l => rows.push(linkRow(label === 'Teams' || l.label.toLowerCase() === label.toLowerCase() ? l.label : `${label} · ${l.label}`, l.url)));
    else if (kind === 'url') rows.push(linkRow(label, val));
    else rows.push(noteRow(label, val));
    if (ONP) { for (let j = r0; j < rows.length; j++) rows[j] = rows[j].replace(/^<li/, '<li' + edA('x:' + k)); for (let j = o0; j < out.length; j++) out[j] = out[j].replace(/^<a/, '<a' + edA('x:' + k)); }
  }
  const tagLast = (k) => { if (ONP) rows[rows.length - 1] = rows[rows.length - 1].replace(/^<li/, '<li' + edA('x:' + k)); };
  if (!has('packet') && has('packetWhen')) { rows.push(noteRow('Packet pickup', dt(d.packetWhen))); tagLast('packetWhen'); }
  if (!has('badge') && has('badgeWhen')) { rows.push(noteRow('Badge pickup', dt(d.badgeWhen))); tagLast('badgeWhen'); }
  if (!has('checkin') && has('checkinWhen')) { rows.push(noteRow('Check-in and wristband pickup', dt(d.checkinWhen))); tagLast('checkinWhen'); }
  // RSVP (any type): the organizer's own link, or the reply-by date when replies come in through the form
  if (R.on && (R.via === 'link' || R.by)) { const by = R.by ? t('Reply by {d}', { d: dt(R.by) }) : ''; rows.unshift((R.via === 'link' ? linkRow('RSVP', R.url, by) : noteRow('RSVP', by)).replace(/^<li/, '<li' + edA('sec:rsvp'))); }
  if (!has('closures') && has('closuresUrl')) { rows.push(linkRow('Road closures', d.closuresUrl)); tagLast('closuresUrl'); }
  if (rows.length) out.push(`<ul class="links">${rows.join('')}</ul>`);
  if (opt.mine && ['blockHotel', 'blockUrl', 'blockCode', 'blockBy'].some(has)) out.push(`<ul class="links block-know mi-know"><li class="note"><b>${esc(t('Your hotel'))}</b><span>${esc([opt.mine.name, opt.mine.when].filter(Boolean).join(' · '))}</span></li></ul>`); // Make it mine: staying elsewhere
  else if (['blockHotel', 'blockUrl', 'blockCode', 'blockBy'].some(has)) {
    const sub = [d.blockCode ? t('Code {c}', { c: d.blockCode }) : '', d.blockRoom || '', blockByText(d.blockBy, dt), blockCancelText(d)].filter(Boolean).join(' · ');
    // Travel → Where to stay has the room block too: here it is one compact row (hotel, code, book-by), same plain link
    const line = [d.blockHotel, sub].filter(Boolean).join(' · ');
    if (opt.skipBlock) out.push(`<ul class="links block-know"${edA('x:blockHotel')}>${d.blockUrl ? linkRow('Room block', d.blockUrl, line || hostOf(d.blockUrl)) : noteRow('Room block', line)}</ul>`);
    else out.push(`<h3 class="sub-h">${t('Room block')}</h3><ul class="links"${edA('x:blockHotel')}>${d.blockUrl ? linkRow(d.blockHotel || t('Book the room block'), d.blockUrl, sub || hostOf(d.blockUrl)) : noteRow(d.blockHotel || t('Room block'), sub)}</ul>`);
  }
  const lines = (k) => String(d[k] || '').split('\n').map(x => x.trim()).filter(Boolean);
  if (has('stops')) out.push(`<h3 class="sub-h">${esc(t(lab.stops))}</h3><ul class="links">${lines('stops').map(x => `<li><a href="${esc(L.place(x, v ? (v.country || '') : ''))}" target="_blank" rel="noopener noreferrer"><b>${esc(x)}</b><span>Google Maps</span>${arrow}</a></li>`).join('')}</ul>`);
  if (has('spots')) out.push(`<h3 class="sub-h">${esc(t(lab.spots))}</h3><ul class="links"${edA('x:spots')}>${lines('spots').map(x => `<li><a href="${esc(L.place(x, v ? placeLabel(v) : ''))}" target="_blank" rel="noopener noreferrer"><b>${esc(x)}</b><span>Google Maps</span>${arrow}</a></li>`).join('')}</ul>`);
  if (has('speakers')) out.push(`<h3 class="sub-h">${esc(t(lab.speakers))}</h3><ul class="links"${edA('x:speakers')}>${lines('speakers').map(x => { const [n, ...r] = x.split(/\s+[—–-]\s+|,\s+/); return `<li class="note"><b>${esc(n)}</b>${r.length ? `<span>${esc(r.join(', '))}</span>` : ''}</li>`; }).join('')}</ul>`);
  return out.join('');
}
// ---------- my itinerary (guest-side, stays in this browser) ----------
// parseReservation is the single seam: today heuristics, later a server/AI importer can replace it with the same output shape.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const AIRLINES = {
  UA: ['United', 'https://www.united.com/en/us/manageres/mytrips'], AA: ['American', 'https://www.aa.com/reservation/view/find-your-trip'],
  DL: ['Delta', 'https://www.delta.com/my-trips/search'], WN: ['Southwest', 'https://www.southwest.com/air/manage-reservation/'],
  B6: ['JetBlue', 'https://www.jetblue.com/manage-trips'], AS: ['Alaska', 'https://www.alaskaair.com/booking/reservation-lookup'],
  AC: ['Air Canada', 'https://www.aircanada.com/us/en/aco/home/book/manage-bookings.html'], BA: ['British Airways', 'https://www.britishairways.com/travel/managebooking/public/en_us'],
  AM: ['Aeromexico', 'https://www.aeromexico.com/en-us/manage-your-booking'], LH: ['Lufthansa', 'https://www.lufthansa.com/us/en/my-bookings'],
  NK: ['Spirit', ''], F9: ['Frontier', ''], Y4: ['Volaris', ''], VB: ['Viva Aerobus', ''], AF: ['Air France', ''], KL: ['KLM', ''], HA: ['Hawaiian', ''], WS: ['WestJet', '']
};
const AIRLINE_NAMES = Object.entries(AIRLINES).map(([c, [n]]) => [c, n]);
const VENDORS = [
  [/airbnb/i, 'stay', 'Airbnb'], [/vrbo/i, 'stay', 'Vrbo'],
  [/hertz/i, 'car', 'Hertz'], [/\bavis\b/i, 'car', 'Avis'], [/enterprise rent|enterprise\.com|\benterprise\b.*(rental|car)/i, 'car', 'Enterprise'], [/budget (rent|car)|budget\.com/i, 'car', 'Budget'],
  [/national car|nationalcar\.com/i, 'car', 'National'], [/\bsixt\b/i, 'car', 'Sixt'], [/\balamo\b/i, 'car', 'Alamo'], [/thrifty/i, 'car', 'Thrifty'], [/\bturo\b/i, 'car', 'Turo'],
  [/opentable/i, 'food', 'OpenTable'], [/\bresy\b/i, 'food', 'Resy'], [/exploretock|\btock\b/i, 'food', 'Tock'],
  [/amtrak/i, 'train', 'Amtrak'], [/eurostar/i, 'train', 'Eurostar'], [/trainline/i, 'train', 'Trainline'], [/\bsncf\b/i, 'train', 'SNCF'], [/\brenfe\b/i, 'train', 'Renfe'], [/via rail/i, 'train', 'VIA Rail'],
  [/marriott/i, 'hotel', 'Marriott'], [/hilton/i, 'hotel', 'Hilton'], [/hyatt/i, 'hotel', 'Hyatt'], [/\bihg\b|holiday inn/i, 'hotel', 'IHG'], [/booking\.com/i, 'hotel', 'Booking.com'], [/hotels\.com/i, 'hotel', 'Hotels.com'], [/expedia/i, 'hotel', 'Expedia']
];
const ITIN_KINDS = { flight: 'Flight', hotel: 'Hotel', stay: 'Rental home', car: 'Rental car', food: 'Restaurant', train: 'Train', bus: 'Bus', taxi: 'Taxi or rideshare', ferry: 'Ferry', tour: 'Tour or activity', other: 'Other' };

// "Deluxe Room, 1 King Bed" → ['Deluxe Room', '1 King Bed']; a room without a trailing bed part stays as it is
const roomBedSplit = (room) => { const m = String(room || '').match(/^(.+?)\s*[,·–]\s*((?:\d+\s*x?\s*)?(?:king|queen|double|twin|single|full)(?:[- ]size)?\s*(?:beds?)?)\s*$/i); return m ? [m[1].trim(), m[2].trim()] : [String(room || '').trim(), '']; };
function parseReservation(text, refDate) {
  const raw = String(text || ''); const r = { kind: '', name: '', start: '', end: '', address: '', confNo: '', link: '', flight: '', note: '', ...(viaGuess(raw) ? { via: viaGuess(raw) } : {}) };
  if (!raw.trim()) return r;
  const lines = raw.split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const url = raw.match(/https?:\/\/[^\s<>"')]+/i); if (url) r.link = url[0].replace(/[.,;]+$/, '');
  const host = r.link ? hostOf(r.link) : '';
  // vendor + kind
  const vendor = VENDORS.find(([re]) => re.test(raw) || (host && re.test(host)));
  const fl = raw.match(/\b(?:flight|flt)\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9]{2})\s?(\d{1,4})\b/i) || raw.match(/\b(UA|AA|DL|WN|B6|AS|AC|BA|AM|LH|NK|F9|Y4|VB|AF|KL|HA|WS)\s?(\d{1,4})\b/);
  if (fl && AIRLINES[fl[1].toUpperCase()]) { r.kind = 'flight'; r.flight = fl[1].toUpperCase() + ' ' + fl[2]; }
  else if (fl && /\bflight\b/i.test(raw)) { r.kind = 'flight'; r.flight = fl[1].toUpperCase() + ' ' + fl[2]; }
  else if (vendor) r.kind = vendor[1];
  else if (/\b(rental car|car rental|pick[- ]?up location|drop[- ]?off)\b/i.test(raw)) r.kind = 'car';
  else if (/\b(table for|party of|reservation at|covers?)\b/i.test(raw)) r.kind = 'food';
  else if (/\b(train|coach \d|platform|rail)\b/i.test(raw)) r.kind = 'train';
  else if (/\b(check[- ]?in|check[- ]?out|hotel|room|nights?)\b/i.test(raw)) r.kind = 'hotel';
  // name
  const lab = (re) => { for (const l of lines) { const m = l.match(re); if (m && m[1].trim()) return m[1].trim(); } return ''; };
  if (r.kind === 'flight') { const a = AIRLINES[r.flight.split(' ')[0]]; r.name = [a ? a[0] : '', r.flight].filter(Boolean).join(' '); }
  else r.name = lab(/^(?:hotel|property|restaurant|listing|accommodation|venue)\s*(?:name)?\s*[:\-–]\s*(.+)$/i)
    || ((raw.match(/\b(?:reservation|table|booking|stay) at ([A-Z][^\n,.!]{2,60})/) || [])[1] || '').replace(/\s+(is|has been|was)\b.*$/i, '').trim()
    || (r.kind === 'hotel' ? lines.find(l => l.length < 70 && /\b(hotel|inn|resort|suites|lodge)\b/i.test(l) && !/confirm|reservation|check/i.test(l)) || '' : '')
    || (r.kind === 'car' ? lab(/^pick[- ]?up location\s*[:\-–]\s*(.+)$/i) : '')
    || (vendor ? vendor[2] : '');
  // confirmation number
  for (const cm of raw.matchAll(/\b(?:confirmation|conf\.|booking|reservation|record locator|pnr|itinerary)\b\s*(?:number|no\.?|code|#|id)?\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]{4,})\b/gi)) {
    if (/\d/.test(cm[1]) || /^[A-Z]{6}$/.test(cm[1])) { r.confNo = cm[1].toUpperCase(); break; }
  }
  // address: labelled, else a street-looking line
  const ai = lines.findIndex(l => /^(address|location)\s*:?$/i.test(l));
  r.address = lab(/^(?:address|location|pick[- ]?up location)\s*[:\-–]\s*(.+\d.+)$/i)
    || (ai >= 0 && lines[ai + 1] && lines[ai + 1].length < 120 ? lines[ai + 1] : '')
    || lines.find(l => /^(carretera|calle|avenida|av\.|rue|via|camino)\b|\bkm\s*\d/i.test(l) && /\d/.test(l) && l.length < 120 && !/confirm|reserv/i.test(l))
    || lines.find(l => /^\d+[A-Za-z]?\s+[\w .'-]+\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|pl|place|plaza|pkwy|parkway|hwy|highway|carretera|calle|av\.?)\b/i.test(l) && l.length < 120) || '';
  // dates and times
  const ref = refDate ? asUTC(refDate) : new Date();
  const mk = (y, mo, d) => { if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return ''; if (!y) { const cands = [ref.getUTCFullYear() - 1, ref.getUTCFullYear(), ref.getUTCFullYear() + 1].map(yy => `${yy}-${pad(mo)}-${pad(d)}`); return cands.sort((a, b) => Math.abs(asUTC(a) - ref) - Math.abs(asUTC(b) - ref))[0]; } return `${y < 100 ? 2000 + y : y}-${pad(mo)}-${pad(d)}`; };
  const DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?|\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?(?:\s+(\d{4}))?|\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b|\b(\d{1,2})(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d{2}(?:\d{2})?)?\b/gi; // last: airline style 25APR, 25APR27
  const datesIn = (l) => [...l.matchAll(DATE_RE)].map(m => m[1] ? mk(+m[1], +m[2], +m[3]) : m[4] ? mk(+m[6] || 0, MONTHS.indexOf(m[4].toLowerCase()) + 1, +m[5]) : m[8] ? mk(+m[9] || 0, MONTHS.indexOf(m[8].toLowerCase()) + 1, +m[7]) : m[13] ? mk(+m[15] || 0, MONTHS.indexOf(m[14].toLowerCase()) + 1, +m[13]) : mk(+m[12], +m[10], +m[11])).filter(Boolean);
  const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?![a-z])|\b(noon)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  const timesIn = (l) => [...l.matchAll(TIME_RE)].map(m => { if (m[4]) return '12:00'; if (m[3]) { let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12; return `${pad(h)}:${m[2] || '00'}`; } return `${pad(+m[5])}:${m[6]}`; });
  const dateIn = (l) => datesIn(l)[0] || '', timeIn = (l) => timesIn(l)[0] || '';
  const START = /check[- ]?in|pick[- ]?up(?! location)|\bdepart(s|ure|ing)?\b|\bleaves?\b|boarding|reservation (date|time)|^date\b|^when\b|^time\b/i;
  const END = /check[- ]?out|drop[- ]?off|\breturn\b|\barriv(al|es|e|ing)\b|^until\b/i;
  const labelled = (l) => START.test(l) || END.test(l);
  const grab = (isStart) => {
    const re = isStart ? START : END; let lastDate = '';
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]; const m = l.match(re);
      if (!m) { lastDate = dateIn(l) || lastDate; continue; }
      const sm = l.match(START), em = l.match(END);
      const both = sm && em; const col = both && !isStart && sm.index < em.index ? 1 : 0;
      // the part of the line that belongs to this label
      let seg = l.slice(m.index); if (both) { const other = isStart ? em : sm; if (other.index > m.index) seg = l.slice(m.index, other.index); }
      const next = [lines[i + 1], lines[i + 2]].filter(x => x && !labelled(x));
      const d = dateIn(seg) || (next.map(datesIn).find(x => x.length > col) || [])[col] || lastDate;
      const t = timeIn(seg) || (next.map(timesIn).find(x => x.length > col) || [])[col] || '';
      if (d) return d + (t ? 'T' + t : '');
      lastDate = dateIn(l) || lastDate;
    }
    return '';
  };
  r.start = grab(true); r.end = grab(false);
  if (!r.start) { // fall back to the first dated line, second dated line as the end
    const ds = []; lines.forEach(l => { const d = dateIn(l); if (d) ds.push(d + (timeIn(l) ? 'T' + timeIn(l) : '')); });
    if (ds[0]) r.start = ds[0]; if (!r.end && ds[1] && ds[1] !== ds[0]) r.end = ds[1];
  }
  if (r.end && r.start && r.end < r.start) r.end = '';
  // a hotel's room category and free-cancellation deadline (or non-refundable), when the text says so
  if (r.kind === 'hotel' || r.kind === 'stay') {
    let room = lab(/^(?:room(?:\s+(?:type|category))?|accommodation(?:\s+type)?|unit(?:\s+type)?)\s*[:\-–]\s*(.+)$/i); let bed = lab(/^beds?(?:\s+type)?\s*[:\-–]\s*(.+)$/i);
    const split = roomBedSplit(room); room = split[0]; if (!bed) bed = split[1];
    if (room && !/^\d+$/.test(room) && room.length <= 80) detSet(r, 'room', room);
    if (bed && bed.length <= 60) detSet(r, 'beds', bed);
    if (/\bnon[- ]?refundable\b|\bno refunds?\b|\bcannot be cancell?ed\b/i.test(raw) && !/\bfree cancell?ation\b/i.test(raw)) detSet(r, 'nonRef', 1);
    else { const i = lines.findIndex(l => /free cancell?ation|cancel (?:for free|free of charge|without (?:charge|penalty|a fee))|cancell?ation deadline|cancel (?:by|before|until)/i.test(l));
      if (i >= 0) { const seg = lines[i].replace(/^.*?(cancel)/i, '$1'); const d = dateIn(seg) || (lines[i + 1] && !labelled(lines[i + 1]) ? dateIn(lines[i + 1]) : ''); const tm = dateIn(seg) ? timeIn(seg) : timeIn(lines[i + 1] || '');
        if (d) detSet(r, 'cancelBy', d + (tm ? 'T' + tm : '')); } }
  }
  return r;
}
const itinKey = (cfg) => 'itin:' + eventKey(cfg).slice(6);
// example pages carry a sample My trip (cfg.demoTrip): shown until the visitor changes it, then their own copy is kept
// under the example's key (never a real trip's); an edited copy of an example never takes it along (renderBuilder)
const demoOf = (cfg, k) => cfg && cfg.demoTrip && cfg.demoTrip[k] ? clone(cfg.demoTrip[k]) : null;
const itinLoad = (cfg) => (LS.get(itinKey(cfg), null) ?? demoOf(cfg, 'itin') ?? []).map(flightArriveFix);
// ---- flight arrival day: departure and arrival are local wall times at two airports, so "lands the next day" depends on
// both time zones (HND→JFK eastbound over the date line lands the same calendar day; LAX→SYD two days later). ----
let AP_TZ_MAP = null;
const apZone = (code) => { if (!AP_TZ_MAP) { AP_TZ_MAP = {}; for (const [z, cs] of Object.entries(window.AIRPORT_TZ || {})) cs.split(' ').forEach(c => { AP_TZ_MAP[c] = z; }); } return AP_TZ_MAP[String(code || '').trim().toUpperCase()] || ''; };
const zonedMs = (local, z) => wallToUTC(local, z).getTime(); // a local wall time in zone z → UTC ms
// a flight's departure / arrival airport codes: its own fields, else "HND → JFK" in the name or note
function flightAirports(x) {
  const code = (s) => { const m = String(s || '').toUpperCase().match(/\b[A-Z]{3}\b/g) || []; return m.find(c => apZone(c)) || ''; };
  const pair = String([x.note, x.name].join(' ')).match(/\b([A-Z]{3})\s*(?:→|->|–|—|-|to)\s*([A-Z]{3})\b/);
  return [code(x.from) || (pair && apZone(pair[1]) ? pair[1] : ''), code(x.to) || (pair && apZone(pair[2]) ? pair[2] : '')];
}
// Keeps an arrival date that gives a plausible flight (30 min – 20 h); otherwise picks the arrival day (−1 … +2 from
// departure) that does. Unknown airports or no times: unchanged.
function flightArriveFix(x) {
  if (!x || x.kind !== 'flight' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x.start || '') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x.end || '')) return x;
  const [fa, ta] = flightAirports(x); const zf = apZone(fa), zt = apZone(ta); if (!zf || !zt) return x;
  try {
    const dep = zonedMs(x.start, zf); const hm = x.end.slice(11, 16); const dur = (d) => (zonedMs(d + 'T' + hm, zt) - dep) / 3600e3; const ok = (h) => h >= 0.5 && h <= 20;
    if (ok(dur(x.end.slice(0, 10)))) return x;
    const d = [-1, 0, 1, 2].map(k => addDays(x.start, k)).filter(d => ok(dur(d))).sort((a, b) => dur(a) - dur(b))[0];
    return d ? { ...x, end: d + 'T' + hm } : x;
  } catch { return x; }
}
// "Arrives 10:55 PM", with (+1) / (−1) when it lands on another calendar day than it left
// ---- the organizer's own flight lines ("Depart Tokyo Haneda (HND) on UA 7924" 22:45 · "Arrive New York JFK" 22:55): each
// time is the local wall time at THAT airport, not at the event. An arrival line's day is checked against the departure line
// before it the same way as a booking (stated "13h 10m" duration wins, else a 30 min – 20 h flight), so HND→JFK lands the
// same calendar day and JFK→HND the next. Codes must be written in capitals ("JFK", "(HND)", "HND → JFK"). ----
const SCHED_ARR = /^\s*(arrive|arrives|arrival|arriving|land|lands|landing)\b/i;
const SCHED_DEP = /^\s*(depart|departs|departure|departing|fly|flying|flight|take[- ]?off)\b/i;
const schedCodes = (x) => (String(x.title || '').match(/\b[A-Z]{3}\b/g) || []).filter(c => apZone(c));
// the airport a flight line's time is local to: departure line → first code, arrival line → last code; else ''
const schedAirport = (x) => { if (!x || !x.title) return ''; const cs = schedCodes(x); return !cs.length ? '' : SCHED_ARR.test(x.title) ? cs[cs.length - 1] : SCHED_DEP.test(x.title) ? cs[0] : ''; };
const schedZone = (x) => apZone(schedAirport(x));
const durHours = (s) => { const m = /(\d{1,2})\s*h(?:ours?|rs?)?\s*(?:(\d{1,2})\s*m)?/i.exec(String(s || '')); return m && /duration|flight time|nonstop|\d\s*h\s*\d+\s*m/i.test(s) ? +m[1] + (+m[2] || 0) / 60 : null; };
function schedFlightFix(sch) {
  const hhmm = /^\d{2}:\d{2}$/; const dated = (x) => x && isoDay(x.date) && hhmm.test(x.time || '');
  sch.forEach(a => {
    if (!dated(a) || !SCHED_ARR.test(a.title || '')) return; const ta = schedAirport(a), zt = apZone(ta); if (!zt) return;
    const deps = sch.filter(d => d !== a && dated(d) && SCHED_DEP.test(d.title || '') && schedAirport(d) && schedAirport(d) !== ta && Math.abs(daysBetween(d.date, a.date)) <= 3)
      .sort((p, q) => Math.abs(daysBetween(p.date, a.date)) - Math.abs(daysBetween(q.date, a.date)) || (q.date + q.time).localeCompare(p.date + p.time));
    const d = deps[0]; if (!d) return;
    try {
      const dep = zonedMs(`${d.date}T${d.time}`, schedZone(d)); const dur = (day) => (zonedMs(`${day}T${a.time}`, zt) - dep) / 3600e3;
      const want = durHours(a.note) ?? durHours(d.note) ?? durHours(d.title);
      const fit = want != null ? (h) => Math.abs(h - want) <= 1.5 : (h) => h >= 0.5 && h <= 20;
      if (fit(dur(a.date))) return;
      const day = [-1, 0, 1, 2].map(k => addDays(d.date, k)).filter(x => fit(dur(x))).sort((p, q) => dur(p) - dur(q))[0];
      if (day) a.date = day;
    } catch { /* unknown zone: unchanged */ }
  });
  return sch;
}
const flightArrLabel = (x) => { if (!x.end || x.end.length < 16) return ''; const off = daysBetween(x.start, x.end); return `${t('Arrives')} ${fmtTime(x.end.slice(11, 16))}${off ? ` (${off > 0 ? '+' : '−'}${Math.abs(off)})` : ''}`; };
// "Flying into": the guest's arrival airport, one of the airports near the venue. One saved value per event (ap:<key>).
// Default: their saved pick → a flight in their bookings that lands at one of them → the organizer's "Fly into" (cfg.flyInto)
// → the automatic pick (nearestAirports: a hub near the closest large airport, not across the water) → the closest large → the closest.
const apKey = (cfg) => 'ap:' + eventKey(cfg).slice(6);
// cfg.flyInto === 'none': the organizer turned flying off — no airports anywhere (ticket shows the date, Travel leads with
// driving/transit/train and keeps one plain flight search to the city)
const noFly = (cfg) => cfg.flyInto === 'none';
const airFor = (cfg) => cfg.venue && !noFly(cfg) ? nearestAirports(cfg.venue.lat, cfg.venue.lon, cfg.flyInto) : [];
function flightArrival(air, items) {
  const low = (x) => String(x || '').toLowerCase();
  const hit = (s) => air.find(a => new RegExp(`\\b${a.iata}\\b`).test(String(s || '')) || low(s).includes(low(a.name)) || (a.city && low(s).includes(low(a.city))));
  const fl = (items || []).filter(x => x && x.kind === 'flight').sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
  for (const x of fl) { const m = String(x.note || '').match(/→\s*([^·]+)/); const a = (x.to && hit(x.to)) || (m && hit(m[1])); if (a) return a; }
  for (const x of fl) { const a = hit([x.name, x.address, x.note].join(' ')); if (a) return a; }
  return null;
}
function pickAirport(air, saved, items) {
  if (!air || !air.length) return null;
  return air.find(a => a.iata === saved) || flightArrival(air, items) || (air.def && air.find(a => a.iata === air.def)) || air.find(a => a.large) || air[0];
}
const chosenAirport = (cfg, air = airFor(cfg)) => pickAirport(air, LS.get(apKey(cfg)), itinLoad(cfg));
// My trip's "Flying into": only once the guest is flying — they picked an airport or have a flight in their bookings
const apMineHTML = (cfg, air, items = itinLoad(cfg)) => air.length && (LS.get(apKey(cfg)) || items.some(x => x && x.kind === 'flight')) ? airportSelHTML(cfg, air, chosenAirport(cfg, air), true) : '';
const canAddTrip = (cfg) => !!(cfg.tools && cfg.tools.mytrip && cfg.start);
// a prefilled booking card in My trip (the guest adds the confirmation later)
const addTripBtn = (cfg, kind, place, label) => canAddTrip(cfg) ? `<div class="add-trip"><button type="button" class="mini-b" data-addtrip="${kind}" data-at-place="${esc(place)}" data-at-label="${esc(label)}">+ ${t('Add to my trip')}</button></div>` : '';
function airportSelHTML(cfg, air, ap, always) {
  if (!ap || (air.length < 2 && !always)) return '';
  const v = cfg.venue;
  if (air.length < 2) return `<p class="ap-sel"><span>${t('Flying into')}</span> <b>${esc(ap.iata)}</b> ${esc(ap.name)}</p>`;
  return `<label class="pf-sel ap-sel"><span>${t('Flying into')}</span><select data-ap-sel>${air.map(a => `<option value="${esc(a.iata)}"${a.iata === ap.iata ? ' selected' : ''}>${esc(`${a.iata} · ${a.city || a.name} · ${fmtDist(a.d, v.cc)}`)}</option>`).join('')}</select></label>`;
}
const flightLinks = (f) => { const code = (f || '').replace(/\s+/g, '').toUpperCase(); if (!/^[A-Z0-9]{2}\d{1,4}$/.test(code)) return {}; const a = AIRLINES[code.slice(0, 2)]; return { status: `https://www.flightaware.com/live/flight/${code}`, manage: a && a[1] ? a[1] : '' }; };
// "Booked through": where a booking was made. A Manage booking link only for sources whose trips page was checked to
// load (Nov 2026); sites that block automated checks (Expedia, Hotels.com, Priceline, Trip.com, Costco) get no link.
const BOOK_SOURCES = [['direct', 'Airline / hotel direct'], ['expedia', 'Expedia', '', /expedia/i], ['booking', 'Booking.com', 'https://secure.booking.com/mytrips.html', /booking\.com/i],
  ['hotels', 'Hotels.com', '', /hotels\.com/i], ['airbnb', 'Airbnb', 'https://www.airbnb.com/trips', /airbnb/i], ['agoda', 'Agoda', 'https://www.agoda.com/account/bookings.html', /agoda/i],
  ['kayak', 'Kayak', 'https://www.kayak.com/trips', /kayak/i], ['priceline', 'Priceline', '', /priceline/i], ['tripcom', 'Trip.com', '', /trip\.com/i], ['google', 'Google', '', /google (flights|travel|hotels)/i],
  ['chase', 'Chase Travel', 'https://www.chase.com/travel', /chase travel|chase ultimate rewards/i], ['amex', 'Amex Travel', 'https://www.amextravel.com/', /amex travel|american express travel|amextravel/i], ['costco', 'Costco Travel', '', /costco travel/i],
  ['agent', 'Travel agent', '', /travel agen/i], ['other', 'Other']];
const viaOf = (x) => { const s0 = BOOK_SOURCES.find(b => b[0] === x.via); return s0 ? { key: s0[0], name: s0[0] === 'other' ? (x.viaOther || '').trim() : s0[0] === 'direct' ? '' : s0[1], url: s0[2] || '' } : null; };
const viaGuess = (text) => { const s0 = BOOK_SOURCES.find(b => b[3] && b[3].test(String(text || ''))); return s0 ? s0[0] : ''; };
// One booking's fields, every one an input (empty ones show as empty boxes): the type's own fields first, then
// confirmation, the type's details, booked through, link, notes. Used by the Add / Edit form (idp 'it') and by each
// card of the import review (idp 'rv<i>'), so a read screenshot can be finished on the spot.
function bkFieldsHTML(x, idp, air = []) {
  const k = x.kind || ''; const fl = k === 'flight'; const lodge = LODGE.has(k);
  const f = (key, label, type = 'text', ph = '', cls = '') => `<div class="field ${cls}${type === 'datetime-local' && !isDate(x[key] || '') ? ' when-f' : ''}"><label for="${idp}-${key}">${t(label)}</label><input id="${idp}-${key}" type="${type === 'datetime-local' && isDate(x[key] || '') ? 'date' : type}" data-it="${key}" value="${esc(x[key] || '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}></div>`;
  const kindSel = `<div class="field"><label for="${idp}-kind">${t('Type')}</label><select id="${idp}-kind" data-it="kind"><option value="">${t('Choose')}</option>${Object.entries(ITIN_KINDS).map(([v, l]) => `<option value="${v}" ${v === k ? 'selected' : ''}>${t(l)}</option>`).join('')}</select></div>`;
  const head = fl ? `${f('flight', 'Flight number', 'text', 'UA 1234')}${f('name', 'Name')}${f('from', 'Departing from', 'text', 'JFK').replace('<input ', '<input autocapitalize="characters" ')}${f('to', 'Arriving at', 'text', (pickAirport(air, null, []) || { iata: 'CUN' }).iata).replace('<input ', `<input list="${idp}-to-list" autocapitalize="characters" `)}<datalist id="${idp}-to-list">${air.map(a => `<option value="${esc(a.iata)}">${esc(a.name)}</option>`).join('')}</datalist>
      ${f('start', 'Departs', 'datetime-local')}${f('end', 'Arrives', 'datetime-local')}`
    : `${f('name', 'Name', 'text', '', 'wide').replace('<input ', '<input data-name-ac autocomplete="off" ')}${f('address', 'Address', 'text', '', 'wide')}
      ${f('start', lodge ? 'Check-in' : k === 'car' ? 'Pick-up' : 'Starts', 'datetime-local')}${f('end', lodge ? 'Check-out' : k === 'car' ? 'Drop-off' : 'Ends', 'datetime-local')}`;
  return `${kindSel}${head}${lodge ? `<div class="wide" data-hf-slot>${hfFormHTML(hfOfBk(x), idp + '-hf')}</div>` : ''}
      ${f('confNo', 'Confirmation')}
      ${DET[detGroup(x)] ? `<div class="wide" data-det-slot>${detFormHTML(x, 'data-det', idp + '-dt')}</div>` : ''}
      <div class="field"><label for="${idp}-via">${t('Booked through')}</label><select id="${idp}-via" data-it="via"><option value="">${t('Choose')}</option>${BOOK_SOURCES.map(([v, l]) => `<option value="${v}" ${v === x.via ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select></div>
      ${x.via === 'other' ? f('viaOther', 'Where', 'text', t('Site or agency')) : ''}${f('link', 'Link', 'url', 'https://…')}
      <div class="field wide"><label for="${idp}-note">${t('Notes')}</label><textarea id="${idp}-note" data-it="note" rows="2" maxlength="1000"${fl ? ` placeholder="${esc(t('Confirmation code, last name'))}"` : ''}>${esc(x.note || '')}</textarea></div>`;
}
function itinFormHTML(x, i, air = []) {
  return `<form class="itin-form" onsubmit="return false">
    <div class="trip" data-bk-fields>${bkFieldsHTML(x, 'it', air)}</div>
    <div class="bk-fill" data-bk-fill hidden><label class="btn sm file-pick">${t('Fill from a screenshot or PDF')}<input type="file" accept="image/*,application/pdf" multiple data-itin-fill hidden></label></div>
    <p class="hint" data-ai-msg role="status" aria-live="polite"></p><div data-signin-slot></div>
    <div class="btns"><button type="button" class="btn primary" data-itin-save="${i == null ? '' : i}">${t('Save')}</button><button type="button" class="btn ghost" data-itin-cancel>${t('Cancel')}</button>${i != null ? `<button type="button" class="btn ghost" data-itin-del="${i}">${t('Remove')}</button>` : ''}</div>
  </form>`;
}
// marks the fields a read screenshot / document filled in (keys: only those; null: every filled field)
function markGot(root, keys) {
  const keyOf = (el) => el.dataset.it || el.dataset.det || (el.dataset.hk === 'cxd' || el.dataset.hk === 'cxt' ? 'cancelBy' : el.dataset.hk) || '';
  root.querySelectorAll('[data-it],[data-det],[data-hk]').forEach(el => { const k = keyOf(el); if (!k || k === 'kind' || (el.tagName === 'SELECT' && !el.value)) return;
    const has = el.type === 'checkbox' ? el.checked : !!String(el.value || '').trim(); if (has && (!keys || keys.has(k))) el.classList.add('got'); });
  root.querySelectorAll('[data-det-amen].on').forEach(b => { if (!keys || keys.has('amen')) b.classList.add('got'); });
}
document.addEventListener('input', (e) => { const el = e.target; if (el && el.classList && el.classList.contains('got')) el.classList.remove('got'); }, true);
function itinICS(cfg) {
  const items = itinLoad(cfg).filter(x => x.start); const now = icsStamp(new Date());
  const esc2 = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const loc = (s) => s.replace(/[-:]/g, '') + (s.length === 16 ? '00' : '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//1LinkTrip//Itinerary//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc2('My trip · ' + cfg.title)}`];
  items.forEach((x, i) => {
    const allDay = x.start.length === 10; const fLinks = x.kind === 'flight' ? flightLinks(x.flight) : {};
    let end = x.end || (allDay ? addDays(x.start, 1) : null);
    // a flight with both airports known: departure local at the departure airport, arrival at the arrival airport (exact UTC times)
    const fz = x.kind === 'flight' && !allDay ? (() => { const [fa, ta] = flightAirports(x); const zf = apZone(fa), zt = apZone(ta); return zf && zt ? [zf, zt] : []; })() : [];
    if (!allDay && (!end || end.length === 10)) end = new Date(asUTC(x.start).getTime() + 3600e3).toISOString().slice(0, 16);
    lines.push('BEGIN:VEVENT', `UID:itin-${i}-${x.start.replace(/\D/g, '')}@eventpages`, `DTSTAMP:${now}`,
      allDay ? `DTSTART;VALUE=DATE:${x.start.replace(/-/g, '')}` : `DTSTART:${fz[0] ? icsStamp(wallToUTC(x.start, fz[0])) : loc(x.start)}`,
      allDay ? `DTEND;VALUE=DATE:${end.slice(0, 10).replace(/-/g, '')}` : `DTEND:${fz[0] && end.length === 16 ? icsStamp(wallToUTC(end, x.end === end ? fz[1] : fz[0])) : loc(end)}`,
      `SUMMARY:${esc2(x.name || ITIN_KINDS[x.kind] || 'Reservation')}`, `LOCATION:${esc2(x.address)}`,
      `DESCRIPTION:${esc2([x.confNo ? 'Confirmation ' + x.confNo : '', rtPlain(x.note), fLinks.status, x.link].filter(Boolean).join('\n'))}`, 'END:VEVENT');
    // a hotel's free-cancellation deadline: its own event (timed when the time is known, else all day) with a reminder the day before
    const h = LODGE.has(x.kind) ? hfOfBk(x) : null; const c = h && !h.nonRef ? h.cancelBy : '';
    if (c) lines.push('BEGIN:VEVENT', `UID:itin-${i}-cx-${c.replace(/\D/g, '')}@eventpages`, `DTSTAMP:${now}`,
      c.length > 10 ? `DTSTART:${loc(new Date(asUTC(c).getTime() - 1800e3).toISOString().slice(0, 16))}` : `DTSTART;VALUE=DATE:${c.replace(/-/g, '')}`,
      c.length > 10 ? `DTEND:${loc(c)}` : `DTEND;VALUE=DATE:${addDays(c, 1).replace(/-/g, '')}`,
      `SUMMARY:${esc2(t('Free cancellation ends · {n}', { n: x.name || t('Hotel') }))}`, `DESCRIPTION:${esc2(x.confNo ? 'Confirmation ' + x.confNo : '')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc2(t('Free cancellation ends · {n}', { n: x.name || t('Hotel') }))}`, 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'my-itinerary.ics';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
// ---------- packing list (guest-side) ----------
// One table of rules. Each: [id, label (text or ctx => text), when(ctx) => bool]. Extend here.
const isT = (...ts) => (c) => ts.includes(c.type);
const PACK_RULES = [
  ['clothes', c => t('Clothes for {n} days', { n: c.days }), c => c.days > 1],
  ['toiletries', 'Toiletries', c => c.days > 1],
  ['charger', 'Phone charger', () => true],
  ['meds', 'Medications', () => true],
  ['passport', 'Passport', c => c.intl],
  ['adapter', c => c.plugs ? t('Plug adapter, type {p}', { p: c.plugs }) : t('Plug adapter'), c => c.adapter],
  ['photoid', 'Photo ID', c => c.mode.fly && !c.intl],
  ['boarding', 'Boarding pass', c => c.mode.fly],
  ['liquids', 'Liquids bag', c => c.mode.fly],
  ['license', "Driver's license", c => c.mode.rental || c.mode.drive],
  ['ccard', 'Credit card for the rental', c => c.mode.rental],
  ['traintix', 'Train tickets', c => c.mode.train],
  ['transitcard', 'Transit or contactless card', c => c.mode.transit],
  ['umbrella', 'Umbrella or rain jacket', c => c.wx.rain],
  ['coat', 'Winter coat, hat and gloves', c => c.wx.cold],
  ['layers', 'Warm layers', c => c.wx.cool],
  ['sunscreen', 'Sunscreen', c => c.wx.hot || c.beach],
  ['sunglasses', 'Sunglasses', c => c.wx.hot || c.beach],
  ['swimsuit', 'Swimsuit', c => c.beach],
  ['outfit', c => c.td.dress ? t('Outfit: {d}', { d: c.td.dress.split(/[.;]/)[0].trim() }) : t('Wedding outfit'), isT('Wedding')],
  ['gift', 'Card or gift', isT('Wedding')],
  ['runshoes', 'Running shoes', isT('Race')],
  ['racekit', 'Race-day kit', isT('Race')],
  ['bibpins', 'Safety pins for your bib', isT('Race')],
  ['gels', 'Energy gels', isT('Race')],
  ['trainshoes', 'Training shoes', isT('Hyrox')],
  ['gloves', 'Gloves', isT('Hyrox')],
  ['towel', 'Towel', isT('Hyrox')],
  ['waterbottle', 'Water bottle', isT('Hyrox')],
  ['changeclothes', 'Change of clothes', isT('Hyrox')],
  ['flowers', 'Flowers for the performer', c => c.type === 'Performance' && !/no flowers|flowers (are )?not/i.test(c.td.flowers || '')],
  ['clearbag', 'Clear bag', c => /clear/i.test(c.td.bags || '')],
  ['tickets', 'Tickets', isT('Concert', 'Sporting event', 'Festival', 'Performance')],
  ['earplugs', 'Earplugs', isT('Concert', 'Festival')],
  ['teamgear', 'Team gear', isT('Sporting event')],
  ['laptop', 'Laptop and charger', isT('Conference')],
  ['bizcards', 'Business cards', isT('Conference')],
  ['powerbank', 'Portable charger', isT('Festival', 'Concert', 'Conference', 'Race', 'Hyrox')]
];
// IEC plug types per country (lowercase ISO code)
const PLUGS = { us: 'AB', ca: 'AB', mx: 'AB', jp: 'AB', co: 'AB', pe: 'ABC', th: 'ABCO', tw: 'AB', ph: 'ABC', gb: 'G', ie: 'G', mt: 'G', cy: 'G', hk: 'G', sg: 'G', my: 'G', ae: 'G',
  fr: 'CE', be: 'CE', pl: 'CE', cz: 'CE', sk: 'CE', de: 'CF', nl: 'CF', es: 'CF', pt: 'CF', at: 'CF', se: 'CF', no: 'CF', fi: 'CF', gr: 'CF', is: 'CF', tr: 'CF', hr: 'CF', hu: 'CF', ro: 'CF', kr: 'CF', ru: 'CF', dk: 'CFK',
  it: 'CFL', ch: 'CJ', cl: 'CL', au: 'I', nz: 'I', ar: 'CI', cn: 'ACI', in: 'CDM', za: 'CDMN', br: 'CN', il: 'CH' };
const packKey = (cfg) => 'pack:' + eventKey(cfg).slice(6);
function packContext(cfg, art) {
  const v = cfg.venue; const tr = tripDates(cfg);
  const sel = art ? $$('.mode-bar [aria-pressed="true"]', art).map(b => b.dataset.tmode).filter(k => k !== 'all') : [];
  const o = LS.get('origin'); const oa = o && airportByCode(o);
  const home = oa ? String(oa[3]).toLowerCase() : ((navigator.language || '').split('-')[1] || '').toLowerCase();
  const intl = !!(v && v.cc && home && home !== v.cc);
  const hp = PLUGS[home], vp = v && PLUGS[v.cc];
  const adapter = intl && (!hp || !vp || ![...vp].some(x => hp.includes(x)));
  const w = art && art._wx; const wx = { rain: false, cold: false, cool: false, hot: false };
  if (w && w.days && w.days.length) {
    const lo = Math.min(...w.days.map(d => d.lo)), hi = Math.max(...w.days.map(d => d.hi));
    wx.rain = w.days.some(d => w.kind === 'typical' ? d.wet / (d.of || 1) >= 0.3 : (d.pop != null ? d.pop >= 40 : d.code >= 51 && d.code <= 99 && !(d.code >= 71 && d.code <= 77)));
    wx.cold = lo < 40; wx.cool = !wx.cold && lo < 60; wx.hot = hi >= 85;
  }
  return { type: cfg.type, td: typeData(cfg), days: Math.max(1, daysBetween(tr.arrive, tr.leave) + 1), mode: Object.fromEntries(sel.map(k => [k, true])),
    intl, adapter, plugs: adapter && vp ? [...vp].join('/') : '', wx, beach: !!(v && /\b(beach|playa|plage|praia|spiaggia|strand)\b/i.test(`${v.name} ${v.address || ''}`)) };
}
function packItems(cfg, art) {
  const st = LS.get(packKey(cfg), null) ?? demoOf(cfg, 'pack') ?? {}; const removed = st.removed || {}; const ctx = packContext(cfg, art);
  const host = String(cfg.bring || '').split('\n').map(s => s.trim()).filter(Boolean).map((text, i) => ({ id: 'h:' + text.toLowerCase(), text, host: true }));
  const auto = PACK_RULES.filter(([, , when]) => { try { return when(ctx); } catch { return false; } }).map(([id, label]) => ({ id, text: typeof label === 'function' ? label(ctx) : t(label) }));
  const own = (st.custom || []).map(x => ({ id: x.id, text: x.text }));
  return { st, host: host.filter(x => !removed[x.id]), rest: auto.concat(own).filter(x => !removed[x.id]) };
}
function packListHTML(cfg, art) {
  const { st, host, rest } = packItems(cfg, art); const done = st.done || {};
  const li = (x) => `<li class="${done[x.id] ? 'done' : ''}"><label><input type="checkbox" data-pack="${esc(x.id)}" ${done[x.id] ? 'checked' : ''}><span>${esc(x.text)}</span></label><button type="button" class="pack-x" data-pack-del="${esc(x.id)}" aria-label="${t('Remove')} ${esc(x.text)}">×</button></li>`;
  return `${host.length ? `<h3 class="sub-h">${t('From the host')}</h3><ul class="pack">${host.map(li).join('')}</ul>${rest.length ? `<h3 class="sub-h">${t('Also pack')}</h3>` : ''}` : ''}<ul class="pack">${rest.map(li).join('')}</ul>`;
}
function wirePacking(cfg, art) {
  const sec = art.querySelector('#sec-packing'); if (!sec) return;
  const list = sec.querySelector('[data-slot="pack-list"]'); const save = (st) => LS.set(packKey(cfg), st);
  const render = () => {
    list.innerHTML = packListHTML(cfg, art);
    const sum = sec.querySelector('[data-slot="pack-sum"]'); if (!sum) return;
    const { st, host, rest } = packItems(cfg, art); const all = host.concat(rest); const n = all.filter(x => (st.done || {})[x.id]).length;
    sum.innerHTML = `${esc(t('{n} of {m} packed', { n, m: all.length }))}<i><b style="width:${all.length ? Math.round(100 * n / all.length) : 0}%"></b></i>`;
  };
  art._pack = render; render();
  sec.addEventListener('change', (e) => { const id = e.target.dataset.pack; if (id == null) return; const st = LS.get(packKey(cfg), null) ?? demoOf(cfg, 'pack') ?? {}; st.done = st.done || {}; e.target.checked ? st.done[id] = true : delete st.done[id]; save(st); e.target.closest('li').classList.toggle('done', e.target.checked); render(); });
  sec.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pack-del]'); if (b) { const id = b.dataset.packDel; const st = LS.get(packKey(cfg), null) ?? demoOf(cfg, 'pack') ?? {}; if (id.startsWith('c:')) st.custom = (st.custom || []).filter(x => x.id !== id); else (st.removed = st.removed || {})[id] = true; save(st); render(); return; }
    if (e.target.closest('[data-pack-add]')) add();
  });
  const inp = sec.querySelector('.pack-add input');
  const add = () => { const text = inp.value.trim(); if (!text) return; const st = LS.get(packKey(cfg), null) ?? demoOf(cfg, 'pack') ?? {}; (st.custom = st.custom || []).push({ id: 'c:' + Date.now().toString(36), text }); save(st); inp.value = ''; render(); inp.focus(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
}

// ---------- shopping list (guest-side): things to buy at the destination, optional city (route stop) and note ----------
// Stored per trip in localStorage like packing; signed-in guests' lists sync with the rest of My trip.
const shopKey = (cfg) => 'shop:' + eventKey(cfg).slice(6);
const shopLoad = (cfg) => LS.get(shopKey(cfg), null) ?? demoOf(cfg, 'shop') ?? [];
const shopSave = (cfg, xs) => { LS.set(shopKey(cfg), xs); if (typeof syncPush === 'function' && LS.get('signedIn')) syncPush(cfg); };
function shopSecHTML(cfg) {
  const ss = stopsOf(cfg);
  return `<section class="ev-sec" id="sec-shop"><details class="pack-wrap"><summary><h2 class="sec-h">${t('Shopping list')}</h2><span class="pack-sum" data-slot="shop-sum"></span></summary><div data-slot="shop-list"></div>
    <div class="shop-add"><input data-shop-text placeholder="${t('Add something to buy')}" aria-label="${t('Add something to buy')}" maxlength="80">${ss.length > 1 ? `<select data-shop-city aria-label="${t('City')}"><option value="">${t('Any city')}</option>${ss.map(x => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('')}</select>` : ''}<input data-shop-note placeholder="${t('Note (optional)')}" aria-label="${t('Note (optional)')}" maxlength="120"><button type="button" class="btn" data-shop-add>${t('Add')}</button></div></details></section>`;
}
function shopListHTML(cfg) {
  const xs = shopLoad(cfg); if (!xs.length) return `<p class="muted small">${t('Nothing on the list yet.')}</p>`;
  const order = xs.filter(x => !x.done).concat(xs.filter(x => x.done)); // checked items sink to the bottom
  return `<ul class="pack shop">${order.map(x => `<li class="${x.done ? 'done' : ''}"><label><input type="checkbox" data-shop="${esc(x.id)}" ${x.done ? 'checked' : ''}><span class="shop-t"><span>${esc(x.text)}</span>${x.city ? ` <em class="shop-city">${esc(x.city)}</em>` : ''}${x.note ? `<small>${esc(x.note)}</small>` : ''}</span></label><button type="button" class="pack-x" data-shop-del="${esc(x.id)}" aria-label="${t('Remove')} ${esc(x.text)}">×</button></li>`).join('')}</ul>`;
}
function wireShopping(cfg, art) {
  const sec = art.querySelector('#sec-shop'); if (!sec) return;
  const list = sec.querySelector('[data-slot="shop-list"]'), sum = sec.querySelector('[data-slot="shop-sum"]');
  const render = () => { list.innerHTML = shopListHTML(cfg); const xs = shopLoad(cfg); const n = xs.filter(x => x.done).length;
    sum.innerHTML = xs.length ? `${esc(t('{n} of {m} bought', { n, m: xs.length }))}<i><b style="width:${Math.round(100 * n / xs.length)}%"></b></i>` : ''; };
  art._shop = render; render();
  sec.addEventListener('change', (e) => { const id = e.target.dataset.shop; if (id == null) return; const xs = shopLoad(cfg); const x = xs.find(y => y.id === id); if (!x) return; x.done = e.target.checked; shopSave(cfg, xs); render(); });
  const txt = sec.querySelector('[data-shop-text]'), note = sec.querySelector('[data-shop-note]'), city = sec.querySelector('[data-shop-city]');
  const add = () => { const text = txt.value.trim(); if (!text) { txt.focus(); return; } const xs = shopLoad(cfg);
    xs.push({ id: 'sh' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: text.slice(0, 80), city: city ? city.value : '', note: note.value.trim().slice(0, 120), done: false });
    shopSave(cfg, xs); txt.value = ''; note.value = ''; render(); txt.focus(); };
  sec.addEventListener('click', (e) => {
    const b = e.target.closest('[data-shop-del]'); if (b) { shopSave(cfg, shopLoad(cfg).filter(x => x.id !== b.dataset.shopDel)); render(); return; }
    if (e.target.closest('[data-shop-add]')) add();
  });
  [txt, note].forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }));
}

// ---------- booking providers: every outbound booking link goes through bookingLink() ----------
// mode: 'link' opens the provider's site; 'inapp' is reserved for a future in-app booking flow per provider.
const PROVIDERS = {
  gflights: { name: 'Google Flights', kinds: ['flights'], mode: 'link', url: (p) => L.gflights(p.to, p.from, p.d1, p.d2) },
  kayak: { name: 'Kayak', kinds: ['flights'], mode: 'link', url: (p) => L.kayak(p.from, p.to, p.d1, p.d2) },
  kayakCars: { name: 'Kayak', kinds: ['cars'], mode: 'link', url: (p) => L.kayakCars(p.iata, p.d1, p.d2) },
  ghotels: { name: 'Google Hotels', kinds: ['hotels'], mode: 'link', url: (p) => L.ghotels(p.q, p.d1, p.d2) },
  booking: { name: 'Booking.com', kinds: ['hotels'], mode: 'link', url: (p) => L.booking(p.q, p.d1, p.d2, p.n) },
  airbnb: { name: 'Airbnb', kinds: ['hotels'], mode: 'link', url: (p) => L.airbnb(p.q, p.d1, p.d2, p.n) },
  gyg: { name: 'GetYourGuide', kinds: ['tours'], mode: 'link', url: (p) => L.gyg(p.q, p.d1, p.d2) },
  airbnbExp: { name: 'Airbnb', kinds: ['tours'], mode: 'link', url: (p) => L.airbnbExp(p.q, p.d1, p.d2) },
  opentable: { name: 'OpenTable', kinds: ['restaurants'], mode: 'link', url: (p) => L.opentable(p.name, p.venue, p.date, p.n) },
};
function bookingLink(kind, provider, params) {
  const P = PROVIDERS[provider]; if (!P || !P.kinds.includes(kind)) throw new Error(`no ${kind} provider ${provider}`);
  return { provider, name: P.name, mode: P.mode, url: P.url(params) };
}
// a booking row/button; when a provider switches to 'inapp' this is the one place that changes
const bookExt = (kind, provider, params, label, cls = 'row-link') => { const b = bookingLink(kind, provider, params); return ext(b.url, label, cls); };

function tripDates(cfg) {
  const s = cfg.start.slice(0, 10), e = (cfg.end || cfg.start).slice(0, 10);
  const st = LS.get('trip:' + s + ':' + e) || {}; const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const today = todayYMD();
  const m = cfg.off && mineOn(cfg) ? mineGet(cfg) : null; // Make it mine: the guest's own days
  let arrive = m ? m.a : ok(st.arrive) ? st.arrive : addDays(s, -1), leave = m ? m.l : ok(st.leave) ? st.leave : addDays(e, 1);
  if (arrive < today && s >= today && !m) arrive = today;
  if (leave <= arrive) leave = addDays(arrive, 1);
  return { arrive, leave, guests: Math.min(16, Math.max(1, +st.guests || 2)) };
}
// ---------- travel mode filter (multi-select; nothing picked = everything) ----------
const TRAVEL_MODES = [['fly', 'Flying'], ['train', 'Train'], ['rental', 'Rental car'], ['drive', 'Driving'], ['transit', 'Transit']];
const eventKey = (cfg) => cfg._ek || cfg.ek || 'modes:' + Math.abs([...(cfg.title || '') + (cfg.start || '') + (cfg.venue ? cfg.venue.name : '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
const RAIL_CC = new Set(['jp', 'kr', 'cn', 'tw', 'in', 'ca', 'au']);
const hasTrains = (v, cfg) => v.cc === 'us' || TRAINLINE_CC.has(v.cc) || RAIL_CC.has(v.cc) || (cfg && stopsOf(cfg).length > 1);
const NOFLY_ORDER = ['drive', 'transit', 'train', 'rental', 'fly']; // flying turned off: ground options first, flights last
const modeOrder = (cfg) => noFly(cfg) ? NOFLY_ORDER : TRAVEL_MODES.map(([k]) => k);
function travelModes(cfg, air) {
  const v = cfg.venue; const by = Object.fromEntries(TRAVEL_MODES);
  return modeOrder(cfg).map(k => [k, by[k]]).filter(([k]) => k === 'fly' ? air.length > 0 || noFly(cfg) : k === 'train' ? hasTrains(v, cfg) : true);
}
function modeBarHTML(cfg, air) {
  const ms = travelModes(cfg, air); if (ms.length < 2) return '';
  return `<div class="chips mode-bar" role="group" aria-label="${t('How are you getting there?')}"><button type="button" class="chip on" data-tmode="all" aria-pressed="true">${t('All')}</button>${ms.map(([k, l]) => `<button type="button" class="chip" data-tmode="${k}" aria-pressed="false">${t(l)}</button>`).join('')}<button type="button" class="chip m-chg" data-tmode-change hidden>${t('Change')}</button></div>`;
}
// Travel view state, personal and per device (not the event): an airport someone settled on — their own pick, a booked
// flight's arrival, or the organizer's Fly into — folds the others away until Change (AP_OPEN, this visit only)
const AP_OPEN = new Set();
const apSettled = (cfg, air) => { const sv = LS.get(apKey(cfg)); return air.some(a => a.iata === sv) || !!flightArrival(air, itinLoad(cfg)) || (!!cfg.flyInto && air.some(a => a.iata === cfg.flyInto)); };
// Hide on Travel blocks nobody needs; one "Show hidden (N)" at the bottom brings them all back
const thKey = (cfg) => 'thide:' + syncKey(cfg);
const TH_SEL = { stay: '#sec-stay', airlines: '.airline-pick', counters: '.th-counters', hotels: '.th-hotels' };
const thHideBtn = (id, what) => `<button type="button" class="th-hide" data-th-hide="${id}" aria-label="${esc(t('Hide') + ': ' + what)}">${t('Hide')}</button>`;
const thHead = (id, h, what) => `<div class="th-row">${h}${thHideBtn(id, what)}</div>`;
function flightsHTML(cfg, air, ap = chosenAirport(cfg, air)) {
  const tr = tripDates(cfg); const o = LS.get('origin'); const v = cfg.venue;
  if (!air.length && noFly(cfg)) { const to = v.city || placeLabel(v) || v.name; return `<h3 class="sub-h">${t('Flights')}</h3><div class="row-links">${bookExt('flights', 'gflights', { to, from: o, d1: tr.arrive, d2: tr.leave }, `${esc(t('Flights to {a}', { a: to }))} <small>Google Flights</small>`)}</div>`; }
  if (!air.length) return `<p class="muted">${t('No airports with scheduled flights within 220 km of the venue.')}</p>`;
  const multi = air.length > 1; const fold = multi && !!ap && !AP_OPEN.has(apKey(cfg)) && apSettled(cfg, air);
  return `<h3 class="sub-h">${t(fold ? 'Flying into' : 'Nearest airports')}</h3><ul class="airports${fold ? ' ap-fold' : ''}">${(fold ? air.filter(a => a.iata === ap.iata) : air).map(a => { const on = ap && a.iata === ap.iata; return `<li class="${multi && on ? 'on' : ''}">
    <div class="ap-code">${esc(a.iata)}</div>
    <div class="ap-info"><b>${esc(a.name)}</b><span>${esc(t('{d} from the venue', { d: fmtDist(a.d, v.cc) }))}${a.large ? '' : ' · ' + t('regional')}</span></div>
    <div class="btns">
      ${fold ? `<button type="button" class="chip ap-chg" data-ap-change aria-expanded="false">${t('Change')}</button>` : multi ? `<button type="button" class="chip ap-pick${on ? ' on' : ''}" data-ap="${esc(a.iata)}" aria-pressed="${on}">${on ? '✓ ' + t('Flying in here') : t('Fly in here')}</button>` : ''}
      ${o === a.iata ? `<span class="muted small">${t('That is your home airport.')}</span>` : `${bookExt('flights', 'gflights', { to: a.iata, from: o, d1: tr.arrive, d2: tr.leave }, 'Google Flights', 'btn')}
      ${o ? bookExt('flights', 'kayak', { from: o, to: a.iata, d1: tr.arrive, d2: tr.leave }, 'Kayak', 'btn') : ''}`}
      ${canAddTrip(cfg) ? `<button type="button" class="mini-b" data-addtrip="flight" data-iata="${esc(a.iata)}" data-at-place="${esc(a.name)}" data-at-label="${esc(t('Flight to {a}', { a: a.iata }))}">+ ${t('Add to my trip')}</button>` : ''}
    </div></li>`; }).join('')}</ul>
    ${ap ? `<div class="row-links ap-transfer">${ext(L.route(ap, v), `${esc(t('From {a} to the venue', { a: ap.iata }))} <small>${esc(fmtDist(ap.d, v.cc))} · Google Maps</small>`, 'row-link')}</div>` : ''}
    ${o ? '' : `<p class="muted small">${t('Add the airport you are flying from to compare fares on Kayak too.')}</p>`}
    ${airlinePickHTML(cfg, air, ap)}`;
}
function trainsHTML(cfg) {
  const v = cfg.venue; const o = LS.get('origin'); const oa = o && airportByCode(o);
  const from = oa ? (oa[2] || oa[1]) : '';
  const to = v.city || v.name;
  const items = [];
  if (from) items.push(ext(L.transit(from, v), `${esc(t('Train and bus from {a}', { a: from }))} <small>Google Maps</small>`, 'row-link'));
  if (from) items.push(ext(L.rome2rio(from, to), `${esc(t('Every way from {a} to {b}', { a: from, b: to }))} <small>Rome2Rio</small>`, 'row-link'));
  if (v.cc === 'us') items.push(ext('https://www.amtrak.com/home', `${t('Trains across the US')} <small>Amtrak</small>`, 'row-link'));
  if (TRAINLINE_CC.has(v.cc)) items.push(ext('https://www.thetrainline.com/', `${t('Trains and coaches in Europe')} <small>Trainline</small>`, 'row-link'));
  return `${routeTrainsHTML(cfg)}<h3 class="sub-h">${t('Train and bus')}</h3><div class="row-links">${items.join('')}</div>${from ? '' : `<p class="muted small">${t('Add where you are coming from to see train and bus routes on Rome2Rio.')}</p>`}`;
}
function rentalHTML(cfg, air, ap = chosenAirport(cfg, air)) {
  const tr = tripDates(cfg); const v = cfg.venue;
  const items = (ap ? [ap] : []).map(a => bookExt('cars', 'kayakCars', { iata: a.iata, d1: tr.arrive, d2: tr.leave }, `${esc(t('Rental cars near {a}', { a: `${a.name} (${a.iata})` }))} <small>Kayak</small>`));
  items.push(ext(L.place('car rental', placeLabel(v) || v.name), `${esc(t('Rental desks near the venue'))} <small>Google Maps</small>`, 'row-link'));
  const d = (x) => fmt(x, { month: 'short', day: 'numeric' });
  return `<h3 class="sub-h">${t('Rental car')}</h3>${airportSelHTML(cfg, air, ap)}<p class="muted small">${esc(t('Pick up {a} (arrival) · return {b} (departure)', { a: d(tr.arrive), b: d(tr.leave) }))}</p>${GKEY ? `<div data-slot="car-counters"></div>` : ''}<div class="row-links">${items.join('')}</div>${addTripBtn(cfg, 'car', ap ? ap.name : (placeLabel(v) || v.name), ap ? t('Rental car at {a}', { a: ap.iata }) : t('Rental car'))}`;
}
// hotels stay at the venue; a far-off arrival airport gets one extra link for late arrivals and early departures
const AP_FAR = 40e3;
function stayLinks(cfg, ap = chosenAirport(cfg)) {
  const tr = tripDates(cfg); const v = cfg.venue; const q = placeLabel(v) || v.name; const n = tr.guests || 2;
  const near = ap && ap.d > AP_FAR ? bookExt('hotels', 'ghotels', { q: ap.name, d1: tr.arrive, d2: tr.leave, n }, `${esc(t('Hotels near {a}', { a: `${ap.name} (${ap.iata})` }))} <small>Google Hotels</small>`) : '';
  const nearAdd = near ? addTripBtn(cfg, 'hotel', ap.name, t('Hotel near {a}', { a: ap.iata })) : '';
  if (stopsOf(cfg).length > 1) return routeStaysHTML(cfg) + near + nearAdd;
  const p = { q, d1: tr.arrive, d2: tr.leave, n };
  return [bookExt('hotels', 'ghotels', p, `${esc(t('Hotels in {c}', { c: v.city || q }))} <small>Google Hotels</small>`),
    bookExt('hotels', 'booking', p, `${t('Hotels and apartments')} <small>Booking.com</small>`),
    bookExt('hotels', 'airbnb', p, `${t('Homes and apartments')} <small>Airbnb</small>`),
    addTripBtn(cfg, 'hotel', q, t('Hotel in {c}', { c: v.city || q })), near, nearAdd].join('');
}
function toursHTML(cfg) {
  return `<div class="row-links" data-slot="tour-links">${tourLinks(cfg)}</div>
    <h3 class="sub-h">${t('Sights near the venue')}</h3>
    <div data-slot="sights">${loading(t('sights'))}</div>`;
}
function tourLinks(cfg) {
  const tr = tripDates(cfg); const v = cfg.venue; const q = v.city || placeLabel(v) || v.name; const qa = placeLabel(v) || q;
  return [bookExt('tours', 'gyg', { q, d1: tr.arrive, d2: tr.leave }, `${esc(t('Tours in {c}', { c: q }))} <small>GetYourGuide</small>`),
    bookExt('tours', 'airbnbExp', { q: qa, d1: tr.arrive, d2: tr.leave }, `${t('Experiences with locals')} <small>Airbnb</small>`)].join('');
}
function sightsHTML(cfg, data) {
  const v = cfg.venue; const xs = data.sights || [];
  if (!xs.length) return `<p class="muted">${t('No museums, viewpoints or attractions are mapped within 3 km of the venue.')}</p>${ext(L.place('things to do', placeLabel(v)), t('Search on Google Maps'), 'btn')}`;
  const art = data.__art;
  if (art) return nearListRegister(art, 'sights', cfg, xs.slice(0, 30).map(x => ({ ...x, rating: (x.g && x.g.rating) || 0, count: (x.g && x.g.count) || 0 })), (x, fold) => `<li${fold ? ' class="more"' : ''}>
    <div><b>${esc(x.name)}</b><span>${esc([t(x.kind), x.rating ? `★ ${nfix(x.rating, 1)}` : ''].filter(Boolean).join(' · '))}</span>
      <div class="mini"><button type="button" class="mini-b" ${x.g && x.g.gid ? `data-gpid="${esc(x.g.gid)}"` : `data-place="${esc(placeKey(x))}"`}>${t('Details')}</button>${x.website ? ext(x.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(x.d, v.cc))}<small>${x.d < 2000 ? walkTxt(x.d) : t('from the venue')}</small></span></li>`, { more: 8, walkLabel: t('Walking distance') });
  return `<ul class="plist rich">${xs.slice(0, 8).map(x => `<li>
    <div><b>${esc(x.name)}</b><span>${esc(t(x.kind))}</span>
      <div class="mini"><button type="button" class="mini-b" ${x.g && x.g.gid ? `data-gpid="${esc(x.g.gid)}"` : `data-place="${esc(placeKey(x))}"`}>${t('Details')}</button>${x.website ? ext(x.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(x.d, v.cc))}<small>${x.d < 2000 ? walkTxt(x.d) : t('from the venue')}</small></span></li>`).join('')}</ul>`;
}
const TRANSIT_LABELS = { subway: 'Subway & metro', rail: 'Rail', tram: 'Light rail & tram', bus: 'Bus stops', bike: 'Bike share & rental', ferry: 'Ferry' };
function transitHTML(cfg, data) {
  const v = cfg.venue; const groups = Object.entries(data.transit).filter(([, xs]) => xs.length);
  if (!groups.length) return `<p class="muted">${t('No mapped stations or stops within walking distance. Rideshare or driving is the way in.')}</p>`;
  return `<div class="tgroups">${groups.map(([k, xs]) => `<div class="tgroup"><h3 class="sub-h">${t(TRANSIT_LABELS[k])}</h3><ul class="plist">${xs.map(x => `<li>
    <div><b>${esc(x.name)}</b>${x.line ? `<span>${esc(x.line.split(';').join(' · '))}</span>` : ''}</div>
    <a class="dist" href="${esc(`https://www.google.com/maps/dir/?api=1&origin=${x.lat},${x.lon}&destination=${v.lat},${v.lon}&travelmode=walking`)}" target="_blank" rel="noopener noreferrer" title="${t('Walking directions to the venue')}">${esc(fmtDist(x.d, v.cc))}<small>${walkTxt(x.d)}</small></a></li>`).join('')}</ul></div>`).join('')}</div>`;
}
function foodHTML(cfg, data, filter = 'all') {
  const v = cfg.venue; const tr = tripDates(cfg); const date = cfg.start.slice(0, 10);
  const counts = { all: data.food.length }; data.food.forEach(f => counts[f.kind] = (counts[f.kind] || 0) + 1);
  if (!data.food.length) return `<p class="muted">${t('No restaurants, cafés or bars are mapped within 900 m of the venue.')}</p>${ext(L.place('restaurants', placeLabel(v)), t('Search on Google Maps'), 'btn')}`;
  const list = data.food.filter(f => filter === 'all' || f.kind === filter).slice(0, 12);
  const chip = (k, l) => counts[k] ? `<button class="chip ${filter === k ? 'on' : ''}" data-food="${k}">${l} <span>${counts[k]}</span></button>` : '';
  return `<div class="chips">${chip('all', t('All'))}${chip('restaurant', t('Restaurants'))}${chip('cafe', t('Cafés'))}${chip('bar', t('Bars'))}</div>
  <ul class="plist rich">${list.map((f, i) => `<li${i >= 5 ? ' class="more"' : ''}>
    <div><b>${esc(f.name)}</b><span>${esc([t(f.kind === 'cafe' ? 'café' : f.kind), f.cuisine].filter(Boolean).join(' · '))}</span>
      <div class="mini">${ext(L.place(f.name, f.street ? `${f.street}, ${v.city}` : placeLabel(v)), 'Google Maps', 'mini-b')}${f.kind !== 'cafe' ? bookExt('restaurants', 'opentable', { name: f.name, venue: v, date, n: tr.guests || 2 }, t('Reserve') + ' · OpenTable', 'mini-b') : ''}${f.website ? ext(f.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(f.d, v.cc))}<small>${walkTxt(f.d)}</small></span></li>`).join('')}${list.length > 5 ? `<li class="more-li"><button type="button" class="btn sm" data-more>${t('Show {n} more', { n: list.length - 5 })}</button></li>` : ''}</ul>`;
}
// ---- compact search + chips + sort for long guest lists (rental counters, hotels, sights); same look as the places filters ----
// lfBarHTML draws the bar once; only the list under it re-renders while typing, so the search box keeps focus.
const withArt = (d, art) => { const o = Object.create(d); Object.defineProperty(o, '__art', { value: art }); return o; };
function lfBarHTML(key, f, { ph, chips = [], sorts = [] }) {
  const filt = chips.length || sorts.length > 1;
  const grp = (id) => id.startsWith('p:') ? 'Price' : id.startsWith('r:') ? 'Rating' : id.startsWith('k:') ? 'Kind' : id === 'airport' || id === 'town' ? 'Where' : 'Show';
  const body = ['Kind', 'Where', 'Show', 'Price', 'Rating'].map(g => { const cs = chips.filter(c => grp(c[0]) === g); return cs.length ? ccGroup(t(g), cs.map(([id, label, on]) => ccChip(on, `data-lf-chip="${esc(id)}"${id === 'airport' ? ' data-lf-def' : ''}`, esc(label))).join('')) : ''; }).join('')
    + (sorts.length > 1 ? `<div class="cc-g cc-sels"><label class="field"><span>${esc(t('Sort by'))}</span><select data-lf-sort>${sorts.map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>` : '');
  const ps = chips.filter(c => c[2] && c[0] !== 'airport').map(c => [c[0], c[1]]).concat(sorts.length > 1 && f.sort && f.sort !== sorts[0][0] ? [['sort', (sorts.find(x => x[0] === f.sort) || [0, ''])[1]]] : []);
  return `<div class="lf ccb" data-lf="${key}" role="group" aria-label="${esc(t('Filters'))}"><div class="ccb-row lf-row"><div class="gp-search lf-q"><input type="search" data-lf-q value="${esc(f.q || '')}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" enterkeyhint="search" autocomplete="off"></div>${filt ? ccFiltersBtn(ps.length) : ''}</div><div class="ccb-pills" data-ccb-pills${ps.length ? '' : ' hidden'}>${lfPills(ps)}</div>${filt ? `<dialog class="cc-sheet" data-ccb-sheet aria-label="${esc(t('Filters'))}">${ccSheet(body, t('Done'), 'data-lf-clear')}</dialog>` : ''}</div>`;
}
const lfPills = (ps) => ps.map(([k, l]) => `<button type="button" class="pill" data-lf-unchip="${esc(k)}" aria-label="${esc(t('Remove {s}', { s: l }))}"><span>${esc(l)}</span><i aria-hidden="true">×</i></button>`).join('');
// after a change: the pills under the bar and the count on Filters follow the sheet's chips
function lfSync(box) {
  const bar = box.querySelector('.lf'); if (!bar) return; const so = bar.querySelector('[data-lf-sort]');
  const on = [...bar.querySelectorAll('.cc-sheet [data-lf-chip].on:not([data-lf-def])')].map(c => [c.dataset.lfChip, c.textContent]);
  const ps = on.concat(so && so.selectedIndex > 0 ? [['sort', so.options[so.selectedIndex].textContent]] : []);
  const p = bar.querySelector('[data-ccb-pills]'); if (p) { p.innerHTML = lfPills(ps); p.hidden = !ps.length; }
  const fb = bar.querySelector('[data-cc-filters]'); if (fb) fb.outerHTML = ccFiltersBtn(ps.length);
}
const lfMatch = (q, ...xs) => { const n = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); const w = n(q).trim().split(/\s+/).filter(Boolean); const hay = n(xs.join(' ')); return w.every(x => hay.includes(x)); };
const lfSort = (rows, sort) => sort === 'rating' ? rows.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.count || 0) - (a.count || 0) || a.d - b.d) : sort === 'name' ? rows.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), LANG, { sensitivity: 'base', numeric: true })) : rows.slice().sort((a, b) => a.d - b.d);
const lfCount = (n, active, total) => `<p class="pf-count muted small" role="status" aria-live="polite">${esc(n === 1 ? t('1 place') : t('{n} places', { n }))}${active ? ` · <button type="button" class="link" data-lf-clear>${t('Clear filters')}</button>` : ''}</p>`;
// one delegated handler per page: lists register { f, list(), chip(id), clear() } under art._lf[key]
function lfWire(art) {
  if (art._lfWired) return; art._lfWired = true; art._lf = art._lf || {};
  const L0 = (el) => { const box = el.closest('[data-lf-box]'); return box ? [box, art._lf[box.dataset.lfBox]] : [null, null]; };
  const paint = (box, x) => { const out = box.querySelector('[data-lf-list]'); if (out) out.innerHTML = x.list(); };
  art.addEventListener('input', (e) => { if (!e.target.matches('[data-lf-q]')) return; const [box, x] = L0(e.target); if (!x) return; x.f.q = e.target.value.slice(0, 60); paint(box, x); });
  art.addEventListener('change', (e) => { if (!e.target.matches('[data-lf-sort]')) return; const [box, x] = L0(e.target); if (!x) return; x.f.sort = e.target.value; paint(box, x); lfSync(box); });
  art.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lf-chip],[data-lf-clear],[data-lf-unchip]'); if (!b) return; const [box, x] = L0(b); if (!x) return;
    const un = b.dataset.lfUnchip; const so = box.querySelector('[data-lf-sort]');
    if (un === 'sort') { x.f.sort = 'dist'; if (so) so.value = 'dist'; }
    else if (un) x.chip(un === 'town' ? 'airport' : un);
    else if (b.dataset.lfChip) x.chip(b.dataset.lfChip); else { x.clear(); const q = box.querySelector('[data-lf-q]'); if (q) q.value = ''; if (so) so.value = x.f.sort; }
    box.querySelectorAll('[data-lf-chip]').forEach(c => { const on = !!x.on(c.dataset.lfChip); c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
    paint(box, x); lfSync(box);
  });
}
// hotels and sights near the venue (OpenStreetMap or Google): search by name, within walking distance, sort by distance or rating
// hotels also get price level ($ … $$$$, Google's priceLevel; several can be on) and minimum rating (4+ / 4.5+)
function nearListRegister(art, key, cfg, rows, rowHTML, { more, walkLabel, hotel }) {
  art._lf = art._lf || {}; const prev = art._lf[key]; const f = prev ? prev.f : { q: '', walk: false, sort: 'dist', price: [], minR: 0, kinds: [] };
  f.price = f.price || []; f.minR = f.minR || 0; f.kinds = f.kinds || [];
  const hasRating = rows.some(r => r.rating); const prices = hotel ? ['$', '$$', '$$$', '$$$$'].filter(p => rows.some(r => r.price === p)) : [];
  // sights: by kind (museums, temples & landmarks, parks…) from what the rows are; sorted by name too (Dylan 11/25)
  const act = key === 'sights'; const kindOf = (r) => actKind({ name: r.name, type: r.kind, types: (r.types || []).concat(String(r.kind || '').replace(/ /g, '_')) });
  const kinds = act ? ACT_KINDS.map(k => k[0]).concat('other').filter(k => rows.some(r => kindOf(r) === k)) : [];
  const x = art._lf[key] = { f, hasRating,
    on: (id) => id === 'walk' ? f.walk : id.startsWith('p:') ? f.price.includes(id.slice(2)) : id.startsWith('r:') ? f.minR === +id.slice(2) : id.startsWith('k:') ? f.kinds.includes(id.slice(2)) : false,
    chip: (id) => { if (id === 'walk') f.walk = !f.walk; else if (id.startsWith('p:')) { const p = id.slice(2); f.price = f.price.includes(p) ? f.price.filter(y => y !== p) : f.price.concat(p); } else if (id.startsWith('r:')) f.minR = f.minR === +id.slice(2) ? 0 : +id.slice(2); else if (id.startsWith('k:')) { const k = id.slice(2); f.kinds = f.kinds.includes(k) ? f.kinds.filter(y => y !== k) : f.kinds.concat(k); } },
    clear: () => { f.q = ''; f.walk = false; f.sort = 'dist'; f.price = []; f.minR = 0; f.kinds = []; },
    list: () => {
      const xs = lfSort(rows.filter(r => (!f.q || lfMatch(f.q, r.name, r.kind ? t(r.kind) : '')) && (!f.walk || r.d <= 1500) && (!f.price.length || f.price.includes(r.price)) && (!f.minR || (r.rating || 0) >= f.minR) && (!f.kinds.length || f.kinds.includes(kindOf(r)))), hasRating || (act && f.sort === 'name') ? f.sort : 'dist');
      const active = !!(f.q || f.walk || f.price.length || f.minR || f.kinds.length); const fold = !active && xs.length > more + 1;
      return `${active ? lfCount(xs.length, true) : ''}${xs.length ? `<ul class="plist rich">${xs.map((r, i) => rowHTML(r, fold && i >= more)).join('')}${fold ? `<li class="more-li"><button type="button" class="btn sm" data-more>${t('Show {n} more', { n: xs.length - more })}</button></li>` : ''}</ul>` : `<p class="muted">${t('Nothing matches these filters.')} <button type="button" class="link" data-lf-clear>${t('Clear filters')}</button></p>`}`;
    } };
  lfWire(art);
  const kindChips = kinds.length > 1 ? kinds.map(k => ['k:' + k, k === 'other' ? t('Other') : t(ACT_KINDS.find(y => y[0] === k)[1]), f.kinds.includes(k)]) : [];
  const sorts = [['dist', t('Distance')], ...(hasRating ? [['rating', t('Rating')]] : []), ...(act ? [['name', t('Name')]] : [])];
  return `<div data-lf-box="${key}">${rows.length > (act ? 4 : more) ? lfBarHTML(key, f, { ph: t('Search by name'), chips: [...kindChips, ['walk', walkLabel, f.walk], ...prices.map(p => ['p:' + p, p, f.price.includes(p)]), ...(hotel && hasRating ? [['r:4', '★ 4+', f.minR === 4], ['r:4.5', '★ 4.5+', f.minR === 4.5]] : [])], sorts: sorts.length > 1 ? sorts : [] }) : ''}<div data-lf-list>${x.list()}</div></div>`;
}
// "See prices": one button → a small menu of Google / Expedia / Booking.com with the stay's nights + guests filled in.
// Formats checked live (Nov 2026, iPhone Safari): Google Hotels reads the hotel + dates from the query text (it opens on
// that hotel; guests stay its default 2 — no URL setting for them); Booking.com takes the hotel name + checkin /
// checkout / group_adults (the hotel comes first); Expedia only resolves a CITY (a hotel name lands on its city), so its
// link is that city's hotels for those dates and travelers.
const fullDay = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(asUTC(d));
function priceLinks({ hotel, city, country, d1, d2, n }) {
  const place = [city, country].filter(Boolean).join(', '); const q = hotel ? [hotel, place].filter(Boolean).join(', ') : place;
  return [['Google', `https://www.google.com/travel/hotels?q=${enc(`${hotel ? q : 'hotels in ' + place} ${fullDay(d1)} to ${fullDay(d2)}`)}`],
    ['Expedia', `https://www.expedia.com/Hotel-Search?destination=${enc(place || q)}&startDate=${d1}&endDate=${d2}&adults=${n}&rooms=1`, hotel ? t('{c} hotels', { c: city || place }) : ''],
    ['Booking.com', `https://www.booking.com/searchresults.html?ss=${enc(q)}&checkin=${d1}&checkout=${d2}&group_adults=${n}&no_rooms=1&group_children=0`]];
}
const seePricesHTML = (p, cls = 'mini-b') => `<details class="menu sp-menu"><summary class="${cls}">${t('See prices')}</summary><div class="menu-pop" role="menu">${priceLinks(p).map(([name, url, sub]) => `<a role="menuitem" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-sp="${esc(name)}">${esc(name)}${sub ? ` <small class="muted">${esc(sub)}</small>` : ''}</a>`).join('')}<small class="sp-when muted">${esc([dateRange(p.d1, p.d2), t('{n} guests', { n: p.n })].join(' · '))}</small></div></details>`;
// a hotel's nights: the route leg it sits in (closest stop with dates), else the guest's trip dates
function hotelNights(cfg, h) {
  const tr = tripDates(cfg); const ss = stopsOf(cfg).filter(s => s.lat != null && s.from && s.to && s.to > s.from);
  const s = h && h.lat != null && ss.length ? ss.slice().sort((a, b) => distM(a.lat, a.lon, h.lat, h.lon) - distM(b.lat, b.lon, h.lat, h.lon))[0] : null;
  const v = cfg.venue || {}; const leg = s && distM(s.lat, s.lon, h.lat, h.lon) < 60000 ? s : null;
  return { d1: leg ? leg.from : tr.arrive, d2: leg ? leg.to : tr.leave, n: tr.guests || 2, city: (leg && (leg.city || leg.name)) || h.city || v.city || '', country: (leg && leg.country) || v.country || '' };
}
const hotelPrices = (cfg, h) => seePricesHTML({ hotel: h.name, ...hotelNights(cfg, h) });
const brandBook = (cfg, h) => { const b = hotelBrand(h.name); if (!b && !(h.web || h.website)) return ''; const a = hotelBookAction(cfg, h); return ext(a.url, a.label, 'mini-b'); };
const hsPlace = (h) => ({ src: h.g && h.g.gid ? 'g' : 'osm', ref: (h.g && h.g.gid) || '', name: h.name, addr: h.address || [h.street, h.city].filter(Boolean).join(', '), lat: h.lat, lon: h.lon });
function hotelsHTML(cfg, data) {
  const v = cfg.venue; const tr = tripDates(cfg);
  if (!data.hotels.length) return `<p class="muted">${t('No hotels are mapped within 3 km of the venue. Try the searches above.')}</p>`;
  const art = data.__art; const rows0 = data.hotels.slice(0, 30).map(h => ({ ...h, rating: (h.g && h.g.rating) || h.rating || 0, count: (h.g && h.g.count) || h.count || 0, price: (h.g && h.g.price) || h.price || '' }));
  if (art) return nearListRegister(art, 'hotels', cfg, rows0, (h, fold) => `<li${fold ? ' class="more"' : ''}>
    <div><b>${esc(h.name)}</b><span>${esc([t(h.kind), h.stars ? `${h.stars}★` : '', h.rating ? `★ ${nfix(h.rating, 1)}` : '', h.price].filter(Boolean).join(' · '))}</span>
      <div class="mini">${cfg.tools.mytrip ? hsSlotHTML(cfg, hsPlace(h), true) : ''}${hotelPrices(cfg, h)}${brandBook(cfg, h)}<button type="button" class="mini-b" ${h.g && h.g.gid ? `data-gpid="${esc(h.g.gid)}"` : `data-place="${esc(placeKey(h))}"`}>${t('Details')}</button>${h.website ? ext(h.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(h.d, v.cc))}<small>${h.d < 2000 ? walkTxt(h.d) : t('from the venue')}</small></span></li>`, { more: 3, walkLabel: t('Walking distance'), hotel: true });
  const hs = data.hotels.slice(0, 8);
  return `<ul class="plist rich">${hs.map((h, i) => `<li${i >= 3 ? ' class="more"' : ''}>
    <div><b>${esc(h.name)}</b><span>${esc([t(h.kind), h.stars ? `${h.stars}★` : ''].filter(Boolean).join(' · '))}</span>
      <div class="mini">${cfg.tools.mytrip ? hsSlotHTML(cfg, hsPlace(h), true) : ''}${hotelPrices(cfg, h)}${brandBook(cfg, h)}<button type="button" class="mini-b" ${h.g && h.g.gid ? `data-gpid="${esc(h.g.gid)}"` : `data-place="${esc(placeKey(h))}"`}>${t('Details')}</button>${h.website ? ext(h.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(h.d, v.cc))}<small>${h.d < 2000 ? walkTxt(h.d) : t('from the venue')}</small></span></li>`).join('')}${hs.length > 3 ? `<li class="more-li"><button type="button" class="btn sm" data-more>${t('All {n} hotels', { n: hs.length })}</button></li>` : ''}</ul>`;
}
// Temperatures are fetched in °F (packing hints compare in °F) and shown in the guest's unit: their saved choice
// (global, every page), else their locale's (°F for US-region / plain English browsers, °C elsewhere).
const F_REGIONS = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH']);
function tempUnit() {
  const s = LS.get('tempUnit'); if (s === 'F' || s === 'C') return s;
  const loc = String((navigator.languages && navigator.languages[0]) || navigator.language || ''); if (!loc) return 'F';
  const [lang, ...rest] = loc.split(/[-_]/); const region = rest.find(p => /^[A-Za-z]{2}$/.test(p));
  if (region) return F_REGIONS.has(region.toUpperCase()) ? 'F' : 'C';
  return lang.toLowerCase() === 'en' ? 'F' : 'C';
}
const fmtTemp = (f, u = tempUnit()) => Math.round(u === 'C' ? (f - 32) * 5 / 9 : f);
const tempUnitsHTML = (u = tempUnit()) => `<div class="wx-units" role="group" aria-label="${esc(t('Temperature unit'))}">${['F', 'C'].map(k => `<button type="button" data-tunit="${k}" aria-pressed="${u === k}">°${k}</button>`).join('')}</div>`;
function repaintTemps(focusUnit) {
  document.querySelectorAll('[data-slot="weather"]').forEach(s => {
    if (!s._wx) return; s.innerHTML = weatherHTML(s._wx, s._cfg);
    if (focusUnit && s._focus) { const b = s.querySelector(`[data-tunit="${focusUnit}"]`); if (b) b.focus(); }
    s._focus = false;
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-tunit]'); if (!b) return;
  const s = b.closest('[data-slot="weather"]'); if (s) s._focus = document.activeElement === b;
  LS.set('tempUnit', b.dataset.tunit); repaintTemps(b.dataset.tunit);
});
window.addEventListener('storage', (e) => { if (e.key === 'ep:tempUnit') repaintTemps(); });
function weatherHTML(w, cfg) {
  const u = tempUnit();
  const heads = { forecast: t('Forecast'), recent: t('Recent weather'), past: t('What the weather was'), typical: t('Typical for these dates · {a}–{b} average', { a: w.from, b: w.to }) };
  return `<div class="wx-top"><p class="wx-head"><span class="lbl">${esc(heads[w.kind])}</span>${w.partial ? `<span class="muted small">${t('Later days appear as they come into the 16-day forecast.')}</span>` : ''}</p>${tempUnitsHTML(u)}</div>
  <div class="wx">${w.days.map(d => {
    const [label, ic] = w.kind === 'typical' ? (d.wet / (d.of || 1) >= 0.5 ? ['Often wet', 'rain'] : d.wet ? ['Mostly dry', 'part'] : ['Usually dry', 'sun']) : WMO(d.code);
    return `<div class="wx-d"><span class="wx-date">${esc(fmt(d.date, { weekday: 'short' }))}<small>${esc(fmt(d.date, { month: 'short', day: 'numeric' }))}</small></span>${icon(ic)}
      <span class="wx-t"><b>${fmtTemp(d.hi, u)}°</b><span>${fmtTemp(d.lo, u)}°${u}</span></span>
      <span class="wx-x">${w.kind === 'typical' ? t('Rain {n} of {m} yrs', { n: d.wet, m: d.of }) : w.kind === 'past' ? `${d.precip ? (u === 'C' ? nfix(d.precip * 25.4, d.precip * 25.4 < 10 ? 1 : 0) + ' mm' : nfix(d.precip, 2) + ' in') : t('Dry')}` : d.pop != null ? t('{n}% rain', { n: d.pop }) : esc(t(label))}</span>
      <span class="wx-l">${esc(t(label))}</span></div>`;
  }).join('')}</div>`;
}

async function shareEvent(cfg, opts) {
  const url = opts.shareUrl || location.href;
  if (navigator.share) { try { await navigator.share({ title: cfg.title, text: cfg.tagline || cfg.title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copy(url);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(t('Link copied')); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(t('Link copied')); } catch { toast(t('Copy failed. Select the link and copy it.')); } ta.remove(); }
}

// ---------- landing ----------
function renderLanding() {
  LANG = uiLang(); document.documentElement.lang = LANG; document.documentElement.dir = 'ltr';
  document.title = '1LinkTrip — ' + t('one link for your guests’ whole trip');
  const draft = LS.get('draft');
  $('#app').innerHTML = `
  <main class="land home">
    <header class="land-top"><a class="brand" href="#">${BRAND}</a><span class="land-nav"><a class="link" href="#mine">${t(LS.get('signedIn') ? 'My pages' : 'Sign in')}</a><button type="button" class="btn sm" id="share-app" aria-label="${t('Share')}"><svg class="share-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16"/></svg><span class="share-lbl">${t('Share')}</span></button><a class="btn primary top-cta" href="#setup" aria-hidden="true" tabindex="-1">${t('Create a page')}</a></span></header>
    <section class="land-hero">
      <div class="land-copy">
        <h1>${t('One link for your guests’ whole trip.')}</h1>
        <p class="lede">${t('Add your event and venue. Guests get your schedule, directions and places to stay.')}</p>
        <div class="btns"><a class="btn primary big" id="hero-cta" href="#setup">${t('Create a page')}</a></div>
        <p class="muted small">${t('Free, no account needed.')} <a class="link" href="#examples">${t('See examples')}</a></p>
      </div>
    </section>
    ${myPagesHTML()}
    <section class="land-what">
      <h2>${t('What your guests get')}</h2>
      <dl>
        <div><dt>${t('Weather')}</dt><dd>${t('The forecast for your dates.')}</dd></div>
        <div><dt>${t('Map')}</dt><dd>${t('The venue and what’s around it.')}</dd></div>
        <div><dt>${t('Flights')}</dt><dd>${t('The nearest airports and fares.')}</dd></div>
        <div><dt>${t('Getting around')}</dt><dd>${t('Directions, transit, rideshare and rental cars.')}</dd></div>
        <div><dt>${t('Hotels')}</dt><dd>${t('Places to stay near the venue.')}</dd></div>
        <div><dt>${t('Food')}</dt><dd>${t('Restaurants and bars in the area.')}</dd></div>
        <div><dt>${t('Things to do')}</dt><dd>${t('Tours, sights and activities.')}</dd></div>
        <div><dt>${t('Event details')}</dt><dd>${t('RSVP, dress code, packet pickup and more.')}</dd></div>
        <div><dt>${t('Full itinerary')}</dt><dd>${t('Their bookings and your schedule in one place.')}</dd></div>
      </dl>
    </section>
  </main>`;
  wireLanding(); wireHomeHeader();
}
// One "Create a page" at a time: the header button shows only while the hero button is scrolled off-screen.
// The header turns sticky with a bottom rule once the page scrolls (styles in home.css).
let homeIO = null;
function homeScroll() { const top = $('.land.home .land-top'); if (top) top.classList.toggle('scrolled', scrollY > 4); }
addEventListener('scroll', homeScroll, { passive: true });
function wireHomeHeader() {
  if (homeIO) { homeIO.disconnect(); homeIO = null; }
  $('#share-app')?.addEventListener('click', async () => { // share 1LinkTrip itself (installed home-screen app has no browser share icon)
    const url = siteBase();
    if (navigator.share) { try { await navigator.share({ title: '1LinkTrip', text: 'One link for your guests’ whole trip.', url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    copy(url);
  });
  const top = $('.land.home .land-top'), cta = top && top.querySelector('.top-cta'), hero = $('#hero-cta'); if (!cta || !hero) return;
  const set = (show) => { top.classList.toggle('show-cta', show); cta.setAttribute('aria-hidden', show ? 'false' : 'true'); cta.tabIndex = show ? 0 : -1; };
  if (!('IntersectionObserver' in window)) { set(true); return; }
  homeIO = new IntersectionObserver((es) => set(!es[es.length - 1].isIntersecting), { rootMargin: `-${top.offsetHeight}px 0px 0px 0px`, threshold: 0 });
  homeIO.observe(hero); homeScroll();
}
// ---------- viewer ----------
// ---------- builder ----------
async function pinPlace(k, btn) {
  const c = B.cfg; const x = c.x[c.type] || {}; const p = x[k]; if (!p || !p.q || p.q.trim().length < 3) { toast(t('Type a place first')); return; }
  btn.disabled = true; btn.textContent = t('Finding…');
  try {
    const near = c.venue ? `${p.q}, ${c.venue.city || ''}` : p.q;
    let r = await geocode(near); if (!r.length && near !== p.q) r = await geocode(p.q);
    if (!r.length) { toast(t('No match. Add a street or landmark.')); btn.textContent = t('Pin on map'); }
    else { x[k] = { q: p.q, lat: r[0].lat, lon: r[0].lon }; btn.textContent = t('Pinned'); changed(); }
  } catch { toast(t('Search is unavailable right now')); btn.textContent = t('Pin on map'); }
  btn.disabled = false;
}
// ================= messages: guest ↔ host threads, guest groups, updates for chosen groups (schema-3; hidden until installed) =================
// Who may read what is enforced on the server (supabase/schema-3.sql). The page only shows what those rules return.
let msgReadyP = null;
function msgReady() {
  if (!SB) return Promise.resolve(false);
  const c = LS.get('msgReady'); if (c && Date.now() - c.t < (c.ok ? 3600e3 : 300e3)) return Promise.resolve(c.ok);
  // 200 = the tables exist; 404 (not installed yet), 401/403 or offline = keep everything hidden
  return msgReadyP || (msgReadyP = fetchTimeout(`${SB.url}/rest/v1/event_groups?select=id&limit=1`, { headers: { apikey: SB.key, Accept: 'application/json' } }, 8000)
    .then(r => r.status === 200).catch(() => false).then(ok => { LS.set('msgReady', { t: Date.now(), ok }); msgReadyP = null; return ok; }));
}
const msgReadyNow = () => { const c = LS.get('msgReady'); return !!(c && c.ok); };
let notifyP = null;
function notifyReady() {
  const c = LS.get('notifyReady'); if (c && Date.now() - c.t < (c.ok ? 3600e3 : 600e3)) return Promise.resolve(c.ok);
  return notifyP || (notifyP = fetchTimeout(`${SB.url}/functions/v1/notify`, {}, 8000).then(r => r.status === 200 || r.status === 401).catch(() => false)
    .then(ok => { LS.set('notifyReady', { t: Date.now(), ok }); notifyP = null; return ok; }));
}
// email is the extra; the message or update is already saved and shows in the app either way
async function notifyEmail(kind, id) {
  try {
    if (!id || !SB || !(await notifyReady())) return;
    const c = await sb(); const { data } = await c.auth.getSession(); const tok = data && data.session && data.session.access_token; if (!tok) return;
    await fetchTimeout(`${SB.url}/functions/v1/notify`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, apikey: SB.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id }) }, 15000);
  } catch { /* in-app delivery already happened */ }
}
// where a guest returns after signing in on a hosted page: the same page and tab
const hostedBack = (art) => { const p = art && art.querySelector('.ev-panel:not([hidden])'); const k = p ? p.dataset.panel : 'event'; return '?e=' + enc(locQ().get('e') || '') + (k && k !== 'event' ? '#t=' + k : ''); };
const msgSignInHTML = () => `<div class="bk-signin gm-signin"><p><b>${t('Sign in first.')}</b></p>${signInFormHTML('')}</div>`;
const msgListHTML = (rows, cfg, host) => rows.length ? `<ul class="msg-list">${rows.map(r => {
  const mine = host ? r.from_host : !r.from_host; const who = r.from_host ? (host ? t('You') : (cfg.host || t('Host'))) : (host ? (r.guest_name || r.guest_email || t('Guest')) : t('You'));
  return `<li class="msg ${mine ? 'out' : 'in'}"><span class="who">${esc(who)} · <time>${esc(fmtStamp(r.created_at))}</time></span><p>${esc(r.body)}</p></li>`; }).join('')}</ul>` : '';
const msgComposeHTML = (key, label, btn) => `<div class="msg-compose"><textarea id="gm-${key}" rows="2" maxlength="2000" aria-label="${esc(label)}" placeholder="${esc(label)}"></textarea><button type="button" class="btn primary" data-gm-send="${key}">${esc(btn)}</button></div><p class="hint" data-gm-msg role="status" aria-live="polite"></p>`;

// ---------- guest side: "Message the host" on the Event tab, "Messages" on My trip, group picker in RSVP ----------
async function myGuestUser() { if (!LS.get('signedIn')) return null; try { return await sbUser(); } catch { return null; } }
async function setMyGroup(eventId, gid, user) {
  const c = await sb(); const email = String(user.email || '').toLowerCase(); if (!email) return;
  await c.from('event_group_members').delete().eq('event_id', eventId).eq('email', email).eq('added_by', 'guest');
  if (gid) await c.from('event_group_members').insert({ event_id: eventId, group_id: gid, email, added_by: 'guest' });
}
function wireGuestMsgs(cfg, art, hosted) {
  msgReady().then(async (ok) => {
    if (!ok || !document.body.contains(art)) return;
    const G = { user: null, rows: [], anns: [], groups: [], picks: [] };
    art._gm = G;
    // groups a guest may pick at RSVP (public list; host-only groups stay hidden)
    rest(`event_groups?event_id=eq.${enc(hosted.id)}&self_pick=eq.true&select=id,name,sort&order=sort.asc,name.asc`).then(rows => { G.picks = rows || []; art._fillPick && art._fillPick(); }).catch(() => {});
    G.user = await myGuestUser();
    const pend = LS.get('grpPick:' + hosted.id);
    if (G.user && pend) setMyGroup(hosted.id, pend, G.user).then(() => { LS.del('grpPick:' + hosted.id); load(); }).catch(() => {});
    const evBody = art.querySelector('.ev-panel[data-panel="event"] .ev-body'); const tripBody = art.querySelector('.ev-panel[data-panel="mytrip"] .ev-body');
    const on = !!cfg.guestMessages;
    if (on && evBody && !art.querySelector('#sec-gm')) {
      const html = sec('gm', t('Message the host'), '<div data-slot="gm-ev"></div>');
      const after = evBody.querySelector('#sec-rsvp'); if (after) after.insertAdjacentHTML('afterend', html); else evBody.insertAdjacentHTML('beforeend', html);
    }
    if (tripBody && G.user && !art.querySelector('#sec-gmt')) tripBody.insertAdjacentHTML('afterbegin', `<div data-slot="gm-trip-wrap"></div>`);
    const seenKey = 'msgSeen:' + hosted.id;
    const paint = () => {
      const ev = art.querySelector('[data-slot="gm-ev"]'); const wrap = art.querySelector('[data-slot="gm-trip-wrap"]');
      // a refresh never loses what the guest is typing
      const keep = $$('[data-gm-send]', art).map(b => { const ta = art.querySelector('#gm-' + b.dataset.gmSend); return ta && [ta.id, ta.value, document.activeElement === ta, ta.selectionStart]; }).filter(Boolean);
      const gname = (ids) => (ids || []).map(id => (G.groups.find(g => g.id === id) || {}).name).filter(Boolean).join(', ');
      const anns = G.anns.length ? `<ul class="ann-list gm-anns">${G.anns.map(a => `<li><time>${esc(fmtStamp(a.created_at))}${gname(a.group_ids) ? ' · ' + esc(gname(a.group_ids)) : ''}</time><p>${esc(a.body)}</p></li>`).join('')}</ul>` : '';
      const thread = msgListHTML(G.rows, cfg, false);
      if (ev) {
        if (!G.user) ev.innerHTML = msgSignInHTML();
        else if (!wrap) ev.innerHTML = `${anns}${thread}${msgComposeHTML('ev', t('Write a message'), t('Send'))}`; // no My trip tab: the whole thread lives here
        else ev.innerHTML = `${msgComposeHTML('ev', t('Write a message'), t('Send'))}${G.rows.length ? `<button type="button" class="btn sm" data-tab-go="mytrip">${esc(t('Messages'))} (${G.rows.length})</button>` : ''}`;
      }
      if (wrap) {
        const show = G.user && (on || G.rows.length || G.anns.length);
        wrap.innerHTML = show ? sec('gmt', t('Messages'), `${anns}${thread}${on ? msgComposeHTML('trip', t('Write a message'), t('Send')) : ''}`, 'gm-sec') : '';
      }
      keep.forEach(([id, v, f, pos]) => { const ta = art.querySelector('#' + id); if (!ta) return; ta.value = v; if (f) { ta.focus(); try { ta.setSelectionRange(pos, pos); } catch {} } });
      const newest = G.rows.filter(r => r.from_host).concat(G.anns).map(r => r.created_at).sort().pop() || '';
      const tab = art.querySelector('[data-tab-go="mytrip"][role="tab"]'); if (tab) tab.classList.toggle('has-new', !!newest && newest > (LS.get(seenKey) || ''));
      const tp = art.querySelector('.ev-panel[data-panel="mytrip"]'); if (tp && !tp.hidden && newest) { LS.set(seenKey, newest); if (tab) tab.classList.remove('has-new'); }
    };
    const load = async () => {
      if (!G.user) { paint(); return; }
      try {
        const c = await sb();
        const [m, a, g] = await Promise.all([
          c.from('event_messages').select('id,from_host,body,created_at').eq('event_id', hosted.id).eq('guest', G.user.id).order('created_at', { ascending: true }).limit(200),
          c.from('announcements').select('id,body,created_at,group_ids').eq('event_id', hosted.id).order('created_at', { ascending: false }).limit(30),
          c.from('event_groups').select('id,name').eq('event_id', hosted.id)]);
        if (m.error && tableMissing(m.error)) { LS.set('msgReady', { t: Date.now(), ok: false }); return; }
        G.rows = m.data || []; G.anns = (a.data || []).filter(x => (x.group_ids || []).length); G.groups = g.data || [];
      } catch { /* keep what is shown */ }
      if (document.body.contains(art)) paint();
    };
    paint(); load(); art._gmLoad = load;
    // simple refresh: on opening My trip, on coming back to the app, and every 30 s while My trip is open
    (art._showFns = art._showFns || []).push((k) => { if (k === 'mytrip') { load(); } });
    if (document._gmVis) document.removeEventListener('visibilitychange', document._gmVis); // one listener, for the page on screen
    document._gmVis = () => { if (!document.hidden && document.body.contains(art)) load(); }; document.addEventListener('visibilitychange', document._gmVis);
    const iv = setInterval(() => { if (!document.body.contains(art)) return clearInterval(iv); const tp = art.querySelector('.ev-panel[data-panel="mytrip"]'); if (!document.hidden && tp && !tp.hidden) load(); }, 30000);
    art.addEventListener('click', async (e) => {
      const sio = e.target.closest('.gm-signin [data-si-oauth]'); if (sio) { oauthSignIn(sio.dataset.siOauth); LS.set('afterSignIn', hostedBack(art)); return; }
      const b = e.target.closest('.gm-signin [data-si="send"], [data-gm-send]'); if (!b) return;
      if (b.dataset.si === 'send') { LS.set('afterSignIn', hostedBack(art)); signInSubmit(b.closest('.gm-signin')); return; }
      const box = b.closest('.ev-sec, [data-slot="gm-ev"]'); const ta = box.querySelector('textarea'); const hint = box.querySelector('[data-gm-msg]');
      const body = (ta.value || '').trim().slice(0, 2000); if (!body) { ta.focus(); return; }
      b.disabled = true; hint.textContent = t('Sending…');
      try {
        const c = await sb(); const mine = LS.get('rsvp:' + hosted.id) || {}; const md = G.user.user_metadata || {};
        const { data, error } = await c.from('event_messages').insert({ event_id: hosted.id, body, guest_name: (mine.name || md.full_name || md.name || '').slice(0, 120) || null }).select('id,from_host,body,created_at').single();
        if (error) throw error;
        G.rows.push(data); ta.value = ''; paint(); notifyEmail('message', data.id);
        const h2 = art.querySelector(`[data-gm-send="${b.dataset.gmSend}"]`)?.closest('.ev-sec, [data-slot="gm-ev"]')?.querySelector('[data-gm-msg]'); if (h2) h2.textContent = t('Sent');
      } catch (err) {
        if (isNetErr(err)) { const mine = LS.get('rsvp:' + hosted.id) || {}; outboxAdd({ kind: 'msg', row: { event_id: hosted.id, body, guest_name: (mine.name || '').slice(0, 120) || null } }); G.rows.push({ id: 'q' + Date.now(), from_host: false, body, created_at: new Date().toISOString() }); ta.value = ''; paint(); hint.textContent = t('Saved on this device. It will be sent when you’re back online.'); return; }
        b.disabled = false; hint.textContent = t('Couldn’t send. Try again.');
      }
    });
    art.addEventListener('keydown', (e) => { if (e.target.id === 'si-email' && e.target.closest('.gm-signin') && e.key === 'Enter') { e.preventDefault(); LS.set('afterSignIn', hostedBack(art)); signInSubmit(e.target.closest('.gm-signin')); } });
  });
}
const groupPickHTML = (picks, cur) => picks.length ? `<div class="field"><label for="rs-group">${t('Group')}</label><select id="rs-group"><option value="">${t('Choose')}</option>${picks.map(g => `<option value="${esc(g.id)}" ${g.id === cur ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>` : '';

// ---------- host side: groups editor (builder card + My pages), inbox, Send to ----------
const parseEmails = (s) => [...new Set(String(s || '').toLowerCase().match(/[^\s,;<>"'()]+@[^\s,;<>"'()]+\.[a-z]{2,}/g) || [])].slice(0, 500);
async function loadGroups(c, eventId) {
  const [g, m] = await Promise.all([c.from('event_groups').select('id,name,self_pick,sort').eq('event_id', eventId).order('sort', { ascending: true }).order('name', { ascending: true }),
    c.from('event_group_members').select('group_id,email,added_by').eq('event_id', eventId).order('email', { ascending: true })]);
  if (g.error) throw g.error;
  return (g.data || []).map(x => ({ ...x, members: (m.data || []).filter(y => y.group_id === x.id) }));
}
function groupsEdHTML(groups) {
  return `<div class="grp-ed">${groups.map(g => `<div class="grp-card" data-gid="${esc(g.id)}">
      <div class="grp-h"><b>${esc(g.name)}</b><span class="muted small">${esc(g.members.length === 1 ? t('1 person') : t('{n} people', { n: g.members.length }))}</span></div>
      <label class="tool"><input type="checkbox" data-g-pick="${esc(g.id)}" ${g.self_pick ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${t('Guests can pick')}</label>
      <details class="grp-more"><summary>${t('Emails')}</summary>
        ${g.members.length ? `<ul class="grp-mem">${g.members.map(m => `<li><span>${esc(m.email)}</span><button type="button" class="link" data-g-rm="${esc(g.id)}" data-email="${esc(m.email)}" aria-label="${esc(t('Remove'))} ${esc(m.email)}">×</button></li>`).join('')}</ul>` : ''}
        <textarea rows="3" data-g-paste="${esc(g.id)}" aria-label="${esc(t('Emails, one per line'))}" placeholder="${esc(t('Emails, one per line'))}"></textarea>
        <div class="btns"><button type="button" class="btn sm" data-g-add="${esc(g.id)}">${t('Add emails')}</button><button type="button" class="link" data-g-del="${esc(g.id)}">${t('Delete group')}</button></div>
      </details></div>`).join('')}
    <div class="search grp-new"><input data-g-name maxlength="60" aria-label="${esc(t('Group name'))}" placeholder="${esc(t('Group name'))}"><button type="button" class="btn" data-g-new>${t('Add')}</button></div>
    <p class="hint" data-g-hint role="status" aria-live="polite"></p></div>`;
}
// one wiring for both places; `after` re-renders the host view once something changed
function wireGroupsEd(root, c, eventId, after) {
  if (root._gWired) return; root._gWired = true;
  const hint = (s) => { const h = root.querySelector('[data-g-hint]'); if (h) h.textContent = s; };
  root.addEventListener('change', async (e) => {
    const i = e.target.closest('[data-g-pick]'); if (!i) return;
    const { error } = await c.from('event_groups').update({ self_pick: i.checked }).eq('id', i.dataset.gPick); if (error) { hint(error.message); return; } after();
  });
  root.addEventListener('keydown', (e) => { if (e.target.matches('[data-g-name]') && e.key === 'Enter') { e.preventDefault(); root.querySelector('[data-g-new]').click(); } });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if ('gNew' in d) { const inp = root.querySelector('[data-g-name]'); const name = (inp.value || '').trim().slice(0, 60); if (!name) { inp.focus(); return; }
      b.disabled = true; const n = root.querySelectorAll('.grp-card').length;
      const { error } = await c.from('event_groups').insert({ event_id: eventId, name, sort: n }); b.disabled = false;
      if (error) { hint(error.code === '23505' ? t('You already have that group.') : error.message); return; } after(); }
    else if (d.gAdd) { const ta = root.querySelector(`[data-g-paste="${CSS.escape(d.gAdd)}"]`); const emails = parseEmails(ta.value); if (!emails.length) { ta.focus(); return; }
      b.disabled = true; const { error } = await c.from('event_group_members').upsert(emails.map(email => ({ event_id: eventId, group_id: d.gAdd, email, added_by: 'host' })), { onConflict: 'group_id,email', ignoreDuplicates: true }); b.disabled = false;
      if (error) { hint(error.message); return; } after(); }
    else if (d.gRm) { await c.from('event_group_members').delete().eq('group_id', d.gRm).eq('email', d.email); after(); }
    else if (d.gDel) { if (!confirm(t('Delete this group?'))) return; await c.from('event_groups').delete().eq('id', d.gDel); after(); }
  });
}
const sendToHTML = (groups) => groups.length ? `<div class="send-to"><span class="lbl-s">${t('Send to')}</span><div class="chips" role="group" aria-label="${esc(t('Send to'))}"><button type="button" class="chip on" data-st-all aria-pressed="true">${t('Everyone')}</button>${groups.map(g => `<button type="button" class="chip" data-st-g="${esc(g.id)}" aria-pressed="false">${esc(g.name)}</button>`).join('')}</div></div>` : '';
function wireSendTo(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-st-all],[data-st-g]'); if (!b) return;
    const all = root.querySelector('[data-st-all]'); const gs = $$('[data-st-g]', root);
    const set = (x, on) => { x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); };
    if ('stAll' in b.dataset) { set(all, true); gs.forEach(x => set(x, false)); return; }
    set(b, !b.classList.contains('on')); const any = gs.some(x => x.classList.contains('on')); set(all, !any);
  });
}
const sendToIds = (root) => $$('[data-st-g].on', root).map(x => x.dataset.stG);
function inboxHTML(rows, seen) {
  const th = new Map(); rows.forEach(r => { if (!th.has(r.guest)) th.set(r.guest, []); th.get(r.guest).push(r); });
  const list = [...th.entries()].map(([g, xs]) => ({ g, xs, last: xs[xs.length - 1], who: xs.find(x => !x.from_host) || {} })).sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
  if (!list.length) return `<p class="muted">${t('No messages yet.')}</p>`;
  return `<div class="inbox">${list.map(({ g, xs, last, who }) => { const unread = !last.from_host && last.created_at > ((seen || {})[g] || '');
    return `<details class="thr" data-thr="${esc(g)}"><summary><span class="thr-who"><b>${esc(who.guest_name || who.guest_email || t('Guest'))}</b>${who.guest_name && who.guest_email ? ` <span class="muted small">${esc(who.guest_email)}</span>` : ''}</span>${unread ? `<i class="dot" aria-label="${esc(t('New'))}"></i>` : ''}<span class="thr-last">${esc(last.body.slice(0, 90))}</span></summary>
      ${msgListHTML(xs, {}, true)}${msgComposeHTML('h-' + g, t('Reply'), t('Reply'))}</details>`; }).join('')}</div>`;
}

// ---------- router ----------
function renderBroken() {
  $('#app').innerHTML = `<main class="land"><header class="land-top"><a class="brand" href="#">${BRAND}</a></header><section class="broken"><h1>${t('This link is incomplete.')}</h1><p class="lede">${t('The event is stored inside the link, and part of it is missing. Ask whoever sent it to copy the whole link again.')}</p><a class="btn primary" href="#">${t('Go to 1LinkTrip')}</a></section></main>`;
}

// ================= v2: defaults, guest tabs, editor gallery, setup flow =================
// guest-interface strings go through t(); host content never does
let LANG = 'en';
const I18N = window.EP_I18N || {};
// the organizer's own screens (landing, setup, editor, My pages) follow the phone/browser language when it's an interface language
const uiLang = () => (navigator.languages || [navigator.language || 'en']).map(x => String(x).slice(0, 2).toLowerCase()).find(x => LOCALES[x]) || 'en';
const t = (s, vars) => { let r = (I18N[LANG] && I18N[LANG][s]) || s; if (vars) r = r.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); return r; };

const TOOLS = [['weather', 'Weather'], ['travel', 'Travel'], ['stay', 'Stay'], ['nearby', 'Nearby'], ['tours', 'Things to do'], ['mytrip', 'My trip'], ['packing', 'Packing list'], ['shopping', 'Shopping list']];
const TYPE_DEFAULTS = {
  Trip: { theme: { accent: '#1E7FA8', font: 'serif', mode: 'light' }, off: [], order: ['route', 'schedule', 'about', 'details', 'weather', 'access', 'rsvp'] },
  Wedding: { theme: { accent: '#0B7A75', font: 'serif', mode: 'light' }, off: [] },
  Race: { theme: { accent: '#2E7D32', font: 'wide', mode: 'light' }, off: ['tours'] },
  Conference: { theme: { accent: LAGOON, font: 'field', mode: 'light' }, off: ['packing'] },
  Concert: { theme: { accent: '#FF6B35', font: 'condensed', mode: 'dark' }, off: ['stay'] },
  Performance: { theme: { accent: '#6D28D9', font: 'classic', mode: 'light' }, off: ['stay'] },
  Hyrox: { theme: { accent: '#FFD100', font: 'condensed', mode: 'dark' }, off: ['tours'] },
  Festival: { theme: { accent: '#FF6B35', font: 'condensed', mode: 'dark' }, off: [] },
  'Sporting event': { theme: { accent: '#C2185B', font: 'condensed', mode: 'dark' }, off: ['stay', 'packing'] }
};
const typeDefaults = (type) => TYPE_DEFAULTS[type] || { theme: { accent: LAGOON, font: 'field', mode: 'light' }, off: [] };
const defaultTools = (type) => Object.fromEntries(TOOLS.map(([k]) => [k, k === 'shopping' ? type === 'Trip' : !typeDefaults(type).off.includes(k)])); // shopping list: trips only by default
const TYPE_ICONS = {
  Wedding: '<circle cx="9" cy="14" r="5"/><circle cx="15" cy="14" r="5"/><path d="M10 5l2-2 2 2-2 2z"/>',
  Race: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  Conference: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  Concert: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  Performance: '<path d="M3 4h18M4 4v3c0 2 2 3 4 3M20 4v3c0 2-2 3-4 3"/><path d="M12 8l-4 10h8z"/><path d="M3 21h18"/>',
  Hyrox: '<path d="M2 12h3M19 12h3"/><rect x="5" y="7" width="3" height="10" rx="1"/><rect x="16" y="7" width="3" height="10" rx="1"/><path d="M8 12h8"/>',
  Festival: '<path d="M3 20L12 4l9 16z"/><path d="M12 4v16M9 20l3-6 3 6"/>',
  'Sporting event': '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6c3.4 3.4 3.4 9.4 0 12.8M18.4 5.6c-3.4 3.4-3.4 9.4 0 12.8"/>',
  Trip: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V4h6v3M4 12h16"/>',
  Party: '<path d="M4 20l5-14 9 9z"/><path d="M14 3v2M19 8h2M17.5 4.5l-1.4 1.4"/>',
};
const SETUP_TYPES = [['Wedding', 'Wedding', 'RSVP, room block, dress code', '#0B7A75'], ['Race', 'Race', 'Start, finish, packet pickup', '#2E7D32'],
  ['Conference', 'Conference', 'Badges, agenda, speakers', LAGOON], ['Concert', 'Concert', 'Doors, set times, bag policy', '#FF6B35'],
  ['Festival', 'Festival', 'Stages, multi-day', '#B8860B'], ['Sporting event', 'Game day', 'Seats, tailgating, parking', '#C2185B'],
  ['Performance', 'Performance', 'Recital, show, call time', '#6D28D9'], ['Hyrox', 'Hyrox', 'Wave, check-in, bag drop', '#FFD100'],
  ['Party', 'Something else', 'Party, reunion, retreat', '#1F2937'], ['Trip', 'Vacation / Trip', 'Day by day, stays, packing', '#1E7FA8']];
// "Add to your page" cards: [id, title, subtitle, field keys]
const TYPE_CARDS = {
  Trip: [['route', 'Route', 'Cities and dates', []], ['companions', 'Travelling together', 'Who is coming', ['companions']]],
  Wedding: [['block', 'Room block', 'Hotel, code, deadline', ['blockHotel', 'blockUrl', 'blockCode', 'blockBy']],
    ['dress', 'Dress code', 'Attire', ['dress']], ['registry', 'Registry', 'Links', ['registry']]],
  Race: [['startfinish', 'Start and finish', 'Map pins', ['startAt', 'finishAt']], ['packet', 'Packet pickup', 'Where and when', ['packet', 'packetWhen']],
    ['course', 'Course map', 'Link, GPX or image', ['course']], ['spots', 'Spectator spots', 'Where to cheer', ['spots']], ['closures', 'Road closures', 'Roads, times', ['closures', 'closuresUrl']]],
  Concert: [['settimes', 'Set times', 'Doors, opener, headliner', ['doors', 'opener', 'openerAt', 'headliner', 'headlinerAt']], ['bags', 'Bag policy', 'What’s allowed', ['bags']],
    ['parking', 'Parking and pickup', 'Lots, rideshare', ['parking', 'pickup']], ['setlist', 'Setlist', 'Link', ['setlist']]],
  'Sporting event': [['seating', 'Seating chart', 'Link', ['seating']], ['teams', 'Teams', 'Links', ['teams']], ['tailgate', 'Tailgating and parking', 'Lots and times', ['tailgate', 'parking']], ['bags', 'Bag policy', 'What’s allowed', ['bags']]],
  Performance: [['showtimes', 'Show times', 'Call time, doors, showtime', ['performer', 'callTime', 'doors', 'showtime', 'slot']], ['program', 'Program and tickets', 'Run order, tickets', ['program', 'tickets']],
    ['etiquette', 'Flowers and photos', 'Gifts, photo rules', ['flowers', 'photo']], ['parking', 'Parking', 'Where to park', ['parking']]],
  Hyrox: [['wave', 'Wave and division', 'Start time, division', ['wave', 'division']], ['checkin', 'Check-in', 'Wristband pickup', ['checkin', 'checkinWhen']],
    ['bagdrop', 'Bag drop', 'Where, what to leave', ['bagdrop']], ['spectators', 'Spectators', 'Tickets, parking', ['spectators', 'parking']], ['results', 'Live results', 'Link', ['results']]],
  Conference: [['badge', 'Badge pickup', 'Where and when', ['badge', 'badgeWhen']], ['speakers', 'Speakers', 'One per line', ['speakers']], ['agenda', 'Full agenda', 'Link', ['agenda']]]
};
// the card a type field is edited on (the RSVP link and reply-by date live on the one RSVP card, for every type)
const RSVP_CARD = ['rsvp', 'RSVP', 'Replies or your link', ['rsvp', 'rsvpBy']];
const fieldCard = (c, k) => (TYPE_CARDS[c.type] || []).find(x => x[3].includes(k)) || (k === 'rsvp' || k === 'rsvpBy' ? RSVP_CARD : undefined);
const TYPE_GROUP = { Trip: 'For trips', Wedding: 'For weddings', Race: 'For races', Hyrox: 'For Hyrox', Concert: 'For concerts', Performance: 'For performances', 'Sporting event': 'For game day', Conference: 'For conferences' };
const COMMON_CARDS = [['schedule', 'Schedule', 'Times and places'], ['notes', 'Notes for guests', 'Kids, parking, FAQ'], ['about', 'About', 'Host, description'],
  ['bring', 'Must-bring items', 'Required items'], ['custom', 'Custom section', 'Your own heading and info'], ['langs', 'Guest languages', 'Translations']];
const CARD_ICONS = {
  rsvp: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>', block: '<path d="M3 20V9l9-5 9 5v11"/><path d="M9 20v-6h6v6"/>', dress: '<path d="M9 3l3 3 3-3 3 4-3 2v12H9V9L6 7z"/>',
  registry: '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8v13M3 12h18M12 8S8 3 6 5s6 3 6 3 8-1 6-3-6 3-6 3"/>', startfinish: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  packet: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>', course: '<path d="M4 18c3 0 3-6 6-6s3 6 6 6 2-3 4-3"/><circle cx="4" cy="18" r="1.5"/><circle cx="20" cy="15" r="1.5"/>',
  spots: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', closures: '<path d="M12 3l8 17H4z"/><path d="M8 13h8"/>',
  settimes: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', bags: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', parking: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7h3a3 3 0 0 1 0 6h-3"/>',
  setlist: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', seating: '<path d="M4 10h16M4 15h16M9 5v15M15 5v15"/><rect x="4" y="5" width="16" height="15" rx="2"/>',
  teams: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5"/>', tailgate: '<path d="M3 15l2-6h14l2 6v4H3z"/><circle cx="7" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/>',
  badge: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17h8"/>', speakers: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  showtimes: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', program: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  etiquette: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M9 7l1.5-3h3L15 7"/>',
  wave: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', checkin: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17h8"/>',
  bagdrop: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', spectators: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  results: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  agenda: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', notes: '<path d="M5 3h14v18H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', look: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-6-5-9 8"/>',
  bring: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', custom: '<path d="M4 5h16M4 10h10M4 15h7"/><path d="M17 13v8M13 17h8"/>', access: '<circle cx="12" cy="4.5" r="1.5"/><path d="M12 7v6h5l2 6M12 10H7"/><path d="M9 13a5 5 0 1 0 6 6"/>'
};
const cardIcon = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${CARD_ICONS[id] || CARD_ICONS.notes}</svg>`;

function blankEvent(type) {
  const s = addDays(todayYMD(), 30); type = type || 'Party';
  return { v: 2, type, title: '', tagline: '', host: '', description: '', start: s, end: '', tz: '', venue: null, cover: '',
    theme: { ...typeDefaults(type).theme }, tools: defaultTools(type), off: type === 'Trip' ? { rsvp: true } : {}, schedule: [], notes: [], x: {}, bring: '', custom: [] };
}
// a NEW page (setup, Start from a website / a document): RSVP starts off except on weddings (Dylan 11/24: "Leave off by
// default"); the organizer turns it on in Builder → RSVP. Not in blankEvent: normalize fills old pages from it, and pages
// already out there keep the RSVP they have.
const rsvpDefaultOff = (type) => type !== 'Wedding';
function freshEvent(type) { const c = blankEvent(type); if (rsvpDefaultOff(c.type)) c.off = { ...c.off, rsvp: true }; return c; }
// the organizer's own sections: cfg.custom = [{ id, title, text, label, url, img }]; on the page as section 'c-<id>'
const blankCustom = () => ({ id: Math.random().toString(36).slice(2, 8), title: '', text: '', label: '', url: '', img: '' });
const customSid = (x) => 'c-' + x.id;
function normCustom(xs) {
  const seen = new Set(); const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  return (Array.isArray(xs) ? xs : []).filter(x => x && typeof x === 'object').slice(0, 20).map((x, i) => {
    let id = typeof x.id === 'string' && /^[a-z0-9]{1,12}$/.test(x.id) ? x.id : 's' + i; while (seen.has(id)) id += 'x'; seen.add(id);
    return { id, title: str(x.title, 80), text: str(x.text, 3000), label: str(x.label, 80), url: str(x.url, 800), img: str(x.img, 800) };
  }).filter(x => x.title || x.text || x.label || x.url || x.img);
}
// Old links (v1) carried a `sections` list and a generic `links` list. Map them onto tools, notes and type cards so they open as before.
// a schedule item's own place (picked with Places search in the builder): { name, address, lat, lon, gid }, or null
function normSchedPlace(p) {
  if (!p || typeof p !== 'object') return null;
  const str = (v, n) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';
  const num = (v) => typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? +v : NaN;
  const o = { name: str(p.name, 120), address: str(p.address, 200) }; if (!o.name) o.name = o.address.slice(0, 120); if (!o.name) return null;
  const la = num(p.lat), lo = num(p.lon); if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) { o.lat = +la.toFixed(5); o.lon = +lo.toFixed(5); }
  if (typeof p.gid === 'string' && /^[\w-]{1,300}$/.test(p.gid)) o.gid = p.gid;
  return o;
}
// a schedule item's id: made once from what it says (so a guest's device and the organizer's make the same one before it is
// saved), kept from then on whatever the organizer changes; duplicates get the next one
const schedIdOf = (x, n) => 'sc' + Math.abs([...`${x.date || ''}|${x.time || ''}|${x.title || ''}|${n}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
function schedIds(sch) { const seen = new Set(); sch.forEach(x => { if (typeof x.id !== 'string' || !/^[\w-]{1,40}$/.test(x.id) || seen.has(x.id)) { let n = 0, id; do id = schedIdOf(x, n++); while (seen.has(id)); x.id = id; } seen.add(x.id); }); return sch; }
function normalize(c) {
  c = c || {}; const legacy = !(c.v >= 2);
  const b = blankEvent(c.type);
  if (legacy) {
    const secs = c.sections || []; const on = (id) => { const s = secs.find(x => x.id === id); return s ? !!s.on : undefined; };
    const d = defaultTools(c.type);
    const anyOf = (...ids) => { const vals = ids.map(on); return vals.some(x => x === true) ? true : vals.every(x => x === undefined) ? undefined : false; };
    c.tools = secs.length ? { weather: on('weather') ?? d.weather, travel: on('travel') ?? d.travel, stay: on('stay') ?? d.stay, nearby: anyOf('food', 'map', 'around') ?? d.nearby,
      tours: on('tours') ?? false, mytrip: on('itinerary') ?? true, packing: on('packing') ?? true } : d;
    c.off = { about: on('about') === false, schedule: on('schedule') === false, details: on('typeinfo') === false, notes: on('links') === false };
    const x = (c.x = c.x && typeof c.x === 'object' ? c.x : {}); const notes = [];
    for (const l of c.links || []) {
      if (!l || !l.label || !(l.url || l.note)) continue;
      if (c.type === 'Wedding') {
        const w = (x.Wedding = x.Wedding || {});
        if (/^rsvp$/i.test(l.label) && l.url && !w.rsvp) { w.rsvp = l.url; continue; }
        if (/^dress code$/i.test(l.label) && l.note && !w.dress) { w.dress = l.note; continue; }
        if (/^registry$/i.test(l.label) && l.url) { (w.registry = w.registry || []).push({ label: 'Registry', url: l.url }); continue; }
      }
      notes.push({ label: l.label, url: l.url || '', text: l.note || '' });
    }
    c.notes = (c.notes || []).concat(notes); delete c.sections; delete c.links; c.v = 2;
  }
  c = { ...b, ...c, theme: { ...b.theme, ...(c.theme || {}) } };
  if (/^#1f3a2e$/i.test(c.theme.accent || '')) c.theme.accent = LAGOON; // pages saved with the old Forest default
  c.tools = { ...defaultTools(c.type), ...(c.tools || {}) };
  c.off = c.off || {}; c.notes = Array.isArray(c.notes) ? c.notes : []; c.schedule = Array.isArray(c.schedule) ? c.schedule.filter(x => x && typeof x === 'object') : [];
  schedIds(c.schedule); // a stable id per item (a guest's personal copy refers to it)
  schedFlightFix(c.schedule); // a flight line's arrival day from both airports' time zones (HND→JFK lands the same day)
  c.schedule.forEach(x => { if (x.place === undefined) return; const p = normSchedPlace(x.place); if (p) x.place = p; else delete x.place; }); // an item at its own place
  c.x = c.x && typeof c.x === 'object' ? c.x : {}; c.bring = typeof c.bring === 'string' ? c.bring : '';
  c.custom = normCustom(c.custom);
  if (c.files !== undefined) { c.files = normFiles(c.files); if (!c.files.length) delete c.files; } // attached documents (only on pages that have some)
  c.lang = typeof c.lang === 'string' && /^[a-z]{2,3}$/.test(c.lang) ? c.lang : 'en';
  c.langs = Array.isArray(c.langs) ? c.langs.filter(l => typeof l === 'string' && /^[a-z]{2,3}$/.test(l) && l !== c.lang).slice(0, 12) : [];
  if (c.tr && typeof c.tr === 'object') { const tr = {}; for (const [l, m] of Object.entries(c.tr)) { if (!/^[a-z]{2,3}$/.test(l) || !m || typeof m !== 'object') continue; tr[l] = {}; for (const [k, e] of Object.entries(m)) if (e && typeof e.t === 'string' && typeof e.h === 'string') tr[l][k] = { h: e.h, t: e.t.slice(0, 6000), ...(e.o ? { o: true } : {}) }; } c.tr = tr; } else c.tr = {};
  c.stops = Array.isArray(c.stops) ? c.stops.filter(x => x && typeof x === 'object').slice(0, 20) : [];
  c.stops.forEach((x, i) => { if (typeof x.id !== 'string' || !/^[\w-]{1,40}$/.test(x.id)) x.id = 'st' + i + Math.abs([...String(x.name || '') + (x.from || '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36).slice(0, 6); });
  { const seen = new Set(); c.stops.forEach((x, i) => { if (seen.has(x.id)) x.id += '-' + i; seen.add(x.id); }); }
  sortStops(c); // stops are in date order everywhere (an old page could keep a stop added later at the end); ids go with them
  if (c.shifts !== undefined) { c.shifts = Array.isArray(c.shifts) ? c.shifts.filter(x => x && typeof x.id === 'string' && /^[\w-]{1,40}$/.test(x.id) && Number.isInteger(x.d) && Math.abs(x.d) <= 800 && (x.from === '' || isoDay(x.from))).map(x => ({ id: x.id, from: x.from, d: x.d })).slice(-20) : []; if (!c.shifts.length) delete c.shifts; } // Move trip dates: guests' saved places follow
  if (c.logo !== undefined && !(typeof c.logo === 'string' && /^https:\/\/\S+$/.test(c.logo) && c.logo.length < 2000)) delete c.logo; // brand logo (Design → Match your brand)
  if (c.flyInto !== undefined) { const f = typeof c.flyInto === 'string' ? c.flyInto.trim().toUpperCase() : ''; if (f === 'NONE') c.flyInto = 'none'; else if (/^[A-Z]{3}$/.test(f) && c.venue && (!window.AIRPORTS || airportByCode(f))) c.flyInto = f; else delete c.flyInto; } // the organizer's "Fly into" airport (builder → When and where)
  if (c.rsvpq !== undefined) c.rsvpq = normRsvpq(c.rsvpq); // RSVP form questions (builder → RSVP)
  if (c.rsvpVia !== undefined && c.rsvpVia !== 'form' && c.rsvpVia !== 'link') delete c.rsvpVia; rsvpMigrate(c); // the one RSVP card: form or own link
  if (c.presets !== undefined) { c.presets = normPresets(c.presets); if (!c.presets.length) delete c.presets; } // stay options guests pick in Make it mine (builder → Stay options)
  if (c.off.mine != null) c.off.mine = !!c.off.mine;
  delete c.osm; // hosted pages store a nearby-places snapshot beside the config; it never travels in links or drafts
  return c;
}

// ---------- guest view ----------
const TABS = [['event', 'Event'], ['travel', 'Travel'], ['nearby', 'Nearby'], ['mytrip', 'My trip']];
const TAB_ICONS = {
  event: '<path d="M6 21V4"/><path d="M6 4h12l-2.5 4.5L18 13H6"/>',
  travel: '<path d="M2 16l20-6-3-3-6 2-6-5-2 1 4 6-4 1-2-2-1 1z"/>',
  nearby: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  mytrip: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M8 12l2.5 2.5L16 9"/>'
};
function tabsFor(cfg) {
  const v = cfg.venue, T = cfg.tools;
  return TABS.filter(([k]) => k === 'event' || (k === 'travel' && v && (T.travel || T.stay)) || (k === 'nearby' && v && (T.nearby || T.tours)) || (k === 'mytrip' && cfg.start && (T.mytrip || T.packing || T.shopping)));
}
// host on-page editing (builder preview only): helpers tag editable items with data-ed while ONP is set; the guest page never sets it
let ONP = false;
const edA = (v) => ONP ? ` data-ed="${esc(v)}"` : '';
const sec = (id, title, body, cls = '') => body ? `<section class="ev-sec ${cls}" id="sec-${id}" data-sec="${id}"><h2 class="sec-h">${esc(title)}</h2><div class="sec-b">${body}</div></section>` : '';
function notesHTML(cfg) {
  const ns = cfg.notes.filter(x => x.label && (x.url || x.text)); if (!ns.length) return '';
  return `<ul class="links">${ns.map(x => x.url
    ? `<li${edA('n:' + cfg.notes.indexOf(x))}><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(x.label)}</b><span>${x.text ? rtHTML(x.text) : esc(hostOf(x.url))}</span>${arrow}</a></li>`
    : `<li class="note"${edA('n:' + cfg.notes.indexOf(x))}><b>${esc(x.label)}</b><span>${rtBr(x.text)}</span></li>`).join('')}</ul>`;
}
function customSecHTML(cfg, sid) {
  const x = (cfg.custom || []).find(y => customSid(y) === sid); if (!x || !(x.title || '').trim() || cfg.off[sid]) return '';
  const img = httpsUrl(x.img), url = httpsUrl(x.url);
  const body = (img ? `<img class="cs-img" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '')
    + ((x.text || '').trim() ? `<div class="rm-box">${rtParas(x.text)}</div>` : '')
    + (url ? `<ul class="links"><li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><b>${esc((x.label || '').trim() || hostOf(url))}</b>${(x.label || '').trim() ? `<span>${esc(hostOf(url))}</span>` : ''}${arrow}</a></li></ul>` : '')
    + docsHTML(cfg, [sid]);
  return sec(sid, x.title, body, 'cs');
}
function needToKnowHTML(cfg) {
  const parts = [];
  if (!cfg.off.details) parts.push(typeInfoHTML(cfg, { skipBlock: !!(cfg.venue && cfg.tools.stay), mine: ONP ? null : mineKnow(cfg) }));
  if (!cfg.off.notes) parts.push(notesHTML(cfg));
  parts.push(docsHTML(cfg, detailDocSecs(cfg).filter(k => k === 'notes' ? !cfg.off.notes : !cfg.off.details)));
  return parts.filter(Boolean).join('');
}
function aboutHTML(cfg) {
  if (cfg.off.about || !(cfg.description || cfg.host)) return '';
  return `${cfg.host ? `<p class="host"><span class="lbl">${t('Hosted by')}</span> ${esc(cfg.host)}</p>` : ''}${cfg.description ? `<div class="rm-box">${rtParas(cfg.description)}</div>` : ''}`;
}
const scheduleSecHTML = (cfg) => sec('schedule', t(schedTitle(cfg)), `<div data-slot="sched-body">${scheduleHTML(cfg)}</div>` + (cfg.off.schedule ? '' : docsHTML(cfg, ['schedule'])) + (routeInItin(cfg) && !cfg.off.route ? docsHTML(cfg, ['route']).replace(/^<ul class="docs/, '<ul class="route-docs docs') : ''), isTrip(cfg) ? 'itin' : '');
// trips show their route (cities + dates) as the Itinerary's legs instead of a separate Route section
const routeInItin = (cfg) => isTrip(cfg) && stopsOf(cfg).length > 0;
// which leg a day belongs to: the stop whose stay covers it (leave day → next stop), else the nearest dated stop; -1 when no stop has dates
function legOf(ss, d) {
  const i = ss.findIndex(s => s.from && s.to && d >= s.from && d < s.to); if (i >= 0) return i;
  let best = -1, dist = Infinity;
  ss.forEach((s, j) => { if (!s.from) return; const e = s.to && s.to > s.from ? s.to : s.from; const x = d < s.from ? daysBetween(d, s.from) : d > e ? daysBetween(e, d) : 0; if (x < dist || (x === dist && d >= s.from)) { best = j; dist = x; } });
  return best;
}
// The guest Event tab is an overview (Dylan 12324/12330): one row per day that has plans ("Fri, Apr 2" + a one-line
// summary), tap to open it. Trips: a small city heading ("Kyoto · Apr 5–8", tap → Nearby) starts each city's days; no
// city tabs, no inline hotel/transport/restaurant blocks — a booking is one line ("Check in · Park Hotel Tokyo") that
// opens its sheet. Days start closed except one: today's (during the event), else the main day (the page's start date),
// else the first. The builder's on-page editing keeps every day open with its editing hooks.
const DAY_OPEN = new Map(); // itinKey → { 'YYYY-MM-DD': true | false } the guest's taps this session
function dayOpenDefault(cfg, ds) {
  if (ds.length < 2) return ds[0] || '';
  const today = todayYMD(cfg.tz); if (ds.includes(today)) return today;
  const main = (cfg.start || '').slice(0, 10); return ds.includes(main) ? main : ds[0];
}
const dayIsOpen = (cfg, d, def) => { const m = DAY_OPEN.get(itinKey(cfg)) || {}; return d in m ? m[d] : d === def; };
const shortRange = (s) => s.from ? dateRange(s.from, s.to && s.to > s.from ? s.to : s.from).replace(/, \d{4}$/, '') : '';
// one line per schedule row: the organizer's item, or the guest's own booking / saved spot
function schedLine(cfg, x) {
  if (x.ev) { const ev = cfg.schedule[x.si]; return ev && isHostHotel(ev) && hostHotelName(ev.title) !== String(ev.title || '').trim() ? t('Check in · {n}', { n: hostHotelName(ev.title) }) : x.name; }
  const nm = x.name || t(ITIN_KINDS[x.kind] || 'Booking');
  if (x.co) return t('Check out · {n}', { n: x.name || t(ITIN_KINDS[x.kind] || 'Hotel') });
  if (LODGE.has(x.kind)) return t('Check in · {n}', { n: nm });
  return nm;
}
// one schedule: the organizer's items, with the guest's own bookings mixed in. Every row opens its sheet.
function scheduleHTML(cfg) {
  const { evs, mine } = schedEntries(cfg);
  const legs = routeInItin(cfg) && !cfg.off.route ? stopsOf(cfg) : null;
  if (!evs.length && !mine.length && !legs) return ovHiddenHTML(cfg);
  const all = schedMerge(cfg, evs, mine);
  const days = {}; all.forEach(x => (days[(x.start || '').slice(0, 10)] = days[(x.start || '').slice(0, 10)] || []).push(x));
  const my = !ONP && mineOn(cfg) ? mineGet(cfg) : null; const away = (d) => !!my && !!d && (d < my.a || d > my.l); // Make it mine: days outside their stay
  const tm = (s) => fmtTime((s || '').slice(11, 16));
  const trip = isTrip(cfg);
  const dated = Object.keys(days).filter(Boolean).sort(); const def = dayOpenDefault(cfg, dated); const many = Object.keys(days).length > 1;
  const row = (x) => {
    const mark = (x.bk || (!x.ev && !x.co) ? ` <em class="yours">${t(x.pl ? 'Saved' : 'Yours')}</em>` : '') + ovRowTag(cfg, x) + schedHfBadge(cfg, x);
    const sub = x.ev && !trip && (x.note || x.place) ? (x.place && !(x.note || '').toLowerCase().includes(x.place.toLowerCase()) ? [esc(x.place), x.note ? rtHTML(x.note) : ''].filter(Boolean).join(' · ') : rtHTML(x.note)) : '';
    const inner = `<span class="tl-tx"><b>${esc(schedLine(cfg, x))}${mark}</b>${sub ? `<span>${sub}</span>` : ''}</span>`;
    return `<li class="${[x.ev && !x.bk ? '' : 'mine', x.co ? 'co' : '', x.kind ? 'k-' + esc(x.kind) : ''].filter(Boolean).join(' ')}"${x.ev ? edA('s:' + x.si) : ''}><time>${esc(tm(x.start)) || (trip ? '' : '—')}</time><div>${x.ref ? `<button type="button" class="tl-go" data-ds="${esc(x.ref)}">${inner}<i class="tl-chev" aria-hidden="true"></i></button>` : inner}</div></li>`;
  };
  const dayHTML = ([d, xs]) => {
    const open = !many || dayIsOpen(cfg, d, def);
    const title = d ? esc(fmt(d, { weekday: trip ? 'short' : 'long', month: 'short', day: 'numeric' })) : esc(t(trip ? 'Unscheduled' : 'Anytime'));
    const sum = esc(xs.map(x => schedLine(cfg, x)).join(' · '));
    const head = many ? `<button type="button" class="day-tog" data-day-tog="${esc(d)}" aria-expanded="${open}"><span class="day-t">${title}</span><span class="day-sum">${sum}</span><i class="cx-chev" aria-hidden="true"></i></button>` : `<span class="day-t">${title}</span>`;
    return `<div class="day dx${open ? ' open' : ''}${away(d) ? ' d-out' : ''}" data-day="${esc(d)}"><h3 class="day-h">${head}</h3><ol class="tl"${open ? '' : ' hidden'}>${xs.map(row).join('')}</ol></div>`;
  };
  let body;
  if (legs) { // a city heading where the city changes; its days under it, empty days left out
    const nb = tabsFor(cfg).some(x => x[0] === 'nearby'); const by = legs.map(() => []), rest = [];
    Object.entries(days).forEach(e => { const i = e[0] ? legOf(legs, e[0]) : -1; (i >= 0 ? by[i] : rest).push(e); });
    body = legs.map((s, i) => { const inner = `<b>${esc(s.name)}</b>${shortRange(s) ? `<small>${esc(shortRange(s))}</small>` : ''}`; const si = stopsOf(cfg).indexOf(s);
      const ea = edA('st:' + (cfg.stops || []).indexOf(s));
      const h = s.lat != null && nb ? `<button type="button" class="city-h" data-route-stop="${si}"${ea}>${inner}<i class="tl-chev" aria-hidden="true"></i></button>` : `<div class="city-h"${ea}>${inner}</div>`;
      return `<div class="city-g">${h}${by[i].map(dayHTML).join('')}</div>`; }).join('') + rest.map(dayHTML).join('');
  } else body = Object.entries(days).map(dayHTML).join('');
  return `<div class="sched-days dlist">${body}</div>${ovHiddenHTML(cfg)}`;
}
// an Event-tab row's cancellation badge: the guest's own hotel booking, else the organizer's check-in row
function schedHfBadge(cfg, x) {
  if (x.co) return '';
  const b = x.bk || (!x.ev && !x.pl && LODGE.has(x.kind) ? x : null);
  if (b) { const h = hfOfBk(b); return hfBadgeHTML(h, bkDay(b.end) || bkDay(b.start)); }
  const ev = x.ev ? cfg.schedule[x.si] : null; if (!ev || !isHostHotel(ev) || !(ev.cancelBy || ev.nonRef)) return '';
  const d = (x.start || '').slice(0, 10); const leg = d ? legOfDay(cfg, d) : null; return hfBadgeHTML(hfOfEv(ev), leg && leg.to > d ? leg.to : d);
}
function stubSideHTML(cfg, ap) {
  const v = cfg.venue;
  return ap ? `<span class="lbl">${t('Fly into')}</span><b class="code">${esc(ap.iata)}</b><small>${esc(t('{d} away', { d: fmtDist(ap.d, v.cc) }))}</small>` : (cfg.start ? `<span class="lbl">${esc(fmt(cfg.start.slice(0, 10), { weekday: 'short' }))}</span><b class="code">${esc(fmt(cfg.start.slice(0, 10), { month: 'short' }).toUpperCase())}</b><small class="big-day">${esc(fmt(cfg.start.slice(0, 10), { day: 'numeric' }))}</small>` : `<span class="lbl">${t('Date')}</span><b class="code">TBA</b>`);
}
// RSVP at the top: the organizer's own link, or a jump to the form (on the short link; the builder preview and the examples
// show it too). A long link has no form, so no button there.
const rsvpTopOK = (cfg, opts) => { const r = rsvpOf(cfg); return r.on && (r.via === 'link' || !!(opts.hosted || opts.preview || demoRsvp(cfg, opts))); };
function ticketHTML(cfg, air, opts = {}) {
  const v = cfg.venue; const R = rsvpOf(cfg);
  const rsvp = rsvpTopOK(cfg, opts);
  const sameDay = cfg.start && cfg.start.slice(0, 10) === (cfg.end || '').slice(0, 10);
  const dirModes = [['driving', 'Drive'], ['transit', 'Transit'], ['walking', 'Walk'], ['bicycling', 'Bike']];
  return `<section class="stub" aria-label="${t('Event summary')}">
      <div class="stub-main">
        <div class="stub-cell"><span class="lbl">${t('Date')}</span><b>${esc(dateRange(cfg.start, cfg.end))}</b>${countdown(cfg) ? `<small class="cd">${esc(countdown(cfg))}</small>` : ''}</div>
        ${cfg.start && cfg.start.length >= 16 ? `<div class="stub-cell"><span class="lbl">${sameDay || !cfg.end ? t('Time') : t('Starts')}</span><b>${esc(sameDay ? timeRange(cfg.start, cfg.end) : fmtTime(cfg.start.slice(11, 16)))}</b></div>` : ''}
        <div class="stub-cell wide"><span class="lbl">${t(isTrip(cfg) ? 'Destination' : 'Venue')}</span><b>${v ? esc(v.name) : t('To be announced')}</b>${v && v.address && v.address !== v.name ? `<small>${esc(v.address)}</small>` : ''}</div>
      </div>
      <div class="stub-tear" aria-hidden="true"></div>
      <div class="stub-side">
        ${stubSideHTML(cfg, v ? chosenAirport(cfg, air) : null)}
      </div>
      <div class="stub-actions">
        ${rsvp ? (R.via === 'link' ? ext(R.url, t('RSVP'), 'btn primary') : `<button type="button" class="btn primary" data-act="rsvp">${t('RSVP')}</button>`) : ''}
        ${cfg.start ? `<details class="menu"><summary class="btn ${rsvp ? '' : 'primary'}">${t('Add to calendar')}</summary><div class="menu-pop"><button type="button" data-act="ics">${t('Apple or Outlook (.ics)')}</button>${ext(L.gcal(cfg, location.href), t('Google Calendar'), '')}</div></details>` : ''}
        ${v ? `<details class="menu"><summary class="btn">${t('Directions')}</summary><div class="menu-pop">${dirModes.map(([m, l]) => ext(L.dir(v, m), t(l), '')).join('')}${ext(L.uber(v, v.name), 'Uber', '')}${LYFT_CC.has(v.cc) ? ext(L.lyft(v), 'Lyft', '') : ''}</div></details>` : ''}
        <button class="btn" data-act="share">${t('Share')}</button>
      </div>
    </section>`;
}
function tripBarHTML(cfg) {
  const tr = tripDates(cfg); const o = LS.get('origin'); const oa = o && airportByCode(o);
  return `<div class="tripbar">
    ${cfg.tools.travel ? `<div class="field origin"><label for="ep-origin">${t('From')}</label><div class="ac"><input id="ep-origin" autocomplete="off" placeholder="${t('City or airport code')}" value="${oa ? esc(`${oa[2] || oa[1]} (${oa[0]})`) : ''}"><ul class="ac-list" hidden></ul></div></div>` : ''}
    <div class="field"><label for="ep-arrive">${t('Arrival')}</label><input type="date" id="ep-arrive" data-k="arrive" value="${tr.arrive}"></div>
    <div class="field"><label for="ep-leave">${t('Departure')}</label><input type="date" id="ep-leave" data-k="leave" value="${tr.leave}"></div>
    <div class="field narrow"><label for="ep-guests">${t('Guests')}</label><input type="number" id="ep-guests" min="1" max="16" data-k="guests" value="${tr.guests}"></div>
  </div>`;
}
function travelTabHTML(cfg, air) {
  const v = cfg.venue; const T = cfg.tools; const out = [];
  out.push(`<div class="ev-sec trip-sec">${tripBarHTML(cfg)}${T.travel ? modeBarHTML(cfg, air) : ''}${canAddTrip(cfg) ? `<div class="btns add-bk"><button type="button" class="btn primary" data-addbooking>+ ${t('Add a booking')}</button></div>` : ''}</div>`);
  const parts = { fly: '<div data-slot="flights" data-mode="fly"></div>', train: hasTrains(v, cfg) ? '<div data-slot="trains" data-mode="train"></div>' : '', rental: '<div data-slot="rental" data-mode="rental"></div>',
    drive: `<div data-mode="drive"><h3 class="sub-h">${t('Driving')}</h3><div class="row-links">${ext(L.place('parking near ' + v.name, placeLabel(v)), `${t('Parking near the venue')} <small>Google Maps</small>`, 'row-link')}</div></div>`,
    transit: `<div data-mode="transit"><h3 class="sub-h">${t('Transit')}</h3><div data-slot="transit">${loading(t('nearby stations'))}</div></div>` };
  if (T.travel) out.push(sec('travel', t('Getting there'), modeOrder(cfg).map(k => parts[k]).join('\n')));
  if (T.stay) out.push(sec('stay', t('Where to stay'), `${roomBlockHTML(cfg)}<div class="row-links" data-slot="stay-links">${stayLinks(cfg)}</div>
    <div class="th-hotels">${thHead('hotels', `<h3 class="sub-h">${t('Hotels near the venue')}</h3>`, t('Hotels near the venue'))}<div data-slot="hotels">${loading(t('hotels'))}</div></div>`));
  if (T.travel || T.stay) out.push(`<div class="th-foot"><button type="button" class="btn sm th-show" data-th-show hidden></button></div>`);
  return out.join('');
}
// the room block's book-by date, saying plainly once it has passed
const blockByText = (by, f) => !by ? '' : by.slice(0, 10) < todayYMD() ? t('The book-by date ({d}) has passed', { d: f(by) }) : t('Book by {d}', { d: f(by) });
// the room block's room terms, short: "Free cancellation until Apr 10" / "Non-refundable"
const blockCancelText = (d) => { const h = hfOfBlock(d); return h.nonRef ? t('Non-refundable') : h.cancelBy ? `${t('Free cancellation until')} ${fmt(h.cancelBy.slice(0, 10), { month: 'short', day: 'numeric' })}` : ''; };
function roomBlockHTML(cfg) {
  if (cfg.type !== 'Wedding' || cfg.off.details) return '';
  const d = typeData(cfg); if (!(d.blockHotel || d.blockUrl || d.blockCode || d.blockBy)) return '';
  const sub = [d.blockCode ? t('Code {c}', { c: d.blockCode }) : '', d.blockRoom || '', blockByText(d.blockBy, (x) => fmt(x, { month: 'short', day: 'numeric' })), blockCancelText(d)].filter(Boolean).join(' · ');
  const inner = `<span><b>${esc(d.blockHotel || t('Room block'))}</b> <em class="badge">${t('Room block')}</em><small class="sub">${esc(sub)}</small>${d.blockNote ? `<small class="sub hf-n">${esc(d.blockNote)}</small>` : ''}</span>${d.blockUrl ? `<small>${t('Book')} ↗</small>` : ''}`;
  return `<div class="row-links block-row">${d.blockUrl ? `<a class="row-link hl" href="${esc(d.blockUrl)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<div class="row-link hl">${inner}</div>`}</div>`;
}
function nearbyTabHTML(cfg) {
  const T = cfg.tools; const out = [];
  if (T.nearby) out.push(sec('map', t('Map'), `<div class="map-off" data-slot="map-off"></div><div class="hotel-bar" data-slot="hotel"></div><div class="map-wrap"><div class="map" data-slot="map" role="region" aria-label="${t('Map of the venue and surroundings')}"></div><div class="map-key" data-slot="map-key"></div><div class="map-legend" data-slot="legend"></div></div>`));
  if (T.nearby) out.push(`<div class="ccb-wrap" data-slot="near-cc"><div class="map-cats" data-slot="map-cats" aria-hidden="true"></div></div>`); // city tabs, category chips, search + Filters: right under the map
  if (T.nearby) out.push(sec('food', t('Places nearby'), `<div data-slot="food">${loading(t('places to eat'))}</div>`));
  if (T.tours) out.push(sec('tours', t('Things to do'), toursHTML(cfg)));
  return out.join('');
}
function bookingsHTML(cfg) {
  const items = itinLoad(cfg); const air = cfg.tools && cfg.tools.travel ? airFor(cfg) : [];
  const order = items.map((x, i) => [x, i]).sort((a, b) => (a[0].start || '9999').localeCompare(b[0].start || '9999') || a[1] - b[1]); // by departure / start; i stays the stored index (Edit)
  const F = ccTrip(cfg);
  return `${air.length ? `<div class="ap-mine" data-slot="ap-mine">${apMineHTML(cfg, air, items)}</div>` : ''}${items.length ? `<ul class="plist rich bookings">${order.map(([x, i]) => {
    const fl = x.kind === 'flight' ? flightLinks(x.flight) : {};
    const when = x.start ? fmt(x.start.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' }) + (x.start.length > 10 ? ' · ' + fmtTime(x.start.slice(11, 16)) : '') + (x.kind === 'flight' && x.start.length > 10 && flightArrLabel(x) ? ' · ' + flightArrLabel(x) : '') : '';
    const via = viaOf(x); const viaUrl = via && via.url;
    const links = [fl.status ? ext(fl.status, t('Flight status'), 'mini-b') : '', viaUrl ? ext(viaUrl, `${t('Manage booking')} · ${via.name}`, 'mini-b') : fl.manage ? ext(fl.manage, t('Manage booking'), 'mini-b') : '', x.link ? ext(x.link, t('Open booking'), 'mini-b') : ''].join('');
    const it = ccBkItem(cfg, x);
    return `<li data-cc-city="${it.city}" data-cc-cat="${it.cat}" data-cc-sub="${it.sub}" data-cc-text="${esc(it.text)}"${F.ok(it) ? '' : ' hidden'}><div>${x.id ? `<button type="button" class="pr-go bk-go" data-ds="bk:${esc(x.id)}">${thumbHTML(x, ccIk(it.cat, x))}<span class="pr-tx">` : '<span class="pr-tx">'}<b class="plan-t"><span>${esc(x.name || t(ITIN_KINDS[x.kind] || 'Booking'))}</span>${x.sh && x.sh.n ? `<em class="ov-upd">${esc(t('Updated'))}</em>` : ''}</b><span>${esc([t(ITIN_KINDS[x.kind] || ''), when].filter(Boolean).join(' · '))}</span>${via && via.name || x.confNo ? `<span class="bk-via">${esc([via && via.name ? t('via {s}', { s: via.name }) : via && via.key === 'direct' ? t('booked direct') : '', x.confNo ? t('Conf. {n}', { n: x.confNo }) : ''].filter(Boolean).join(' · '))}</span>` : ''}${bkOffTrip(cfg, x) ? `<span class="bk-warn">${esc(t('Not on the trip dates'))}</span>` : ''}${detVal(x, 'room') || (LODGE.has(x.kind) && hfBadge(hfOfBk(x), bkDay(x.end) || bkDay(x.start))) ? `<span class="bk-room">${esc(detVal(x, 'room') || '')}${LODGE.has(x.kind) ? hfBadgeHTML(hfOfBk(x), bkDay(x.end) || bkDay(x.start)) : ''}</span>` : ''}${x.note && !LODGE.has(x.kind) ? `<span class="pr-note">${rtHTML(x.note)}</span>` : ''}${x.id ? '</span><i class="tl-chev" aria-hidden="true"></i></button>' : '</span>'}<div class="mini">${links}<button type="button" class="mini-b" data-itin-edit="${i}">${t('Edit')}</button>${LODGE.has(x.kind) && x.id ? `<button type="button" class="mini-b bk-rm" data-bk-rm="${esc(x.id)}">${TRASH_IC}${t('Remove hotel')}</button>` : ''}</div></div></li>`;
  }).join('')}</ul>${ccNoneHTML().replace('class="muted cc-none"', `class="muted cc-none"${order.some(([x]) => F.ok(ccBkItem(cfg, x))) ? ' hidden' : ''}`)}` : ''}
  <div class="btns itin-btns"><button type="button" class="btn primary" data-itin-add>+ ${t('Add a booking')}</button>${items.length ? `<button type="button" class="btn" data-itin-ics>${t('Add to calendar')}</button>` : ''}</div><div data-slot="itin-form"></div>${cfg.demoTrip ? '' : fwdSlot(cfg)}`;
}
function myTripTabHTML(cfg) {
  const T = cfg.tools; const out = [];
  if (T.mytrip) out.push(shFromHTML(cfg));
  if (T.mytrip) out.push(`<div class="ccb-wrap" data-slot="trip-cc"></div>`);
  if (T.mytrip) out.push(sec('plan', t('Your itinerary'), planHTML(cfg)));
  if (T.mytrip && cfg.venue) out.push(sec('spots', t('Saved spots'), spotsHTML(cfg)));
  if (T.mytrip) out.push(sec('itinerary', t('Your bookings'), bookingsHTML(cfg)));
  if (T.shopping) out.push(shopSecHTML(cfg));
  if (T.packing) out.push(`<section class="ev-sec" id="sec-packing"><details class="pack-wrap"><summary><h2 class="sec-h">${t('Packing list')}</h2><span class="pack-sum" data-slot="pack-sum"></span></summary><div data-slot="pack-list"></div><div class="pack-add"><input placeholder="${t('Add an item')}" aria-label="${t('Add an item')}" maxlength="80"><button type="button" class="btn" data-pack-add>${t('Add')}</button></div></details>${docsHTML(cfg, ['bring'])}</section>`);
  return out.join('');
}
function eventTabHTML(cfg) {
  const parts = {
    route: () => routeInItin(cfg) ? '' : sec('route', t('Route'), routeGuestHTML(cfg) + (cfg.off.route ? '' : docsHTML(cfg, ['route']))),
    about: () => sec('about', t('About'), aboutHTML(cfg) + (cfg.off.about ? '' : docsHTML(cfg, ['about']))),
    details: () => sec('details', t('Need to know'), needToKnowHTML(cfg)),
    rsvp: () => '<div data-slot="rsvp-wrap"></div>',
    access: () => `<div data-slot="access-wrap">${accessHTML(cfg, null)}</div>`,
    schedule: () => `<div data-slot="schedule-wrap">${scheduleSecHTML(cfg)}</div>`,
    weather: () => cfg.venue && cfg.start && cfg.tools.weather ? sec('weather', t('Weather'), `<div data-slot="weather"><div class="skel" role="status"><span></span><span></span><em>${t('Loading weather…')}</em></div></div>`) : '',
  };
  // trips: the route lives inside the Itinerary, which takes whichever of the two slots comes first
  const o = sectionOrder(cfg); if (routeInItin(cfg) && o.indexOf('route') < o.indexOf('schedule')) { o.splice(o.indexOf('schedule'), 1); o.splice(o.indexOf('route'), 1, 'schedule'); }
  return o.map(id => parts[id] ? parts[id]() : customSecHTML(cfg, id)).join('');
}
// A trip whose destination is a country or region ("Japan") has no useful point for maps, searches or airports: use the
// first route stop's point instead (the destination name stays as written). Stops without a map point are found by city.
const isCoarseVenue = (v) => !!v && (!v.city || (!!v.country && v.name.trim().toLowerCase() === v.country.trim().toLowerCase()));
// Sample content from an example page ("Customize this" on Japan in spring): the example's own itinerary items and route
// stops, verbatim (date + time + title; name + dates). Once the trip's own plans (an imported document, the host's own
// items or stops) are wholly apart from them, they are stale placeholders: they opened the itinerary on the example's
// "Fri, Apr 2 · Land at Haneda" and stretched the trip's dates back to it. sampleDropped removes them, and dates that
// came from the sample become the trip's own span. A page still built on the example (sample overlaps its plans) is untouched.
let SAMPLE = null;
const sampleSets = () => {
  if (!SAMPLE) { SAMPLE = { s: new Set(), r: new Set() }; Object.values(window.EXAMPLES || {}).forEach(e => { (e.schedule || []).forEach(y => SAMPLE.s.add([y.date, y.time || '', y.title].join('|'))); (e.stops || []).forEach(y => SAMPLE.r.add([y.name, y.from || '', y.to || ''].join('|'))); }); }
  return SAMPLE;
};
const isSampleItem = (x) => !!x && sampleSets().s.has([x.date, x.time || '', x.title].join('|'));
const isSampleStop = (x) => !!x && sampleSets().r.has([x.name, x.from || '', x.to || ''].join('|'));
// the dates the page's sample content covers, or null
function sampleSpan(cfg) {
  const ds = (cfg.schedule || []).filter(isSampleItem).map(x => x.date).concat((cfg.stops || []).filter(isSampleStop).flatMap(x => [x.from, x.to])).filter(isoDay).sort();
  return ds.length ? [ds[0], ds[ds.length - 1]] : null;
}
// the page's own dates are still the example's (nothing but sample content set them)
function sampleDates(cfg) {
  const sp = isTrip(cfg) && sampleSpan(cfg); const s0 = (cfg.start || '').slice(0, 10), e0 = (cfg.end || cfg.start || '').slice(0, 10);
  return !!sp && isoDay(s0) && s0 >= addDays(sp[0], -3) && e0 <= addDays(sp[1], 3);
}
function sampleDropped(cfg) {
  if (!cfg || !isTrip(cfg)) return cfg;
  const sch = Array.isArray(cfg.schedule) ? cfg.schedule : [], st = Array.isArray(cfg.stops) ? cfg.stops : [];
  const ss = sch.filter(isSampleItem), sr = st.filter(isSampleStop); if (!ss.length && !sr.length) return cfg;
  const ownStops = st.filter(x => x && x.name && !isSampleStop(x)), ownItems = sch.filter(x => x && isoDay(x.date) && !isSampleItem(x));
  if (!ownStops.length && ownItems.length < 2) return cfg; // nothing (or one stray item) of their own yet: the example is still the plan
  const own = ownStops.flatMap(x => [x.from, x.to]).concat(ownItems.map(x => x.date)).filter(isoDay).sort(); if (!own.length) return cfg;
  const lo = addDays(own[0], -3), hi = addDays(own[own.length - 1], 3);
  const samp = sampleSpan(cfg);
  if (!samp || !(samp[1] < lo || samp[0] > hi)) return cfg; // the sample still overlaps their plans: the host's call
  const out = { ...cfg, schedule: sch.filter(x => !isSampleItem(x)), stops: st.filter(x => !isSampleStop(x)) };
  const sLo = addDays(samp[0], -3), sHi = addDays(samp[1], 3), fromSample = (d) => isoDay(d) && d >= sLo && d <= sHi && (d < lo || d > hi);
  const s0 = (cfg.start || '').slice(0, 10), e0 = (cfg.end || '').slice(0, 10);
  if (fromSample(s0) || fromSample(e0)) { const sp = tripSpan(own) || [own[0], own[own.length - 1]]; out._ek = eventKey(cfg); out.start = sp[0]; out.end = sp[1] > sp[0] ? sp[1] : ''; }
  return out;
}
function tripView(cfg) {
  if (!isTrip(cfg)) return cfg;
  cfg = sampleDropped(cfg);
  // evidence: route legs, the guest's own flights (departure dates), the itinerary's dated items (outliers dropped)
  const fl = itinLoad(cfg).filter(x => x.kind === 'flight').flatMap(x => [(x.start || '').slice(0, 10), (x.end || '').slice(0, 10)]); // departure and (time-zone-corrected) arrival days
  const sp = tripSpan(stopsOf(cfg).flatMap(x => [x.from, x.to]).concat(fl, (cfg.schedule || []).map(x => x.date)).filter(isoDay));
  const ds = sp ? sp : [];
  if (ds.length >= 2 && cfg.start) { const rs = ds[0], re = ds[ds.length - 1], s0 = cfg.start.slice(0, 10), e0 = (cfg.end || cfg.start).slice(0, 10);
    if (daysBetween(rs, s0) > 1 || daysBetween(e0, re) > 1) { // more than a day outside (a red-eye the night before doesn't move the trip) // the stored dates don't cover the route: mostly-overlapping → widen; barely (a misread date) → the route's own span
      const ov = Math.max(0, daysBetween(rs > s0 ? rs : s0, re < e0 ? re : e0)); const keep = ov * 2 >= daysBetween(rs, re);
      cfg = { ...cfg, _ek: eventKey(cfg), start: keep && s0 < rs ? s0 : rs, end: keep && e0 > re ? e0 : re }; } }
  const v = cfg.venue; const s = stopsOf(cfg).find(x => x.lat != null);
  if (!s || (v && !isCoarseVenue(v))) return cfg;
  return { ...cfg, venue: { ...(v || {}), name: v ? v.name : s.name, address: s.address || s.name, lat: s.lat, lon: s.lon, city: s.city || s.name, region: s.region || '', country: s.country || (v && v.country) || '', cc: s.cc || (v && v.cc) || '', pinName: s.name, zoom: 13 } };
}
// Pages imported before the trip-span fix keep wrong stored dates; tripView corrects them on the guest page. spanFixed
// gives lists (My pages, account pages, print card, Duplicate) the same dates, and the builder saves them into the page
// (ek pins the page's original key, so guests' My trip / packing / plans on their devices stay with the page).
function spanFixed(cfg) {
  if (!cfg || !cfg.start || !isTrip(cfg)) return cfg;
  const v = tripView(cfg); const same = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
  if (v.start === cfg.start && (v.end || '') === (cfg.end || '') && same(v.schedule, cfg.schedule) && same(v.stops, cfg.stops)) return cfg;
  return { ...cfg, start: v.start, end: v.end, schedule: v.schedule, stops: v.stops, ek: cfg.ek || eventKey(cfg) };
}
const tripCC = (cfg) => (cfg.venue && cfg.venue.cc) || (stopsOf(cfg).find(x => x.cc) || {}).cc || '';
// a city-level point for a route stop: never a country, inside the trip's country, a city/town result preferred
async function geocodeCity(name, country, cc) {
  const q = [name, country].filter(Boolean).join(', '); if (!q) return null; const k = 'sgeo:' + q.toLowerCase().slice(0, 120);
  const c = LS.get(k); if (c) return c.miss ? null : c;
  let xs; try { xs = await geocode(q); } catch { return null; }
  const ok = (xs || []).filter(x => x.lat != null && !(x.types || []).some(ty => ty === 'country' || ty === 'continent') && !(cc && x.cc && x.cc !== cc));
  const r = ok.find(x => (x.types || []).some(ty => /^(locality|postal_town|sublocality|administrative_area_level_[12]|colloquial_area)$/.test(ty))) || ok.find(x => !(x.types || []).length) || null;
  const out = r ? { name, address: r.address || r.name, lat: r.lat, lon: r.lon, city: r.city || name, region: r.region || '', country: r.country || country || '', cc: r.cc || cc || '' } : null;
  LS.set(k, out || { miss: 1 }); return out;
}
// a stop whose name isn't in its own city / address: renamed without moving its point (pages edited before 11/19 could
// keep the old city's point, so "Takayama" showed Kyoto's map). Looked up by name; replaced only when 50 km+ off.
const foldTxt = (x) => String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const stopSuspect = (s) => s.lat != null && !!s.name && !s._ok && !!(s.city || s.address) && !foldTxt([s.city, s.address, s.region].join(' ')).includes(foldTxt(s.name).split(/[\s,(]+/).filter(Boolean)[0] || '\u0000');
const stopsNeedRepair = (cfg) => isTrip(cfg) && stopsOf(cfg).some(s => s.lat == null || stopSuspect(s));
async function repairStops(cfg) {
  const ss = stopsOf(cfg).filter(s => s.lat == null || stopSuspect(s)); if (!ss.length || !isTrip(cfg)) return false;
  const cc = tripCC(cfg), country = (cfg.venue && cfg.venue.country) || (stopsOf(cfg).find(x => x.country) || {}).country || ''; let n = 0;
  for (const s of ss) { const r = await geocodeCity(s.name, s.country || country, s.cc || cc);
    if (s.lat != null) { if (r && distM(r.lat, r.lon, s.lat, s.lon) > 50000) { Object.assign(s, { address: r.address, lat: r.lat, lon: r.lon, city: r.city || s.name, region: r.region || '' }); n++; } else Object.defineProperty(s, '_ok', { value: 1, enumerable: false, configurable: true }); continue; }
    if (r) { Object.assign(s, { address: s.address || r.address, lat: r.lat, lon: r.lon, city: s.city || r.city, region: s.region || r.region, country: s.country || r.country, cc: s.cc || r.cc }); n++; } }
  return n > 0;
}
function renderEvent(cfg, root, opts = {}) {
  if (!opts.repaired && stopsNeedRepair(cfg)) {
    const seq0 = renderSeq + 1; repairStops(cfg).then(ok => { if (ok && renderSeq === seq0 && document.body.contains(root)) { const p = root.querySelector('.ev-panel:not([hidden])'); renderEvent(cfg, root, { ...opts, repaired: true, tab: p ? p.dataset.panel : opts.tab }); } }).catch(() => {});
  }
  if (!opts.src) opts = { ...opts, src: cfg }; // "Edit a copy" and the language picker keep the page as written
  const cfgIn = cfg; if (!opts.onpage) cfg = guestView(cfg, opts); // type rule + the guest's personal copy
  cfg = tripView(cfg);
  if (!opts.preview && !opts.onpage) applyShifts(cfg); // the organizer moved the trip: this device's saved places follow
  // ?city=kyoto&cat=restaurants: that city and category in Nearby, My trip and the Itinerary (opens Nearby unless a tab is asked for)
  ccLive = !opts.preview && !opts.onpage; const ccLink = ccLive ? ccFromURL(cfg) : false;
  if (ccLink && !opts.tab) opts = { ...opts, tab: ccCatId(new URLSearchParams(location.search).get('cat')) === 'transport' ? 'mytrip' : 'nearby' };
  if (!opts.preview && cfg.tools && cfg.tools.mytrip && !cfg.demoTrip && bkClean(cfg) && LS.get('signedIn')) syncPush(cfg); // one item per booking (merges old duplicates)
  const seq = ++renderSeq;
  maps.forEach(m => { try { m.remove(); } catch {} }); maps.clear();
  loadFont(cfg.theme.font); ONP = !!opts.onpage;
  const v = cfg.venue; const air = airFor(cfg);
  const tabs = tabsFor(cfg); const cur = tabs.some(([k]) => k === opts.tab) ? opts.tab : 'event';
  const panel = (k, body, head) => `<div class="ev-panel" data-panel="${k}"${k === cur ? '' : ' hidden'}>${head || ''}<div class="ev-body">${body}</div></div>`;
  const tabHead = (k) => `<header class="tab-h"><span class="lbl">${esc(cfg.title || t('Untitled event'))}</span><h1>${t(TABS.find(x => x[0] === k)[1])}</h1></header>`;
  root.innerHTML = `
  <article class="ev ${cfg.theme.mode === 'dark' ? 'dark' : ''} ${tabs.length > 1 ? 'has-tabs' : ''} ${opts.preview ? 'is-preview' : ''}" style="${themeStyle(cfg.theme)}" lang="${LANG}">
    ${tabs.length > 1 ? `<nav class="ev-tabs" role="tablist" aria-label="${t('Page sections')}">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab-go="${k}" aria-selected="${k === cur}"><svg viewBox="0 0 24 24" aria-hidden="true">${TAB_ICONS[k]}</svg><span>${t(l)}</span></button>`).join('')}</nav>` : ''}
    <div class="ev-panel" data-panel="event"${cur === 'event' ? '' : ' hidden'}>
      <header class="ev-hero ${cfg.cover ? 'has-cover' : ''}">
        ${cfg.cover ? `<img class="ev-cover" src="${esc(cfg.cover)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <div class="ev-hero-in">
          ${httpsUrl(cfg.logo) ? `<img class="ev-logo" src="${esc(cfg.logo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
          <p class="ev-kicker">${esc(t(cfg.type || 'Event'))}${v && v.city ? ` · ${esc(v.city)}` : ''}</p>
          <h1 class="ev-title">${esc(cfg.title || t('Untitled event'))}</h1>
          ${cfg.tagline ? `<p class="ev-tagline">${esc(cfg.tagline)}</p>` : ''}
        </div>
      </header>
      ${ticketHTML(cfg, air, opts)}
      <div class="ev-body">${mineOn(cfg) ? `<div class="mi-wrap" data-slot="mine">${mineBarHTML(cfg, null, !!opts.onpage)}</div>` : ''}${eventTabHTML(cfg)}</div>
    </div>
    ${tabs.some(x => x[0] === 'travel') ? panel('travel', travelTabHTML(cfg, air), tabHead('travel')) : ''}
    ${tabs.some(x => x[0] === 'nearby') ? panel('nearby', nearbyTabHTML(cfg), tabHead('nearby')) : ''}
    ${tabs.some(x => x[0] === 'mytrip') ? panel('mytrip', offlineRowHTML(cfg, opts) + myTripTabHTML(cfg), tabHead('mytrip')) : ''}
    <footer class="ev-foot">
      ${opts.preview ? '' : `<p class="lang-row">${langSelectHTML(opts.src || cfg)}</p><a href="#edit=${packEvent(opts.src || cfg)}">${t('Edit a copy of this page')}</a> · <a href="#">${t('Make your own')}</a>`}
      <p data-slot="attrib">${attribHTML(new Set())}</p>
    </footer>
  </article>`;
  ONP = false;
  const art = root.querySelector('.ev');
  art._src = opts.src; // a change to the personal copy draws the page again, on the same tab and scroll
  art._rerender = (noDs) => { if (!document.body.contains(root)) return; const p = root.querySelector('.ev-panel:not([hidden])'); const y = window.scrollY; renderEvent(cfgIn, root, { ...opts, tab: p ? p.dataset.panel : opts.tab, noDs: !!noDs }); window.scrollTo(0, y); };
  if (opts.preview || opts.onpage) { if (B && B.cfg && !opts.src.demoTrip) shareNote(B.cfg, true); } else shareNote(cfg, false);
  art.addEventListener('click', (e) => { if (e.target.closest('[data-ov-show]')) { ovShowAll(cfg); art._rerender(true); } else if (e.target.closest('[data-shr-unfollow]')) { shareUnfollow(cfg); art._rerender(true); } });
  art._srcs = new Set();
  // a source is credited once it actually supplies the map or places (OpenStreetMap only when Google is unavailable)
  art._useSrc = (k) => { art._srcs.add(k); const el = art.querySelector('[data-slot="attrib"]'); if (el) el.innerHTML = attribHTML(art._srcs); };
  art.addEventListener('click', (e) => { const b = e.target.closest('[data-gpid]'); if (b && art._openGPlace) art._openGPlace(b.dataset.gpid); });
  art._hsCfg = cfg; art.addEventListener('click', (e) => { if (!e.target.closest('dialog')) hsClick(cfg, art, e); }); // Set as my hotel / Remove on list rows and map pins
  wireEvent(cfg, art, seq, air, opts); wireMine(cfg, art, opts); wireDetailTaps(cfg, art, opts); wireReadMore(art); wireOffline(cfg, art, opts); if (!opts.preview) wireCollapse(cfg, art); wireTravelHide(cfg, art);
  if (opts.hosted && typeof wireHosted === 'function') wireHosted(cfg, art, opts.hosted, opts);
  else if (demoRsvp(cfg, opts) && typeof wireHosted === 'function') wireHosted(cfg, art, { id: 'demo-' + opts.exampleId, demo: true }, opts); // an example's RSVP form: answers stay on this device
  art.addEventListener('click', (e) => { const b = e.target.closest('[data-route-stop]'); if (!b || !art.querySelector('[data-panel="nearby"]')) return; showTab(art, 'nearby', opts); const ci = cityOfStop(cfg, +b.dataset.routeStop); if (art._nearCity) art._nearCity(ci); else if (art._osmCity) art._osmCity(ci); });
  if (opts.onpage && typeof onpDecorate === 'function') onpDecorate(cfg, art);
}
function wireTravelHide(cfg, art) {
  const pnl = art.querySelector('[data-panel="travel"]'); if (!pnl) return;
  const get = () => (LS.get(thKey(cfg), []) || []).filter(id => TH_SEL[id]);
  // Where to stay's Hide sits in its title row, after the fold button (added once that button exists)
  const sh = pnl.querySelector('#sec-stay > .sec-h'); if (sh && !sh.querySelector('.th-hide')) { sh.insertAdjacentHTML('beforeend', thHideBtn('stay', t('Where to stay'))); sh.classList.add('th-sh'); }
  const paint = () => { const h = get(); Object.keys(TH_SEL).forEach(id => pnl.classList.toggle('th-x-' + id, h.includes(id)));
    const n = h.filter(id => pnl.querySelector(TH_SEL[id])).length; const b = pnl.querySelector('[data-th-show]'); if (b) { b.hidden = !n; b.textContent = t('Show hidden ({n})', { n }); } };
  art._th = paint; paint();
  pnl.addEventListener('click', (e) => {
    const hb = e.target.closest('[data-th-hide]'); if (hb) { e.stopPropagation(); const h = get(); if (!h.includes(hb.dataset.thHide)) h.push(hb.dataset.thHide); LS.set(thKey(cfg), h); paint(); return; }
    if (e.target.closest('[data-th-show]')) { LS.del(thKey(cfg)); paint(); }
  });
}
// The open tab rides in the address bar (replaceState, so no extra history entries): a reload, a bookmark or the share sheet
// reopens it (Dylan 11/25: "refresh and stay on your current tab"). ?e=<slug>#t=nearby, ?demo=…#t=…, #e=…&t=…, and the
// organizer's own page (?e= or #page=<pid>&t=…, builder preview). Event = no tab part, unless the address also has
// ?city=/&cat= (those alone open Nearby), then #t=event. A link that asks for a tab (?city=&cat=, Share my trip) has no
// tab part when it arrives, so it still opens what it asks for; a plain shared link opens on Event.
function tabURL(art, k, opts = {}) {
  if (opts.preview && !art.closest('#preview')) return; // setup's preview and the like
  const h = location.hash, q = locQ(); const cc = q.has('city') || q.has('cat'); let nh = null;
  if (/^#(e|ex|page)=/.test(h)) { const base = h.split('&t=')[0]; nh = k === 'event' && !cc ? base : `${base}&t=${k}`; }
  else if ((q.get('e') || q.get('demo')) && (h === '' || h === '#' || /^#t=/.test(h))) nh = k === 'event' && !cc ? '' : '#t=' + k;
  if (nh === null || nh === h || (nh === '' && h === '#')) return;
  try { history.replaceState(history.state, '', location.pathname + location.search + nh); } catch {}
}
// ...and the scroll position within that tab (this browser tab only: sessionStorage), restored on a reload
const vyKey = () => { const p = document.querySelector('.viewer #ev-root .ev-panel:not([hidden])'); if (!p) return ''; const q = locQ();
  return 'epY:' + (q.get('e') ? 'e:' + q.get('e') : q.get('demo') ? 'd:' + q.get('demo') : 'h:' + hashStr(location.hash.split('&t=')[0])) + ':' + p.dataset.panel; };
let vyBusy = false, vyTried = false;
addEventListener('scroll', debounce(() => { if (vyBusy) return; const k = vyKey(); if (k) try { sessionStorage.setItem(k, String(Math.round(scrollY))); } catch {} }, 150), { passive: true });
function scrollBack() {
  if (vyTried) return; vyTried = true;
  let nav; try { nav = performance.getEntriesByType('navigation')[0]; } catch {} if (!nav || nav.type !== 'reload') return;
  const k = vyKey(); let y = 0; try { y = k ? +sessionStorage.getItem(k) || 0 : 0; } catch {} if (y < 40) return;
  const ev = ['wheel', 'touchstart', 'keydown', 'mousedown']; let n = 0, iv = 0;
  const stop = () => { vyBusy = false; clearInterval(iv); ev.forEach(e => removeEventListener(e, stop)); };
  vyBusy = true; ev.forEach(e => addEventListener(e, stop, { passive: true }));
  // the tab's lists (Nearby places, maps) arrive late: keep at it until the page is tall enough and it holds
  iv = setInterval(() => { if (vyKey() !== k) return stop(); window.scrollTo(0, y); n = Math.abs(scrollY - y) < 2 ? n + 1 : 0; if (n >= 3) stop(); }, 120);
  setTimeout(stop, 6000);
}
try { history.scrollRestoration = 'manual'; } catch {}
addEventListener('hashchange', () => { vyTried = true; }); // only the reloaded page itself, not one opened from it
function showTab(art, k, opts = {}) {
  $$('.ev-panel', art).forEach(p => { p.hidden = p.dataset.panel !== k; });
  $$('[data-tab-go]', art).forEach(b => b.setAttribute('aria-selected', String(b.dataset.tabGo === k)));
  if (k === 'nearby') maps.forEach(m => { try { m.invalidateSize(); } catch {} });
  (art._showFns || []).forEach(f => { try { f(k); } catch {} });
  tabURL(art, k, opts);
  if (!opts.preview) window.scrollTo(0, 0); else art.closest('.b-preview, .su-preview')?.scrollTo(0, 0);
}

function wireEvent(cfg, art, seq, air, opts) {
  const v = cfg.venue; const T = cfg.tools; const alive = () => seq === renderSeq && document.body.contains(art);
  const slot = (n) => art.querySelector(`[data-slot="${n}"]`);
  const renderSchedule = () => { const w = slot('schedule-wrap'); if (!w) return; ONP = !!opts.onpage; try { w.innerHTML = scheduleSecHTML(cfg); } finally { ONP = false; } if (opts.onpage && typeof onpDecorate === 'function') onpDecorate(cfg, art); if (art._cx) art._cx(); };
  art._renderSchedule = () => { renderSchedule(); art._cx && art._cx(); art._ccBars && art._ccBars(); }; // a new booking can fold its Travel part
  art.addEventListener('click', (e) => {
    if (e.target.closest('[data-tmode-change]')) { art._modesOpen = true; applyModes(); return; }
    const a = e.target.closest('[data-act],[data-food],[data-tmode],[data-tab-go],[data-day-tog],[data-more]'); if (!a) return;
    if (a.dataset.tabGo) showTab(art, a.dataset.tabGo, opts);
    else if (a.dataset.tmode) { art._modesOpen = true; const k = a.dataset.tmode; const sel = new Set(LS.get(eventKey(cfg), [])); k === 'all' ? sel.clear() : sel.has(k) ? sel.delete(k) : sel.add(k); LS.set(eventKey(cfg), [...sel]); applyModes(); }
    else if (a.dataset.dayTog != null) { // a day on the Event tab: open / close in place
      const d = a.dataset.dayTog, dv = a.closest('.day'), open = !dv.classList.contains('open'); const k = itinKey(cfg); DAY_OPEN.set(k, { ...(DAY_OPEN.get(k) || {}), [d]: open });
      dv.classList.toggle('open', open); a.setAttribute('aria-expanded', String(open)); const l = dv.querySelector(':scope > .tl'); if (l) l.hidden = !open; }
    else if (a.dataset.more != null) { a.closest('ul').querySelectorAll('.more').forEach(x => x.classList.remove('more')); a.closest('li').remove(); }
    else if (a.dataset.act === 'ics') { a.closest('details')?.removeAttribute('open'); downloadICS(cfg); }
    else if (a.dataset.act === 'share') shareSheet(cfg, opts, art);
    else if (a.dataset.act === 'rsvp') { const s = art.querySelector('#sec-rsvp'); if (!s) return; if (s.classList.contains('cx-col') && art._cxOpen) art._cxOpen('rsvp'); s.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else if (a.dataset.food) { const s = slot('food'); s.innerHTML = foodHTML(cfg, art._osm, a.dataset.food); }
  });
  // one open menu at a time; tapping elsewhere closes it
  art.addEventListener('toggle', (e) => { if (e.target.matches('details.menu') && e.target.open) $$('details.menu[open]', art).forEach(d => { if (d !== e.target) d.open = false; }); }, true);
  if (!document._menuCloser) { document._menuCloser = true; document.addEventListener('click', (e) => { if (!e.target.closest('details.menu')) $$('details.menu[open]').forEach(d => { d.open = false; }); }); }
  wireItin(cfg, art); wireDetails(cfg, art); wirePacking(cfg, art); wireShopping(cfg, art);
  if (!v) wirePlan(cfg, art, null);
  art.querySelector('[data-lang]')?.addEventListener('change', (e) => setGuestLang(e.target.value));
  if (!v) return;

  const applyModes = () => {
    const bar = art.querySelector('.mode-bar');
    const avail = bar && !bar.hidden ? $$('[data-tmode]', bar).filter(b => !b.hidden).map(b => b.dataset.tmode) : [];
    const sel = new Set((LS.get(eventKey(cfg), []) || []).filter(k => avail.includes(k)));
    if (bar) $$('[data-tmode]', bar).forEach(b => { const on = b.dataset.tmode === 'all' ? !sel.size : sel.has(b.dataset.tmode); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    // a choice already made (on an earlier visit / before leaving the tab) shows as just the chosen modes + Change
    const fold = !!bar && !!sel.size && !art._modesOpen; if (bar) { bar.classList.toggle('m-fold', fold); $$('[data-tmode]', bar).forEach(b => b.classList.toggle('m-off', fold && !b.classList.contains('on'))); const c = bar.querySelector('[data-tmode-change]'); if (c) c.hidden = !fold; }
    $$('[data-mode]', art).forEach(el => { el.hidden = !!sel.size && !el.dataset.mode.split(' ').some(k => sel.has(k)); });
    art._pack && art._pack();
  };
  art._applyModes = applyModes;
  // rental counters come from Google: fetch them only once the Travel tab is actually open
  const loadCounters = () => { const cs = slot('rental') && slot('rental').querySelector('[data-slot="car-counters"]'); const pnl = art.querySelector('[data-panel="travel"]');
    const ap = chosenAirport(cfg, air); if (!cs || gpBroken || (pnl && pnl.hidden)) return; gpCarsAll(cfg, ap).then(rows => { if (rows.length && document.body.contains(cs)) { cs.innerHTML = carCountersHTML(cfg, ap, rows, art); art._th && art._th(); } }).catch(() => {}); };
  (art._showFns = art._showFns || []).push((k) => { if (k === 'travel') loadCounters(); else if (art._modesOpen) { art._modesOpen = false; applyModes(); } }); // leaving Travel settles the mode choice
  const refreshTrip = () => {
    const ap = chosenAirport(cfg, air);
    if (slot('flights')) slot('flights').innerHTML = flightsHTML(cfg, air, ap);
    if (slot('trains')) slot('trains').innerHTML = trainsHTML(cfg);
    if (slot('rental')) { slot('rental').innerHTML = rentalHTML(cfg, air, ap); loadCounters(); }
    if (slot('stay-links')) slot('stay-links').innerHTML = stayLinks(cfg, ap);
    if (slot('ap-mine')) slot('ap-mine').innerHTML = apMineHTML(cfg, air);
    const side = art.querySelector('.stub-side'); if (side && ap) side.innerHTML = stubSideHTML(cfg, ap);
    if (ap) $$('[data-ap-sel]', art).forEach(s => { if (s.value !== ap.iata) s.value = ap.iata; });
    if (slot('tour-links')) slot('tour-links').innerHTML = tourLinks(cfg);
    if (art._osm && slot('hotels')) slot('hotels').innerHTML = hotelsHTML(cfg, withArt(art._osm, art));
    art._th && art._th();
    $$('[data-k]', art).forEach(i => { const tr = tripDates(cfg); if (document.activeElement !== i && tr[i.dataset.k] != null) i.value = tr[i.dataset.k]; });
    art._pack && art._pack();
  };
  // "Flying into": one saved pick per event; the flights list, rental and My trip pickers all write it
  let apLast = (chosenAirport(cfg, air) || {}).iata;
  const setAirport = (iata, el) => {
    if (!air.some(a => a.iata === iata)) return; AP_OPEN.delete(apKey(cfg));
    const box = el && el.closest('[data-slot]'); const name = box && box.dataset.slot; const top = el ? el.getBoundingClientRect().top : 0;
    const q = el && el.matches('[data-ap-sel]') ? '[data-ap-sel]' : `[data-ap="${iata}"]`;
    LS.set(apKey(cfg), iata); apLast = iata; refreshTrip();
    const n = name && slot(name) && slot(name).querySelector(q); if (n) window.scrollBy(0, n.getBoundingClientRect().top - top); // keep the control under the finger
  };
  art._apRefresh = () => { const ap = chosenAirport(cfg, air); if (ap && ap.iata !== apLast) { apLast = ap.iata; refreshTrip(); } };
  art.addEventListener('click', (e) => { const b = e.target.closest('[data-ap]'); if (b) setAirport(b.dataset.ap, b); });
  art.addEventListener('click', (e) => { if (!e.target.closest('[data-ap-change]')) return; AP_OPEN.add(apKey(cfg)); refreshTrip(); const p = slot('flights') && slot('flights').querySelector('.ap-pick'); if (p) p.focus({ preventScroll: true }); });
  art.addEventListener('change', (e) => { const s = e.target.closest('[data-ap-sel]'); if (s) setAirport(s.value, s); });
  art.addEventListener('click', (e) => {
    if (!e.target.closest('[data-addbooking]') || !art._itinAdd) return;
    showTab(art, 'mytrip', opts); art._itinAdd();
    const f = art.querySelector('#sec-itinerary [data-slot="itin-form"]'); if (f) f.scrollIntoView({ block: 'start' });
  });
  art.addEventListener('click', (e) => {
    const b = e.target.closest('[data-addtrip]'); if (!b || !art._itinOpen) return;
    const tr = tripDates(cfg); const k = b.dataset.addtrip;
    if (b.dataset.iata) setAirport(b.dataset.iata);
    showTab(art, 'mytrip', opts);
    art._itinOpen({ kind: k, name: b.dataset.atLabel || '', address: b.dataset.atPlace || '', start: tr.arrive, end: k === 'flight' ? '' : tr.leave, ph: 1, _gen: b.dataset.atLabel || '' }); // a placeholder until the guest makes it theirs
    const f = art.querySelector('#sec-itinerary [data-slot="itin-form"]'); if (f) f.scrollIntoView({ block: 'start' });
  });
  const tripKey = 'trip:' + cfg.start.slice(0, 10) + ':' + (cfg.end || cfg.start).slice(0, 10);
  art.addEventListener('change', (e) => { const sel = e.target.closest('[data-airline]'); if (!sel) return; LS.set('airline', sel.value); refreshTrip(); });
  art.addEventListener('change', (e) => {
    const i = e.target; const k = i.dataset.k; if (!k || !i.closest('.tripbar')) return;
    const tr = tripDates(cfg); tr[k] = k === 'guests' ? Math.max(1, Math.min(16, +i.value || 2)) : i.value;
    if (tr.leave <= tr.arrive) tr.leave = addDays(tr.arrive, 1);
    LS.set(tripKey, tr);
    const m = mineOn(cfg) && mineGet(cfg); // their dates are one set: a change here is their Make it mine stay too
    if (m && k !== 'guests' && (m.a !== tr.arrive || m.l !== tr.leave)) { mineSave(cfg, { a: tr.arrive, l: tr.leave, p: '' }); if (art._bkChanged) art._bkChanged(); else art._renderSchedule(); }
    refreshTrip();
  });
  art._refreshTrip = refreshTrip;
  const oi = art.querySelector('#ep-origin');
  if (oi) {
    const list = oi.nextElementSibling;
    const pick = (a) => { LS.set('origin', a[0]); oi.value = `${a[2] || a[1]} (${a[0]})`; list.hidden = true; refreshTrip(); };
    oi.addEventListener('input', () => {
      const res = searchAirports(oi.value.replace(/\(.*\)/, ''));
      if (!oi.value.trim()) { LS.del('origin'); refreshTrip(); }
      list.innerHTML = res.map((a, i) => `<li><button type="button" data-i="${i}"><b>${esc(a[0])}</b> ${esc(a[2] || '')} <span>${esc(a[1])}</span></button></li>`).join('');
      list.hidden = !res.length; list._res = res;
    });
    list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(list._res[+b.dataset.i]); });
    oi.addEventListener('keydown', (e) => { if (e.key === 'Enter' && list._res && list._res[0] && !list.hidden) { e.preventDefault(); pick(list._res[0]); } if (e.key === 'Escape') list.hidden = true; });
    oi.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 200));
  }
  refreshTrip(); applyModes();

  if (cfg.start && (slot('weather') || art._pack)) {
    weatherFor(cfg).then(w => { if (!alive()) return; art._wx = w; const ws = slot('weather'); if (ws) { ws._wx = w; ws._cfg = cfg; ws.innerHTML = weatherHTML(w, cfg); } art._pack && art._pack(); art._cx && art._cx(); })
      .catch(() => { if (alive() && slot('weather')) slot('weather').innerHTML = `<p class="muted">${navigator.onLine === false ? `<b>${t('Offline')}</b> · ${t('The forecast needs a connection.')}` : t('Weather is unavailable right now. Try reloading the page.')}</p>`; });
  }
  const mapCtl = wireMap(cfg, art, opts);
  wirePlan(cfg, art, mapCtl);
  wireHotel(cfg, art, mapCtl);
  if (T.mytrip || ccItinOn(cfg)) wireTripCC(cfg, art, opts);
  // Google Places first; if it is refused (quota, key) the OpenStreetMap list takes over, now or when its data arrives
  let gmode = false;
  const osmFood = (d) => { const s0 = slot('food'); if (!s0 || !alive()) return; art._useSrc('osm'); if (mapCtl) mapCtl.setData(d); if (art._stop > 0 && art._osmCity) art._osmCity(art._stop); else wirePlaces(cfg, art, d, mapCtl ? mapCtl.setFood : null); };
  // "Search this area" on the OpenStreetMap list (no Google, or Google refused): the same lists around the new center
  const osmAt = (a) => {
    if (gmode || !slot('food')) return; slot('food').innerHTML = loading(t('places to eat'));
    osmNearby(a.lat, a.lon).then(d => { if (!alive() || gmode) return; if (mapCtl) mapCtl.setData(d); wirePlaces(cfg, art, d, mapCtl ? mapCtl.setFood : null, { lat: a.lat, lon: a.lon }); })
      .catch(() => { if (alive() && slot('food')) slot('food').innerHTML = `<p class="muted">${t('Nearby places could not be loaded right now.')}</p>`; });
  };
  if (mapCtl) mapCtl.onArea(osmAt);
  // the City dropdown on the OpenStreetMap list: that city's hotel (or the city) and its places
  art._osmCity = (i) => {
    const ss = hotelStops(cfg); if (!ss[i] || gmode) return; art._stop = i; const h = art._hotelAt ? art._hotelAt(i) : null;
    art._center = h || ss[i]; art._fromHotel = !!h; art._hotelPt = h; const c = ccCities(cfg)[i]; ccSet(cfg, 'nearby', { city: c ? c.k : '' });
    if (mapCtl) mapCtl.center(art._center.lat, art._center.lon, h ? 15 : 13); art._hotelUI && art._hotelUI(); osmAt(art._center);
  };
  gmode = wireGPlaces(cfg, art, mapCtl, () => {
    gmode = false; if (mapCtl) mapCtl.osmMode(); const s0 = slot('food'); if (s0) s0.innerHTML = loading(t('places to eat'));
    // Google's nearby data has no restaurants list (the Google list handled that), so fetch the OpenStreetMap one
    if (art._osm && art._osm.src === 'google') osmNearby(v.lat, v.lon).then(osmFood).catch(() => { if (alive() && slot('food')) slot('food').innerHTML = `<p class="muted">${t('Nearby places could not be loaded right now.')}</p>${ext(L.place('restaurants near ' + v.name, placeLabel(v)), t('Search on Google Maps'), 'btn')}`; });
    else if (art._osm && s0) osmFood(art._osm);
  });
  if (T.nearby || T.stay || T.travel || T.tours) {
    nearby(v.lat, v.lon).then(d => {
      if (!alive()) return; art._osm = d; art._useSrc(d.src === 'google' ? 'google' : 'osm');
      const at = art.querySelector('.ev-foot [data-slot="attrib"]'); if (at && d.snapshot && !art.querySelector('.ev-foot [data-slot="snap"]')) at.insertAdjacentHTML('beforebegin', `<p data-slot="snap">${esc(t('Nearby places as mapped on {d}', { d: /^\d{4}-\d{2}-\d{2}$/.test(d.snapshot) ? fmt(d.snapshot, { month: 'short', day: 'numeric', year: 'numeric' }) : d.snapshot }))}</p>`);
      if (slot('hotels')) slot('hotels').innerHTML = hotelsHTML(cfg, withArt(d, art));
      if (slot('sights')) slot('sights').innerHTML = sightsHTML(cfg, withArt(d, art));
      if (slot('transit')) slot('transit').innerHTML = transitHTML(cfg, d);
      if (slot('access-wrap')) { slot('access-wrap').innerHTML = accessHTML(cfg, d); art._cx && art._cx(); }
      if (!Object.values(d.transit).some(xs => xs.length)) { const tb = art.querySelector('[data-tmode="transit"]'); if (tb) { tb.hidden = true; const bar = tb.parentElement; if ($$('[data-tmode]:not([hidden])', bar).length < 3) bar.hidden = true; } }
      applyModes();
      if (mapCtl) mapCtl.setData(d);
      art._focusPlace = (p) => mapCtl && mapCtl.focus(p);
      if (slot('food') && !gmode) { if (d.src === 'google') osmNearby(v.lat, v.lon).then(osmFood).catch(() => {}); else if (art._stop > 0 && art._osmCity) art._osmCity(art._stop); else wirePlaces(cfg, art, d, mapCtl ? mapCtl.setFood : null); }
    }).catch(() => {
      if (!alive()) return;
      const msg = (what, q) => `<p class="muted">${t('Nearby places could not be loaded right now.')}</p>${ext(L.place(q, placeLabel(v)), t('Search on Google Maps'), 'btn')}`;
      if (slot('food')) slot('food').innerHTML = msg('restaurants', 'restaurants near ' + v.name);
      if (slot('hotels')) slot('hotels').innerHTML = msg('hotels', 'hotels near ' + v.name);
      if (slot('sights')) slot('sights').innerHTML = msg('sights', 'things to do near ' + v.name);
      if (slot('transit')) slot('transit').innerHTML = `<p class="muted">${t('Nearby stations could not be loaded right now.')}</p>${ext(L.dir(v, 'transit'), t('Transit directions'), 'btn')}`;
    });
  }
}

// "Add a booking": one sheet — paste text or a link / upload a screenshot or PDF / enter it yourself. Anything read
// lands as cards to check before saving.
const bkChooserHTML = () => `<div class="itin-sheet" data-sheet="choose"><div class="add-choices">
    <button type="button" class="add-choice" data-itin-mode="paste">${t('Paste confirmation text or link')}</button>
    <button type="button" class="add-choice" data-itin-mode="file" hidden>${t('Upload a screenshot or PDF')}</button>
    <button type="button" class="add-choice" data-itin-mode="manual">${t('Enter it yourself')}</button></div>
    <div class="btns"><button type="button" class="btn ghost" data-itin-cancel>${t('Cancel')}</button></div></div>`;
const bkPasteHTML = () => `<div class="itin-sheet" data-sheet="paste"><div class="field wide"><label for="it-paste">${t('Confirmation')}</label><textarea id="it-paste" rows="5" placeholder="${t('Paste a confirmation email or link')}"></textarea></div>
    <div class="btns"><button type="button" class="btn primary" data-itin-read>${t('Read it')}</button><button type="button" class="btn" data-itin-ai hidden>✦ ${t('Read with AI')}</button><button type="button" class="btn ghost" data-itin-cancel>${t('Cancel')}</button></div>
    <p class="hint" data-ai-msg role="status" aria-live="polite"></p><div data-signin-slot></div></div>`;
const bkFileHTML = () => `<div class="itin-sheet" data-sheet="file"><label class="btn primary file-pick">${t('Choose a screenshot or PDF')}<input type="file" accept="image/*,application/pdf" multiple data-itin-file hidden></label>
    <div class="btns"><button type="button" class="btn ghost" data-itin-cancel>${t('Cancel')}</button></div>
    <p class="hint" data-ai-msg role="status" aria-live="polite"></p><div data-signin-slot></div></div>`;
const bkSignInHTML = () => `<div class="bk-signin"><p><b>${t('Sign in to read it automatically.')}</b></p>${signInFormHTML('')}</div>`;
function bkReviewHTML(xs, air = []) {
  return `<div class="itin-sheet" data-sheet="review"><ul class="rv-list">${xs.map((x, i) => `<li class="rv-card" data-rv-card="${i}">
    <div class="trip">${bkFieldsHTML(x, 'rv' + i, air)}</div><button type="button" class="mini-b" data-rv-del="${i}">${t('Remove')}</button></li>`).join('')}</ul>
    <div class="btns"><button type="button" class="btn primary" data-rv-save>${esc(t('Save all ({n})', { n: xs.length }))}</button><button type="button" class="btn ghost" data-itin-cancel>${t('Cancel')}</button></div></div>`;
}
const blobB64 = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error(t('Couldn’t read it.'))); r.readAsDataURL(b); });
async function bookingFile(f) { // photos are shrunk on the phone before upload; PDFs go as they are
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')) { if (f.size > 9e6) throw new Error(t('That PDF is too large.')); return { media_type: 'application/pdf', data: await blobB64(f) }; }
  if (!/^image\//.test(f.type)) throw new Error(t('Use a photo, screenshot or PDF.'));
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(t('Use a photo, screenshot or PDF.'))); i.src = url; });
    const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    return { media_type: 'image/jpeg', data: await blobB64(blob) };
  } finally { URL.revokeObjectURL(url); }
}
const flightName = (f) => { const code = String(f || '').replace(/\s+/g, '').toUpperCase(); const m = code.match(/^([A-Z0-9]{2})(\d{1,4})$/); if (!m) return ''; const a = AIRLINES[m[1]]; return a ? `${a[0]} ${m[1]} ${m[2]}` : ''; };
function wireItin(cfg, art) {
  const s = art.querySelector('#sec-itinerary'); if (!s) return;
  const body = s.querySelector('.sec-b'); let draft = null, editing = null, review = [], autoName = '';
  const air = cfg.venue ? airFor(cfg) : [];
  const rerender = () => { body.innerHTML = bookingsHTML(cfg); art._renderSchedule && art._renderSchedule(); art._planChanged && art._planChanged(); art._apRefresh && art._apRefresh(); if (LS.get('signedIn')) syncPush(cfg); };
  const formSlot = () => body.querySelector('[data-slot="itin-form"]');
  const sheet = (html) => { const slot = formSlot(); slot.innerHTML = html; body.querySelector('.itin-btns')?.setAttribute('hidden', ''); return slot; };
  // a saved flight that lands at one of the nearby airports becomes the "Flying into" pick
  const arrivalPick = (xs) => { const a = flightArrival(air, xs); if (a) LS.set(apKey(cfg), a.iata); };
  // every new booking goes through the one upsert: a match updates the item already there (Replace? asked here)
  const saveNew = (add) => { add = add.map(x => { const y = { ...x }; if (y._gen != null) { if (y.name !== y._gen) delete y.ph; delete y._gen; } return y; }); arrivalPick(add); return bkSave(cfg, art, add, () => { const sl = formSlot(); if (sl && !sl.querySelector('.itin-sheet')) sheet(''); return formSlot(); }).then(() => rerender()); };
  art._bkChanged = rerender;
  // Remove on a hotel row elsewhere in My trip (itinerary, saved spots); the bookings list handles its own
  art.addEventListener('click', (e) => { const b = e.target.closest('[data-bk-rm]'); if (!b || body.contains(b)) return; e.stopPropagation(); bkRemove(cfg, art, b.dataset.bkRm); });
  const fileOk = () => LS.get('signedIn') ? aiModes().then(m => m.includes('file')) : aiReady();
  const openChooser = () => { const slot = sheet(bkChooserHTML()); fileOk().then(ok => { const b = slot.querySelector('[data-itin-mode="file"]'); if (b && ok) b.hidden = false; }).catch(() => {}); };
  // a place-type booking's Name searches Google: picking a suggestion fills the name, address and map point
  const nameAC = (root, get, repaint) => { const n = root.querySelector('[data-name-ac]'); if (n) placeAutocomplete(n, { bias: () => cfg.venue, onPick: (id, tok) => gpVenue(id, tok).then(r => { const o = get(); if (!o) return; o.name = r.name || o.name; if (r.address) o.address = r.address; if (r.lat != null) { o.lat = r.lat; o.lon = r.lon; } if (r.gid) o.ref = r.gid; repaint(new Set(['name', 'address'])); }).catch(() => {}) });
    const ad = root.querySelector('[data-it="address"]'); if (ad) placeAutocomplete(ad, { bias: () => cfg.venue, onPick: (id, tok) => gpVenue(id, tok).then(r => { const o = get(); if (!o) return; o.address = r.address; if (!o.name) o.name = r.name; if (r.lat != null) { o.lat = r.lat; o.lon = r.lon; } repaint(new Set(['address'])); }).catch(() => {}) }); };
  const openReview = (xs, read) => { review = xs.map(x => ({ ...x })); if (!review.length) return openChooser(); const slot = sheet(bkReviewHTML(review, air));
    slot.querySelectorAll('[data-rv-card]').forEach(c => { const i = +c.dataset.rvCard; nameAC(c, () => review[i], () => openReview(review)); });
    if (read) { markGot(slot, null); resolveAddrs(review).then(n => { if (n && formSlot().querySelector('[data-sheet="review"]')) { openReview(review); markGot(formSlot(), null); } }); } };
  // an imported place without an address: Google's best match for its name nearby (only a close name match)
  const resolveAddrs = async (xs) => { let n = 0; if (!GKEY || gpBroken) return 0;
    for (const x of xs.filter(y => y.kind !== 'flight' && y.name && !y.address).slice(0, 6)) {
      const st = bkDay(x.start) && stopsOf(cfg).length ? stopFor(cfg, bkDay(x.start)) : null; const near = st ? st.city || st.name : cfg.venue ? cfg.venue.city || cfg.venue.name : '';
      try { const r = (await gGeocode([x.name, near].filter(Boolean).join(', '))).find(y => y.address && nameLike(y.name, x.name)); if (r) { x.address = r.address; if (r.lat != null) { x.lat = r.lat; x.lon = r.lon; } if (r.gid) x.ref = r.gid; n++; } } catch { /* offline */ } }
    return n; };
  const askSignIn = (slot) => { const el = slot.querySelector('[data-signin-slot]'); if (el) el.innerHTML = bkSignInHTML(); };
  const paintForm = (got) => { const box = formSlot().querySelector('[data-bk-fields]'); if (!box || !draft) return; box.innerHTML = bkFieldsHTML(draft, 'it', air); nameAC(box, () => draft, paintForm); if (got) markGot(box, got);
    fileOk().then(ok => { const f = formSlot().querySelector('[data-bk-fill]'); if (f) f.hidden = !ok; }).catch(() => {}); };
  const openForm = (x, i) => {
    draft = { ...x }; editing = i; autoName = ''; sheet(itinFormHTML(draft, i, air)); paintForm();
    formSlot().querySelector('#it-name').focus();
  };
  const fill = () => paintForm();
  art._itinOpen = (x) => { openForm(x, null); const c = body.querySelector('#it-confNo'); if (c) c.focus({ preventScroll: true }); };
  art._itinAdd = () => openChooser();
  art._itinReview = (xs, read) => openReview(xs, read);
  // what a screenshot / PDF says, into the open form: the read booking of the form's type (else the first) fills every
  // field it has; those fields are highlighted, everything stays editable, one Save
  const fillForm = (items) => {
    const it = items.find(y => y.kind === draft.kind || (LODGE.has(y.kind) && LODGE.has(draft.kind))) || items[0]; const got = new Set();
    Object.entries(it).forEach(([k, v]) => { if (k === 'det') { Object.entries(v || {}).forEach(([dk, dv]) => { if (bkFilled(dv)) { draft.det = { ...(draft.det || {}), [dk]: dv }; got.add(dk); } }); return; }
      if (k === 'kind' && draft.kind && LODGE.has(draft.kind) && LODGE.has(v)) return; if (bkFilled(v)) { draft[k] = v; got.add(k); } });
    if (got.has('cancelBy') || got.has('nonRef')) got.add('cancelBy');
    paintForm(got);
    if (draft.kind !== 'flight' && draft.name && !draft.address) resolveAddrs([draft]).then(n => { if (n && draft) { got.add('address'); paintForm(got); } });
    return got.size;
  };
  // screenshots / PDFs (picked, dropped or pasted) → ai-import "file": into the open form, else the review cards
  const readFiles = (files, slot) => {
    files = [...(files || [])].filter(f => /^image\//.test(f.type || '') || f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')).slice(0, 6); if (!files.length) return false;
    if (!slot || !slot.querySelector('[data-ai-msg]')) slot = sheet(bkFileHTML());
    const msg = slot.querySelector('[data-ai-msg]'); const intoForm = !!(draft && slot.querySelector('.itin-form'));
    if (!LS.get('signedIn')) { msg.textContent = ''; askSignIn(slot); return true; }
    msg.textContent = t('Reading…'); slot.classList.add('busy');
    Promise.all(files.map(bookingFile)).then(parts => aiImport({ mode: 'file', files: parts })).then(j => {
      slot.classList.remove('busy'); const add = aiItemsToBookings(j.data && j.data.items);
      if (!add.length) { msg.textContent = t('No reservations found. Enter it yourself.'); return; }
      if (intoForm && draft && formSlot().contains(slot)) { fillForm(add); msg.textContent = ''; } else openReview(add, true);
    }).catch(e => { slot.classList.remove('busy'); if (e.signin) { msg.textContent = ''; askSignIn(slot); } else msg.textContent = e.message || t('Couldn’t read it.'); });
    return true;
  };
  art._itinFiles = (files) => readFiles(files, formSlot() && formSlot().querySelector('.itin-sheet, .itin-form') ? formSlot() : null);
  ITIN_DROP.art = art;
  const runAI = (b, slot, req) => {
    const msg = slot.querySelector('[data-ai-msg]');
    if (!LS.get('signedIn')) { askSignIn(slot); return; }
    b.disabled = true; msg.textContent = t('Reading…');
    aiImport(req).then(j => {
      const add = aiItemsToBookings(j.data && j.data.items); b.disabled = false;
      if (!add.length) { msg.textContent = t('No reservations found. Enter it yourself.'); return; }
      openReview(add, true);
    }).catch(e => { b.disabled = false; if (e.signin) { msg.textContent = ''; askSignIn(slot); } else msg.textContent = e.message || t('Couldn’t read it.'); });
  };
  body.addEventListener('click', (e) => {
    const sio = e.target.closest('[data-si-oauth]'); if (sio) { oauthSignIn(sio.dataset.siOauth); return; }
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.si === 'send') { signInSubmit(b.closest('.bk-signin')); return; }
    if (d.detAmen) { const o = target(b); if (!o) return; const on = new Set(detVal(o, 'amen') || []); on.has(d.detAmen) ? on.delete(d.detAmen) : on.add(d.detAmen); detSet(o, 'amen', [...on]); b.classList.toggle('on', on.has(d.detAmen)); b.setAttribute('aria-pressed', String(on.has(d.detAmen))); b.classList.remove('got'); return; }
    if ('itinAdd' in d) openChooser();
    else if (d.itinMode === 'paste') { const slot = sheet(bkPasteHTML()); slot.querySelector('#it-paste').focus(); aiReady().then(ok => { const a = slot.querySelector('[data-itin-ai]'); if (a && ok) a.hidden = false; }); }
    else if (d.itinMode === 'file') { const slot = sheet(bkFileHTML()); if (!LS.get('signedIn')) askSignIn(slot); }
    else if (d.itinMode === 'manual') openForm({}, null);
    else if ('itinRead' in d) { const txt = (body.querySelector('#it-paste') || {}).value || ''; const p = parseReservation(txt, cfg.start);
      if (!txt.trim()) { body.querySelector('[data-ai-msg]').textContent = t('Paste the whole confirmation first.'); return; }
      if (p.kind === 'flight' && !p.name) p.name = flightName(p.flight); openReview([p], true); }
    else if ('itinAi' in d) {
      const slot = formSlot(); const txt = (slot.querySelector('#it-paste') || {}).value || '';
      if (txt.trim().length < 20) { slot.querySelector('[data-ai-msg]').textContent = t('Paste the whole confirmation first.'); return; }
      runAI(b, slot, { text: txt, kind: 'confirmation' });
    }
    else if ('rvDel' in d) { review.splice(+d.rvDel, 1); openReview(review); }
    else if ('rvSave' in d) {
      const add = review.filter(x => x.name || x.flight || x.start).map(({ _auto, ...x }) => ({ ...x, name: x.name || (x.kind === 'flight' ? flightName(x.flight) || String(x.flight || '').toUpperCase() : '') }));
      if (!add.length) { toast(t('Add a name or a date')); return; }
      saveNew(add);
    }
    else if ('itinEdit' in d) openForm(itinLoad(cfg)[+d.itinEdit], +d.itinEdit);
    else if ('itinCancel' in d) rerender();
    else if (d.bkRm) bkRemove(cfg, art, d.bkRm);
    else if ('itinDel' in d) { const xs = itinLoad(cfg); xs.splice(+d.itinDel, 1); itinSave(cfg, xs); rerender(); }
    else if ('itinSave' in d) {
      if (!draft.name && !draft.flight && !draft.start) { toast(t('Add a name or a date')); return; }
      if (draft.kind === 'flight' && draft.flight && !draft.name) draft.name = flightName(draft.flight) || draft.flight.toUpperCase();
      if (draft.kind !== 'flight') draft.to = '';
      if (editing == null) return saveNew([draft]);
      const xs = itinLoad(cfg); const was = xs[editing] || {}; const ed = { ...draft }; if (ed._gen != null) { if (ed.name !== ed._gen) delete ed.ph; delete ed._gen; } if (ed.start !== was.start || ed.end !== was.end) delete ed.guess; xs[editing] = ed; itinSave(cfg, xs); if ((was.to || '') !== (draft.to || '') || was.kind !== draft.kind) arrivalPick([draft]); rerender();
    }
    else if ('itinIcs' in d) itinICS(cfg);
  });
  body.addEventListener('change', (e) => {
    const f = e.target.closest('[data-itin-file],[data-itin-fill]'); if (!f || !f.files || !f.files.length) return;
    const files = [...f.files]; f.value = ''; readFiles(files, formSlot());
  });
  // the booking an input belongs to: a review card's, else the open form's
  const target = (el) => { const c = el.closest('[data-rv-card]'); return c ? review[+c.dataset.rvCard] : draft; };
  body.addEventListener('input', (e) => {
    const x = e.target; const o = target(x); if (!o) return; const card = x.closest('[data-rv-card]');
    if (x.dataset.hk) { const box = x.closest('[data-hfbox]'); if (box) hfToBk(o, hfRead(box)); return; }
    if (x.dataset.det) { detSet(o, x.dataset.det, x.type === 'number' ? (x.value ? String(Math.max(1, Math.min(99, +x.value))) : '') : x.value.trim().slice(0, 200)); return; }
    if (!x.dataset.it) return;
    o[x.dataset.it] = x.value;
    if (x.dataset.it === 'kind' || x.dataset.it === 'via') { if (card) { const got = [...card.querySelectorAll('.got')].length; openReview(review); if (got) markGot(formSlot(), null); } else fill(); return; }
    if (x.dataset.it === 'flight') { // airline + number: the card names itself; status and manage links appear once saved
      const n = flightName(x.value); const ni = (card || formSlot()).querySelector('[data-it="name"]');
      if (n && ni && (!o.name || o.name === autoName || (card && o.name === o._auto))) { o.name = n; if (card) o._auto = n; else autoName = n; ni.value = n; }
    }
    if ((x.dataset.it === 'to' || x.dataset.it === 'from') && /^[a-z]{3}$/i.test(x.value)) o[x.dataset.it] = x.value.toUpperCase();
  });
}
// a screenshot or PDF dropped (anywhere on the page while My trip shows) or pasted (Cmd/Ctrl+V) → the bookings reader
const ITIN_DROP = { art: null };
const itinLive = () => { const a = ITIN_DROP.art; const s = a && a.isConnected && a.querySelector('#sec-itinerary'); return s && s.getClientRects().length ? s : null; };
const fileList = (dt) => [...((dt && dt.files) || [])].filter(f => /^image\//.test(f.type || '') || f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
document.addEventListener('dragover', (e) => { const s = itinLive(); if (!s || !(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'))) return; e.preventDefault(); s.classList.add('drop-on'); });
document.addEventListener('dragleave', (e) => { const s = itinLive(); if (s && (!e.relatedTarget || e.relatedTarget === document.documentElement)) s.classList.remove('drop-on'); });
document.addEventListener('drop', (e) => { const s = itinLive(); if (!s) return; s.classList.remove('drop-on'); const fs = fileList(e.dataTransfer); if (!fs.length) return; e.preventDefault(); ITIN_DROP.art._itinFiles(fs); s.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
document.addEventListener('paste', (e) => { const s = itinLive(); if (!s) return; const fs = fileList(e.clipboardData); if (!fs.length) return; e.preventDefault(); ITIN_DROP.art._itinFiles(fs); });

// a page in this device's list that was shared as this long link (same link, or the same page key once shared)
function ownLongPage(cfg, packed) {
  let xs = []; try { xs = pagesAll(); } catch { return null; }
  const key = cfg.ek || cfg._ek;
  return xs.find(x => x.url && x.url.split('#e=')[1] === packed) || (key ? xs.find(x => (x.url || x.hosted || x.shared) && x.cfg && (x.cfg.ek || x.cfg._ek) === key) : null) || null;
}
function renderViewer(cfg, { exampleId, tab } = {}) {
  LANG = guestLangPick(cfg); document.documentElement.lang = LANG; document.documentElement.dir = RTL.has(LANG) ? 'rtl' : 'ltr';
  // examples ship translated into the interface languages (examples-tr.js, loaded only when needed)
  if (exampleId && LANG !== srcLang(cfg) && window.EXAMPLES_TR === undefined) { window.EXAMPLES_TR = null; const sc = document.createElement('script'); sc.src = 'examples-tr.js'; sc.onload = sc.onerror = () => { if (!window.EXAMPLES_TR) window.EXAMPLES_TR = {}; route(); }; document.head.appendChild(sc); return; }
  if (exampleId && window.EXAMPLES_TR && window.EXAMPLES_TR[exampleId]) cfg.tr = { ...window.EXAMPLES_TR[exampleId], ...(cfg.tr || {}) };
  document.title = (cfg.title || 'Event') + ' · 1LinkTrip';
  const packed = location.hash.split('&t=')[0].slice(3);
  const editHref = exampleId ? `#edit-ex=${exampleId}` : `#edit=${packed}`;
  // a long (#e=) link: its organizer (this device has the page) or anyone signed in can save it to My pages, which gives it
  // the short link that always shows the latest version; other guests see the page as before
  const own = exampleId ? null : ownLongPage(cfg, packed);
  const canSave = !exampleId && SB && (own || LS.get('signedIn'));
  $('#app').innerHTML = `<div class="viewer"><div class="vbar"><a class="brand sm" href="#">${BRAND}</a>${exampleId ? `<span class="vbar-note">${t('Example page')}</span>` : ''}${canSave ? `<button type="button" class="btn sm primary" data-save-mine>${t('Save to My pages')}</button>` : vbarEditHTML(editHref, exampleId ? t('Customize this') : t('Edit a copy'))}</div><div id="ev-root"></div></div>`;
  $('.vbar').insertAdjacentHTML('beforeend', langPillsHTML(cfg) + langSelectHTML(cfg));
  requestAnimationFrame(pillInView);
  $('[data-save-mine]')?.addEventListener('click', (e) => saveLongToMine(packed, e.currentTarget));
  guestRender(cfg, $('#ev-root'), { tab, exampleId });
  const foot = $('.ev-foot a'); if (foot && exampleId) foot.setAttribute('href', editHref);
  if (location.search) $$('#app a[href="#"]').forEach(x => x.setAttribute('href', siteBase()));
  window.scrollTo(0, 0);
  scrollBack();
}

// ---------- editor ----------
let B = null; // builder state
function renderBuilder(cfg, source, hosted, pid) {
  LANG = uiLang(); document.documentElement.lang = LANG; document.documentElement.dir = 'ltr';
  B = { cfg: normalize(cfg), venueResults: [], card: null, hosted: hosted && hosted.id ? hosted : null, tab0: window.__ownTab || '' }; window.__ownTab = null;
  document.title = (B.cfg.title || 'Your page') + ' · 1LinkTrip'; delete B.cfg.demoTrip; // an example's sample My trip stays on the example
  { const f = spanFixed(B.cfg); if (f !== B.cfg) B.cfg = f; } // stored dates from an old import: fix them for good
  pagesAll(); // first run: the old single draft joins the list before this page replaces it (else it's listed twice)
  LS.set('draftHosted', B.hosted); B.pid = pid || newPid(); LS.set('draftId', B.pid); LS.set('draft', B.cfg); pageSave(B.pid, { cfg: B.cfg, hosted: B.hosted });
  $('#app').innerHTML = `
  <div class="builder" data-set="0">
    <header class="b-top">
      <a class="brand sm" href="#">${BRAND}</a>
      <button type="button" class="btn sm ghost b-gear" data-act="settings" aria-expanded="false" aria-controls="b-set">${GEAR_IC}<span>${t('Settings')}</span></button>
      <button class="btn primary sm" data-act="publish">${t('Share')}</button>
      <div class="b-save" data-save role="status" aria-live="polite"></div>
    </header>
    <div class="b-set" id="b-set"><div class="b-set-h"><b>${t('Page settings')}</b><button type="button" class="btn sm" data-act="settings">${t('Done')}</button></div><form class="b-form" autocomplete="off" onsubmit="return false">${source ? `<p class="b-note">${esc(source)}</p>` : ''}</form></div>
    <div class="b-preview"><div class="onp-bar"><label class="tool onp-tg"><input type="checkbox" data-guest-tg><span class="sw" aria-hidden="true"></span>${t('Preview as guest')}</label></div><div class="b-frame" id="preview"></div></div>
  </div>
  <dialog id="sheet" class="sheet"><form class="sheet-in" autocomplete="off" onsubmit="return false"></form></dialog>
  <dialog id="pub"><form method="dialog" class="pub">
    <h2>${t('Your page is ready to share')}</h2>
    <div data-pub-seg hidden>${shrSegHTML('plan')}</div>
    <div data-shr-p="plan"><p class="shr-sub" data-pub-sub hidden>${esc(t(SHR_SUB.plan))}</p>
    <textarea id="pub-url" readonly rows="4"></textarea>
    <div id="pub-host"></div>
    <div class="btns"><button type="button" class="btn primary" data-act="copy">${t('Copy link')}</button><button type="button" class="btn" data-act="native-share" hidden>${t('Share…')}</button><button type="button" class="btn" data-act="qr">${t('QR code')}</button><a class="btn" id="pub-open" href="#" target="_blank" rel="noopener noreferrer">${t('Open page')}</a><button class="btn ghost">${t('Close')}</button></div></div>
    <div data-shr-p="trip" hidden><div data-shr-box></div><div class="btns"><button class="btn ghost">${t('Close')}</button></div></div>
  </form></dialog>`;
  buildForm(); saveStatus('');
  if (locQ().get('e')) $$('#app a[href="#"]').forEach(x => x.setAttribute('href', siteBase())); // '#' can't leave a ?e= link
  const bl = $('.builder');
  { const top = $('.b-top'); const set = () => { if (top.isConnected) bl.style.setProperty('--btop', Math.round(top.getBoundingClientRect().height) + 'px'); }; set(); if (typeof ResizeObserver === 'function') new ResizeObserver(set).observe(top); }
  bl.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="settings"]')) setPanel(bl.dataset.set !== '1');
    if (e.target.closest('[data-act="publish"]')) publishTranslated();
  });
  const dlg = $('#pub');
  dlg.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'copy') copy($('#pub-url').value);
    if (a.dataset.act === 'native-share') navigator.share({ title: B.cfg.title, url: $('#pub-url').value }).catch(() => {});
    if (a.dataset.act === 'qr') openQR(B.cfg, $('#pub-url').value);
  });
  dlg.addEventListener('click', (e) => { const tb = e.target.closest('[data-shr-tab]'); if (tb && B.hosted) { B.shrCtx = B.shrCtx && B.shrCtx.eid === B.hosted.id ? B.shrCtx : { cfg: B.cfg, eid: B.hosted.id, slug: B.hosted.slug, owner: true, back: location.hash }; B.shrCtx.cfg = B.cfg; shrTab(dlg, tb.dataset.shrTab, B.shrCtx); } });
  const sh = $('#sheet');
  sh.addEventListener('close', () => { if (B.onp) onpCleanup(); B.onp = false; B.focus = null; B.onpSec = null; sh.classList.remove('onp'); B.card = null; if (DU && DU.key !== 'main') DU = null; buildForm(); });
  $('#preview').addEventListener('click', onpTap, true); $('#preview').addEventListener('keydown', onpTap, true);
  $('.onp-bar').addEventListener('click', (e) => { const b = e.target.closest('[data-pv-lang]'); if (!b) return; B.pvLang = b.dataset.pvLang === srcLang(B.cfg) ? '' : b.dataset.pvLang; paintPvLang(); preview(); });
  $('[data-guest-tg]').addEventListener('change', (e) => { B.asGuest = e.target.checked; bl.classList.toggle('as-guest', B.asGuest); if (B.asGuest && sh.open && B.onp) sh.close(); preview(); });
  if (!document._onpEsc) { document._onpEsc = true; document.addEventListener('keydown', (e) => { const d = $('#sheet'); if (e.key === 'Escape' && d && d.open && d.classList.contains('onp') && !d.matches(':modal') && !$('#confirmdlg[open]')) d.close(); }); }
  if (window.__sharePub) { window.__sharePub = false; setTimeout(() => publishTranslated(), 0); } // Share from the setup's last step or the owner's own page
  sh.addEventListener('click', (e) => { if (e.target === sh) sh.close(); });
  wireInputs(sh.querySelector('.sheet-in')); esWire(sh);
  DU = null; PH = null; wireDocs(sh.querySelector('.sheet-in')); wireDocs($('.b-form')); wirePageDrop(); docAIKnown(); wirePhotos(sh.querySelector('.sheet-in')); wirePhotos($('.b-form'));
  if (typeof wirePubHost === 'function') wirePubHost();
  pnWire();
  if (SB && (LS.get('signedIn') || B.hosted)) msgReady().then(ok => { if (ok && B && !$('[data-card="msgs"]')) buildForm(); }); // no network for signed-out drafts
  if (LS.get('signedIn') && SB) aiModes().then(m => { if (m.includes('translate') && B && !$('[data-card="langs"]')) buildForm(); });
  preview();
  if (window.__openCard) { const id = window.__openCard; window.__openCard = null; openCard(id); }
  if (acctOn()) acctPushNow(); // signed in: the page is on the account from the start (not shared until Share)
  wireVendors(); vnSync();
}
// Settings (type, design, sections, vendors, documents, AI edit): a panel over the page on phones, a column beside it on wide screens
function setPanel(on) {
  const bl = $('.builder'); if (!bl) return; bl.dataset.set = on ? '1' : '0';
  $$('[data-act="settings"]', bl).forEach(b => b.setAttribute('aria-expanded', String(on)));
  if (on) { const p = $('#b-set'); if (p) p.scrollTop = 0; }
  maps.forEach(m => { try { m.invalidateSize(); } catch {} });
}
async function publishTranslated() {
  const c = B.cfg; const langs = (c.langs || []).filter(l => l !== srcLang(c));
  if (langs.length && canTranslate() && langs.some(l => Object.keys(staleFields(c, l)).length)) {
    toast(t('Translating for your guests…'));
    try { await translateCfg(c); changed(); } catch { toast(t('Couldn’t translate right now; publishing in your language')); }
  }
  publish();
}
function publish(opts = {}) {
  const c = B.cfg; const problems = [];
  if (!c.title.trim()) problems.push(t('a title'));
  if (!c.start) problems.push(t('a date'));
  if (problems.length) { toast(t('Add {x} first', { x: problems.join(t(' and ')) })); return; }
  if (!c.ek) c.ek = eventKey(c); // pin the page's key (same value guests' devices already use) so its old links stay recognisable
  if (!$('#pub').open) { $('#pub').showModal(); if (B.shrCtx || $('#pub [data-shr-tab]')) shrTab($('#pub'), 'plan', B.shrCtx || {}); }
  // Share gives the page's one short link (?e=), the same link forever; signed out → sign in first (or a one-time long link)
  if (!SB || opts.long) return shareLong();
  hostNow();
}
// The long link carries the whole page in the URL, so later edits don't reach it (signed-out sharing only).
function shareLong() {
  const c = B.cfg; const url = shareURL(c); pubLink(url, 'Your page is ready to share', 4);
  LS.set('published:' + Date.now(), { title: c.title, url }); pageSave(B.pid, { cfg: c, url });
  B.pub = { state: SB ? 'long' : '' }; renderPubHost();
}
// show (url) or hide (null) the link box and its Copy / Share… / QR / Open buttons
function pubLink(url, title, rows = 2) {
  const on = !!url; $('#pub-url').hidden = !on; $$('#pub [data-act="copy"], #pub [data-act="qr"], #pub-open').forEach(x => { x.hidden = !on; });
  $('[data-act="native-share"]').hidden = !on || !navigator.share;
  if (on) { $('#pub-url').value = url; $('#pub-url').rows = rows; $('#pub-open').href = url; }
  if (title) $('#pub h2').textContent = t(title);
}
// Builder top bar: "Saving…" → "Saved". Signed in, Saved means saved to the account, and the page's link (once shared)
// shows it: there is nothing else to push.
const savedraft = debounce(() => { if (!B) return; LS.set('draft', B.cfg); pageSave(B.pid, { cfg: B.cfg, hosted: B.hosted }); if (acctOn()) acctPushSoon(); else saveStatus('saved'); }, 300);
const cfgHash = (c) => hashStr(JSON.stringify(c));
const builderHash = (cfg) => { const c = spanFixed(normalize(clone(cfg))); delete c.demoTrip; delete c.osm; return cfgHash(c); };
function saveStatus(st) {
  const el = $('[data-save]'); if (!el || !B) return;
  const txt = t(st === 'saving' ? 'Saving…' : st === 'saved' ? 'Saved' : st === 'local' ? 'Saved on this device' : '');
  el.innerHTML = txt ? `<span>${esc(txt)}</span>` : ''; shSaveStatus(st);
}
// "Preview in: English | 日本語": the organizer sees the page as guests in each language do (on-page editing stays on the original)
function pvLangHTML() { const c = B && B.cfg; const ls = c ? [srcLang(c), ...(c.langs || []).filter(l => l !== srcLang(c))] : []; if (ls.length < 2) { if (B) B.pvLang = ''; return ''; }
  if (!ls.includes(B.pvLang)) B.pvLang = ''; const cur = B.pvLang || srcLang(c);
  return `<span class="pv-lang" role="group" aria-label="${t('Preview in')}"><span class="muted small">${t('Preview in:')}</span>${ls.map(l => `<button type="button" class="pv-l ${l === cur ? 'on' : ''}" aria-pressed="${l === cur}" data-pv-lang="${l}">${esc(langName(l))}</button>`).join('')}</span>`; }
function paintPvLang() { const bar = $('.onp-bar'); if (!bar) return; let el = bar.querySelector('.pv-lang'); const h = pvLangHTML(); if (el) { if (h) el.outerHTML = h; else el.remove(); } else if (h) bar.insertAdjacentHTML('beforeend', h); }
const preview = debounce(() => { const p = $('#preview'); if (!p) return; const sc = p.parentElement; const y = sc.scrollTop; const tab = p.querySelector('[data-tab-go][aria-selected="true"]')?.dataset.tabGo || (B && B.tab0) || undefined; paintPvLang();
  const pl = B.pvLang && B.pvLang !== srcLang(B.cfg) ? B.pvLang : '';
  if (pl) { const was = LANG; LANG = pl; try { renderEvent(translatedView(B.cfg, pl), p, { preview: true, shareUrl: shareURL(B.cfg), tab, onpage: false, src: B.cfg }); } finally { LANG = was; } }
  else renderEvent(B.cfg, p, { preview: true, shareUrl: shareURL(B.cfg), tab, onpage: onpOn() });
  sc.scrollTop = y; }, 350);
function changed(rebuild) { if (B) { B.touched = true; B.seq = (B.seq || 0) + 1; } saveStatus('saving'); savedraft(); preview(); if (B && (B.cfg.langs || []).length) autoTranslate(); if (rebuild) { if (B.card) renderSheet(); else buildForm(); } }

const fieldWrapRaw = (text, html, id) => `<div class="field"><label${id ? ` for="${id}"` : ''}>${esc(text)}</label>${html}</div>`; // text: already translated
const fieldWrap = (label, html, id) => fieldWrapRaw(t(label), html, id);
// shorter labels inside a card sheet, where the card title already gives context (the page keeps the full labels)
const EDIT_LABEL = { rsvp: 'Link', rsvpBy: 'Reply by', blockHotel: 'Hotel', blockUrl: 'Booking link', blockCode: 'Code', blockBy: 'Book by',
  packet: 'Where', packetWhen: 'When', badge: 'Where', badgeWhen: 'When', checkin: 'Where', checkinWhen: 'When', closures: 'Details', closuresUrl: 'Link',
  openerAt: 'Opener time', headlinerAt: 'Headliner time', callTime: 'Call time', slot: 'Slot', program: 'Program', photo: 'Photo and video',
  spectators: 'Info', pickup: 'Rideshare pickup' };
function xFieldHTML(c, [k, label, kind, ph = ''], solo) {
  const d = typeData(c); const id = `x-${k}`; const val = d[k];
  label = EDIT_LABEL[k] || label; if (ph === label) ph = ''; label = t(label); ph = ph && !/^https?:/.test(ph) ? t(ph) : ph;
  if (solo && kind !== 'links' && kind !== 'place') { // the sheet title is the label
    const type = { url: 'url', date: 'date', time: 'time', datetime: 'datetime-local' }[kind] || 'text'; const a = `aria-label="${esc(label)}" placeholder="${esc(ph || label)}"`;
    return `<div class="field">${kind === 'lines' ? `<textarea id="${id}" data-x="${k}" rows="4" ${a}>${esc(val || '')}</textarea>` : `<input id="${id}" type="${type}" data-x="${k}" value="${esc(val || '')}" ${a}>`}</div>`;
  }
  if (solo && kind === 'links') return `<div class="field">${(val || []).map((l, i) => `<div class="rowed"><input data-xl="${k}" data-i="${i}" data-k="label" value="${esc(l.label)}" placeholder="${t('Name')}" aria-label="${esc(t('{s} name', { s: label }))}"><input data-xl="${k}" data-i="${i}" data-k="url" type="url" value="${esc(l.url)}" placeholder="https://…" aria-label="${esc(t('{s} link', { s: label }))}"><button type="button" class="ic del" data-xdel="${k}" data-i="${i}" aria-label="${t('Remove')}">${t('Remove')}</button></div>`).join('')}<button type="button" class="btn sm" data-xadd="${k}">${t('+ Add')}</button></div>`;
  if (kind === 'links') return `<div class="field"><label>${esc(label)}</label>${(val || []).map((l, i) => `<div class="rowed"><input data-xl="${k}" data-i="${i}" data-k="label" value="${esc(l.label)}" placeholder="${t('Name')}" aria-label="${esc(t('{s} name', { s: label }))}"><input data-xl="${k}" data-i="${i}" data-k="url" type="url" value="${esc(l.url)}" placeholder="https://…" aria-label="${esc(t('{s} link', { s: label }))}"><button type="button" class="ic del" data-xdel="${k}" data-i="${i}" aria-label="${t('Remove')}">${t('Remove')}</button></div>`).join('')}<button type="button" class="btn sm" data-xadd="${k}">${t('+ Add')}</button></div>`;
  if (kind === 'place') return `<div class="field"><label for="${id}">${esc(label)}</label><div class="search"><input id="${id}" data-xp="${k}" value="${esc(val ? val.q : '')}" placeholder="${esc(ph)}"><button type="button" class="btn" data-xfind="${k}">${t(val && val.lat != null ? 'Pinned' : 'Pin on map')}</button></div></div>`;
  if (kind === 'lines') return fieldWrapRaw(label, `<textarea id="${id}" data-x="${k}" rows="4" placeholder="${esc(ph)}">${esc(val || '')}</textarea>`, id);
  const type = { url: 'url', date: 'date', time: 'time', datetime: 'datetime-local' }[kind] || 'text';
  return fieldWrapRaw(label, `<input id="${id}" type="${type}" data-x="${k}" value="${esc(val || '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}>`, id);
}
function cardDone(c, id) {
  if (id === 'route') return stopsOf(c).length > 0;
  const tc = (TYPE_CARDS[c.type] || []).find(x => x[0] === id);
  if (tc) { const sp = typeSpec(c), d = typeData(c); return tc[3].some(k => { const f = sp.fields.find(x => x[0] === k); return f && filled(f[2], d[k]); }); }
  return { schedule: () => c.schedule.some(x => x.title), custom: () => c.custom.some(x => x.title.trim()), notes: () => c.notes.some(x => x.label), about: () => !!(c.description || c.host), look: () => !!c.cover, bring: () => !!c.bring.trim(),
    access: () => !!(c.access && Object.values(c.access).some(Boolean)), stays: () => presetsOf(c).length > 0, rsvp: () => rsvpOf(c).on, msgs: () => !!c.guestMessages, langs: () => (c.langs || []).length > 0 }[id]?.() || false;
}
const cardBtn = (c, [id, title, sub]) => { const done = cardDone(c, id); return `<button type="button" class="acard ${done ? 'on' : ''}" data-card="${id}"><span class="aic">${cardIcon(id)}</span><b>${esc(t(title))}</b><span>${esc(t(sub))}</span><i class="plus" aria-hidden="true">${done ? '✓' : '+'}</i></button>`; };
function allCards(c) {
  const cc0 = COMMON_CARDS.filter(x => (x[0] !== 'langs' || canTranslate() || (c.langs || []).length) && (x[0] !== 'msgs' || msgReadyNow()));
  if (isTrip(c)) return { type: TYPE_CARDS[c.type] || [], common: cc0.filter(x => x[0] !== 'rsvp').map(x => x[0] === 'schedule' ? ['schedule', 'Day by day', 'Plans, bookings'] : x) };
  if (c.type === 'Wedding') return { type: cc0.filter(x => x[0] === 'rsvp').concat(TYPE_CARDS.Wedding), common: cc0.filter(x => x[0] !== 'rsvp') }; // RSVP leads For weddings
  return { type: TYPE_CARDS[c.type] || [], common: cc0 };
}
function buildForm() {
  const c = B.cfg; const f = $('.b-form'); if (!f) return; const keepNote = f.querySelector('.b-note:not(.b-host)'); const keepAI = f.querySelector('[data-ai-edit]');
  const open = new Set($$('details[data-acc][open]', f).map(d => d.dataset.acc)); B.moreOpen = open.has('design-more');
  if (!f.dataset.init) { f.dataset.init = '1'; if (!c.title) open.add('basics'); }
  const basicsOk = !!c.title.trim(); const whenOk = !!(c.start && c.venue);
  const cards = allCards(c);
  f.innerHTML = `${keepNote ? keepNote.outerHTML : ''}
  <details class="acc" data-acc="basics" ${open.has('basics') ? 'open' : ''}><summary><span class="st ${basicsOk ? 'ok' : ''}" aria-hidden="true"></span><b>${t('Basics')}</b><small>${esc([c.type && t(TYPE_LABEL[c.type] || c.type), c.title].filter(Boolean).join(' · '))}</small></summary><div class="acc-b">
    ${fieldWrap('Event type', `<select id="f-type" data-f="type">${TYPES.map(x => `<option value="${x}" ${x === c.type ? 'selected' : ''}>${esc(t(TYPE_LABEL[x] || x))}</option>`).join('')}</select>`, 'f-type')}
    ${fieldWrap('Title', `<input id="f-title" data-f="title" value="${esc(c.title)}" maxlength="80">`, 'f-title')}
    ${fieldWrap('Tagline', `<input id="f-tagline" data-f="tagline" value="${esc(c.tagline)}" maxlength="140" placeholder="${t('Optional')}">`, 'f-tagline')}
  </div></details>
  <details class="acc" data-acc="when" ${open.has('when') ? 'open' : ''}><summary><span class="st ${whenOk ? 'ok' : ''}" aria-hidden="true"></span><b>${t('When and where')}</b><small>${esc([c.start ? fmt(c.start.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) : '', c.venue ? c.venue.name : ''].filter(Boolean).join(' · '))}</small></summary><div class="acc-b">
    ${whenFieldsHTML(c, 'f')}
    ${venueFieldHTML(c)}
    ${flyIntoFieldHTML(c)}
  </div></details>
  <details class="acc" data-acc="design" ${open.has('design') ? 'open' : ''}><summary><span class="st ok" aria-hidden="true" style="background:${esc(c.theme.accent)};border-color:${esc(c.theme.accent)}"></span><b>${t('Design')}</b><small>${esc([FONTS[c.theme.font]?.label, c.theme.mode === 'dark' ? 'Dark' : 'Light', c.cover ? 'Cover photo' : ''].filter(Boolean).map(x => t(x)).join(' · '))}</small></summary><div class="acc-b">
    ${designHTML(c)}
  </div></details>
  <details class="acc" data-acc="sections" ${open.has('sections') ? 'open' : ''}><summary><span class="st ok" aria-hidden="true"></span><b>${t('Sections')}</b><small>${esc(sectionsSum(c))}</small></summary><div class="acc-b">
    ${sectionsHTML(c)}
  </div></details>
  ${vnAccHTML(c, open.has('vendors'))}
  ${docBlockHTML('main')}
  <h2 class="b-h">${t('Add to your page')}</h2>
  ${cards.type.length ? `<p class="grp">${esc(t(TYPE_GROUP[c.type]))}</p><div class="cards">${cards.type.map(x => cardBtn(c, x)).join('')}</div>` : ''}
  <p class="grp">${t('For any event')}</p><div class="cards">${cards.common.map(x => cardBtn(c, x)).join('')}</div>
  <div class="b-end"><button type="button" class="btn primary" data-act="publish">${t('Share')}</button><button type="button" class="btn ghost" data-b="reset">${t('Start over')}</button></div>`;
  wireInputs(f);
  if (typeof renderHostNote === 'function') renderHostNote();
  // the AI edit box survives form rebuilds (its preview and Undo live in it)
  if (keepAI) f.insertBefore(keepAI, f.firstChild); else if (SB && LS.get('signedIn')) { f.insertAdjacentHTML('afterbegin', aiEditHTML()); wireAIEdit(); }
  placeAutocomplete($('#vq', f), { bias: () => null, onPick: (id, tok) => gpVenue(id, tok).then(r => { B.vq = ''; B.venueResults = []; pickVenue(r); }).catch(() => toast(t('Couldn’t load that place'))) });
}
// "Fly into": the airport guests are pointed to (ticket, Travel → flights, rental cars). Automatic unless the organizer picks one.
function flyIntoFieldHTML(c, p = 'f') {
  const v = c.venue; if (!v || !isFinite(v.lat) || !isFinite(v.lon)) return '';
  const { list, auto } = airportChoices(v.lat, v.lon); if (!list.length) return '';
  const pin = c.flyInto && !list.some(a => a.iata === c.flyInto) && airportByCode(c.flyInto) ? [apRow(airportByCode(c.flyInto), v.lat, v.lon)] : [];
  const lab = (a) => `${a.iata} · ${a.city || a.name} · ${fmtDist(a.d, v.cc)}`; const au = list.find(a => a.iata === auto);
  return fieldWrap('Fly into', `<select id="${p}-fly" data-f="flyInto"><option value="">${esc(au ? `${t('Automatic')} (${au.iata} · ${au.city || au.name})` : t('Automatic'))}</option><option value="none"${c.flyInto === 'none' ? ' selected' : ''}>${t('No airport (don\'t show flying info)')}</option>${list.concat(pin).map(a => `<option value="${esc(a.iata)}"${a.iata === c.flyInto ? ' selected' : ''}>${esc(lab(a))}</option>`).join('')}</select>${p === 'sh' ? '' : `<p class="hint">${t('The airport guests see on the ticket, flight searches and rental cars. Change it, or pick No airport if guests won’t fly.')}</p>`}`, p + '-fly');
}
function venueFieldHTML(c) {
  return c.venue ? `<div class="venue-sel"><div><b>${esc(c.venue.name)}</b><span>${esc(c.venue.address || '')}</span></div><button type="button" class="btn sm" data-b="clear-venue">${t('Change')}</button></div>
      ${fieldWrap('Venue name on the page', `<input id="f-vname" data-v="name" value="${esc(c.venue.name)}">`, 'f-vname')}`
    : `<div class="field"><label for="vq">${t(isTrip(c) ? 'Destination' : 'Venue')}</label><div class="search"><input id="vq" placeholder="${t(isTrip(c) ? 'City or region' : 'Venue name or address')}" value="${esc(B.vq || '')}"><button type="button" class="btn" data-b="search">${t('Search')}</button></div></div>
      <ul class="vres">${B.venueResults.map((r, i) => `<li><button type="button" data-pick="${i}"><b>${esc(r.name)}</b><span>${esc(r.display)}</span></button></li>`).join('')}</ul>${B.vmsg ? `<p class="hint">${esc(B.vmsg)}</p>` : ''}`;
}
function openCard(id) { if (B.onp) { onpCleanup(); B.focus = null; B.onpSec = null; } B.shDirty = false; B.shSave = ''; if (id === 'custom' && !B.cfg.custom.length) B.cfg.custom.push(blankCustom()); if (DU && DU.key !== 'main') DU = null; B.card = id; B.spEdit = null; renderSheet(); const sh = $('#sheet'); if (!sh.open) sh.showModal(); esAutogrow(sh); }
function renderSheet() {
  const c = B.cfg; const id = B.card; const form = $('#sheet .sheet-in'); if (!form || !id) return;
  const tc = (TYPE_CARDS[c.type] || []).find(x => x[0] === id); const cc = allCards(c).common.find(x => x[0] === id) || COMMON_CARDS.find(x => x[0] === id);
  const title = tc ? t(tc[1]) : cc ? t(cc[1]) : id === 'vendor' ? (vnCur() || {}).name || t('Vendor') : ''; let body = '';
  const op = B.onp ? onpSheet(c, id) : null; const F = B.onp && B.focus || null; const fi = F ? onpIdx(c) : -1;
  const only = (k, i) => !F || F.k !== k || i === fi; const one = (k) => !!F && F.k === k;
  if (op) body = op.body;
  else if (id === 'route') body = one('st') && fi >= 0 ? stopCardHTML(c, fi) : routeHTML(c, one('st') ? fi : null);
  else if (tc) { const sp = typeSpec(c); body = tc[3].map(k => xFieldHTML(c, sp.fields.find(f => f[0] === k), tc[3].length === 1)).join('');
    const bd = typeData(c); if (id === 'block') body += hfFormHTML(hfOfBlock(bd), 'hf-block', { en: true, note: true, attr: 'data-hf-block' });
    if (id === 'block' && BLOCK_KEYS.some(k => bd[k])) body += `<div class="btns"><button type="button" class="btn sm bk-rm hb-rm" data-b="rm-block">${TRASH_IC}${esc(t('Remove {n}', { n: bd.blockHotel || t('room block') }))}</button></div>`; }
  else if (id === 'schedule' && one('s') && fi >= 0) body = itemCardHTML(c, fi);
  else if (id === 'schedule' && isTrip(c)) body = tripPlanHTML(c, F && F.k === 'day' ? { day: F.d } : one('s') ? { item: fi } : null);
  else if (id === 'schedule') body = `${c.schedule.map((x, i) => !only('s', i) ? '' : `<div class="rowed"><div class="two"><input type="date" data-s="${i}" data-k="date" value="${esc(x.date)}" aria-label="${t('Date')}"><input type="time" data-s="${i}" data-k="time" value="${esc(x.time)}" aria-label="${t('Time')}"></div><input data-s="${i}" data-k="title" value="${esc(x.title)}" placeholder="${t('What\'s happening')}" aria-label="${t('Title')}">${schedPlaceHTML(x, i)}${hotelCiLine(x) ? schedHotelHF(x, i) : `<input data-s="${i}" data-k="note" value="${esc(x.note)}" placeholder="${t('Note (optional)')}" aria-label="${t('Note')}">`}${hotelCiLine(x) ? `<button type="button" class="ic del bk-rm" data-sdel="${i}" data-sdel-hotel aria-label="${esc(t('Remove hotel'))} ${esc(hostHotelName(x.title))}">${TRASH_IC}${t('Remove hotel')}</button>` : `<button type="button" class="ic del" data-sdel="${i}" aria-label="${t('Remove item')}">${t('Remove')}</button>`}</div>`).join('')}
    ${one('s') ? '' : `<div class="btns"><button type="button" class="btn sm" data-b="add-sched">${t('+ Add item')}</button>${typeof importButtonHTML === 'function' ? importButtonHTML() : ''}</div>`}`;
  else if (id === 'notes' && one('n') && fi >= 0) { const x = c.notes[fi]; body = `<div class="rowed es-card"><input class="es-title" data-n="${fi}" data-k="label" value="${esc(x.label)}" placeholder="${t('Title')}" aria-label="${t('Title')}">
    <label class="es-line es-note">${esIc('pencil')}<input data-n="${fi}" data-k="text" value="${esc(x.text || '')}" placeholder="${t('Add text')}" aria-label="${t('Text')}"></label>
    <label class="es-line es-note">${esIc('link')}<input data-n="${fi}" data-k="url" type="url" value="${esc(x.url || '')}" placeholder="${t('Add a link')}" aria-label="${t('Link')}"></label></div>`; }
  else if (id === 'notes') body = `${c.notes.map((x, i) => !only('n', i) ? '' : `<div class="rowed"><input data-n="${i}" data-k="label" value="${esc(x.label)}" placeholder="${t('Title')}" aria-label="${t('Title')}"><input data-n="${i}" data-k="text" value="${esc(x.text || '')}" placeholder="${t('Text')}" aria-label="${t('Text')}"><input data-n="${i}" data-k="url" type="url" value="${esc(x.url || '')}" placeholder="${t('Link (optional)')}" aria-label="${t('Link')}">${F ? '' : B.onp ? `<div class="plan-ctl"><span class="mv"><button type="button" data-onp-mv="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="${t('Move up')}">↑</button><button type="button" data-onp-mv="${i}" data-dir="1" ${i === c.notes.length - 1 ? 'disabled' : ''} aria-label="${t('Move down')}">↓</button></span><button type="button" class="ic del" data-ndel="${i}" aria-label="${t('Remove')}">${t('Remove')}</button></div>` : `<button type="button" class="ic del" data-ndel="${i}" aria-label="${t('Remove')}">${t('Remove')}</button>`}</div>`).join('')}
    ${one('n') ? '' : `<button type="button" class="btn sm" data-b="add-note">+ ${t('Add note')}</button>`}`;
  else if (id === 'custom') body = `${c.custom.map((x, i) => !only('cs', i) ? '' : `<div class="rowed cs-row"><input data-cs="${i}" data-k="title" value="${esc(x.title)}" placeholder="${t('Title')}" aria-label="${t('Title')}" maxlength="80" required>
    <textarea data-cs="${i}" data-k="text" rows="4" placeholder="${t('Text')}" aria-label="${t('Text')}" maxlength="3000">${esc(x.text)}</textarea>
    <div class="two"><input data-cs="${i}" data-k="label" value="${esc(x.label)}" placeholder="${t('Link name')}" aria-label="${t('Link name')}" maxlength="80"><input data-cs="${i}" data-k="url" type="url" value="${esc(x.url)}" placeholder="${t('Link, https://…')}" aria-label="${t('Link')}"></div>
    ${SB ? photoCtlHTML('cs:' + i, x.img, `<input data-cs="${i}" data-k="img" type="url" value="${esc(x.img)}" placeholder="${t('or a photo link, https://…')}" aria-label="${t('Photo link')}">`) : `<div class="cover-row">${httpsUrl(x.img) ? `<img src="${esc(x.img)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<input data-cs="${i}" data-k="img" type="url" value="${esc(x.img)}" placeholder="${t('Photo link, https://…')}" aria-label="${t('Photo link')}"></div>`}
    ${docBlockHTML(customSid(x))}
    ${F ? '' : `<button type="button" class="ic del" data-cdel="${i}" aria-label="${esc(t('Delete {n}', { n: x.title || t('section') }))}">${t('Delete')}</button>`}</div>`).join('')}
    ${one('cs') ? '' : `<button type="button" class="btn sm" data-b="add-custom">+ ${t('Add section')}</button>`}`;
  else if (id === 'langs') body = langsCardHTML(c);
  else if (id === 'about') body = `${aboutSiteHTML(c)}${fieldWrap('Hosted by', `<input id="f-host" data-f="host" value="${esc(c.host)}">`, 'f-host')}${fieldWrap('About', `<textarea id="f-desc" data-f="description" rows="6">${esc(c.description)}</textarea>`, 'f-desc')}`;
  else if (id === 'look') body = `${coverFieldHTML(c)}
    <div class="field"><label>${t('Color')}</label><div class="swatches">${SWATCHES.map(s => `<button type="button" class="sw ${s.toLowerCase() === c.theme.accent.toLowerCase() ? 'on' : ''}" style="background:${s}" data-sw="${s}" aria-label="${esc(t('Color'))} ${s}"></button>`).join('')}<input type="color" data-t="accent" value="${esc(c.theme.accent)}" aria-label="${t('Custom color')}"></div></div>
    <div class="field"><label>${t('Title font')}</label><div class="fonts">${Object.entries(FONTS).map(([k, x]) => `<button type="button" class="fontb ${k === c.theme.font ? 'on' : ''}" data-font="${k}" style="font-family:${esc(x.css)}">${esc(t(x.label))}</button>`).join('')}</div></div>
    <div class="field"><label>${t('Background')}</label><div class="seg2"><button type="button" data-theme-mode="light" class="${c.theme.mode !== 'dark' ? 'on' : ''}">${t('Light')}</button><button type="button" data-theme-mode="dark" class="${c.theme.mode === 'dark' ? 'on' : ''}">${t('Dark')}</button></div></div>`;
  else if (id === 'bring') body = fieldWrap('Guests must bring', `<textarea id="f-bring" data-f="bring" rows="5" placeholder="${t('One per line')}">${esc(c.bring)}</textarea>`, 'f-bring');
  else if (id === 'stays') body = presetsCardHTML(c);
  else if (typeof extraCardBody === 'function') body = extraCardBody(id, c);
  const head = (op && t(op.title)) || (F && onpTitle(c, id)) || title;
  if (id !== 'custom' && !F && docCardOk(c, id)) body += docBlockHTML(id);
  const foot = B.onp ? onpFoot(c) : ''; const menu = shMenu(c, id, F, fi);
  setTimeout(() => { if (id === 'stays') wirePresetAC(); if (id === 'schedule') wireSchedPlaceAC(); if (id === 'route') wireRouteAC(c); if (id === 'msgs') loadCardGroups(); if (id === 'when') { const q = $('#sheet #vq-sh'); if (q) placeAutocomplete(q, { bias: () => null, onPick: (pid, tok) => gpVenue(pid, tok).then(r => { B.vq = ''; B.venueResults = []; pickVenue(r); }).catch(() => toast(t('Couldn’t load that place'))) }); } }, 0);
  const lbl = F && (F.k === 's' || F.k === 'st') ? shEyebrow(c, F, fi) || head : head;
  form.innerHTML = `<div class="grab" aria-hidden="true"></div><div class="sh-top"><h2><span class="sh-lbl" tabindex="-1" autofocus>${esc(lbl)}</span><button type="button" class="x sh-round" data-b="close" aria-label="${t('Close')}">×</button></h2>${shSavedHTML()}${menu}</div>
    <div class="sheet-b${F ? ' es-one' : ''}">${body}</div><div class="sh-foot">${foot}<button type="button" class="btn primary big" data-b="close">${t('Done')}</button></div><p class="vh" role="status" aria-live="polite" data-sh-live></p>`;
  esAutogrow(form);
}
// one input handler for the form and the card sheet
function wireInputs(root) {
  const c = () => B.cfg;
  root.oninput = (e) => {
    const i = e.target; const d = i.dataset; const cfg = c();
    const xd = () => (cfg.x[cfg.type] = cfg.x[cfg.type] || {});
    if (d.hk) { const box = i.closest('[data-hfbox]'); if (!box) return; const h = hfRead(box); // hotel fields: a check-in row, the room block, a stay option
      if (box.dataset.hfS != null) { const x = cfg.schedule[+box.dataset.hfS]; if (x) hfToObj(x, h); }
      else if ('hfBlock' in box.dataset) hfToObj(xd(), h, BLOCK_HF);
      else if (box.dataset.hfPr != null) { const p = (cfg.presets || [])[+box.dataset.hfPr]; if (p && p.h) hfToObj(p.h, h); }
      changed(); return; }
    if (designInput(i, cfg) || routeInput(i, cfg) || langsInput(i, cfg)) return;
    if (d.when) { whenInput(cfg, d.when, i.value); changed(); }
    else if (d.x) { xd()[d.x] = i.value; changed(); }
    else if (d.xl) { xd()[d.xl][+d.i][d.k] = i.value; changed(); }
    else if (d.xp) { xd()[d.xp] = i.value ? { q: i.value } : null; const fb = root.querySelector(`[data-xfind="${d.xp}"]`); if (fb) fb.textContent = t('Pin on map'); changed(); }
    else if (d.f) { cfg[d.f] = i.value; if (d.f === 'start' && cfg.end && cfg.end < cfg.start) { cfg.end = ''; const en = root.querySelector('[data-f="end"]'); if (en) en.value = ''; } changed(d.f === 'type'); }
    else if (d.v) { cfg.venue[d.v] = i.value; changed(); }
    else if (d.t) { cfg.theme[d.t] = i.value; $$('.sw', root).forEach(s => s.classList.remove('on')); changed(); }
    else if (d.spQ != null) return; // place search: read on pick / Find
    else if (d.s != null) { cfg.schedule[+d.s][d.k] = i.value; changed(); }
    else if (d.n != null) { cfg.notes[+d.n][d.k] = i.value; changed(); }
    else if (d.cs != null) { const x = cfg.custom[+d.cs]; if (x) { x[d.k] = i.value; changed(); } }
    else if (d.tool) { cfg.tools[d.tool] = i.checked; changed(true); }
    else if (d.pr != null) { presetInput(cfg, +d.pr, d.k, i.value); changed(); }
    else if (i.id === 'vq' || i.id === 'vq-sh') B.vq = i.value;
    else if (i.id === 'f-site') B.site = i.value;
    else if (typeof extraInput === 'function') extraInput(i, cfg);
  };
  root.onchange = (e) => { routeChange(e.target, c()); };
  root.onkeydown = (e) => { if ((e.target.id === 'vq' || e.target.id === 'vq-sh') && e.key === 'Enter') { e.preventDefault(); venueSearch(); } if (e.target.id === 'f-site' && e.key === 'Enter') { e.preventDefault(); aboutFill(); } };
  root.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset; const cfg = c();
    if (root.closest('#sheet') && esClick(b, cfg)) return;
    if (B.onp && root.closest('#sheet') && onpClick(b, cfg)) return;
    if (designClick(b, cfg) || tripClick(b, cfg) || routeClick(b, cfg)) return;
    if (b.dataset.trGo || b.dataset.trEdit) { langsClick(b, cfg); return; }
    if (d.whenTg != null) { whenToggle(cfg); changed(true); setTimeout(() => root.querySelector(hasTime(cfg.start) ? '[data-when="st"]' : '[data-when-tg]')?.focus(), 0); }
    else if (d.card) openCard(d.card);
    else if (d.b === 'close') $('#sheet').close();
    else if (d.b === 'search') venueSearch();
    else if (d.b === 'site-fill') { if (!B.siteBusy) aboutFill(); }
    else if (d.pick != null) pickVenue(B.venueResults[+d.pick]);
    else if (d.b === 'clear-venue') { cfg.venue = null; cfg.tz = ''; if (!noFly(cfg)) delete cfg.flyInto; B.venueResults = []; B.vmsg = ''; changed(true); setTimeout(() => $('#vq')?.focus(), 0); }
    else if (d.sw) { cfg.theme.accent = d.sw; changed(true); }
    else if (d.font) { cfg.theme.font = d.font; loadFont(d.font); changed(true); }
    else if (d.themeMode) { cfg.theme.mode = d.themeMode; changed(true); }
    else if (d.b === 'rm-block') { // the room block's hotel, code, link and book-by go together; Undo puts them back
      const xd = cfg.x[cfg.type] || {}; const was = Object.fromEntries(BLOCK_KEYS.map(k => [k, xd[k]])); BLOCK_KEYS.forEach(k => { delete xd[k]; }); changed(true);
      undoToast(`Removed ${was.blockHotel || 'the room block'}`, () => { if (c() !== cfg) return; const y = (cfg.x[cfg.type] = cfg.x[cfg.type] || {}); BLOCK_KEYS.forEach(k => { if (was[k] != null) y[k] = was[k]; }); changed(true); }); }
    else if (d.b === 'add-sched') { const last = cfg.schedule[cfg.schedule.length - 1]; cfg.schedule.push({ date: last?.date || cfg.start.slice(0, 10), time: '', title: '', note: '' }); changed(true); }
    else if (d.sdel != null && 'sdelHotel' in d) { // a hotel: its check-in and its check-out go together; Undo puts both back
      const x = cfg.schedule[+d.sdel]; if (!x) return; const was = cfg.schedule.slice(); const gone = [x, ...hotelCoLines(cfg.schedule, x)];
      cfg.schedule = cfg.schedule.filter(y => !gone.includes(y)); changed(true); undoToast(`Removed ${hostHotelName(x.title) || 'the hotel'}`, () => { if (c() !== cfg) return; cfg.schedule = was; changed(true); }); }
    else if (d.sdel != null) { cfg.schedule.splice(+d.sdel, 1); changed(true); }
    else if (d.spFind != null) schedPlaceFind(+d.spFind, (root.querySelector(`[data-sp-q="${d.spFind}"]`) || {}).value || '');
    else if (d.spChg != null) { B.spEdit = +d.spChg; renderSheet(); setTimeout(() => { const q = $(`#sheet [data-sp-q="${d.spChg}"]`); if (q) { q.focus(); q.select(); } }, 30); }
    else if (d.spDel != null) { const x = cfg.schedule[+d.spDel]; if (x) { delete x.place; B.spEdit = null; changed(true); } }
    else if (d.b === 'add-note') { cfg.notes.push({ label: '', text: '', url: '' }); changed(true); }
    else if (d.b === 'add-preset') { presetAdd(cfg); changed(true); }
    else if (d.prDel != null) { (cfg.presets || []).splice(+d.prDel, 1); if (!cfg.presets.length) delete cfg.presets; changed(true); }
    else if (d.prHotel != null) { const p = (cfg.presets || [])[+d.prHotel]; const x = presetHotelChoices(cfg)[+d.h]; if (p && x) { p.h = { ...x }; changed(true); } }
    else if (d.ndel != null) { cfg.notes.splice(+d.ndel, 1); changed(true); }
    else if (d.b === 'add-custom') { cfg.custom.push(blankCustom()); changed(true); setTimeout(() => $$('#sheet [data-cs][data-k="title"]').pop()?.focus(), 0); }
    else if (d.cdel != null) {
      const x = cfg.custom[+d.cdel]; if (!x) return;
      const drop = () => { const sid = customSid(x); const i = cfg.custom.indexOf(x); if (i < 0) return; cfg.custom.splice(i, 1); delete cfg.off[sid]; if (Array.isArray(cfg.order)) cfg.order = cfg.order.filter(k => k !== sid); changed(true); };
      if (![x.title, x.text, x.label, x.url, x.img].join('').trim()) drop();
      else confirmDlg({ title: t('Delete “{n}”?', { n: x.title.trim() || t('Custom section') }), ok: t('Delete') }).then(yes => { if (yes) drop(); });
    }
    else if (d.xadd) { const x = (cfg.x[cfg.type] = cfg.x[cfg.type] || {}); (x[d.xadd] = x[d.xadd] || []).push({ label: '', url: '' }); changed(true); }
    else if (d.xdel) { cfg.x[cfg.type][d.xdel].splice(+d.i, 1); changed(true); }
    else if (d.xfind) pinPlace(d.xfind, b);
    else if (d.b === 'reset') { if (confirm(t('Clear this draft and start over?'))) { LS.del('draft'); renderSetup(); } }
    else if (typeof extraClick === 'function') extraClick(b, cfg);
  };
}
// ---------- on-page editing: in the builder preview, tap a part of the page to edit just that part ----------
// The page is rendered with { onpage: true } (helpers tag items with data-ed); onpDecorate adds the pencils and + buttons.
// A tap opens the card sheet with only that part's fields (B.onp, B.focus = one item); both paths edit the same B.cfg.
const onpOn = () => !!B && !B.asGuest; // the owner's page is editable by tapping unless they preview it as a guest
const ONP_SEC = { route: 'route', about: 'about', details: 'details', rsvp: 'rsvp', access: 'access', schedule: 'schedule' };
const ONP_PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
const GEAR_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
// The owner's page is the guest page; every part they can edit is one tap target (data-ed) with a light hover/press state.
// Blocks (cover, ticket, section headings) carry a small pencil mark — a hint inside the target, not a second button.
function onpDecorate(cfg, art) {
  art.classList.add('onp');
  const mark = `<i class="onp-mk" aria-hidden="true">${ONP_PEN}</i>`;
  const target = (el, ed, label) => { el.dataset.ed = ed; if (!/^(BUTTON|A)$/.test(el.tagName)) { el.tabIndex = 0; el.setAttribute('role', 'button'); } if (label) el.setAttribute('aria-label', t(label)); };
  const hero = art.querySelector('.ev-hero');
  if (hero && !hero.dataset.ed) { target(hero, 'hero', 'Edit title and photo'); hero.insertAdjacentHTML('beforeend', mark); }
  const sm = art.querySelector('.stub-main');
  if (sm && !sm.dataset.ed) { target(sm, 'when', isTrip(cfg) ? 'Edit dates and destination' : 'Edit date and place'); sm.classList.add('onp-box'); sm.insertAdjacentHTML('beforeend', mark); }
  // the ticket's "Fly into" (or, with No airport, the date in its place): tap → just that choice
  const ss = art.querySelector('.stub-side');
  if (ss && !ss.dataset.ed && flyIntoFieldHTML(cfg)) { target(ss, 'fly', 'Edit fly into airport'); ss.classList.add('onp-side'); ss.insertAdjacentHTML('afterbegin', mark); }
  // other tagged items (itinerary rows, notes, stops, need-to-know rows) are focusable taps too
  $$('[data-ed]', art).forEach(el => { if (el.tabIndex < 0 && !/^(BUTTON|A)$/.test(el.tagName)) { el.tabIndex = 0; el.setAttribute('role', 'button'); } });
  const body = art.querySelector('.ev-panel[data-panel="event"] .ev-body'); if (!body) return;
  $$('[data-sec]', body).forEach(s => {
    const id = s.dataset.sec; if (s.dataset.ed || !(ONP_SEC[id] || /^c-/.test(id))) return;
    s.dataset.ed = 'sec:' + id; s.classList.add('onp-sec');
    const h = s.querySelector('.sec-h'); if (h) { h.insertAdjacentHTML('beforeend', mark); h.tabIndex = 0; h.setAttribute('role', 'button'); h.setAttribute('aria-label', t('Edit {s}', { s: h.textContent })); }
    const sb = s.querySelector('.sec-b') || s;
    const add = (ed, label, where = sb) => where.insertAdjacentHTML('beforeend', `<button type="button" class="onp-add" data-ed="${esc(ed)}">+ ${esc(t(label))}</button>`);
    if (id === 'schedule') {
      $$('.day[data-day]', s).forEach(dd => { const d = dd.dataset.day; const ol = dd.querySelector('ol.tl'); if (d && ol) ol.insertAdjacentHTML('beforeend', `<li class="onp-li"><button type="button" class="onp-add" data-ed="add:s:${esc(d)}">+ ${t(isTrip(cfg) ? 'Add to this day' : 'Add item')}</button></li>`); });
      const row = document.createElement('div'); row.className = 'onp-adds'; sb.appendChild(row);
      add('add:s', isTrip(cfg) ? 'Add to itinerary' : 'Add item', row); if (routeInItin(cfg)) add('add:st', 'Add a stop', row);
    }
    if (id === 'route') add('add:st', 'Add a stop');
    if (id === 'details') add('add:n', 'Add note');
  });
  if (!body.querySelector('[data-ed="gallery"]')) body.insertAdjacentHTML('beforeend', `<button type="button" class="onp-add onp-more" data-ed="gallery">+ ${t('Add section')}</button>`);
  // sections filled in later (access, the RSVP slot) get theirs when they arrive
  if (!art._onpMo && typeof MutationObserver === 'function') { art._onpMo = new MutationObserver(() => { if (document.body.contains(art) && body.querySelector('[data-sec]:not([data-ed])')) onpDecorate(cfg, art); }); art._onpMo.observe(body, { childList: true, subtree: true }); }
}
// capture-phase tap on the preview: an edit target opens its sheet instead of doing what it does for guests
// A section (sec:…) is a target only where nothing inside it is: its day toggles, links and booking rows keep doing what
// they do for guests. An item (a row, a stop, the cover, the ticket) is edited wherever it's tapped.
function onpTap(e) {
  if (!B || !onpOn()) return;
  const art = e.target.closest('.ev.onp'); if (!art || e.target.closest('.ev-tabs, dialog')) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[data-ed]'); if (!el || !art.contains(el)) return;
  if (e.type === 'keydown' && el.tagName === 'BUTTON') return; // a button's own click follows
  if (/^sec:/.test(el.dataset.ed)) { const ia = e.target.closest('a[href], button, summary, input, select, textarea, label, [data-ds]'); if (ia && el.contains(ia)) return; }
  e.preventDefault(); e.stopPropagation(); onpGo(el.dataset.ed);
}
function onpGo(ed) {
  const c = B.cfg; const [k, a = '', b = ''] = ed.split(':');
  if (k === 'hero' || k === 'when' || k === 'gallery' || k === 'fly') return onpOpen(k);
  if (k === 'sec') { if (/^c-/.test(a)) { const x = c.custom.find(y => customSid(y) === a); return x ? onpOpen('custom', { k: 'cs', o: x }, a) : null; } return onpOpen(ONP_SEC[a] || a, null, a); }
  if (k === 's' && c.schedule[+a]) return onpOpen('schedule', { k: 's', o: c.schedule[+a], i: +a });
  if (k === 'day') return onpOpen('schedule', { k: 'day', d: a });
  if (k === 'st' && (c.stops || [])[+a]) return onpOpen('route', { k: 'st', o: c.stops[+a], i: +a });
  if (k === 'n' && c.notes[+a]) return onpOpen('notes', { k: 'n', o: c.notes[+a], i: +a });
  if (k === 'x') { const tc = fieldCard(c, a); return onpOpen(tc ? tc[0] : 'details'); }
  if (k === 'add' && a === 's') {
    const last = c.schedule[c.schedule.length - 1]; const x = { date: b || (last && last.date) || (c.start || '').slice(0, 10), time: '', title: '', note: '' }; if (isTrip(c)) x.kind = 'activity';
    c.schedule.push(x); changed(); return onpOpen('schedule', { k: 's', o: x, fresh: true });
  }
  if (k === 'add' && a === 'st') {
    c.stops = Array.isArray(c.stops) ? c.stops : []; const last = c.stops[c.stops.length - 1]; const x = { name: '', from: last && last.to ? last.to : (c.start || '').slice(0, 10), to: '' };
    c.stops.push(x); changed(); return onpOpen('route', { k: 'st', o: x, fresh: true });
  }
  if (k === 'add' && a === 'n') { const x = { label: '', text: '', url: '' }; c.notes.push(x); changed(); return onpOpen('notes', { k: 'n', o: x, fresh: true }); }
}
const onpArr = (c, k) => ({ s: c.schedule, n: c.notes, st: c.stops || [], cs: c.custom }[k]);
const onpEmpty = (k, x) => !x || (k === 'cs' ? ![x.title, x.text, x.label, x.url, x.img].join('').trim() : k === 'st' ? !x.name : k === 'n' ? !(x.label || x.text || x.url) : !(x.title || x.note || x.place));
// the focused item's index now (it may have moved, or been replaced when a stop was found on the map)
function onpIdx(c) {
  const F = B.focus; if (!F || !F.k || F.k === 'day') return -1; const arr = onpArr(c, F.k);
  let i = arr.indexOf(F.o); if (i < 0 && F.i != null && arr[F.i]) i = F.i; if (i >= 0) { F.o = arr[i]; F.i = i; } return i;
}
// a just-added item left blank is dropped when its sheet closes
function onpCleanup() {
  const F = B && B.focus; if (!F || !F.fresh) return; const arr = onpArr(B.cfg, F.k); const i = onpIdx(B.cfg);
  if (i >= 0 && onpEmpty(F.k, arr[i])) { arr.splice(i, 1); changed(); }
}
function onpOpen(id, focus = null, secId = null) {
  const sh = $('#sheet'); if (!sh) return;
  if (B.onp) onpCleanup();
  B.onp = true; B.focus = focus; B.onpSec = secId; B.card = id; B.spEdit = null; B.shDirty = false; B.shSave = ''; if (DU && DU.key !== 'main') DU = null;
  const wide = matchMedia('(min-width: 980px)').matches; const f = $('#b-set'), top = $('.b-top');
  if (wide && top) { sh.style.setProperty('--onp-top', top.getBoundingClientRect().bottom + 'px'); sh.style.setProperty('--onp-w', (f && f.getBoundingClientRect().width || 440) + 'px'); $('.builder')?.style.setProperty('--onp-dock', (f && f.getBoundingClientRect().width || 440) + 'px'); }
  sh.classList.add('onp'); renderSheet();
  if (!sh.open) { if (wide) sh.show(); else sh.showModal(); } esAutogrow(sh);
  sh.querySelector('.sheet-in').scrollTop = 0;
  if (focus && focus.fresh) setTimeout(() => sh.querySelector('.sheet-b input:not([type="date"]):not([type="time"]):not([type="file"]), .sheet-b textarea')?.focus(), 60);
}
// sheet body for the on-page parts that have no card of their own, or null
function onpSheet(c, id) {
  if (id === 'hero') return { title: 'Title and photo', body: `<div class="es-card es-hero"><input id="sh-title" class="es-title" data-f="title" value="${esc(c.title)}" maxlength="80" placeholder="${t('Title')}" aria-label="${t('Title')}">
    <label class="es-line es-note">${esIc('pencil')}<input id="sh-tagline" data-f="tagline" value="${esc(c.tagline)}" maxlength="140" placeholder="${t('Add a tagline')}" aria-label="${t('Tagline')}"></label></div>${coverFieldHTML(c)}` };
  if (id === 'when') {
    const v = c.venue;
    const venue = v ? `${esMapBand(+v.lat, +v.lon, !v.city && !v.region && v.country ? 4 : !v.city && v.region ? 7 : isTrip(c) ? 11 : 15)}<input id="sh-vname" class="es-title" data-v="name" value="${esc(v.name)}" aria-label="${t(isTrip(c) ? 'Destination name on the page' : 'Venue name on the page')}">
      <p class="es-sub"><span>${esc(v.address || '')}</span>${v.address ? ' · ' : ''}<button type="button" class="es-chg" data-b="clear-venue">${t('Change')}</button></p>`
      : `<div class="es-line es-placeq search">${esIc('search')}<input id="vq-sh" placeholder="${t(isTrip(c) ? 'City or region' : 'Venue name or address')}" aria-label="${t(isTrip(c) ? 'Destination' : 'Venue')}" value="${esc(B.vq || '')}" enterkeyhint="search"><button type="button" class="es-find" data-b="search">${t('Search')}</button></div>
      <ul class="vres">${B.venueResults.map((r, i) => `<li><button type="button" data-pick="${i}"><b>${esc(r.name)}</b><span>${esc(r.display)}</span></button></li>`).join('')}</ul>${B.vmsg ? `<p class="hint">${esc(B.vmsg)}</p>` : ''}`;
    return { title: isTrip(c) ? 'Dates and destination' : 'Date and place', body: `<div class="es-card es-when">${venue}${whenFieldsHTML(c, 'sh')}</div>${flyIntoFieldHTML(c, 'sh')}` };
  }
  if (id === 'fly') return { title: 'Fly into', body: flyIntoFieldHTML(c, 'sh') || `<p class="hint">${t('Pick a venue first.')}</p>` };
  if (id === 'details') {
    const cs = (TYPE_CARDS[c.type] || []).filter(x => x[0] !== 'route' && x[0] !== 'companions').concat([COMMON_CARDS.find(x => x[0] === 'notes'), COMMON_CARDS.find(x => x[0] === 'bring')]);
    return { title: 'Need to know', body: `<div class="cards">${cs.map(x => cardBtn(c, x)).join('')}</div>` };
  }
  if (id === 'gallery') { const cards = allCards(c); return { title: 'Add to your page', body: `${cards.type.length ? `<p class="grp">${esc(t(TYPE_GROUP[c.type]))}</p><div class="cards">${cards.type.map(x => cardBtn(c, x)).join('')}</div>` : ''}<p class="grp">${t('For any event')}</p><div class="cards">${cards.common.map(x => cardBtn(c, x)).join('')}</div>` }; }
  return null;
}
// sheet title for one focused item
function onpTitle(c, id) {
  const F = B.focus; if (!F) return '';
  if (F.k === 'day') return isTrip(c) && c.start && F.d >= c.start.slice(0, 10) ? `${t('Day {n}', { n: daysBetween(c.start, F.d) + 1 })} · ${fmt(F.d, { weekday: 'short', month: 'short', day: 'numeric' })}` : friendlyDate(F.d);
  const x = F.o || {};
  if (F.k === 's') return x.date ? (isTrip(c) && c.start && x.date >= c.start.slice(0, 10) ? `${t('Day {n}', { n: daysBetween(c.start, x.date) + 1 })} · ${fmt(x.date, { weekday: 'short', month: 'short', day: 'numeric' })}` : friendlyDate(x.date)) : t(schedTitle(c));
  if (F.k === 'st') return x.name || t('Stop');
  if (F.k === 'n') return x.label || t('Note');
  if (F.k === 'cs') return x.title || t('Custom section');
  return '';
}
// the bottom of an on-page sheet: Show all (one item) and the section's place on the page
function onpFoot(c) {
  const F = B.focus;
  return F && F.k !== 'cs' ? `<button type="button" class="link strong sh-all" data-onp-all>${esIc('eye')}${t('Show all')}</button>` : '';
}
// clicks in an on-page sheet; true when handled
function onpClick(b, cfg) {
  const d = b.dataset;
  if ('onpAll' in d) { onpCleanup(); B.focus = null; renderSheet(); return true; }
  if (d.onpMv) { const i = +d.onpMv, j = i + +d.dir; if (j >= 0 && j < cfg.notes.length) { [cfg.notes[i], cfg.notes[j]] = [cfg.notes[j], cfg.notes[i]]; changed(true); } return true; }
  if (d.onpHide) {
    const sid = d.onpHide; const snap = clone(cfg); setSectionShown(cfg, sid, false); changed(); $('#sheet').close();
    undoToast('Section hidden', () => { B.cfg = snap; changed(true); }); return true;
  }
  const del = d.sdel != null ? ['s', +d.sdel] : d.ndel != null ? ['n', +d.ndel] : d.stDel != null ? ['st', +d.stDel] : d.cdel != null ? ['cs', +d.cdel] : null;
  if (del) { onpDelete(cfg, ...del); return true; }
  return false;
}
function onpDelete(cfg, k, i) {
  const arr = onpArr(cfg, k); const x = arr[i]; if (!x) return;
  const name = String((k === 's' || k === 'cs' ? x.title : k === 'n' ? x.label : x.name) || '').trim();
  const empty = onpEmpty(k, x);
  const go = () => {
    const snap = clone(B.cfg); const j = arr.indexOf(x); if (j < 0) return; arr.splice(j, 1);
    if (k === 'cs') { const sid = customSid(x); delete cfg.off[sid]; if (Array.isArray(cfg.order)) cfg.order = cfg.order.filter(z => z !== sid); }
    const sh = $('#sheet'); const wasFocus = B.focus && B.focus.o === x;
    if (wasFocus) { B.focus = null; changed(); sh.close(); } else changed(true);
    if (!empty) undoToast(name ? `Deleted “${name}”` : 'Deleted', () => { B.cfg = snap; B.focus = null; changed(true); });
  };
  if (empty) go(); else confirmDlg({ title: name ? t('Delete “{n}”?', { n: name }) : t('Delete this item?'), ok: t('Delete') }).then(yes => { if (yes) go(); });
}
// a short "Deleted · Undo" bar; inside the open sheet when there is one (a modal makes the rest of the page inert)
function undoToast(msg, fn) {
  $('#undo')?.remove(); const sh = $('#sheet');
  const el = document.createElement('div'); el.id = 'undo'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span><button type="button" class="btn sm">${t('Undo')}</button>`;
  (sh && sh.open ? sh : document.body).appendChild(el);
  el.querySelector('button').onclick = () => { el.remove(); fn(); };
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(undoToast._t); undoToast._t = setTimeout(() => el.remove(), 7000);
}
// ---------- edit sheets: one look for every owner sheet ("the item is its own card") ----------
// Top: a small label (Day 21 · Kyoto, Stop 4 of 6, the sheet's name), Saved once an edit is saved, … for the rarer actions
// (move, remove, hide), ×. The thing being edited is a card: its name big and typed in place, its date/time as chips,
// its place and note as lines. Edits save as they're made; Done only closes. Show all stays at the bottom.
const ES_IC = {
  activity: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  reservation: '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2.5"/>',
  note: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h5"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="7" r="1.4"/><circle cx="15" cy="7" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="17" r="1.4"/><circle cx="15" cy="17" r="1.4"/></g>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  bed: '<path d="M3 18V7M3 14h18v4M21 14v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11" r="1.8"/>',
  chev: '<path d="M9 6l6 6-6 6"/>', pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  minus: '<path d="M6 12h12"/>', plus: '<path d="M12 6v12M6 12h12"/>', x: '<path d="M7 7l10 10M17 7L7 17"/>',
  hide: '<path d="M3 3l18 18M10.6 6.1A10.6 10.6 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.5 6 10 6a9.7 9.7 0 0 0 4.4-1"/>',
};
const esIc = (k, cls = '') => `<svg class="es-ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ES_IC[k] || ''}</svg>`;
const esDay = (d) => d ? fmt(d, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
// the small label at the top of a one-item sheet
function shEyebrow(c, F, fi) {
  if (F.k === 'st') { const ss = c.stops || []; return ss.length > 1 && fi >= 0 ? t('Stop {i} of {n}', { i: fi + 1, n: ss.length }) : t('Stop'); }
  const x = c.schedule[fi]; if (!x || !x.date) return t(schedTitle(c));
  if (!isTrip(c)) return friendlyDate(x.date);
  const day = c.start && x.date >= c.start.slice(0, 10) ? t('Day {n}', { n: daysBetween(c.start, x.date) + 1 }) : esDay(x.date);
  const ss = stopsOf(c); const st = ss.length ? ss[legOf(ss, x.date)] : null;
  return st ? `${day} · ${st.city || st.name}` : `${day} · ${esDay(x.date)}`;
}
// Saved: shows once an edit made in this sheet is saved (the header keeps the page-wide status)
const shSavedHTML = () => `<span class="sh-saved" data-sh-saved>${B && B.shSave ? shSavedTxt(B.shSave) : ''}</span>`;
const shSavedTxt = (st) => st === 'saving' ? `<span class="sh-sv">${t('Saving…')}</span>` : st ? `${esIc('check')}<span>${t('Saved')}</span>` : '';
function shSaveStatus(st) { const sh = $('#sheet'); if (!B || !sh || !sh.open) return; if (st === 'saving') B.shDirty = true; if (!B.shDirty) return;
  B.shSave = st === 'saving' ? 'saving' : st ? 'saved' : ''; const el = sh.querySelector('[data-sh-saved]'); if (el) el.innerHTML = shSavedTxt(B.shSave); }
// … : the sheet's rarer actions. Each entry: [data attributes, icon, label, { dis, del }] or '-' (a rule)
function shMenu(c, id, F, fi) {
  if (!B.onp) return ''; const it = []; const ss = c.stops || [];
  const sec = () => { const sid = B.onpSec; const o = sectionOrder(c); const i = o.indexOf(sid);
    if (!sid || i < 0 || (sid === 'route' && routeInItin(c))) return;
    it.push([`data-sec-mv="${esc(sid)}" data-dir="-1"`, 'up', 'Move section up', { dis: i === 0 }], [`data-sec-mv="${esc(sid)}" data-dir="1"`, 'down', 'Move section down', { dis: i === o.length - 1 }], [`data-onp-hide="${esc(sid)}"`, 'hide', 'Hide section']); };
  if (F && F.k === 's' && fi >= 0) { const x = c.schedule[fi];
    if (isTrip(c)) it.push(['data-tp-day', 'cal', 'Move to another day'], '-');
    it.push([`data-sdel="${fi}"${hotelCiLine(x) ? ' data-sdel-hotel' : ''}`, 'trash', hotelCiLine(x) ? 'Remove hotel' : 'Remove', { del: true }]); }
  else if (F && F.k === 'st' && fi >= 0) it.push([`data-st-mv="${fi}" data-dir="-1"`, 'up', 'Move earlier', { dis: fi === 0 }], [`data-st-mv="${fi}" data-dir="1"`, 'down', 'Move later', { dis: fi === ss.length - 1 }], '-', [`data-st-del="${fi}"`, 'trash', 'Remove', { del: true }]);
  else if (F && F.k === 'n' && fi >= 0) it.push([`data-onp-mv="${fi}" data-dir="-1"`, 'up', 'Move up', { dis: fi === 0 }], [`data-onp-mv="${fi}" data-dir="1"`, 'down', 'Move down', { dis: fi === c.notes.length - 1 }], '-', [`data-ndel="${fi}"`, 'trash', 'Remove', { del: true }]);
  else if (F && F.k === 'cs' && fi >= 0) { sec(); if (it.length) it.push('-'); it.push([`data-cdel="${fi}"`, 'trash', 'Delete section', { del: true }]); }
  else if (!F) sec();
  if (!it.length) return '';
  return `<button type="button" class="sh-round sh-more" data-sh-more aria-label="${t('More')}" aria-haspopup="menu" aria-expanded="false" aria-controls="sh-menu">${esIc('more')}</button>
    <div class="sh-menu" id="sh-menu" role="menu" hidden>${it.map(x => x === '-' ? '<hr>' : `<button type="button" role="menuitem" ${x[0]}${x[3] && x[3].dis ? ' disabled' : ''} class="${x[3] && x[3].del ? 'del' : ''}">${esIc(x[1])}<span>${esc(t(x[2]))}</span></button>`).join('')}</div>`;
}
function shMenuOpen(on) {
  const m = $('#sheet .sh-menu'), b = $('#sheet [data-sh-more]'); if (!m || !b) return;
  m.hidden = !on; b.setAttribute('aria-expanded', String(on)); b.classList.toggle('on', on);
  if (on) m.querySelector('button:not([disabled])')?.focus();
}
// a real map, cropped: the OpenStreetMap tiles the page's maps already use, the point in the middle (w×h CSS px)
function osmCrop(lat, lon, z, w, h) {
  if (!isFinite(lat) || !isFinite(lon)) return ''; const n = 2 ** z; const r = lat * Math.PI / 180;
  const x = (lon + 180) / 360 * n * 256, y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n * 256; const x0 = x - w / 2, y0 = y - h / 2; let img = '';
  for (let tx = Math.floor(x0 / 256); tx * 256 < x0 + w; tx++) for (let ty = Math.floor(y0 / 256); ty * 256 < y0 + h; ty++) {
    if (ty < 0 || ty >= n) continue;
    img += `<img src="https://tile.openstreetmap.org/${z}/${((tx % n) + n) % n}/${ty}.png" alt="" draggable="false" style="left:${Math.round(tx * 256 - x0)}px;top:${Math.round(ty * 256 - y0)}px" onerror="this.remove()">`; }
  return `<span class="es-tiles" style="width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px">${img}</span><i class="es-pin" aria-hidden="true"></i>`;
}
const esMapBand = (lat, lon, z) => isFinite(lat) && isFinite(lon) ? `<div class="es-band" aria-hidden="true">${osmCrop(lat, lon, z, 640, 104)}<small>© OpenStreetMap</small></div>` : '';
// ---- the itinerary item ----
function itemCardHTML(c, i) {
  const x = c.schedule[i]; const trip = isTrip(c); const k = trip ? (PLAN_KINDS[x.kind] ? x.kind : 'activity') : 'activity'; const hotel = hotelCiLine(x);
  const ph = t(!trip ? 'What’s happening' : k === 'reservation' ? 'Dinner at…, tour, tickets' : k === 'note' ? 'Something to remember' : 'What you’re doing');
  const chip = (kind, ic, txt, inp, set) => `<span class="es-chip${set ? '' : ' ghost'}" data-chip="${kind}">${esIc(ic)}<span data-chip-t>${esc(txt)}</span>${inp}</span>`;
  return `<div class="rowed plan-item es-card it-card k-${k}" data-it="${i}">
    <span class="es-kind" aria-hidden="true">${esIc(hotel ? 'bed' : k)}</span>
    <textarea class="es-title" data-s="${i}" data-k="title" rows="1" maxlength="200" placeholder="${ph}" aria-label="${t('Title')}">${esc(x.title)}</textarea>
    <div class="es-chips">${chip('date', 'cal', x.date ? esDay(x.date) : t('Add a day'), `<input id="tp-date" type="date" data-s="${i}" data-k="date" value="${esc(x.date || '')}" aria-label="${t('Day')}">`, !!x.date)}${chip('time', 'clock', x.time ? fmtTime(x.time) : t('Add a time'), `<input type="time" data-s="${i}" data-k="time" value="${esc(x.time || '')}" aria-label="${t('Time')}">${x.time ? `<button type="button" class="es-chip-x" data-tp-notime="${i}" aria-label="${t('Remove the time')}">${esIc('x')}</button>` : ''}`, !!x.time)}</div>
    ${trip && k === 'note' ? '' : itemPlaceHTML(x, i)}
    ${hotel ? `<div class="es-line es-hf">${esIc('bed')}<div class="es-tx">${hfFoldHTML(hfOfEv(x), 'hf-s' + i, { en: true, attr: `data-hf-s="${i}"` })}</div></div>
      <label class="es-line es-note">${esIc('pencil')}<textarea data-s="${i}" data-k="note" rows="1" maxlength="1000" placeholder="${t('Notes: confirmation, late check-in, requests')}" aria-label="${t('Notes')}">${esc(x.note || '')}</textarea></label>`
      : `<label class="es-line es-note">${esIc('pencil')}<textarea data-s="${i}" data-k="note" rows="1" maxlength="1000" placeholder="${t(trip ? 'Confirmation or a note' : 'Add a note')}" aria-label="${t('Note')}">${esc(x.note || '')}</textarea></label>`}
  </div>
  ${trip ? `<div class="es-kinds" role="radiogroup" aria-label="${t('Type')}">${Object.entries(PLAN_KINDS).map(([v, l]) => `<button type="button" role="radio" aria-checked="${k === v}" tabindex="${k === v ? 0 : -1}" class="es-kt${k === v ? ' on' : ''}" data-tp-kind="${v}" data-tp-i="${i}">${esIc(v)}<span>${esc(t(l))}</span></button>`).join('')}</div>${roListHTML(c, i)}` : ''}`;
}
// the item's place: Add a place (search as you type; Enter or Find for a plain search), or the place with a map crop
function itemPlaceHTML(x, i) {
  const p = x.place;
  if (p && B.spEdit !== i) { const sub = p.address && p.address !== p.name ? p.address : '';
    const dir = p.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}` : `https://www.google.com/maps/dir/?api=1&destination=${enc([p.name, p.address].filter(Boolean).join(', '))}`;
    return `<div class="es-line es-place s-place">${p.lat != null ? `<span class="es-thumb" title="Map © OpenStreetMap">${osmCrop(p.lat, p.lon, 15, 64, 48)}</span>` : esIc('search')}<div class="es-tx"><button type="button" class="es-pl" data-sp-chg="${i}" aria-label="${esc(t('Change place: {n}', { n: p.name }))}"><b>${esc(p.name)}</b></button><small>${sub ? `${esc(sub)} · ` : ''}<a href="${esc(dir)}" target="_blank" rel="noopener noreferrer">${t('Directions')}</a></small></div><button type="button" class="es-x" data-sp-del="${i}" aria-label="${t('Remove place')}">${esIc('x')}</button></div>`; }
  return `<div class="es-line es-placeq s-place-q search">${esIc('search')}<input id="sp-q-${i}" data-sp-q="${i}" value="${p ? esc(p.name) : ''}" placeholder="${t('Add a place')}" aria-label="${t('Place')}" autocomplete="off" enterkeyhint="search"><button type="button" class="es-find" data-sp-find="${i}">${t('Find')}</button></div>`;
}
// page order of some schedule items: by day, then time; an item with no time follows the one before it in the list
function schedOrder(c, idx) {
  const last = {}; return idx.map(j => { const y = c.schedule[j]; const d = y.date || '9999'; const h = y.time || last[d] || ''; if (y.time) last[d] = y.time; return [j, d, h]; })
    .sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[0] - b[0]).map(a => a[0]);
}
// the item among its neighbors: the items in the same city (a trip with stops), else the same day
function itemGroup(c, i) {
  const x = c.schedule[i]; if (!x || !x.date) return null; const ss = stopsOf(c); const li = ss.length ? legOf(ss, x.date) : -1;
  const s = li >= 0 ? ss[li] : null; const inG = s ? (y) => !!y.date && legOf(ss, y.date) === li : (y) => y.date === x.date;
  return { label: s ? t('In {c}', { c: s.city || s.name }) : esDay(x.date), order: schedOrder(c, c.schedule.map((_, j) => j).filter(j => inG(c.schedule[j]))) };
}
function roListHTML(c, i) {
  const g = itemGroup(c, i); if (!g || g.order.length < 2) return '';
  const pos = g.order.indexOf(i); const a = Math.max(0, Math.min(pos - 3, g.order.length - 7)); const rows = g.order.slice(a, a + 7);
  return `<div class="es-ro"><p class="es-lbl" id="ro-l">${esc(g.label)} · ${t('hold to reorder')}</p><span class="vh" id="ro-help">${t('Up and down arrow keys move it')}</span>
    <ol class="ro-ol" data-ro-off="${a}" aria-labelledby="ro-l">${rows.map(j => { const y = c.schedule[j]; const nm = y.title || t('Untitled');
      return `<li class="ro-it${j === i ? ' me' : ''}" data-ro="${j}"><button type="button" class="ro-grip" data-ro-grip="${j}" aria-label="${esc(t('Move {n}', { n: nm }))}, ${esc(esDay(y.date))}" aria-describedby="ro-help">${esIc('grip')}</button><time>${esc(fmt(y.date, { weekday: 'short' }).toUpperCase())} ${+y.date.slice(8, 10)}</time><span class="ro-t${y.title ? '' : ' ph'}">${esc(nm)}</span>${y.time ? `<small>${esc(fmtTime(y.time))}</small>` : ''}</li>`; }).join('')}</ol></div>`;
}
// move item j to position `to` in its group's page order. It takes the day of the item it moved past.
function itemMove(c, j, to) {
  const g = itemGroup(c, j); if (!g) return false; const from = g.order.indexOf(j); const rest = g.order.filter(k => k !== j); to = Math.max(0, Math.min(rest.length, to));
  if (from < 0 || to === from) return false;
  const x = c.schedule[j]; const objs = rest.map(k => c.schedule[k]); const passed = to > from ? objs[to - 1] : objs[to]; if (!passed) return false;
  if (passed.date) x.date = passed.date;
  const P = objs[to - 1], N = objs[to]; const arr = c.schedule; arr.splice(arr.indexOf(x), 1);
  if (P && P.date === x.date) arr.splice(arr.indexOf(P) + 1, 0, x); else if (N) arr.splice(arr.indexOf(N), 0, x); else arr.push(x);
  return true;
}
function itemMoved(c, x, kb) {
  changed(true); const k = c.schedule.indexOf(x); const g = itemGroup(c, k); const live = $('#sheet [data-sh-live]');
  if (live && g) live.textContent = `${x.title || t('Item')}: ${esDay(x.date)}, ${t('{i} of {n}', { i: g.order.indexOf(k) + 1, n: g.order.length })}`;
  if (kb) $(`#sheet [data-ro-grip="${k}"]`)?.focus();
}
// date / time typed or picked: the chips, the label and the list follow without redrawing the fields
function itemRefresh(i) {
  const c = B.cfg; const x = c.schedule[i]; const card = $(`#sheet .it-card[data-it="${i}"]`); if (!x || !card) return;
  const set = (k, txt, on) => { const ch = card.querySelector(`[data-chip="${k}"]`); if (!ch) return; ch.querySelector('[data-chip-t]').textContent = txt; ch.classList.toggle('ghost', !on); };
  set('date', x.date ? esDay(x.date) : t('Add a day'), !!x.date); set('time', x.time ? fmtTime(x.time) : t('Add a time'), !!x.time);
  const ch = card.querySelector('[data-chip="time"]'); const xb = ch && ch.querySelector('.es-chip-x');
  if (ch && x.time && !xb) ch.insertAdjacentHTML('beforeend', `<button type="button" class="es-chip-x" data-tp-notime="${i}" aria-label="${t('Remove the time')}">${esIc('x')}</button>`); else if (xb && !x.time) xb.remove();
  const l = $('#sheet .sh-lbl'); if (l && B.focus) l.textContent = shEyebrow(c, B.focus, i);
  const ro = $('#sheet .es-ro'); const h = isTrip(c) ? roListHTML(c, i) : '';
  if (ro) { if (h) ro.outerHTML = h; else ro.remove(); } else if (h) $('#sheet .es-kinds')?.insertAdjacentHTML('afterend', h);
}
// clicks on the edit sheets' own controls; true when handled
function esClick(b, cfg) {
  const d = b.dataset;
  if ('shMore' in d) { shMenuOpen(b.getAttribute('aria-expanded') !== 'true'); return true; }
  if (b.closest('.sh-menu')) shMenuOpen(false);
  if (d.onpGo) { onpGo(d.onpGo); return true; }
  if (d.tpKind) { const x = cfg.schedule[+d.tpI]; if (x && x.kind !== d.tpKind) { x.kind = d.tpKind; changed(true); setTimeout(() => $(`#sheet [data-tp-kind="${d.tpKind}"]`)?.focus(), 0); } return true; }
  if (d.tpNotime != null) { const x = cfg.schedule[+d.tpNotime]; if (x) { x.time = ''; changed(true); setTimeout(() => $('#sheet [data-chip="time"] input')?.focus(), 0); } return true; }
  if ('tpDay' in d) { const inp = $('#sheet #tp-date'); if (inp) { inp.focus(); try { inp.showPicker(); } catch { /* the field has focus */ } } return true; }
  return false;
}
// title and note grow with their text (one line until there's more)
function esAutogrow(root) { $$('.es-title, .es-note textarea, .es-one .rowed textarea', root).forEach(esGrow); }
function esGrow(t) { if (!t || t.tagName !== 'TEXTAREA' || !t.offsetParent) return; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
// the reorder list: hold a row (or grab its handle) and drag; the handle also moves with the arrow keys
let RO = null;
function roDown(e) {
  const li = e.target.closest && e.target.closest('#sheet .ro-it'); if (!li || (e.button && e.pointerType === 'mouse')) return;
  const grip = e.target.closest('.ro-grip'); if (RO) roEnd(false);
  RO = { li, ol: li.parentElement, y: e.clientY, y0: e.clientY, pid: e.pointerId, on: false, t: 0 };
  if (grip) { e.preventDefault(); roStart(); } else RO.t = setTimeout(roStart, 350);
}
function roStart() { if (!RO) return; RO.on = true; RO.li.classList.add('drag'); RO.ol.classList.add('dragging'); try { RO.li.setPointerCapture(RO.pid); } catch { /* released */ } if (navigator.vibrate) try { navigator.vibrate(8); } catch { /* no vibration */ } }
function roMove(e) {
  if (!RO || e.pointerId !== RO.pid) return;
  if (!RO.on) { if (Math.abs(e.clientY - RO.y0) > 8) roEnd(false); return; }
  e.preventDefault(); const li = RO.li; const dy = e.clientY - RO.y;
  const prev = li.previousElementSibling, next = li.nextElementSibling;
  if (dy < 0 && prev && e.clientY < prev.getBoundingClientRect().top + prev.offsetHeight / 2) { RO.y -= prev.offsetHeight; li.after(prev); }
  else if (dy > 0 && next && e.clientY > next.getBoundingClientRect().top + next.offsetHeight / 2) { RO.y += next.offsetHeight; li.before(next); }
  li.style.transform = `translateY(${e.clientY - RO.y}px)`;
}
function roEnd(drop) {
  const r = RO; RO = null; if (!r) return; clearTimeout(r.t); r.li.classList.remove('drag'); r.ol.classList.remove('dragging'); r.li.style.transform = '';
  if (!drop || !r.on) return;
  const c = B.cfg; const j = +r.li.dataset.ro; const x = c.schedule[j]; const to = +r.ol.dataset.roOff + [...r.ol.children].indexOf(r.li);
  if (x && itemMove(c, j, to)) itemMoved(c, x, false); else renderSheet();
}
function roKey(e) {
  const g = e.target.closest && e.target.closest('#sheet [data-ro-grip]'); if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault(); const c = B.cfg; const j = +g.dataset.roGrip; const x = c.schedule[j]; const gr = itemGroup(c, j); if (!x || !gr) return;
  if (itemMove(c, j, gr.order.indexOf(j) + (e.key === 'ArrowUp' ? -1 : 1))) itemMoved(c, x, true);
}
// the sheet's own wiring, once per builder
function esWire(sh) {
  const form = sh.querySelector('.sheet-in');
  form.addEventListener('pointerdown', roDown); form.addEventListener('pointermove', roMove); form.addEventListener('pointerup', () => roEnd(true)); form.addEventListener('pointercancel', () => roEnd(false));
  form.addEventListener('touchmove', (e) => { if (RO && RO.on) e.preventDefault(); }, { passive: false });
  form.addEventListener('contextmenu', (e) => { if (e.target.closest('.ro-it')) e.preventDefault(); });
  form.addEventListener('input', (e) => { const t = e.target; if (t.matches('textarea')) esGrow(t); if (t.matches('.it-card [data-chip] input')) itemRefresh(+t.dataset.s); });
  form.addEventListener('click', (e) => { const t = e.target; if (t.matches && t.matches('.es-chip input')) { try { t.showPicker(); } catch { /* typed instead */ } }
    const m = form.querySelector('.sh-menu:not([hidden])'); if (m && !e.target.closest('.sh-menu, [data-sh-more]')) shMenuOpen(false); });
  form.addEventListener('keydown', (e) => {
    roKey(e);
    if (e.key === 'Escape' && form.querySelector('.sh-menu:not([hidden])')) { e.preventDefault(); e.stopPropagation(); shMenuOpen(false); $('#sheet [data-sh-more]')?.focus(); return; }
    const mi = e.target.closest && e.target.closest('.sh-menu [role="menuitem"]');
    if (mi && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const xs = $$('.sh-menu [role="menuitem"]:not([disabled])', form); const k = xs.indexOf(mi); xs[(k + (e.key === 'ArrowDown' ? 1 : -1) + xs.length) % xs.length]?.focus(); }
    const kt = e.target.closest && e.target.closest('[data-tp-kind]');
    if (kt && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) { e.preventDefault(); const xs = $$('[data-tp-kind]', form); const k = xs.indexOf(kt); xs[(k + (/Right|Down/.test(e.key) ? 1 : -1) + xs.length) % xs.length].click(); }
    if (e.target.matches && e.target.matches('.es-title') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  }, true);
  sh.addEventListener('cancel', (e) => { if (form.querySelector('.sh-menu:not([hidden])')) { e.preventDefault(); shMenuOpen(false); } });
}
// ---- the stop ----
function stopCardHTML(c, i) {
  const ss = c.stops || []; const s = ss[i]; if (!s) return ''; const n = nightsOf(s); const named = stopsOf(c); const li = named.indexOf(s);
  const dt = (k, lbl) => { const v = k === 'from' ? (s.from || '').slice(0, 10) : (s.to || '').slice(0, 10);
    return `<label class="es-d${k === 'to' ? ' r' : ''}${v ? '' : ' ph'}"><small>${esc(t(lbl))}</small><b>${esc(v ? esDay(v) : t('Add a date'))}</b><input id="st-${k}-${i}" type="date" data-st="${i}" data-k="${k}" value="${esc(v)}"${k === 'to' && s.from ? ` min="${esc(s.from.slice(0, 10))}"` : ''} aria-label="${esc(t(lbl))}"></label>`; };
  const hotels = li < 0 ? [] : c.schedule.map((x, j) => [x, j]).filter(([x]) => hotelStayLine(x) && legOf(named, x.date) === li);
  return `<div class="rowed st-row es-card es-stop" data-st-row="${i}">
    ${s.name ? esMapBand(+s.lat, +s.lon, s.cc && !s.city && !s.region && s.country === s.name ? 4 : 11) : ''}
    ${s.name ? `<h3 class="es-title es-city">${esc(s.name)}</h3><p class="es-sub"><span>${esc([s.region, s.country].filter(Boolean).join(', '))}</span>${s.region || s.country ? ' · ' : ''}<button type="button" class="es-chg" data-st-clear="${i}">${t('Change')}</button></p>`
      : `<div class="es-line es-placeq search">${esIc('search')}<input id="st-q-${i}" data-st-q="${i}" placeholder="${t('City or place')}" aria-label="${t('City or place')}" autocomplete="off" enterkeyhint="search"><button type="button" class="es-find" data-st-find="${i}">${t('Find')}</button></div>`}
    <div class="es-stay">${dt('from', 'Arrive')}${dt('to', 'Leave')}
      ${stopDated(s) ? `<div class="es-nights st-nights" role="group" aria-label="${t('Nights')}"><button type="button" data-st-n="${i}" data-dir="-1" ${n ? '' : 'disabled'} aria-label="${t('One night fewer')}">${esIc('minus')}</button><span>${n == null ? t('Set the leave date') : n === 0 ? t('Day trip') : nightsTxt(n)}</span><button type="button" data-st-n="${i}" data-dir="1" aria-label="${t('One more night')}">${esIc('plus')}</button></div>` : ''}</div>
    ${stopNoteHTML(c, i)}
    ${hotels.map(([x, j]) => `<button type="button" class="es-line es-go" data-onp-go="s:${j}">${esIc('bed')}<span class="es-tx"><b>${esc(hostHotelName(x.title) || x.title)}</b><small>${esc(t('Check in {d}', { d: esDay(x.date) }))}</small></span>${esIc('chev')}</button>`).join('')}
  </div>`;
}
async function venueSearch() {
  const inSheet = !!$('#sheet #vq-sh'); const q = ($(inSheet ? '#sheet #vq-sh' : '#vq')?.value || '').trim(); B.vq = q;
  const repaint = () => { buildForm(); if (inSheet && B.card) { renderSheet(); $('#sheet #vq-sh')?.focus(); } };
  if (q.length < 3) { B.vmsg = t('Type at least 3 characters.'); repaint(); return; }
  const btn = $(inSheet ? '#sheet [data-b="search"]' : '[data-b="search"]'); if (btn) { btn.disabled = true; btn.textContent = t('Searching…'); }
  try { B.venueResults = await geocode(q); B.vmsg = B.venueResults.length ? '' : t('No matches. Try adding the city or street.'); }
  catch { B.venueResults = []; B.vmsg = t('Search is unavailable right now. Try again in a moment.'); }
  if (inSheet) { repaint(); return; }
  buildForm(); const d = $('details[data-acc="when"]'); if (d) d.open = true; $('#vq')?.focus();
}
async function pickVenue(r) {
  const c = B.cfg; c.venue = { name: r.name, address: r.address, lat: r.lat, lon: r.lon, city: r.city, region: r.region, country: r.country, cc: r.cc };
  c.tz = ''; if (!noFly(c)) delete c.flyInto; changed(true); // a new venue → its own automatic airport (No airport stays)
  try { c.tz = await lookupTZ(r.lat, r.lon); changed(); } catch { /* times stay floating */ }
}

// ---------- guided setup: type → name and date → venue → done ----------
let SU = null;
function renderSetup() {
  LANG = uiLang(); document.documentElement.lang = LANG; document.documentElement.dir = 'ltr';
  document.title = t('Create a page') + ' · 1LinkTrip';
  SU = { step: 0, cfg: freshEvent('Party'), results: [], q: '', msg: '' }; LS.del('draftHosted'); LS.set('draftId', newPid());
  B = { cfg: SU.cfg, venueResults: [] };
  $('#app').innerHTML = `<div class="setup"><div class="su-main"></div><div class="su-preview"><div class="su-tag">${t('Preview')}</div><div class="b-frame" id="su-frame"></div></div></div>`;
  suRender();
}
const suPreview = debounce(() => { const p = $('#su-frame'); if (p && getComputedStyle(p.parentElement).display !== 'none') renderEvent(SU.cfg, p, { preview: true }); }, 250);
function suTicket(c) {
  const g = (v, ph) => v ? esc(v) : `<span class="ghost">${ph}</span>`;
  const air = c.venue ? pickAirport(airFor(c), null, []) : null;
  return `<div class="su-ticket" style="--acc:${c.theme.accent}"><div><span class="lbl">${esc(t(TYPE_LABEL[c.type] || c.type))}${c.venue && c.venue.city ? ' · ' + esc(c.venue.city) : ''}</span><b>${g(c.title, t('Your event'))}</b><span>${c.start && SU.dated ? esc(dateRange(c.start, c.end)) + (c.start.length > 10 ? ' · ' + esc(fmtTime(c.start.slice(11, 16))) : '') : `<span class="ghost">${t('Date')}</span>`}</span><span>${g(c.venue && c.venue.name, t('Venue'))}</span></div><div class="r"><span class="lbl">${t('Fly into')}</span><b>${air ? esc(air.iata) : '<span class="ghost">···</span>'}</b></div></div>`;
}
function suRender() {
  const c = SU.cfg; const n = SU.step; const m = $('.su-main'); if (!m) return;
  const prog = `<div class="prog" aria-hidden="true">${[0, 1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
  const top = `<div class="su-top">${n > 0 && n < 3 ? `<button type="button" class="link" data-su="back">← ${t('Back')}</button>` : '<a class="brand sm" href="#">' + BRAND + '</a>'}${n === 2 ? `<button type="button" class="link strong" data-su="skip">${t('Skip')}</button>` : ''}</div>`;
  let h = '', body = '', cta = '';
  if (n === 0) {
    h = t('What are you planning?');
    body = `${suAIHTML()}<div class="su-types">${SETUP_TYPES.map(([type, label, sub, col]) => `<button type="button" class="su-type ${SU.pick === type ? 'on' : ''}" aria-pressed="${SU.pick === type}" data-su-type="${esc(type)}"><i class="ti" aria-hidden="true"><svg viewBox="0 0 24 24">${TYPE_ICONS[type] || TYPE_ICONS.Party}</svg></i><b>${esc(t(label))}</b><span>${esc(t(sub))}</span></button>`).join('')}</div>`;
    cta = `<button type="button" class="btn primary big" data-su="next0" ${SU.pick ? '' : 'disabled'}>${t('Next')}</button>`;
  } else if (n === 1) {
    h = t('What’s it called, and when?');
    body = `<div class="field"><label for="su-title">${t('Name')}</label><input id="su-title" data-su-f="title" value="${esc(c.title)}" maxlength="80" autocomplete="off"></div>
      ${whenFieldsHTML(c, 'su', !SU.dated, true)}`;
    cta = `<button type="button" class="btn primary big" data-su="next" ${c.title.trim() && SU.dated ? '' : 'disabled'}>${t('Continue')}</button>`;
  } else if (n === 2) {
    h = t(isTrip(c) ? 'Where are you going?' : 'Where is it?');
    body = `<div class="search"><input id="su-q" placeholder="${t(isTrip(c) ? 'City or region' : 'Venue name or address')}" value="${esc(SU.q)}" autocomplete="off"><button type="button" class="btn" data-su="search">${t('Search')}</button></div>
      ${SU.results.length ? `<div class="su-res">${SU.results.map((r, i) => `<button type="button" data-su-pick="${i}" class="${c.venue && c.venue.lat === r.lat && c.venue.lon === r.lon ? 'on' : ''}"><b>${esc(r.name)}</b><span>${esc(r.display)}</span></button>`).join('')}</div>` : ''}${SU.msg ? `<p class="hint">${esc(SU.msg)}</p>` : ''}`;
    cta = `<button type="button" class="btn primary big" data-su="next" ${c.venue ? '' : 'disabled'}>${t('Continue')}</button>`;
  } else {
    h = t('Your page is ready');
    if (acctOn()) setTimeout(() => { const pid = LS.get('draftId'); if (pid) acctSave(pid).catch(() => {}); }, 0); // signed in: on the account (not shared yet)
    const url = shareURL(c); const sugg = (TYPE_CARDS[c.type] || []).slice(0, 2).concat([COMMON_CARDS[0]]);
    body = `<div class="su-done" aria-hidden="true">✓</div>
      <p class="hint">${t(acctOn() ? 'Saved to My pages.' : 'Saved on this device.')}</p>
      <div class="two su-share"><button type="button" class="btn primary" data-su="share">${t('Share')}</button><a class="btn" href="${esc(url)}">${t('View page')}</a></div>
      ${typeof qrButtonHTML === 'function' ? qrButtonHTML() : ''}
      <p class="grp">${t('Add to your page')}</p>
      <div class="su-later">${sugg.map(([id, title]) => `<button type="button" data-su-card="${id}"><span>${esc(t(title))}</span><b>${t('+ Add')}</b></button>`).join('')}<button type="button" data-su-card=""><span>${t('See all')}</span><b>→</b></button></div>`;
  }
  m.innerHTML = `${prog}${top}<h1>${h}</h1><div class="su-body">${body}</div><div class="grow"></div>${n === 1 || n === 2 ? suTicket(c) : ''}${cta}`;
  LS.set('draft', c); pageSave(LS.get('draftId'), { cfg: c }); suPreview();
  if (n === 0) { const dz = $('[data-su-doc-drop]'); if (dz) { // Start from a document: choose or drop a file
    $('#su-doc-file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) suDocGo(f); });
    $('[data-su-brand]')?.addEventListener('change', (e) => LS.set('aiBrand', e.target.checked));
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); }); dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) suDocGo(f); });
  } }
  if (n === 0) aiReady().then(ok => { const el = $('[data-su-ai]'); if (el && ok) el.hidden = false;
    const pd = LS.get('pendingAiDoc'); if (ok && pd && el) { LS.del('pendingAiDoc'); el.querySelector('.su-doc-form').hidden = false; SU.pick = SU.aiType = pd === '-' ? '' : pd; $$('.su-type').forEach(x => x.classList.toggle('on', x.dataset.suType === SU.aiType)); const nb = $('[data-su="next0"]'); if (nb) nb.disabled = !SU.pick; suAIHint(); $('[data-su-doc-msg]').textContent = t('Signed in. Choose your document again.'); } const pend = LS.get('pendingAiUrl'); if (ok && pend && el) { LS.del('pendingAiUrl'); sbUser().then(u => { if (!u) return; el.querySelector('.su-ai-form').hidden = false; $('#su-ai-url').value = pend; SU.pick = SU.aiType = LS.get('pendingAiType') || ''; LS.del('pendingAiType'); $$('.su-type').forEach(x => x.classList.toggle('on', x.dataset.suType === SU.aiType)); const nb = $('[data-su="next0"]'); if (nb) nb.disabled = !SU.pick; suAIHint(); suAIGo(); }).catch(() => {}); } });
  placeAutocomplete($('#su-q'), { bias: () => null, onPick: (id, tok) => gpVenue(id, tok).then(r => {
    if (!SU) return; const cc = SU.cfg; cc.venue = { name: r.name, address: r.address, lat: r.lat, lon: r.lon, city: r.city, region: r.region, country: r.country, cc: r.cc }; SU.q = r.name; SU.results = []; SU.msg = '';
    suRender(); lookupTZ(r.lat, r.lon).then(tz => { cc.tz = tz; LS.set('draft', cc); }).catch(() => {});
  }).catch(() => { SU.msg = t('Couldn’t load that place. Try the Search button.'); suRender(); }) });
  const first = m.querySelector('#su-title, #su-q'); if (first && !first.value) setTimeout(() => first.focus(), 30);
}
document.addEventListener('click', (e) => {
  if (!SU || !e.target.closest('.setup')) return;
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset; const c = SU.cfg;
  if (d.suType) {
    // picking a category only selects it; Next moves on, so a website link can be added too
    SU.pick = SU.aiType = SU.pick === d.suType ? '' : d.suType;
    $$('.su-type').forEach(x => { const on = x.dataset.suType === SU.pick; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
    suAIHint(); const nb = $('[data-su="next0"]'); if (nb) nb.disabled = !SU.pick;
  } else if (d.su === 'next0') {
    const f = $('.su-ai-form'); const url = f && !f.hidden ? ($('#su-ai-url').value || '').trim() : '';
    if (url) suAIGo();
    else if (SU.pick) {
      const type = SU.pick; const keep = { title: c.title, start: c.start, end: c.end, venue: c.venue, tz: c.tz };
      if (!(SU.typed && c.type === type)) { SU.cfg = Object.assign(freshEvent(type), keep); B.cfg = SU.cfg; }
      SU.typed = true; SU.step = 1; suRender();
    }
  } else if (d.whenTg != null) { whenToggle(c); suRender(); const f = $(hasTime(c.start) ? '#su-st' : '#su-sd'); if (f) f.focus(); }
  else if (d.su === 'ai-open') { const f = $('.su-ai-form'); f.hidden = !f.hidden; $('.su-doc-form').hidden = true; if (!f.hidden) { SU.aiType = SU.pick || ''; suAIHint(); $('#su-ai-url').focus(); } }
  else if (d.su === 'ai-go') suAIGo();
  else if (d.su === 'doc-open') { const f = $('.su-doc-form'); f.hidden = !f.hidden; $('.su-ai-form').hidden = true; if (!f.hidden) { SU.aiType = SU.pick || ''; suAIHint(); } }
  else if (d.si === 'send') signInSubmit($('.setup'));
  else if (d.su === 'back') { SU.step = Math.max(0, SU.step - 1); suRender(); }
  else if (d.su === 'skip') { c.venue = null; SU.step = 3; suRender(); }
  else if (d.su === 'next') { if (!b.disabled) { SU.step++; suRender(); } }
  else if (d.su === 'search') suSearch();
  else if (d.suPick != null) {
    const r = SU.results[+d.suPick]; c.venue = { name: r.name, address: r.address, lat: r.lat, lon: r.lon, city: r.city, region: r.region, country: r.country, cc: r.cc };
    suRender(); lookupTZ(r.lat, r.lon).then(tz => { c.tz = tz; LS.set('draft', c); }).catch(() => {});
  }
  else if (d.su === 'share') { const pid = LS.get('draftId'); LS.set('draft', c); pageSave(pid, { cfg: c }); SU = null; window.__sharePub = true; location.hash = '#page=' + pid; } // the builder's Share: short link
  else if (d.suCard != null) { LS.set('draft', c); window.__openCard = d.suCard || null; SU = null; if (location.hash === '#new') route(); else location.hash = '#new'; }
  else if (typeof suExtraClick === 'function') suExtraClick(b, c);
});
document.addEventListener('input', (e) => {
  if (!SU || !e.target.closest('.setup')) return;
  const i = e.target; const c = SU.cfg; const f = i.dataset.suF;
  if (i.id === 'su-q') { SU.q = i.value; return; }
  if (i.dataset.when) { if (i.dataset.when === 'sd') SU.dated = !!i.value; whenInput(c, i.dataset.when, i.value); }
  else if (!f) return;
  if (f === 'title') c.title = i.value;
  const nb = $('[data-su="next"]'); if (nb) nb.disabled = !(c.title.trim() && SU.dated);
  const tk = $('.su-ticket'); if (tk) tk.outerHTML = suTicket(c);
  LS.set('draft', c); pageSave(LS.get('draftId'), { cfg: c }); suPreview();
});
document.addEventListener('keydown', (e) => {
  if (!SU || !e.target.closest('.setup') || e.key !== 'Enter') return;
  if (e.target.id === 'su-q') { e.preventDefault(); suSearch(); }
  else if (e.target.id === 'su-ai-url') { e.preventDefault(); suAIGo(); }
  else if (SU.step === 1) { const nb = $('[data-su="next"]'); if (nb && !nb.disabled) nb.click(); }
});
async function suSearch() {
  const q = SU.q.trim(); if (q.length < 3) { SU.msg = t('Type at least 3 characters.'); suRender(); return; }
  const btn = $('[data-su="search"]'); if (btn) { btn.disabled = true; btn.textContent = t('Searching…'); }
  try { SU.results = await geocode(q); SU.msg = SU.results.length ? '' : t('No matches. Try adding the city or street.'); }
  catch { SU.results = []; SU.msg = t('Search is unavailable right now. Try again in a moment.'); }
  suRender();
}

// ================= phase B: QR + print card, schedule import, access and arrival, guest languages =================
const LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['de', 'Deutsch'], ['it', 'Italiano'], ['ja', '日本語']];
function pickLang() {
  const saved = LS.get('lang'); if (saved && LOCALES[saved]) return saved;
  const nav = (navigator.languages || [navigator.language || 'en']).map(x => String(x).slice(0, 2).toLowerCase()).find(x => LOCALES[x]);
  return nav || 'en';
}

// ---- QR code and printable card ----
function qrSVG(text, cell = 4) {
  if (typeof qrcode !== 'function') return null;
  for (const ecl of ['M', 'L']) {
    try { const q = qrcode(0, ecl); q.addData(text, 'Byte'); q.make(); return { svg: q.createSvgTag({ cellSize: cell, margin: cell * 2, scalable: true }), n: q.getModuleCount() }; } catch { /* too long for this level */ }
  }
  return null;
}
const qrButtonHTML = () => `<button type="button" class="btn" data-su="qr">${t('QR code')}</button>`;
function openQR(cfg, url) {
  url = url || shareURL(cfg); const q = qrSVG(url);
  if (!q) { toast(t('This page has too much text for a QR code. Shorten the description or notes.')); return; }
  let d = $('#qrdlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'qrdlg'; document.body.appendChild(d); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); }
  d.innerHTML = `<div class="pub qr-dlg"><h2>${esc(cfg.title || 'Your page')}</h2><div class="qr-box">${q.svg}</div>
    <div class="btns"><button type="button" class="btn primary" data-qr="print">${t('Print card')}</button><button type="button" class="btn" data-qr="svg">${t('Download')}</button><button type="button" class="btn ghost" data-qr="close">${t('Close')}</button></div></div>`;
  d.onclick = (e) => {
    const b = e.target.closest('[data-qr]'); if (!b) { if (e.target === d) d.close(); return; }
    if (b.dataset.qr === 'close') d.close();
    if (b.dataset.qr === 'svg') { const blob = new Blob([q.svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')], { type: 'image/svg+xml' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (cfg.title || 'event').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '-qr.svg'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
    if (b.dataset.qr === 'print') printCard(cfg, q.svg);
  };
  if (!d.open) d.showModal();
}
function printCard(cfg, svg) {
  let c = $('#print-card'); if (!c) { c = document.createElement('div'); c.id = 'print-card'; document.body.appendChild(c); }
  cfg = spanFixed(cfg); const v = cfg.venue; loadFont(cfg.theme.font);
  c.setAttribute('style', themeStyle(cfg.theme));
  c.innerHTML = `<div class="pc-in"><p class="pc-k">${esc(cfg.type)}${v && v.city ? ' · ' + esc(v.city) : ''}</p><h1>${esc(cfg.title)}</h1>
    <p class="pc-when">${esc(dateRange(cfg.start, cfg.end))}${cfg.start && cfg.start.length > 10 ? ' · ' + esc(fmtTime(cfg.start.slice(11, 16))) : ''}</p>${v ? `<p class="pc-where">${esc(v.name)}</p>` : ''}
    <div class="pc-qr">${svg}</div><p class="pc-cta">${t('Scan for the schedule, travel and more')}</p></div>`;
  setTimeout(() => window.print(), 300);
}

// ---- import a schedule from .ics or CSV ----
const importButtonHTML = () => `<label class="btn sm file-btn">${t('Import .ics or CSV')}<input type="file" data-import accept=".ics,.csv,text/calendar,text/csv"></label>`;
function utcToWall(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function parseICS(text, tz) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/); const out = []; let ev = null;
  const unesc = (s) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
  for (const ln of lines) {
    if (/^BEGIN:VEVENT/i.test(ln)) { ev = {}; continue; }
    if (/^END:VEVENT/i.test(ln)) { if (ev && ev.title && ev.date) out.push(ev); ev = null; continue; }
    if (!ev) continue;
    const m = ln.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/i); if (!m) continue;
    const [, key, params, val] = m; const K = key.toUpperCase();
    if (K === 'SUMMARY') ev.title = unesc(val);
    else if (K === 'LOCATION') ev.note = unesc(val);
    else if (K === 'DESCRIPTION' && !ev.note) ev.note = unesc(val).slice(0, 120);
    else if (K === 'DTSTART') {
      const d = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z?))?/); if (!d) continue;
      const day = `${d[1]}-${d[2]}-${d[3]}`;
      if (!d[4]) { ev.date = day; ev.time = ''; continue; }
      let wall = `${day}T${d[4]}:${d[5]}`;
      const tzid = (params.match(/TZID=([^;:]+)/i) || [])[1];
      if (d[6] === 'Z') wall = utcToWall(new Date(wall + ':00Z'), tz);
      else if (tzid && tz && tzid !== tz) { try { wall = utcToWall(wallToUTC(wall, tzid), tz); } catch { /* keep as written */ } }
      ev.date = wall.slice(0, 10); ev.time = wall.slice(11, 16);
    }
  }
  return out;
}
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const clean = rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean)); if (!clean.length) return [];
  const head = clean[0].map(h => h.toLowerCase());
  const find = (...names) => head.findIndex(h => names.some(n => h === n || h.includes(n)));
  let idx = { date: find('date', 'day'), time: find('time', 'start'), title: find('title', 'name', 'event', 'session', 'what'), note: find('note', 'location', 'room', 'where', 'description', 'place') };
  let body = clean.slice(1);
  if (idx.title < 0) { idx = { date: 0, time: 1, title: 2, note: 3 }; body = clean; }
  const toDate = (s) => { let m; if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`; if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(+m[1])}-${pad(+m[2])}`; return ''; };
  const toTime = (s) => { const m = (s || '').match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\.?m?\.?$/i); if (!m) return ''; let h = +m[1]; if (m[3]) { h %= 12; if (/p/i.test(m[3])) h += 12; } return h < 24 ? `${pad(h)}:${m[2] || '00'}` : ''; };
  return body.map(r => ({ date: toDate(r[idx.date] || ''), time: toTime(r[idx.time] || ''), title: r[idx.title] || '', note: idx.note >= 0 ? (r[idx.note] || '') : '' })).filter(x => x.title);
}
function extraInput(i, cfg) {
  if (i.dataset.import != null && i.files && i.files[0]) {
    const f = i.files[0];
    f.text().then(text => {
      const items = /\.ics$/i.test(f.name) || /BEGIN:VCALENDAR/.test(text) ? parseICS(text, cfg.tz) : parseCSV(text);
      if (!items.length) { toast(t('No schedule items found in that file')); return; }
      cfg.schedule = cfg.schedule.filter(x => x.title).concat(items.map(x => ({ date: x.date || cfg.start.slice(0, 10), time: x.time || '', title: x.title, note: x.note || '' })))
        .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
      changed(true); toast(items.length > 1 ? t('Added {n} items', { n: items.length }) : t('Added 1 item'));
    });
    return;
  }
  if (i.dataset.rsvpVia != null) {
    if (!i.checked) return; const m = i.dataset.rsvpVia;
    cfg.off.rsvp = m === 'off'; if (m !== 'off') cfg.rsvpVia = m;
    const part = (k) => rqNear(i, `[data-rsvp-part="${k}"]`); const ed = rqNear(i, '.rq-ed');
    if (part('link')) part('link').hidden = m !== 'link'; if (part('by')) part('by').hidden = m === 'off'; if (ed) ed.hidden = m !== 'form';
    changed(); if (m === 'link') setTimeout(() => { const u = part('link') && part('link').querySelector('input'); if (u && !u.value) u.focus(); }, 0); return;
  }
  if (i.dataset.rq) { const q = rqCfg(cfg); q[i.dataset.rq] = i.checked; const sub = rqNear(i, `[data-rq-sub="${i.dataset.rq}"]`); if (sub) sub.hidden = !i.checked; changed(); return; }
  if (i.dataset.rqMeals != null) { rqCfg(cfg).meals = i.value.split('\n').map(x => x.trim().slice(0, 60)).filter(Boolean).slice(0, 12); changed(); return; }
  if (i.dataset.rqEv != null) { const q = rqCfg(cfg); const off = new Set(q.evOff); if (i.checked) off.delete(i.dataset.rqEv); else off.add(i.dataset.rqEv); q.evOff = [...off]; changed(); return; }
  if (i.dataset.rqQ != null) { const q = rqCfg(cfg); q.q[+i.dataset.rqQ] = i.value.trim().slice(0, 120); changed(); return; }
  if (i.dataset.gmsg != null) { cfg.guestMessages = i.checked; changed(); return; }
  if (i.dataset.access) { cfg.access = cfg.access || {}; cfg.access[i.dataset.access] = i.value; changed(); }
}

// ---- access and arrival ----
const ACCESS_FIELDS = [['dropoff', 'Drop-off point'], ['entrance', 'Step-free entrance'], ['parking', 'Accessible parking'], ['restrooms', 'Accessible restrooms'], ['notes', 'Other access notes']];
COMMON_CARDS.splice(3, 0, ['access', 'Access and arrival', 'Drop-off, step-free']);
COMMON_CARDS.splice(1, 0, ['rsvp', 'RSVP', 'Replies or your link']); // weddings show it first under For weddings (allCards)
COMMON_CARDS.push(['msgs', t('Messages'), t('Guest messages, groups')]); // shown once schema-3 is installed
async function loadCardGroups() {
  const slot = $('#sheet [data-grp-slot]'); if (!slot || !B.hosted || !SB) return; const eid = B.hosted.id;
  const paint = async () => { try { const c = await sb(); const gs = await loadGroups(c, eid); if (!document.body.contains(slot)) return; slot.innerHTML = groupsEdHTML(gs); wireGroupsEd(slot, c, eid, paint); } catch { slot.innerHTML = ''; } };
  if (!(await myGuestUser())) { slot.innerHTML = `<p class="hint">${t('Sign in to manage groups.')}</p>`; return; }
  paint();
}
function extraCardBody(id, c) {
  if (id === 'vendor') return vnSheetHTML(c);
  if (id === 'msgs') return `<label class="tool"><input type="checkbox" data-gmsg ${c.guestMessages ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${t('Let guests message you')}</label>
    <h3 class="sub-h">${t('Groups')}</h3><div data-grp-slot>${B.hosted ? `<p class="muted small">${t('Loading…')}</p>` : `<p class="hint">${t('Get a short link first.')}</p>`}</div>`;
  if (id === 'rsvp') return rsvpCardHTML(c);
  if (id !== 'access') return '';
  const a = c.access || {};
  return ACCESS_FIELDS.map(([k, l]) => fieldWrap(l, `<input id="acc-${k}" data-access="${k}" value="${esc(a[k] || '')}">`, `acc-${k}`)).join('');
}
// builder → RSVP: one card — collect replies here (the form) or use my own link, a reply-by date for both, or no RSVP
function rsvpCardHTML(c) {
  const r = rsvpOf(c); const d = typeData(c); const mode = c.off.rsvp ? 'off' : r.via;
  const opt = (v, l) => `<label class="chk"><input type="radio" name="rsvp-via" data-rsvp-via="${v}"${mode === v ? ' checked' : ''}> ${esc(t(l))}</label>`;
  return `<div class="rsvp-via" role="radiogroup" aria-label="${esc(t('RSVP'))}">${opt('form', 'Collect replies here')}${opt('link', 'Use my own link')}${opt('off', 'No RSVP')}</div>
    <div data-rsvp-part="link"${mode === 'link' ? '' : ' hidden'}>${fieldWrap('Link', `<input id="x-rsvp" type="url" data-x="rsvp" value="${esc(d.rsvp || '')}" placeholder="https://…">`, 'x-rsvp')}</div>
    <div data-rsvp-part="by"${mode === 'off' ? ' hidden' : ''}>${fieldWrap('Reply by', `<input id="x-rsvpBy" type="date" data-x="rsvpBy" value="${esc(d.rsvpBy || '')}">`, 'x-rsvpBy')}</div>
    ${rqCardHTML(c, mode !== 'form')}`;
}
const rqNear = (el, sel) => { for (let a = el.parentElement; a; a = a.parentElement) { const f = a.querySelector(sel); if (f) return f; } return null; };
// builder → RSVP form: the extra questions (all optional for guests, asked only of guests who are coming)
function rqCardHTML(c, hide) {
  const q = normRsvpq(c.rsvpq); const evs = [...new Set((c.schedule || []).map(x => String(x.title || '').trim()).filter(Boolean))]; const off = new Set(q.evOff);
  const tg = (k, l) => `<label class="chk"><input type="checkbox" data-rq="${k}"${q[k] ? ' checked' : ''}> ${esc(t(l))}</label>`;
  const sub = (k, html) => `<div class="rq-sub" data-rq-sub="${k}"${q[k] ? '' : ' hidden'}>${html}</div>`;
  return `<div class="rq-ed"${hide ? ' hidden' : ''}><h3 class="sub-h">${t('Questions on the form')}</h3><p class="hint">${t('All optional for guests, and only asked of guests who are coming.')}</p>
    ${tg('meal', 'Meal choice')}${sub('meal', fieldWrap('Meal options, one per line', `<textarea id="rq-meals" data-rq-meals rows="3" placeholder="${esc(t('Chicken\nFish\nVegetarian'))}">${esc(q.meals.join('\n'))}</textarea>`, 'rq-meals'))}
    ${tg('diet', 'Dietary needs')}
    ${tg('plus', 'Names of everyone in their party')}
    ${tg('events', 'Which events they’ll attend')}${sub('events', evs.length ? `<p class="hint">${t('Ask about:')}</p>${evs.map(x => `<label class="chk"><input type="checkbox" data-rq-ev="${esc(x)}"${off.has(x) ? '' : ' checked'}> ${esc(x)}</label>`).join('')}` : `<p class="hint">${t('Add titled items to your Schedule first.')}</p>`)}
    ${tg('qs', 'Your own questions')}${sub('qs', [0, 1].map(i => fieldWrapRaw(t('Question {n}', { n: i + 1 }), `<input id="rq-q${i}" data-rq-q="${i}" maxlength="120" value="${esc(q.q[i])}" placeholder="${esc(t(i ? 'A song that gets you dancing?' : 'Need a ride from the hotel?'))}">`, 'rq-q' + i)).join(''))}
  </div>`;
}
function accessHTML(cfg, osm) {
  if (cfg.off.access) return '';
  const a = cfg.access || {}; const rows = ACCESS_FIELDS.filter(([k]) => a[k] && String(a[k]).trim()).map(([k, l]) => `<li class="note"><b>${esc(t(l))}</b><span>${esc(a[k])}</span></li>`);
  let st = '';
  if (osm && cfg.venue) {
    const v = cfg.venue; const sts = ['subway', 'rail', 'tram', 'ferry', 'bus'].flatMap(k => osm.transit[k] || []).filter(x => x.wheelchair === 'yes' || x.wheelchair === 'limited').sort((x, y) => x.d - y.d).slice(0, 3);
    if (sts.length) st = `<h3 class="sub-h">${t('Step-free stations nearby')}</h3><ul class="plist">${sts.map(x => `<li><div><b>${esc(x.name)}</b><span>${esc(t(x.wheelchair === 'yes' ? 'Step-free' : 'Partly step-free'))}${x.line ? ' · ' + esc(x.line.split(';').join(' · ')) : ''}</span></div><span class="dist">${esc(fmtDist(x.d, v.cc))}<small>${walkTxt(x.d)}</small></span></li>`).join('')}</ul>`;
  }
  const docs = docsHTML(cfg, ['access']);
  if (!rows.length && !st && !docs) return '';
  return sec('access', t('Access and arrival'), `${rows.length ? `<ul class="links">${rows.join('')}</ul>` : ''}${st}${docs}`);
}

function extraClick(b, cfg) { if (b.dataset.act === 'qr') openQR(cfg); }
function suExtraClick(b, cfg) { if (b.dataset.su === 'qr') openQR(cfg); }

// ================= About: fill from a website link =================
// Free, keyless, CORS-enabled readers: Microlink first, Jina Reader as the fallback. Everything fetched is treated as plain text.
const cleanText = (s, max) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const safeImg = (u) => { try { const x = new URL(String(u || '')); return x.protocol === 'https:' && x.href.length <= 800 ? x.href : ''; } catch { return ''; } };
function normSite(u) { u = String(u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; try { const x = new URL(u); return /\./.test(x.hostname) ? x.href : ''; } catch { return ''; } }
async function fetchTimeout(url, init = {}, ms = 12000) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); } finally { clearTimeout(tm); }
}
async function readSite(url) {
  const tries = [
    async () => {
      const r = await fetchTimeout(`https://api.microlink.io/?url=${enc(url)}`); if (!r.ok) throw new Error('microlink ' + r.status);
      const j = await r.json(); if (j.status !== 'success' || !j.data) throw new Error('microlink failed');
      const d = j.data; return { title: d.title, description: d.description, image: d.image && d.image.url, publisher: d.publisher };
    },
    async () => {
      const r = await fetchTimeout(`https://r.jina.ai/${url}`, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('jina ' + r.status);
      const j = await r.json(); const d = j && j.data; if (!d) throw new Error('jina failed');
      return { title: d.title, description: d.description || '', image: '', publisher: '' };
    },
  ];
  for (const f of tries) {
    try {
      const m = await f();
      const out = { title: cleanText(m.title, 120), description: cleanText(m.description, 1200), image: safeImg(m.image), publisher: cleanText(m.publisher, 80) };
      // a reader that could not load the page tends to echo the hostname or an error page back
      const host = hostOf(url);
      if (/application error|access denied|just a moment|attention required|404|not found|enable javascript/i.test(out.title + ' ' + out.description.slice(0, 120))) continue;
      if (!out.description && (!out.title || out.title.replace(/^www\./, '') === host)) continue;
      return out;
    } catch { /* next reader */ }
  }
  return null;
}
const aboutSiteHTML = (c) => `<div class="field"><label for="f-site">${t('Website')}</label><div class="search"><input id="f-site" type="url" inputmode="url" placeholder="yourwedding.com" value="${esc(B.site || '')}" autocomplete="off"><button type="button" class="btn" data-b="site-fill" ${B.siteBusy ? 'disabled' : ''}>${t(B.siteBusy ? 'Reading…' : 'Fill in')}</button></div><p class="hint" id="site-msg" role="status" aria-live="polite">${esc(B.siteMsg || t('Copies the description and photo.'))}</p></div>`;
async function aboutFill() {
  const c = B.cfg; const url = normSite(B.site);
  if (!url) { B.siteMsg = t('That doesn’t look like a website link.'); renderSheet(); return; }
  B.siteBusy = true; B.siteMsg = t('Reading that site…'); renderSheet();
  const m = await readSite(url);
  B.siteBusy = false;
  if (!m) { B.siteMsg = t('Couldn’t read that site. Type it in below.'); renderSheet(); setTimeout(() => $('#f-desc')?.focus(), 0); return; }
  const got = [];
  if (m.description) { c.description = m.description; got.push('description'); } else if (m.title && !c.description) { c.description = m.title; got.push('title'); }
  if (!c.title.trim() && m.title) { c.title = m.title.slice(0, 80); got.push('title'); }
  if (!c.host.trim() && m.publisher && m.publisher.replace(/^www\./, '') !== hostOf(url)) { c.host = m.publisher; got.push('host'); }
  if (m.image && !c.cover) { c.cover = m.image; got.push('photo'); }
  B.siteMsg = got.length ? t('Filled in from {s}. Edit anything below.', { s: hostOf(url) }) : t('That site had nothing to copy. Type it in below.');
  changed(true);
}

// ================= phase C: hosted pages (Supabase) =================
// Guests talk to the database over plain REST with the publishable key (no library download).
// Organizers load supabase-js only when they ask for a short link or open My pages (lazy sign-in, magic link only).
const SB = window.EP_SUPABASE && window.EP_SUPABASE.url ? window.EP_SUPABASE : null;
const SB_JS = { src: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js', integrity: 'sha384-uteMfOloLDGt042uDz+xHGF3ym63/WQ6rFq7murQRG8Ih7QrXGEGNtWd8688sb4O' };
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const siteBase = () => location.origin + APP_ROOT; // the app itself (a /<name> address is a page, not the app)
// a hosted page's link: the pretty one when the page has a name, else ?e=<slug>
const shortURL = (slug) => pnName(slug) ? siteBase() + pnName(slug) : `${siteBase()}?e=${slug}`;
const linkText = (slug) => pnName(slug) ? location.host + APP_ROOT + pnName(slug) : '?e=' + slug;
let sbClient = null, sbLoading = null;
function sb() {
  if (sbClient) return Promise.resolve(sbClient);
  if (!SB) return Promise.reject(new Error('Hosting is not set up'));
  return sbLoading || (sbLoading = new Promise((res, rej) => {
    const go = () => {
      try {
        sbClient = window.supabase.createClient(SB.url, SB.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'ep-auth' } });
        res(sbClient);
      } catch (e) { sbLoading = null; rej(e); }
    };
    if (window.supabase && window.supabase.createClient) return go();
    const s = document.createElement('script'); s.src = SB_JS.src; s.integrity = SB_JS.integrity; s.crossOrigin = 'anonymous';
    s.onload = go; s.onerror = () => { sbLoading = null; s.remove(); rej(new Error('Could not load sign-in. Check your connection.')); };
    document.head.appendChild(s);
  }));
}
async function sbUser() { const c = await sb(); const { data } = await c.auth.getSession(); return data && data.session ? data.session.user : null; }
async function rest(path, { method = 'GET', body, prefer } = {}) {
  if (!SB) throw new Error('Hosting is not set up');
  const headers = { apikey: SB.key, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const url = `${SB.url}/rest/v1/${path}`; const keep = method === 'GET' && offKeepRest(path);
  let r;
  try { r = await fetchTimeout(url, { method, headers, body: body ? JSON.stringify(body) : undefined }, 15000); }
  catch (e) { if (method === 'GET' && OFFLINE_REST.test(path)) { const h = await offGet(url); if (h) return h.json(); } throw e; }
  if (!r.ok) { const e = new Error('Request failed (' + r.status + ')'); e.status = r.status; throw e; }
  if (keep && r.status === 200) { const j = await r.json(); offPut(url, new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json' } })); return j; }
  return r.status === 204 || r.status === 201 && prefer === 'return=minimal' ? null : r.json();
}
// ================= offline: a trip the guest opened stays readable without a connection =================
// The service worker keeps the app itself (sw.js). This keeps the page's data: its config and updates (REST), its
// documents and photos (Storage), in the 'ep-data' cache that survives app updates; My trip data is in localStorage.
// "Save for offline" in My trip is on by default for every trip opened; off removes this page's copies.
const DATA_CACHE = 'ep-data';
const OFFLINE_REST = /^(events\?slug=eq\.|announcements\?|event_groups\?)/;
const offOK = () => typeof caches !== 'undefined';
const offSlugOf = (path) => { const m = path.match(/^events\?slug=eq\.([a-z0-9-]+)/); return m ? m[1] : ''; };
const offOn = (key) => LS.get('offline:' + key) !== false;
const offKeepRest = (path) => OFFLINE_REST.test(path) && (!offSlugOf(path) || offOn(offSlugOf(path)));
async function offPut(url, resp) { if (!offOK()) return; try { await (await caches.open(DATA_CACHE)).put(url, resp); } catch { /* storage full or blocked */ } }
async function offGet(url, ignoreSearch) { if (!offOK()) return null; try { return (await (await caches.open(DATA_CACHE)).match(url, { ignoreSearch: !!ignoreSearch })) || null; } catch { return null; } }
const offFiles = (cfg) => [...(cfg.files || []).map(f => f.url), cfg.cover, ...(cfg.custom || []).map(x => x.img)].map(u => httpsUrl(u || '')).filter(Boolean);
async function offSave(cfg) {
  if (!offOK()) return 0; const c = await caches.open(DATA_CACHE); let n = 0;
  for (const u of offFiles(cfg)) { if (await c.match(u)) { n++; continue; } try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) { await c.put(u, r); n++; } } catch { /* not reachable now; tried again next open */ } }
  return n;
}
async function offForget(cfg, hosted) {
  if (!offOK()) return; const c = await caches.open(DATA_CACHE);
  for (const u of offFiles(cfg)) await c.delete(u);
  if (hosted) for (const req of await c.keys()) if (req.url.includes(`slug=eq.${hosted.slug}`) || req.url.includes(`event_id=eq.${hosted.id}`)) await c.delete(req);
}
// queued while offline, sent when the connection is back: RSVPs and messages to the host
const outbox = () => LS.get('outbox', []) || [];
function outboxAdd(x) { LS.set('outbox', outbox().concat([{ ...x, at: Date.now() }])); }
let flushing = false;
async function flushOutbox() {
  if (flushing || navigator.onLine === false) return; const xs = outbox(); if (!xs.length) return; flushing = true; const left = []; let sent = 0;
  for (const x of xs) {
    try {
      if (x.kind === 'rsvp') { await sendRSVP(x.row); const m = LS.get('rsvp:' + x.row.event_id); if (m) { delete m.pending; LS.set('rsvp:' + x.row.event_id, m); } }
      else if (x.kind === 'msg') { const c = await sb(); const { data, error } = await c.from('event_messages').insert(x.row).select('id').single(); if (error) throw error; notifyEmail('message', data.id); }
      sent++;
    } catch (e) { if (!(e && e.status >= 400 && e.status < 500)) left.push(x); } // refused (4xx): dropped, not retried forever
  }
  LS.set('outbox', left); flushing = false;
  if (sent) { toast(t('Sent what you saved while offline')); document.querySelectorAll('[data-rsvp-pending]').forEach(el => el.remove()); }
}
const isNetErr = (e) => navigator.onLine === false || !(e && e.status);
function offlineRowHTML(cfg, opts) {
  if (!offOK() || opts.preview) return '';
  const key = opts.hosted ? opts.hosted.slug : syncKey(cfg);
  return `<div class="off-row" data-slot="offline"><label class="tool"><input type="checkbox" data-offline ${offOn(key) ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${t('Save for offline')}</label><small class="muted" data-offline-st></small></div>`;
}
function wireOffline(cfg, art, opts) {
  const html = document.documentElement; const set = () => html.classList.toggle('is-offline', navigator.onLine === false); set();
  if (!wireOffline.on) { wireOffline.on = true; addEventListener('offline', set); addEventListener('online', () => { set(); flushOutbox(); }); }
  if (opts.preview) return;
  const key = opts.hosted ? opts.hosted.slug : syncKey(cfg);
  const stEl = () => art.querySelector('[data-offline-st]');
  const status = (n) => { const el = stEl(); if (!el) return; el.textContent = !offOn(key) ? t('Needs a connection to open') : navigator.onLine === false ? t('Showing the copy saved on this device') : t('Saved on this device · {n} files', { n }); };
  const save = () => { if (!offOn(key)) return status(0); if (navigator.onLine === false) return status(0); offSave(cfg).then(status).catch(() => status(0)); };
  save(); flushOutbox();
  addEventListener('online', () => { if (!document.body.contains(art)) return; if (LS.get('signedIn') && cfg.tools.mytrip) syncPush(cfg); save(); });
  addEventListener('offline', () => { if (document.body.contains(art)) { status(0); art._offMap && art._offMap(); } });
  art.addEventListener('change', (e) => { if (!e.target.matches('[data-offline]')) return; const on = e.target.checked; LS.set('offline:' + key, on);
    if (on) { if (opts.hosted) fetchHosted(opts.hosted.slug).catch(() => {}); save(); } else offForget(cfg, opts.hosted).then(() => status(0)); });
  // documents: with no connection, open the saved copy
  art.addEventListener('click', (e) => {
    const a = e.target.closest('.docs a[href], .doc-files a[href]'); if (!a || navigator.onLine !== false) return;
    e.preventDefault(); const dl = a.hasAttribute('download'); const w = dl ? null : window.open('', '_blank');
    offGet(a.href, true).then(r => r ? r.blob() : null).then(b => {
      if (!b) { if (w) w.close(); toast(t('This document isn’t saved on this device')); return; }
      const u = URL.createObjectURL(b); if (w) w.location.href = u; else { const x = document.createElement('a'); x.href = u; x.download = a.getAttribute('download') || 'document'; x.click(); }
    });
  });
  // Nearby with no connection: the map can't load; the hotel and saved spots with their addresses instead
  const offMap = () => { const el = art.querySelector('[data-slot="map-off"]'); if (!el) return; el.innerHTML = navigator.onLine === false ? `<p class="muted off-msg"><b>${t('Offline')}</b> · ${t('The map needs a connection. Open in Google Maps works with its offline maps.')}</p>${spotsHTML(cfg)}` : ''; };
  art._offMap = offMap; offMap(); addEventListener('online', offMap);
}
// the current name of a published page (a ?e= link's share sheet / QR then show 1linktrip.com/<name>); never waits long
function pnFetchFor(slug) {
  if (!SB || !SLUG_RE.test(slug) || navigator.onLine === false) return Promise.resolve();
  const p = rest('rpc/page_name_for', { method: 'POST', body: { sl: slug } }).then(n => { if (typeof n === 'string' && NAME_RE.test(n)) pnRemember('', slug, n); }).catch(() => {});
  return Promise.race([p, sleep(2500)]);
}
async function fetchHosted(slug) {
  if (!SLUG_RE.test(slug)) return null;
  const rows = await rest(`events?slug=eq.${enc(slug)}&select=id,slug,config,updated_at&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}
const fetchAnnouncements = (id) => rest(`announcements?event_id=eq.${enc(id)}&select=id,body,created_at&order=created_at.desc&limit=20`);
const sendRSVP = (row) => rest('rsvps', { method: 'POST', body: row, prefer: 'return=minimal' });
function makeSlug(title) {
  let base = String(title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  if (base.length < 2) base = 'event';
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return base + '-' + Array.from(crypto.getRandomValues(new Uint8Array(5)), b => abc[b % abc.length]).join('');
}
const fmtStamp = (iso) => { try { return new Intl.DateTimeFormat(LOCALES[LANG] || 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); } catch { return ''; } };

// ---------- guest side: a hosted page ----------
async function renderHosted(slug, tab) {
  LANG = pickLang(); document.documentElement.lang = LANG;
  $('#app').innerHTML = `<div class="viewer"><div class="vbar"><a class="brand sm" href="#">${BRAND}</a></div><div id="ev-root"><div class="skel" role="status"><span></span><span></span><em>${t('Loading…')}</em></div></div></div>`;
  let row = null; const nmP = PATH && PATH.slug === slug ? null : pnFetchFor(slug); // its pretty link, for the share sheet
  try { row = await fetchHosted(slug); }
  catch { return hostedProblem(t('Couldn’t load this page. Check your connection and try again.'), true); }
  if (nmP) await nmP;
  if (!row && acctOn() && SLUG_RE.test(slug)) { // the signed-in organizer's own page, not shared yet
    try { const c = await sb(); const { data } = await c.from('events').select('id,slug,config,updated_at,published').eq('slug', slug).maybeSingle(); if (data) row = data; } catch { /* below */ }
  }
  if (!row) return hostedProblem(t('This page isn’t available. It may have been removed or hidden by its organizer.'));
  const osm = row.config && row.config.osm; const cfg = normalize(row.config); const hosted = { id: row.id, slug: row.slug, url: shortURL(row.slug) };
  if (osm && cfg.venue && Array.isArray(osm.food)) memo.set(osmKey(cfg.venue.lat, cfg.venue.lon), Promise.resolve(osm));
  document.title = (cfg.title || 'Event') + ' · 1LinkTrip';
  LANG = guestLangPick(cfg); document.documentElement.lang = LANG; document.documentElement.dir = RTL.has(LANG) ? 'rtl' : 'ltr';
  // a "Share my trip" link (?s=<token>): the page plus that person's bookings, followed from now on (the token leaves the
  // address so it isn't passed on by accident)
  const sq = (new URLSearchParams(location.search).get('s') || '').toLowerCase(); let shArrived = false;
  if (sq) { const q = new URLSearchParams(location.search); q.delete('s'); const qs2 = q.toString(); history.replaceState(null, '', location.pathname + (qs2 ? '?' + qs2 : '') + location.hash); shArrived = /^[a-f0-9]{32}$/.test(sq); }
  // the organizer (this device has the page in My pages) gets their page with tap-to-edit, right at its link; everyone else
  // gets the guest page (and "Edit a copy"). The account's copy wins over an older one on this device, as in the sync.
  let own = pagesAll().find(p => p.hosted && p.hosted.id === row.id);
  if (own) {
    const rt = Date.parse(row.updated_at) || 0;
    if (!((own.edited || 0) > rt + 1000) && builderHash(row.config) !== builderHash(own.cfg)) { pageSave(own.pid, { cfg: normalize(row.config), edited: rt }); own = pagesAll().find(p => p.pid === own.pid) || own; }
    if (row.published !== undefined && own.hosted.pub !== !!row.published) pageSave(own.pid, { hosted: { ...own.hosted, pub: !!row.published } });
    window.__ownTab = tab; return renderBuilder(own.cfg, null, own.hosted, own.pid);
  }
  if (shArrived && !cfg.demoTrip) { const k = syncKey(cfg); const was = LS.get('shIn:' + k); if (was && was !== sq) shareUnfollow(cfg); if ((LS.get('shOut:' + k) || {}).tok !== sq) LS.set('shIn:' + k, sq); }
  if (LS.get('shIn:' + syncKey(cfg))) { await shareFollow(cfg, hosted, shArrived); if (shArrived && !tab && cfg.tools && cfg.tools.mytrip && tabsFor(cfg).some(x => x[0] === 'mytrip')) tab = 'mytrip'; }
  $('.vbar').insertAdjacentHTML('beforeend', `${langPillsHTML(cfg)}${langSelectHTML(cfg)}${vbarEditHTML(`#edit=${packEvent(cfg)}`, t('Edit a copy'))}`);
  requestAnimationFrame(pillInView);
  if (row.published === false) $('.viewer').insertAdjacentHTML('beforeend', `<div class="own-stale" role="status"><span>${t('Only you can see this page.')}</span></div>`);
  guestRender(cfg, $('#ev-root'), { tab, hosted, shareUrl: hosted.url });
  // '#' alone can't leave a ?e= page (the hash doesn't change), so home links point at the app itself
  $$('#app a[href="#"]').forEach(x => x.setAttribute('href', siteBase()));
  window.scrollTo(0, 0);
  scrollBack();
}
function hostedProblem(msg, retry) {
  $('#app').innerHTML = `<main class="land"><header class="land-top"><a class="brand" href="#">${BRAND}</a></header><section class="broken"><h1>${esc(msg)}</h1>${retry ? `<button class="btn primary" onclick="location.reload()">${t('Try again')}</button>` : `<a class="btn primary" href="${esc(siteBase())}">${t('Go to 1LinkTrip')}</a>`}</section></main>`;
  $$('#app a[href="#"]').forEach(x => x.setAttribute('href', siteBase()));
}
// ---- RSVP questions (cfg.rsvpq, builder → RSVP form): meal, dietary needs, names of the party, which events, two own questions ----
// All off by default, on every type. rsvps has no column for them, so the answers ride in `note` (text, ≤1000 chars by its
// check constraint) after the guest's own note: "<note>\n\n[[1lt:{"v":1,...}]]". rqParse splits them again; replies
// without it (older ones, or with every question off) read exactly as before.
const RQ_MARK = '[[1lt:';
const BLOCK_KEYS = ['blockHotel', 'blockUrl', 'blockCode', 'blockBy', 'blockRoom', 'blockCancel', 'blockNonRef', 'blockNote'];
// ---- RSVP (builder → RSVP): the organizer either collects replies here (the form below, cfg.rsvpVia 'form') or points guests
// at their own link ('link', the URL in x[type].rsvp); a reply-by date (x[type].rsvpBy) for both. off.rsvp turns RSVP off.
// Pages from before the one RSVP card had an "RSVP" link card (weddings) and an "RSVP form" card side by side; they
// read as before until the organizer picks (rsvpOf): a link wins unless the form has questions on; a link with the form
// switched off becomes 'link' on load (rsvpMigrate), since off.rsvp now turns the whole RSVP off.
const RQ_KEYS = ['meal', 'diet', 'plus', 'events', 'qs'];
const rqOn = (c) => !!(c.rsvpq && RQ_KEYS.some(k => c.rsvpq[k]));
function rsvpMigrate(c) {
  if (isTrip(c) || c.rsvpVia || !c.off.rsvp || !rsvpUrl(((c.x || {})[c.type] || {}).rsvp)) return;
  c.rsvpVia = 'link'; c.off.rsvp = false;
}
const rsvpUrl = (u) => { const r = String(u || '').trim(); return r ? httpsUrl(/^[a-z][\w+.-]*:/i.test(r) ? r : 'https://' + r) : ''; };
// { on, via: 'form' | 'link', url, by } — on: guests get an RSVP (the form, or a link that is filled in)
// an example page (?demo=wedding) shows its RSVP form working, answers kept on this device only
const demoRsvp = (cfg, opts) => { const r = rsvpOf(cfg); return !!(opts && opts.exampleId && !opts.hosted && !opts.preview && r.on && r.via === 'form' && (r.by || cfg.type === 'Wedding')); };
function rsvpOf(cfg) {
  const d = typeData(cfg); const url = rsvpUrl(d.rsvp); const via = cfg.rsvpVia || (url && !rqOn(cfg) ? 'link' : 'form');
  const by = isoDay(d.rsvpBy) ? d.rsvpBy : '';
  return { on: !isTrip(cfg) && !(cfg.off && cfg.off.rsvp) && (via === 'form' || !!url), via, url, by };
}
function normRsvpq(q) {
  q = q && typeof q === 'object' ? q : {}; const s = (v, n) => (typeof v === 'string' ? v : '').trim().slice(0, n);
  return { meal: !!q.meal, meals: (Array.isArray(q.meals) ? q.meals : []).map(x => s(x, 60)).filter(Boolean).slice(0, 12), diet: !!q.diet, plus: !!q.plus,
    events: !!q.events, evOff: (Array.isArray(q.evOff) ? q.evOff : []).map(x => s(x, 200)).filter(Boolean).slice(0, 60), qs: !!q.qs, q: [0, 1].map(i => s((q.q || [])[i], 120)) };
}
const rqCfg = (cfg) => (cfg.rsvpq = cfg.rsvpq ? normRsvpq(cfg.rsvpq) : normRsvpq({}));
// the page's titled schedule items the organizer asks about (each title once)
function rqEvents(cfg) {
  const off = new Set(((cfg.rsvpq || {}).evOff) || []); const out = [];
  (cfg.schedule || []).forEach((x, i) => { const tt = String(x.title || '').trim(); if (tt && !off.has(tt) && !out.some(o => o.t === tt)) out.push({ i, t: tt }); });
  return out;
}
// what the guest form asks, from the page as written (null: nothing)
function rqParts(cfg) {
  const q = cfg && cfg.rsvpq; if (!q) return null;
  const p = { meal: q.meal && q.meals.length > 0, diet: q.diet, plus: q.plus, events: q.events ? rqEvents(cfg) : [], qs: q.qs ? [0, 1].filter(i => q.q[i]) : [] };
  return p.meal || p.diet || p.plus || p.events.length || p.qs.length ? p : null;
}
function rqParse(note) {
  const s = String(note || ''); const i = s.lastIndexOf(RQ_MARK);
  if (i >= 0 && s.endsWith(']]')) { try { const x = JSON.parse(s.slice(i + RQ_MARK.length, -2)); if (x && typeof x === 'object' && x.v === 1) return { text: s.slice(0, i).trimEnd(), x }; } catch { /* a note that only looks like it */ } }
  return { text: s, x: null };
}
function rqPack(note, x) {
  note = note || ''; if (!x) return note || null;
  const cap = (n) => JSON.stringify(x, (k, v) => (typeof v === 'string' && k !== '' ? v.slice(0, n) : v));
  let j = JSON.stringify(x); for (const n of [120, 60, 30, 16]) { if (j.length <= 900) break; j = cap(n); }
  if (j.length > 900) j = JSON.stringify({ v: 1, ...(x.meal ? { meal: x.meal.slice(0, 60) } : {}), ...(x.diet ? { diet: x.diet.slice(0, 200) } : {}) });
  const tail = RQ_MARK + j + ']]'; note = note.slice(0, Math.max(0, 1000 - tail.length - 2)).trimEnd();
  return (note ? note + '\n\n' : '') + tail;
}
// guest form: `cfg` is the page in the guest's language, `src` as written (answers are stored in the organizer's words)
function rqMealSel(cfg, src, id, cur, label, attr = '') {
  const tm = (cfg.rsvpq && cfg.rsvpq.meals) || [];
  return `<select id="${id}"${attr}${label ? ` aria-label="${esc(label)}"` : ''}><option value="">${t('Choose…')}</option>${src.rsvpq.meals.map((m, i) => `<option value="${i}"${cur === m ? ' selected' : ''}>${esc(tm[i] || m)}</option>`).join('')}</select>`;
}
function rqPlusHTML(cfg, src, n, vals) {
  const P = rqParts(src); if (!P || !P.plus || n < 2) return '';
  return `<div class="field"><span class="lbl-s">${t('Names of your guests')}</span>${Array.from({ length: Math.min(19, n - 1) }, (_, k) => { const v = vals[k] || {}; const lab = t('Guest {n}', { n: k + 2 });
    return `<div class="rs-plus"><input data-rs-plus="${k}" maxlength="60" autocomplete="off" placeholder="${esc(lab)}" aria-label="${esc(lab)}" value="${esc(v.n || '')}">${P.meal ? rqMealSel(cfg, src, 'rs-pm-' + k, v.m || '', t('Meal') + ' · ' + lab, ` data-rs-pmeal="${k}"`) : ''}</div>`; }).join('')}</div>`;
}
function rqFormHTML(cfg, src, prev) {
  const P = rqParts(src); if (!P) return '';
  const x = prev.x || {}; const tq = cfg.rsvpq || src.rsvpq; const had = (prev.x && Array.isArray(x.events)) ? new Set(x.events) : null;
  const plusVals = (x.plus || []).map((n, k) => ({ n, m: (x.pmeal || [])[k] || '' }));
  return `<div class="rs-x" data-rsvp-x${prev.attending === false ? ' hidden' : ''}>
    ${P.meal || P.diet ? `<div class="two">${P.meal ? `<div class="field"><label for="rs-meal">${t('Meal')}</label>${rqMealSel(cfg, src, 'rs-meal', x.meal || '')}</div>` : ''}${P.diet ? `<div class="field"><label for="rs-diet">${t('Dietary needs (optional)')}</label><input id="rs-diet" maxlength="200" placeholder="${esc(t('Allergies, vegetarian…'))}" value="${esc(x.diet || '')}"></div>` : ''}</div>` : ''}
    ${P.plus ? `<div data-rsvp-plus>${rqPlusHTML(cfg, src, prev.attending === false ? 1 : (prev.guests || 1), plusVals)}</div>` : ''}
    ${P.events.length ? `<fieldset class="field rs-evs"><legend class="lbl-s">${t('Which events will you attend?')}</legend><div class="rs-chips">${P.events.map(e => `<label class="rs-chip"><input type="checkbox" data-rs-ev="${e.i}"${!had || had.has(e.t) ? ' checked' : ''}><span>${esc(String((cfg.schedule[e.i] || {}).title || e.t).trim())}</span></label>`).join('')}</div></fieldset>` : ''}
    ${P.qs.map(i => `<div class="field"><label for="rs-q${i}">${esc(tq.q[i] || src.rsvpq.q[i])}</label><input id="rs-q${i}" maxlength="200" value="${esc(x['q' + (i + 1)] || '')}"></div>`).join('')}
  </div>`;
}
function rqCollect(slot, src, guests) {
  const P = rqParts(src); if (!P) return null; const q = src.rsvpq; const x = { v: 1 };
  const val = (sel) => ((slot.querySelector(sel) || {}).value || '').trim(); const meal = (v) => (v === '' ? '' : q.meals[+v] || '');
  if (P.meal) { const m = meal(val('#rs-meal')); if (m) x.meal = m; }
  if (P.diet) { const d = val('#rs-diet').slice(0, 200); if (d) x.diet = d; }
  if (P.plus && guests > 1) {
    const ins = [...slot.querySelectorAll('[data-rs-plus]')].slice(0, guests - 1); const names = ins.map(i => i.value.trim().slice(0, 60));
    const pm = P.meal ? ins.map(i => meal(val(`[data-rs-pmeal="${i.dataset.rsPlus}"]`))) : [];
    if (names.some(Boolean) || pm.some(Boolean)) { x.plus = names; if (pm.some(Boolean)) x.pmeal = pm; }
  }
  if (P.events.length) x.events = P.events.filter(e => (slot.querySelector(`[data-rs-ev="${e.i}"]`) || {}).checked).map(e => e.t);
  P.qs.forEach(i => { const a = val('#rs-q' + i).slice(0, 200); if (a) x['q' + (i + 1)] = a; });
  return Object.keys(x).length > 1 ? x : null;
}
function rsvpFormHTML(cfg, hosted, src = cfg) {
  const mine = LS.get('rsvp:' + hosted.id);
  if (mine && !mine.editing) return `<div class="rsvp-done"><p><b>${esc(t('Thanks, {n}.', { n: mine.name }))}</b> ${esc(mine.attending ? t('We’ve got you down as coming.') : t('We’ve let the host know you can’t make it.'))}</p>${mine.pending ? `<p class="hint" data-rsvp-pending>${esc(t('Saved on this device. It will be sent when you’re back online.'))}</p>` : ''}<button type="button" class="btn sm" data-rsvp="again">${t('Change my reply')}</button></div>`;
  const prev = mine || {};
  return `<form class="rsvp" novalidate onsubmit="return false">
    <div class="field"><label for="rs-name">${t('Your name')}</label><input id="rs-name" maxlength="120" autocomplete="name" value="${esc(prev.name || '')}" required></div>
    <div class="field"><span class="lbl-s">${t('Will you be there?')}</span><div class="seg2" role="radiogroup"><button type="button" role="radio" data-rsvp-att="1" aria-checked="${prev.attending !== false}" class="${prev.attending !== false ? 'on' : ''}">${t('Yes, I’ll be there')}</button><button type="button" role="radio" data-rsvp-att="0" aria-checked="${prev.attending === false}" class="${prev.attending === false ? 'on' : ''}">${t('Can’t make it')}</button></div></div>
    <div class="two"><div class="field" data-rsvp-guests ${prev.attending === false ? 'hidden' : ''}><label for="rs-guests">${t('How many, including you')}</label><input id="rs-guests" type="number" min="1" max="20" inputmode="numeric" value="${esc(prev.guests || 1)}"></div>
    <div class="field"><label for="rs-email">${t('Email (optional)')}</label><input id="rs-email" type="email" maxlength="254" autocomplete="email" value="${esc(prev.email || '')}"></div></div>
    <div data-rsvp-group></div>
    ${rqFormHTML(cfg, src, prev)}
    <div class="field"><label for="rs-note">${t('Note for the host (optional)')}</label><textarea id="rs-note" rows="2" maxlength="1000">${esc(prev.note || '')}</textarea></div>
    <p class="rsvp-msg" role="status" aria-live="polite"></p>
    <button type="button" class="btn primary" data-rsvp="send">${t('Send reply')}</button>
    <p class="muted small">${t('Only the host sees your reply.')}</p>
  </form>`;
}
function wireHosted(cfg, art, hosted, opts = {}) {
  const src = opts.src || cfg;
  const body = art.querySelector('.ev-panel[data-panel="event"] .ev-body'); if (!body) return;
  body.insertAdjacentHTML('afterbegin', '<div data-slot="ann"></div>');
  const R = rsvpOf(cfg);
  if (R.on && R.via === 'form') {
    const html = sec('rsvp', t('RSVP'), `<div data-slot="rsvp">${rsvpFormHTML(cfg, hosted, src)}</div>`);
    const wrap = body.querySelector('[data-slot="rsvp-wrap"]');
    if (wrap) wrap.innerHTML = html; else body.querySelector('[data-slot="ann"]').insertAdjacentHTML('afterend', html);
    if (art._cx) art._cx(); // its title folds like the others
  }
  if (opts.preview) { art.querySelectorAll('.rsvp input, .rsvp textarea, .rsvp select, .rsvp button').forEach(x => { x.disabled = true; }); return; }
  // groups guests can pick at RSVP, and messages (both hidden until schema-3 is installed)
  art._fillPick = () => { const g = art.querySelector('[data-rsvp-group]'); const P = art._gm; if (g && P && P.picks.length) g.innerHTML = groupPickHTML(P.picks, (LS.get('rsvp:' + hosted.id) || {}).group || ''); };
  if (!hosted.demo) wireGuestMsgs(cfg, art, hosted);
  if (!hosted.demo) fetchAnnouncements(hosted.id).then(rows => {
    const s = art.querySelector('[data-slot="ann"]'); if (!s || !rows || !rows.length) return;
    const tr = (cfg.tr && cfg.tr[LANG]) || {}; const show = (r) => { const e = tr['ann.' + r.id]; return e && e.h === hashStr(r.body) ? e.t : r.body; };
    s.innerHTML = `<section class="ev-sec ann" aria-label="${t('Updates from the host')}"><h2 class="sec-h">${t('Updates from the host')}</h2><ul class="ann-list">${rows.map(r => `<li><time>${esc(fmtStamp(r.created_at))}</time><p>${esc(show(r))}</p></li>`).join('')}</ul></section>`;
  }).catch(() => {});
  art.addEventListener('input', (e) => {
    if (e.target.id !== 'rs-guests') return; const slot = art.querySelector('[data-slot="rsvp"]'); const w = slot && slot.querySelector('[data-rsvp-plus]'); if (!w) return;
    const vals = [...w.querySelectorAll('[data-rs-plus]')].map(i => ({ n: i.value, m: (src.rsvpq.meals[+((w.querySelector(`[data-rs-pmeal="${i.dataset.rsPlus}"]`) || {}).value ?? '')] || '') }));
    const n = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)); w.innerHTML = rqPlusHTML(cfg, src, n, vals);
  });
  art.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rsvp],[data-rsvp-att]'); if (!b) return;
    const slot = art.querySelector('[data-slot="rsvp"]');
    if (b.dataset.rsvpAtt != null) {
      $$('[data-rsvp-att]', slot).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
      slot.querySelector('[data-rsvp-guests]').hidden = b.dataset.rsvpAtt === '0'; const rx = slot.querySelector('[data-rsvp-x]'); if (rx) rx.hidden = b.dataset.rsvpAtt === '0'; return;
    }
    if (b.dataset.rsvp === 'again') { const m = LS.get('rsvp:' + hosted.id) || {}; m.editing = true; LS.set('rsvp:' + hosted.id, m); slot.innerHTML = rsvpFormHTML(cfg, hosted, src); art._fillPick(); return; }
    if (b.dataset.rsvp !== 'send') return;
    const v = (id) => (slot.querySelector('#' + id)?.value || '').trim();
    const msg = slot.querySelector('.rsvp-msg');
    const attending = slot.querySelector('[data-rsvp-att="1"]').classList.contains('on');
    const name = v('rs-name').slice(0, 120), email = v('rs-email').slice(0, 254), note = v('rs-note').slice(0, 1000);
    const guests = attending ? Math.min(20, Math.max(1, parseInt(v('rs-guests'), 10) || 1)) : 0;
    if (!name) { msg.textContent = t('Add your name first.'); slot.querySelector('#rs-name').focus(); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = t('That email doesn’t look right.'); slot.querySelector('#rs-email').focus(); return; }
    const group = (slot.querySelector('#rs-group') || {}).value || '';
    const x = attending ? rqCollect(slot, src, guests) : null; const row = { event_id: hosted.id, name, email: email || null, attending, guests, note: rqPack(note, x), ...(group ? { group_id: group } : {}) };
    b.disabled = true; msg.textContent = t('Sending…');
    try {
      if (!hosted.demo) await sendRSVP(row);
      LS.set('rsvp:' + hosted.id, { name, email, attending, guests, note, group, ...(x ? { x } : {}), at: Date.now() });
      if (group) { const u = art._gm && art._gm.user; if (u) setMyGroup(hosted.id, group, u).then(() => art._gmLoad && art._gmLoad()).catch(() => {}); else LS.set('grpPick:' + hosted.id, group); }
      slot.innerHTML = rsvpFormHTML(cfg, hosted, src);
    } catch (err) {
      if (isNetErr(err)) { outboxAdd({ kind: 'rsvp', row }); LS.set('rsvp:' + hosted.id, { name, email, attending, guests, note, group, ...(x ? { x } : {}), at: Date.now(), pending: true }); slot.innerHTML = rsvpFormHTML(cfg, hosted, src); return; }
      b.disabled = false; msg.textContent = t('Couldn’t send your reply. Check your connection and try again.');
    }
  });
}

// ---------- organizer: sign-in (magic link) ----------
async function sendMagicLink(email) {
  const c = await sb();
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: siteBase(), shouldCreateUser: true } });
  if (error) throw error;
}
// Social sign-in: add a provider here and switch it on in supabase-config.js (EP_AUTH_PROVIDERS)
const OAUTH = [['google', 'Continue with Google'], ['apple', 'Sign in with Apple']];
const oauthOn = () => OAUTH.filter(([k]) => window.EP_AUTH_PROVIDERS && window.EP_AUTH_PROVIDERS[k]);
// A plain link to Supabase's authorize endpoint (implicit flow, same URL signInWithOAuth builds): the tap itself
// navigates, so it can't silently stall in an installed iPhone app or while the sign-in library is still loading.
const oauthURL = (provider) => `${SB.url}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(siteBase())}`;
function oauthSignIn(provider, before) {
  try { if (before) before(); } catch { /* storage full: sign-in still works, the draft stays saved locally */ }
  LS.set('afterSignIn', location.hash || '#mine');
}
const signInFormHTML = (msg, email = '') => `<div class="signin">${oauthOn().length ? `<div class="oauth">${oauthOn().map(([k, l]) => `<a class="btn oauth-${k}" data-si-oauth="${k}" href="${esc(oauthURL(k))}">${esc(t(l))}</a>`).join('')}</div><p class="or muted small">${t('or get a link by email')}</p>` : ''}
    <div class="field"><label for="si-email">${t('Your email')}</label><div class="search"><input id="si-email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" value="${esc(email)}"><button type="button" class="btn primary" data-si="send">${t('Send link')}</button></div></div>
    <p class="hint" role="status" aria-live="polite">${esc(msg || t('We’ll email you a one-time sign-in link. No password.'))}</p></div>`;
async function signInSubmit(root, after) {
  const inp = root.querySelector('#si-email'); const hint = root.querySelector('.signin .hint'); const btn = root.querySelector('[data-si="send"]');
  const email = (inp.value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { hint.textContent = t('Enter the email address you want to sign in with.'); inp.focus(); return; }
  if (navigator.onLine === false) { hint.textContent = t('Offline') + ' · ' + t('Sign in when you’re back online.'); return; }
  btn.disabled = true; hint.textContent = t('Sending…');
  try { if (after) after(); await sendMagicLink(email); LS.set('signinEmail', email); root.querySelector('.signin').outerHTML = `<div class="signin sent"><p><b>${t('Check your email.')}</b> ${esc(t('We sent a sign-in link to {e}. Open it on this device to finish.', { e: email }))}</p><button type="button" class="link" data-si="retry">${t('Use a different email')}</button></div>`; }
  catch (e) { btn.disabled = false; hint.textContent = /rate|too many|seconds/i.test(e.message || '') ? t('Sign-in email limit reached for now. Use Continue with Google, or try the email link again in an hour.') : t('Couldn’t send the link.') + ' ' + (e.message || t('Try again.')); }
}
async function authReturn() {
  $('#app').innerHTML = `<main class="land"><section class="broken"><h1>${t('Signing you in…')}</h1></section></main>`;
  let session = null;
  try { const c = await sb(); const r = await c.auth.getSession(); session = r.data && r.data.session; } catch { /* below */ }
  history.replaceState(null, '', siteBase());
  if (!session) { LS.del('pendingPublish'); return renderMine('', 'That sign-in link has expired or was already used. Send yourself a new one.'); }
  LS.set('signedIn', true);
  const sync = acctSyncAll(); // this device's pages join the account
  const ps = LS.get('pendingSave'); LS.del('pendingSave');
  if (ps && ps.packed) { history.replaceState(null, '', siteBase() + '#e=' + ps.packed); route(); return saveLongToMine(ps.packed, $('[data-save-mine]')); }
  const p = LS.get('pendingPublish'); LS.del('pendingPublish');
  if (p && p.cfg) { LS.set('draft', p.cfg); LS.set('draftHosted', p.hosted || null); history.replaceState(null, '', siteBase() + '#new'); renderBuilder(p.cfg, null, p.hosted || null, LS.get('draftId') || undefined); publish({ host: true }); return; }
  const back = LS.get('afterSignIn'); LS.del('afterSignIn');
  if (back && back !== '#mine' && /^#(mine|new|setup|page=[\w-]+$)/.test(back)) { history.replaceState(null, '', siteBase() + back); return route(); }
  if (back && /^\?e=[a-z0-9-]+(#t=[a-z]+)?$/.test(back)) { history.replaceState(null, '', siteBase() + back); return route(); } // a guest signed in on a hosted page
  history.replaceState(null, '', siteBase() + '#mine'); await sync; renderMine('');
}

// ---------- organizer: every page saved to the account ----------
// Signed in, each page is one events row (owner = you): created when the page is made, kept current as you edit (~2 s
// after a change), unpublished until the first Share. Share publishes it and gives its short link (?e=), the same link
// forever; guests always get the latest saved version. Pages made on a device while signed out (or in another browser /
// the installed app, which keep separate storage) are uploaded on sign-in and on every open, matched by the page key (ek).
const acctOn = () => !!(SB && LS.get('signedIn'));
const acctOsm = new Map(); // pid → the nearby-places snapshot last stored with the page
async function hostConfig(pid, cfg, fetchOsm) {
  const config = normalize(clone(cfg));
  if (config.venue) { // guests then skip the slow public Overpass servers
    const v = config.venue; const cached = LS.get('c4:' + osmKey(v.lat, v.lon)); const snap = window.OSM_SNAPSHOTS && window.OSM_SNAPSHOTS[osmKey(v.lat, v.lon)];
    const osm = snap || (cached && cached.d) || (fetchOsm ? await Promise.race([osmNearby(v.lat, v.lon).catch(() => null), sleep(15000).then(() => null)]) : null) || acctOsm.get(pid) || config.osm;
    if (osm) { config.osm = { ...osm, snapshot: osm.snapshot || todayYMD() }; acctOsm.set(pid, osm); }
  }
  return config;
}
const acctQ = new Map(); // one save at a time per page, so a page never gets two rows
function acctSave(pid, opts) {
  const p = (acctQ.get(pid) || Promise.resolve()).catch(() => {}).then(() => acctSaveNow(pid, opts || {}));
  acctQ.set(pid, p); return p;
}
async function acctSaveNow(pid, { publish = false, fetchOsm = false } = {}) {
  let x = pagesAll().find(p => p.pid === pid);
  if (!x || !x.cfg || !String(x.cfg.title || '').trim()) return null;
  if (pageGone({ pid, id: x.hosted && x.hosted.id, ek: x.cfg.ek })) return null; // deleted: never saved again
  const user = await sbUser(); if (!user) { LS.del('signedIn'); return null; }
  LS.set('signedIn', true);
  const c = await sb(); const mine = openPid() === pid;
  if (!x.cfg.ek) { const ek = eventKey(x.cfg); pageSave(pid, { cfg: { ...x.cfg, ek }, edited: x.edited || x.updated || 0 }); if (mine) B.cfg.ek = ek; x = pagesAll().find(p => p.pid === pid); }
  const config = await hostConfig(pid, x.cfg, fetchOsm); const patch = publish ? { config, published: true } : { config };
  const done = (r, pub) => {
    const hosted = { id: r.id, slug: r.slug, owner: user.id, pub: !!pub };
    pageSave(pid, { hosted }); if (openPid() === pid) { B.hosted = hosted; LS.set('draftHosted', hosted); }
    return hosted;
  };
  const update = async (id) => { const { data, error } = await c.from('events').update(patch).eq('id', id).select('id,slug,published'); if (error) throw error; return data && data[0]; };
  if (x.hosted && x.hosted.id) {
    const r = await update(x.hosted.id); if (r) return done(r, r.published);
    const { data: seen } = await c.from('events').select('id').eq('id', x.hosted.id).maybeSingle();
    if (seen) return null; // another account's page: never copied into this one
    // deleted from the account: saved again below as a new page
  }
  // the same page already on the account (saved from another device or browser): one page, the newer version wins
  const { data: same, error: se } = await c.from('events').select('id,slug,config,published,updated_at').eq('owner', user.id).eq('config->>ek', x.cfg.ek).order('updated_at', { ascending: false }).limit(1);
  if (se) throw se;
  const r0 = same && same[0];
  if (r0) {
    const rt = Date.parse(r0.updated_at) || 0;
    if ((mine && B.touched) || (x.edited || 0) > rt) { const r = await update(r0.id); if (r) return done(r, r.published); }
    else {
      const cfg = normalize(r0.config); pageSave(pid, { cfg, edited: rt });
      if (publish && !r0.published) await c.from('events').update({ published: true }).eq('id', r0.id);
      const h = done(r0, publish || r0.published);
      if (mine && !B.touched) { B.cfg = cfg; LS.set('draft', cfg); buildForm(); preview(); renderHostNote(); }
      return h;
    }
  }
  for (let i = 0; i < 4; i++) {
    const { data, error } = await c.from('events').insert({ slug: makeSlug(x.cfg.title), config, published: !!publish }).select('id,slug,published').single();
    if (!error) return done(data, data.published);
    if (error.code !== '23505') throw error;
  }
  throw new Error('Could not pick a free link. Try again.');
}
const openPid = () => (B && $('.builder') ? B.pid : null);
// builder autosave to the account: ~2 s after the last change (the device copy is already saved)
function acctPushSoon() { if (!B) return; clearTimeout(B.pushT); B.pushT = setTimeout(acctPushNow, 2000); }
function acctPushNow() {
  if (!B) return Promise.resolve(); clearTimeout(B.pushT); B.pushT = null;
  const pid = B.pid, seq = B.seq || 0; LS.set('draft', B.cfg); pageSave(pid, { cfg: B.cfg });
  if (!acctOn()) { if (openPid() === pid) saveStatus('saved'); return Promise.resolve(); }
  return acctSave(pid).then((h) => { if (openPid() === pid) vnSync(); if (openPid() === pid && (B.seq || 0) === seq && !B.pushT) { saveStatus(h ? 'saved' : 'local'); renderHostNote(); } })
    .catch(() => { if (openPid() === pid && (B.seq || 0) === seq) saveStatus('local'); });
}
// leaving the builder or the app: don't wait out the 2 s
addEventListener('pagehide', () => { if (B && B.pushT) acctPushNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && B && B.pushT) acctPushNow(); });
addEventListener('online', () => { if (openPid() && acctOn()) acctPushNow(); acctSyncAll(); });
// every open (and right after sign-in): upload this device's pages, bring in the account's pages from elsewhere
let acctSyncing = null;
function acctSyncAll() {
  if (!acctOn()) return Promise.resolve(false);
  return acctSyncing || (acctSyncing = acctSyncRun().catch(() => false).finally(() => { acctSyncing = null; }));
}
async function acctSyncRun() {
  const user = await sbUser(); if (!user) { LS.del('signedIn'); return false; }
  const c = await sb();
  let { data: rows, error } = await c.from('events').select('id,slug,config,published,updated_at').eq('owner', user.id).order('updated_at', { ascending: false }).limit(1000);
  if (error || !Array.isArray(rows)) return false;
  const complete = rows.length < 1000; // only a full list can say a page was deleted elsewhere
  let moved = false;
  // pages deleted on this device while signed out (or while a delete couldn't reach the account): delete them now, own rows only
  const gone = goneGet();
  for (const r of rows.filter(r => gone.ids.includes(r.id))) { const { error: de } = await c.from('events').delete().eq('id', r.id).eq('owner', user.id); if (!de) moved = true; }
  rows = rows.filter(r => !gone.ids.includes(r.id));
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const x of pagesAll()) {
    if (openPid() === x.pid) continue; // the page open in the builder saves itself
    if (pageGone({ pid: x.pid, id: x.hosted && x.hosted.id, ek: x.cfg && x.cfg.ek })) { pageRemove(x.pid); moved = true; continue; } // a copy of a deleted page
    if (x.hosted && x.hosted.id) {
      const r = byId.get(x.hosted.id);
      if (!r) { if (complete && x.hosted.owner === user.id) { pageRemove(x.pid); moved = true; } continue; } // deleted from the account elsewhere
      const rt = Date.parse(r.updated_at) || 0, pub = !!r.published;
      if ((x.edited || 0) > rt + 1000) { await acctSave(x.pid).catch(() => {}); moved = true; } // edited here while offline
      else if (builderHash(r.config) !== builderHash(x.cfg)) { pageSave(x.pid, { cfg: normalize(r.config), edited: rt, hosted: { ...x.hosted, owner: user.id, pub } }); moved = true; }
      else if (x.hosted.pub !== pub || x.hosted.owner !== user.id) pageSave(x.pid, { hosted: { ...x.hosted, owner: user.id, pub } });
      continue;
    }
    if (x.cfg && String(x.cfg.title || '').trim()) { await acctSave(x.pid).catch(() => {}); moved = true; }
  }
  const have = new Set(pagesAll().filter(x => x.hosted).map(x => x.hosted.id));
  rows.filter(r => !have.has(r.id)).reverse().forEach(r => { pageSave(newPid(), { cfg: normalize(r.config), hosted: { id: r.id, slug: r.slug, owner: user.id, pub: !!r.published }, edited: Date.parse(r.updated_at) || 0 }); moved = true; });
  if (await pnSyncOwn(c).catch(() => false)) moved = true;
  if (moved) dispatchEvent(new Event('ep-pages'));
  return true;
}
// the names of this device's hosted pages (owner / co-planner: RLS gives only those rows) → their links show 1linktrip.com/<name>
async function pnSyncOwn(c) {
  const hs = pagesAll().filter(x => x.hosted && x.hosted.id && x.hosted.slug).map(x => x.hosted).slice(0, 200); if (!hs.length) return false;
  const { data, error } = await c.from('page_names').select('name,event_id').eq('is_current', true).in('event_id', hs.map(h => h.id));
  if (error || !Array.isArray(data)) return false;
  const by = new Map(data.map(r => [r.event_id, r.name])); const m = pnGet(); const was = JSON.stringify(m.s);
  hs.forEach(h => { const n = by.get(h.id); if (typeof n === 'string' && NAME_RE.test(n)) { m.s[h.slug] = n; m.n[n] = h.slug; } else delete m.s[h.slug]; });
  LS.set('pn', m); return JSON.stringify(m.s) !== was;
}
// "Save to My pages" on a long (#e=) link: the page joins the account (its organizer's own page keeps its link public
// and gets the short link; anyone else gets their own copy, not shared until they Share), then opens at the short link
async function saveLongToMine(packed, btn) {
  const cfg = unpackEvent(packed); if (!cfg) return;
  let user = null; try { user = await sbUser(); } catch { /* below */ }
  if (!user) { LS.del('signedIn'); return signInDlg('Sign in to save', () => LS.set('pendingSave', { packed })); }
  if (btn) btn.disabled = true;
  try {
    const own = ownLongPage(cfg, packed); let pid = own && own.pid;
    if (!pid) { const c = clone(cfg); delete c.demoTrip; if (!c.ek) c.ek = eventKey(c); pid = newPid(); pageSave(pid, { cfg: c, url: location.href, edited: 0 }); }
    const h = await acctSave(pid, { publish: !!own });
    if (!h) throw new Error('Couldn’t save this page.');
    location.href = shortURL(h.slug);
  } catch (e) { if (btn) btn.disabled = false; toast(t('Couldn’t save:') + ' ' + pubWhy(e)); }
}
function signInDlg(title, before) {
  let d = $('#sidlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'sidlg'; d.className = 'confirm-dlg'; document.body.appendChild(d); }
  d.innerHTML = `<form class="cf-in" onsubmit="return false"><h2>${esc(title)}</h2>${signInFormHTML('', LS.get('signinEmail') || '')}<div class="btns cf-b"><button type="button" class="btn ghost" data-si-close>${t('Close')}</button></div></form>`;
  d.onclick = (e) => {
    if (e.target === d || e.target.closest('[data-si-close]')) { d.close(); return; }
    const b = e.target.closest('[data-si],[data-si-oauth]'); if (!b) return;
    if (b.dataset.siOauth) oauthSignIn(b.dataset.siOauth, before);
    if (b.dataset.si === 'send') signInSubmit(d, before);
    if (b.dataset.si === 'retry') signInDlg(title, before);
  };
  d.onkeydown = (e) => { if (e.target.id === 'si-email' && e.key === 'Enter') { e.preventDefault(); signInSubmit(d, before); } };
  if (!d.open) d.showModal();
}
const longBtn = () => `<button type="button" class="link" data-ph="long">${t('Share without signing in')}</button>`;
// The long link has no RSVP form, guest messages or live updates (they go through the account, so only the short link
// has them): when the page has any of them on, say so before that link is shared, with the way to the short link.
function longGaps() {
  const c = B.cfg; if (!SB || (B.hosted && B.hosted.pub && B.hosted.slug)) return ''; // no hosting, or a short link exists
  const g = []; if (rsvpOf(c).on && rsvpOf(c).via === 'form') g.push(t('RSVP form')); if (c.guestMessages) g.push(t('guest messages')); if (!g.length) return '';
  return t('{g} or live updates', { g: g.join(', ') });
}
function longNoteHTML(full) {
  const g = longGaps(); if (!g) return '';
  if (!full) return `<small class="long-note muted" data-long-note>${esc(t('That link has no {g}, and won’t show later edits.', { g }))}</small>`;
  return `<div class="long-note" data-long-note role="note"><p><b>${esc(t('This link has no {g}.', { g }))}</b> ${t('Replies and updates go through your account, so only the short link has them.')}</p><button type="button" class="btn primary sm" data-ph="go">${t('Sign in for the short link')}</button></div>`;
}
function pubHostHTML() {
  const P = B.pub || {};
  if (!SB) return '';
  if (P.state === 'busy') return `<div class="pub-host" role="status"><p><b>${t('Getting your link…')}</b></p></div>`;
  if (P.state === 'done') return `<div class="pub-host ok"><p>${t('Your edits show up on this link automatically.')} <a href="#mine">${t('Replies in My pages')}</a></p>${B.hosted ? pnEditHTML(B.hosted, !pnName(B.hosted.slug) && !!B.pnSug) : ''}</div>`;
  if (P.state === 'signin') return `<div class="pub-host"><p><b>${t('Sign in to share')}</b></p>${signInFormHTML(P.msg, LS.get('signinEmail') || '')}<p class="pub-alt">${longBtn()}<br>${longNoteHTML(false) || `<small class="muted">${t('That link won’t show later edits.')}</small>`}</p></div>`;
  if (P.state === 'long') return `<div class="pub-host">${longNoteHTML(true)}<p class="muted small">${t('This link won’t show later edits.')}</p></div>`;
  return `<div class="pub-host" role="alert"><p><b>${t('Couldn’t share.')}</b> ${esc(P.msg || '')}</p><button type="button" class="btn primary" data-ph="go">${t('Try again')}</button><p class="pub-alt">${longBtn()}${longNoteHTML(false) ? '<br>' + longNoteHTML(false) : ''}</p></div>`;
}
// ---------- the page's name: https://1linktrip.com/<name> (publish dialog + Settings) ----------
// Sharing a page for the first time gives it a name made from its title (japan-trip, else japan-trip-2026, -2, -3); a page
// that was shared before gets the same name offered, not taken. Change it any time: the old name keeps opening the page.
const PN_MSG = { ok: 'Available', yours: 'This is the page’s link now', alias: 'An earlier link of this page. You can use it again.',
  taken: 'Taken. Try another.', reserved: 'That name is reserved. Try another.', invalid: 'Use 3–40 letters, numbers or hyphens.' };
const pnPrefix = () => location.host + APP_ROOT;
function pnBase(cfg) { let b = nameClean(cfg && cfg.title).replace(/-+$/, '').slice(0, 34).replace(/-+$/, ''); if (b.length < 3) b = b ? b + '-page' : ''; return b; }
async function pnSuggest(c, cfg, eid) {
  const b = pnBase(cfg); if (!b) return ''; const y = String((cfg && cfg.start) || '').slice(0, 4);
  for (const n of [b, /^\d{4}$/.test(y) && !b.includes(y) ? b + '-' + y : '', b + '-2', b + '-3'].filter(Boolean)) {
    if (nameProblem(n)) continue;
    const { data, error } = await c.rpc('page_name_check', { nm: n, eid }); if (error) return '';
    if (data === 'ok' || data === 'alias') return n;
  }
  return '';
}
async function pnAfterPublish(h, first) {
  try {
    const c = await sb();
    const { data, error } = await c.from('page_names').select('name').eq('event_id', h.id).eq('is_current', true).limit(1);
    if (error) return; // names not set up on this database
    if (Array.isArray(data) && data[0] && NAME_RE.test(data[0].name)) { pnRemember('', h.slug, data[0].name); return; }
    const sug = await pnSuggest(c, B.cfg, h.id); if (!sug) return;
    if (first) { const { data: nm, error: e2 } = await c.rpc('page_name_set', { eid: h.id, nm: sug }); if (!e2 && typeof nm === 'string' && NAME_RE.test(nm)) { pnRemember('', h.slug, nm); return; } }
    B.pnSug = sug;
  } catch { /* the ?e= link works without a name */ }
}
// open: the field is showing. A page without a name shows it straight away (with the offered name)
function pnEditHTML(h, open) {
  const cur = pnName(h.slug); const val = cur || (B && B.pnSug) || '';
  if (!open) return `<div class="pn" data-pn data-pn-eid="${esc(h.id)}" data-pn-slug="${esc(h.slug)}"><p class="pn-cur">${cur ? `${t('Link name:')} <b>${esc(pnPrefix())}${esc(cur)}</b> <button type="button" class="link" data-pn-open>${t('Change')}</button>` : `<button type="button" class="link" data-pn-open>${t('Choose a link name:')} ${esc(pnPrefix())}…</button>`}</p></div>`;
  return `<div class="pn open" data-pn data-pn-eid="${esc(h.id)}" data-pn-slug="${esc(h.slug)}"><label for="pn-in-${esc(h.slug)}">${t(cur ? 'Change the link' : 'Choose a link name')}</label>
    <div class="pn-row"><span class="pn-pre" aria-hidden="true">${esc(pnPrefix())}</span><input id="pn-in-${esc(h.slug)}" data-pn-in value="${esc(val)}" maxlength="40" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" inputmode="url" aria-describedby="pn-st-${esc(h.slug)}"><button type="button" class="btn sm primary" data-pn-save disabled>${t(cur ? 'Save' : 'Use this link')}</button>${cur ? `<button type="button" class="btn sm ghost" data-pn-cancel>${t('Cancel')}</button>` : ''}</div>
    <small class="pn-st muted" id="pn-st-${esc(h.slug)}" data-pn-st role="status" aria-live="polite">${cur ? t('Old links keep working.') : ''}</small></div>`;
}
const pnCheck = debounce(async (box) => {
  const inp = box.querySelector('[data-pn-in]'), st = box.querySelector('[data-pn-st]'), btn = box.querySelector('[data-pn-save]'); if (!inp) return;
  const n = inp.value; const seq = box._seq = (box._seq || 0) + 1;
  const put = (k) => { if (box._seq !== seq) return; st.textContent = PN_MSG[k] ? t(PN_MSG[k]) : ''; st.dataset.k = k; btn.disabled = !(k === 'ok' || k === 'alias'); };
  if (!n) { st.textContent = ''; btn.disabled = true; return; }
  const bad = nameProblem(n); if (bad) return put(bad);
  st.textContent = t('Checking…'); st.dataset.k = ''; btn.disabled = true;
  try { const c = await sb(); const { data, error } = await c.rpc('page_name_check', { nm: n, eid: box.dataset.pnEid }); if (error) throw error; put(String(data)); }
  catch (e) { if (box._seq === seq) { st.textContent = t(navigator.onLine === false ? 'You’re offline.' : 'Couldn’t check that name. Try again.'); st.dataset.k = ''; } }
}, 300);
// an open field: check what's in it, or offer a name made from the title
async function pnFill(box) {
  const i = box && box.querySelector('[data-pn-in]'); if (!i) return;
  if (!i.value && B && B.cfg) { try { const sug = await pnSuggest(await sb(), B.cfg, box.dataset.pnEid); if (sug && !i.value) { B.pnSug = sug; i.value = sug; } } catch { /* type one */ } }
  if (i.value && !pnName(box.dataset.pnSlug)) pnCheck(box);
}
function pnRepaint(slug) {
  if (B && B.hosted && B.hosted.slug === slug) {
    if ($('#pub') && $('#pub').open && B.pub && B.pub.state === 'done') pubLink(shortURL(slug));
    renderHostNote();
  }
  $$('[data-pn]').forEach(box => { if (box.dataset.pnSlug === slug) box.outerHTML = pnEditHTML({ id: box.dataset.pnEid, slug }, false); });
}
function pnWire() {
  if (pnWire.on) return; pnWire.on = true;
  document.addEventListener('input', (e) => {
    const inp = e.target.closest && e.target.closest('[data-pn-in]'); if (!inp) return;
    const v = nameClean(inp.value); if (v !== inp.value) { const at = inp.selectionStart; inp.value = v; try { inp.setSelectionRange(Math.min(at, v.length), Math.min(at, v.length)); } catch {} }
    pnCheck(inp.closest('[data-pn]'));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest && e.target.closest('[data-pn-in]')) { e.preventDefault(); const b = e.target.closest('[data-pn]').querySelector('[data-pn-save]'); if (b && !b.disabled) b.click(); } });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('[data-pn-open],[data-pn-cancel],[data-pn-save]'); if (!b) return; e.preventDefault();
    const box = b.closest('[data-pn]'); const h = { id: box.dataset.pnEid, slug: box.dataset.pnSlug };
    if ('pnOpen' in b.dataset) { box.outerHTML = pnEditHTML(h, true); const i = document.getElementById('pn-in-' + h.slug); if (!i) return; i.focus(); i.select(); pnFill(i.closest('[data-pn]')); return; }
    if ('pnCancel' in b.dataset) { box.outerHTML = pnEditHTML(h, false); return; }
    const inp = box.querySelector('[data-pn-in]'), st = box.querySelector('[data-pn-st]'); const n = inp.value;
    if (nameProblem(n)) { st.textContent = t(PN_MSG[nameProblem(n)]); return; }
    b.disabled = true; st.textContent = t('Saving…');
    try {
      const c = await sb(); const { data, error } = await c.rpc('page_name_set', { eid: h.id, nm: n }); if (error) throw error;
      const had = pnName(h.slug); pnRemember(had, h.slug, data); if (B) B.pnSug = '';
      pnRepaint(h.slug); toast(t(had ? 'Link changed. The old link still works.' : 'Link saved')); dispatchEvent(new Event('ep-pages'));
    } catch (er) { b.disabled = false; st.textContent = navigator.onLine === false ? t('You’re offline.') : (er && er.message) || t('Couldn’t save. Try again.'); }
  });
}
function renderPubHost() { const box = $('#pub-host'); if (box) box.innerHTML = pubHostHTML(); }
const pubWhy = (e) => navigator.onLine === false ? t('You’re offline.') : (e && (e.message || e.error_description || e.details)) || t('Try again.');
async function hostNow() {
  if (!$('#pub').open) $('#pub').showModal();
  pubLink(null, 'Getting your link'); B.pub = { state: 'busy' }; renderPubHost();
  let user = null;
  try { user = await sbUser(); } catch (e) { const msg = pubWhy(e); toast(t('Couldn’t share:') + ' ' + msg); B.pub = { state: 'error', msg }; renderPubHost(); return; }
  if (!user) { LS.del('signedIn'); pubLink(null, 'Share your page'); B.pub = { state: 'signin' }; renderPubHost(); setTimeout(() => $('#si-email')?.focus(), 0); return; }
  LS.set('signedIn', true); clearTimeout(B.pushT); B.pushT = null; LS.set('draft', B.cfg); pageSave(B.pid, { cfg: B.cfg });
  const first = !(B.hosted && B.hosted.pub); // sharing for the first time: the page gets a name made from its title
  try {
    const h = await acctSave(B.pid, { publish: true, fetchOsm: true });
    if (!h) throw new Error(t('This page belongs to another account. Edit a copy to share it.'));
    await pnAfterPublish(h, first);
    const url = shortURL(h.slug); pubLink(url, 'Your link');
    B.pub = { state: 'done' }; renderPubHost(); renderHostNote(); saveStatus('saved'); pnFill($('#pub [data-pn].open'));
    { const sg = $('#pub [data-pub-seg]'), sb2 = $('#pub [data-pub-sub]'); if (sg) sg.hidden = false; if (sb2) sb2.hidden = false; } // Invite guests | Share my trip
  } catch (e) { const msg = pubWhy(e); toast(t('Couldn’t share:') + ' ' + msg); pubLink(null, 'Share your page'); B.pub = { state: 'error', msg }; renderPubHost(); }
}
function wirePubHost() {
  const dlg = $('#pub'); if (!dlg || dlg._host) return; dlg._host = true;
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ph],[data-si],[data-si-oauth]'); if (!b) return;
    if (b.dataset.siOauth) oauthSignIn(b.dataset.siOauth, () => LS.set('pendingPublish', { cfg: B.cfg, hosted: B.hosted }));
    if (b.dataset.ph === 'go') hostNow();
    if (b.dataset.ph === 'long') shareLong();
    if (b.dataset.si === 'send') signInSubmit(dlg, () => LS.set('pendingPublish', { cfg: B.cfg, hosted: B.hosted }));
    if (b.dataset.si === 'retry') { B.pub = { state: 'signin' }; renderPubHost(); }
  });
  dlg.addEventListener('keydown', (e) => { if (e.target.id === 'si-email' && e.key === 'Enter') { e.preventDefault(); signInSubmit(dlg, () => LS.set('pendingPublish', { cfg: B.cfg, hosted: B.hosted })); } });
}
// a shared page: its link, at the top of the form
function renderHostNote() {
  const f = $('.b-form'); if (!f || !B) return; let n = $('.b-host', f);
  if (!B.hosted || !B.hosted.pub) { if (n) n.remove(); return; }
  const html = `<div class="b-note b-host"><p>${t('Your link:')} <a href="${esc(shortURL(B.hosted.slug))}" target="_blank" rel="noopener noreferrer">${esc(linkText(B.hosted.slug))}</a> · <a href="#mine">${t('My pages')}</a></p>${SB ? pnEditHTML(B.hosted, false) : ''}</div>`;
  if (n) { if (n.querySelector('[data-pn].open') && n.contains(document.activeElement)) return; n.outerHTML = html; } else f.insertAdjacentHTML('afterbegin', html);
}

// ---------- organizer: My pages, replies, updates ----------
async function renderMine(id, notice) {
  LANG = uiLang(); document.documentElement.lang = LANG; document.documentElement.dir = 'ltr'; document.title = t('My pages') + ' · 1LinkTrip';
  const shell = (inner) => { $('#app').innerHTML = `<main class="mine"><header class="land-top"><a class="brand" href="#">${BRAND}</a><nav class="mine-nav"><a href="#mine">${t('My pages')}</a><a class="btn sm primary" href="#setup">${t('New page')}</a></nav></header><div class="mine-in">${notice ? `<p class="b-note">${esc(notice)}</p>` : ''}${inner}</div></main>`; };
  if (!SB) return shell('<h1>Hosting isn’t set up</h1>');
  shell('<p class="muted">Loading…</p>');
  let user = null;
  try { user = await sbUser(); } catch (e) { return shell(`<h1>${t('My pages')}</h1><p>${esc(e.message)}</p>`); }
  if (!user) {
    LS.del('signedIn');
    shell(`<h1>${t('My pages')}</h1><p class="lede">${t('Sign in to see your short links, RSVPs and updates.')}</p>${signInFormHTML('', LS.get('signinEmail') || '')}`);
    const m = $('.mine'); m.addEventListener('click', (e) => { const b = e.target.closest('[data-si],[data-si-oauth]'); if (!b) return; if (b.dataset.siOauth) { oauthSignIn(b.dataset.siOauth); return; } if (b.dataset.si === 'send') signInSubmit(m); if (b.dataset.si === 'retry') renderMine(id); });
    m.addEventListener('keydown', (e) => { if (e.target.id === 'si-email' && e.key === 'Enter') { e.preventDefault(); signInSubmit(m); } });
    return;
  }
  LS.set('signedIn', true);
  const c = await sb();
  if (id) return renderMineEvent(id, shell, c, user);
  await acctSyncAll(); // pages made on this device (or before signing in) are on the account before the list loads
  const { data, error } = await c.from('events').select('id,slug,config,published,updated_at').eq('owner', user.id).order('updated_at', { ascending: false });
  if (error) return shell(`<h1>${t('My pages')}</h1><p>${t('Couldn’t load your pages.')} ${esc(error.message)}</p>`);
  shell(`<div class="mine-h"><h1>${t('My pages')}</h1><span class="muted small">${esc(user.email || '')} · <button type="button" class="link" data-mine="signout">${t('Sign out')}</button></span></div>
    <section data-slot="mine-inbox"></section>
    ${data.length ? `<ul class="mine-list">${data.map(r => { const cfg = spanFixed(normalize(r.config)); return `<li><div><b>${esc(cfg.title || t('Untitled'))}</b><span>${esc(cfg.start ? dateRange(cfg.start, cfg.end) : '')}${r.published ? '' : ' · ' + t('not shared')}</span>${r.published ? `<a class="mono small" href="${esc(shortURL(r.slug))}" target="_blank" rel="noopener noreferrer">${esc(linkText(r.slug))}</a>` : ''}</div><div class="btns"><button type="button" class="btn sm primary" data-mine-edit="${esc(r.id)}">${t('Open')}</button><a class="btn sm" href="#mine/${esc(r.id)}">${t('Replies and updates')}</a>${r.published ? `<button type="button" class="btn sm ghost" data-mine-copy="${esc(r.slug)}">${t('Copy link')}</button>` : ''}<button type="button" class="btn sm ghost" data-mine-del="${esc(r.id)}" aria-label="${esc(t('Delete {n}', { n: cfg.title || t('Untitled') }))}">${t('Delete')}</button></div></li>`; }).join('')}</ul>` : `<p class="lede">${t('No short links yet. Make a page, tap Share, then Get a short link.')}</p><a class="btn primary" href="#setup">${t('Make a page')}</a>`}`);
  mineInbox(c, data).catch(() => {});
  if (data.length) msgReady().then(async ok => { // "2 new" next to pages with unanswered guest messages
    if (!ok) return; const { data: ms } = await c.from('event_messages').select('event_id,guest,from_host,created_at').in('event_id', data.map(x => x.id)).order('created_at', { ascending: true }).limit(5000);
    data.forEach(ev => { const seen = LS.get('inboxSeen:' + ev.id, {}) || {}; const last = new Map(); (ms || []).filter(x => x.event_id === ev.id).forEach(x => last.set(x.guest, x));
      const n = [...last.values()].filter(x => !x.from_host && x.created_at > (seen[x.guest] || '')).length;
      const a = n && $(`.mine-list a[href="#mine/${CSS.escape(ev.id)}"]`); if (a) a.insertAdjacentHTML('beforeend', ` <span class="badge">${esc(t('{n} new', { n }))}</span>`); });
  }).catch(() => {});
  $('.mine').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mine === 'signout') { await c.auth.signOut(); LS.del('signedIn'); LS.del('draftHosted'); location.hash = '#'; }
    if (b.dataset.mineCopy) copy(shortURL(b.dataset.mineCopy));
    if (b.dataset.mineDel) {
      const r = data.find(x => x.id === b.dataset.mineDel); if (!r) return; const name = normalize(r.config).title || t('Untitled');
      if (!await confirmDlg({ title: t('Delete “{n}”?', { n: name }), body: t(r.published ? 'It’s removed from your account on every device, its link stops working, and its replies and updates are deleted too.' : 'It’s removed from your account on every device and its replies and updates are deleted too.'), ok: t('Delete') })) return;
      b.disabled = true;
      try { await pageDelete({ id: r.id }); } catch (err) { b.disabled = false; toast(t('Couldn’t delete:') + ' ' + pubWhy(err)); return; }
      await renderMine(''); toast(t('Deleted “{n}”', { n: name }));
    }
    if (b.dataset.mineEdit) { const r = data.find(x => x.id === b.dataset.mineEdit); const cfg = normalize(r.config); const ex = pagesAll().find(x => x.hosted && x.hosted.id === r.id); LS.set('draft', cfg); LS.set('draftHosted', { id: r.id, slug: r.slug, owner: user.id, pub: !!r.published }); LS.set('draftId', ex ? ex.pid : newPid()); location.hash = '#new'; }
  });
}
// a change made to the account row from My pages (messages on, translated updates) goes into this device's copy too,
// so the next autosave keeps it
function devPatchHosted(id, patch) { const x = pagesAll().find(p => p.hosted && p.hosted.id === id); if (x) pageSave(x.pid, { cfg: { ...x.cfg, ...patch }, edited: x.edited || 0 }); }
let mineOpenThr = [];
const guestListKey = (id) => 'guests:' + id;
function parseGuestList(text) {
  const rows = String(text || '').split(/\r?\n/).map(l => l.split(/[,;\t]/).map(x => x.replace(/^"|"$/g, '').trim())).filter(r => r.some(Boolean));
  if (!rows.length) return [];
  const head = rows[0].map(h => h.toLowerCase()); const ni = head.findIndex(h => /name/.test(h)), ei = head.findIndex(h => /e-?mail/.test(h));
  const body = ni >= 0 || ei >= 0 ? rows.slice(1) : rows;
  return body.map(r => { const email = (ei >= 0 ? r[ei] : r.find(x => /@/.test(x))) || ''; const name = ni >= 0 ? r[ni] : (r.find(x => x && !/@/.test(x)) || ''); return { name: name.slice(0, 120), email: email.toLowerCase().slice(0, 254) }; }).filter(g => g.name || g.email);
}
const normName = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function notReplied(guests, rsvps) {
  const names = new Set(rsvps.map(r => normName(r.name))), emails = new Set(rsvps.map(r => (r.email || '').toLowerCase()).filter(Boolean));
  return guests.filter(g => !(g.email && emails.has(g.email)) && !(g.name && names.has(normName(g.name))));
}
// replies view: a column for each RSVP question some reply answered → [key, header, cell text]
function rqReplyCols(cfg, replies) {
  const q = cfg.rsvpq || {}; const has = (k) => replies.some(x => x.x[k] != null);
  const party = (x) => (x.x.plus || []).map((n, k) => { const m = (x.x.pmeal || [])[k]; return n && m ? `${n} (${m})` : n || (m ? `Guest ${k + 2} (${m})` : ''); }).filter(Boolean).join(', ');
  return [['meal', 'Meal', (x) => x.x.meal || ''], ['diet', 'Dietary needs', (x) => x.x.diet || ''], ['plus', 'Party names', party],
    ['events', 'Events', (x) => (Array.isArray(x.x.events) ? (x.x.events.length ? x.x.events.join(', ') : 'None') : '')],
    ['q1', (q.q || [])[0] || 'Question 1', (x) => x.x.q1 || ''], ['q2', (q.q || [])[1] || 'Question 2', (x) => x.x.q2 || '']].filter(c => has(c[0]));
}
// headcounts by meal (the guest's and their party's) and by event (each reply's party)
function rqSummary(yes) {
  const meals = new Map(), evs = new Map(); const add = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
  yes.forEach(x => { if (x.x.meal) add(meals, x.x.meal, 1); (x.x.pmeal || []).forEach(m => { if (m) add(meals, m, 1); }); (Array.isArray(x.x.events) ? x.x.events : []).forEach(e => add(evs, e, x.guests || 1)); });
  const line = (l, m) => (m.size ? `<p class="rs-sum2 small"><b>${l}</b> ${[...m].map(([k, n]) => `${esc(k)} <b>${n}</b>`).join(' · ')}</p>` : '');
  return line('Meals:', meals) + line('Events:', evs);
}
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
async function renderMineEvent(id, shell, c, user) {
  const ev = await c.from('events').select('id,slug,config,published').eq('id', id).maybeSingle();
  if (ev.error || !ev.data) return shell(`<h1>${t('Page not found')}</h1><p><a href="#mine">${t('Back to My pages')}</a></p>`);
  const r = ev.data; const cfg = normalize(r.config);
  const ready = await msgReady(); // messages and groups (schema-3): sections stay out until it is installed
  const [rs, an, ms, grp] = await Promise.all([c.from('rsvps').select('id,name,email,attending,guests,note,created_at' + (ready ? ',group_id' : '')).eq('event_id', id).order('created_at', { ascending: true }),
    c.from('announcements').select('id,body,created_at' + (ready ? ',group_ids' : '')).eq('event_id', id).order('created_at', { ascending: false }),
    ready ? c.from('event_messages').select('id,guest,from_host,guest_name,guest_email,body,created_at').eq('event_id', id).order('created_at', { ascending: true }).limit(2000) : null,
    ready ? loadGroups(c, id).catch(() => null) : null]);
  const msgs = ms && !ms.error ? ms.data || [] : null; const groups = grp || []; const gName = (gid) => (groups.find(g => g.id === gid) || {}).name || '';
  const seenKey = 'inboxSeen:' + id; const seen = LS.get(seenKey, {}) || {};
  // one row per guest: a later reply from the same name or email replaces the earlier one
  const latest = new Map(); (rs.data || []).forEach(x => latest.set((x.email || '').toLowerCase() || normName(x.name), x));
  const replies = [...latest.values()].reverse().map(x => { const p = rqParse(x.note); return { ...x, note: p.text, x: p.x || {} }; }); const yes = replies.filter(x => x.attending); const no = replies.filter(x => !x.attending);
  const RQ = rqReplyCols(cfg, replies); const rqSum = rqSummary(yes);
  const guests = LS.get(guestListKey(id), []) || []; const waiting = notReplied(guests, replies);
  shell(`<p><a href="#mine">${t('← My pages')}</a></p><div class="mine-h"><h1>${esc(cfg.title || t('Untitled'))}</h1><a class="mono small" href="${esc(shortURL(r.slug))}" target="_blank" rel="noopener noreferrer">${esc(linkText(r.slug))}</a></div>
    ${msgs ? `<section class="mine-sec" id="mine-msgs"><h2>${t('Messages')}</h2><label class="tool gm-on"><input type="checkbox" data-gm-on ${cfg.guestMessages ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${t('Let guests message you')}</label>${inboxHTML(msgs, seen)}</section>` : ''}
    <section class="mine-sec"><h2>${t('Updates')}</h2><p class="muted small">${t('Guests see these at the top of your page.')}</p>
      <form class="ann-form" onsubmit="return false"><textarea id="an-body" rows="3" maxlength="2000" placeholder="${t('Shuttle leaves the hotel at 4:30. Bring a jacket.')}"></textarea>${msgs ? sendToHTML(groups) : ''}<div class="btns"><button type="button" class="btn primary" data-an="post">${t('Post update')}</button></div><p class="hint" role="status" aria-live="polite"></p></form>
      <ul class="ann-list own">${(an.data || []).map(a => `<li><time>${esc(fmtStamp(a.created_at))}${(a.group_ids || []).length ? ' · ' + esc(t('Send to')) + ': ' + esc(a.group_ids.map(gName).filter(Boolean).join(', ')) : ''}</time><p>${esc(a.body)}</p><button type="button" class="link" data-an-del="${esc(a.id)}">${t('Delete')}</button></li>`).join('')}</ul></section>
    <section class="mine-sec"><h2>${t('Replies')}</h2>
      <p class="rs-sum"><b>${yes.reduce((n, x) => n + (x.guests || 1), 0)}</b> ${t('coming')} <span class="muted">(${esc(t(yes.length === 1 ? '1 reply' : '{n} replies', { n: yes.length }))})</span> · <b>${no.length}</b> ${t('can’t make it')}${guests.length ? ` · ${esc(t('{w} of {n} on your list haven’t replied', { w: waiting.length, n: guests.length }))}` : ''}</p>${rqSum}
      ${replies.length ? `<div class="tbl-wrap"><table class="rs-tbl"><thead><tr><th>${t('Name')}</th><th>${t('Reply')}</th><th>${t('Party')}</th>${groups.length ? `<th>${t('Group')}</th>` : ''}${RQ.map(c => `<th data-rq-col="${c[0]}">${esc(c[1])}</th>`).join('')}<th>${t('Email')}</th><th>${t('Note')}</th></tr></thead><tbody>${replies.map(x => `<tr><td>${esc(x.name)}</td><td>${x.attending ? 'Coming' : 'Can’t make it'}</td><td>${x.attending ? esc(x.guests) : '–'}</td>${groups.length ? `<td>${esc(gName(x.group_id))}</td>` : ''}${RQ.map(c => `<td data-rq-col="${c[0]}">${esc(c[2](x))}</td>`).join('')}<td>${esc(x.email || '')}</td><td data-note-id="${esc(x.id)}">${esc(x.note || '')}</td></tr>`).join('')}</tbody></table></div><div class="btns"><button type="button" class="btn sm" data-rs="csv">${t('Download CSV')}</button></div>` : '<p class="muted">No replies yet. Share your short link and they’ll show up here.</p>'}
      <h3 class="sub-h">${t('Guest list')}</h3><p class="muted small">${t('Import a CSV or paste names (one per line, optional email) to see who hasn’t replied. Your list stays on this device.')}</p>
      <div class="btns"><label class="btn sm file-btn">${t('Import CSV')}<input type="file" data-gl-file accept=".csv,.txt,text/csv,text/plain"></label>${guests.length ? '<button type="button" class="btn sm ghost" data-gl="clear">Clear list</button>' : ''}</div>
      <textarea id="gl-paste" rows="3" placeholder="Ana Ruiz, ana@example.com&#10;Ben Okafor"></textarea><div class="btns"><button type="button" class="btn sm" data-gl="add">${t('Add to list')}</button></div>
      ${guests.length ? `<h3 class="sub-h">${t('Haven’t replied')} (${waiting.length})</h3>${waiting.length ? `<ul class="gl-list">${waiting.map(g => `<li>${esc(g.name || g.email)}${g.name && g.email ? ` <span class="muted small">${esc(g.email)}</span>` : ''}</li>`).join('')}</ul>` : `<p class="muted">${t('Everyone on your list has replied.')}</p>`}` : ''}
    </section>
    ${msgs ? `<section class="mine-sec" id="mine-groups"><h2>${t('Groups')}</h2><div data-grp-root>${groupsEdHTML(groups)}</div></section>` : ''}
    <section class="mine-sec"><h2>${t('Page')}</h2><div class="btns"><button type="button" class="btn sm" data-pg="edit">${t('Open page')}</button><button type="button" class="btn sm ghost" data-pg="vis">${r.published ? 'Hide page' : 'Show page'}</button></div><p class="muted small">${r.published ? 'Anyone with the link can see it.' : 'Only you can see it.'}</p></section>`);
  const m = $('.mine'); const again = () => { mineOpenThr = [...$$('details.thr[open]', m)].map(d => d.dataset.thr); return renderMine(id); };
  if (msgs) {
    $$('details.thr', m).forEach(d => { if (mineOpenThr.includes(d.dataset.thr)) d.open = true; d.addEventListener('toggle', () => { if (!d.open) return; const xs = msgs.filter(x => x.guest === d.dataset.thr); const last = xs[xs.length - 1]; if (last) { seen[d.dataset.thr] = last.created_at; LS.set(seenKey, seen); d.querySelector('.dot')?.remove(); } }); });
    mineOpenThr = [];
    const gr = m.querySelector('[data-grp-root]'); if (gr) wireGroupsEd(gr, c, id, again);
    wireSendTo(m);
    m.addEventListener('change', async (e) => { if (e.target.dataset.gmOn == null) return; const on = e.target.checked; const { error } = await c.from('events').update({ config: { ...r.config, guestMessages: on } }).eq('id', id); if (error) { e.target.checked = !on; toast(error.message); } else { r.config.guestMessages = on; devPatchHosted(id, { guestMessages: on }); toast(on ? t('Guests can message you') : t('Messages off')); } });
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-gm-send^="h-"]'); if (!b) return; const guest = b.dataset.gmSend.slice(2);
      const box = b.closest('details'); const ta = box.querySelector('textarea'); const hint = box.querySelector('[data-gm-msg]'); const body = (ta.value || '').trim().slice(0, 2000); if (!body) { ta.focus(); return; }
      b.disabled = true; hint.textContent = t('Sending…');
      const { data, error } = await c.from('event_messages').insert({ event_id: id, guest, from_host: true, body }).select('id').single();
      if (error) { b.disabled = false; hint.textContent = t('Couldn’t send. Try again.'); return; }
      notifyEmail('message', data.id); again();
    });
    // new messages show up while the page is open (every 30 s), unless the host is typing
    const n0 = msgs.length; const iv = setInterval(async () => {
      if (!document.body.contains(m)) return clearInterval(iv); if (document.hidden || $$('textarea', m).some(x => x.value.trim())) return;
      const { count } = await c.from('event_messages').select('id', { count: 'exact', head: true }).eq('event_id', id); if (count != null && count !== n0) { clearInterval(iv); again(); }
    }, 30000);
  }
  const notes = Object.fromEntries(replies.filter(x => x.note && x.note.trim().length > 1).map(x => [x.id, x.note]));
  if (Object.keys(notes).length && canTranslate()) translateForHost(notes).then(tr => { for (const [k, v] of Object.entries(tr)) { const td = m.querySelector(`[data-note-id="${CSS.escape(k)}"]`); if (td && v && v.trim() !== notes[k].trim()) td.insertAdjacentHTML('beforeend', `<div class="tr-note">↳ ${esc(v)}</div>`); } }).catch(() => {});
  const addGuests = (list) => { if (!list.length) { toast(t('No names found')); return; } const cur = LS.get(guestListKey(id), []) || []; const seen = new Set(cur.map(g => g.email || normName(g.name))); list.forEach(g => { const k = g.email || normName(g.name); if (!seen.has(k)) { seen.add(k); cur.push(g); } }); LS.set(guestListKey(id), cur); toast(t('{n} on your guest list', { n: cur.length })); again(); };
  m.addEventListener('change', (e) => { const i = e.target; if (i.dataset.glFile != null && i.files && i.files[0]) i.files[0].text().then(tx => addGuests(parseGuestList(tx))); });
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.an === 'post') {
      const body = $('#an-body').value.trim().slice(0, 2000); const hint = $('.ann-form .hint'); if (!body) { hint.textContent = t('Write something first.'); return; }
      const gids = msgs ? sendToIds(m) : []; // updates for chosen groups are never copied into the public page config (no stored translations)
      b.disabled = true; const { data: an0, error } = await c.from('announcements').insert({ event_id: id, body, ...(gids.length ? { group_ids: gids } : {}) }).select('id').single(); if (error) { b.disabled = false; hint.textContent = t('Couldn’t post:') + ' ' + error.message; return; }
      if (msgs && an0) notifyEmail('announcement', an0.id);
      const langs = (cfg.langs || []).filter(l => l !== srcLang(cfg));
      if (langs.length && canTranslate() && an0 && !gids.length) { hint.textContent = t('Translating for your guests…'); const raw = clone(r.config); raw.tr = raw.tr || {};
        for (const l of langs) { try { const j = await aiImport({ mode: 'translate', fields: { ['ann.' + an0.id]: body }, target: l, source: srcLang(cfg) }); const x = ((j.data && j.data.translations) || [])[0]; if (x) { raw.tr[l] = raw.tr[l] || {}; raw.tr[l]['ann.' + an0.id] = { h: hashStr(body), t: x.text }; } } catch { /* post stays in the original language */ } }
        await c.from('events').update({ config: raw }).eq('id', id); devPatchHosted(id, { tr: raw.tr }); }
      again();
    }
    if (d.anDel && confirm(t('Delete this update?'))) { await c.from('announcements').delete().eq('id', d.anDel); again(); }
    if (d.rs === 'csv') {
      const lines = [['Name', 'Reply', 'Party', ...RQ.map(c => c[1]), 'Email', 'Note', 'Sent']].concat(replies.map(x => [x.name, x.attending ? 'Coming' : 'Can’t make it', x.attending ? x.guests : 0, ...RQ.map(c => c[2](x)), x.email || '', x.note || '', x.created_at]));
      const blob = new Blob(['﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (cfg.title || 'event').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '-replies.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    if (d.gl === 'add') addGuests(parseGuestList($('#gl-paste').value));
    if (d.gl === 'clear' && confirm(t('Clear your guest list on this device?'))) { LS.del(guestListKey(id)); again(); }
    if (d.pg === 'edit') { const ex = pagesAll().find(x => x.hosted && x.hosted.id === r.id); LS.set('draft', cfg); LS.set('draftHosted', { id: r.id, slug: r.slug, owner: user.id, pub: !!r.published }); LS.set('draftId', ex ? ex.pid : newPid()); location.hash = '#new'; }
    if (d.pg === 'vis') { await c.from('events').update({ published: !r.published }).eq('id', id); const ex = pagesAll().find(x => x.hosted && x.hosted.id === id); if (ex) pageSave(ex.pid, { hosted: { ...ex.hosted, pub: !r.published } }); again(); }
  });
}

// ================= phase D: in-app Nearby places with filters (OpenStreetMap data) =================
// Guests browse and filter here; they only leave the app to get directions, reserve, call, or visit the place's own site.
const PLACE_CATS = [['restaurant', 'Restaurants'], ['cafe', 'Cafés'], ['bar', 'Bars'], ['fast_food', 'Quick bites'], ['pharmacy', 'Pharmacies'], ['grocery', 'Groceries']];
const PLACE_ONE = { restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', fast_food: 'Quick bite', pharmacy: 'Pharmacy', grocery: 'Grocery', hotel: 'Hotel', sight: 'Sight' };
const DIETS = [['gluten_free', 'Gluten-free'], ['vegan', 'Vegan'], ['vegetarian', 'Vegetarian'], ['halal', 'Halal'], ['kosher', 'Kosher']];
const DISTS = [[0, 'Any distance'], [400, '5 min walk'], [800, '10 min walk'], [1200, '15 min walk']];
const isEatery = (k) => /^(restaurant|cafe|bar|fast_food)$/.test(k);
// OSM diet:* = yes | only | limited | no
const hasDiet = (p, k) => /^(yes|only|limited)$/.test((p.diet || {})[k] || '');

// ---- opening_hours: the common subset (day ranges, several time ranges, overnight, off, 24/7). Anything else → unknown ----
const OH_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
function ohOpenAt(spec, wall) {
  spec = String(spec || '').trim(); if (!spec) return null;
  if (/^24\/7$/.test(spec)) return true;
  const day = (wall.getUTCDay() + 6) % 7, prev = (day + 6) % 7, mins = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  let result = false;
  for (let rule of spec.split(/\s*;\s*/)) {
    rule = rule.trim(); if (!rule) continue;
    if (/^(PH|SH)\b/.test(rule)) continue; // holidays: ignore
    if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|week|easter|sunrise|sunset|dawn|dusk)\b|\[|"/.test(rule)) return null;
    const m = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/);
    if (!m) return null;
    const days = new Set();
    if (!m[1]) for (let i = 0; i < 7; i++) days.add(i);
    else for (const seg of m[1].split(',')) { const [a, b] = seg.split('-'); const ia = OH_DAYS.indexOf(a), ib = b ? OH_DAYS.indexOf(b) : ia; for (let i = ia, n = 0; n < 8; i = (i + 1) % 7, n++) { days.add(i); if (i === ib) break; } }
    const times = m[2].trim().replace(/^:\s*/, '');
    if (/^(off|closed)$/i.test(times)) { if (days.has(day)) result = false; continue; }
    const ranges = times.split(/\s*,\s*/).map(r => r.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/));
    if (!ranges.length || ranges.some(r => !r)) return null;
    let touched = false, open = false;
    for (const r of ranges) {
      const s = +r[1] * 60 + +r[2]; let e = +r[3] * 60 + +r[4]; if (e === 0) e = 1440;
      if (days.has(day)) { touched = true; if (e > s ? (mins >= s && mins < e) : mins >= s) open = true; }
      if (days.has(prev) && e <= s && mins < e) { touched = true; open = true; } // past midnight from yesterday
    }
    if (touched) result = open;
  }
  return result;
}
const venueNow = (cfg) => asUTC(utcToWall(new Date(), cfg.tz || 'UTC'));
const prettyHours = (spec) => String(spec || '').split(/\s*;\s*/).filter(Boolean).map(r => r.replace(/\bMo\b/g, 'Mon').replace(/\bTu\b/g, 'Tue').replace(/\bWe\b/g, 'Wed').replace(/\bTh\b/g, 'Thu').replace(/\bFr\b/g, 'Fri').replace(/\bSa\b/g, 'Sat').replace(/\bSu\b/g, 'Sun').replace(/,(?=[A-Z])/g, ', ').replace(/\boff\b/g, 'closed').replace(/(\d{1,2}):(\d{2})/g, (_, h, mm) => fmtTime(`${pad(+h % 24)}:${mm}`)));

// all browsable places from the classified OSM data
const placesMemo = new WeakMap(); // one set of place objects per data set, so Google matches stick to them
function allPlaces(data) {
  if (placesMemo.has(data)) return placesMemo.get(data);
  const r = placesOf(data); placesMemo.set(data, r); return r;
}
function placesOf(data) {
  const food = (data.food || []).map(p => ({ ...p, cat: p.kind === 'bar' || p.kind === 'pub' ? 'bar' : p.kind }));
  return food.concat((data.places || []).map(p => ({ ...p, cat: p.kind })));
}
const osmPlanPlace = (p) => ({ src: 'osm', ref: placeKey(p), name: p.name, lat: p.lat, lon: p.lon, rating: p.g ? p.g.rating : 0, count: p.g ? p.g.count : 0, addr: [p.street, p.city].filter(Boolean).join(', '), hours: p.hours || '', type: placeType([], p.cat) });
const placeKey = (p) => `${p.name}|${(+p.lat).toFixed(5)},${(+p.lon).toFixed(5)}`;
const cuisineList = (p) => (p.cuisines || String(p.cuisine || '').split(',')).map(x => String(x).trim().toLowerCase()).filter(Boolean);
const cuisineLabel = (c) => c.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());

function placeFilters(cfg, art) { return art._pf || (art._pf = { cat: 'restaurant', cuisine: '', diet: [], open: false, dist: 0, price: '', stars: 0, q: '' }); }
const placePrice = (p) => p.price || (p.g && p.g.price) || '';
const OSM_CC = { restaurant: 'restaurants', fast_food: 'restaurants', cafe: 'cafes', bar: 'bars', pub: 'bars', pharmacy: 'shopping', grocery: 'shopping', hotel: 'hotels', sight: 'sights' };
function filterPlaces(cfg, places, f) {
  const now = f.open ? venueNow(cfg) : null;
  return places.filter(p => (!f.cat || f.cat === 'all' || p.cat === f.cat)
    && (!f.q || lfMatch(f.q, p.name, cuisineList(p).join(' ')))
    && (!f.cuisine || cuisineList(p).includes(f.cuisine))
    && f.diet.every(k => hasDiet(p, k))
    && (!f.dist || p.d <= f.dist)
    && (!f.price || placePrice(p) === f.price)
    && (!f.stars || (p.g && p.g.rating >= f.stars))
    && (!now || ohOpenAt(p.hours, now) === true));
}
const pfActive = (f) => (f.cuisine ? 1 : 0) + f.diet.length + (f.open ? 1 : 0) + (f.dist ? 1 : 0) + (f.price ? 1 : 0) + (f.stars ? 1 : 0);
// the OpenStreetMap list's bar: City (when the trip has several) · Category (with counts) · Filters; its search filters by name
function placesBar(cfg, data, art, box) {
  const f = placeFilters(cfg, art); const all = allPlaces(data); const ss = ccCities(cfg);
  const counts = {}; all.forEach(p => counts[p.cat] = (counts[p.cat] || 0) + 1);
  const inCat = all.filter(p => f.cat === 'all' || p.cat === f.cat);
  const cuis = {}; inCat.forEach(p => cuisineList(p).forEach(c => { cuis[c] = (cuis[c] || 0) + 1; }));
  const cuisTop = Object.entries(cuis).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30);
  const prices = [...new Set(inCat.map(placePrice).filter(Boolean))].sort((a, b) => a.length - b.length);
  const rated = inCat.some(p => p.g && p.g.rating); const eat = isEatery(f.cat) || f.cat === 'all';
  const dietCount = (k) => inCat.filter(p => hasDiet(p, k)).length; const n = filterPlaces(cfg, all, f).length;
  const body = [
    eat && cuisTop.length ? `<div class="cc-g cc-sels"><label class="field"><span>${t('Cuisine')}</span><select data-pf="cuisine"><option value="">${t('Any cuisine')}</option>${cuisTop.map(([c, k]) => `<option value="${esc(c)}" ${f.cuisine === c ? 'selected' : ''}>${esc(cuisineLabel(c))} (${k})</option>`).join('')}</select></label></div>` : '',
    ccGroup(t('Hours'), ccChip(f.open, 'data-pf-open', esc(t('Open now')))),
    ccGroup(t('Distance'), DISTS.slice(1).map(([m, l]) => ccChip(+f.dist === m, `data-pf-dist="${m}"`, esc(t(l)))).join('')),
    rated ? ccGroup(t('Rating'), [4, 4.5].map(x => ccChip(f.stars === x, `data-pf-stars="${x}"`, `★ ${nfix(x, 1)}+`)).join('')) : '',
    eat ? ccGroup(t('Dietary'), DIETS.map(([k, l]) => { const c = dietCount(k); const on = f.diet.includes(k); return c || on ? ccChip(on, `data-pf-diet="${k}"`, `${esc(t(l))} <span>${c}</span>`) : ''; }).join('')) : '',
    prices.length > 1 ? ccGroup(t('Price'), prices.map(pr => ccChip(f.price === pr, `data-pf-price="${esc(pr)}"`, esc(pr))).join('')) : '',
  ].join('');
  const ps = [];
  if (f.cuisine) ps.push(['cuisine', cuisineLabel(f.cuisine)]); f.diet.forEach(k => ps.push(['diet:' + k, t((DIETS.find(x => x[0] === k) || [0, k])[1])]));
  if (f.open) ps.push(['open', t('Open now')]); if (f.dist) ps.push(['dist', t((DISTS.find(x => x[0] === +f.dist) || [0, ''])[1])]);
  if (f.stars) ps.push(['stars', `★ ${nfix(f.stars, 1)}+`]); if (f.price) ps.push(['price', f.price]);
  ccFill(box, {
    row: (ss.length ? ccTabs({ key: 'city', aria: t('City'), value: String(art._stop || 0), ph: t('City'), cls: 'dd-city', opts: ss.map(c => ({ v: String(c.i), l: c.l })) }) : '')
      + ccChips({ key: 'cat', aria: t('Category'), value: f.cat, ph: t('Category'), cls: 'dd-cat', opts: PLACE_CATS.filter(([k]) => counts[k] || f.cat === k).map(([k, l]) => ({ v: k, l: t(l), ic: OSM_CC[k], n: counts[k] || 0 })) }),
    filt: ccFiltersBtn(pfActive(f), false),
    pills: ccPills(ps, 'data-pf-clear'), sheet: ccSheet(body, n === 1 ? t('Show 1 place') : t('Show {n} places', { n }), 'data-pf-clear') });
}
function placesHTML(cfg, data, art) {
  const v = cfg.venue; const f = placeFilters(cfg, art); const all = allPlaces(data);
  if (!all.length) return `<p class="muted">${t('No restaurants, cafés or bars are mapped within 900 m of the venue.')}</p>${ext(L.place('restaurants', placeLabel(v)), t('Search on Google Maps'), 'btn')}`;
  const counts = {}; all.forEach(p => counts[p.cat] = (counts[p.cat] || 0) + 1);
  if (f.cat !== 'all' && !counts[f.cat]) f.cat = PLACE_CATS.find(([k]) => counts[k])?.[0] || 'all';
  const rated = all.some(p => p.g && p.g.rating);
  const list = filterPlaces(cfg, all, f); const now = venueNow(cfg); const active = pfActive(f) + (f.q ? 1 : 0);
  return `<p class="pf-count muted small" role="status" aria-live="polite">${esc(list.length === 1 ? t('1 place') : t('{n} places', { n: list.length }))}${active ? ` · <button type="button" class="link" data-pf-clear>${t('Clear filters')}</button>` : ''}</p>
  ${list.length ? `<ul class="plist rich places">${list.slice(0, art._pfMore ? 80 : 12).map(p => { const o = ohOpenAt(p.hours, now); const dl = DIETS.filter(([k]) => hasDiet(p, k)).map(([, l]) => t(l));
    return `<li><button type="button" class="place-row" data-place="${esc(placeKey(p))}">${ccIcon(OSM_CC[p.cat] || '')}<div><b>${esc(p.name)}</b>${p.g && p.g.rating ? `<span class="rt">${gRatingHTML(p.g)}</span>` : ''}<span>${esc([t(PLACE_ONE[p.cat] || ''), cuisineList(p).slice(0, 2).map(cuisineLabel).join(', '), placePrice(p)].filter(Boolean).join(' · '))}</span>${dl.length || o != null ? `<span class="tags">${o === true ? `<em class="open">${t('Open now')}</em>` : o === false ? `<em class="closed">${t('Closed now')}</em>` : ''}${dl.map(x => `<em>${esc(x)}</em>`).join('')}</span>` : ''}</div><span class="dist">${esc(fmtDist(p.d, v.cc))}<small>${walkTxt(p.d)}</small></span></button></li>`; }).join('')}
    ${list.length > 12 && !art._pfMore ? `<li class="more-li"><button type="button" class="btn sm" data-pf-more>${t('Show {n} more', { n: Math.min(80, list.length) - 12 })}</button></li>` : ''}</ul>`
    : `<p class="muted">${t('Nothing matches these filters.')} <button type="button" class="link" data-pf-clear>${t('Clear filters')}</button></p>`}
  ${rated ? `<p class="muted small g-attr">${t('Ratings from Google')}</p>` : ''}`;
}
function placeCardHTML(cfg, p) {
  const v = cfg.venue; const now = venueNow(cfg); const o = ohOpenAt(p.hours, now); const tr = tripDates(cfg);
  const dl = DIETS.filter(([k]) => hasDiet(p, k)).map(([k, l]) => `<em>${esc(t(l))}${p.diet[k] === 'only' ? ' ' + esc(t('only')) : p.diet[k] === 'limited' ? ' ' + esc(t('(some dishes)')) : ''}</em>`);
  const facts = [p.outdoor === 'yes' ? t('Outdoor seating') : '', p.takeaway === 'yes' || p.takeaway === 'only' ? t('Takeaway') : '', p.wheelchair === 'yes' ? t('Wheelchair accessible') : p.wheelchair === 'limited' ? t('Partly wheelchair accessible') : ''].filter(Boolean);
  const addr = [p.street, p.city || v.city].filter(Boolean).join(', ');
  const dirURL = `https://www.google.com/maps/dir/?api=1&origin=${v.lat},${v.lon}&destination=${p.lat},${p.lon}&travelmode=walking`;
  return `<div class="pc"><button type="button" class="x" data-pc-close aria-label="${t('Close')}">×</button>
    <p class="lbl">${esc([t(PLACE_ONE[p.cat] || p.kind || ''), cuisineList(p).map(cuisineLabel).join(', ')].filter(Boolean).join(' · '))}</p>
    <h2>${esc(p.name)}</h2>
    ${GKEY && p.cat !== 'pharmacy' && p.cat !== 'grocery' ? `<div class="pc-g" data-gslot>${p.g && p.g.rating ? `<p class="rt">${gRatingHTML(p.g)}</p>` : ''}</div>` : ''}
    <p class="pc-dist">${esc(t('{d} from the venue', { d: fmtDist(p.d, v.cc) }))} · ${walkTxt(p.d)}${placePrice(p) ? ' · ' + esc(placePrice(p)) : ''}</p>
    ${dl.length ? `<p class="tags">${dl.join('')}</p>` : ''}
    ${p.hours ? `<div class="pc-hours"><b>${o === true ? `<span class="open">${t('Open now')}</span>` : o === false ? `<span class="closed">${t('Closed now')}</span>` : t('Hours')}</b><ul>${prettyHours(p.hours).map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
    ${addr ? `<p class="pc-addr">${esc(addr)}</p>` : ''}
    ${facts.length ? `<p class="muted small">${esc(facts.join(' · '))}</p>` : ''}
    ${p.cat === 'hotel' ? hsSlotHTML(cfg, { ...osmPlanPlace(p), src: 'osm' }) : planAddHTML(cfg, osmPlanPlace(p))}
    <div class="btns sec-acts">${p.cat === 'hotel' ? (() => { const a = hotelBookAction(cfg, p); return ext(a.url, a.label, 'btn book'); })() : ''}${ext(dirURL, t('Directions'), 'btn')}${p.cat === 'restaurant' ? bookExt('restaurants', 'opentable', { name: p.name, venue: v, date: cfg.start.slice(0, 10), n: tr.guests || 2 }, t('Reserve') + ' · OpenTable', 'btn') : ''}${p.phone ? `<a class="btn" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${t('Call')}</a>` : ''}${p.website ? ext(p.website, t('Website'), 'btn') : ''}</div>
    <button type="button" class="link" data-pc-map>${t('Show on map')}</button>
  </div>`;
}
function wirePlaces(cfg, art, data, setMarkers, center) {
  const s = art.querySelector('[data-slot="food"]'); if (!s) return;
  if (s._wpOff) s._wpOff(); const ac = new AbortController(); s._wpOff = () => ac.abort(); const on = { signal: ac.signal }; // re-wired after Search this area
  const all = allPlaces(data);
  const byKey = new Map(all.concat((data.hotels || []).map(p => ({ ...p, cat: 'hotel' })), (data.sights || []).map(p => ({ ...p, cat: 'sight' }))).map(p => [placeKey(p), p]));
  const gDone = {};
  const gLoad = () => {
    const cat = placeFilters(cfg, art).cat; if (ac.signal.aborted || !GKEY || !cfg.venue || !G_TYPES[cat] || gDone[cat]) return;
    const panel = art.querySelector('[data-panel="nearby"]'); if (panel && panel.hidden) return;
    gDone[cat] = true;
    gNearby(center || cfg.venue, cat).then(gs => { gMerge(all, gs); if (document.body.contains(s) && !ac.signal.aborted) render(); }).catch(() => {});
  };
  (art._showFns = art._showFns || []).push((k) => { if (k === 'nearby') gLoad(); });
  // the bar above the map (or above the list when the page has no map slot)
  const bar = art.querySelector('[data-slot="near-cc"]'); let box = bar && bar.querySelector('[data-ccb="near"]');
  if (bar && !box) { bar.insertAdjacentHTML('beforeend', ccShell('near', `<div class="gp-search ccb-q"><input type="search" data-pf-q placeholder="${esc(t('Search by name'))}" aria-label="${esc(t('Search by name'))}" autocomplete="off" enterkeyhint="search"></div>`)); box = bar.querySelector('[data-ccb="near"]'); }
  const render = () => { if (ac.signal.aborted) return; s.innerHTML = placesHTML(cfg, data, art); if (box) placesBar(cfg, data, art, box); if (setMarkers) setMarkers(filterPlaces(cfg, all, placeFilters(cfg, art)).slice(0, 60)); gLoad(); };
  art._openPlace = (key) => {
    const p = byKey.get(key); if (!p) return;
    let d = $('#placedlg'); if (!d) { d = document.createElement('dialog'); d.id = 'placedlg'; d.className = 'sheet place-sheet'; document.body.appendChild(d); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); }
    d.setAttribute('style', themeStyle(cfg.theme)); d.classList.toggle('dark', cfg.theme.mode === 'dark'); d.setAttribute('lang', LANG);
    d.innerHTML = placeCardHTML(cfg, p);
    d.onclick = (e) => { if (hsClick(cfg, art, e)) return; if (planCardClick(cfg, art, d, e, osmPlanPlace(p))) return; if (e.target === d || e.target.closest('[data-pc-close]')) d.close(); if (e.target.closest('[data-pc-map]')) { d.close(); art._focusPlace && art._focusPlace(p); } };
    if (!d.open) d.showModal();
    const gs = d.querySelector('[data-gslot]');
    if (gs) gDetails(p).then(g => {
      if (!g || !d.open || !d.contains(gs)) return;
      gs.innerHTML = `${g.photo ? `<figure class="pc-photo"><img src="${esc(gPhotoURL(g.photo))}" alt="${esc(p.name)}" loading="lazy" onerror="this.closest('figure').remove()">${g.photoBy && g.photoBy.name ? `<figcaption>${esc(t('Photo: {n}', { n: g.photoBy.name }))}</figcaption>` : ''}</figure>` : ''}
        ${g.rating ? `<p class="rt">${gRatingHTML(g)} <small class="muted">${t('on Google')}</small></p>` : ''}
        ${!p.hours && g.hours.length ? `<div class="pc-hours"><b>${g.openNow === true ? `<span class="open">${t('Open now')}</span>` : g.openNow === false ? `<span class="closed">${t('Closed now')}</span>` : t('Hours')}</b><ul>${g.hours.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}`;
      if (g.rating && !p.g) p.g = { gid: g.gid, rating: g.rating, count: g.count, price: g.price, url: g.url };
    }).catch(() => {});
  };
  if (!art._placeClicks) { art._placeClicks = true; art.addEventListener('click', (e) => { const b = e.target.closest('[data-place]'); if (b && art._openPlace) art._openPlace(b.dataset.place); }); }
  const onClick = (e) => {
    const b = e.target.closest('button'); if (!b) return; const f = placeFilters(cfg, art); const d = b.dataset;
    if (d.place) return;
    if (d.ccPill) { const k = d.ccPill; if (k.startsWith('diet:')) f.diet = f.diet.filter(x => x !== k.slice(5)); else f[k] = k === 'open' ? false : k === 'stars' || k === 'dist' ? 0 : ''; }
    else if (d.pfDiet) { f.diet = f.diet.includes(d.pfDiet) ? f.diet.filter(x => x !== d.pfDiet) : f.diet.concat(d.pfDiet); }
    else if (d.pfDist) f.dist = +f.dist === +d.pfDist ? 0 : +d.pfDist;
    else if (d.pfOpen != null) f.open = !f.open;
    else if (d.pfPrice) f.price = f.price === d.pfPrice ? '' : d.pfPrice;
    else if (d.pfStars) f.stars = f.stars === +d.pfStars ? 0 : +d.pfStars;
    else if (d.pfClear != null) { Object.assign(f, { cuisine: '', diet: [], open: false, dist: 0, price: '', stars: 0, q: '' }); const q = box && box.querySelector('[data-pf-q]'); if (q) q.value = ''; }
    else if (d.pfMore != null) art._pfMore = true;
    else return;
    render();
  };
  s.addEventListener('click', onClick, on);
  const onChange = (e) => { const i = e.target; if (!i.dataset.pf) return; const f = placeFilters(cfg, art); f[i.dataset.pf] = i.dataset.pf === 'dist' ? +i.value : i.value; render(); };
  s.addEventListener('change', onChange, on);
  if (bar) {
    bar.addEventListener('click', onClick, on); bar.addEventListener('change', onChange, on);
    bar.addEventListener('input', (e) => { if (!e.target.matches('[data-pf-q]')) return; placeFilters(cfg, art).q = e.target.value.slice(0, 60); art._pfMore = false; render(); }, on);
    bar.addEventListener('dd', (e) => { const { key, v } = e.detail; const f = placeFilters(cfg, art);
      if (key === 'cat') { f.cat = v; f.cuisine = ''; art._pfMore = false; render(); }
      if (key === 'city' && art._osmCity) art._osmCity(+v); }, on);
  }
  render();
}

// ================= Google ratings, photos and hours on top of the OpenStreetMap places =================
// Only when a key is configured (google-config.js; the key is locked to this site's address).
// Calls are few and cached: one Nearby Search per category when the guest first looks at it (≤20 places, ratings only),
// and one Place Details when a place card is opened (photo + hours). Nothing is fetched on filter changes.
const GKEY = window.EP_GOOGLE && window.EP_GOOGLE.key ? window.EP_GOOGLE.key : '';
// footer credits for the sources that actually supplied the page's map and places
const attribHTML = (srcs) => [srcs.has('google') && !(gpBroken && gmapsBroken) ? esc(t('Maps and places © Google')) : '', srcs.has('osm') ? `${esc(t('Map data ©'))} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">${esc(t('OpenStreetMap contributors'))}</a>` : '',
  `${esc(t('Weather by'))} <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>`].filter(Boolean).join(' · ');
const G_TYPES = { restaurant: ['restaurant'], cafe: ['cafe', 'coffee_shop'], bar: ['bar', 'pub'], fast_food: ['fast_food_restaurant'] };
const G_PRICE = { PRICE_LEVEL_INEXPENSIVE: '$', PRICE_LEVEL_MODERATE: '$$', PRICE_LEVEL_EXPENSIVE: '$$$', PRICE_LEVEL_VERY_EXPENSIVE: '$$$$' };
const G_TTL = 3 * 864e5;
const gNorm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/\b(the|restaurant|ristorante|cafe|bar|nyc|new york)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function gSameName(a, b) {
  a = gNorm(a); b = gNorm(b); if (!a || !b) return false; if (a === b || a.includes(b) || b.includes(a)) return true;
  const A = new Set(a.split(' ')), B = b.split(' '); const hit = B.filter(x => A.has(x)).length; return hit / Math.max(A.size, B.length) >= 0.5;
}
async function gFetch(url, body, mask) {
  const r = await fetchTimeout(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GKEY, 'X-Goog-FieldMask': mask }, body: body ? JSON.stringify(body) : undefined }, 12000);
  if (!r.ok) throw new Error('places ' + r.status); return r.json();
}
// ratings for one category around the venue → [{gid, name, lat, lon, rating, count, price, url}]
function gNearby(v, cat) {
  const key = `gp2:${osmKey(v.lat, v.lon)}:${cat}`; const c = LS.get(key); if (c && Date.now() - c.t < G_TTL) return Promise.resolve(c.d);
  if (memo.has(key)) return memo.get(key);
  const p = gFetch('https://places.googleapis.com/v1/places:searchNearby', { includedTypes: G_TYPES[cat], maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: v.lat, longitude: v.lon }, radius: 1000 } } },
    'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri')
    .then(j => { const d = (j.places || []).map(x => ({ gid: x.id, name: x.displayName && x.displayName.text || '', lat: x.location && x.location.latitude, lon: x.location && x.location.longitude, rating: x.rating || 0, count: x.userRatingCount || 0, price: G_PRICE[x.priceLevel] || '', url: x.googleMapsUri || '' })); LS.set(key, { t: Date.now(), d }); return d; });
  memo.set(key, p); p.catch(() => memo.delete(key)); return p;
}
// attach Google data to matching OSM places (same name nearby)
function gMerge(places, gs) {
  for (const p of places) {
    if (p.g) continue;
    const m = gs.filter(g => g.lat != null && distM(p.lat, p.lon, g.lat, g.lon) < 150 && gSameName(p.name, g.name)).sort((a, b) => distM(p.lat, p.lon, a.lat, a.lon) - distM(p.lat, p.lon, b.lat, b.lon))[0];
    if (m) p.g = m;
  }
}
// photo + hours for one place card (by Google id, or found by name next to the OSM point)
function gDetails(p) {
  const key = 'gd1:' + (p.g ? p.g.gid : placeKey(p)); const c = LS.get(key); if (c && Date.now() - c.t < G_TTL) return Promise.resolve(c.d);
  const mask = 'id,displayName,rating,userRatingCount,priceLevel,googleMapsUri,regularOpeningHours.weekdayDescriptions,currentOpeningHours.openNow,photos';
  const req = p.g ? gFetch(`https://places.googleapis.com/v1/places/${enc(p.g.gid)}`, null, mask)
    : gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: [p.name, p.street, p.city].filter(Boolean).join(', '), maxResultCount: 1, locationBias: { circle: { center: { latitude: p.lat, longitude: p.lon }, radius: 150 } } }, mask.split(',').map(f => 'places.' + f).join(','))
      .then(j => { const x = (j.places || [])[0]; return x && gSameName(p.name, x.displayName && x.displayName.text) ? x : null; });
  return req.then(x => {
    const ph = x && x.photos && x.photos[0];
    const d = x ? { gid: x.id, rating: x.rating || 0, count: x.userRatingCount || 0, price: G_PRICE[x.priceLevel] || '', url: x.googleMapsUri || '', hours: (x.regularOpeningHours && x.regularOpeningHours.weekdayDescriptions) || [],
      openNow: x.currentOpeningHours ? !!x.currentOpeningHours.openNow : null, photo: ph ? ph.name : '', photoBy: ph && ph.authorAttributions && ph.authorAttributions[0] ? { name: ph.authorAttributions[0].displayName || '', uri: ph.authorAttributions[0].uri || '' } : null } : null;
    LS.set(key, { t: Date.now(), d }); return d;
  });
}
const gPhotoURL = (name) => `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&key=${enc(GKEY)}`;
const gStars = (r) => `<span class="stars" aria-label="${esc(t('{r} out of 5 stars', { r: nfix(r, 1) }))}">★ ${nfix(r, 1)}</span>`;
const gRatingHTML = (g) => g && g.rating ? `${gStars(g.rating)}${g.count ? ` <small>(${g.count.toLocaleString(LOCALES[LANG] || 'en-US')})</small>` : ''}` : '';

// ================= maps: Google Maps when a key is set, Leaflet + OpenStreetMap otherwise or if Google fails =================
// Both sit behind one small adapter: center, fit, pin, label, group(color) → set/show, invalidateSize, remove.
let gmapsP = null, gmapsBroken = false;
const gmapsFails = new Set();
function loadGoogleMaps() {
  if (window.google && window.google.maps && window.google.maps.Map) return Promise.resolve(window.google.maps);
  if (!GKEY || gmapsBroken) return Promise.reject(new Error('no Google Maps'));
  return gmapsP || (gmapsP = new Promise((res, rej) => {
    window.__epGmaps = () => res(window.google.maps);
    // Google calls this when the key is refused (it can happen after the map is drawn): switch every map to Leaflet
    window.gm_authFailure = () => { gmapsBroken = true; gmapsFails.forEach(f => { try { f(); } catch {} }); };
    const s = document.createElement('script'); s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${enc(GKEY)}&v=weekly&loading=async&language=${enc(LANG)}&callback=__epGmaps`;
    s.onerror = () => { gmapsP = null; gmapsBroken = true; rej(new Error('Google Maps did not load')); };
    document.head.appendChild(s);
    setTimeout(() => rej(new Error('Google Maps timed out')), 15000);
  }));
}
// map marks: the guest's hotel is a large amber pin with a navy bed (top of the stack); saved spots are gold stars
const mapHover = () => !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);
const hotelKey = (items) => JSON.stringify(items.map(x => [x.lat, x.lon, x.title, x.label, x.dates, x.rm || '', x.sug ? 1 : 0]));
const hotelPop = (x) => x.sug ? `<b>${esc(x.name || x.title || '')}</b>${x.dates ? `<br>${esc(x.dates)}` : ''}<br><small>${esc(t('Suggested by the organizer'))}</small><br>${x.choose || ''}` : `<b>${esc(x.name || x.title || '')}</b>${x.dates ? `<br>${esc(x.dates)}` : ''}${x.rm ? `<br><button type="button" class="pop-rm bk-rm" data-hs-rm="${esc(x.rm)}">${TRASH_IC}${esc(t('Remove'))}</button>` : ''}`;
const pinText = (s) => { s = String(s || ''); return s.length > 22 ? s.slice(0, 21).trim() + '…' : s; };
// "your hotel": a big amber teardrop (white outline, drop shadow, navy bed on a white disc) — unmistakable next to the
// small blue Hotels circles; the map copy adds a soft amber pulse ring (off for reduced motion)
const hotelPinSVG = (pulse) => `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="63" viewBox="0 0 64 70"><defs><filter id="s" x="-40%" y="-30%" width="180%" height="160%"><feDropShadow dx="0" dy="2.2" stdDeviation="2.2" flood-color="#000" flood-opacity=".45"/></filter></defs>${pulse ? '<circle cx="32" cy="31" r="20" fill="#F59E0B" opacity=".5"><animate attributeName="r" values="19;31" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".55;0" dur="1.8s" repeatCount="indefinite"/></circle>' : ''}<path filter="url(#s)" d="M32 9C21 9 12 17.6 12 28.4 12 42.6 32 66 32 66s20-23.4 20-37.6C52 17.6 43 9 32 9z" fill="#F59E0B" stroke="#fff" stroke-width="3.5"/><circle cx="32" cy="29" r="13" fill="#fff"/><g fill="#1E3A8A" transform="translate(17.1 14.4) scale(.62)"><rect x="12" y="15" width="3.2" height="17" rx="1.2"/><rect x="12" y="26" width="24" height="3.2" rx="1"/><rect x="32.8" y="22" width="3.2" height="10" rx="1.2"/><circle cx="19.6" cy="21.4" r="2.9"/><rect x="23.6" y="19" width="12.4" height="5.6" rx="2.4"/></g></svg>`;
const HOTEL_PIN = 'data:image/svg+xml,' + encodeURIComponent(hotelPinSVG(false));
const HOTEL_PIN_MAP = 'data:image/svg+xml,' + encodeURIComponent(hotelPinSVG(true));
const hotelPinMap = () => (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ? HOTEL_PIN : HOTEL_PIN_MAP;
const STAR_PIN = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34"><defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#000" flood-opacity=".4"/></filter></defs><path filter="url(#s)" d="M17 2.5l4.3 8.9 9.7 1.4-7 6.8 1.7 9.7-8.7-4.6-8.7 4.6 1.7-9.7-7-6.8 9.7-1.4z" fill="#E8A100" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg>');
function googleAdapter(g, el, c) {
  const map = new g.Map(el, { center: { lat: c.lat, lng: c.lon }, zoom: c.zoom || 15, disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', clickableIcons: false, keyboardShortcuts: false });
  const info = new g.InfoWindow(); const all = []; el._gmap = map;
  // category markers: white icon on the category color, sized by zoom (redrawn when the zoom crosses a step)
  const ccMs = new Set(); let ccSz = 0;
  const gIc = (k, sv) => { const z = ccPinSize(map.getZoom() || 15) + (sv ? 4 : 0); return { url: ccPinURL(k, sv), scaledSize: new g.Size(z, z), anchor: new g.Point(z / 2, z / 2) }; };
  try { map.addListener('zoom_changed', () => { const z = ccPinSize(map.getZoom() || 15); if (z === ccSz) return; ccSz = z; ccMs.forEach(([m, k, sv]) => m.setIcon && m.setIcon(gIc(k, sv))); }); } catch { /* stand-in maps */ }
  const ccReg = (m, k, sv) => { const e = [m, k, sv]; ccMs.add(e); return () => ccMs.delete(e); };
  // one info popup: tap a marker to open it, tap the same marker again or the map to close it
  const infoAt = (m, html) => { if (info._m === m) { info.close(); info._m = null; return; } info.setContent(html); info.open({ anchor: m, map }); info._m = m; };
  try { info.addListener('closeclick', () => { info._m = null; }); map.addListener('click', () => { if (info._m) { info.close(); info._m = null; } }); } catch { /* stand-in maps */ }
  const pop = (m, html) => m.addListener('click', () => infoAt(m, html));
  // name labels only on hover (mouse); on a phone the tap popup carries the name
  const tip = (m, text, cls, fs) => { m.tip = text; if (!mapHover()) return; const l = { text, className: cls, color: '#12141B', fontSize: fs, fontWeight: '700' }; m.addListener('mouseover', () => m.setLabel(l)); m.addListener('mouseout', () => m.setLabel(null)); };
  return {
    kind: 'google', map,
    center: (lat, lon, z) => { map.setCenter({ lat, lng: lon }); if (z) map.setZoom(z); },
    fit: (pts) => { const b = new g.LatLngBounds(); pts.forEach(([la, lo]) => b.extend({ lat: la, lng: lo })); map.fitBounds(b, 60); g.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 16) map.setZoom(16); }); },
    pin: (lat, lon, { title, html, color }) => { const m = new g.Marker({ map, position: { lat, lng: lon }, title, zIndex: 1000, icon: { path: 'M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z', fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1.15, anchor: new g.Point(12, 36), labelOrigin: new g.Point(12, 46) } }); if (title) tip(m, pinText(title), 'gmap-lbl', '11px'); pop(m, html); all.push(m); },
    // the same hotels again (a tap re-renders the bar) keep their markers, so the tap's popup stays open
    hotelPins: (() => { let ms = [], key = '', cur = []; return (items) => { const k = hotelKey(items); cur = items; if (k === key) return; key = k; if (ms.includes(info._m)) { info.close(); info._m = null; } ms.forEach(m => m.setMap(null)); ms = items.map((x, i) => { const m = new g.Marker({ map, position: { lat: x.lat, lng: x.lon }, title: x.title, zIndex: x.sug ? 4500 : 5000, optimized: false, opacity: x.sug ? 0.6 : 1, icon: { url: hotelPinMap(), scaledSize: new g.Size(58, 63), anchor: new g.Point(29, 60), labelOrigin: new g.Point(29, 72) } }); m.myHotel = true; tip(m, x.label, 'gmap-lbl hotel', '12px'); m.addListener('click', () => { const y = cur[i] || x; if (y.onClick) y.onClick(); infoAt(m, hotelPop(y)); }); return m; }); }; })(),
    label: (lat, lon, { title, text, html }) => { const m = new g.Marker({ map, position: { lat, lng: lon }, title, zIndex: 900, label: { text, fontSize: '11px', fontWeight: '700', color: '#12141B' }, icon: { path: g.SymbolPath.CIRCLE, scale: 0 } }); pop(m, html); all.push(m); },
    group: (color) => { let ms = [], vis = true; return {
      set: (items) => { ms.forEach(m => { m.setMap(null); m._un && m._un(); }); ms = items.map(x => { const m = new g.Marker({ map: vis ? map : null, position: { lat: x.lat, lng: x.lon }, title: x.title, optimized: x.ic == null, icon: x.ic != null ? gIc(x.ic) : { path: g.SymbolPath.CIRCLE, scale: 6, fillColor: color, fillOpacity: .95, strokeColor: '#fff', strokeWeight: 1.5 } }); if (x.ic != null) m._un = ccReg(m, x.ic); if (x.onClick) m.addListener('click', x.onClick); else if (x.html) pop(m, x.html); return m; }); },
      show: (on) => { vis = on; ms.forEach(m => m.setMap(on ? map : null)); }, visible: () => vis, count: () => ms.length }; },
    pins: (() => { let ms = []; return (items, color) => { ms.forEach(m => { m.setMap(null); m._un && m._un(); }); ms = items.map(x => { const m = new g.Marker({ map, position: { lat: x.lat, lng: x.lon }, title: x.title, zIndex: x.z || 500, optimized: false, icon: x.ic != null ? gIc(x.ic) : color ? { path: 'M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z', fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1, anchor: new g.Point(12, 36) } : undefined }); if (x.ic != null) m._un = ccReg(m, x.ic); m.addListener('click', () => x.onClick && x.onClick()); return m; }); }; })(),
    savedPins: (() => { let ms = []; return (items) => { ms.forEach(m => { m.setMap(null); m._un && m._un(); }); ms = items.map(x => { const m = new g.Marker({ map, position: { lat: x.lat, lng: x.lon }, title: x.title, zIndex: 4000, optimized: false, icon: x.ic ? gIc(x.ic, true) : { url: STAR_PIN, scaledSize: new g.Size(34, 34), anchor: new g.Point(17, 17) } }); if (x.ic) m._un = ccReg(m, x.ic, true); m.addListener('click', () => x.onClick && x.onClick()); return m; }); }; })(),
    onPoi: (fn) => { map.setOptions({ clickableIcons: true }); map.addListener('click', (e) => { if (e.placeId) { e.stop(); fn(e.placeId); } }); },
    view: () => { const b = map.getBounds(); if (!b) return null; const c = b.getCenter(), ne = b.getNorthEast(); return { lat: c.lat(), lon: c.lng(), ne: [ne.lat(), ne.lng()] }; },
    onMoved: (fn) => map.addListener('idle', fn), zoom: () => map.getZoom(),
    invalidateSize: () => { g.event.trigger(map, 'resize'); },
    remove: () => { all.forEach(m => m.setMap(null)); el.innerHTML = ''; },
  };
}
function leafletAdapter(el, c) {
  const Lf = window.L; el.innerHTML = ''; delete el._leaflet_id;
  const map = Lf.map(el, { scrollWheelZoom: false, zoomControl: false, attributionControl: true }).setView([c.lat, c.lon], c.zoom || 15);
  Lf.control.zoom({ position: 'topright', zoomInTitle: t('Zoom in'), zoomOutTitle: t('Zoom out') }).addTo(map); el._leafletMap = map; try { map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>'); } catch { }
  const zb = () => { const z = map.getZoom(); el.dataset.zb = z >= 15 ? '' : z >= 13 ? 'mid' : 'far'; }; map.on('zoomend', zb); zb();
  const lTip = (m, text, cls) => (text && mapHover() ? m.bindTooltip(esc(text), { direction: 'bottom', className: 'map-tip' + cls }) : m); // name on hover only (a tap opens the popup)
  const ccMk = (x, sv, zi) => Lf.marker([x.lat, x.lon], { icon: Lf.divIcon({ className: 'ccpin' + (sv ? ' sv' : ''), html: `<img src="${ccPinURL(x.ic, sv)}" alt="">`, iconSize: [36, 36], iconAnchor: [18, 18] }), title: x.title, zIndexOffset: zi });
  Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  return {
    kind: 'leaflet', map,
    center: (lat, lon, z) => map.setView([lat, lon], z || map.getZoom()),
    fit: (pts) => map.fitBounds(pts, { padding: [50, 50], maxZoom: 16 }),
    pin: (lat, lon, { title, html, color }) => lTip(Lf.marker([lat, lon], { icon: Lf.divIcon({ className: 'pin', html: `<span style="--accent:${color}"></span>`, iconSize: [30, 40], iconAnchor: [15, 38], tooltipAnchor: [0, 2] }), title, zIndexOffset: 1000 }), title && pinText(title), '').addTo(map).bindPopup(html),
    hotelPins: (() => { let lg = null, key = '', cur = []; return (items) => { if (!lg) lg = Lf.layerGroup().addTo(map); const k = hotelKey(items); cur = items; if (k === key) return; key = k; lg.clearLayers(); items.forEach((x, i) => lTip(Lf.marker([x.lat, x.lon], { icon: Lf.divIcon({ className: x.sug ? 'hpin sug' : 'hpin', html: `<img src="${hotelPinMap()}" alt="">`, iconSize: [58, 63], iconAnchor: [29, 60], tooltipAnchor: [0, 3] }), title: x.title, zIndexOffset: x.sug ? 4500 : 5000 }), x.label, ' hotel').bindPopup(hotelPop(x), { offset: [0, -48] }).on('click', () => { const y = cur[i] || x; if (y.onClick) y.onClick(); }).addTo(lg)); }; })(),
    label: (lat, lon, { title, text, html }) => Lf.marker([lat, lon], { icon: Lf.divIcon({ className: 'tpin', html: `<span>${esc(text)}</span>`, iconSize: null, iconAnchor: [0, 0] }), title, zIndexOffset: 900 }).addTo(map).bindPopup(html),
    group: (color) => { const lg = Lf.layerGroup().addTo(map); return {
      set: (items) => { lg.clearLayers(); items.forEach(x => { const m = x.ic != null ? ccMk(x, false, 0) : Lf.circleMarker([x.lat, x.lon], { radius: 6, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: .95 }); if (x.onClick) m.on('click', x.onClick); else if (x.html) m.bindPopup(x.html); m.addTo(lg); }); },
      show: (on) => { on ? lg.addTo(map) : map.removeLayer(lg); }, visible: () => map.hasLayer(lg), count: () => lg.getLayers().length }; },
    pins: (() => { let lg = null; return (items, color) => { if (!lg) lg = Lf.layerGroup().addTo(map); lg.clearLayers(); items.forEach(x => (x.ic != null ? ccMk(x, false, 500) : Lf.circleMarker([x.lat, x.lon], { radius: 10, color: '#fff', weight: 2, fillColor: color || '#D93025', fillOpacity: 1 })).on('click', () => x.onClick && x.onClick()).bindTooltip(x.title || '').addTo(lg)); }; })(),
    savedPins: (() => { let lg = null; return (items) => { if (!lg) lg = Lf.layerGroup().addTo(map); lg.clearLayers(); items.forEach(x => (x.ic ? ccMk(x, true, 4000) : Lf.marker([x.lat, x.lon], { icon: Lf.divIcon({ className: 'spin', html: `<img src="${STAR_PIN}" alt="">`, iconSize: [34, 34], iconAnchor: [17, 17] }), title: x.title, zIndexOffset: 4000 })).on('click', () => x.onClick && x.onClick()).addTo(lg)); }; })(),
    onPoi: () => {},
    view: () => { const b = map.getBounds(); const c = b.getCenter(), ne = b.getNorthEast(); return { lat: c.lat, lon: c.lng, ne: [ne.lat, ne.lng] }; },
    onMoved: (fn) => map.on('moveend', fn), zoom: () => map.getZoom(),
    invalidateSize: () => map.invalidateSize(),
    remove: () => map.remove(),
  };
}
// The venue map on the Nearby tab. Built the first time the tab is shown; nearby data can arrive before or after.
const osmIc = (x) => OSM_CC[x.cat] || OSM_CC[x.kind] || 'restaurants';
function wireMap(cfg, art, opts) {
  let el = art.querySelector('[data-slot="map"]'); const v = cfg.venue; if (!el || !v) return;
  const T = cfg.tools; const st = { data: null, food: null, groups: {}, adapter: null, building: false, gmode: false, pins: [], poi: null, saved: [], hotels: [], area: null, areaFns: [] };
  const drawPins = () => { const a = st.adapter; if (!a) return; a.pins(st.pins); if (st.poi) a.onPoi(st.poi); };
  // "Search this area": after any pan/zoom that moves the view away from the last searched area, a button offers to
  // search again inside what is on screen. Compared against the last search (not a flag set by code), so it can't get stuck.
  const wrap = el.closest('.map-wrap');
  if (wrap && !wrap.querySelector('[data-area-go]')) wrap.insertAdjacentHTML('afterbegin', `<button type="button" class="area-btn" data-area-go hidden>${esc(t('Search this area'))}</button>`);
  const areaBtn = wrap ? wrap.querySelector('[data-area-go]') : null;
  const viewArea = () => { const a = st.adapter; const w = a && a.view ? a.view() : null; if (!w || !isFinite(w.lat)) return null; return { lat: +w.lat.toFixed(5), lon: +w.lon.toFixed(5), r: Math.round(Math.min(50000, Math.max(250, distM(w.lat, w.lon, w.ne[0], w.ne[1])))) }; };
  const areaMoved = (a, b) => !b || distM(a.lat, a.lon, b.lat, b.lon) > 0.3 * Math.min(a.r, b.r) || a.r < b.r * 0.45 || a.r > b.r * 2.2;
  const onMoved = () => {
    const now = viewArea(); if (!now || !areaBtn) return;
    if (!st.area) { st.area = now; return; } // the first view after drawing is the starting area
    areaBtn.hidden = !(st.areaFns.length && areaMoved(now, st.area));
  };
  if (areaBtn) areaBtn.onclick = () => { const now = viewArea(); if (!now) return; st.area = now; areaBtn.hidden = true; st.areaFns.forEach(fn => { try { fn(now); } catch { /* one list failing doesn't stop the others */ } }); };
  const draw = (a) => {
    st.adapter = a; maps.add(a); st.groups = {}; st.area = null; if (areaBtn) areaBtn.hidden = true;
    if (a.onMoved) { a.onMoved(onMoved); setTimeout(() => { if (!st.area && st.adapter === a) st.area = viewArea(); }, 0); } // Leaflet's first view fires before we listen
    a.pin(v.lat, v.lon, { title: v.pinName || v.name, color: cfg.theme.accent, html: `<b>${esc(v.pinName || v.name)}</b><br>${esc(v.address || '')}` });
    const sp = typeSpec(cfg), td = typeData(cfg), pts = [[v.lat, v.lon]];
    if (sp && !cfg.off.details) sp.fields.filter(f => f[2] === 'place' && td[f[0]] && td[f[0]].lat != null).forEach(([k, label]) => {
      const p = td[k]; pts.push([p.lat, p.lon]); a.label(p.lat, p.lon, { title: `${t(label)}: ${p.q}`, text: t(label), html: `<b>${esc(t(label))}</b><br>${esc(p.q)}` });
    });
    if (pts.length > 1) a.fit(pts);
    if (st.gmode) drawPins(); else if (st.data) layers();
    if (st.saved.length) a.savedPins(st.saved);
    if (st.hotels.length) a.hotelPins(st.hotels);
    view(); // a view asked for before the map existed (the guest's hotel, a stop) is applied now
  };
  // the last view asked for: applied as soon as the map exists (Google Maps can take seconds on a phone)
  const view = (w) => { if (w) st.want = w; const a = st.adapter, x = st.want; if (!a || !x) return; st.want = null; st.area = null; if (areaBtn) areaBtn.hidden = true;
    if (x.pts) a.fit(x.pts); else a.center(x.lat, x.lon, x.z); };
  const popup = (x) => `<b>${esc(x.name)}</b><br>${esc(t('{d} from the venue', { d: fmtDist(x.d, v.cc) }))}`;
  const layers = () => {
    const a = st.adapter, d = st.data; if (!a || !d || st.gmode) return;
    Object.values(st.groups).forEach(x => { try { x.g.set([]); x.g.show(false); } catch { /* gone */ } }); st.groups = {};
    const defs = [['food', '#E4572E', t('Food & drink'), (st.food || d.food.slice(0, 25)).map(x => ({ lat: x.lat, lon: x.lon, title: x.name, ic: osmIc(x), onClick: () => art._openPlace && art._openPlace(placeKey(x)), html: popup(x) }))]];
    if (T.stay) defs.push(['hotels', '#7B4FD6', t('Hotels'), d.hotels.slice(0, 15).map(x => ({ lat: x.lat, lon: x.lon, title: x.name, onClick: () => art._openPlace && art._openPlace(placeKey(x)), html: popup(x) }))]);
    if (T.tours) defs.push(['sights', '#0B9A6D', t('Sights'), (d.sights || []).slice(0, 12).map(x => ({ lat: x.lat, lon: x.lon, title: x.name, onClick: () => art._openPlace && art._openPlace(placeKey(x)), html: popup(x) }))]);
    defs.push(['transit', '#1D8FD8', t('Transit'), [].concat(...Object.values(d.transit)).map(x => ({ lat: x.lat, lon: x.lon, title: x.name, html: popup(x) }))]);
    defs.forEach(([k, color, label, items]) => { if (!items.length && k !== 'food') return; const g = a.group(color); g.set(items); st.groups[k] = { g, color, label }; });
    const lg = art.querySelector('[data-slot="legend"]');
    lg.innerHTML = Object.entries(st.groups).map(([k, x]) => `<button class="chip on" data-layer="${k}" aria-pressed="true"><i style="background:${x.color}"></i>${x.label}</button>`).join('');
    lg.onclick = (e) => { const b = e.target.closest('[data-layer]'); if (!b) return; const l = st.groups[b.dataset.layer]; const on = !l.g.visible(); l.g.show(on); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); };
    legend();
  };
  // a tiny legend under the map, only while markers of more than one category are on it
  const legend = () => {
    const box = art.querySelector('[data-slot="map-cats"]'); if (!box) return;
    const ks = new Set((st.gmode ? st.pins : st.data ? (st.food || st.data.food.slice(0, 25)).map(x => ({ ic: osmIc(x) })) : []).concat(st.saved).map(x => x.ic).filter(Boolean));
    const order = CC_CATS.map(c => c[0]).filter(k => ks.has(k));
    box.innerHTML = order.length > 1 ? order.map(k => `<span>${ccIcon(k)}${esc(ccLabel(k))}</span>`).join('') : '';
  };
  const fallback = () => {
    if (st.adapter && st.adapter.kind === 'leaflet') return; gmapsFails.delete(fallback);
    if (st.adapter) { maps.delete(st.adapter); try { st.adapter.remove(); } catch {} st.adapter = null; }
    if (window.L && document.body.contains(el)) { const fresh = el.cloneNode(false); el.replaceWith(fresh); el = fresh; el.dataset.engine = 'leaflet'; draw(leafletAdapter(el, v)); if (art._useSrc) art._useSrc('osm'); }
  };
  const build = () => {
    if (st.adapter || st.building) return; st.building = true;
    loadGoogleMaps().then(g => {
      if (!document.body.contains(el)) return;
      if (gmapsBroken) throw new Error('key refused');
      draw(googleAdapter(g, el, v)); el.dataset.engine = 'google'; gmapsFails.add(fallback); if (art._useSrc) art._useSrc('google');
      setTimeout(() => { if (gmapsBroken) fallback(); }, 0); // a refusal can land while the map is being drawn
    })
      .catch(() => { if (document.body.contains(el)) fallback(); });
  };
  (art._showFns = art._showFns || []).push((k) => { if (k === 'nearby') build(); });
  if (!art.querySelector('[data-panel="nearby"]')?.hidden) build();
  return {
    setData: (d) => { st.data = d; layers(); },
    googleMode: () => { st.gmode = true; const lg = art.querySelector('[data-slot="legend"]'); if (lg) lg.innerHTML = ''; Object.values(st.groups).forEach(x => x.g.show(false)); legend(); },
    osmMode: () => { st.gmode = false; st.pins = []; drawPins(); layers(); legend(); },
    setPins: (items) => { st.pins = items; if (st.adapter && st.adapter.pins) st.adapter.pins(items); legend(); },
    onPoi: (fn) => { st.poi = fn; if (st.adapter) st.adapter.onPoi(fn); },
    setSaved: (items) => { st.saved = items; if (st.adapter && st.adapter.savedPins) st.adapter.savedPins(items); legend(); },
    setHotels: (items) => { st.hotels = items; if (st.adapter && st.adapter.hotelPins) st.adapter.hotelPins(items); },
    fit: (pts) => view({ pts }),
    centerOn: (lat, lon, z) => view({ lat, lon, z: z || 15 }),
    setFood: (items) => { st.food = items; const g = st.groups.food; if (g) g.g.set(items.map(x => ({ lat: x.lat, lon: x.lon, title: x.name, ic: osmIc(x), onClick: () => art._openPlace && art._openPlace(placeKey(x)) }))); legend(); },
    center: (lat, lon, z) => view({ lat, lon, z: z || 14 }), // a programmatic move is a new starting area
    onArea: (fn) => { st.areaFns.push(fn); },
    searchedArea: (a) => { st.area = a; if (areaBtn) areaBtn.hidden = true; },
    _view: () => viewArea(),
    focus: (p) => { if (p.lat == null) return; showTab(art, 'nearby', opts); view({ lat: p.lat, lon: p.lon, z: 17 }); el.scrollIntoView({ block: 'center' }); },
  };
}

// ================= My pages on this device, samples, demo links, duplicate =================
// Every page made here is kept in localStorage (config + its links), so starting a new page, copying a sample or duplicating
// never loses one. Pages always render with the current code: a link or a stored config is just data.
const DEMOS = { japan: 'japan-trip', wedding: 'tulum-wedding', race: 'chicago-10k', concert: 'redrocks-concert', conference: 'nyc-conference', festival: 'sf-festival' };
const newPid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pagesLoad = () => { const xs = LS.get('pages'); return Array.isArray(xs) ? xs : null; };
function pagesAll() {
  let xs = pagesLoad();
  if (!xs) { // first run: bring in the old single draft and the links published from this device
    xs = []; const d = LS.get('draft');
    if (d && d.title) { const pid = newPid(); xs.push({ pid, cfg: d, url: '', hosted: LS.get('draftHosted') || null, updated: Date.now() }); LS.set('draftId', pid); }
    try { Object.keys(localStorage).filter(k => k.startsWith('ep:published:')).forEach(k => { const v = LS.get(k.slice(3)); if (!v || !v.url) return; const m = v.url.match(/#e=([^&]+)/); const cfg = m ? unpackEvent(m[1]) : null; if (!cfg || xs.some(x => x.url === v.url)) return; xs.push({ pid: newPid(), cfg, url: v.url, hosted: null, updated: +k.split(':')[2] || Date.now() }); }); } catch { /* storage blocked */ }
    LS.set('pages', xs);
  }
  return xs;
}
function pageSave(pid, patch) {
  if (!pid || pageGone({ pid })) return; const xs = pagesAll(); const i = xs.findIndex(x => x.pid === pid);
  const prev = i >= 0 ? xs[i] : { pid, url: '', hosted: null };
  const e = { ...prev, ...patch, updated: Date.now() };
  if (patch.cfg && patch.edited === undefined && JSON.stringify(patch.cfg) !== JSON.stringify(prev.cfg)) e.edited = Date.now(); // when its content last changed (the newer copy wins across devices)
  if (!e.cfg || !(e.cfg.title || '').trim()) return; // untitled scratch drafts stay out of the list
  if (i >= 0) xs[i] = e; else xs.unshift(e);
  LS.set('pages', xs.slice(0, 60));
}
function pageRemove(pid) { LS.set('pages', pagesAll().filter(p => p.pid !== pid)); }
// Deleted pages leave a tombstone (page id, account row id, page key) so nothing brings them back: not an autosave still
// queued or running in another tab, not the upload of this device's pages on sign-in, not the account's pages coming down.
// A row deleted while signed out is deleted from the account on the next sync (only rows this account owns).
const GONE_MAX = 300;
const goneGet = () => { const g = LS.get('deleted'); return { pids: [], ids: [], eks: [], ...(g && typeof g === 'object' ? g : {}) }; };
function pageGone({ pid, id, ek }) { const g = goneGet(); return !!((pid && g.pids.includes(pid)) || (id && g.ids.includes(id)) || (ek && g.eks.includes(ek))); }
function goneMark({ pids = [], ids = [], eks = [] }, on = true) {
  const g = goneGet(); const upd = (xs, add) => (on ? [...xs.filter(v => !add.includes(v)), ...add] : xs.filter(v => !add.includes(v))).slice(-GONE_MAX);
  LS.set('deleted', { pids: upd(g.pids, pids.filter(Boolean)), ids: upd(g.ids, ids.filter(Boolean)), eks: upd(g.eks, eks.filter(Boolean)) });
}
// Delete a page everywhere it lives: every copy on this device (by page id or account row) and, signed in, its account row
// (owner only: RLS, plus owner = you here). Returns { undo } for a page that only lived on this device, else {}.
async function pageDelete({ pid, id }) {
  const xs = pagesAll(); const local = xs.filter(x => (pid && x.pid === pid) || (id && x.hosted && x.hosted.id === id));
  const rowId = id || (local.find(x => x.hosted && x.hosted.id) || {}).hosted?.id || null;
  if (rowId && acctOn()) { // throws (nothing removed) if the account delete fails
    const user = await sbUser(); if (!user) throw new Error('Sign in again to delete it from your account.');
    const c = await sb(); const { error } = await c.from('events').delete().eq('id', rowId).eq('owner', user.id); if (error) throw error;
  }
  const mark = { pids: local.map(x => x.pid), ids: rowId ? [rowId] : [], eks: local.map(x => x.cfg && x.cfg.ek) };
  goneMark(mark);
  if (B && mark.pids.includes(B.pid)) { clearTimeout(B.pushT); B.pushT = null; }
  LS.set('pages', xs.filter(x => !local.includes(x)));
  const wasOpen = mark.pids.includes(LS.get('draftId')); const keep = wasOpen ? { draft: LS.get('draft'), draftHosted: LS.get('draftHosted'), draftId: LS.get('draftId') } : null;
  if (wasOpen) { LS.del('draftId'); LS.del('draft'); LS.del('draftHosted'); }
  if (rowId) return {};
  return { undo: () => { goneMark(mark, false); const cur = pagesAll(); LS.set('pages', [...local.filter(x => !cur.some(y => y.pid === x.pid)), ...cur].slice(0, 60)); if (keep) Object.entries(keep).forEach(([k, v]) => v == null ? LS.del(k) : LS.set(k, v)); } };
}
// a toast with one action button (Undo); stays a little longer than a plain toast
function toastAction(msg, label, fn) {
  const el = toastEl(); el.textContent = msg + ' ';
  const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-act'; b.textContent = label;
  b.addEventListener('click', () => { el.classList.remove('show', 'act'); fn(); }, { once: true }); el.appendChild(b);
  el.classList.add('show', 'act'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show', 'act'), 6000);
}
// In-app "are you sure?" (window.confirm is suppressed in installed iOS web apps and some in-app browsers, where it just returns false).
// Resolves true only on the destructive button; Cancel, Escape and a tap on the backdrop resolve false.
function confirmDlg({ title, body = '', ok = 'Delete', cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    let d = $('#confirmdlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'confirmdlg'; d.className = 'confirm-dlg'; d.setAttribute('aria-labelledby', 'confirmdlg-h'); d.setAttribute('aria-describedby', 'confirmdlg-b'); document.body.appendChild(d); }
    if (typeof d.showModal !== 'function') { d.remove(); resolve(confirm(body ? `${title} ${body}` : title)); return; }
    d.innerHTML = `<form method="dialog" class="cf-in"><h2 id="confirmdlg-h">${esc(title)}</h2>${body ? `<p id="confirmdlg-b">${esc(body)}</p>` : ''}
      <div class="btns cf-b"><button type="submit" class="btn" value="cancel" autofocus>${esc(cancel)}</button><button type="submit" class="btn danger" value="ok">${esc(ok)}</button></div></form>`;
    d.returnValue = '';
    d.onclick = (e) => { if (e.target === d) d.close('cancel'); }; // backdrop
    d.onclose = () => { d.onclose = null; resolve(d.returnValue === 'ok'); };
    d.showModal();
  });
}
function duplicateCfg(cfg) { const c = spanFixed(normalize(clone(cfg))); delete c.ek; c.title = (c.title || 'Untitled') + ' (copy)'; return c; }
function myPagesHTML() {
  const xs = pagesAll().slice().sort((a, b) => (b.edited || b.updated || 0) - (a.edited || a.updated || 0)); if (!xs.length) return '';
  const cur = LS.get('draftId');
  return `<section class="land-mine" id="my-pages"><h2>${t('My pages')}${acctOn() ? '' : ` <small class="muted">${t('on this device')}</small>`}</h2><ul class="mp-list">${xs.slice(0, 30).map(x => { const c = spanFixed(normalize(clone(x.cfg))); const open = x.hosted ? (x.hosted.pub ? shortURL(x.hosted.slug) : '') : x.url;
    return `<li style="${themeStyle(c.theme)}"><i class="mp-dot" aria-hidden="true"></i><div class="mp-t"><b>${esc(c.title || t('Untitled'))}</b><span>${esc([t(TYPE_LABEL[c.type] || c.type), c.start ? dateRange(c.start, c.end) : '', open ? t('shared') : '', x.pid === cur ? t('last opened') : ''].filter(Boolean).join(' · '))}</span></div>
      <div class="mp-b"><a class="btn sm primary" href="#page=${esc(x.pid)}" aria-label="${esc(t('Open {n}', { n: c.title || t('Untitled') }))}">${t('Open')}</a><a class="btn sm ghost" href="#dup=${esc(x.pid)}">${t('Duplicate')}</a><button type="button" class="btn sm ghost" data-mp-del="${esc(x.pid)}" aria-label="${esc(t('Delete {n}', { n: c.title || t('Untitled') }))}">${t('Delete')}</button></div></li>`; }).join('')}</ul></section>`;
}
function renderExamples() {
  document.title = t('Example pages') + ' · 1LinkTrip'; scrollTo(0, 0);
  $('#app').innerHTML = `<main class="land"><header class="land-top"><a class="brand" href="#">${BRAND}</a><span class="land-nav"><a class="btn primary" href="#setup">${t('Create a page')}</a></span></header>${samplesHTML()}</main>`;
}
function samplesHTML() {
  const ex = window.EXAMPLES; const order = ['japan-trip', 'tulum-wedding', 'chicago-10k', 'redrocks-concert', 'nyc-conference', 'sf-festival'].filter(id => ex[id]);
  const demoOf = (id) => Object.keys(DEMOS).find(k => DEMOS[k] === id);
  return `<section class="land-ex" id="samples"><h2>${t('Example pages')}</h2>
    <div class="ex-grid">${order.map(id => { const e = normalize(clone(ex[id])); const v = e.venue;
      return `<div class="ex-card" style="${themeStyle(e.theme)}"><a class="ex-hit" href="?demo=${demoOf(id)}" aria-label="${esc(t('Open {n}', { n: e.title }))}"></a>
        <span class="ex-img" style="background-image:url('${esc(e.cover)}')"></span>
        <span class="ex-body"><span class="lbl">${esc(t(TYPE_LABEL[e.type] || e.type))}${v ? ' · ' + esc(v.city) : ''}</span><b>${esc(e.title)}</b><span>${esc(dateRange(e.start, e.end))}</span></span>
        <span class="ex-acts"><a class="btn sm" href="?demo=${demoOf(id)}">${t('Open')}</a><a class="btn sm ghost" href="#edit-ex=${id}">${t('Make a copy')}</a></span></div>`; }).join('')}</div></section>`;
}
function wireLanding() {
  const m = $('.land'); if (!m) return;
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mp-del]'); if (!b) return; const x = pagesAll().find(p => p.pid === b.dataset.mpDel); if (!x) return;
    const name = (x.cfg && x.cfg.title) || t('Untitled');
    const body = x.hosted && x.hosted.id ? (acctOn() ? `It’s removed from your account on every device${x.hosted.pub ? ' and its link stops working' : ''}.` : 'It’s also removed from your account the next time you sign in.')
      : x.url ? 'Links you already shared keep working.' : 'It’s only saved on this device.';
    if (!await confirmDlg({ title: t('Delete “{n}”?', { n: name }), body, ok: t('Delete') })) return;
    let r; try { b.disabled = true; r = await pageDelete({ pid: x.pid }); } catch (err) { b.disabled = false; toast(t('Couldn’t delete:') + ' ' + pubWhy(err)); return; }
    renderLanding();
    if (r.undo) toastAction("Page deleted.", 'Undo', () => { r.undo(); renderLanding(); }); else toast(t('Deleted “{n}”', { n: name }));
  });
}
// the account's pages arrived or changed (sync on open / sign-in): refresh whatever list is on screen
addEventListener('ep-pages', () => {
  const land = $('.land.home');
  if (land) { const h = myPagesHTML(), sec = $('#my-pages', land); if (sec) { if (h) sec.outerHTML = h; else sec.remove(); } else if (h) $('.land-hero', land)?.insertAdjacentHTML('afterend', h); }
  // a guest page that turns out to be this account's own (pages arrived from the account): reopen it as the owner's page
  const v = $('.viewer .vbar a[href^="#edit="]'); const slug = locQ().get('e');
  if (v && slug && !$('#sheet[open], dialog.ds-sheet[open]') && pagesAll().some(p => p.hosted && p.hosted.slug === slug)) route();
});

// ================= City × Category: one compact control bar for every list of places and plans =================
// [City ▾] [Category ▾] [Filters n] + search, the active sub-filters as removable pills under it, the sub-filters in a
// bottom sheet. Nearby searches the chosen city (its hotel, else the city) for the chosen category; My trip and the trip
// Itinerary show only that city / category. Kept per trip on this device; linkable as ?city=kyoto&cat=restaurants.
// Each category has one icon + color, used in the dropdown, list rows and map markers alike.
const CC_CATS = [['restaurants', 'Restaurants', '#E25A1C'], ['cafes', 'Cafés', '#8A5A2B'], ['bars', 'Bars', '#B0306A'], ['sights', 'Sights', '#0B7A8A'],
  ['tours', 'Things to do', '#6741D9'], ['shopping', 'Shopping', '#2F8A3E'], ['hotels', 'Hotels', '#1E3A8A'], ['transport', 'Transport', '#5C6370']];
const CC_NEAR = CC_CATS.slice(0, 7);
const CC_ALIAS = { restaurant: 'restaurants', food: 'restaurants', eat: 'restaurants', cafe: 'cafes', 'café': 'cafes', 'cafés': 'cafes', coffee: 'cafes', bar: 'bars', drinks: 'bars', nightlife: 'bars',
  sight: 'sights', attractions: 'sights', todo: 'tours', 'things-to-do': 'tours', tour: 'tours', activities: 'tours', shop: 'shopping', shops: 'shopping', hotel: 'hotels', stay: 'hotels', stays: 'hotels',
  lodging: 'hotels', flights: 'transport', transit: 'transport' };
const ccCatId = (s) => { s = String(s || '').trim().toLowerCase(); return CC_CATS.some(c => c[0] === s) ? s : CC_ALIAS[s] || ''; };
const ccLabel = (k) => k === 'activities' ? t('Activities') : t((CC_CATS.find(c => c[0] === k) || [0, 'Other'])[1]);
const ccColor = (k) => (CC_CATS.find(c => c[0] === (k === 'activities' ? 'tours' : k)) || [0, 0, '#5C6370'])[2];
const CC_GLYPH = {
  restaurants: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2.2 1.2-3.5 3.6-3.5 7v3H17"/>',
  cafes: '<path d="M4 9h12v4.5A5.5 5.5 0 0 1 10.5 19h-1A5.5 5.5 0 0 1 4 13.5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3"/>',
  bars: '<path d="M5 8h10v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM15 11h2.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H15M8.5 12v5M11.5 12v5M5 8c-.9-2.6 1.6-4.5 3.7-3.3C9.6 3 12.9 3 13.5 5c1.4-.3 2.2 1.4 1.5 3"/>',
  sights: '<path d="M3 20.5h18M5 17.5h14M12 3.5 4 8h16zM6.5 10.5v4.5M10 10.5v4.5M14 10.5v4.5M17.5 10.5v4.5"/>',
  tours: '<path d="M3.5 7.5h17v3a2 2 0 0 0 0 3.5v2.5h-17V14a2 2 0 0 0 0-3.5zM14.5 7.5v1.6M14.5 11.2v1.6M14.5 14.9v1.6"/>',
  shopping: '<path d="M5 8h14l-1.2 12.5H6.2zM9 10V6.5a3 3 0 0 1 6 0V10"/>',
  hotels: '<path d="M3 19V6M3 15h18v4M21 15v-3.5A2.5 2.5 0 0 0 18.5 9H11v6"/><circle cx="7" cy="11.5" r="1.8"/>',
  transport: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16"/>',
  flight: '<path d="M12 2.8c.8 0 1.4.7 1.4 1.5v5.2l7.1 4.1v1.9l-7.1-2.1v4.4l2 1.5v1.6L12 20l-3.4 1.1v-1.6l2-1.5v-4.4l-7.1 2.1v-1.9l7.1-4.1V4.3c0-.8.6-1.5 1.4-1.5z"/>',
  train: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 20l-1.5 2M15 20l1.5 2M9 16l-1 4M15 16l1 4"/>',
  bus: '<rect x="5" y="3" width="14" height="15" rx="2.5"/><path d="M5 11h14M5 7h14M8 18v2.5M16 18v2.5M8.5 14.5h.01M15.5 14.5h.01"/>',
  car: '<path d="M4.5 16.5v-4l2.2-5.5h10.6l2.2 5.5v4zM4.5 16.5v2.5M19.5 16.5v2.5M4.5 12.5h15M8 14.5h.01M16 14.5h.01"/>',
  taxi: '<path d="M10 3.5h4V7M4.5 16.5v-4l2.2-5.5h10.6l2.2 5.5v4zM4.5 16.5v2.5M19.5 16.5v2.5M4.5 12.5h15M8 14.5h.01M16 14.5h.01"/>',
  ferry: '<path d="M3 18.5c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0M4.5 15l1.2-5h12.6l1.2 5M8.5 10V6h7v4M12 6V3.5"/>',
  all: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
};
const ccGlyph = (k) => CC_GLYPH[k === "activities" ? "tours" : k] || CC_GLYPH.pin;
const ccIcon = (k) => `<span class="cci" style="--cc:${k === 'all' ? 'var(--ink)' : ccColor(k)}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${ccGlyph(k)}</svg></span>`;
// map marker: white icon on the category's colored circle; a saved spot gets a gold star on its shoulder
const ccPinMemo = new Map();
function ccPinURL(k, saved) {
  const key = k + (saved ? '*' : ''); if (ccPinMemo.has(key)) return ccPinMemo.get(key);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#000" flood-opacity=".38"/></filter></defs><circle filter="url(#s)" cx="20" cy="21" r="14.5" fill="${ccColor(k)}" stroke="#fff" stroke-width="2.5"/><g transform="translate(10.8 11.8) scale(.77)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ccGlyph(k)}</g>${saved ? '<path transform="translate(24.5 .5) scale(.43)" d="M17 2.5l4.3 8.9 9.7 1.4-7 6.8 1.7 9.7-8.7-4.6-8.7 4.6 1.7-9.7-7-6.8 9.7-1.4z" fill="#E8A100" stroke="#fff" stroke-width="4.6" stroke-linejoin="round"/>' : ''}</svg>`;
  const u = 'data:image/svg+xml,' + encodeURIComponent(svg); ccPinMemo.set(key, u); return u;
}
const ccPinSize = (z) => z >= 15 ? 34 : z >= 13 ? 29 : 23; // markers shrink as the map zooms out
// a place's category: Google Places types first (primaryType, then types[]) through an explicit table; a word-boundary
// keyword guess only when no type maps (a type label like "Coffee shop", or a plan/booking name)
const GT_CAT = {
  lodging: 'hotels', hotel: 'hotels', motel: 'hotels', hostel: 'hotels', resort_hotel: 'hotels', japanese_inn: 'hotels', inn: 'hotels', guest_house: 'hotels', bed_and_breakfast: 'hotels', extended_stay_hotel: 'hotels', budget_japanese_inn: 'hotels', capsule_hotel: 'hotels', farmstay: 'hotels', cottage: 'hotels', private_guest_room: 'hotels', campground: 'hotels',
  cafe: 'cafes', coffee_shop: 'cafes', bakery: 'cafes', tea_house: 'cafes', cafeteria: 'cafes', cat_cafe: 'cafes', dog_cafe: 'cafes', dessert_shop: 'cafes', pastry_shop: 'cafes', confectionery: 'cafes', ice_cream_shop: 'cafes', juice_shop: 'cafes', donut_shop: 'cafes', chocolate_shop: 'cafes', bagel_shop: 'cafes', acai_shop: 'cafes', candy_store: 'cafes',
  bar: 'bars', pub: 'bars', night_club: 'bars', wine_bar: 'bars', cocktail_bar: 'bars', sports_bar: 'bars', lounge_bar: 'bars', irish_pub: 'bars', beer_garden: 'bars', brewpub: 'bars', brewery: 'bars', winery: 'bars', hookah_bar: 'bars', karaoke: 'tours',
  restaurant: 'restaurants', food: 'restaurants', meal_takeaway: 'restaurants', meal_delivery: 'restaurants', food_court: 'restaurants', diner: 'restaurants', steak_house: 'restaurants', bar_and_grill: 'restaurants', deli: 'restaurants', bistro: 'restaurants', buffet_restaurant: 'restaurants', sandwich_shop: 'restaurants', snack_bar: 'restaurants', noodle_shop: 'restaurants', yakitori_restaurant: 'restaurants',
  museum: 'sights', art_gallery: 'sights', tourist_attraction: 'sights', historical_landmark: 'sights', historical_place: 'sights', monument: 'sights', cultural_landmark: 'sights', church: 'sights', hindu_temple: 'sights', buddhist_temple: 'sights', shinto_shrine: 'sights', place_of_worship: 'sights', mosque: 'sights', synagogue: 'sights', castle: 'sights', palace: 'sights', observation_deck: 'sights', sculpture: 'sights', plaza: 'sights', garden: 'sights', botanical_garden: 'sights', cultural_center: 'sights', visitor_center: 'sights', art_studio: 'sights', auditorium: 'sights',
  tour_agency: 'tours', travel_agency: 'tours', tourist_information_center: 'tours', amusement_park: 'tours', amusement_center: 'tours', aquarium: 'tours', zoo: 'tours', wildlife_park: 'tours', water_park: 'tours', park: 'tours', national_park: 'tours', state_park: 'tours', city_park: 'tours', hiking_area: 'tours', beach: 'tours', marina: 'tours', ski_resort: 'tours', spa: 'tours', public_bath: 'tours', sauna: 'tours', bowling_alley: 'tours', movie_theater: 'tours', performing_arts_theater: 'tours', concert_hall: 'tours', opera_house: 'tours', stadium: 'tours', arena: 'tours', event_venue: 'tours', escape_room: 'tours', video_arcade: 'tours', casino: 'tours', golf_course: 'tours', ferris_wheel: 'tours', roller_coaster: 'tours', planetarium: 'tours', cooking_school: 'tours', adventure_sports_center: 'tours',
  shopping_mall: 'shopping', department_store: 'shopping', market: 'shopping', supermarket: 'shopping', grocery_store: 'shopping', convenience_store: 'shopping', gift_shop: 'shopping', store: 'shopping', book_store: 'shopping', clothing_store: 'shopping', pharmacy: 'shopping', drugstore: 'shopping', flea_market: 'shopping', farmers_market: 'shopping', outlet_mall: 'shopping', asian_grocery_store: 'shopping', food_store: 'shopping', liquor_store: 'shopping',
  airport: 'transport', international_airport: 'transport', train_station: 'transport', subway_station: 'transport', bus_station: 'transport', transit_station: 'transport', light_rail_station: 'transport', ferry_terminal: 'transport', car_rental: 'transport', taxi_stand: 'transport', bus_stop: 'transport', heliport: 'transport',
};
const gtCat = (t) => { t = String(t || '').toLowerCase(); if (!t) return ''; if (GT_CAT[t]) return GT_CAT[t];
  if (/_restaurant$/.test(t)) return 'restaurants'; if (/_(bar|pub)$/.test(t)) return 'bars'; if (/_(cafe|coffee_shop|bakery)$/.test(t)) return 'cafes';
  if (/_(hotel|inn|lodging)$/.test(t)) return 'hotels'; if (/_(store|mall|market|shop)$/.test(t)) return 'shopping'; if (/_(museum|gallery|temple|shrine|church|landmark)$/.test(t)) return 'sights';
  if (/_(station|airport)$/.test(t)) return 'transport'; if (/_(park|tour)$/.test(t)) return 'tours'; return ''; };
function ccKeyword(s) {
  s = ' ' + String(s || '').toLowerCase().replace(/_/g, ' ') + ' ';
  if (/\b(lodging|hotel|hostel|motel|ryokan|guest ?house|resort|inn|check[- ]?in)s?(?![a-zà-ÿ])/.test(s)) return 'hotels';
  if (/\b(cafe|café|coffee|coffee shop|tea house|bakery|kissa|patisserie)s?(?![a-zà-ÿ])/.test(s)) return 'cafes';
  if (/\b(restaurants?|dinner|lunch|breakfast|brunch|food|meal|ramen|sushi|yakitori|izakaya|takoyaki|okonomiyaki|diner|steak ?house|pizza|noodles?|bistro|eatery|trattoria|tasting)s?(?![a-zà-ÿ])/.test(s)) return 'restaurants';
  if (/\b(bar|pub|wine bar|brewery|night ?club|cocktails?|beer|sake)s?(?![a-zà-ÿ])/.test(s)) return 'bars';
  if (/\b(airport|station|train|shinkansen|transit|subway|bus|ferry|car rental|rent-a-car|flight|fly|land at)s?(?![a-zà-ÿ])/.test(s)) return 'transport';
  if (/\b(shopping|store|market|mall|shop|boutique|department store|outlet)s?(?![a-zà-ÿ])/.test(s)) return 'shopping';
  if (/\b(tours?|travel agency|tour agency|experiences?|amusement|aquarium|zoo|spa|onsen|theater|theatre|karaoke|class|workshop|activity|tickets?|teamlab|cruise)s?(?![a-zà-ÿ])/.test(s)) return 'tours';
  if (/\b(tourist|museum|gallery|park|temple|shrine|church|landmark|monument|castle|attraction|viewpoint|garden|scenic|historical|sight|tower|palace|grove|ji)s?(?![a-zà-ÿ])/.test(s)) return 'sights';
  return '';
}
function ccCatOfTypes(types, label) {
  for (const t of types || []) { const c = gtCat(t); if (c) return c; }
  return ccKeyword(label);
}
// ---- state per trip per guest (this device): scope 'nearby' (what Nearby searches) and 'trip' (My trip + Itinerary) ----
let ccLive = false; // a guest view (not the builder preview): selections go into the address bar
const ccKey = (cfg, sc) => `cc:${sc}:${syncKey(cfg)}`;
const ccGet = (cfg, sc) => LS.get(ccKey(cfg, sc), null) || {};
function ccSet(cfg, sc, patch, url = true) { const x = { ...ccGet(cfg, sc), ...patch }; LS.set(ccKey(cfg, sc), x); if (url) ccURL(x); return x; }
const ccCities = (cfg) => { const ss = stopsOf(cfg).length > 1 ? hotelStops(cfg) : []; return ss.length > 1 ? ss.map((s, i) => ({ i, k: ccSlug(cityLabel(s)), l: cityLabel(s), id: s.legs[0] ? s.legs[0].id : '' })) : []; };
const ccSlug = (s) => slug(s) || String(s || '').trim().toLowerCase(); // 京都 stays 京都
const ccCityIdx = (cfg, k) => k ? ccCities(cfg).findIndex(c => c.k === ccSlug(k) || ccSlug(c.l) === ccSlug(k)) : -1;
function ccURL(x) {
  if (!ccLive) return; const q = new URLSearchParams(location.search);
  if (x.city) q.set('city', x.city); else q.delete('city'); if (x.cat) q.set('cat', x.cat); else q.delete('cat');
  const s = q.toString(); history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash);
}
// ?city=kyoto&cat=restaurants → both scopes; true when the link asked for something
function ccFromURL(cfg) {
  const q = new URLSearchParams(location.search); const c = q.get('city'), k = ccCatId(q.get('cat')); const ci = ccCityIdx(cfg, c);
  if (ci < 0 && !k) return false;
  const p = {}; if (ci >= 0) p.city = ccCities(cfg)[ci].k; if (k) p.cat = k;
  ccSet(cfg, 'trip', k ? { ...p, cats: [k], cat: '', tsub: [] } : p, false); ccSet(cfg, 'nearby', k === 'transport' ? { city: p.city || ccGet(cfg, 'nearby').city || '' } : p, false);
  return true;
}
// ---- the pieces ----
// city tabs (tap to switch) and category chips (icon + label in the category's color; tap the active one again to clear)
const ccTabs = (o) => `<div class="cc-tabs" role="tablist" aria-label="${esc(o.aria)}" data-dd="${esc(o.key)}">${o.opts.map(x => `<button type="button" role="tab" class="cc-tab" data-dd-v="${esc(x.v)}" aria-selected="${x.v === o.value}">${esc(x.l)}</button>`).join('')}</div>`;
const ccChips = (o) => `<div class="cc-chips${o.cls === 'cc-subs' ? ' cc-subs' : ''}" role="group" aria-label="${esc(o.aria)}" data-dd="${esc(o.key)}">${o.opts.map(x => `<button type="button" class="cc-chip" data-dd-v="${esc(x.v)}" aria-pressed="${o.values ? o.values.includes(x.v) : x.v === o.value}" style="--cc:${x.ic === 'all' ? 'var(--ink)' : ccColor(x.ic)}">${x.ic ? ccIcon(x.ic) : ''}<span>${esc(x.l)}</span>${x.n != null ? `<small>${x.n}</small>` : ''}</button>`).join('')}</div>`;
// a tap on a city tab / category chip fires a bubbling 'dd' event { key, v } from its row
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-dd-v]'); if (!o) return; const dd = o.closest('[data-dd]'); if (!dd) return;
  dd.dispatchEvent(new CustomEvent('dd', { bubbles: true, detail: { key: dd.dataset.dd, v: o.dataset.ddV } }));
});
// the bar: drawn once (the search box keeps focus); its row, pills and sheet are refilled on every change
const ccShell = (id, search) => `<div class="ccb" data-ccb="${esc(id)}"><div class="ccb-row" data-ccb-row></div><div class="ccb-row2">${search || ''}<span class="ccb-fs" data-ccb-f></span></div><div class="ccb-pills" data-ccb-pills></div><dialog class="cc-sheet" data-ccb-sheet aria-label="${esc(t('Filters'))}"></dialog></div>`;
const ccFiltersBtn = (n, off) => `<button type="button" class="ccb-f${n ? ' set' : ''}" data-cc-filters aria-haspopup="dialog" aria-label="${esc(n ? t('Filters') + ' (' + n + ')' : t('Filters'))}"${off ? ' disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4"/></svg><span class="dd-l">${esc(t('Filters'))}</span>${n ? `<b class="ccb-n">${n}</b>` : ''}</button>`;
const ccPills = (ps, clear) => ps.map(([k, l]) => `<button type="button" class="pill" data-cc-pill="${esc(k)}" aria-label="${esc(t('Remove {s}', { s: l }))}"><span>${esc(l)}</span><i aria-hidden="true">×</i></button>`).join('') + (ps.length > 1 ? `<button type="button" class="link pill-clear" ${clear}>${esc(t('Clear all'))}</button>` : '');
const ccSheet = (body, done, clear) => `<div class="cc-in"><div class="cc-top"><h2>${esc(t('Filters'))}</h2><button type="button" class="x" data-cc-close aria-label="${esc(t('Close'))}">×</button></div><div class="cc-body">${body}</div><div class="cc-foot"><button type="button" class="btn" ${clear}>${esc(t('Clear filters'))}</button><button type="button" class="btn primary" data-cc-close>${esc(done)}</button></div></div>`;
const ccGroup = (label, inner) => `<div class="cc-g"><h3>${esc(label)}</h3><div class="chips">${inner}</div></div>`;
const ccChip = (on, attrs, label) => `<button type="button" class="chip ${on ? 'on' : ''}" ${attrs} aria-pressed="${!!on}">${label}</button>`;
function ccFill(box, { row, filt, pills, sheet }) {
  const r = box.querySelector('[data-ccb-row]'), p = box.querySelector('[data-ccb-pills]'), s = box.querySelector('[data-ccb-sheet]'), fb = box.querySelector('[data-ccb-f]');
  if (r) { const xs = [...r.querySelectorAll('.cc-tabs, .cc-chips')].map(x => x.scrollLeft); r.innerHTML = row; r.hidden = !row;
    [...r.querySelectorAll('.cc-tabs, .cc-chips')].forEach((x, i) => { x.scrollLeft = xs[i] || 0; const a = x.querySelector('[aria-selected="true"],[aria-pressed="true"]'); if (a && (a.offsetLeft < x.scrollLeft || a.offsetLeft + a.offsetWidth > x.scrollLeft + x.clientWidth)) x.scrollLeft = a.offsetLeft - 12; }); }
  if (fb) fb.innerHTML = filt || '';
  if (p) { p.innerHTML = pills; p.hidden = !pills; }
  if (s) { const sc = s.querySelector('.cc-body'); const y = sc ? sc.scrollTop : 0; s.innerHTML = sheet; const sc2 = s.querySelector('.cc-body'); if (sc2) sc2.scrollTop = y; }
}
document.addEventListener('click', (e) => {
  const f = e.target.closest('[data-cc-filters]');
  if (f) { const d = f.closest('.ccb').querySelector('[data-ccb-sheet]'); if (d && !d.open) d.showModal(); return; }
  const d = e.target.closest('dialog.cc-sheet'); if (!d) return;
  if (e.target === d || e.target.closest('[data-cc-close]')) d.close();
});
// ---- a My trip / Itinerary item's city and category ----
const PL_CAT_TYPE = { restaurants: 'food', cafes: 'food', bars: 'food', sights: 'activity', tours: 'activity', shopping: 'other', hotels: 'stay', transport: 'transport' };
function ccCatOfPlan(x) {
  if (x.cat === 'other') return ''; const c = ccCatId(x.cat); if (c) return c; if (x.hotel) return 'hotels';
  const g = ccCatOfTypes([], x.name); const ty = x.type || 'other';
  if (ty === 'stay') return 'hotels'; if (ty === 'transport') return 'transport';
  if (ty === 'food') return g === 'cafes' || g === 'bars' ? g : 'restaurants';
  if (ty === 'activity') return g === 'tours' ? 'tours' : 'sights';
  return g;
}
const BK_CAT = { flight: 'transport', train: 'transport', car: 'transport', bus: 'transport', taxi: 'transport', ferry: 'transport', hotel: 'hotels', stay: 'hotels', food: 'restaurants', tour: 'tours' };
const ccCatOfBooking = (x) => BK_CAT[x.kind] || ccCatOfTypes([], x.name) || (tSubOfText([x.name, x.flight].join(' ')) ? 'transport' : '');
const ccCatOfEv = (x) => ccCatOfTypes([], x.title || x.name) || (tSubOfText(x.title || x.name) ? 'transport' : '') || (x.kind === 'activity' ? 'sights' : '');
// ---- transport subtypes (Dylan 11/25: "Flight has a picture of a train ... different icons for cars, trains, bus, taxi,
// flights"): one Transport category, each item a subtype with its own icon. A booking's Type says it (Flight, Train,
// Bus, Rental car, Taxi or rideshare, Ferry); else it is read from the words: ferry/boat → taxi/rideshare → bus/coach →
// train/rail/Shinkansen/JR → rental-car companies → flight words / an airline's flight number (UA 7924) / airport.
const TSUBS = [['flight', 'Flights'], ['train', 'Trains'], ['bus', 'Bus'], ['car', 'Rental car'], ['taxi', 'Taxi or rideshare'], ['ferry', 'Ferry'], ['other', 'Other']];
const TSUB_KIND = { flight: 'flight', train: 'train', bus: 'bus', car: 'car', taxi: 'taxi', ferry: 'ferry' };
function tSubOfText(raw) {
  raw = String(raw || ''); const s = ' ' + raw.toLowerCase() + ' ';
  if (/\b(ferry|ferries|boat|hydrofoil|catamaran|jetfoil|water ?bus|water taxi)\b/.test(s)) return 'ferry';
  if (/\b(taxi|taxis|cab|uber|lyft|rideshare|ride[- ]share|grab|didi|car service|chauffeur|limo|private transfer)\b/.test(s)) return 'taxi';
  if (/\b(bus|buses|coach|shuttle|highway bus|willer|greyhound|flixbus|megabus|limousine bus)\b/.test(s)) return 'bus';
  if (/\b(train|trains|rail|railway|shinkansen|jr|amtrak|eurostar|nozomi|hikari|kodama|mizuho|kagayaki|hakutaka|thunderbird|haruka|narita express|skyliner|limited express|subway|metro|tram|monorail)\b/.test(s)) return 'train';
  if (/\b(rental car|car rental|rent[- ]a[- ]car|hire car|car hire|hertz|avis|sixt|europcar|alamo|enterprise rent|thrifty|toyota rent|times car|orix rent|nippon rent|budget rent)\b/.test(s)) return 'car';
  if (/\b(flight|flights|fly|flying|airlines?|airways|land at|landing at|layover|boarding)\b/.test(s)) return 'flight';
  if ((raw.match(/\b[A-Z0-9]{2} ?\d{1,4}\b/g) || []).some(m => /[A-Z]/.test(m.slice(0, 2)) && typeof AIRLINES !== 'undefined' && AIRLINES[m.slice(0, 2)])) return 'flight';
  if (/\bairport\b/.test(s)) return 'flight';
  return '';
}
const tSub = (x) => !x ? 'other' : TSUB_KIND[x.kind] || (TSUBS.some(y => y[0] === x.tsub) ? x.tsub : '') || tSubOfText([x.name, x.title, x.flight].filter(Boolean).join(' ')) || 'other';
// the icon key for an item: its category, a transport item's own subtype
const ccIk = (cat, x) => cat !== 'transport' ? cat : (k => k === 'other' ? 'transport' : k)(tSub(x));
function ccCityOfPlan(cfg, x) {
  if (ccCities(cfg).length < 2) return 0;
  if (x.lat != null) return spotCity(cfg, x); return x.day ? stopOfDay(cfg, x.day) : -1;
}
function ccCityOfBooking(cfg, x) {
  if (ccCities(cfg).length < 2) return 0;
  if (LODGE.has(x.kind)) { const c = bkCity(cfg, x); return c < 0 ? -1 : c; }
  const g = x.lat != null ? x : null; if (g && x.kind !== 'flight') return nearestStop(cfg, g);
  return bkDay(x.start) ? stopOfDay(cfg, bkDay(x.start)) : -1;
}
// My trip's category chips (Dylan 11/25): Hotels, then Transport, then Restaurants, then the rest; several at once
// (flights + trains + hotels together); Hotels until the guest picks (when they have one). st.cats: [] = All.
// Activities (Dylan 11/25: "it might be nice to have activities as an option along with hotels, transportation, and
// restaurants"): one chip for sights + things to do (tours, museums, temples, parks…); the four main chips always show.
const TRIP_CATS = ['hotels', 'transport', 'restaurants', 'activities', 'cafes', 'bars', 'shopping'];
const TRIP_CORE = ['hotels', 'transport', 'restaurants', 'activities'];
const tripCat = (c) => c === 'sights' || c === 'tours' ? 'activities' : c;
function ccTripCats(cfg, st) {
  const ok = (xs) => [...new Set(xs.map(k => tripCat(k === 'activities' ? k : ccCatId(k))).filter(Boolean))];
  if (Array.isArray(st.cats)) return ok(st.cats);
  if (st.cat) return ok([st.cat]); // a choice from before multi-select / a ?cat= link
  return typeof itineraryEntries === 'function' && itineraryEntries(cfg).some(x => x.cc === 'hotels') ? ['hotels'] : [];
}
// the trip scope's filter: { on, ok(item) } for items { city, cat, sub, text, saved, booked, host }
function ccTrip(cfg) {
  const st = ccGet(cfg, 'trip'); const ci = ccCityIdx(cfg, st.city); const cats = ccTripCats(cfg, st); const cat = cats.length === 1 ? cats[0] : '';
  const tsubs = cats.includes('transport') && Array.isArray(st.tsub) ? st.tsub.filter(k => TSUBS.some(y => y[0] === k)) : [];
  const q = String(st.q || '').trim(); const show = st.show || '';
  const rest = (it) => (ci < 0 || it.city === ci) && (!q || lfMatch(q, it.text)) && (!show || (show === 'saved' ? it.saved : show === 'booked' ? it.booked : show === 'host' ? it.host : true));
  const subOk = (it) => it.cat !== 'transport' || !tsubs.length || tsubs.includes(it.sub || 'other');
  return { st, ci, cat, cats, tsubs, q, show, on: ci >= 0 || !!cats.length || !!q || !!show, sub: !!cats.length || !!q || !!show, rest, subOk,
    ok: (it) => rest(it) && (!cats.length || cats.includes(tripCat(it.cat))) && subOk(it) };
}
const ccBkItem = (cfg, x) => ({ city: ccCityOfBooking(cfg, x), cat: ccCatOfBooking(x), sub: tSub(x), text: [x.name, x.address, x.confNo, t(ITIN_KINDS[x.kind] || '')].filter(Boolean).join(' '), saved: false, booked: true });
// the trip Itinerary gets the bar when there is something to narrow down: several cities, or a long list
const ccItinOn = (cfg) => isTrip(cfg) && (ccCities(cfg).length > 1 || (cfg.schedule || []).length + (cfg.tools.mytrip ? itinLoad(cfg).length + planLoad(cfg).length : 0) >= 8);
const ccNoneHTML = () => `<p class="muted cc-none">${t('Nothing matches these filters.')} <button type="button" class="link" data-cct-clear>${t('Clear filters')}</button></p>`;

// ================= Nearby from Google Places (when a key is set): list + pins + tappable map POIs → in-app card =================
// One request per category / cuisine / dietary search, cached per event for 3 days. Open now, rating and price filter
// the cached results in the browser, so changing them costs nothing. OpenStreetMap stays as the fallback.
const GP_CATS = [['restaurants', 'Restaurants', ['restaurant'], 1500], ['cafes', 'Cafés', ['cafe', 'coffee_shop'], 1500], ['bars', 'Bars', ['bar', 'pub', 'wine_bar'], 1500],
  ['sights', 'Sights', ['tourist_attraction', 'museum', 'art_gallery', 'historical_landmark'], 4000], ['tours', 'Things to do', null, 8000, 'tours and experiences'],
  ['shopping', 'Shopping', ['shopping_mall', 'department_store', 'market', 'gift_shop'], 2500], ['hotels', 'Hotels', ['lodging'], 3000]];
const GP_FOOD = new Set(['restaurants', 'cafes', 'bars']);
const GP_CUISINES = ['american', 'barbecue', 'brazilian', 'breakfast', 'brunch', 'chinese', 'french', 'greek', 'hamburger', 'indian', 'indonesian', 'italian', 'japanese', 'korean', 'lebanese', 'mediterranean', 'mexican', 'middle_eastern', 'pizza', 'ramen', 'seafood', 'spanish', 'steak_house', 'sushi', 'thai', 'turkish', 'vegan', 'vegetarian', 'vietnamese'];
const gpCuisineType = (c) => c === 'steak_house' ? 'steak_house' : c + '_restaurant';
const GP_DIETS = [['vegetarian', 'Vegetarian', 'vegetarian'], ['vegan', 'Vegan', 'vegan'], ['gluten_free', 'Gluten-free', 'gluten free'], ['halal', 'Halal', 'halal'], ['kosher', 'Kosher', 'kosher']];
const GP_LIST_MASK = 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.primaryType,places.primaryTypeDisplayName,places.types,places.currentOpeningHours.openNow,places.shortFormattedAddress';
// business websites from Google often carry the owner's utm_ tags; guests get the plain address (no tracking params on outbound links)
const cleanWeb = (u) => { if (!u) return ''; try { const x = new URL(u); [...x.searchParams.keys()].filter(k => /^(utm_|gclid$|fbclid$|msclkid$|mc_)/i.test(k)).forEach(k => x.searchParams.delete(k)); return x.href; } catch { return u; } };
const GP_CARD_MASK = 'id,displayName,location,formattedAddress,rating,userRatingCount,priceLevel,primaryTypeDisplayName,regularOpeningHours.weekdayDescriptions,currentOpeningHours.openNow,websiteUri,nationalPhoneNumber,internationalPhoneNumber,googleMapsUri,photos,servesVegetarianFood,reservable,types,primaryType';
let gpBroken = false; // set when the Places API refuses (quota, key): pages fall back to OpenStreetMap
const gpRow = (x, v) => ({ id: x.id, name: (x.displayName && x.displayName.text) || '', lat: x.location && x.location.latitude, lon: x.location && x.location.longitude,
  rating: x.rating || 0, count: x.userRatingCount || 0, price: G_PRICE[x.priceLevel] || '', type: (x.primaryTypeDisplayName && x.primaryTypeDisplayName.text) || '', ptype: x.primaryType || '', types: x.types || [],
  open: x.currentOpeningHours ? !!x.currentOpeningHours.openNow : null, addr: x.shortFormattedAddress || x.formattedAddress || '',
  d: x.location ? distM(v.lat, v.lon, x.location.latitude, x.location.longitude) : 0 });
function gpQueryKey(f) { if (f.q) return `q:${f.q.toLowerCase()}:${f.diet}`; return f.diet ? `diet:${f.cat}:${f.diet}` : f.cuisine && f.cat === 'restaurants' ? `cuisine:${f.cuisine}` : `cat:${f.cat}`; }
function gpSearch(cfg, f, center) {
  const v = center || cfg.venue; const qk = gpQueryKey(f); const key = `gq3:${osmKey(v.lat, v.lon)}${v.r ? ':r' + v.r : ''}:${qk}`;
  const c = LS.get(key); if (c && (Date.now() - c.t < G_TTL || navigator.onLine === false)) return Promise.resolve(c.d);
  if (memo.has(key)) return memo.get(key);
  const cat = GP_CATS.find(x => x[0] === f.cat) || GP_CATS[0]; const rad = v.r || cat[3]; const circle = { center: { latitude: v.lat, longitude: v.lon }, radius: rad };
  let req;
  if (f.q) {
    const diet = f.diet ? GP_DIETS.find(x => x[0] === f.diet)[2] + ' ' : '';
    req = gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: diet + f.q, maxResultCount: 20, locationBias: { circle: { center: { latitude: v.lat, longitude: v.lon }, radius: v.r || 5000 } } }, GP_LIST_MASK);
  } else if (f.diet) {
    const noun = { cafes: 'cafes', bars: 'bars' }[f.cat] || 'restaurants';
    req = gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: `${GP_DIETS.find(x => x[0] === f.diet)[2]} ${noun}`, maxResultCount: 20, locationBias: { circle } }, GP_LIST_MASK);
  } else if (cat[4]) { // Things to do: tour companies and experiences are only found by text
    req = gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: cat[4], maxResultCount: 20, locationBias: { circle } }, GP_LIST_MASK);
  } else {
    const types = f.cuisine && f.cat === 'restaurants' ? [gpCuisineType(f.cuisine)] : cat[2];
    req = gFetch('https://places.googleapis.com/v1/places:searchNearby', { includedTypes: types, maxResultCount: 20, locationRestriction: { circle } }, GP_LIST_MASK);
  }
  const from = v.anchor || v; // an area search still measures distance from the venue (or the trip stop)
  const p = req.then(j => { let d = (j.places || []).map(x => gpRow(x, from)).filter(x => x.lat != null && (f.q || distM(v.lat, v.lon, x.lat, x.lon) <= rad * (v.r ? 1.2 : 1.8)));
    if (f.q) { const near = d.filter(x => distM(v.lat, v.lon, x.lat, x.lon) <= Math.max(40000, (v.r || 0) * 1.5)); if (near.length) d = near; } // “ramen” with Kyoto chosen: Kyoto's ramen
    LS.set(key, { t: Date.now(), d }); return d; })
    .catch(e => { if (c && !/places 4/.test(e.message)) return c.d; throw e; }); // offline: the last list
  memo.set(key, p); p.catch(() => memo.delete(key)); return p;
}
function gpDetails(id, session) {
  const key = 'gc3:' + id; const c = LS.get(key); if (c && Date.now() - c.t < G_TTL) return Promise.resolve(c.d);
  return gFetch(`https://places.googleapis.com/v1/places/${enc(id)}${session ? '?sessionToken=' + enc(session) : ''}`, null, GP_CARD_MASK).then(x => {
    const ph = (x.photos || []).slice(0, 4).map(p => ({ name: p.name, by: p.authorAttributions && p.authorAttributions[0] ? p.authorAttributions[0].displayName || '' : '' }));
    const d = { id: x.id, name: (x.displayName && x.displayName.text) || '', lat: x.location && x.location.latitude, lon: x.location && x.location.longitude, addr: x.formattedAddress || '',
      rating: x.rating || 0, count: x.userRatingCount || 0, price: G_PRICE[x.priceLevel] || '', type: (x.primaryTypeDisplayName && x.primaryTypeDisplayName.text) || '',
      hours: (x.regularOpeningHours && x.regularOpeningHours.weekdayDescriptions) || [], open: x.currentOpeningHours ? !!x.currentOpeningHours.openNow : null,
      web: cleanWeb(x.websiteUri), phone: x.internationalPhoneNumber || x.nationalPhoneNumber || '', phoneLocal: x.nationalPhoneNumber || '', url: x.googleMapsUri || '', photos: ph,
      veg: !!x.servesVegetarianFood, reservable: !!x.reservable, food: (x.types || []).some(t => /restaurant|food|meal/.test(t)), types: x.types || [], ptype: x.primaryType || '' };
    LS.set(key, { t: Date.now(), d }); return d;
  });
}
// Sights / Things to do by kind (Dylan 11/25: "for activities, is there a way to sort through them?"): each Google row
// gets one kind from its own types (primary type first), else from its name; the chips show only kinds in the list.
const ACT_CATS = new Set(['sights', 'tours']);
const ACT_KINDS = [
  ['tours', 'Tours', /^(tour_agency|travel_agency|tourist_information_center|sightseeing_tour_agency|adventure_sports_center|cooking_class)$/, /\b(tours?|experiences?|class(es)?|workshops?|cruises?|walks?)\b|ツアー|体験/i],
  ['museums', 'Museums', /museum|gallery|planetarium/, /\b(museums?|galler(y|ies))\b|美術館|博物館|記念館/i],
  ['landmarks', 'Temples & landmarks', /temple|shrine|church|mosque|synagogue|place_of_worship|landmark|historical|monument|castle|palace|observation_deck|viewpoint|sculpture|plaza|tower|bridge|memorial/, /\b(temples?|shrines?|castles?|palaces?|towers?|monuments?|cathedral|church|basilica|pagoda|gate)\b|寺|神社|城|塔|大社|宮/i],
  ['outdoors', 'Parks & outdoors', /^(park|city_park|state_park|national_park|garden|botanical_garden|hiking_area|beach|marina|ski_resort|nature_preserve|scenic_spot|lake|island|mountain_peak|picnic_ground|dog_park|campground)$|_park$|garden/, /\b(parks?|gardens?|trails?|beach|grove|falls|lake|mountain|hike|forest)\b|公園|庭園|山/i],
  ['family', 'Zoos & theme parks', /amusement|aquarium|zoo|water_park|wildlife|theme_park|bowling|arcade|go_karting|miniature_golf/, /\b(aquarium|zoo|teamlab|disney|universal|theme park|amusement|arcade)\b|水族館|動物園/i],
  ['shows', 'Shows & nightlife', /theater|theatre|concert|night_club|karaoke|casino|comedy|live_music|movie|opera|stadium|arena|event_venue|philharmonic|cultural_center|convention_center|auditorium/, /\b(theat(er|re)|concerts?|karaoke|kabuki|show|club|live)\b|劇場/i],
  ['wellness', 'Spas & baths', /spa|sauna|public_bath|massage|wellness|hot_spring/, /\b(spa|onsen|sauna|bath|sento)\b|温泉|銭湯/i],
  ['shopping', 'Shopping', /shopping|market|store|mall|_shop$/, /\b(market|shopping|mall|arcade street)\b|市場|商店街/i]];
const ACT_MATCH = ['tours', 'museums', 'family', 'landmarks', 'outdoors', 'shows', 'wellness', 'shopping'].map(k => ACT_KINDS.find(x => x[0] === k)); // amusement_park is a theme park, not a park
function actKind(r) {
  for (const ty of [r.ptype, ...(r.types || [])].filter(Boolean)) { const k = ACT_MATCH.find(x => x[2].test(ty)); if (k) return k[0]; }
  const n = [r.name, r.type].join(' '); const k = ACT_MATCH.find(x => x[3].test(n)); return k ? k[0] : 'other';
}
const actOn = (f) => ACT_CATS.has(f.cat) && !f.q;
const gpNameSort = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), LANG, { sensitivity: 'base', numeric: true });
function gpFilter(rows, f, noKinds) {
  const ks = !noKinds && actOn(f) && Array.isArray(f.types) ? f.types : [];
  const xs = rows.filter(r => (!f.open || r.open === true) && (!f.stars || r.rating >= f.stars) && (!f.price || r.price === f.price) && (!f.dist || r.d <= f.dist) && (!ks.length || ks.includes(actKind(r))));
  return f.sort === 'rating' ? lfSort(xs, 'rating') : f.sort === 'name' ? xs.slice().sort(gpNameSort) : xs;
}
// the kind chips under the category row: each chip's number = the rows it lists with the other filters as they are
function actChipsHTML(rows, f) {
  if (!actOn(f) || !rows || !rows.length) return '';
  const n = {}; gpFilter(rows, f, true).forEach(r => { const k = actKind(r); n[k] = (n[k] || 0) + 1; });
  const ks = ACT_KINDS.map(x => x[0]).concat('other').filter(k => n[k] || (f.types || []).includes(k));
  if (ks.length < 2 && !(f.types || []).length) return '';
  return ccChips({ key: 'atype', aria: t('Kind'), values: f.types || [], cls: 'cc-subs', opts: ks.map(k => ({ v: k, l: k === 'other' ? t('Other') : t((ACT_KINDS.find(x => x[0] === k) || [0, k])[1]), n: n[k] || 0 })) });
}
// which icon a Google row gets: the place's own Google type (a Cafés search also returns museums and hotels that have a
// café); the chosen category only when Google gives no usable type
const gpRowCat = (f, r) => ccCatOfTypes([r.ptype, ...(r.types || [])], r.type) || (!f.q && f.cat) || '';
const gpActive = (f) => (f.cuisine ? 1 : 0) + (f.diet ? 1 : 0) + (f.open ? 1 : 0) + (f.stars ? 1 : 0) + (f.price ? 1 : 0) + (f.dist ? 1 : 0) + (f.sort && f.sort !== 'dist' ? 1 : 0);
function gpSheetHTML(cfg, f, n) {
  const food = GP_FOOD.has(f.cat) || (!!f.q && !f.cat); const priced = f.cat !== 'sights' && f.cat !== 'tours';
  const body = [
    ccGroup(t('Sort by'), [['dist', t('Distance')], ['rating', t('Rating')], ['name', t('Name')]].map(([k, l]) => ccChip((f.sort || 'dist') === k, `data-gp-sort="${k}"`, esc(l))).join('')),
    ccGroup(t('Hours'), ccChip(f.open, 'data-gp-open', esc(t('Open now')))),
    ccGroup(t('Rating'), [4, 4.5].map(x => ccChip(f.stars === x, `data-gp-stars="${x}"`, `★ ${nfix(x, 1)}+`)).join('')),
    priced ? ccGroup(t('Price'), ['$', '$$', '$$$', '$$$$'].map(pr => ccChip(f.price === pr, `data-gp-price="${pr}"`, esc(priceSym(cfg, pr)))).join('')) : '',
    ccGroup(t('Distance'), DISTS.slice(1).map(([m, l]) => ccChip(f.dist === m, `data-gp-dist="${m}"`, esc(t(l)))).join('')),
    food ? `<div class="cc-g cc-sels">${f.cat === 'restaurants' ? `<label class="field"><span>${t('Cuisine')}</span><select data-gp="cuisine" ${f.diet ? 'disabled' : ''}><option value="">${t('Any cuisine')}</option>${GP_CUISINES.map(c => `<option value="${c}" ${f.cuisine === c ? 'selected' : ''}>${esc(cuisineLabel(c))}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>${t('Dietary')}</span><select data-gp="diet"><option value="">${t('Any dietary need')}</option>${GP_DIETS.map(([k, l]) => `<option value="${k}" ${f.diet === k ? 'selected' : ''}>${t(l)}</option>`).join('')}</select></label></div>` : '',
  ].join('');
  return ccSheet(body, n == null ? t('Done') : n === 1 ? t('Show 1 place') : t('Show {n} places', { n }), 'data-gp-clear');
}
function gpPills(cfg, f) {
  const ps = [];
  if (f.cuisine) ps.push(['cuisine', cuisineLabel(f.cuisine)]); if (f.diet) ps.push(['diet', t((GP_DIETS.find(x => x[0] === f.diet) || [0, f.diet])[1])]);
  if (f.open) ps.push(['open', t('Open now')]); if (f.stars) ps.push(['stars', `★ ${nfix(f.stars, 1)}+`]); if (f.price) ps.push(['price', priceSym(cfg, f.price)]);
  if (f.dist) ps.push(['dist', t((DISTS.find(x => x[0] === f.dist) || [0, ''])[1])]); if (f.sort === 'rating') ps.push(['sort', t('Top rated')]); if (f.sort === 'name') ps.push(['sort', t('A–Z')]);
  return ccPills(ps, 'data-gp-clear');
}
function gpHTML(cfg, art, rows) {
  const v = cfg.venue; const f = art._gp; const list = gpFilter(rows || [], f);
  const active = gpActive(f) + (actOn(f) && (f.types || []).length ? 1 : 0); const none = !f.cat && !f.q;
  return `${none ? `<p class="muted gp-none">${t('Pick a category or search for a place.')}</p>` : rows == null ? `<div class="skel" role="status"><span></span><span></span><em>${t('Loading places…')}</em></div>` : `
  ${f.q ? `<p class="gp-q"><span>${esc(t('Results for “{q}”', { q: f.q }))}</span> <button type="button" class="link" data-gp-q-clear>${t('Clear search')}</button></p>` : ''}
  <p class="pf-count muted small" role="status" aria-live="polite">${esc(list.length === 1 ? t('1 place') : t('{n} places', { n: list.length }))}${active ? ` · <button type="button" class="link" data-gp-clear>${t('Clear filters')}</button>` : ''}</p>
  ${list.length ? `<ul class="plist rich places">${list.map(r => `<li class="has-star"><button type="button" class="place-row" data-gplace="${esc(r.id)}">${ccIcon(gpRowCat(f, r))}<div><b>${esc(r.name)}</b>${r.rating ? `<span class="rt">${gRatingHTML(r)}</span>` : ''}<span>${esc([r.type, priceSym(cfg, r.price)].filter(Boolean).join(' · '))}</span>${gpRowCat(f, r) === 'hotels' && myHotelOf(cfg, { ref: r.id, name: r.name, lat: r.lat, lon: r.lon }) ? `<span class="tags"><em class="hs-tag"><img src="${HOTEL_PIN}" alt="">${t('Your hotel')}</em></span>` : r.open != null ? `<span class="tags">${r.open ? `<em class="open">${t('Open now')}</em>` : `<em class="closed">${t('Closed now')}</em>`}</span>` : ''}</div><span class="dist">${esc(fmtDist(r.d, v.cc))}<small>${r.d < 2500 ? walkTxt(r.d) : art._fromHotel ? t('from your hotel') : t('from the venue')}</small></span></button>${starBtnHTML(cfg, r.id, r.name)}</li>`).join('')}</ul>`
    : navigator.onLine === false ? `<p class="muted off-msg"><b>${t('Offline')}</b> · ${t('Searching places needs a connection. Your saved spots are in My trip.')}</p>` : `<p class="muted">${t('Nothing matches these filters.')} ${active ? `<button type="button" class="link" data-gp-clear>${t('Clear filters')}</button>` : ''}</p>`}
  <p class="muted small g-attr">${t('Places and ratings from Google')}</p>`}`;
}
const gPlanPlace = (d) => ({ src: 'g', ref: d.id, name: d.name, lat: d.lat, lon: d.lon, rating: d.rating, count: d.count, addr: d.addr, hours: d.hours, type: d.ptype ? placeType([d.ptype], '') : placeType(d.types, ''), cat: ccCatOfTypes([d.ptype, ...(d.types || [])], d.type) });
function gpCardHTML(cfg, d, art) {
  const v = cfg.venue; const tr = tripDates(cfg); const o = art && art._fromHotel && art._hotelPt ? art._hotelPt : v; const dist = d.lat != null ? distM(o.lat, o.lon, d.lat, d.lon) : 0;
  const dirURL = `https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lon}&destination=${enc(d.name)}&destination_place_id=${enc(d.id)}&travelmode=${dist < 2500 ? 'walking' : 'transit'}`;
  const ph = d.photos[0];
  return `<div class="pc"><button type="button" class="x" data-pc-close aria-label="${t('Close')}">×</button>
    ${ph ? `<figure class="pc-photo"><img src="${esc(gPhotoURL(ph.name))}" alt="${esc(d.name)}" loading="lazy" onerror="this.closest('figure').remove()">${ph.by ? `<figcaption>${esc(t('Photo: {n}', { n: ph.by }))}</figcaption>` : ''}</figure>` : ''}
    ${d.type ? `<p class="lbl">${esc(d.type)}</p>` : ''}
    <h2>${esc(d.name)}</h2>
    ${d.rating ? `<p class="rt">${gRatingHTML(d)} <small class="muted">${t('on Google')}</small></p>` : ''}
    <p class="pc-dist">${esc(t(o === v ? '{d} from the venue' : '{d} from your hotel', { d: fmtDist(dist, v.cc) }))}${dist < 2500 ? ' · ' + walkTxt(dist) : ''}${d.price ? ' · ' + esc(priceSym(cfg, d.price)) : ''}</p>
    ${d.veg ? `<p class="tags"><em>${t('Vegetarian options')}</em></p>` : ''}
    ${d.hours.length ? `<div class="pc-hours"><b>${d.open === true ? `<span class="open">${t('Open now')}</span>` : d.open === false ? `<span class="closed">${t('Closed now')}</span>` : t('Hours')}</b><ul>${d.hours.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
    ${d.addr ? `<p class="pc-addr">${esc(d.addr)}</p>` : ''}
    ${gPlanPlace(d).type === 'stay' ? hsSlotHTML(cfg, gPlanPlace(d)) : planAddHTML(cfg, gPlanPlace(d))}
    <div class="btns sec-acts">${(d.types || []).includes('lodging') ? (() => { const a = hotelBookAction(cfg, { name: d.name, web: d.web, city: '' }); return ext(a.url, a.label, 'btn book'); })() : ''}${ext(dirURL, t('Directions'), 'btn')}${d.food ? bookExt('restaurants', 'opentable', { name: d.name, venue: v, date: cfg.start.slice(0, 10), n: tr.guests || 2 }, t('Reserve') + ' · OpenTable', 'btn') : ''}${d.phone ? `<a class="btn" href="tel:${esc(d.phone.replace(/[^\d+]/g, ''))}">${t('Call')}</a>` : ''}${d.web ? ext(d.web, t('Website'), 'btn') : ''}</div>
    <button type="button" class="link" data-pc-map>${t('Show on map')}</button>
  </div>`;
}
function openPlaceDialog(cfg, html, onMap, place, art) {
  let d = $('#placedlg'); if (!d) { d = document.createElement('dialog'); d.id = 'placedlg'; d.className = 'sheet place-sheet'; document.body.appendChild(d); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); }
  d.setAttribute('style', themeStyle(cfg.theme)); d.classList.toggle('dark', cfg.theme.mode === 'dark'); d.setAttribute('lang', LANG);
  d.innerHTML = html; d.onclick = (e) => { if (hsClick(cfg, art, e)) return; if (place && planCardClick(cfg, art, d, e, place)) return; if (e.target === d || e.target.closest('[data-pc-close]')) d.close(); if (e.target.closest('[data-pc-map]')) { d.close(); onMap && onMap(); } };
  if (!d.open) d.showModal(); return d;
}
// returns false when Google can't be used (no key, refused) so the caller wires the OpenStreetMap list instead
function wireGPlaces(cfg, art, mapCtl, onFail) {
  const s = art.querySelector('[data-slot="food"]'); if (!s || !GKEY || gpBroken || !cfg.venue) return false;
  const bar = art.querySelector('[data-slot="near-cc"]') || s;
  const st0 = ccGet(cfg, 'nearby');
  art._gp = art._gp || { cat: 'cat' in st0 ? ccCatId(st0.cat) : 'restaurants', cuisine: '', diet: '', open: false, stars: 0, price: '', dist: 0, sort: 'dist', q: '', types: [] };
  if (art._gp.cat === 'transport') art._gp.cat = 'restaurants';
  let rows = null, seq = 0, started = false;
  const ss = stopsOf(cfg).length > 1 ? hotelStops(cfg) : []; const cities = ccCities(cfg);
  if (ss.length > 1 && !art._center && art._stop > 0 && ss[art._stop]) { art._center = ss[art._stop]; if (mapCtl) mapCtl.center(ss[art._stop].lat, ss[art._stop].lon, 13); }
  const cityName = () => ss.length > 1 && ss[art._stop] ? ss[art._stop].name || ss[art._stop].city : '';
  const ph = () => cityName() ? t('Search in {c}', { c: cityName() }) : t('Search places, e.g. ramen');
  bar.insertAdjacentHTML(bar === s ? 'afterbegin' : 'beforeend', ccShell('near', `<form class="gp-search ccb-q" role="search" onsubmit="return false"><input type="search" data-gp-q placeholder="${esc(ph())}" aria-label="${t('Search places')}" autocomplete="off" enterkeyhint="search"><button type="submit" class="btn sm" data-gp-go>${t('Search')}</button></form>`));
  if (bar === s) s.insertAdjacentHTML('beforeend', '<div data-gp-body></div>'); else s.innerHTML = '<div data-gp-body></div>';
  const box = bar.querySelector('[data-ccb="near"]');
  const bodyEl = s.querySelector('[data-gp-body]'); const qIn = box.querySelector('[data-gp-q]');
  const v0 = cfg.venue;
  const pinsOf = () => gpFilter(rows || [], art._gp).filter(r => !(gpRowCat(art._gp, r) === 'hotels' && myHotelOf(cfg, { ref: r.id, name: r.name, lat: r.lat, lon: r.lon }))).map(r => ({ lat: r.lat, lon: r.lon, title: r.name, ic: gpRowCat(art._gp, r), onClick: () => art._openGPlace(r.id) }));
  const pickPlace = (id, tok) => gpDetails(id, tok).then(pl => {
    if (mapCtl && pl.lat != null) { mapCtl.setPins(pinsOf().concat([{ lat: pl.lat, lon: pl.lon, title: pl.name, z: 900, ic: ccCatOfTypes([pl.ptype, ...pl.types], pl.type), onClick: () => art._openGPlace(pl.id) }])); mapCtl.focus(pl); }
    openPlaceDialog(cfg, gpCardHTML(cfg, pl, art), () => mapCtl && mapCtl.focus(pl), gPlanPlace(pl), art);
  }).catch(() => toast(t('Couldn’t load this place right now.')));
  const textSearch = (q) => { if (!q) return; art._gp.q = q.slice(0, 80); art._gp.cuisine = ''; qIn.blur(); load(); };
  placeAutocomplete(qIn, { bias: () => art._center || cfg.venue, onPick: pickPlace, onText: textSearch });
  const pins = () => { if (mapCtl) mapCtl.setPins(pinsOf()); };
  art._gpPins = () => { if (rows) { bodyEl.innerHTML = gpHTML(cfg, art, rows); pins(); } };
  art._gpCat = (k) => { const f = art._gp; if (f.cat === k && !f.q) return; f.cat = k; f.cuisine = ''; f.price = ''; f.q = ''; f.types = []; qIn.value = ''; if (!GP_FOOD.has(k)) f.diet = ''; started = true; load(); save(true); };
  const save = (url) => { const c = cities[art._stop]; ccSet(cfg, 'nearby', { city: c ? c.k : '', cat: art._gp.cat }, !!url); }; // the address bar follows the guest's own picks only
  const renderBar = () => {
    const f = art._gp; const n = rows && (f.cat || f.q) ? gpFilter(rows, f).length : null;
    qIn.placeholder = ph();
    ccFill(box, {
      row: (ss.length > 1 ? ccTabs({ key: 'city', aria: t('City'), value: String(art._stop || 0), ph: t('City'), cls: 'dd-city', opts: ss.map((x, i) => ({ v: String(i), l: x.name || x.city })) }) : '')
        + ccChips({ key: 'cat', aria: t('Category'), value: f.q ? '' : f.cat, ph: t('Category'), cls: 'dd-cat', opts: CC_NEAR.map(([k, l]) => ({ v: k, l: t(l), ic: k })) })
        + actChipsHTML(rows, f),
      filt: ccFiltersBtn(gpActive(f), !f.cat && !f.q),
      pills: gpPills(cfg, f), sheet: gpSheetHTML(cfg, f, n) });
  };
  const render = () => { bodyEl.innerHTML = gpHTML(cfg, art, rows); renderBar(); try { pins(); } catch (e) { console.warn(e); } }; // a marker problem never empties the list
  const load = () => {
    const my = ++seq; save(false); if (!art._gp.cat && !art._gp.q) { rows = []; render(); return; } // no category picked: just the map and the search box
    rows = null; render();
    gpSearch(cfg, art._gp, art._center).then(d => { if (my !== seq) return; rows = d; if (art._useSrc) art._useSrc('google'); render(); })
      .catch(e => { if (my !== seq) return; if (/places 4(03|29)|places 400/.test(e.message)) { gpBroken = true; box.remove(); onFail && onFail(); return; } rows = []; render(); });
  };
  art._openGPlace = (id) => {
    const dlg = openPlaceDialog(cfg, `<div class="pc"><button type="button" class="x" data-pc-close aria-label="${t('Close')}">×</button><div class="skel" role="status"><span></span><span></span><em>${t('Loading…')}</em></div></div>`);
    gpDetails(id).then(d => { if (!dlg.open) return; openPlaceDialog(cfg, gpCardHTML(cfg, d, art), () => mapCtl && mapCtl.focus(d), gPlanPlace(d), art); })
      .catch(() => { if (dlg.open) dlg.querySelector('.pc').insertAdjacentHTML('beforeend', `<p class="muted">${t('Couldn’t load this place right now.')}</p>`); });
  };
  if (mapCtl) {
    mapCtl.googleMode(); mapCtl.onPoi((placeId) => art._openGPlace(placeId));
    mapCtl.onArea((a) => { if (gpBroken) return; const base = art._center && !art._center.r ? art._center : (art._center && art._center.anchor) || v0; art._center = { lat: a.lat, lon: a.lon, r: a.r, anchor: { lat: base.lat, lon: base.lon } }; started = true; load(); });
  }
  const go = () => { if (started) return; const panel = art.querySelector('[data-panel="nearby"]'); if (panel && panel.hidden) return; started = true; load(); };
  art._gpReload = () => { if (started) load(); else render(); };
  // a city: its hotel (or the city itself) becomes where searches start and distances are measured from
  art._nearCity = (i) => {
    if (!ss[i]) return; const st = ss[i]; art._stop = i; const h = art._hotelAt ? art._hotelAt(i) : null; art._center = h || st; art._fromHotel = !!h; art._hotelPt = h;
    if (mapCtl) mapCtl.center(art._center.lat, art._center.lon, h ? 15 : 13); art._hotelUI && art._hotelUI(); started = true; load(); save(true);
  };
  (art._showFns = art._showFns || []).push((k) => { if (k === 'nearby') go(); });
  bodyEl.innerHTML = gpHTML(cfg, art, null); renderBar();
  if (art._hotelUI) art._hotelUI(); // the hotel bar drawn before Google places were ready gets its Hotels button
  const onBar = (e) => {
    const b = e.target.closest('button'); if (!b) return; const f = art._gp; const d = b.dataset;
    if (d.gplace) { art._openGPlace(d.gplace); return; }
    if (d.gpSave) { const r = (rows || []).find(x => x.id === d.gpSave); if (r) toggleSaved(cfg, art, { src: 'g', ref: r.id, name: r.name, lat: r.lat, lon: r.lon, rating: r.rating, count: r.count, addr: r.addr, hours: '', type: placeType([r.ptype], r.type.toLowerCase()), cat: gpRowCat(f, r) }); render(); return; }
    if ('gpGo' in d) { textSearch(qIn.value.trim()); return; }
    if ('gpQClear' in d) { f.q = ''; qIn.value = ''; return load(); }
    if (d.ccPill) { const k = d.ccPill; const refetch = k === 'cuisine' || k === 'diet'; if (k === 'sort') f.sort = 'dist'; else f[k] = k === 'open' ? false : k === 'stars' || k === 'dist' ? 0 : ''; if (refetch) return load(); }
    else if (d.gpOpen != null) f.open = !f.open;
    else if (d.gpStars) f.stars = f.stars === +d.gpStars ? 0 : +d.gpStars;
    else if (d.gpPrice) f.price = f.price === d.gpPrice ? '' : d.gpPrice;
    else if (d.gpDist) f.dist = f.dist === +d.gpDist ? 0 : +d.gpDist;
    else if (d.gpSort) f.sort = d.gpSort;
    else if (d.gpClear != null) { const refetch = f.cuisine || f.diet; Object.assign(f, { cuisine: '', diet: '', open: false, stars: 0, price: '', dist: 0, sort: 'dist', types: [] }); if (refetch) return load(); }
    else return;
    render();
  };
  s.addEventListener('click', onBar); if (bar !== s) bar.addEventListener('click', onBar);
  bar.addEventListener('dd', (e) => {
    const { key, v } = e.detail; const f = art._gp;
    if (key === 'city') { if (+v !== (art._stop || 0)) art._nearCity(+v); return; }
    if (key === 'cat') { f.cat = f.cat === v && !f.q ? '' : v; f.cuisine = ''; f.price = ''; f.q = ''; f.types = []; qIn.value = ''; if (!GP_FOOD.has(f.cat)) f.diet = ''; load(); save(true); }
    if (key === 'atype') { const ts = f.types || []; f.types = ts.includes(v) ? ts.filter(k => k !== v) : ts.concat(v); render(); }
  });
  bar.addEventListener('change', debounce((e) => { const i = e.target; if (!i.dataset.gp) return; art._gp[i.dataset.gp] = i.value; if (i.dataset.gp === 'diet' && i.value) art._gp.cuisine = ''; load(); }, 250));
  go();
  return true;
}

// ================= the guest's own plan: places added from any place card, by day or saved for later =================
// Stored per event in localStorage (account sync arrives with the itinerary table). Shown in My trip, merged into the
// schedule / trip itinerary, and as gold ★ pins on the map. Tapping one opens the same place card.
const planKey = (cfg) => 'plan:' + eventKey(cfg).slice(6);
const planLoad = (cfg) => LS.get(planKey(cfg), null) ?? demoOf(cfg, 'plan') ?? [];
const planSave = (cfg, xs) => { LS.set(planKey(cfg), xs); if (typeof syncPush === 'function' && LS.get('signedIn')) syncPush(cfg); };
function planDays(cfg) {
  if (!cfg.start) return [];
  const tr = tripDates(cfg); let s = isTrip(cfg) ? cfg.start.slice(0, 10) : tr.arrive, e = isTrip(cfg) ? (cfg.end || cfg.start).slice(0, 10) : tr.leave;
  if (e < s) e = s; const n = Math.min(45, daysBetween(s, e)); return Array.from({ length: n + 1 }, (_, i) => addDays(s, i));
}
const dayLabel = (cfg, d) => { const st = stopsOf(cfg).length > 1 ? stopFor(cfg, d) : null; return `${isTrip(cfg) && cfg.start && d >= cfg.start.slice(0, 10) ? t('Day {n}', { n: daysBetween(cfg.start, d) + 1 }) + ' · ' : ''}${fmt(d, { weekday: 'short', month: 'short', day: 'numeric' })}${st ? ' · ' + st.name : ''}`; };
function planAddHTML(cfg, place) {
  const have = planLoad(cfg).find(x => x.ref === place.ref);
  const days = planDays(cfg);
  return `<div class="plan-add" data-plan-box>
    ${have ? `<p class="plan-have">✓ ${esc(have.day ? t('In your plan: {d}', { d: dayLabel(cfg, have.day) }) : t('Saved for later'))}</p>` : ''}
    <div class="btns"><button type="button" class="btn primary" data-plan-open>${have ? t('Change day') : t('Add to itinerary')}</button>${have && !have.day ? '' : `<button type="button" class="btn" data-plan-later>${t('Save for later')}</button>`}</div>
    <div class="plan-form" hidden>
      <div class="two"><label class="field"><span>${t('Day')}</span><select data-plan-day>${days.map(d => `<option value="${d}" ${have && have.day === d ? 'selected' : ''}>${esc(dayLabel(cfg, d))}</option>`).join('')}</select></label>
      <label class="field"><span>${t('Time (optional)')}</span><input type="time" data-plan-time value="${esc(have ? have.time : '')}"></label></div>
      <label class="field"><span>${t('Note (optional)')}</span><input data-plan-note maxlength="200" value="${esc(have ? have.note : '')}" placeholder="${t('Book a table for 4, try the tasting menu…')}"></label>
      <div class="btns"><button type="button" class="btn primary" data-plan-save>${t('Add to day')}</button><button type="button" class="btn ghost" data-plan-cancel>${t('Cancel')}</button></div>
    </div></div>`;
}
// the place card's Add / Save handlers; place = {src:'g'|'osm', ref, name, lat, lon, rating, count, addr, open, hours}
function planCardClick(cfg, art, dlg, e, place) {
  const b = e.target.closest('[data-plan-open],[data-plan-later],[data-plan-save],[data-plan-cancel]'); if (!b) return false;
  const box = dlg.querySelector('[data-plan-box]'); const form = box.querySelector('.plan-form');
  if ('planOpen' in b.dataset) { form.hidden = false; box.querySelector('.btns').hidden = true; return true; }
  if ('planCancel' in b.dataset) { form.hidden = true; box.querySelector('.btns').hidden = false; return true; }
  const xs = planLoad(cfg); const i = xs.findIndex(x => x.ref === place.ref);
  const prev = i >= 0 ? xs[i] : { id: 'pl' + Date.now().toString(36), booked: false, conf: '' };
  const item = { ...prev, src: place.src, ref: place.ref, name: place.name, lat: place.lat, lon: place.lon, rating: place.rating || 0, count: place.count || 0, addr: place.addr || '', hours: place.hours || '',
    type: prev.type || place.type || 'other',
    day: 'planLater' in b.dataset ? '' : form.querySelector('[data-plan-day]').value, time: 'planLater' in b.dataset ? '' : form.querySelector('[data-plan-time]').value, note: 'planLater' in b.dataset ? (prev.note || '') : form.querySelector('[data-plan-note]').value.trim() };
  if (i >= 0) xs.splice(i, 1); xs.push(item); planSave(cfg, xs);
  toast(item.day ? t('Added to {d}', { d: dayLabel(cfg, item.day) }) : t('Saved for later'));
  box.outerHTML = planAddHTML(cfg, place); art._planChanged && art._planChanged();
  return true;
}
const PTYPES = [['flight', 'Flights'], ['stay', 'Hotels & stays'], ['transport', 'Transport'], ['food', 'Restaurants'], ['activity', 'Tours & activities'], ['other', 'Other']];
const itinType = (x) => ({ flight: 'flight', hotel: 'stay', stay: 'stay', car: 'transport', train: 'transport', bus: 'transport', taxi: 'transport', ferry: 'transport', food: 'food', tour: 'activity' }[x.kind] || 'other');
// type from a Google place's types or an OpenStreetMap category
function placeType(types, cat) {
  const ts = (types || []).join(' ') + ' ' + (cat || '');
  if (/lodging|hotel|hostel|guest_house|motel/.test(ts)) return 'stay';
  if (/restaurant|cafe|coffee|bar|pub|food|bakery|meal|fast_food/.test(ts)) return 'food';
  if (/train|transit|subway|bus_station|airport|car_rental|ferry/.test(ts)) return 'transport';
  if (/tourist|museum|park|gallery|attraction|zoo|aquarium|amusement|sight|viewpoint|stadium|theater|night_club/.test(ts)) return 'activity';
  return 'other';
}
// one list: places the guest added + bookings they entered (each with its city and category for the City × Category bar)
function itineraryEntries(cfg) {
  const ps = planLoad(cfg).map((x, i) => ({ ...x, ent: 'plan', type: x.type || 'other', order: i, cc: ccCatOfPlan(x), sub: tSub(x), city: ccCityOfPlan(cfg, x) }));
  const bs = itinLoad(cfg).map((x, i) => ({ ent: 'book', id: 'bk' + i, bi: i, name: x.name || t(ITIN_KINDS[x.kind] || 'Booking'), type: itinType(x), day: (x.start || '').slice(0, 10), time: (x.start || '').slice(11, 16), addr: x.address || '', conf: x.confNo || '', booked: true, kindLabel: t(ITIN_KINDS[x.kind] || ''), order: 1000 + i, cc: ccCatOfBooking(x), sub: tSub(x), city: ccCityOfBooking(cfg, x) }));
  return ps.concat(bs);
}
const ccItem = (x) => ({ city: x.city, cat: x.cc, sub: x.sub, text: [x.name, x.addr, x.note, x.conf, x.kindLabel].filter(Boolean).join(' '), saved: x.ent === 'plan', booked: !!x.booked });
function planHTML(cfg) {
  const all = itineraryEntries(cfg);
  if (!all.length) return `<p class="muted">${t('Add places from the Nearby tab.')}</p>`;
  const F = ccTrip(cfg); const view = F.st.group || LS.get('planview:' + syncKey(cfg)) || 'day';
  const xs = all.filter(x => F.ok(ccItem(x)));
  const days = planDays(cfg); const byTime = (a, b) => (a.time || '').localeCompare(b.time || '') || a.order - b.order;
  // compact rows; tap → the item's sheet (details, photos, day, category, booked, move, remove)
  const bks = itinLoad(cfg);
  const row = (x) => { const bk = x.ent === 'book' ? bks[x.bi] : null; const ref = bk ? (bk.id ? 'bk:' + bk.id : '') : 'pl:' + x.id;
    const meta = x.ent === 'book' ? [x.kindLabel, view === 'type' && x.day ? dayLabel(cfg, x.day) : '', x.time ? fmtTime(x.time) : '', x.conf ? t('Conf. {n}', { n: x.conf }) : '']
      : [view === 'type' && x.day ? dayLabel(cfg, x.day) : '', x.time ? fmtTime(x.time) : '', x.addr ? x.addr.split(',').slice(0, 2).join(',') : ''];
    const name = x.ent === 'book' ? `<b class="plan-t"><span>${esc(x.name)}</span>${bk && LODGE.has(bk.kind) ? hfBadgeHTML(hfOfBk(bk), bkDay(bk.end) || bkDay(bk.start)) : ''}</b>` : `<b class="plan-t"><span class="plan-name">${esc(x.name)}</span></b>`;
    const rm = bk && bk.id && LODGE.has(bk.kind) ? rmBtnHTML(bk.id, 'pr-rm') : '';
    return `<li class="plan-row${x.ent === 'book' ? ' bk' : ''}${x.booked && x.ent !== 'book' ? ' booked' : ''}${rm ? ' has-rm' : ''}"${x.ent === 'book' ? '' : ` data-plan-id="${esc(x.id)}"`}><button type="button" class="pr-go"${ref ? ` data-ds="${esc(ref)}"` : ''}>${(o => thumbHTML(o, ccIk(x.cc, o)))(bk || planLoad(cfg).find(y => y.id === x.id) || x)}<span class="pr-tx">${name}<small>${esc(meta.filter(Boolean).join(' · '))}</small>${x.ent !== 'book' && (x.rating || x.booked || x.note) ? `<span class="pr-x">${x.rating ? `<span class="rt">${gRatingHTML(x)}</span>` : ''}${x.booked ? `<em class="pr-bk">✓ ${t('Booked')}</em>` : ''}${x.note ? `<span class="pr-note">${rtHTML(x.note)}</span>` : ''}</span>` : ''}</span><i class="tl-chev" aria-hidden="true"></i></button>${rm}</li>`; };
  let groups;
  if (view === 'type') {
    groups = TRIP_CATS.concat(['']).map(k => [k ? ccLabel(k) : t('Other'), xs.filter(x => tripCat(x.cc) === k).sort((a, b) => (a.day || '9999').localeCompare(b.day || '9999') || byTime(a, b))]).filter(([, g]) => g.length);
  } else {
    const dated = [...new Set(xs.filter(x => x.day).map(x => x.day))].sort();
    groups = dated.map(d => [dayLabel(cfg, d), xs.filter(x => x.day === d).sort(byTime)]).concat([[t('Saved for later'), xs.filter(x => !x.day).sort(byTime)]]).filter(([, g]) => g.length);
  }
  if (!groups.length && F.cats.length === 1 && F.cats[0] === 'activities' && !all.some(x => tripCat(x.cc) === 'activities')) // nothing saved yet: where to find some
    return `<p class="muted cc-none">${t('No activities saved yet.')}${tabsFor(cfg).some(x => x[0] === 'nearby') ? ` <button type="button" class="link" data-trip-near="tours">${t('Find things to do')}</button>` : ''}</p>`;
  return groups.length ? groups.map(([h, g]) => `<h3 class="sub-h">${esc(h)}</h3><ul class="plan-list">${g.map(row).join('')}</ul>`).join('') : ccNoneHTML();
}
// My trip + the trip Itinerary: one City × Category selection for both (saved spots, bookings, plan, itinerary days)
function wireTripCC(cfg, art, opts) {
  // a chip's number = the rows My trip's itinerary lists once that chip is tapped (same entries, same filter): the
  // organizer's schedule lives on the Event tab, so its check-in / flight lines are not counted here (Dylan 11/24:
  // "Hotels 9" over 3 listed hotels — 6 organizer "Check in:" lines were added on top of his 3 bookings)
  // several chips at once: a chip's number is what that chip alone lists; Transport's follows its subtype filter (the rows
  // it shows), and each subtype chip counts its own rows. All = everything the other filters let through.
  const counts = (F) => { const n = { all: 0 }, sub = {}; itineraryEntries(cfg).map(ccItem).forEach(x => { if (!F.rest(x)) return; n.all++; if (!x.cat) return;
    if (x.cat === 'transport') sub[x.sub || 'other'] = (sub[x.sub || 'other'] || 0) + 1; if (F.subOk(x)) n[tripCat(x.cat)] = (n[tripCat(x.cat)] || 0) + 1; }); n.sub = sub; return n; };
  const SHOW = [['', 'Everything'], ['saved', 'Saved only'], ['booked', 'Booked'], ['host', 'Event only']];
  const fill = (where, el) => {
    const F = ccTrip(cfg); const cities = ccCities(cfg); const n = counts(F);
    if (!el.querySelector('.ccb')) el.innerHTML = ccShell(where, `<div class="gp-search ccb-q"><input type="search" data-cct-q placeholder="${esc(t('Search your trip'))}" aria-label="${esc(t('Search your trip'))}" autocomplete="off" enterkeyhint="search"></div>`);
    const box = el.querySelector('.ccb'); const inp = box.querySelector('[data-cct-q]'); if (inp && document.activeElement !== inp) inp.value = F.st.q || '';
    const shows = SHOW.filter(([k]) => where === 'itin' || k !== 'host');
    const body = ccGroup(t('Show'), shows.map(([k, l]) => ccChip(F.show === k, `data-cct-show="${k}"`, esc(t(l)))).join(''))
      + (where === 'trip' ? ccGroup(t('Group by'), [['day', 'By day'], ['type', 'By type']].map(([k, l]) => ccChip((F.st.group || LS.get('planview:' + syncKey(cfg)) || 'day') === k, `data-cct-group="${k}"`, esc(t(l)))).join('')) : '');
    const sl = (SHOW.find(x => x[0] === F.show) || [0, ''])[1];
    ccFill(box, {
      row: (cities.length ? ccTabs({ key: 'city', aria: t('City'), value: F.ci >= 0 ? String(F.ci) : '', ph: t('All cities'), cls: 'dd-city', opts: [{ v: '', l: t('All') }].concat(cities.map(c => ({ v: String(c.i), l: c.l }))) }) : '')
        + (!TRIP_CATS.some(k => n[k] || F.cats.includes(k)) ? '' : ccChips({ key: 'cat', aria: t('Category'), values: F.cats.length ? F.cats : ['all'], cls: 'dd-cat', opts: [{ v: 'all', l: t('All'), ic: 'all', n: n.all }].concat(TRIP_CATS.filter(k => n[k] || F.cats.includes(k) || TRIP_CORE.includes(k)).map(k => ({ v: k, l: ccLabel(k), ic: k, n: n[k] || 0 }))) }))
        + (F.cats.includes('transport') && Object.keys(n.sub).length > 1 ? ccChips({ key: 'tsub', aria: t('Transport'), values: F.tsubs, cls: 'cc-subs', opts: TSUBS.filter(([k]) => n.sub[k]).map(([k, l]) => ({ v: k, l: t(l), ic: k === 'other' ? 'transport' : k, n: n.sub[k] })) }) : ''),
      filt: ccFiltersBtn(F.show ? 1 : 0),
      pills: F.show ? ccPills([['show', t(sl)]], '') : '', sheet: ccSheet(body, t('Done'), 'data-cct-sub') });
  };
  const bars = () => { const a = art.querySelector('[data-slot="trip-cc"]'), b = art.querySelector('[data-slot="itin-cc"]'); if (a) fill('trip', a); if (b) fill('itin', b); };
  const refresh = () => {
    const pb = art.querySelector('#sec-plan .sec-b'); if (pb) pb.innerHTML = planHTML(cfg);
    const sp = art.querySelector('#sec-spots .sec-b'); if (sp) sp.innerHTML = spotsHTML(cfg);
    const ul = art.querySelector('#sec-itinerary ul.bookings');
    if (ul) { const F = ccTrip(cfg); let any = false; ul.querySelectorAll('li[data-cc-cat]').forEach(li => { const ok = F.ok({ city: +li.dataset.ccCity, cat: li.dataset.ccCat, sub: li.dataset.ccSub, text: li.dataset.ccText, saved: false, booked: true }); li.hidden = !ok; any = any || ok; }); const none = ul.nextElementSibling; if (none && none.classList.contains('cc-none')) none.hidden = any; }
    const sb = art.querySelector('[data-slot="sched-body"]'); if (sb) { if (opts.onpage) { art._renderSchedule && art._renderSchedule(); return; } sb.innerHTML = scheduleHTML(cfg); }
    bars();
  };
  art._ccBars = bars; bars();
  const mine = (el) => el.closest && el.closest('[data-ccb="trip"],[data-ccb="itin"]');
  art.addEventListener('dd', (e) => {
    if (!mine(e.target)) return; const { key, v } = e.detail; const cities = ccCities(cfg);
    if (key === 'city') ccSet(cfg, 'trip', { city: v === '' ? '' : (cities[+v] || {}).k || '' });
    if (key === 'cat') { const F = ccTrip(cfg); const cs = v === 'all' ? [] : F.cats.includes(v) ? F.cats.filter(k => k !== v) : F.cats.concat(v);
      ccSet(cfg, 'trip', { cats: TRIP_CATS.filter(k => cs.includes(k)), cat: '', ...(cs.includes('transport') ? {} : { tsub: [] }) }); }
    if (key === 'tsub') { const ts = ccTrip(cfg).tsubs; ccSet(cfg, 'trip', { tsub: ts.includes(v) ? ts.filter(k => k !== v) : ts.concat(v) }, false); }
    refresh();
  });
  art.addEventListener('input', debounce((e) => { if (!e.target.matches || !e.target.matches('[data-cct-q]')) return; ccSet(cfg, 'trip', { q: e.target.value.slice(0, 60) }, false); refresh(); }, 120));
  art.addEventListener('click', (e) => {
    const nb = e.target.closest('[data-trip-near]'); if (nb) { showTab(art, 'nearby'); if (art._gpCat) art._gpCat(nb.dataset.tripNear); return; }
    const b = e.target.closest('[data-cct-show],[data-cct-group],[data-cct-clear],[data-cct-sub],[data-cc-pill]'); if (!b) return; const d = b.dataset;
    if (d.ccPill != null && !mine(b)) return;
    if (d.cctShow != null) ccSet(cfg, 'trip', { show: d.cctShow }, false);
    else if (d.cctGroup) { ccSet(cfg, 'trip', { group: d.cctGroup }, false); LS.set('planview:' + syncKey(cfg), d.cctGroup); }
    else if (d.cctSub != null || d.ccPill != null) ccSet(cfg, 'trip', { show: '' }, false);
    else if (d.cctClear != null) { ccSet(cfg, 'trip', { city: '', cat: '', cats: [], tsub: [], q: '', show: '' }); $$('[data-cct-q]', art).forEach(i => { i.value = ''; }); }
    refresh();
  });
}
function wirePlan(cfg, art, mapCtl) {
  const sec0 = art.querySelector('#sec-plan'); const body = sec0 && sec0.querySelector('.sec-b');
  const pins = () => { if (mapCtl) mapCtl.setSaved(planLoad(cfg).filter(x => x.lat != null && !x.hotel).map(x => ({ lat: x.lat, lon: x.lon, title: x.name, ic: ccIk(ccCatOfPlan(x), x), onClick: () => openPlan(x) }))); };
  const openPlan = (x) => { if (x.src === 'g' && art._openGPlace) art._openGPlace(x.ref); else if (art._openPlace) art._openPlace(x.ref); };
  const render = () => { if (body) body.innerHTML = planHTML(cfg); art._renderSchedule && art._renderSchedule(); pins(); const sp = art.querySelector('#sec-spots .sec-b'); if (sp) sp.innerHTML = spotsHTML(cfg); art._hotelUI && art._hotelUI(); dsRefresh(art); };
  art._planChanged = render; pins();
  if (LS.get('signedIn') && cfg.tools.mytrip) { syncPull(cfg, art).catch(() => {}); if (!cfg.demoTrip) fwdFill(art, cfg); }
  if (!body) return;
  body.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const li = b.closest('[data-plan-id]'); const xs = planLoad(cfg); const i = li ? xs.findIndex(x => x.id === li.dataset.planId) : -1;
    const k = eventKey(cfg).slice(6);
    if (b.dataset.bkEdit != null) { const s2 = art.querySelector('#sec-itinerary'); const eb = s2 && s2.querySelector(`[data-itin-edit="${b.dataset.bkEdit}"]`); if (eb) { s2.scrollIntoView({ block: 'start' }); eb.click(); } return; }
    if (b.dataset.planCard) { const x = xs.find(y => y.id === b.dataset.planCard); if (x) openPlan(x); return; }
    if (i < 0) return;
    if ('planDel' in b.dataset) { xs.splice(i, 1); planSave(cfg, xs); render(); }
    if (b.dataset.planMv) { const same = xs.map((y, j) => [y, j]).filter(([y]) => y.day === xs[i].day).map(([, j]) => j); const k = same.indexOf(i) + +b.dataset.planMv; if (k >= 0 && k < same.length) { const j = same[k]; [xs[i], xs[j]] = [xs[j], xs[i]]; planSave(cfg, xs); render(); } }
  });
  body.addEventListener('change', (e) => {
    const el = e.target; if (el.closest('[data-pdet],[data-ph-add]')) return; const li = el.closest('[data-plan-id]'); if (!li) return; const xs = planLoad(cfg); const x = xs.find(y => y.id === li.dataset.planId); if (!x) return;
    if (el.matches('[data-plan-move]')) { x.day = el.value; if (!x.day) x.time = ''; }
    if (el.matches('[data-plan-booked]')) x.booked = el.checked;
    if (el.matches('[data-plan-type]')) { x.cat = el.value || 'other'; x.type = PL_CAT_TYPE[el.value] || 'other'; }
    if (el.matches('[data-plan-conf]')) x.conf = el.value.trim().slice(0, 60);
    planSave(cfg, xs); render();
  });
}

// ================= guest tabs: tap a section's title to fold it; booked parts fold to one line =================
// Per guest per trip: { c: { id: 1 folded | 0 opened } } in localStorage, synced with My trip. The title row is the one
// control (a button with aria-expanded and a single chevron). Pages from when sections also had a Hide button may still
// have { h: { id: 1 } }: those sections start folded instead of gone.
// A Travel part the guest already booked (flight, train, rental car, hotel) starts folded to its summary line.
const cxKey = (cfg) => 'secui:' + syncKey(cfg);
const CX_PARTS = [['fly', 'Flights', ['flight']], ['train', 'Trains', ['train']], ['rental', 'Rental car', ['car']]];
function cxBooked(cfg) {
  const xs = itinLoad(cfg); const day = (x) => (x.start || '').slice(0, 10);
  const line = (k, label) => { const b = xs.filter(x => x.kind === k).sort((a, c) => (a.start || '').localeCompare(c.start || '')); if (!b.length) return '';
    const x = b[0]; const when = k === 'hotel' || k === 'stay' ? (day(x) ? dateRange(day(x), (x.end || '').slice(0, 10) || day(x)).replace(/, \d{4}$/, '') : '') : day(x) ? fmt(day(x), { month: 'short', day: 'numeric' }) : '';
    return `✓ ${[t(label), k === 'flight' ? x.flight || x.name : x.name, when].filter(Boolean).join(' · ')}${b.length > 1 ? ` · +${b.length - 1}` : ''}`; };
  return { 'm-fly': line('flight', 'Flight'), 'm-train': line('train', 'Train'), 'm-rental': line('car', 'Rental car'), stay: line('hotel', 'Hotel') || line('stay', 'Hotel') };
}
// a folded Event-tab section's one line: the weather's range, else its item labels ("Money · Luggage"),
// else its first sentence
function ovSummary(cfg, art, el) {
  const id = el.dataset.sec; const one = (s) => { s = String(s || '').replace(/\s+/g, ' ').trim(); const m = s.match(/^.{20,}?[.!?](\s|$)/); return (m ? m[0] : s).trim(); };
  if (id === 'weather') { const ws = el.querySelector('[data-slot="weather"]'); const w = ws && ws._wx; if (!w || !w.days || !w.days.length) return ''; const u = tempUnit();
    const r = (k) => { const v = w.days.map(d => fmtTemp(d[k], u)).filter(x => x !== '' && x != null).map(Number); if (!v.length) return ''; const a = Math.min(...v), b = Math.max(...v); return a === b ? `${a}°` : `${a}–${b}°`; };
    return [r('hi') && r('lo') ? `${r('hi')} / ${r('lo')}${u}` : '', el.querySelector('.wx-l') ? el.querySelector('.wx-l').textContent : ''].filter(Boolean).join(' · '); }
  if (id === 'about' && (cfg.description || '').trim()) return one(rtPlain(cfg.description));
  const b = el.querySelector(':scope > .sec-b'); if (!b) return '';
  const labs = [...new Set([...b.querySelectorAll('li b, .note > b, h3, h4')].map(x => x.textContent.trim()).filter(x => x && x.length <= 40))];
  if (labs.length >= 2) return labs.slice(0, 5).join(' · ');
  const p = (b.querySelector('p, li, .rm-box') || b).cloneNode(true); p.querySelectorAll('br').forEach(x => x.replaceWith(' · '));
  let q = p; while (q.children.length === 1) q = q.children[0]; const kids = p.matches('li') ? [...q.children] : [];
  return one(kids.length > 1 ? kids.map(x => x.textContent.trim()).filter(Boolean).join(' · ') : p.textContent);
}
function wireCollapse(cfg, art) {
  const st = () => { const x = LS.get(cxKey(cfg), null) || {}; return { c: x.c || {}, h: x.h || {} }; };
  const save = (x) => { if (!Object.keys(x.h).length) delete x.h; LS.set(cxKey(cfg), x); if (LS.get('signedIn') && cfg.tools.mytrip) syncPush(cfg); };
  // the Event tab is an overview: its info sections start folded to a one-line summary (the schedule and the RSVP form stay open)
  const ov = (u) => !!u && u.kind === 'sec' && u.id !== 'schedule' && u.id !== 'rsvp' && !!u.el.closest('.ev-panel[data-panel="event"]');
  const isCol = (x, booked, id, u) => x.c[id] === 1 || (x.c[id] !== 0 && (!!booked[id] || !!x.h[id] || ov(u)));
  const units = () => {
    const out = [];
    $$('.ev-panel .ev-sec[data-sec]', art).forEach(s => { const h = s.querySelector(':scope > .sec-h'); if (h) out.push({ id: s.dataset.sec, el: s, h, kind: 'sec' }); });
    CX_PARTS.forEach(([m, label]) => { const el = art.querySelector(`[data-panel="travel"] [data-mode="${m}"]`); if (el) out.push({ id: 'm-' + m, el, title: t(label), kind: 'part' }); });
    return out;
  };
  const paint = () => {
    const x = st(); const booked = cxBooked(cfg);
    units().forEach(u => {
      const col = isCol(x, booked, u.id, u); let tog;
      if (u.kind === 'sec') {
        // the whole title row is the button: <h2 class="sec-h"><button class="cx-h" aria-expanded>Title<i></i></button></h2>
        tog = u.h.querySelector(':scope > [data-cx-tog]');
        if (!tog) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'cx-h'; b.dataset.cxTog = u.id;
          b.innerHTML = `<span class="cx-tt"></span><i class="cx-chev" aria-hidden="true"></i>`; b.firstChild.append(...u.h.childNodes); u.h.appendChild(b);
          u.el.classList.add('cx-sec'); tog = b;
        }
        let sl = u.el.querySelector(':scope > .cx-sumline'); if (!sl) { u.h.insertAdjacentHTML('afterend', '<div class="cx-sumline"></div>'); sl = u.h.nextElementSibling; }
        const sum = col ? booked[u.id] || (ov(u) ? ovSummary(cfg, art, u.el) : '') : ''; if (sl.textContent !== sum) sl.textContent = sum; sl.classList.toggle('ov', !booked[u.id]);
      } else {
        let ctl = u.el.previousElementSibling && u.el.previousElementSibling.classList.contains('cx-part') ? u.el.previousElementSibling : null;
        if (!ctl) {
          u.el.insertAdjacentHTML('beforebegin', `<div class="cx cx-part"><button type="button" class="cx-h" data-cx-tog="${esc(u.id)}"><b class="cx-t">${esc(u.title)}</b><i class="cx-chev" aria-hidden="true"></i></button><span class="cx-sum" data-cx-sum></span></div>`);
          ctl = u.el.previousElementSibling;
        }
        tog = ctl.querySelector('[data-cx-tog]'); ctl.querySelector('[data-cx-sum]').textContent = col ? booked[u.id] || '' : '';
      }
      tog.setAttribute('aria-expanded', String(!col)); u.el.classList.toggle('cx-col', col);
    });
    // consecutive folded Event-tab sections read as one list: joined cards, a hairline between
    const eb = art.querySelector('.ev-panel[data-panel="event"] > .ev-body'); if (eb) {
      const items = [...eb.children].map(c => ({ c, s: c.matches('.ev-sec') ? c : c.querySelector(':scope > .ev-sec') })).filter(x => x.s || x.c.offsetHeight || x.c.textContent.trim());
      items.forEach((x, i) => { const f = (y) => !!(y && y.s && y.s.classList.contains('cx-col')); const up = f(x) && f(items[i - 1]), dn = f(x) && f(items[i + 1]);
        x.c.classList.toggle('ov-up', up); if (x.s) { x.s.classList.toggle('ov-t', up); x.s.classList.toggle('ov-b', dn); } });
    }
  };
  const toggle = (id, open) => { const x = st(); const col = isCol(x, cxBooked(cfg), id, units().find(u => u.id === id)); if (open === true && !col) return; x.c[id] = col ? 0 : 1; delete x.h[id]; save(x); paint(); };
  art._cx = paint; art._cxOpen = (id) => toggle(id, true); paint();
  art.addEventListener('click', (e) => { const b = e.target.closest('[data-cx-tog]') || (e.target.closest('.cx-sec > .sec-h') || e.target.closest('.cx-sec.cx-col > .cx-sumline'))?.parentElement.querySelector(':scope > .sec-h [data-cx-tog]'); if (b && art.contains(b)) toggle(b.dataset.cxTog); });
  // Travel parts are filled in later (airports, counters): keep their headers in place
  const tp = art.querySelector('[data-panel="travel"]'); if (tp) new MutationObserver(debounce(() => { if (document.body.contains(art)) paint(); }, 120)).observe(tp, { childList: true });
}

// ================= one booking per real thing: hotels, flights, rental cars =================
// Every way a booking gets in — Add a booking (paste / screenshot / PDF / by hand), Add to my trip on a link, the Nearby
// "Your hotel" pick, forwarded bookings, account sync — goes through bkUpsert: one that matches a booking already there
// is merged into it (booking facts from the booking, the place from the map pick), never added twice. Two different
// hotels on overlapping dates in the same city ask once: Replace A with B? / Keep both. Old duplicates (and map picks
// that used to be stored apart as plan items { hotel: true }) are merged on load (bkClean); merged-away ids are
// remembered (gone:<key>) so account sync never brings them back.
const LODGE = new Set(['hotel', 'stay']);
const bkGroup = (x) => LODGE.has(x.kind) ? 'lodge' : x.kind || '';
const newBkId = () => 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const NAME_STOP = new Set(['the', 'hotel', 'hotels', 'and', 'by', 'a', 'an', 'at', 'of', 'in', 'near', 'to', 'rental', 'car', 'cars', 'flight', 'resort', 'suites', 'spa', 'your']);
const nameToks = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').split(/[^\p{L}\p{N}]+/u).filter(w => w && !NAME_STOP.has(w));
const GENERIC_RE = /^(your hotel|hotel|rental car|flight)(\s+(in|near|at|to)\b.*)?$/i;
const bkGeneric = (x) => !!x.ph || !String(x.name || '').trim() || GENERIC_RE.test(String(x.name).trim()) || !nameToks(x.name).length;
function nameLike(a, b) { const A = new Set(nameToks(a)), B = new Set(nameToks(b)); if (!A.size || !B.size) return false; let n = 0; A.forEach(w => { if (B.has(w)) n++; }); return n === Math.min(A.size, B.size) || n / (A.size + B.size - n) >= 0.6; }
const bkDay = (s) => String(s || '').slice(0, 10);
const bkSpan = (x) => { const f = bkDay(x.start), e = bkDay(x.end); return f ? [f, e && e > f ? e : f] : null; };
const spanHit = (a, b) => a[0] === b[0] || (a[0] < b[1] && b[0] < a[1]);
const flNo = (x) => { const m = String(x.flight || '').replace(/\s+/g, '').toUpperCase().match(/^([A-Z0-9]{2})0*(\d{1,4})$/) || String(x.name || '').match(/\b([A-Z][A-Z0-9]|[0-9][A-Z])\s?0*(\d{1,4})\b/); return m ? m[1] + m[2] : ''; };
// where a hotel is: its own map pin, else what its name + address were found as on the map
const bkGeo = (x) => { if (x.lat != null) return { ref: x.ref || '', lat: x.lat, lon: x.lon }; const q = [x.name, x.address].filter(Boolean).join(', '); const g = q && LS.get(hgeoKey(q)); return g && !g.miss ? g : { ref: x.ref || '' }; };
// which route city a hotel is in (-1 = none of them / can't tell). An old map pick's `city` was a position in the route
// (wrong after stops were inserted or moved), so it is never read: its stop id, dates and point decide (homeCity)
function bkCity(cfg, x) {
  if (hotelStops(cfg).length < 2) return 0; const g = bkGeo(x);
  return homeCity(cfg, g.lat != null ? g : null, { stopId: x.stopId, day: bkDay(x.start), span: bkSpan(x), hotel: true });
}
// 'same' (one thing, merge) | 'conflict' (two hotels for the same nights in one city) | ''
function bkMatch(cfg, a, b) {
  const g = bkGroup(a); if (a === b || !g || g !== bkGroup(b)) return '';
  const da = bkDay(a.start), db = bkDay(b.start); const dOk = !da || !db || da === db;
  if (g === 'flight') { const fa = flNo(a), fb = flNo(b); if (fa && fb) return fa === fb && dOk ? 'same' : ''; return dOk && (a.ph || b.ph || (a.name || '') === (b.name || '') && a.start === b.start) && (a.ph || b.ph || a.name || a.start) ? 'same' : ''; }
  if (g === 'car') return dOk && (bkGeneric(a) || bkGeneric(b) || nameLike(a.name, b.name)) ? 'same' : '';
  if (g !== 'lodge') return a.start === b.start && nameToks(a.name).join(' ') === nameToks(b.name).join(' ') && (a.name || a.start) ? 'same' : '';
  const ca = bkCity(cfg, a), cb = bkCity(cfg, b); if (ca >= 0 && cb >= 0 && ca !== cb) return '';
  const sa = bkSpan(a), sb = bkSpan(b); const hit = sa && sb ? spanHit(sa, sb) : null; // null: a date is missing
  const loose = hit !== false || !!a.guess || !!b.guess; // a map pick's dates are only a guess
  const ga = bkGeo(a), gb = bkGeo(b); const twoPlaces = a.ref && b.ref && a.ref !== b.ref;
  const samePlace = (ga.ref && ga.ref === gb.ref) || (ga.lat != null && gb.lat != null && distM(ga.lat, ga.lon, gb.lat, gb.lon) < 120);
  if (loose && (samePlace || (!twoPlaces && (nameLike(a.name, b.name) || bkGeneric(a) || bkGeneric(b))))) return 'same';
  return hit ? 'conflict' : '';
}
const bkFilled = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const bkRank = (x) => Object.keys(x).filter(k => bkFilled(x[k])).length - (x.ph ? 20 : 0) - (x.guess ? 10 : 0);
const BK_FACTS = ['kind', 'name', 'start', 'end', 'confNo', 'via', 'viaOther', 'link', 'flight', 'to', 'from'];
const BK_PLACE = ['ref', 'lat', 'lon', 'address', 'city'];
// one item from two: the richer one's id; dates, confirmation, Booked through… from the real booking; the place from the map
function bkMerge(a, b) {
  const [p, s] = bkRank(a) > bkRank(b) || (bkRank(a) === bkRank(b) && String(a.id || '') <= String(b.id || '')) ? [a, b] : [b, a];
  const out = { ...s };
  Object.keys(p).forEach(k => { if (!bkFilled(p[k])) return; const v = out[k];
    if (Array.isArray(p[k]) && Array.isArray(v)) { const seen = new Set(); out[k] = v.concat(p[k]).filter(e => { const j = JSON.stringify(e); return seen.has(j) ? false : seen.add(j); }); }
    else if (p[k] && typeof p[k] === 'object' && v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...v, ...p[k] };
    else out[k] = p[k]; });
  const real = (x) => !x.ph && !x.guess; const bk = real(a) ? a : real(b) ? b : p;
  BK_FACTS.forEach(k => { if (bkFilled(bk[k])) out[k] = bk[k]; });
  if (bkGeneric({ name: out.name })) { const o = [a, b].find(x => !bkGeneric(x)); if (o) out.name = o.name; }
  const pl = [a, b].find(x => x.ref) || [a, b].find(x => x.lat != null);
  if (pl) BK_PLACE.forEach(k => { if (bkFilled(pl[k])) out[k] = pl[k]; });
  if (a.note && b.note && a.note !== b.note && !a.note.includes(b.note) && !b.note.includes(a.note)) out.note = [bk.note || p.note, bk === a ? b.note : a.note].join(' · ');
  out.id = p.id || s.id; if (!(a.ph && b.ph)) delete out.ph; if (!(a.guess && b.guess)) delete out.guess; if (a.pin || b.pin) out.pin = 1;
  return out;
}
// adds → merged into a match, or appended; conflicts are returned (not added) unless keepBoth
function bkUpsert(cfg, xs, adds, keepBoth) {
  xs = xs.slice(); const conflicts = []; let merged = 0;
  adds.forEach(x0 => { const x = { ...x0 }; if (!x.id) x.id = newBkId();
    const j = xs.findIndex(y => bkMatch(cfg, y, x) === 'same'); if (j >= 0) { xs[j] = bkMerge(xs[j], x); merged++; return; }
    const c = keepBoth ? null : xs.find(y => bkMatch(cfg, y, x) === 'conflict'); if (c) conflicts.push([c, x]); else xs.push(x); });
  return { xs, conflicts, merged };
}
function bkDedupe(cfg, xs) {
  let out = xs.slice(), ch = false;
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) if (bkMatch(cfg, out[i], out[j]) === 'same') { out[i] = bkMerge(out[i], out[j]); out.splice(j, 1); j = i; ch = true; }
  return ch ? out : xs;
}
const goneKey = (cfg) => 'gone:' + eventKey(cfg).slice(6);
const goneAdd = (cfg, ids) => { if (ids.length) LS.set(goneKey(cfg), [...new Set((LS.get(goneKey(cfg)) || []).concat(ids))].slice(-300)); };
const goneDel = (cfg, ids) => { const g = LS.get(goneKey(cfg)); if (g && ids.length) LS.set(goneKey(cfg), g.filter(id => !ids.includes(id))); }; // Undo / Keep both: that id is wanted again
// one-tap Remove (a hotel from My trip, its sheet or Nearby's "Your hotel" bar): out of the bookings, the map and the hotel
// selection, and — signed in — the account copy (its id goes on gone:<key>, so a pull can't bring it back). Undo puts it back.
function bkRemove(cfg, art, id) {
  const xs = itinLoad(cfg); const i = xs.findIndex(x => x.id === id); if (i < 0) return;
  const gone = xs.splice(i, 1)[0]; itinSave(cfg, xs); if (art && art._pick) art._pick = {}; bkChanged(art); if (LS.get('signedIn')) syncPush(cfg); dsRefresh(art);
  toastAction(t('Removed {n}', { n: gone.name || t(ITIN_KINDS[gone.kind] || 'Booking') }), t('Undo'), () => {
    const ys = itinLoad(cfg).filter(y => y.id !== gone.id); ys.splice(Math.min(i, ys.length), 0, gone); goneDel(cfg, [gone.id]); itinSave(cfg, ys); bkChanged(art); if (LS.get('signedIn')) syncPush(cfg); });
}
// the Remove button on a hotel's row (My trip: itinerary, saved spots) — trash + the word, one tap, Undo toast
const rmBtnHTML = (id, cls = '') => `<button type="button" class="bk-rm hrm-b ${cls}" data-bk-rm="${esc(id)}" aria-label="${esc(t('Remove hotel'))}">${TRASH_IC}<span>${t('Remove')}</span></button>`;
const TRASH_IC = '<svg class="rm-ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
// saves the bookings; ids that left are remembered so a pull from the account can't bring them back
function itinSave(cfg, xs) { const now = new Set(xs.map(x => x.id)); goneAdd(cfg, (LS.get(itinKey(cfg), null) || []).map(x => x.id).filter(id => id && !now.has(id))); LS.set(itinKey(cfg), xs); }
// a map pick's nights: the city's first leg without a hotel yet (else its first leg), else the trip
function hotelGuessDates(cfg, city, xs) {
  const c = hotelStops(cfg)[city]; const legs = (c && c.legs || []).filter(l => l.from); const sp = (l) => [l.from, l.to && l.to > l.from ? l.to : l.from];
  const leg = legs.find(l => !(xs || []).some(y => LODGE.has(y.kind) && bkSpan(y) && bkCity(cfg, y) === city && spanHit(bkSpan(y), sp(l)))) || legs[0];
  if (leg) return [leg.from, leg.to || ''];
  if (!cfg.start) return ['', ''];
  if (isTrip(cfg)) return [cfg.start.slice(0, 10), (cfg.end || cfg.start).slice(0, 10)];
  const tr = tripDates(cfg); return [tr.arrive, tr.leave];
}
const pinToBooking = (cfg, x, xs) => { const city = Math.max(0, homeCity(cfg, x.lat != null ? x : null, { stopId: x.stopId })); const d = hotelGuessDates(cfg, city, xs);
  return { id: x.id, kind: 'hotel', name: x.name || '', address: x.addr || '', ref: x.ref || '', lat: x.lat, lon: x.lon, stopId: cityId(cfg, city), pin: 1, guess: 1, start: d[0], end: d[1], ...(x.conf ? { confNo: x.conf } : {}), ...(x.note ? { note: x.note } : {}) }; };
// on load: old map picks become hotel bookings, duplicates merge (keeps the richer item), and the guest's hotels and saved
// spots are tied to their stop by id (homes): an old map pick's `city` (a position in the route) is dropped, and anything
// without a stop id — or with the id of a stop that is gone — gets the stop it is in (homeCity: geography + dates).
// true when anything changed
function bkClean(cfg) {
  if (!cfg || !cfg.tools || !cfg.tools.mytrip) return false;
  const stored = LS.get(itinKey(cfg), null), plan = LS.get(planKey(cfg), null); if (stored == null && plan == null) return false; // nothing of the guest's (or an example's sample)
  const pl = plan || []; const pins = pl.filter(x => x && x.hotel);
  let xs = itinLoad(cfg).map(x => x.id ? x : { ...x, id: newBkId() }); const before = JSON.stringify(stored || []);
  pins.forEach(p => { xs = bkUpsert(cfg, xs, [pinToBooking(cfg, p, xs)], true).xs; });
  xs = bkDedupe(cfg, xs);
  const multi = hotelStops(cfg).length > 1;
  xs = xs.map(x => { if (!x || !LODGE.has(x.kind) || !('city' in x || (multi && x.stopId && cityOfId(cfg, x.stopId) < 0))) return x; const { city, ...y } = x; delete y.stopId;
    if (multi && x.pin) { const c = bkCity(cfg, y); if (c >= 0) y.stopId = cityId(cfg, c); } return y; });
  const ch = JSON.stringify(xs) !== before;
  if (ch) { const now = new Set(xs.map(x => x.id)); goneAdd(cfg, pins.map(p => p.id).filter(id => id && !now.has(id))); itinSave(cfg, xs); }
  let pl2 = pins.length ? pl.filter(x => !(x && x.hotel)) : pl; let homed = false;
  if (multi) pl2 = pl2.map(x => { if (!x || x.lat == null || (x.stopId && cityOfId(cfg, x.stopId) >= 0)) return x; const c = homeCity(cfg, x, { day: x.day }); homed = true; return { ...x, stopId: cityId(cfg, c) }; });
  if (pins.length || homed) LS.set(planKey(cfg), pl2);
  return ch || pins.length > 0 || homed;
}
const bkChanged = (art) => { if (art && art._bkChanged) art._bkChanged(); else if (art && art._planChanged) art._planChanged(); if (art && art._hsCfg) { hsRefresh(art._hsCfg, art); if (art._gpPins) art._gpPins(); } };
// Replace <A> with <B>? — inline, under/over where the guest is working; resolves true = replace
function askReplace(slot, a, b) {
  return new Promise(res => {
    const el = typeof slot === 'function' ? slot() : slot; if (!el) return res(false);
    el.insertAdjacentHTML('beforeend', `<div class="bk-ask" role="alertdialog" aria-live="polite"><p>${esc(t('Replace {a} with {b}?', { a: a.name || t(ITIN_KINDS[a.kind] || 'Booking'), b: b.name || t(ITIN_KINDS[b.kind] || 'Booking') }))}</p><p class="muted small">${esc(t('Both are for the same nights.'))}</p><div class="btns"><button type="button" class="btn primary" data-bk-ask="1">${t('Replace')}</button><button type="button" class="btn" data-bk-ask="0">${t('Keep both')}</button></div></div>`);
    const box = el.lastElementChild; box.scrollIntoView && box.scrollIntoView({ block: 'nearest' });
    box.addEventListener('click', (e) => { const bt = e.target.closest('[data-bk-ask]'); if (!bt) return; box.remove(); res(bt.dataset.bkAsk === '1'); });
  });
}
// the one way bookings are added: upsert, save, then settle any Replace? questions one by one.
// A new hotel booking (Add a booking: PDF / screenshot / paste / by hand) for nights another hotel in that city already has
// REPLACES it — the newest confirmation is the hotel (Dylan 11/24: a PDF for a new hotel kept the old one as his hotel,
// because the new one waited on a Replace? question and was dropped when it went unanswered). The toast offers Keep both.
// A one-tap hotel pick (map pin, list, place sheet — Dylan 11/24: "it brings you to a search bar instead of just adding
// it") replaces the same way: over another pick the toast offers Undo, over a real booking it offers Keep both.
async function bkSave(cfg, art, adds, slot) {
  const r = bkUpsert(cfg, itinLoad(cfg), adds); const xs = r.xs; const replaced = [];
  const ask = [];
  r.conflicts.filter(c => !ask.includes(c)).forEach(([old, add]) => { const i = xs.findIndex(y => y.id === old.id); if (i >= 0) { xs.splice(i, 1, add); replaced.push(old); } else if (!xs.some(y => y.id === add.id)) xs.push(add); });
  itinSave(cfg, xs); if (replaced.length && art && art._pick) art._pick = {}; bkChanged(art);
  const nm = (x) => x.name || t(ITIN_KINDS[x.kind] || 'Booking');
  const pick = adds.length === 1 && adds[0].guess && adds[0].pin ? adds[0] : null; // a one-tap hotel pick
  const undoPick = () => { const ys = itinLoad(cfg).filter(y => y.id !== pick.id); replaced.forEach(o => { if (!ys.some(y => y.id === o.id)) ys.push(o); }); goneDel(cfg, replaced.map(o => o.id)); itinSave(cfg, ys); if (art && art._pick) art._pick = {}; bkChanged(art); if (LS.get('signedIn')) syncPush(cfg); };
  if (pick && replaced.length && replaced.every(o => o.guess)) toastAction(t('Replaced {a} with {b}', { a: nm(replaced[0]), b: nm(pick) }), t('Undo'), undoPick);
  else if (pick && !replaced.length && !r.merged) toastAction(t('{n} is your hotel', { n: nm(pick) }), t('Undo'), undoPick);
  else if (pick && r.merged && !replaced.length) toast(t('{n} is your hotel', { n: nm(pick) }));
  else if (replaced.length) toastAction(t('Replaced {a} with {b}', { a: nm(replaced[0]), b: nm(r.conflicts.find(c => c[0] === replaced[0])[1]) }), t('Keep both'), () => {
    const ys = itinLoad(cfg); replaced.forEach(o => { if (!ys.some(y => y.id === o.id)) ys.push(o); }); goneDel(cfg, replaced.map(o => o.id)); itinSave(cfg, ys); bkChanged(art); });
  else if (r.merged) toast(r.merged > 1 ? t('Updated {n} bookings you already had', { n: r.merged }) : t('Updated the booking you already had'));
  else if (adds.length > 1 && !r.conflicts.length) toast(t('Added {n} bookings', { n: adds.length }));
  for (const [old, add] of ask) {
    const rep = await askReplace(slot, old, add); const xs = itinLoad(cfg);
    itinSave(cfg, rep ? xs.filter(y => y.id !== old.id).concat(add) : xs.concat(add)); bkChanged(art);
  }
  return r;
}

// ================= richer bookings and places: details per type + photos =================
// x.det holds the structured details of a booking (My trip → bookings) or a place in the plan: hotel room / beds /
// guests / amenities / free cancellation / price; tour meeting point / duration / included / price; flight seat / cabin
// / baggage; car class. Times are NOT duplicated: check-in/out, pick-up/drop-off and a tour's start come from the item's
// own start/end. x.photos = [{ url } | { g: Google photo name, by, uri }]: the guest's uploads (Storage 'event-files',
// their own folder; signed out: small on-device copies) and, for a place with a Google place id, Google's photo with
// its author attribution. Shown folded behind the item (tap Details). Merged like any other field (bkMerge).
const AMENITIES = [['breakfast', 'Breakfast'], ['wifi', 'Wi-Fi'], ['pool', 'Pool'], ['gym', 'Gym'], ['parking', 'Parking'], ['ac', 'Air conditioning'], ['kitchen', 'Kitchen'], ['laundry', 'Laundry'], ['spa', 'Spa'], ['shuttle', 'Airport shuttle'], ['pets', 'Pets allowed']];
const CABINS = [['economy', 'Economy'], ['premium', 'Premium economy'], ['business', 'Business'], ['first', 'First']];
const DET = {
  lodge: [['room', 'Room type'], ['beds', 'Beds'], ['guests', 'Guests', 'number'], ['amen', 'Amenities', 'amen'], ['cancelBy', 'Free cancellation until', 'date'], ['price', 'Price paid']],
  tour: [['meet', 'Meeting point'], ['duration', 'Duration'], ['incl', 'What’s included'], ['price', 'Price']],
  food: [['party', 'Party size', 'number'], ['price', 'Price']],
  flight: [['seat', 'Seat'], ['cabin', 'Cabin', 'cabin'], ['bags', 'Baggage'], ['price', 'Price paid']],
  train: [['seat', 'Seat'], ['cabin', 'Class'], ['price', 'Price paid']],
  car: [['carClass', 'Car class'], ['price', 'Price paid']],
};
const detGroup = (x) => { const k = x.kind, ty = x.type; return LODGE.has(k) || (!k && ty === 'stay') ? 'lodge' : k === 'flight' ? 'flight' : k === 'car' ? 'car' : k === 'train' || k === 'bus' || k === 'ferry' ? 'train' : k === 'food' || (!k && ty === 'food') ? 'food' : k === 'tour' || k === 'other' || (!k && (ty === 'activity' || ty === 'other')) ? 'tour' : ''; };
const detVal = (x, key) => (x.det || {})[key];
const HF_DET = new Set(['room', 'beds', 'cancelBy']); // a hotel's room + cancellation: the hotel fields (hfFormHTML), up front in the booking form
function detSet(x, key, v) { const d = { ...(x.det || {}) }; if (v == null || v === '' || (Array.isArray(v) && !v.length)) delete d[key]; else d[key] = v; if (Object.keys(d).length) x.det = d; else delete x.det; return x; }
// the read view: "Room type: King deluxe", "Check-in 3:00 PM", amenities…
function detLines(x, noHf) {
  const g = detGroup(x); const out = []; const tm = (s) => s && s.length > 10 ? fmtTime(s.slice(11, 16)) : '';
  if (g === 'lodge') { if (tm(x.start)) out.push(t('Check-in {t}', { t: tm(x.start) })); if (tm(x.end)) out.push(t('Check-out {t}', { t: tm(x.end) })); }
  if (g === 'car') { if (tm(x.start)) out.push(t('Pick-up {t}', { t: tm(x.start) })); if (tm(x.end)) out.push(t('Drop-off {t}', { t: tm(x.end) })); }
  if (g === 'tour' && (tm(x.start) || x.time)) out.push(t('Starts {t}', { t: tm(x.start) || fmtTime(x.time) }));
  if (g === 'lodge' && !noHf) out.push(...hfLines(hfOfBk(x)));
  (DET[g] || []).forEach(([k, label, ty]) => { const v = detVal(x, k); if (!bkFilled(v)) return;
    if (ty === 'amen' || (g === 'lodge' && HF_DET.has(k))) return; if (ty === 'cabin') out.push(`${t(label)}: ${t((CABINS.find(c => c[0] === v) || [v, v])[1])}`);
    else if (ty === 'date') out.push(`${t(label)}: ${fmt(v, { month: 'short', day: 'numeric' })}`); else out.push(`${t(label)}: ${v}`); });
  return out;
}
const detAmen = (x) => (detVal(x, 'amen') || []).map(a => t((AMENITIES.find(y => y[0] === a) || [a, a])[1]));
// ================= hotel fields: room category, free cancellation until / non-refundable, notes =================
// One set of fields for every hotel, wherever it is entered: a guest's booking (det.room, det.cancelBy, det.nonRef + the
// booking's own note), an organizer's check-in row (x.room, x.cancelBy, x.nonRef + x.note), the room block (blockRoom,
// blockCancel, blockNonRef, blockNote) and a stay option's hotel (h.room, h.cancelBy, h.nonRef, h.note).
// cancelBy = 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM' (the property's local time). Older bookings (a date only) read the same.
const ROOM_SUGG = ['Standard', 'Deluxe', 'Superior', 'Suite', 'Executive'];
const BED_SUGG = ['King', 'Queen', '2 Queens', 'Double', 'Twin', '2 Twins'];
const HF_NONE = { room: '', beds: '', cancelBy: '', nonRef: false, note: '' };
const hfCancelOk = (v) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(v || '')) ? String(v) : '';
const hfOfBk = (x) => x ? { room: String(detVal(x, 'room') || ''), beds: String(detVal(x, 'beds') || ''), cancelBy: hfCancelOk(detVal(x, 'cancelBy')), nonRef: !!detVal(x, 'nonRef'), note: x.note || '' } : { ...HF_NONE };
const hfOfEv = (x) => x ? { room: String(x.room || ''), beds: String(x.beds || ''), cancelBy: hfCancelOk(x.cancelBy), nonRef: !!x.nonRef, note: x.note || '' } : { ...HF_NONE };
const hfOfBlock = (d) => d ? { room: String(d.blockRoom || ''), beds: String(d.blockBeds || ''), cancelBy: hfCancelOk(d.blockCancel), nonRef: !!d.blockNonRef, note: d.blockNote || '' } : { ...HF_NONE };
const hfAny = (h) => !!(h && (h.room || h.beds || h.cancelBy || h.nonRef || h.note));
// write one set of values back (empty values are dropped, so old items keep their shape)
function hfToBk(x, h) { detSet(x, 'room', h.room); if (h.beds !== undefined) detSet(x, 'beds', h.beds); detSet(x, 'cancelBy', h.cancelBy); detSet(x, 'nonRef', h.nonRef ? 1 : ''); if (h.note !== undefined) x.note = h.note; return x; }
function hfToObj(o, h, keys = ['room', 'cancelBy', 'nonRef', 'note', 'beds']) {
  const v = { room: h.room, cancelBy: h.cancelBy, nonRef: h.nonRef ? true : '', note: h.note, beds: h.beds };
  ['room', 'cancelBy', 'nonRef', 'note', 'beds'].forEach((k, i) => { if (v[k] === undefined) return; if (v[k]) o[keys[i]] = v[k]; else delete o[keys[i]]; }); return o;
}
const BLOCK_HF = ['blockRoom', 'blockCancel', 'blockNonRef', 'blockNote', 'blockBeds'];
// "Fri, Apr 10" / "Fri, Apr 10 · 6:00 PM"
const hfCancelWhen = (v) => { v = hfCancelOk(v); return v ? [fmt(v.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' }), v.length > 10 ? fmtTime(v.slice(11, 16)) : ''].filter(Boolean).join(' · ') : ''; };
// the detail sheet's facts: "Room · Deluxe King", "Free cancellation until · Fri, Apr 10" (or "Cancellation · Non-refundable")
const hfFacts = (h) => [h.room ? dsFact(t('Room'), h.room) : '', h.beds ? dsFact(t('Bed'), h.beds) : '', h.nonRef ? dsFact(t('Cancellation'), t('Non-refundable')) : h.cancelBy ? dsFact(t('Free cancellation until'), hfCancelWhen(h.cancelBy)) : ''];
// short lines (a read-only card): "Room: Deluxe King", "Free cancellation until: Fri, Apr 10"
const hfLines = (h) => [h.room ? `${t('Room')}: ${h.room}` : '', h.beds ? `${t('Bed')}: ${h.beds}` : '', h.nonRef ? t('Non-refundable') : h.cancelBy ? `${t('Free cancellation until')}: ${hfCancelWhen(h.cancelBy)}` : ''].filter(Boolean);
// One-liners stay short: a badge only when it matters — free cancellation ends within 7 days ("Cancel by Apr 10"), or it
// has ended / never existed ("Non-refundable"); nothing once the stay is over. now = 'YYYY-MM-DDTHH:MM' (tests).
function hfBadge(h, endDay, now) {
  if (!h) return null; const n = now || `${todayYMD()}T${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`; const today = n.slice(0, 10);
  if (endDay && endDay < today) return null;
  if (h.nonRef) return { nr: 1, text: t('Non-refundable') };
  const c = hfCancelOk(h.cancelBy); if (!c) return null;
  if (c.length > 10 ? c < n : c.slice(0, 10) < today) return { nr: 1, text: t('Non-refundable') };
  return daysBetween(today, c) <= 7 ? { nr: 0, text: t('Cancel by {d}', { d: fmt(c.slice(0, 10), { month: 'short', day: 'numeric' }) }) } : null;
}
const hfBadgeHTML = (h, endDay) => { const b = hfBadge(h, endDay); return b ? ` <em class="hf-badge${b.nr ? ' nr' : ''}">${esc(b.text)}</em>` : ''; };
// The inputs. opts: { note: true (a Notes box), en: true (the builder, which is in English), attr: 'data-…="…"' (who owns it) }.
// Every input fires 'input'; the owner reads the whole box with hfRead(box).
function hfFormHTML(h, id, opts = {}) {
  const L = opts.en ? tEn : t; h = h || HF_NONE; const c = hfCancelOk(h.cancelBy); const words = String(h.room || '').toLowerCase().split(/[\s,/·-]+/);
  return `<div class="hf" data-hfbox ${opts.attr || ''}>
    <div class="field wide"><label for="${id}-room">${L('Room category')}</label><input id="${id}-room" data-hk="room" value="${esc(h.room || '')}" maxlength="80" autocomplete="off">
      <div class="chips hf-sug">${ROOM_SUGG.map(s => { const w = L(s); const on = words.includes(w.toLowerCase()); return `<button type="button" class="chip${on ? ' on' : ''}" data-hf-sug="${esc(w)}" aria-pressed="${on}">${esc(w)}</button>`; }).join('')}</div></div>
    <div class="field wide"><label for="${id}-beds">${L('Bed')}</label><input id="${id}-beds" data-hk="beds" value="${esc(h.beds || '')}" maxlength="60" autocomplete="off">
      <div class="chips hf-sug">${BED_SUGG.map(s => { const w = L(s); const on = String(h.beds || '').trim().toLowerCase() === w.toLowerCase(); return `<button type="button" class="chip${on ? ' on' : ''}" data-hf-bed="${esc(w)}" aria-pressed="${on}">${esc(w)}</button>`; }).join('')}</div></div>
    <div class="field wide"><label for="${id}-cxd">${L('Free cancellation until')}</label><div class="hf-cx"><input id="${id}-cxd" type="date" data-hk="cxd" value="${esc(c.slice(0, 10))}"${h.nonRef ? ' disabled' : ''}><input type="time" data-hk="cxt" value="${esc(c.slice(11, 16))}" aria-label="${esc(L('Time (optional)'))}"${h.nonRef || !c ? ' disabled' : ''}></div>
      <label class="chk hf-nr"><input type="checkbox" data-hk="nonRef"${h.nonRef ? ' checked' : ''}> ${L('Non-refundable')}</label></div>
    ${opts.note ? `<div class="field wide"><label for="${id}-note">${L('Notes')}</label><textarea id="${id}-note" data-hk="note" rows="2" maxlength="1000">${esc(h.note || '')}</textarea></div>` : ''}</div>`;
}
// the box's values: { room, cancelBy, nonRef[, note] }
function hfRead(box) {
  const el = (k) => box.querySelector(`[data-hk="${k}"]`); const nonRef = !!(el('nonRef') && el('nonRef').checked);
  const d = isoDay((el('cxd') || {}).value || ''), tm = /^\d{2}:\d{2}$/.test((el('cxt') || {}).value || '') ? el('cxt').value : '';
  const out = { room: cleanText((el('room') || {}).value || '', 80), beds: cleanText((el('beds') || {}).value || '', 60), cancelBy: nonRef || !d ? '' : d + (tm ? 'T' + tm : ''), nonRef };
  if (el('note')) out.note = String(el('note').value || '').replace(/\r/g, '').slice(0, 1000).replace(/^\s+|\s+$/g, '');
  return out;
}
// a fold for a compact row (builder rows, Make it mine): summary = what is set, else the label
const tEn = (s, vars) => t(s, vars); // the builder's strings follow the organizer's interface language (uiLang)
const hfSumText = (h, L = t) => [h.room, h.beds, h.nonRef ? L('Non-refundable') : h.cancelBy ? L('Cancel by {d}', { d: fmt(h.cancelBy.slice(0, 10), { month: 'short', day: 'numeric' }) }) : ''].filter(Boolean).join(' · ');
const hfFoldHTML = (h, id, opts = {}) => { const L = opts.en ? tEn : t; const s = hfSumText(h, L);
  return `<details class="hf-fold"${opts.open ? ' open' : ''}><summary><span>${esc(L('Room details'))}</span>${s ? `<small>${esc(s)}</small>` : ''}</summary>${hfFormHTML(h, id, opts)}</details>`; };
// the box's own behavior, for every owner: a suggestion chip adds / takes out its word; the time follows the date;
// Non-refundable turns the date off
document.addEventListener('click', (e) => {
  const bb = e.target.closest && e.target.closest('[data-hf-bed]'); if (bb) { const box = bb.closest('[data-hfbox]'); if (!box) return; e.preventDefault();
    const inp = box.querySelector('[data-hk="beds"]'); inp.value = inp.value.trim().toLowerCase() === bb.dataset.hfBed.toLowerCase() ? '' : bb.dataset.hfBed;
    inp.dispatchEvent(new Event('input', { bubbles: true })); return; }
  const b = e.target.closest && e.target.closest('[data-hf-sug]'); if (!b) return; const box = b.closest('[data-hfbox]'); if (!box) return; e.preventDefault();
  const inp = box.querySelector('[data-hk="room"]'); const w = b.dataset.hfSug; const parts = inp.value.trim() ? inp.value.trim().split(/\s+/) : [];
  const i = parts.findIndex(p => p.toLowerCase() === w.toLowerCase()); if (i >= 0) parts.splice(i, 1); else parts.push(w);
  inp.value = parts.join(' '); b.classList.toggle('on', i < 0); b.setAttribute('aria-pressed', String(i < 0));
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}, true);
document.addEventListener('input', (e) => {
  const el = e.target; if (!el || !el.dataset || !el.dataset.hk) return; const box = el.closest('[data-hfbox]'); if (!box) return;
  const d = box.querySelector('[data-hk="cxd"]'), tm = box.querySelector('[data-hk="cxt"]'), nr = box.querySelector('[data-hk="nonRef"]');
  if (d && tm && nr) { d.disabled = nr.checked; tm.disabled = nr.checked || !d.value; }
  if (el.dataset.hk === 'beds') { const v = el.value.trim().toLowerCase(); box.querySelectorAll('[data-hf-bed]').forEach(b => { const on = b.dataset.hfBed.toLowerCase() === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }
  if (el.dataset.hk === 'room') { const ws = el.value.toLowerCase().split(/[\s,/·-]+/); box.querySelectorAll('[data-hf-sug]').forEach(b => { const on = ws.includes(b.dataset.hfSug.toLowerCase()); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }
}, true);
// inputs for one item; attr = 'data-det' (booking form) or 'data-pdet' (a plan row, saved on change)
function detFormHTML(x, attr = 'data-det', idp = 'dt') {
  const g = detGroup(x); if (!DET[g]) return '';
  return `<div class="det-f">${DET[g].map(([k, label, ty]) => {
    if (attr === 'data-det' && g === 'lodge' && HF_DET.has(k)) return '';
    const id = `${idp}-${k}`; let v = detVal(x, k); if (k === 'cancelBy' && v) v = String(v).slice(0, 10);
    if (ty === 'amen') { const on = v || []; return `<div class="field wide"><span class="lbl-s">${t(label)}</span><div class="chips amen">${AMENITIES.map(([a, l]) => `<button type="button" class="chip ${on.includes(a) ? 'on' : ''}" ${attr}-amen="${a}" aria-pressed="${on.includes(a)}">${t(l)}</button>`).join('')}</div></div>`; }
    if (ty === 'cabin') return `<div class="field"><label for="${id}">${t(label)}</label><select id="${id}" ${attr}="${k}"><option value="">${t('Choose')}</option>${CABINS.map(([c, l]) => `<option value="${c}" ${c === v ? 'selected' : ''}>${t(l)}</option>`).join('')}</select></div>`;
    return `<div class="field${k === 'incl' || k === 'meet' ? ' wide' : ''}"><label for="${id}">${t(label)}</label><input id="${id}" type="${ty === 'number' ? 'number' : ty === 'date' ? 'date' : 'text'}"${ty === 'number' ? ' min="1" max="99"' : ''} ${attr}="${k}" value="${esc(v == null ? '' : v)}" maxlength="200"></div>`;
  }).join('')}</div>`;
}
const photoSrc = (p) => p.g ? (GKEY ? gPhotoURL(p.g).replace('maxWidthPx=800', 'maxWidthPx=400') : '') : p.url || '';
// the small gallery; ref = 'bk:<id>' | 'pl:<id>'
function galleryHTML(x, ref) {
  const ps = (x.photos || []).filter(photoSrc);
  const by = ps.filter(p => p.g && p.by).map(p => p.uri ? `<a href="${esc(p.uri)}" target="_blank" rel="noopener noreferrer">${esc(p.by)}</a>` : esc(p.by));
  return `<div class="gal" data-gal="${esc(ref)}">${ps.map((p, k) => `<figure><img src="${esc(photoSrc(p))}" alt="${esc(x.name || '')}" loading="lazy" onerror="this.closest('figure').hidden=true">${p.g ? '' : `<button type="button" class="ph-x" data-ph-del="${esc(ref)}" data-ph-i="${(x.photos || []).indexOf(p)}" aria-label="${esc(t('Remove photo'))}">×</button>`}</figure>`).join('')}<label class="ph-add" aria-label="${esc(t('Add a photo'))}"><input type="file" accept="image/*" multiple data-ph-add="${esc(ref)}" hidden><span aria-hidden="true">+</span><small>${t('Photo')}</small></label></div>${by.length ? `<p class="muted small g-attr">${t('Photos')}: ${[...new Set(by)].join(', ')} · Google</p>` : ''}`;
}
// "Details" under an item: the read lines, amenities, photos, (plan rows) the inputs
const OPEN_DET = new Set();
function detBlockHTML(x, ref, editable) {
  const ls = detLines(x), am = detAmen(x), n = (x.photos || []).filter(photoSrc).length;
  const sum = [ls.length || am.length ? t('Details') : '', n ? t('{n} photos', { n }) : ''].filter(Boolean).join(' · ') || t('Details & photos');
  return `<details class="det"${OPEN_DET.has(ref) ? ' open' : ''} data-det-ref="${esc(ref)}"><summary>${esc(sum)}</summary>
    ${editable ? detFormHTML(x, 'data-pdet', 'pd-' + ref.replace(/\W/g, '')) : `${ls.length ? `<div class="det-l">${ls.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : ''}${am.length ? `<p class="det-am">${am.map(a => `<span class="tag">${esc(a)}</span>`).join('')}</p>` : ''}`}
    ${galleryHTML(x, ref)}</details>`;
}
// a booking or plan item by ref: read / change (saves + re-renders everything that shows it)
function itemByRef(cfg, ref) { const [k, id] = String(ref).split(/:(.+)/); const xs = k === 'bk' ? itinLoad(cfg) : planLoad(cfg); return xs.find(x => x.id === id) || null; }
function itemMutate(cfg, art, ref, fn) {
  const [k, id] = String(ref).split(/:(.+)/); const xs = k === 'bk' ? itinLoad(cfg) : planLoad(cfg); const x = xs.find(y => y.id === id); if (!x) return false;
  fn(x); if (k === 'bk') { itinSave(cfg, xs); bkChanged(art); if (LS.get('signedIn')) syncPush(cfg); } else { planSave(cfg, xs); art._planChanged && art._planChanged(); } dsRefresh(art);
  return true;
}
// photos: signed in → Storage (≈300 KB JPEG, the guest's own folder); signed out → a small copy on this device (3 per item)
const PHOTO_MAX = 8, LOCAL_PHOTO_MAX = 3;
const blobDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error(t('Couldn’t read it.'))); r.readAsDataURL(b); });
async function photoAdd(f) {
  if (!/^image\//.test(f.type || '')) throw new Error(t('Use a photo, screenshot or PDF.'));
  const user = await myGuestUser();
  if (!user) return { url: await blobDataURL(await shrinkPhoto(f, 60e3, 640)), local: 1 };
  const blob = await shrinkPhoto(f, 300e3, 1600); const path = `${user.id}/trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const c = await sb(); const { error } = await c.storage.from(DOC_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  if (error) throw new Error(error.message || t('Upload failed.'));
  return { url: c.storage.from(DOC_BUCKET).getPublicUrl(path).data.publicUrl };
}
// a Google photo for an item with a Google place id: fetched once, kept on the item (name + author attribution)
const placeIdOf = (x) => { const r = x.ref && (x.src === 'g' || x.pin || /^ChIJ|^[A-Za-z0-9_-]{20,}$/.test(x.ref)) ? x.ref : LODGE.has(x.kind) ? (bkGeo(x).ref || '') : ''; return r && !/^\d+$/.test(r) ? r : ''; };
async function gPhotoPull(cfg, art, ref) {
  const x = itemByRef(cfg, ref); if (!x || !GKEY || x.gph || (x.photos || []).some(p => p.g)) return;
  const id = placeIdOf(x); if (!id) return;
  let ph = []; try { const j = await gFetch(`https://places.googleapis.com/v1/places/${enc(id)}`, null, 'photos'); ph = (j.photos || []).slice(0, 2).map(p => { const a = (p.authorAttributions || [])[0] || {}; return { g: p.name, by: a.displayName || '', uri: a.uri || '' }; }); } catch { return; }
  itemMutate(cfg, art, ref, (y) => { y.gph = 1; if (ph.length) y.photos = (y.photos || []).concat(ph); });
}
// one listener per page: details open state, photo add/remove, plan-row detail inputs, booking-form detail inputs
function wireDetails(cfg, art) {
  if (art._detWired) return; art._detWired = true;
  art.addEventListener('toggle', (e) => { const d = e.target; if (!d.matches || !d.matches('details.det')) return; const ref = d.dataset.detRef;
    if (d.open) { OPEN_DET.add(ref); gPhotoPull(cfg, art, ref).catch(() => {}); } else OPEN_DET.delete(ref); }, true);
  art.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-ph-add]'); if (inp && inp.files && inp.files.length) {
      const ref = inp.dataset.phAdd; const x = itemByRef(cfg, ref); if (!x) return; const lab = inp.closest('.ph-add'); lab && lab.classList.add('busy');
      const files = [...inp.files]; inp.value = ''; const got = [];
      for (const f of files) { const have = (x.photos || []).length + got.length; const local = (x.photos || []).concat(got).filter(p => p.local).length;
        if (have >= PHOTO_MAX) { toast(t('Up to {n} photos', { n: PHOTO_MAX })); break; }
        if (!LS.get('signedIn') && local >= LOCAL_PHOTO_MAX) { toast(t('Sign in to add more photos')); break; }
        try { got.push(await photoAdd(f)); } catch (err) { toast(err.message || t('Upload failed.')); break; } }
      lab && lab.classList.remove('busy'); OPEN_DET.add(ref);
      if (got.length) { try { itemMutate(cfg, art, ref, (y) => { y.photos = (y.photos || []).concat(got); }); } catch { toast(t('Not enough space on this device. Sign in to keep photos.')); } }
      return; }
    const pd = e.target.closest('[data-pdet]'); if (pd) { const ref = pd.closest('[data-det-ref]').dataset.detRef; OPEN_DET.add(ref); itemMutate(cfg, art, ref, (y) => detSet(y, pd.dataset.pdet, pd.type === 'number' ? (pd.value ? String(Math.max(1, Math.min(99, +pd.value))) : '') : pd.value.trim().slice(0, 200))); }
  });
  art.addEventListener('click', (e) => {
    const del = e.target.closest('[data-ph-del]'); if (del) { e.preventDefault(); const ref = del.dataset.phDel, i = +del.dataset.phI; OPEN_DET.add(ref); itemMutate(cfg, art, ref, (y) => { y.photos = (y.photos || []).filter((_, k) => k !== i); }); return; }
    const am = e.target.closest('[data-pdet-amen]'); if (am) { const ref = am.closest('[data-det-ref]').dataset.detRef; OPEN_DET.add(ref); itemMutate(cfg, art, ref, (y) => { const on = new Set(detVal(y, 'amen') || []); on.has(am.dataset.pdetAmen) ? on.delete(am.dataset.pdetAmen) : on.add(am.dataset.pdetAmen); detSet(y, 'amen', [...on]); }); }
  });
}

// ================= detail sheets: tap a booking, a place, a plan item, a day or a schedule item → one sheet =================
// One pattern everywhere: a bottom sheet (centered card on wide screens) with the thing's key facts on top, a ticket-style
// perforation, then where it is (address, small map, Open in Google Maps), notes, photos (add from the camera roll) and its
// actions. Refs: bk:<booking id> · pl:<plan/saved place id> · ev:<schedule index> · day:<YYYY-MM-DD> · hh:<host hotel name>.
// The open sheet is in the address bar (?d=<ref>) so Back closes it and the link opens it again; Back inside the sheet
// returns to the sheet it came from (a day → one of its items).
const dsDay = (s) => s ? fmt(s.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' }) : '';
const dsTm = (s) => s && s.length > 10 ? fmtTime(s.slice(11, 16)) : '';
const hostHotelName = (title) => String(title || '').replace(/^\s*check[- ]?in\s*[:\-–—·]?\s*(at\s+)?/i, '').trim();
const isHostHotel = (x) => !!x && HOTEL_RE.test(x.title || '') && !/check[- ]?out/i.test(x.title || '');
// the organizer's hotel lines: "Check in: <hotel>" (or a hotel reservation) and its "Check out: <hotel>"
const hotelCiLine = (x) => isHostHotel(x) && !!x.date && (/\bcheck[- ]?in\b/i.test(x.title || '') || x.kind === 'reservation');
// a free-form stay line the organizer typed (or a document brought): "Tokyo: Hotel X, 6 nights", "Arima onsen: ryokan,
// 2 nights (not chosen yet)" — a hotel word plus a number of nights, or "<place>: <hotel word>…". It is that stop's hotel
// line like a check-in ("Dinner at the hotel" is not: no nights, no "<place>:" lead)
const NIGHT_N = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const stayNights = (title) => { const m = String(title || '').match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+nights?\b/i); return m ? (+m[1] || NIGHT_N[m[1].toLowerCase()] || 0) : 0; };
const hotelFreeLine = (x) => isHostHotel(x) && !!x.date && !hotelCiLine(x) && (stayNights(x.title) > 0 || /^\s*[^:]{1,40}:\s*(the\s+)?(hotel|hostel|ryokan|resort|airbnb|guest ?house|inn|lodge)\b/i.test(x.title || ''));
// any line that says where someone sleeps at a stop: a check-in or a free-form stay line
const hotelStayLine = (x) => hotelCiLine(x) || hotelFreeLine(x);
const hotelCoName = (x) => x && /^\s*check[- ]?out\b/i.test(x.title || '') ? String(x.title).replace(/^\s*check[- ]?out\s*[:\-–—·]?\s*((of|from|at)\s+)?/i, '').trim() : '';
const hotelCoLines = (sch, x) => { const n = hostHotelName(x.title); return sch.filter(y => y !== x && y.date && y.date >= x.date && hotelCoName(y) && nameLike(hotelCoName(y), n)); };
// a hotel line's nights: check-in day → its own check-out line, else the end of its leg, else one night
function hostStay(cfg, sch, x) { const co = hotelCoLines(sch, x).map(y => y.date).sort()[0]; const leg = legOfDay(cfg, x.date); const n = stayNights(x.title); return [x.date, co && co > x.date ? co : n ? addDays(x.date, n) : leg && leg.to && leg.to > x.date ? leg.to : addDays(x.date, 1)]; }
// a hotel from a document replaces the organizer's hotel it supersedes: another hotel's check-in at the same stop with
// overlapping nights (and its check-out) leaves the schedule. fromDoc = the schedule items the document brought (two hotels
// in one document both stay). Returns the items taken out. (Dylan 11/24: a PDF for the new hotel kept the old one.)
function hostHotelReplace(cfg, fromDoc) {
  const sch = cfg.schedule || []; const news = fromDoc.filter(hotelCiLine); if (!news.length) return [];
  const drop = new Set();
  sch.forEach(x => { if (fromDoc.includes(x) || !hotelStayLine(x)) return; const n = hostHotelName(x.title); const sx = hostStay(cfg, sch, x); // free-form "Tokyo: Hotel X, 6 nights" lines too (Dylan's page kept them)
    if (!news.some(y => !nameLike(hostHotelName(y.title), n) && stopOfDay(cfg, y.date) === stopOfDay(cfg, x.date) && spanHit(sx, hostStay(cfg, sch, y)))) return;
    drop.add(x); hotelCoLines(sch, x).forEach(z => { if (!fromDoc.includes(z) && z.date <= sx[1]) drop.add(z); }); });
  if (drop.size) cfg.schedule = sch.filter(x => !drop.has(x));
  return [...drop];
}
// everything on the trip's schedule (the organizer's items + the guest's bookings and planned places), each with its sheet ref
function schedEntries(cfg) {
  const fit = (d) => isTrip(cfg) && d ? fitTripDate(cfg.start, cfg.end, d, false) : d || '';
  const evs = cfg.off.schedule ? [] : cfg.schedule.filter(x => x.title).map(x => { const d = fit(x.date); return { ev: true, ref: 'ev:' + cfg.schedule.indexOf(x), start: d + (d && x.time ? 'T' + x.time : ''), name: x.title, note: x.note, place: x.place ? x.place.name : '', kind: x.kind || '', si: cfg.schedule.indexOf(x), _cc: { city: d ? stopOfDay(cfg, d) : -1, cat: ccCatOfEv(x), text: [x.title, x.note].join(' '), host: true } }; });
  const mine = cfg.tools.mytrip ? itinLoad(cfg).map((x, i) => ({ ...x, i, ref: x.id ? 'bk:' + x.id : '', _cc: ccBkItem(cfg, x) }))
    .concat(itinLoad(cfg).filter(x => LODGE.has(x.kind) && bkDay(x.end) > bkDay(x.start) && bkDay(x.start)).map(x => ({ ...x, co: true, ref: x.id ? 'bk:' + x.id : '', start: x.end, _cc: ccBkItem(cfg, x) })))
    .concat(planLoad(cfg).filter(x => x.day).map(x => ({ kind: '', pl: true, ref: 'pl:' + x.id, name: x.name, start: x.day + (x.time ? 'T' + x.time : ''), confNo: x.booked ? x.conf : '', note: x.note, _cc: { city: ccCityOfPlan(cfg, x), cat: ccCatOfPlan(x), text: [x.name, x.addr, x.note].join(' '), saved: true, booked: !!x.booked } }))) : [];
  return { evs, mine };
}
// the guest's booking for a hotel the organizer put on the itinerary (same name), if they added one
// (the one checking in that day first: the same hotel twice on one trip is two stays)
const bookingForHotel = (cfg, name, when) => { if (!name) return null; const xs = itinLoad(cfg).filter(x => LODGE.has(x.kind) && x.name && nameLike(x.name, name)); return (when && xs.find(x => bkDay(x.start) === when)) || xs[0] || null; };
// is the organizer's item the check-in at this booked hotel? "Check in: <hotel>" (any close name), or an item that is just
// the hotel's name ("Ceremony at Hotel Esencia" or "Dinner at the hotel" is not a check-in)
const isCheckinFor = (x, name) => { if (!isHostHotel(x) || !name) return false; const n = hostHotelName(x.title); if (n !== String(x.title || '').trim()) return nameLike(name, n);
  const A = new Set(nameToks(n)), B = nameToks(name); return !!A.size && B.length === A.size && B.every(w => A.has(w)); };
// One day order for every merged schedule (the trip Itinerary / event schedule and a day's sheet): days in date order,
// undated last; inside a day, by time. An item without a time keeps its place in its own list: it follows the item before
// it there (the organizer's schedule order, the guest's own list order), or opens the day when it is first. Same time →
// the organizer's item first. And the guest's booking for the hotel the organizer checks everyone into (same hotel, same
// day) is not a second row: it folds into the organizer's check-in row, marked as theirs; the row keeps its ev: ref, whose
// sheet is the guest's booking (dsHostHotelHTML).
function schedMerge(cfg, evs, mine) {
  const day = (x) => (x.start || '').slice(0, 10), tm = (x) => (x.start || '').slice(11, 16);
  if (mine.length) { mine = mine.slice(); evs = evs.map(e => { const ev = cfg.schedule[e.si]; if (!ev || !day(e) || !isHostHotel(ev)) return e;
    const j = mine.findIndex(b => LODGE.has(b.kind) && !b.co && !b.pl && bkDay(b.start) === day(e) && isCheckinFor(ev, b.name)); if (j < 0) return e;
    const b = mine.splice(j, 1)[0];
    return { ...e, bk: b, start: tm(e) ? e.start : b.start || e.start, confNo: b.confNo || '', _cc: { ...e._cc, booked: true, text: [e._cc.text, b._cc && b._cc.text].filter(Boolean).join(' ') } }; }); }
  const keyed = []; [evs, mine].forEach(xs => { const last = {}; xs.forEach(x => { const d = day(x), h = tm(x); const k = h || last[d] || ''; if (h) last[d] = h; keyed.push([x, d || '9999', k]); }); });
  return keyed.sort((a, b) => a[1].localeCompare(b[1]) || a[2].localeCompare(b[2])).map(a => a[0]);
}
const dsFact = (k, v) => v ? `<div class="ds-f"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>` : '';
const dsMapsURL = (name, addr, geo, pid) => `https://www.google.com/maps/search/?api=1&query=${enc(addr ? `${name}, ${addr}` : geo && geo.lat != null ? `${geo.lat},${geo.lon}` : name)}${pid ? '&query_place_id=' + enc(pid) : ''}`;
const dsDirURL = (name, addr, geo, pid) => `https://www.google.com/maps/dir/?api=1&destination=${enc(geo && geo.lat != null && !addr ? `${geo.lat},${geo.lon}` : [name, addr].filter(Boolean).join(', '))}${pid ? '&destination_place_id=' + enc(pid) : ''}`;
// "Where": address, a small map when the place has a point, Open in Google Maps + Directions
function dsWhereHTML(name, addr, geo, pid, cat, opts = {}) {
  if (!name && !addr) return '';
  const pt = geo && geo.lat != null;
  return `<section class="ds-sec ds-where"><h3>${t('Location')}</h3>${addr ? `<p class="ds-addr">${esc(addr)}</p>` : ''}
    <div class="ds-map${pt ? '' : ' empty'}" data-ds-map${pt ? ` data-lat="${geo.lat}" data-lon="${geo.lon}"` : ''} data-cat="${esc(cat || '')}" data-q="${esc(opts.q || '')}"${opts.key ? ` data-key="${esc(opts.key)}"` : ''} aria-hidden="true"></div>
    <div class="ds-links"><a class="btn sm primary" href="${esc(dsMapsURL(name, addr, geo, pid))}" target="_blank" rel="noopener noreferrer">${t('Open in Google Maps')}</a><a class="btn sm" href="${esc(dsDirURL(name, addr, geo, pid))}" target="_blank" rel="noopener noreferrer">${t('Directions')}</a></div></section>`;
}
function dsPhotosHTML(x, ref) {
  return `<section class="ds-sec ds-ph" data-ph-ref="${esc(ref)}"><h3>${t('Photos')}</h3>${galleryHTML(x, ref)}<p class="muted small ds-ph-hint">${esc(t(LS.get('signedIn') ? 'Add photos from your phone or computer' : 'Add photos from your phone or computer — sign in to keep more than 3'))}</p></section>`;
}
const dsHead = (o) => `<header class="ds-h">
    <div class="ds-bar">${o.back ? `<button type="button" class="ds-back" data-ds-back aria-label="${esc(t('Back'))}">‹ ${esc(t('Back'))}</button>` : '<span></span>'}<button type="button" class="ds-x" data-ds-close aria-label="${esc(t('Close'))}">×</button></div>
    <p class="ds-k">${o.icon || ''}<span>${esc(o.kicker || '')}</span></p><h2 class="ds-t" id="ds-title">${esc(o.title)}</h2>${o.sub ? `<p class="ds-sub">${o.sub}</p>` : ''}</header>`;
// Notes: a short preview; a long note folds after a few lines with More / Less
const dsNotesHTML = (note) => { note = String(note || '').trim(); if (!note) return ''; const long = note.length > 220 || note.split('\n').length > 4;
  return `<section class="ds-sec ds-notes"><h3>${t('Notes')}</h3><p class="ds-note${long ? ' clamp' : ''}">${rtBr(note)}</p>${long ? `<button type="button" class="mini-b ds-nmore" data-ds-nmore aria-expanded="false">${t('More')}</button>` : ''}</section>`; };
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-ds-nmore]'); if (!b) return; const p = b.previousElementSibling; const open = p.classList.toggle('clamp') === false; b.textContent = t(open ? 'Less' : 'More'); b.setAttribute('aria-expanded', String(open)); });
const dsFacts = (fs) => { const h = fs.filter(Boolean).join(''); return h ? `<dl class="ds-facts">${h}</dl>` : ''; };
const PERF = '<div class="ds-perf" aria-hidden="true"></div>';
// a booking: hotel (check-in/out, nights, room type, beds, guests, amenities, cancellation, price), flight, train, car, tour…
function dsBookingHTML(cfg, x, back) {
  const g = detGroup(x); const via = viaOf(x); const fl = x.kind === 'flight' ? flightLinks(x.flight) : {};
  const cat = ccCatOfBooking(x); const city = bkDay(x.start) && stopsOf(cfg).length > 1 && stopFor(cfg, bkDay(x.start)) ? stopFor(cfg, bkDay(x.start)).name : '';
  const fs = [];
  if (g === 'lodge') {
    const n = bkDay(x.start) && bkDay(x.end) ? daysBetween(bkDay(x.start), bkDay(x.end)) : 0;
    fs.push(dsFact(t('Check-in'), [dsDay(x.start), dsTm(x.start)].filter(Boolean).join(' · ')), dsFact(t('Check-out'), [dsDay(x.end), dsTm(x.end)].filter(Boolean).join(' · ')), n > 0 ? dsFact(t('Nights'), String(n)) : '');
  } else if (g === 'car') fs.push(dsFact(t('Pick-up'), [dsDay(x.start), dsTm(x.start)].filter(Boolean).join(' · ')), dsFact(t('Drop-off'), [dsDay(x.end), dsTm(x.end)].filter(Boolean).join(' · ')));
  else if (x.kind === 'flight') fs.push(dsFact(t('Departs'), [dsDay(x.start), dsTm(x.start)].filter(Boolean).join(' · ')), dsFact(t('Lands'), x.start && x.start.length > 10 && flightArrLabel(x) ? flightArrLabel(x).replace(t('Arrives') + ' ', '') : ''), dsFact(t('Flight'), x.flight || ''));
  else fs.push(dsFact(t('When'), [dsDay(x.start), dsTm(x.start)].filter(Boolean).join(' · ')), x.end ? dsFact(t('Until'), [bkDay(x.end) !== bkDay(x.start) ? dsDay(x.end) : '', dsTm(x.end)].filter(Boolean).join(' · ')) : '');
  if (g === 'lodge') fs.push(...hfFacts(hfOfBk(x)));
  (DET[g] || []).forEach(([k, label, ty]) => { const v = detVal(x, k); if (!bkFilled(v) || ty === 'amen' || (g === 'lodge' && HF_DET.has(k))) return;
    fs.push(dsFact(t(label), ty === 'cabin' ? t((CABINS.find(c => c[0] === v) || [v, v])[1]) : ty === 'date' ? fmt(v, { month: 'short', day: 'numeric' }) : String(v))); });
  fs.push(dsFact(t('Confirmation'), x.confNo || ''), dsFact(t('Booked through'), via ? via.name || (via.key === 'direct' ? t('Direct') : '') : ''));
  const am = detAmen(x); const geo = bkGeo(x); const pid = placeIdOf(x);
  const links = [via && via.url ? ext(via.url, `${t('Manage booking')} · ${via.name}`, 'btn sm') : fl.manage ? ext(fl.manage, t('Manage booking'), 'btn sm') : '', fl.status ? ext(fl.status, t('Flight status'), 'btn sm') : '', x.link ? ext(x.link, t('Open booking'), 'btn sm') : ''].join('');
  const idx = itinLoad(cfg).findIndex(y => y.id === x.id);
  return `${dsHead({ back, icon: ccIcon(ccIk(cat, x)), kicker: [t(ITIN_KINDS[x.kind] || 'Booking'), city].filter(Boolean).join(' · '), title: x.name || t(ITIN_KINDS[x.kind] || 'Booking'),
      sub: g === 'lodge' && bkDay(x.start) ? esc(dateRange(bkDay(x.start), bkDay(x.end) || bkDay(x.start))) : '' })}
    <div class="ds-b">${bkOffTrip(cfg, x) ? `<p class="ds-warn" role="note">${esc(t('These dates don’t match the trip ({d}). Check this booking.', { d: routeSpan(cfg) ? dateRange(...routeSpan(cfg)) : '' }))}</p>` : ''}${dsFacts(fs)}${idx >= 0 && g === 'lodge' ? `<div class="ds-acts ds-rm"><button type="button" class="btn sm bk-rm hb-rm" data-ds-rmbk="${esc(x.id)}">${TRASH_IC}${t('Remove hotel')}</button></div>` : ''}${am.length ? `<p class="ds-tags">${am.map(a => `<span class="tag">${esc(a)}</span>`).join('')}</p>` : ''}${PERF}
    ${x.kind === 'flight' ? '' : dsWhereHTML(x.name || '', x.address || '', geo, pid, cat, { q: [x.name, x.address].filter(Boolean).join(', '), key: [x.name, x.address].filter(Boolean).join(', ') })}
    ${dsNotesHTML(x.note)}
    ${x.id ? dsPhotosHTML(x, 'bk:' + x.id) : ''}
    <div class="ds-acts">${links}${idx >= 0 ? `<button type="button" class="btn sm ghost" data-ds-edit="${idx}">${t('Edit booking')}</button>` : ''}</div></div>`;
}
// a saved / planned place: what and where, the guest's plan for it (day, category, booked), details, photos
function dsPlaceHTML(cfg, x, back) {
  const cat = ccCatOfPlan(x); const days = planDays(cfg); const ls = detLines(x);
  const fs = [dsFact(t('Day'), x.day ? dayLabel(cfg, x.day) : t('Saved for later')), dsFact(t('Time'), x.time ? fmtTime(x.time) : ''), dsFact(t('Confirmation'), x.booked ? x.conf || '' : ''),
    ...ls.map(l => { const m = l.match(/^([^:]+):\s*(.+)$/); return m ? dsFact(m[1], m[2]) : ''; })];
  const geo = x.lat != null ? { lat: x.lat, lon: x.lon } : null;
  return `${dsHead({ back, icon: ccIcon(ccIk(cat, x)), kicker: [ccLabel(cat), x.booked ? t('Booked') : ''].filter(Boolean).join(' · '), title: x.name || t('Place'), sub: x.rating ? gRatingHTML(x) : '' })}
    <div class="ds-b">${dsFacts(fs)}${detAmen(x).length ? `<p class="ds-tags">${detAmen(x).map(a => `<span class="tag">${esc(a)}</span>`).join('')}</p>` : ''}${PERF}
    ${dsWhereHTML(x.name || '', x.addr || '', geo, x.src === 'g' ? x.ref : '', cat)}
    ${x.hours ? `<section class="ds-sec"><h3>${t('Hours')}</h3><p class="ds-note">${esc(prettyHours(x.hours))}</p></section>` : ''}
    ${x.note ? `<section class="ds-sec"><h3>${t('Notes')}</h3><p class="ds-note">${rtBr(x.note)}</p></section>` : ''}
    ${dsPhotosHTML(x, 'pl:' + x.id)}
    <section class="ds-sec ds-plan" data-ds-plan="${esc(x.id)}"><h3>${t('Your plan')}</h3>
      <div class="two"><label class="field"><span>${t('Day')}</span><select data-dsp="day"><option value="">${t('Saved for later')}</option>${days.map(d => `<option value="${d}" ${x.day === d ? 'selected' : ''}>${esc(dayLabel(cfg, d))}</option>`).join('')}</select></label>
      <label class="field"><span>${t('Time (optional)')}</span><input type="time" data-dsp="time" value="${esc(x.time || '')}"${x.day ? '' : ' disabled'}></label></div>
      <div class="two"><label class="field"><span>${t('Category')}</span><select data-dsp="cat">${CC_CATS.map(([v, l]) => `<option value="${v}" ${cat === v ? 'selected' : ''}>${t(l)}</option>`).join('')}<option value="" ${cat ? '' : 'selected'}>${t('Other')}</option></select></label>
      <label class="field"><span>${t('Note (optional)')}</span><input data-dsp="note" maxlength="200" value="${esc(x.note || '')}"></label></div>
      <div class="plan-book"><label class="chk"><input type="checkbox" data-dsp="booked" ${x.booked ? 'checked' : ''}> ${t('Booked')}</label>${x.booked ? `<input class="plan-conf" data-dsp="conf" value="${esc(x.conf || '')}" placeholder="${t('Confirmation #')}" aria-label="${t('Confirmation #')}">` : ''}</div>
      ${x.day ? `<div class="ds-mv"><button type="button" class="btn sm" data-ds-mv="-1">↑ ${t('Earlier in the day')}</button><button type="button" class="btn sm" data-ds-mv="1">↓ ${t('Later in the day')}</button></div>` : ''}
      ${DET[detGroup(x)] ? `<details class="ds-more" data-det-ref="pl:${esc(x.id)}"${OPEN_DET.has('pl:' + x.id) ? ' open' : ''}><summary>${t('More details')}</summary>${detFormHTML(x, 'data-pdet', 'ds-' + x.id.replace(/\W/g, ''))}</details>` : ''}
    </section>
    <div class="ds-acts">${x.src === 'g' && x.ref ? `<button type="button" class="btn sm" data-ds-gp="${esc(x.ref)}">${t('More about this place')}</button>` : ''}<button type="button" class="btn sm ghost danger-t" data-ds-del="${esc(x.id)}">${t('Remove from my trip')}</button></div></div>`;
}
// the organizer's room / cancellation / notes for a hotel they listed: its check-in row, else the room block or a stay
// option with that hotel
function hostHotelHF(cfg, name, when, ev) {
  if (!ev && name) { const xs = (cfg.schedule || []).filter(x => isHostHotel(x) && nameLike(hostHotelName(x.title), name)); ev = xs.find(x => x.date === when) || xs[0] || null; }
  const own = hfOfEv(ev); const d = typeData(cfg);
  const other = d.blockHotel && nameLike(d.blockHotel, name) ? hfOfBlock(d) : hfOfEv(((presetsOf(cfg).find(p => p.h && nameLike(p.h.name, name)) || {}).h) || null);
  return { room: own.room || other.room, beds: own.beds || other.beds, cancelBy: own.cancelBy || (own.nonRef ? '' : other.cancelBy), nonRef: own.nonRef || (!own.cancelBy && other.nonRef), note: own.note || other.note };
}
// a hotel the organizer listed (Check in: …) — and the guest's own booking for it when they have one
function dsHostHotelHTML(cfg, name, when, back, ev) {
  const bk = bookingForHotel(cfg, name, when); if (bk) return dsBookingHTML(cfg, bk, back); const hf = hostHotelHF(cfg, name, when, ev);
  const geo = LS.get(hgeoKey(name)); const g = geo && !geo.miss ? geo : null; const city = when && stopsOf(cfg).length > 1 && stopFor(cfg, when) ? stopFor(cfg, when).name : '';
  const leg = legOfDay(cfg, when);
  // a guest on the invite link: the organizer's hotel is a suggestion — one tap makes it theirs (a hotel booking)
  const sug = !!cfg._sug && cfg.tools.mytrip; const ci = sug && when ? stopOfDay(cfg, when) : -1;
  const shs = sug ? hotelsNow(cfg, { sug: true }).flat().filter(h => h.src === 'sug' && nameLike(h.name, name)) : []; const sh = shs.find(h => h.from === when) || shs[0] || null;
  const cta = sug ? `<section class="ds-sec ds-cta ds-sug"><p class="muted small">${t('Suggested by the organizer. Choose it to make it your hotel.')}</p>${hsSlotHTML(cfg, { name, addr: g ? g.addr || '' : '', ref: g ? g.ref || '' : '', lat: g ? g.lat : undefined, lon: g ? g.lon : undefined, sug: 1, from: sh ? sh.from : when || '', to: sh ? sh.to : leg && leg.to && leg.to > when ? leg.to : '', ci }, false)}<div class="btns"><button type="button" class="btn sm ghost" data-ds-addbk>+ ${t('Add a booking')}</button></div></section>`
    : cfg.tools.mytrip ? `<section class="ds-sec ds-cta"><p class="muted small">${t('Staying here? Add your booking to keep your room type and confirmation with the trip.')}</p><button type="button" class="btn sm" data-ds-addbk>+ ${t('Add a booking')}</button></section>` : '';
  return `${dsHead({ back, icon: ccIcon('hotels'), kicker: [sug ? t('Suggested hotel') : t('Hotel'), city].filter(Boolean).join(' · '), title: name, sub: when ? esc(dateRange(when, leg && leg.to && leg.to > when ? leg.to : when)) : '' })}
    <div class="ds-b">${dsFacts([dsFact(t('Check-in'), [dsDay(when), ev && ev.time ? fmtTime(ev.time) : ''].filter(Boolean).join(' · ')), leg && leg.to && leg.to > when ? dsFact(t('Check-out'), dsDay(leg.to)) : '', ...hfFacts(hf)])}${PERF}
    ${dsWhereHTML(name, g ? g.addr || '' : '', g, g ? g.ref || '' : '', 'hotels', { q: [name, city || (cfg.venue && cfg.venue.city) || ''].filter(Boolean).join(', '), key: name })}
    ${dsNotesHTML(hf.note)}
    ${cta}</div>`;
}
// one item on the organizer's schedule
function dsEventHTML(cfg, si, back) {
  const x = cfg.schedule[si]; if (!x) return '';
  const d = isTrip(cfg) && x.date ? fitTripDate(cfg.start, cfg.end, x.date, false) : x.date || '';
  if (isTrip(cfg) && isHostHotel(x)) return dsHostHotelHTML(cfg, hostHotelName(x.title), d, back, x);
  { const bk = cfg.tools.mytrip && d && isHostHotel(x) ? itinLoad(cfg).find(b => LODGE.has(b.kind) && bkDay(b.start) === d && isCheckinFor(x, b.name)) : null; if (bk) return dsBookingHTML(cfg, bk, back); } // an event's "Check in: <hotel>" the guest booked
  const v = cfg.venue; const city = d && stopsOf(cfg).length > 1 && stopFor(cfg, d) ? stopFor(cfg, d) : null; const cat = ccCatOfEv(x); const p = x.place;
  // where: the item's own place when it has one; else a Google Maps search for the item (never the main venue's pin: a welcome party is often somewhere else)
  const find = (q) => dsWhereHTML(q, '', null, '', cat, { q }).replace(`<h3>${t('Location')}</h3>`, `<h3>${t('Find it')}</h3>`);
  const where = p ? dsWhereHTML(p.name, p.address && p.address !== p.name ? p.address : '', p.lat != null ? p : null, p.gid || '', cat, { key: [p.name, p.address].filter(Boolean).join(', ') })
    : isTrip(cfg) ? dsWhereHTML(x.title, city ? [city.city || city.name, city.country].filter(Boolean).join(', ') : '', null, '', cat, { q: [x.title, city ? city.city || city.name : v && v.city].filter(Boolean).join(', ') }).replace(`<h3>${t('Location')}</h3>`, `<h3>${t('Find it')}</h3>`)
    : x.title ? find([x.title, v && (v.city || v.region)].filter(Boolean).join(', ')) : '';
  return `${dsHead({ back, icon: ccIcon(ccIk(cat, x) || 'pin'), kicker: [x.kind && x.kind !== 'activity' ? t(PLAN_KINDS[x.kind] || '') : isTrip(cfg) ? t('Plan') : t(cfg.type || 'Event'), city ? city.name : ''].filter(Boolean).join(' · '), title: x.title, sub: p ? esc(p.name) : '' })}
    <div class="ds-b">${dsFacts([dsFact(t('Date'), d ? fmt(d, { weekday: 'long', month: 'long', day: 'numeric' }) : ''), dsFact(t('Time'), x.time ? fmtTime(x.time) : '')])}
    ${x.note ? `<p class="ds-note ds-lead">${rtBr(x.note)}</p>` : ''}${PERF}
    ${where}</div>`;
}
// a day: every plan, booking and stay on it, each tappable
function dsDayHTML(cfg, d, back) {
  const { evs, mine } = schedEntries(cfg); const xs = schedMerge(cfg, evs, mine).filter(x => (x.start || '').slice(0, 10) === d);
  const st = stopsOf(cfg).length ? stopFor(cfg, d) : null; const n = isTrip(cfg) && cfg.start && d >= cfg.start.slice(0, 10) ? daysBetween(cfg.start, d) + 1 : 0;
  const ci = st ? stopsOf(cfg).indexOf(st) : -1; const nb = tabsFor(cfg).some(x => x[0] === 'nearby') && st && st.lat != null;
  const stays = itinLoad(cfg).filter(x => LODGE.has(x.kind) && bkDay(x.start) && bkDay(x.start) < d && bkDay(x.end) > d); // nights in the middle of a stay
  const row = (x) => { const cat = x._cc ? x._cc.cat : ''; const title = x.co ? t('Check out · {n}', { n: x.name || t('Hotel') }) : x.name || t(ITIN_KINDS[x.kind] || 'Booking');
    const sub = x.bk ? [t('Yours'), x.confNo ? t('Conf. {n}', { n: x.confNo }) : ''].filter(Boolean).join(' · ') : x.ev ? x.note || '' : x.pl ? t('Saved spot') : [t(ITIN_KINDS[x.kind] || ''), x.confNo ? t('Conf. {n}', { n: x.confNo }) : ''].filter(Boolean).join(' · ');
    return `<li><button type="button" class="ds-row" ${x.ref ? `data-ds="${esc(x.ref)}"` : 'disabled'}><time>${esc(dsTm(x.start)) || '—'}</time>${ccIcon(x.co ? 'hotels' : ccIk(cat, x) || 'pin')}<span class="ds-row-t"><b>${esc(title)}</b>${sub ? `<small>${!x.bk && x.ev ? rtHTML(sub) : esc(sub)}</small>` : ''}</span>${x.ref ? '<i class="ds-chev" aria-hidden="true"></i>' : ''}</button></li>`; };
  return `${dsHead({ back, icon: '', kicker: [n ? t('Day {n}', { n }) : '', st && stopsOf(cfg).length > 1 ? st.name : ''].filter(Boolean).join(' · '), title: fmt(d, { weekday: 'long', month: 'long', day: 'numeric' }) })}
    <div class="ds-b">${xs.length || stays.length ? `<ol class="ds-day">${xs.map(row).join('')}${stays.map(x => row({ ...x, ref: 'bk:' + x.id, start: '', name: x.name, _cc: { cat: 'hotels' }, confNo: '' }).replace('<b>', `<b>${esc(t('Staying at'))} `)).join('')}</ol>` : `<p class="muted">${t('Nothing planned yet.')}</p>`}
    ${nb ? `<div class="ds-acts"><button type="button" class="btn sm" data-ds-near="${ci}">${esc(t('Explore {c}', { c: st.city || st.name }))}</button></div>` : ''}</div>`;
}
function dsHTML(cfg, ref, back) {
  const [k, id] = String(ref).split(/:(.+)/); if (!id) return '';
  if (k === 'bk') { const x = itinLoad(cfg).find(y => y.id === id); return x ? dsInsTop(dsBookingHTML(cfg, x, back), shTopHTML(x, 'bk')) : ''; }
  if (k === 'pl') { const x = planLoad(cfg).find(y => y.id === id); return x ? dsInsTop(dsPlaceHTML(cfg, x, back), shTopHTML(x, 'pl')) : ''; }
  if (k === 'ev') { const h = dsEventHTML(cfg, +id, back); const x = cfg.schedule[+id]; if (!h || !cfg._gv || !x || !x.id) return h; // a guest: their copy's buttons
    const at = h.lastIndexOf('</div>'); return dsInsTop(at < 0 ? h : h.slice(0, at) + ovActsHTML(x) + h.slice(at), ovTopHTML(x)); }
  if (k === 'day') return /^\d{4}-\d\d-\d\d$/.test(id) ? dsDayHTML(cfg, id, back) : '';
  if (k === 'hh') { const h = hotelsNow(cfg, { sug: true }).flat().find(y => y.name === id); return dsHostHotelHTML(cfg, id, h ? h.from : '', back); }
  return '';
}
// the sheet's small map: Leaflet + OpenStreetMap tiles, not draggable (Open in Google Maps is the real map)
function dsMap(el) {
  if (!el || !window.L || !window.L.map) return;
  const lat = +el.dataset.lat, lon = +el.dataset.lon; if (!el.dataset.lat || !isFinite(lat) || !isFinite(lon)) return;
  const Lf = window.L; el.innerHTML = '';
  const m = Lf.map(el, { dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, zoomControl: false, attributionControl: true }).setView([lat, lon], 15);
  Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
  Lf.marker([lat, lon], { icon: Lf.divIcon({ className: 'ccpin ds-pin', html: `<img src="${ccPinURL(el.dataset.cat || 'pin', false)}" alt="">`, iconSize: [36, 36], iconAnchor: [18, 18] }), interactive: false }).addTo(m);
  el._m = m; setTimeout(() => { try { m.invalidateSize(); } catch {} }, 60);
}
// a place without a stored point (a hotel the organizer typed): find it once, keep it with the other hotel points
async function dsLocate(cfg, el) {
  const q = el && el.dataset.q; if (!q || el.dataset.lat) return;
  const near = cfg.venue && cfg.venue.lat != null ? cfg.venue : null;
  const parts = q.split(',').map(x => x.trim()).filter(Boolean); const tries = [q]; if (parts.length > 2) tries.push(parts[0] + ', ' + parts[parts.length - 1]);
  let r; for (const qq of tries) { r = await geocode(qq).then(xs => (xs || []).find(x => x.lat != null && !(x.types || []).some(ty => ty === 'country' || ty === 'continent' || ty === 'locality') && (!near || distM(x.lat, x.lon, near.lat, near.lon) < 600000))).catch(() => undefined); if (r) break; }
  if (!r) return; if (el.dataset.key) LS.set(hgeoKey(el.dataset.key), { lat: r.lat, lon: r.lon, addr: r.address || '', ref: r.gid || '' });
  if (!document.body.contains(el)) return;
  el.dataset.lat = r.lat; el.dataset.lon = r.lon; el.classList.remove('empty'); dsMap(el);
  const a = el.closest('.ds-where'); if (a && r.address && !a.querySelector('.ds-addr')) a.querySelector('h3').insertAdjacentHTML('afterend', `<p class="ds-addr">${esc(r.address)}</p>`);
}
const dsParam = () => new URLSearchParams(location.search).get('d') || '';
function dsURL(ref) { const q = new URLSearchParams(location.search); if (ref) q.set('d', ref); else q.delete('d'); const s = q.toString(); return location.pathname + (s ? '?' + s : '') + location.hash; }
function openDetail(cfg, art, ref, how = 'push') {
  if (!art || !ref) return null;
  let d = art.querySelector(':scope > dialog.ds-sheet');
  if (!d) {
    d = document.createElement('dialog'); d.className = 'sheet ds-sheet'; d.setAttribute('aria-labelledby', 'ds-title'); art.appendChild(d);
    d.addEventListener('click', (e) => { if (e.target === d) dsClose(art); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); dsClose(art); });
    wireDetailSheet(cfg, art, d);
  }
  const back = how === 'child' ? [...(d._stack || []), d._ref].filter(Boolean) : how === 'back' ? (d._stack || []).slice(0, -1) : how === 'refresh' ? d._stack || [] : [];
  const html = dsHTML(cfg, ref, back.length > 0); if (!html) { if (how !== 'refresh') return null; dsClose(art); return null; }
  const sc = how === 'refresh' ? d.scrollTop : 0;
  d._ref = ref; d._stack = back; d.dataset.ref = ref; d.innerHTML = html;
  if (!d.open) d.showModal();
  d.scrollTop = sc;
  if (how === 'push' && dsParam() !== ref) { history.pushState({ epd: ref }, '', dsURL(ref)); }
  else if (how !== 'refresh' && how !== 'push') history.replaceState({ epd: ref }, '', dsURL(ref));
  const mp = d.querySelector('[data-ds-map]'); if (mp) { if (mp.dataset.lat) dsMap(mp); else dsLocate(cfg, mp).catch(() => {}); }
  if (/^(bk|pl):/.test(ref)) gPhotoPull(cfg, art, ref).catch(() => {});
  if (how !== 'refresh') { const f = d.querySelector('.ds-x'); f && f.focus({ preventScroll: true }); }
  return d;
}
function dsClose(art, fromPop) {
  const d = art && art.querySelector(':scope > dialog.ds-sheet'); if (!d || !d.open) return;
  d.close(); d._ref = ''; d._stack = [];
  if (!fromPop) { if (history.state && history.state.epd) history.back(); else if (dsParam()) history.replaceState(null, '', dsURL('')); }
}
function wireDetailSheet(cfg, art, d) {
  d.addEventListener('click', (e) => {
    const b = e.target.closest('button,[data-ds]'); if (!b || !d.contains(b)) return;
    if ('dsClose' in b.dataset) return dsClose(art);
    if (ovSheetClick(cfg, art, d, b) || shSheetClick(cfg, art, b)) return;
    if (b.matches('[data-hs-set],[data-hs-rm]')) { const box = b.closest('.hs-slot'); let pl = null; try { pl = box && JSON.parse(box.dataset.hsP); } catch { /* below */ }
      if (b.dataset.hsRm) { bkRemove(cfg, art, b.dataset.hsRm); setTimeout(() => dsRefresh(art), 0); return; }
      if (!pl) return; b.disabled = true; Promise.resolve(hotelPick(cfg, art, pl)).finally(() => { art._renderSchedule && art._renderSchedule(); dsRefresh(art); }); return; }
    if ('dsBack' in b.dataset) { const s = d._stack || []; if (s.length) openDetail(cfg, art, s[s.length - 1], 'back'); return; }
    if (b.dataset.ds) { openDetail(cfg, art, b.dataset.ds, 'child'); return; }
    if (b.dataset.dsEdit != null) { dsClose(art); setTimeout(() => { if (art.querySelector('[data-panel="mytrip"]')) showTab(art, 'mytrip'); const s2 = art.querySelector('#sec-itinerary'); const eb = s2 && s2.querySelector(`[data-itin-edit="${b.dataset.dsEdit}"]`); if (eb) { s2.scrollIntoView({ block: 'start' }); eb.click(); } }, 30); return; }
    if ('dsAddbk' in b.dataset) { dsClose(art); setTimeout(() => { if (art.querySelector('[data-panel="mytrip"]')) showTab(art, 'mytrip'); const a = art.querySelector('[data-itin-add]'); if (a) { a.scrollIntoView({ block: 'center' }); a.click(); } }, 30); return; }
    if (b.dataset.dsNear != null) { dsClose(art); const r = art.querySelector(`[data-route-stop="${b.dataset.dsNear}"]`); if (r) r.click(); else showTab(art, 'nearby'); return; }
    if (b.dataset.dsGp) { const r = b.dataset.dsGp; dsClose(art); if (art._openGPlace) setTimeout(() => art._openGPlace(r), 30); return; }
    if (b.dataset.dsMv) { const id = d._ref.slice(3); const xs = planLoad(cfg); const i = xs.findIndex(x => x.id === id); if (i < 0) return; const same = xs.map((y, j) => [y, j]).filter(([y]) => y.day === xs[i].day).map(([, j]) => j); const k = same.indexOf(i) + +b.dataset.dsMv; if (k >= 0 && k < same.length) { const j = same[k]; [xs[i], xs[j]] = [xs[j], xs[i]]; planSave(cfg, xs); art._planChanged && art._planChanged(); toast(t('Moved')); } return; }
    if (b.dataset.dsRmbk) { dsClose(art); bkRemove(cfg, art, b.dataset.dsRmbk); return; }
    if (b.dataset.dsDel) { const xs = planLoad(cfg); const i = xs.findIndex(x => x.id === b.dataset.dsDel); if (i < 0) return; const gone = xs.splice(i, 1)[0]; planSave(cfg, xs); dsClose(art); art._planChanged && art._planChanged();
      toastAction(t('Removed {n}', { n: gone.name || '' }), t('Undo'), () => { const ys = planLoad(cfg); ys.splice(Math.min(i, ys.length), 0, gone); planSave(cfg, ys); art._planChanged && art._planChanged(); }); return; }
  });
  d.addEventListener('toggle', (e) => { const m = e.target; if (m.matches && m.matches('details.ds-more')) { if (m.open) OPEN_DET.add(m.dataset.detRef); else OPEN_DET.delete(m.dataset.detRef); } }, true);
  d.addEventListener('change', (e) => {
    const el = e.target.closest('[data-dsp]'); if (!el) return; const id = el.closest('[data-ds-plan]').dataset.dsPlan;
    const xs = planLoad(cfg); const x = xs.find(y => y.id === id); if (!x) return; const k = el.dataset.dsp;
    if (k === 'day') { x.day = el.value; if (!x.day) x.time = ''; } else if (k === 'time') x.time = el.value; else if (k === 'booked') x.booked = el.checked;
    else if (k === 'cat') { x.cat = el.value || 'other'; x.type = PL_CAT_TYPE[el.value] || 'other'; } else if (k === 'conf') x.conf = el.value.trim().slice(0, 60); else if (k === 'note') x.note = el.value.trim().slice(0, 200);
    planSave(cfg, xs); art._planChanged && art._planChanged();
  });
  if (!window._dsPop) { window._dsPop = true; window.addEventListener('popstate', () => { const a = document.querySelector('.ev'); const dd = a && a.querySelector(':scope > dialog.ds-sheet'); if (!dd) return; const want = dsParam(); if (!want) dsClose(a, true); else if (want !== dd._ref && dd._cfg) openDetail(dd._cfg, a, want, 'pop'); }); }
  d._cfg = cfg;
}
// re-paint an open sheet after its item changed (photos, details, plan)
function dsRefresh(art) { const d = art && art.querySelector(':scope > dialog.ds-sheet'); if (d && d.open && d._ref && d._cfg) openDetail(d._cfg, art, d._ref, 'refresh'); }
// Event tab, concise by default: long text (About, a custom section, a Need-to-know note) shows its first lines with
// "Read more"; nothing is removed, a tap opens it. Measured when the tab is visible (and again on resize / tab switch).
const RM_SEL = '[data-panel="event"] .rm-box, [data-panel="event"] li.note > span';
function readMorePaint(art) {
  $$(RM_SEL, art).forEach(el => {
    if (el.classList.contains('rm-open') || !el.offsetParent) return;
    el.classList.add('rm'); const over = el.scrollHeight > el.clientHeight + 6;
    let b = el.nextElementSibling && el.nextElementSibling.matches('.rm-b') ? el.nextElementSibling : null;
    if (!over) { el.classList.remove('rm'); el.classList.add('rm-fit'); if (b) b.remove(); return; }
    el.classList.remove('rm-fit');
    if (!b) { el.insertAdjacentHTML('afterend', `<button type="button" class="rm-b" aria-expanded="false">${esc(t('Read more'))}</button>`); }
  });
}
function wireReadMore(art) {
  art.classList.add('rm-on'); const paint = () => { if (document.body.contains(art)) readMorePaint(art); };
  requestAnimationFrame(paint); setTimeout(paint, 400); (art._showFns = art._showFns || []).push(() => requestAnimationFrame(paint));
  if (!window._rmResize) { window._rmResize = true; window.addEventListener('resize', debounce(() => { const a = document.querySelector('.ev.rm-on'); if (a) readMorePaint(a); }, 200)); }
  new MutationObserver(debounce(paint, 80)).observe(art.querySelector('[data-panel="event"]') || art, { childList: true, subtree: true });
  art.addEventListener('click', (e) => { const b = e.target.closest('.rm-b'); if (!b) return; const el = b.previousElementSibling; if (!el) return;
    const open = !el.classList.contains('rm-open'); el.classList.toggle('rm-open', open); el.classList.toggle('rm', !open); b.textContent = t(open ? 'Show less' : 'Read more'); b.setAttribute('aria-expanded', String(open)); });
}
// taps anywhere on the page: [data-ds] opens its sheet (on the owner's page, a part they can edit opens its editor first)
function wireDetailTaps(cfg, art, opts) {
  art.addEventListener('click', (e) => { const b = e.target.closest('[data-ds]'); if (!b || !b.isConnected || b.closest('dialog.ds-sheet') || e.target.closest('a[href]')) return; /* a sheet re-painted under the tap already handled it */ e.preventDefault(); openDetail(cfg, art, b.dataset.ds); });
  art.addEventListener('toggle', (e) => { const g = e.target; if (g.matches && g.matches('details.sp-g')) { if (g.open) SPOT_SHUT.delete(g.dataset.spotG); else SPOT_SHUT.add(g.dataset.spotG); } }, true);
  art.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const b = e.target.closest && e.target.closest('[data-ds]'); if (!b || b.tagName === 'BUTTON' || b.closest('dialog.ds-sheet')) return; e.preventDefault(); openDetail(cfg, art, b.dataset.ds); });
  const want = !opts.preview && !opts.noDs && dsParam(); if (want) setTimeout(() => { if (document.body.contains(art) && !openDetail(cfg, art, want, 'pop')) history.replaceState(null, '', dsURL('')); }, 0);
}

// ================= the guest's hotel per city + saved spots (★) =================
// Each route stop owns its own map, its own hotel and its own saved spots. A stop is { id, name, lat/lon, from/to }; a
// CITY is one or more stops at the same place (Tokyo at the start and the end) — { ...its first stop, legs: [its stops] }.
// Everything tied to a city is tied by a stop id and checked against geography, never by the city's position in the
// route, its name, its `city` text (stale after a rename; "Kobe" for Arima Onsen) or a hotel-name cache:
//   map center   = the city's own point, or its hotel when that hotel is IN the city (cityReach)
//   hotel        = the guest's booking / a map pick (stopId) / the host's check-in on the itinerary, homed by homeCity:
//                  its stop (id or dates) when it is in that city, else the city it is in for those dates, else none —
//                  an Arima ryokan dated during Kyoto is not "your hotel in Kyoto" and never moves Kyoto's map
//   saved spot   = homed to the stop it was saved under (stopId) while it is in that city, else the nearest city
// Old pages and old device data (no ids, a city index, a name-keyed hotel cache) are homed the same way at load.
const SAME_PLACE = 3000, IN_CITY = 25000, NEAR_CITY = 80000;
const cityLabel = (c) => (c && (c.name || c.city)) || '';
const samePlace = (a, b) => distM(a.lat, a.lon, b.lat, b.lon) < SAME_PLACE || (foldTxt(a.name).trim() === foldTxt(b.name).trim() && distM(a.lat, a.lon, b.lat, b.lon) < 30000);
const hotelStops = (cfg) => {
  const ss = stopsOf(cfg).filter(s => s.lat != null); if (!ss.length) return cfg.venue ? [{ ...cfg.venue, legs: [] }] : [];
  const out = []; ss.forEach(s => { const o = out.find(x => x.legs.some(l => samePlace(l, s))); if (o) o.legs.push(s); else out.push({ ...s, legs: [s] }); });
  return out;
};
const cityOfStop = (cfg, i) => { const s = stopsOf(cfg)[i]; return s ? Math.max(0, hotelStops(cfg).findIndex(c => c.legs.includes(s))) : 0; };
const cityOfId = (cfg, id) => id ? hotelStops(cfg).findIndex(c => c.legs.some(l => l.id === id)) : -1;
const cityId = (cfg, i) => { const c = hotelStops(cfg)[i]; return c && c.legs[0] ? c.legs[0].id || '' : ''; };
const cityDist = (c, p) => Math.min(...(c.legs.length ? c.legs : [c]).map(l => distM(l.lat, l.lon, p.lat, p.lon)));
// how far from a city's point something still counts as IN it: 25 km, more when the next city is far (a region-sized stop)
const cityReach = (cs, i) => { let near = Infinity; cs.forEach((o, j) => { if (j !== i) near = Math.min(near, cityDist(o, cs[i])); }); return Math.max(IN_CITY, Math.min(NEAR_CITY, near * 0.45)); };
const nearestStop = (cfg, p) => { let b = 0, bd = Infinity; hotelStops(cfg).forEach((c, i) => { const d = cityDist(c, p); if (d < bd) { bd = d; b = i; } }); return b; };
const stopOfDay = (cfg, d) => { const ss = stopsOf(cfg).filter(s => s.lat != null); if (ss.length < 2 || !d) return 0; const i = legOf(ss, d); return i < 0 ? 0 : Math.max(0, hotelStops(cfg).findIndex(c => c.legs.includes(ss[i]))); };
const legOfDay = (cfg, d) => { const ss = stopsOf(cfg).filter(s => s.lat != null); const i = d ? legOf(ss, d) : -1; return i < 0 ? null : ss[i]; };
// the one place a hotel or a saved spot gets its city. p = its point (or null), o = { stopId, day, span, hotel }.
// Returns the city index, or -1 for a hotel that is in none of the route's cities (or can't be placed yet).
function homeCity(cfg, p, o = {}) {
  const cs = hotelStops(cfg); if (cs.length < 2) return 0;
  const byId = cityOfId(cfg, o.stopId); const dayC = () => { const leg = o.day ? legOfDay(cfg, o.day) : null; return leg ? cs.findIndex(c => c.legs.includes(leg)) : -1; };
  if (!p || p.lat == null) { if (byId >= 0) return byId; return dayC(); }
  const inC = (i) => i >= 0 && cityDist(cs[i], p) <= cityReach(cs, i);
  if (inC(byId)) return byId;
  const dc = dayC(); if (inC(dc)) return dc;
  const k = nearestStop(cfg, p); if (!o.hotel) return k;
  const legSp = (l) => [l.from, l.to && l.to > l.from ? l.to : l.from];
  return inC(k) && (!o.span || !cs[k].legs.some(l => l.from) || cs[k].legs.some(l => l.from && spanHit(o.span, legSp(l)))) ? k : -1;
}
const spotCity = (cfg, x) => homeCity(cfg, x && x.lat != null ? x : null, { stopId: x.stopId, day: x.day });
const HOTEL_RE = /\b(check[- ]?in|hotel|hostel|ryokan|resort|airbnb|guest ?house|inn|lodge)\b/i;
const hgeoKey = (q) => 'hgeo:' + q.trim().toLowerCase().slice(0, 120);
// every hotel the host put on the itinerary (check-ins), with the nights of the leg it is on; homed in hotelsNow
// the hotel's name in a free-form stay line: "Tokyo: Hotel X, 6 nights" → "Hotel X"; '' for an undecided one
// ("Arima onsen: ryokan, 2 nights (not chosen yet)" names no hotel)
const freeHotelName = (title) => { const t0 = String(title || ''); if (/\b(not (chosen|booked|decided)|tbd|tba|to be (decided|confirmed))\b/i.test(t0)) return '';
  const n = t0.replace(/^\s*[^:]{1,40}:\s*/, '').replace(/\([^)]*\)/g, '').replace(/[,·–—-]\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+nights?\b.*$/i, '').replace(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+nights?\b/i, '').replace(/[\s,·–—-]+$/, '').trim();
  return /^(the\s+)?(hotel|hostel|ryokan|resort|airbnb|guest ?house|inn|lodge)s?$/i.test(n) ? '' : n; };
function hotelCands(cfg) {
  const sch = cfg.off.schedule ? [] : cfg.schedule || []; const out = [];
  sch.filter(x => x.title && HOTEL_RE.test(x.title) && !/check[- ]?out/i.test(x.title)).forEach(x => {
    const free = hotelFreeLine(x);
    // a free-form stay line where the stop also has a check-in for those nights is the older note of the same stay
    if (free && sch.some(y => y !== x && hotelCiLine(y) && stopOfDay(cfg, y.date) === stopOfDay(cfg, x.date) && spanHit(hostStay(cfg, sch, x), hostStay(cfg, sch, y)))) return;
    const name = free ? freeHotelName(x.title) : x.title.replace(/^\s*check[- ]?in\s*[:\-–—]?\s*(at\s+)?/i, '').trim(); const leg = legOfDay(cfg, x.date); const ci = stopOfDay(cfg, x.date);
    if (name && !out.some(y => y._ci === ci && y.name.toLowerCase() === name.toLowerCase())) out.push({ src: 'host', name, q: name, addr: '', from: x.date || '', to: free && stayNights(x.title) && x.date ? addDays(x.date, stayNights(x.title)) : leg && leg.to || '', _ci: ci }); });
  return out;
}
// per city: a list of { name, addr, lat, lon, src: 'set'|'booking'|'host', ref, id, from, to } by date (lat null while being found).
// The guest's hotels are their hotel bookings — ONE item each, whether it came from Add a booking, Add to my trip or a
// pick on this map ('set' = picked here, no booking details yet, so it can be removed here). Each hotel is homed by
// homeCity (stop id / dates, checked against where it is); one in none of the cities is in .away (not any city's hotel).
// Invite link (cfg._sug: any guest who is not the organizer on their own page): the organizer's hotels are SUGGESTIONS — not
// the guest's hotel anywhere (map, My trip, Between stops, Nearby distances) until they choose one, which makes it an ordinary
// hotel booking (Dylan 11/25). hotelsNow(cfg) is then the guest's own hotels only; { sug: true } adds the organizer's ones
// for nights the guest has no hotel yet as src 'sug' (the Suggested rows and pins). The organizer's own page: 'host', theirs.
const orgSrc = (h) => h.src === 'host' || h.src === 'sug';
function hotelsNow(cfg, o = {}) {
  const ss = hotelStops(cfg); const geo = (q) => q ? LS.get(hgeoKey(q)) : null; const span = (h) => h.from ? [h.from, h.to && h.to > h.from ? h.to : h.from] : null;
  const mine = itinLoad(cfg).filter(x => LODGE.has(x.kind) && (x.name || x.address)).map(x => {
    const q = [x.name, x.address].filter(Boolean).join(', '); const g = x.lat != null ? { lat: x.lat, lon: x.lon, ref: x.ref || '' } : geo(q);
    const h = { src: x.pin && x.guess && !x.confNo ? 'set' : 'booking', id: x.id, name: x.name || t('Your hotel'), q, addr: x.address || '', from: bkDay(x.start), to: bkDay(x.end), ref: x.ref || '', stopId: x.stopId || '' };
    return g && g.miss ? null : g ? { ...h, lat: g.lat, lon: g.lon, addr: h.addr || g.addr || '', ref: h.ref || g.ref || '' } : { ...h, lat: null };
  }).filter(Boolean);
  const host = (cfg._sug && !o.sug ? [] : hotelCands(cfg)).filter(c => !mine.some(x => nameLike(x.name, c.name))).map(c => { if (cfg._sug) c = { ...c, src: 'sug' }; const g = geo(c.q); return g && g.miss ? null : g ? { ...c, lat: g.lat, lon: g.lon, addr: c.addr || g.addr || '', ref: g.ref || '' } : { ...c, lat: null }; }).filter(Boolean);
  const out = ss.map(() => []); out.away = [];
  mine.concat(host).forEach(h => { const i = ss.length < 2 ? 0 : homeCity(cfg, h.lat != null ? h : null, { stopId: h.stopId, day: h.from, span: span(h), hotel: true }); (i >= 0 && out[i] ? out[i] : out.away).push(h); });
  // the organizer's hotel for nights the guest picked their own hotel is not theirs any more (it can't be removed by them,
  // so it would sit there as an "old selection" next to the new one)
  out.forEach((hs, i) => { const own = hs.filter(h => !orgSrc(h)); if (own.length) out[i] = hs.filter(h => !orgSrc(h) || !own.some(o => { const a = span(o), b = span(h); return !a || !b || spanHit(a, b); })); });
  out.forEach(hs => hs.sort((a, b) => (a.from || '9999').localeCompare(b.from || '9999')));
  return out;
}
const hotelDates = (h) => h.from ? dateRange(h.from, h.to && h.to > h.from ? h.to : h.from).replace(/, \d{4}$/, '') : '';
async function resolveHotels(cfg) {
  const ss = hotelStops(cfg); let n = 0;
  for (const [i, hs] of hotelsNow(cfg, { sug: true }).entries()) for (const h of hs) {
    if (h.lat != null || !h.q) continue; const s = ss[i];
    const r = await geocode(`${h.q}, ${cityLabel(s)}`).then(xs => xs.find(x => x.lat != null && !(x.types || []).some(ty => ty === 'country' || ty === 'continent') && distM(x.lat, x.lon, s.lat, s.lon) < NEAR_CITY)).catch(() => undefined);
    if (r === undefined) continue; // offline or refused: try again next time
    LS.set(hgeoKey(h.q), r ? { lat: r.lat, lon: r.lon, addr: r.address || '', ref: r.gid || '' } : { miss: 1 }); n++;
  }
  return n;
}
// the guest picks a hotel for a city on the map: it upserts their hotel booking for those dates (a booking already there
// for that hotel / those dates gets the place linked to it instead of a second item); remove takes a map-only pick out
function setHotel(cfg, art, i, p) {
  if (!p) return Promise.resolve();
  const d = p.from ? [p.from, p.to || ''] : hotelGuessDates(cfg, i, itinLoad(cfg));
  const add = { id: newBkId(), kind: 'hotel', name: p.name || '', address: p.address || '', ref: p.gid || '', lat: p.lat, lon: p.lon, stopId: cityId(cfg, i), pin: 1, guess: 1, start: d[0], end: d[1] };
  return bkSave(cfg, art, [add], null);
}
// ---- one tap on a hotel the app already knows (a Google / map place, a Where to stay row, a place sheet) ----
// The guest's hotels live in ONE place: their hotel bookings (My trip). A map pick, a Make it mine hotel, a PDF, a
// typed booking are all items there; nothing else (no per-stop pick key, no saved-spot flag) says "my hotel".
// the guest's hotel booking that IS this place: same Google place, same spot, or the same name close by — else null
function myHotelOf(cfg, p) {
  if (!p) return null;
  return itinLoad(cfg).find(x => { if (!LODGE.has(x.kind) || x.ph) return false; if (p.ref && x.ref && x.ref === p.ref) return true;
    const q = bkGeo(x); if (q.lat == null || p.lat == null) return !!(x.name && p.name) && q.lat == null && nameLike(x.name, p.name) && nameToks(x.name).join(' ') === nameToks(p.name).join(' ');
    const dm = distM(q.lat, q.lon, p.lat, p.lon); return dm < 80 || (dm < 1500 && nameLike(x.name, p.name)); }) || null;
}
// which city a picked place is the hotel for: the city the guest is looking at when it is in it, else the one it is in
function hotelPick(cfg, art, place) {
  const at = art && art._stop != null ? cityId(cfg, art._stop) : '';
  let i = place.ci != null && place.ci >= 0 && hotelStops(cfg)[place.ci] ? +place.ci : homeCity(cfg, place.lat != null ? place : null, { stopId: at }); if (i < 0) i = place.lat != null ? nearestStop(cfg, place) : 0; // a suggestion knows its city
  return setHotel(cfg, art, i, { name: place.name, address: place.addr || place.address || '', gid: place.src === 'g' || GPID_RE.test(place.ref || '') ? place.ref || '' : '', lat: place.lat, lon: place.lon, from: place.from || '', to: place.to || '' });
}
// the hotel action wherever a known hotel is shown: "Set as my hotel" — or, when it already is, "Your hotel" + Remove.
// mini = a list row's small buttons; else a place sheet's primary action. Re-rendered in place after every change.
function hsSlotHTML(cfg, place, mini) {
  const m = myHotelOf(cfg, place); const dt = m ? hotelDates({ from: bkDay(m.start), to: bkDay(m.end) }) : '';
  const inner = m ? (mini ? `<span class="hs-tag"><img src="${HOTEL_PIN}" alt="">${esc(t('Your hotel'))}</span><button type="button" class="mini-b bk-rm hs-rm" data-hs-rm="${esc(m.id)}">${TRASH_IC}${t('Remove')}</button>`
    : `<p class="plan-have hs-have"><img src="${HOTEL_PIN}" alt=""><b>${esc(t('Your hotel'))}</b>${dt ? `<span class="muted">${esc(dt)}</span>` : ''}</p><div class="btns"><button type="button" class="btn bk-rm hs-rm" data-hs-rm="${esc(m.id)}">${TRASH_IC}${t('Remove')}</button></div>`)
    : mini ? `<button type="button" class="mini-b hs-set" data-hs-set>${t(place.sug ? 'Choose' : 'Set as my hotel')}</button>` : `<div class="btns"><button type="button" class="btn primary hs-set" data-hs-set>${HOTEL_IC}${t(place.sug ? 'Choose this hotel' : 'Set as my hotel')}</button></div>`;
  const pl = { src: place.src || '', ref: place.ref || '', name: place.name || '', addr: place.addr || place.address || '', lat: place.lat, lon: place.lon, ...(place.sug ? { sug: 1, from: place.from || '', to: place.to || '', ci: place.ci ?? -1 } : {}) };
  return `<${mini ? 'span' : 'div'} class="hs-slot${mini ? ' mini' : ' plan-add'}" data-hs-p="${esc(JSON.stringify(pl))}">${inner}</${mini ? 'span' : 'div'}>`;
}
function hsRefresh(cfg, root) {
  [root, $('#placedlg')].filter(Boolean).forEach(r => $$('.hs-slot[data-hs-p]', r).forEach(el => { try { el.outerHTML = hsSlotHTML(cfg, JSON.parse(el.dataset.hsP), el.classList.contains('mini')); } catch { /* left as is */ } }));
}
// Set as my hotel / Remove (a place sheet, a list row, a map pin's popup); true when the click was one of them
function hsClick(cfg, art, e) {
  const b = e.target.closest('[data-hs-set],[data-hs-rm]'); if (!b) return false; e.preventDefault();
  if (b.dataset.hsRm) { bkRemove(cfg, art, b.dataset.hsRm); hsRefresh(cfg, art); return true; }
  const box = b.closest('.hs-slot'); if (!box) return true; let pl; try { pl = JSON.parse(box.dataset.hsP); } catch { return true; }
  b.disabled = true; Promise.resolve(hotelPick(cfg, art, pl)).finally(() => hsRefresh(cfg, art)); return true;
}
const isSaved = (cfg, ref) => !!ref && planLoad(cfg).some(x => x.ref === ref && !x.hotel);
function toggleSaved(cfg, art, place) {
  const xs = planLoad(cfg); const i = xs.findIndex(x => x.ref === place.ref && !x.hotel);
  if (i >= 0) { xs.splice(i, 1); toast(t('Removed from saved spots')); } else { const sid = hotelStops(cfg).length > 1 && art && art._stop != null ? cityId(cfg, art._stop) : ''; xs.push({ id: 'pl' + Date.now().toString(36), booked: false, conf: '', day: '', time: '', note: '', rating: 0, count: 0, hours: '', ...place, ...(sid ? { stopId: sid } : {}) }); toast(t('Saved')); }
  planSave(cfg, xs); art._planChanged && art._planChanged();
}
const starBtnHTML = (cfg, ref, name) => { const on = isSaved(cfg, ref); return `<button type="button" class="star-b${on ? ' on' : ''}" data-gp-save="${esc(ref)}" aria-pressed="${on}" aria-label="${esc(t(on ? 'Saved: {n}' : 'Save {n}', { n: name }))}">${on ? '★' : '☆'}</button>`; };
const gmapsLink = (x) => `https://www.google.com/maps/search/?api=1&query=${enc(x.addr || x.address ? `${x.name}, ${x.addr || x.address}` : x.lat != null ? `${x.lat},${x.lon}` : x.name)}${x.src === 'g' && x.ref ? '&query_place_id=' + enc(x.ref) : ''}`;
// My trip → Saved spots: per city, the hotel first, then the starred places
function spotsByCity(cfg) {
  const ss = hotelStops(cfg); const hs = hotelsNow(cfg); const sp = planLoad(cfg).filter(x => x.lat != null && !x.hotel);
  return ss.map((s, i) => ({ i, city: cityLabel(s), hotels: hs[i].filter(h => h.lat != null), spots: sp.filter(x => spotCity(cfg, x) === i) })).filter(g => g.hotels.length || g.spots.length);
}
// My trip → Saved spots: one group per category (Hotels, Restaurants, Cafés, Bars, Sights, Things to do, Shopping, …),
// each with its count, folding open/closed; compact rows (photo or category icon, name, area, rating) open the place's sheet
const SPOT_ORDER = ['hotels', 'restaurants', 'cafes', 'bars', 'sights', 'tours', 'shopping', 'transport', ''];
const SPOT_SHUT = new Set(); // groups the guest folded (this session)
const thumbHTML = (x, cat) => { const p = (x.photos || []).find(photoSrc); return p ? `<span class="sp-th" style="--cc:${ccColor(cat)}"><img src="${esc(photoSrc(p))}" alt="" loading="lazy" onerror="this.remove()"></span>` : `<span class="sp-ic">${ccIcon(cat)}</span>`; };
function spotsHTML(cfg) {
  const gs0 = spotsByCity(cfg); const many = hotelStops(cfg).length > 1;
  // only what the guest saved (☆): the stay hotels (their bookings, the organizer's check-ins) are already in Your
  // itinerary / Your bookings, so they are not listed again here — nor is a ☆ hotel that is one of them (Dylan 11/24:
  // a second "Hotels 6" group under "Hotels 3"). Save all to Google Maps (KML) still carries every city's hotel.
  const stays = itinLoad(cfg).filter(x => LODGE.has(x.kind)).map(x => ({ name: x.name || '', ref: x.ref || '' })).concat(cfg._sug ? [] : hotelCands(cfg).map(c => ({ name: c.name || '', ref: '' }))); // a guest's: suggestions are not their stays
  const isStay = (x) => stays.some(h => (h.ref && x.ref && h.ref === x.ref) || (h.name && nameLike(h.name, x.name)));
  // the City × Category bar narrows the list: a city's spots only, each under its own category
  // Saved spots never lists the stays, so Hotels (My trip's default chip) can't narrow it: the other chosen categories do
  const F = ccTrip(cfg); const cityI = (g) => g.i; const spCats = F.cats.filter(k => k !== 'hotels');
  const rows = []; let any = false;
  gs0.forEach(g => { const ci = many ? cityI(g) : 0;
    g.spots.forEach(x => { const cat = ccCatOfPlan(x); if (cat === 'hotels' && isStay(x)) return; any = true;
      const it = { city: ci, cat, text: [x.name, x.addr, x.note].join(' '), saved: true, booked: !!x.booked }; if (F.rest(it) && (!spCats.length || spCats.includes(tripCat(cat)))) rows.push({ x, cat, city: g.city }); }); });
  if (!any) return `<p class="muted">${t('Tap ☆ on a place in Nearby to save it here.')}</p>`;
  if (!rows.length) return ccNoneHTML();
  const showCity = many && F.ci < 0;
  const row = (r) => { const x = r.x; const ref = 'pl:' + x.id;
    const meta = [showCity ? r.city : '', x.day ? fmt(x.day, { weekday: 'short', month: 'short', day: 'numeric' }) : '', x.addr && !showCity ? x.addr.split(',')[0] : ''];
    return `<li class="sp-row"><button type="button" class="sp-go" data-ds="${esc(ref)}">${thumbHTML(x, r.cat)}<span class="sp-tx"><b>${esc(x.name)}</b><small>${esc(meta.filter(Boolean).join(' · '))}</small>${x.rating ? `<span class="rt">${gRatingHTML(x)}</span>` : ''}</span></button><a class="sp-map" href="${esc(gmapsLink(x))}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t('Open {n} in Google Maps', { n: x.name }))}" title="${esc(t('Open in Google Maps'))}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg><span>${t('Maps')}</span></a></li>`; };
  const groups = SPOT_ORDER.map(k => [k, rows.filter(r => (SPOT_ORDER.includes(r.cat) ? r.cat : '') === k)]).filter(([, g]) => g.length);
  return `<div class="sp-groups">${groups.map(([k, g]) => `<details class="sp-g" data-spot-g="${k || 'other'}"${SPOT_SHUT.has(k || 'other') && groups.length > 1 ? '' : ' open'}><summary>${ccIcon(k || 'pin')}<span class="sp-h">${esc(k ? ccLabel(k) : t('Other'))}</span><span class="sp-n">${g.length}</span><i class="sp-tog" aria-hidden="true"></i></summary><ul class="plist spots">${g.map(row).join('')}</ul></details>`).join('')}</div>
    <div class="btns sp-kml"><button type="button" class="btn sm" data-kml>${t('Save all to Google Maps')}</button></div><p class="muted small">${t('Import into Google My Maps — shows in the Google Maps app under Saved → Maps')}</p>`;
}
const xmlEsc = (s) => String(s || '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
function spotsKML(cfg) {
  const pm = (name, desc, x) => `<Placemark><name>${xmlEsc(name)}</name>${desc ? `<description>${xmlEsc(desc)}</description>` : ''}<Point><coordinates>${x.lon},${x.lat},0</coordinates></Point></Placemark>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEsc(cfg.title || 'Trip')}</name>${spotsByCity(cfg).map(g => `<Folder><name>${xmlEsc(g.city)}</name>${g.hotels.map(h => pm(`${t('Your hotel')}: ${h.name}`, [hotelDates(h), h.addr].filter(Boolean).join(' · '), h)).join('')}${g.spots.map(x => pm(x.name, x.addr, x)).join('')}</Folder>`).join('')}</Document></kml>`;
}
function hotelBarHTML(cfg, art) {
  const ss = hotelStops(cfg); const i = art._stop || 0; const hs = hotelsNow(cfg)[i] || []; const city = ss.length > 1 ? cityLabel(ss[i]) : '';
  const lbl = city ? t('Your hotel in {c}', { c: city }) : t('Your hotel'); const pick = Math.min(Math.max(0, art._pick[i] ?? 0), Math.max(0, hs.length - 1));
  const sub = (x) => x.lat == null ? t('Finding it on the map…') : [hotelDates(x), x.src === 'booking' ? t('From your bookings') : x.src === 'host' ? t('From the itinerary') : (x.addr || '').split(',')[0]].filter(Boolean).join(' · ');
  const form = `<form class="hb-set" onsubmit="return false"><label for="hb-q">${esc(t('Other hotel…'))}${city ? ` <small class="muted">${esc(city)}</small>` : ''}</label><div class="search"><input id="hb-q" data-hotel-q placeholder="${t('Search your hotel')}" autocomplete="off"><button type="submit" class="btn sm" data-hotel-find>${t('Find')}</button></div><button type="button" class="link" data-hotel-cancel>${t('Cancel')}</button><p class="hint" data-hotel-msg role="status" aria-live="polite"></p></form>`;
  if (art._hotelEdit) return form;
  const row = (x, k) => `<li class="hb-r${hs.length > 1 && k === pick ? ' on' : ''}"><button type="button" class="hb-go" data-hotel-pick="${k}" aria-pressed="${k === pick}"><img class="hb-ic" src="${HOTEL_PIN}" alt=""><span class="hb-t"><b>${esc(x.name)}</b><small class="muted">${esc(sub(x))}</small></span></button>${x.src !== 'host' && x.id ? `<button type="button" class="btn sm bk-rm hb-rm" data-hotel-del="${esc(x.id)}" aria-label="${esc(t('Remove {n}', { n: x.name }))}">${TRASH_IC}${t('Remove')}</button>` : ''}</li>`;
  const browse = art._gp ? `<button type="button" class="btn sm hb-browse" data-hotel-browse>${ccIcon('hotels')}${t('Hotels')}</button>` : '';
  // the organizer's hotels for nights the guest has no hotel yet: suggestions, one tap to choose (invite link)
  const sugs = cfg._sug ? (hotelsNow(cfg, { sug: true })[i] || []).filter(h => h.src === 'sug') : [];
  const srow = (x) => `<li class="hb-r hb-sr"><button type="button" class="hb-go" data-hotel-see="${esc(x.name)}"><img class="hb-ic" src="${HOTEL_PIN}" alt=""><span class="hb-t"><b>${esc(x.name)}</b><small class="muted">${esc([hotelDates(x), t('Suggested by the organizer')].filter(Boolean).join(' · '))}</small></span></button>${hsSlotHTML(cfg, { ...x, sug: 1, ci: i }, true)}</li>`;
  const sugHTML = sugs.length ? `<p class="lbl hb-sl">${esc(t('Suggested'))}</p><ul class="hb-list hb-sugs">${sugs.map(srow).join('')}</ul>` : '';
  return `<div class="hb hb-box"><p class="lbl">${esc(lbl)}</p>${hs.length ? `<ul class="hb-list">${hs.map(row).join('')}</ul>` : `<p class="hb-none muted">${esc(t('No hotel yet'))}</p>`}${sugHTML}<div class="hb-acts">${browse}<button type="button" class="btn sm ghost" data-hotel-add>${t('Other hotel…')}</button></div></div>`;
}
function wireHotel(cfg, art, mapCtl) {
  const fold = () => art._cx && art._cx();
  const bar = art.querySelector('[data-slot="hotel"]'); const key = art.querySelector('[data-slot="map-key"]'); const ss = hotelStops(cfg);
  if (art._stop == null) art._stop = Math.max(0, ccCityIdx(cfg, ccGet(cfg, 'nearby').city)); art._pick = art._pick || {};
  // the chosen hotel in a city (All = none: searches start at the city itself)
  art._hotelAt = (i) => { const hs = hotelsNow(cfg)[i] || []; const pick = art._pick[i] ?? 0; if (pick < 0) return null; const h = hs[pick] || hs[0]; return h && h.lat != null ? h : null; };
  // the current city's hotel is where Nearby searches start and distances are measured from; true when that changed
  const center = () => { const h = art._hotelAt(art._stop), prev = art._hotelPt || null;
    if (h ? prev && prev.lat === h.lat && prev.lon === h.lon : !prev) return false;
    art._hotelPt = h; art._fromHotel = !!h; art._center = h ? { lat: h.lat, lon: h.lon } : ss[art._stop]; return true; };
  const ui = (force) => {
    const all = hotelsNow(cfg); const sp = art.querySelector('#sec-spots .sec-b'); if (sp) sp.innerHTML = spotsHTML(cfg); locate(all);
    const sugAll = cfg._sug ? hotelsNow(cfg, { sug: true }).map(hs => hs.filter(h => h.src === 'sug' && h.lat != null)) : [];
    if (mapCtl) mapCtl.setHotels([].concat(...all.map((hs, i) => hs.filter(h => h.lat != null).map((h, k) => ({ lat: h.lat, lon: h.lon, title: `${t('Your hotel')}: ${h.name}`, name: h.name, dates: hotelDates(h), rm: h.src !== 'host' && h.id ? h.id : '', label: [pinText(h.name), hotelDates(h)].filter(Boolean).join(' · '), onClick: () => { art._stop = i; art._pick[i] = all[i].indexOf(h); ui(); } }))),
      ...sugAll.map((hs, i) => hs.map(h => ({ lat: h.lat, lon: h.lon, sug: 1, title: `${t('Suggested')}: ${h.name}`, name: h.name, dates: hotelDates(h), rm: '', choose: hsSlotHTML(cfg, { ...h, sug: 1, ci: i }, true), label: [pinText(h.name), t('Suggested')].join(' · '), onClick: () => { art._stop = i; } })))));
    if (bar) { bar.innerHTML = hotelBarHTML(cfg, art); const q = bar.querySelector('[data-hotel-q]'); if (q) placeAutocomplete(q, { bias: () => ss[art._stop], onPick: (id, tok) => gpVenue(id, tok).then(v => { art._hotelEdit = false; setHotel(cfg, art, art._stop, v); }).catch(() => toast(t('Couldn’t load that place right now.'))) }); }
    const cur = art._hotelAt(art._stop); const saved = planLoad(cfg).some(x => x.lat != null && !x.hotel);
    const sugN = sugAll.some(hs => hs.length);
    if (key) key.innerHTML = cur || saved || sugN ? `${cur ? `<span class="mk"><img src="${HOTEL_PIN}" alt="">${t('Your hotel')}</span>` : ''}${sugN ? `<span class="mk mk-sug"><img src="${HOTEL_PIN}" alt="">${t('Suggested')}</span>` : ''}${saved ? `<span class="mk"><img src="${STAR_PIN}" alt="">${t('Saved')}</span>` : ''}${cur ? `<button type="button" class="mk-go" data-hotel-go>${t('Hotel')}</button>` : ''}` : '';
    const moved = center();
    if (moved || force) { if (moved && art._gpReload) art._gpReload(); const h = art._hotelPt; const cityHs = (all[art._stop] || []).filter(x => x.lat != null);
      if (mapCtl) { if (h) mapCtl.center(h.lat, h.lon, 15); else if (cityHs.length > 1 && mapCtl.fit) mapCtl.fit(cityHs.map(x => [x.lat, x.lon])); else if (ss[art._stop]) mapCtl.center(ss[art._stop].lat, ss[art._stop].lon, 13); } }
    const tsl = art.querySelector('[data-slot="trains"]'); if (tsl && stopsOf(cfg).length > 1) tsl.innerHTML = trainsHTML(cfg); // Between stops runs hotel to hotel
    fold();
  };
  // a hotel added after the map opened (a PDF booking, a replacement) is found on the map then too, not on the next visit
  let unk = null, busy = false;
  function locate(all) { const k = all.flat().filter(h => h.lat == null && h.q).map(h => h.q).join('|'); if (!k || k === unk || busy) return; unk = k; busy = true;
    resolveHotels(cfg).then(n => { busy = false; if (n && document.body.contains(art)) ui(); }).catch(() => { busy = false; }); }
  art._hotelUI = ui; ui();
  const find = (q) => { const m = bar.querySelector('[data-hotel-msg]'); if (q.length < 2) return; if (m) m.textContent = t('Searching…');
    const s = ss[art._stop]; geocode(`${q}, ${s.city || s.name}`).then(xs => { const r = xs.find(x => x.lat != null && !(x.types || []).some(ty => ty === 'country' || ty === 'continent') && distM(x.lat, x.lon, s.lat, s.lon) < 80000); if (!r) { if (m) m.textContent = t('No match. Try the hotel name and street.'); return; } art._hotelEdit = false; setHotel(cfg, art, art._stop, { ...r, name: r.name || q }); })
      .catch(() => { if (m) m.textContent = navigator.onLine === false ? t('Offline') : t('Search is unavailable right now'); }); };
  if (bar) bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.hotelPick != null) { art._pick[art._stop] = +d.hotelPick; ui(true); return; }
    if (d.hotelSee != null) { const h = ((hotelsNow(cfg, { sug: true })[art._stop]) || []).find(x => x.name === d.hotelSee); if (h && h.lat != null && mapCtl) mapCtl.centerOn(h.lat, h.lon, 16); return; }
    if ('hotelAdd' in d) { art._hotelEdit = true; ui(); const q = bar.querySelector('[data-hotel-q]'); if (q) q.focus(); }
    if ('hotelBrowse' in d) { if (art._gpCat) art._gpCat('hotels'); const m = art.querySelector('[data-slot="map"]'); if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center' }); }
    if ('hotelCancel' in d) { art._hotelEdit = false; ui(); }
    if (d.hotelDel) bkRemove(cfg, art, d.hotelDel);
    if ('hotelFind' in d) find((bar.querySelector('[data-hotel-q]') || {}).value.trim()); });
  if (key) key.addEventListener('click', (e) => { if (!e.target.closest('[data-hotel-go]')) return; const h = art._hotelAt(art._stop); if (h && mapCtl) mapCtl.centerOn(h.lat, h.lon, 16); });
  art.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kml]'); if (!k) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([spotsKML(cfg)], { type: 'application/vnd.google-earth.kml+xml' }));
    a.download = (slug(cfg.title) || 'trip') + '-saved-spots.kml'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
}

// ================= one as-you-type place dropdown for every place field (Google Places Autocomplete, New) =================
// Bias only, never restrict: 'Grand Hyatt Cancun' is found from a Japan trip too. A session token ties the keystrokes
// and the final Place Details call into one billed session.
const AC_ICONS = {
  stay: '<path d="M3 18V8M3 14h18v4M21 18v-5a3 3 0 0 0-3-3h-7v4"/><circle cx="7" cy="11" r="1.6"/>',
  food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 1-3 3-3 6v3h3v9"/>',
  fly: '<path d="M2 16l20-6-2-2-7 2-5-6-2 1 3 6-5 2-2-2-1 1z"/>',
  rail: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 11h12M9 20l-2 2M15 20l2 2M9 16l-1 4M15 16l1 4"/>',
  sight: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
  city: '<path d="M3 21V9l6-4v16M9 21V3h8v18M17 21v-8h4v8M12 7h2M12 11h2M12 15h2"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
};
function acIcon(types) {
  const s = (types || []).join(' ');
  const k = /lodging|hotel/.test(s) ? 'stay' : /restaurant|food|cafe|bar|bakery|meal/.test(s) ? 'food' : /airport/.test(s) ? 'fly' : /train|transit|subway|station/.test(s) ? 'rail'
    : /tourist|museum|park|attraction|gallery|landmark/.test(s) ? 'sight' : /locality|political|administrative|country|sublocality/.test(s) ? 'city' : 'pin';
  return `<svg class="ac-ic" viewBox="0 0 24 24" aria-hidden="true">${AC_ICONS[k]}</svg>`;
}
const newSession = () => (crypto.randomUUID ? crypto.randomUUID() : 'ep-' + Date.now() + Math.random().toString(36).slice(2));
// input: the text field. opts: { bias: () => ({lat, lon}) | null, onPick(placeId, session), onText?(query) }. Returns false without Google.
function placeAutocomplete(input, opts) {
  if (!input || !GKEY || gpBroken || input._ac) return false; input._ac = true;
  let wrap = input.parentElement; if (!wrap.classList.contains('ac-wrap')) { wrap = document.createElement('div'); wrap.className = 'ac-wrap'; input.replaceWith(wrap); wrap.appendChild(input); }
  const ul = document.createElement('ul'); ul.className = 'gp-sugg'; ul.setAttribute('role', 'listbox'); ul.hidden = true; ul.id = 'ac-' + Math.random().toString(36).slice(2, 8); wrap.appendChild(ul);
  input.setAttribute('autocomplete', 'off'); input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', ul.id);
  let session = '', seq = 0, first = null;
  const close = () => { ul.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const run = debounce(() => {
    const q = input.value.trim(); const my = ++seq; if (q.length < 2 || document.activeElement !== input) { close(); return; }
    if (!session) session = newSession();
    const b = opts.bias && opts.bias(); const body = { input: q, sessionToken: session };
    if (b && b.lat != null) body.locationBias = { circle: { center: { latitude: b.lat, longitude: b.lon }, radius: 50000 } };
    gFetch('https://places.googleapis.com/v1/places:autocomplete', body, 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types')
      .then(j => {
        if (my !== seq || document.activeElement !== input) return;
        const xs = (j.suggestions || []).map(x => x.placePrediction).filter(Boolean).slice(0, 6); first = xs[0] || null;
        const main = (x) => x.structuredFormat && x.structuredFormat.mainText ? x.structuredFormat.mainText.text : '';
        const sub = (x) => x.structuredFormat && x.structuredFormat.secondaryText ? x.structuredFormat.secondaryText.text : '';
        ul.innerHTML = xs.map(x => `<li role="option"><button type="button" data-ac-pick="${esc(x.placeId)}">${acIcon(x.types)}<span class="ac-t"><b>${esc(main(x))}</b><span>${esc(sub(x))}</span></span></button></li>`).join('')
          + (opts.onText ? `<li role="option"><button type="button" data-ac-text>${AC_ICONS.pin ? `<svg class="ac-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>` : ''}<span class="ac-t"><b>${esc(t('Search for “{q}”', { q }))}</b></span></button></li>` : '')
          + `<li class="ac-by" aria-hidden="true">Google</li>`;
        ul.hidden = !xs.length && !opts.onText; input.setAttribute('aria-expanded', String(!ul.hidden));
      }).catch(() => close());
  }, 250);
  const pick = (id) => { close(); const tok = session; session = ''; opts.onPick(id, tok); };
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(); });
  input.addEventListener('blur', () => setTimeout(close, 250));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (opts.onText) { close(); seq++; opts.onText(input.value.trim()); } else if (first && !ul.hidden) pick(first.placeId); }
  }, true);
  ul.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the field while choosing
  ul.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); if (b.dataset.acPick) pick(b.dataset.acPick); else if ('acText' in b.dataset) { close(); seq++; opts.onText && opts.onText(input.value.trim()); } });
  return true;
}
// a Google place as a 1LinkTrip venue
function gpVenue(id, session) {
  return gFetch(`https://places.googleapis.com/v1/places/${enc(id)}${session ? '?sessionToken=' + enc(session) : ''}`, null, 'id,displayName,formattedAddress,location,addressComponents,types').then(gpToVenue);
}
// free-text address / venue search → the same shape the OpenStreetMap geocoder returns
function gGeocode(q) {
  const key = 'gg1:' + q.trim().toLowerCase(); if (memo.has(key)) return memo.get(key);
  const p = gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: q, pageSize: 6 }, 'places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents,places.types')
    .then(j => (j.places || []).filter(x => x.location).map(x => { const r = gpToVenue(x); r.types = x.types || []; r.display = r.address && r.address !== r.name ? `${r.name}, ${r.address}` : r.address; return r; }));
  memo.set(key, p); p.catch(() => memo.delete(key)); return p;
}
// hotels, sights and stations near a point, in the shape osmNearby returns (no restaurants: the Google list covers food)
const GN_MASK = 'places.id,places.displayName,places.location,places.types,places.accessibilityOptions,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri';
const GN_SIGHT = [['museum', 'museum'], ['art_gallery', 'gallery'], ['zoo', 'zoo'], ['aquarium', 'aquarium'], ['amusement_park', 'theme park']];
function gNearbyAll(lat, lon) {
  const key = 'gn2:' + osmKey(lat, lon); // gn2: + price level const c = LS.get(key); if (c && Date.now() - c.t < G_TTL) return Promise.resolve(c.d);
  if (memo.has(key)) return memo.get(key);
  const q = (types, radius, near) => gFetch('https://places.googleapis.com/v1/places:searchNearby', { includedTypes: types, maxResultCount: 20, ...(near ? { rankPreference: 'DISTANCE' } : {}), locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius } } }, GN_MASK)
    .then(j => (j.places || []).filter(x => x.location && x.displayName && x.displayName.text).map(x => {
      const la = x.location.latitude, lo = x.location.longitude, name = x.displayName.text, ac = x.accessibilityOptions || {};
      return { name, lat: la, lon: lo, d: distM(lat, lon, la, lo), types: x.types || [], website: '', street: '', city: '', wheelchair: ac.wheelchairAccessibleEntrance ? 'yes' : '',
        g: { gid: x.id, name, lat: la, lon: lo, rating: x.rating || 0, count: x.userRatingCount || 0, price: G_PRICE[x.priceLevel] || '', url: x.googleMapsUri || '' } };
    }));
  const dedupe = (arr, n) => { const seen = new Set(); return arr.filter(x => { const k = x.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, n); };
  const has = (x, ty) => x.types.includes(ty);
  const p = Promise.all([q(['lodging'], 2500), q(['tourist_attraction', 'museum', 'art_gallery', 'zoo', 'aquarium', 'amusement_park'], 3000), q(['subway_station', 'train_station', 'light_rail_station', 'ferry_terminal'], 1500, true), q(['bus_stop', 'bus_station'], 400, true)])
    .then(([ho, si, ra, bu]) => {
      const hotels = dedupe(ho.map(x => ({ ...x, kind: has(x, 'hostel') ? 'hostel' : has(x, 'motel') ? 'motel' : has(x, 'bed_and_breakfast') || has(x, 'guest_house') ? 'guest house' : 'hotel', stars: '' })).sort((a, b) => a.d - b.d), 30);
      const known = si.filter(x => x.g.count >= 20);
      const sights = dedupe((known.length >= 4 ? known : si).map(x => ({ ...x, kind: (GN_SIGHT.find(([ty]) => has(x, ty)) || [, 'attraction'])[1] })), 12);
      const near = (arr) => arr.sort((a, b) => a.d - b.d);
      const transit = { subway: [], rail: [], tram: [], bus: [], bike: [], ferry: [] };
      near(ra).forEach(x => transit[has(x, 'subway_station') ? 'subway' : has(x, 'light_rail_station') ? 'tram' : has(x, 'ferry_terminal') ? 'ferry' : 'rail'].push({ ...x, line: '' }));
      near(bu).forEach(x => transit.bus.push({ ...x, line: '' }));
      for (const k in transit) transit[k] = dedupe(transit[k], k === 'bus' ? 4 : 3);
      const d = { food: [], places: [], hotels, sights, transit, src: 'google' }; LS.set(key, { t: Date.now(), d }); return d;
    });
  memo.set(key, p); p.catch(() => memo.delete(key)); return p;
}
function gpToVenue(x) {
    const ac = x.addressComponents || []; const get = (ty, short) => { const c = ac.find(a => (a.types || []).includes(ty)); return c ? (short ? c.shortText : c.longText) : ''; };
    const name = (x.displayName && x.displayName.text) || '';
    const city = get('locality') || get('postal_town') || get('administrative_area_level_2') || get('sublocality') || ((x.types || []).some(t => /locality|administrative_area/.test(t)) ? name : '');
    return { name, address: x.formattedAddress || name, lat: +(+x.location.latitude).toFixed(5), lon: +(+x.location.longitude).toFixed(5), city, region: get('administrative_area_level_1'), country: get('country'), cc: (get('country', true) || '').toLowerCase(), gid: x.id };
}

// ================= AI import (Supabase Edge Function 'ai-import'; hidden until it answers) =================
let aiReadyP = null;
function aiReady() {
  if (!SB) return Promise.resolve(false);
  const c = LS.get('aiReady'); if (c && Date.now() - c.t < (c.ok ? 3600e3 : 300e3)) return Promise.resolve(c.ok);
  // a plain GET (no preflight): 200 or 401 (deployed, sign-in required) means it exists; 404 means not deployed yet
  return aiReadyP || (aiReadyP = fetchTimeout(`${SB.url}/functions/v1/ai-import`, {}, 8000)
    .then(r => r.status === 200 || r.status === 401).catch(() => false).then(ok => { LS.set('aiReady', { t: Date.now(), ok }); return ok; }));
}
// translate only: a signed-in guest uses their session; anyone else the public key (the function caps that)
// formatting markers travel to the translator as <b>/<i>/<mark> and come back as markers (see rtToTags)
const trWrap = (body) => body && body.mode === 'translate' && body.fields ? { ...body, fields: Object.fromEntries(Object.entries(body.fields).map(([k, v]) => [k, typeof v === 'string' ? rtToTags(v) : v])) } : body;
function trUnwrap(body, j) { if (body && body.mode === 'translate' && j && j.data && Array.isArray(j.data.translations)) j.data.translations.forEach(x => { if (typeof x.text === 'string') x.text = rtFromTags(x.text); }); return j; }
async function aiTranslate(body) {
  let tok = ''; try { if (LS.get('signedIn')) { const c = await sb(); const { data } = await c.auth.getSession(); tok = data && data.session ? data.session.access_token : ''; } } catch { /* anon below */ }
  const r = await fetchTimeout(`${SB.url}/functions/v1/ai-import`, { method: 'POST', headers: { Authorization: 'Bearer ' + (tok || SB.key), apikey: SB.key, 'Content-Type': 'application/json' }, body: JSON.stringify(trWrap(body)) }, 90000);
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'Translate failed (' + r.status + ')');
  return trUnwrap(body, j);
}
async function aiImport(body) {
  const c = await sb(); const { data } = await c.auth.getSession(); const tok = data && data.session && data.session.access_token;
  if (!tok) { const e = new Error('signin'); e.signin = true; throw e; }
  const r = await fetchTimeout(`${SB.url}/functions/v1/ai-import`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, apikey: SB.key, 'Content-Type': 'application/json' }, body: JSON.stringify(trWrap(body)) }, 90000);
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'Import failed (' + r.status + ')');
  return trUnwrap(body, j);
}
const isoDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '';
// A trip date that falls outside the trip (wrong year, or month and day swapped) is moved to the reading that fits;
// strict: an import with no fitting reading gives '' (Unscheduled); otherwise the date is kept as written.
const realDay = (d) => { try { return ymd(asUTC(d)) === d; } catch { return false; } };
function tripSpan(dates) {
  const ds = dates.filter(d => isoDay(d) && realDay(d)).sort(); if (!ds.length) return null; const med = ds[Math.floor((ds.length - 1) / 2)];
  const near = (d) => Math.abs(daysBetween(med, d)) <= 45;
  const fixed = ds.map(d => { if (near(d)) return d; const [y, m, dd] = d.split('-'); const alt = [`${med.slice(0, 4)}-${m}-${dd}`, ...(+dd <= 12 ? [`${y}-${dd}-${m}`, `${med.slice(0, 4)}-${dd}-${m}`] : [])].filter(realDay); return alt.find(near) || null; }).filter(Boolean).sort();
  return fixed.length ? [fixed[0], fixed[fixed.length - 1]] : null;
}
function fitTripDate(start, end, d, strict = true) {
  if (!d || !start || !isoDay(start.slice(0, 10))) return d || '';
  const s = start.slice(0, 10), e = (isoDay((end || '').slice(0, 10)) || s), lo = addDays(s, -3), hi = addDays(e, 3);
  if (d >= lo && d <= hi) return d;
  const [y, m, dd] = d.split('-'); const ys = [...new Set([s.slice(0, 4), e.slice(0, 4), y])]; const c = [];
  ys.forEach(yy => { c.push(`${yy}-${m}-${dd}`); if (+dd <= 12) c.push(`${yy}-${dd}-${m}`); });
  return c.find(x => realDay(x) && x >= lo && x <= hi) || (strict ? '' : d);
}
const isoTime = (s) => /^\d{2}:\d{2}$/.test(s || '') ? s : '';
const httpsUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
// the function's event JSON → a 1LinkTrip config (venue resolved separately)
function aiEventToCfg(d) {
  const type = TYPES.includes(d.type) ? d.type : 'Party'; const c = freshEvent(type);
  c.title = cleanText(d.title, 80); c.tagline = cleanText(d.tagline, 140); c.host = cleanText(d.host, 120);
  c.description = String(d.description || '').replace(/<[^>]*>/g, '').slice(0, 3000).trim();
  const sd = isoDay(d.start_date); if (sd) c.start = sd + (isoTime(d.start_time) ? 'T' + d.start_time : '');
  const ed = isoDay(d.end_date); if (ed && ed >= c.start.slice(0, 10)) c.end = ed + (isoTime(d.end_time) && hasTime(c.start) ? 'T' + d.end_time : '');
  const trip = d.type === 'Trip';
  c.schedule = (d.schedule || []).slice(0, 80).map(x => ({ date: trip ? fitTripDate(c.start, c.end, isoDay(x.date)) : isoDay(x.date) || c.start.slice(0, 10), time: isoTime(x.time), title: cleanText(x.title, 120), note: cleanText(x.note, 200), ...(PLAN_KINDS[x.kind] ? { kind: x.kind } : {}) })).filter(x => x.title);
  c.notes = (d.faqs || []).slice(0, 30).map(x => ({ label: cleanText(x.question, 120), text: cleanText(x.answer, 600), url: '' })).filter(x => x.label)
    .concat((d.links || []).slice(0, 20).map(x => ({ label: cleanText(x.label, 80), text: '', url: httpsUrl(x.url) })).filter(x => x.label && x.url));
  const w = {}; const hb = (d.hotel_blocks || [])[0];
  if (type === 'Wedding') {
    if (httpsUrl(d.rsvp_url)) w.rsvp = httpsUrl(d.rsvp_url); if (isoDay(d.rsvp_by)) w.rsvpBy = d.rsvp_by; if (d.dress_code) w.dress = cleanText(d.dress_code, 140);
    if (hb) { w.blockHotel = cleanText(hb.hotel, 120); if (httpsUrl(hb.url)) w.blockUrl = httpsUrl(hb.url); if (hb.code) w.blockCode = cleanText(hb.code, 40); if (isoDay(hb.book_by)) w.blockBy = hb.book_by; }
    c.x.Wedding = w;
  } else {
    if (hb) c.notes.unshift({ label: 'Room block: ' + cleanText(hb.hotel, 100), text: [hb.code ? 'Code ' + cleanText(hb.code, 40) : '', isoDay(hb.book_by) ? 'Book by ' + hb.book_by : ''].filter(Boolean).join(' · '), url: httpsUrl(hb.url) });
    if (d.dress_code) c.notes.push({ label: 'Dress code', text: cleanText(d.dress_code, 140), url: '' });
    if (httpsUrl(d.rsvp_url)) c.notes.push({ label: 'RSVP', text: isoDay(d.rsvp_by) ? 'Reply by ' + d.rsvp_by : '', url: httpsUrl(d.rsvp_url) });
  }
  // type-specific sections (newer function versions send these; older ones don't, which is fine)
  const D = d.details || {}; const X = (c.x[type] = c.x[type] || {}); const tx = (v, n = 300) => cleanText(v, n);
  const dt = (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v || '') ? v : isoDay(v) ? v : '';
  if (type === 'Race') {
    if (D.start_place) X.startAt = { q: tx(D.start_place, 160) }; if (D.finish_place) X.finishAt = { q: tx(D.finish_place, 160) };
    if (D.packet_pickup) X.packet = tx(D.packet_pickup); if (dt(D.packet_pickup_when)) X.packetWhen = dt(D.packet_pickup_when);
    if (httpsUrl(D.course_map_url)) X.course = httpsUrl(D.course_map_url);
    if ((D.spectator_spots || []).length) X.spots = D.spectator_spots.slice(0, 12).map(x => tx(x, 120)).filter(Boolean).join('\n');
    if (D.road_closures) X.closures = tx(D.road_closures, 500); if (httpsUrl(D.road_closures_url)) X.closuresUrl = httpsUrl(D.road_closures_url);
  } else if (type === 'Concert') {
    if (isoTime(D.doors)) X.doors = D.doors; if (D.opener) X.opener = tx(D.opener, 80); if (isoTime(D.opener_at)) X.openerAt = D.opener_at;
    if (D.headliner) X.headliner = tx(D.headliner, 80); if (isoTime(D.headliner_at)) X.headlinerAt = D.headliner_at; if (httpsUrl(D.setlist_url)) X.setlist = httpsUrl(D.setlist_url);
    if (D.bag_policy) X.bags = tx(D.bag_policy); if (D.parking) X.parking = tx(D.parking); if (D.rideshare_pickup) X.pickup = tx(D.rideshare_pickup, 160);
  } else if (type === 'Performance') {
    if (D.performer) X.performer = tx(D.performer, 120); if (isoTime(D.doors)) X.doors = D.doors; if (isoTime(D.showtime)) X.showtime = D.showtime;
    if (isoTime(D.call_time)) X.callTime = D.call_time; if (D.performer_slot) X.slot = tx(D.performer_slot, 160);
    if (httpsUrl(D.program_url)) X.program = httpsUrl(D.program_url); if (httpsUrl(D.tickets_url)) X.tickets = httpsUrl(D.tickets_url);
    if (D.flowers_gifts) X.flowers = tx(D.flowers_gifts); if (D.photo_policy) X.photo = tx(D.photo_policy); if (D.parking) X.parking = tx(D.parking);
    if (D.bag_policy) c.notes.push({ label: 'Bag policy', text: tx(D.bag_policy), url: '' });
  } else if (type === 'Hyrox') {
    if (D.division) X.division = tx(D.division, 120); if (isoTime(D.wave_start)) X.wave = D.wave_start;
    if (D.checkin) X.checkin = tx(D.checkin); if (dt(D.checkin_when)) X.checkinWhen = dt(D.checkin_when);
    if (D.bag_drop) X.bagdrop = tx(D.bag_drop); if (D.spectator_info) X.spectators = tx(D.spectator_info, 500);
    if (httpsUrl(D.results_url)) X.results = httpsUrl(D.results_url); if (D.parking) X.parking = tx(D.parking);
    if (D.bag_policy) c.notes.push({ label: 'Bag policy', text: tx(D.bag_policy), url: '' });
  } else if (type === 'Sporting event') {
    if (httpsUrl(D.seating_url)) X.seating = httpsUrl(D.seating_url); const tm = (D.teams || []).map(x => ({ label: tx(x.label, 60), url: httpsUrl(x.url) })).filter(x => x.label && x.url); if (tm.length) X.teams = tm;
    if (D.tailgate) X.tailgate = tx(D.tailgate); if (D.parking) X.parking = tx(D.parking); if (D.bag_policy) X.bags = tx(D.bag_policy);
  } else if (type === 'Conference') {
    if (D.badge_pickup) X.badge = tx(D.badge_pickup); if (dt(D.badge_pickup_when)) X.badgeWhen = dt(D.badge_pickup_when); if (httpsUrl(D.agenda_url)) X.agenda = httpsUrl(D.agenda_url);
    if ((D.speakers || []).length) X.speakers = D.speakers.slice(0, 40).map(x => tx(x, 120)).filter(Boolean).join('\n');
  } else if (type === 'Wedding') {
    const rg = (D.registry || []).map(x => ({ label: tx(x.label, 60), url: httpsUrl(x.url) })).filter(x => x.label && x.url); if (rg.length) X.registry = rg;
  }
  if (!['Race', 'Concert', 'Sporting event', 'Conference', 'Performance', 'Hyrox'].includes(type)) { // other types: parking and bag rules as notes
    if (D.parking) c.notes.push({ label: 'Parking', text: tx(D.parking), url: '' }); if (D.bag_policy) c.notes.push({ label: 'Bag policy', text: tx(D.bag_policy), url: '' });
  }
  (d.extras || []).slice(0, 20).forEach(x => { const label = tx(x.label, 80); if (label) c.notes.push({ label, text: tx(x.text, 600), url: httpsUrl(x.url) }); });
  return c;
}
// start/finish and pickup places get map pins when they can be found
async function aiPinPlaces(cfg) {
  const X = cfg.x[cfg.type] || {}; const v = cfg.venue; const near = v ? [v.city, v.country].filter(Boolean).join(', ') : '';
  for (const k of ['startAt', 'finishAt']) {
    if (!X[k] || !X[k].q || X[k].lat != null) continue;
    const r = await aiResolveVenue(X[k].q, near).catch(() => null);
    if (r && (!v || distM(v.lat, v.lon, r.lat, r.lon) < 60000)) { X[k].lat = r.lat; X[k].lon = r.lon; }
  }
}
async function aiResolveVenue(name, address) {
  const q = [name, address].filter(Boolean).join(', '); if (!q) return null;
  if (GKEY && !gpBroken) {
    try {
      const j = await gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: q, maxResultCount: 1 }, 'places.id');
      const id = j.places && j.places[0] && j.places[0].id; if (id) { const v = await gpVenue(id); if (name) v.name = cleanText(name, 120) || v.name; return v; }
    } catch { /* fall back to OpenStreetMap */ }
  }
  try { const r = (await osmGeocode(q))[0]; return r ? { name: cleanText(name, 120) || r.name, address: r.address, lat: r.lat, lon: r.lon, city: r.city, region: r.region, country: r.country, cc: r.cc } : null; } catch { return null; }
}
async function startFromWebsite(url, msgEl, type) {
  const say = (t2) => { if (msgEl) msgEl.textContent = t2; };
  say('Reading the site and filling in your page…');
  // the site's own colors, font and logo (ai-import "brand"), read alongside when the box is ticked and the function supports it
  const brandP = LS.get('aiBrand') === false ? Promise.resolve(null) : aiModes().then(m => m.includes('brand') ? aiImport({ mode: 'brand', url }) : null).catch(() => null);
  const j = await aiImport(type ? { url, type } : { url });
  // a category the organizer picked wins over the model's guess
  if (type && TYPES.includes(type)) { j.data = j.data || {}; if (j.data.type !== type) { j.data.type = type; } }
  const cfg = aiEventToCfg(j.data || {});
  if (!cfg.title) cfg.title = hostOf(url);
  say('Finding the venue…');
  const v = await aiResolveVenue(j.data.venue_name, j.data.venue_address);
  if (v) { cfg.venue = { name: v.name, address: v.address, lat: v.lat, lon: v.lon, city: v.city, region: v.region, country: v.country, cc: v.cc }; try { cfg.tz = await lookupTZ(v.lat, v.lon); } catch { /* floating */ } }
  say('Pinning the start, finish and other places…'); await aiPinPlaces(cfg).catch(() => {});
  const bj = await brandP; const bp = bj && brandFromSite(bj.data, cfg.theme);
  if (bp) { cfg.theme = { ...cfg.theme, accent: bp.accent, mode: bp.mode, font: bp.font }; if (bp.logo) cfg.logo = bp.logo; }
  const pid = newPid(); LS.set('draft', cfg); LS.set('draftHosted', null); LS.set('draftId', pid); pageSave(pid, { cfg });
  SU = null; history.replaceState(null, '', siteBase() + '#page=' + pid);
  renderBuilder(cfg, `Filled in from ${hostOf(url)}${bp ? ', in its colors' : ''}. Check every detail before you publish.`, null, pid);
}
function suAIHTML() {
  return `<div class="su-ai" data-su-ai hidden><div class="su-ai-starts"><button type="button" class="link strong" data-su="ai-open">${t('✦ Start from a website')}</button><button type="button" class="link strong" data-su="doc-open">${t('✦ Start from a document')}</button></div>
    <div class="su-ai-form" hidden><p class="hint" data-su-ai-type></p>
      <div class="search"><input id="su-ai-url" type="url" inputmode="url" placeholder="https://yourwedding.com" autocomplete="off"><button type="button" class="btn primary" data-su="ai-go">${t('Fill in')}</button></div>
      <label class="chk su-ai-brand"><input type="checkbox" data-su-brand ${LS.get('aiBrand') === false ? '' : 'checked'}> ${t('Use the site’s colors and logo')}</label>
      <p class="hint" data-su-ai-msg role="status" aria-live="polite"></p><div data-su-ai-signin></div></div>
    <div class="su-doc-form" hidden><p class="hint" data-su-ai-type></p>
      <label class="su-doc-drop" data-su-doc-drop><input type="file" id="su-doc-file" accept="application/pdf,.pdf,image/*" hidden><b>${t('Choose a PDF or photo')}</b><span>${t('or drop it here · an itinerary, invitation or booking confirmation')}</span></label>
      <p class="hint" data-su-doc-msg role="status" aria-live="polite"></p><div data-su-doc-signin></div></div></div>`;
}
// "Start from a document": the same reader as Upload a document in the builder (ai-import mode doc), filling a new page
// (type, title, dates, venue or route, schedule, notes, sections), then on to the builder like Start from a website.
async function startFromDocument(file, msgEl, type) {
  const say = (t2) => { if (msgEl) msgEl.textContent = t2; };
  if (!file) return; if (!isPdf(file) && !/^image\//.test(file.type || '')) throw new Error('Use a PDF or a photo.');
  if (isPdf(file) && file.size > 10 * 1024 * 1024) throw new Error('That PDF is too large (10 MB max).');
  say('Reading your document and filling in your page…');
  const part = await bookingFile(file);
  const j = await aiImport({ mode: 'doc', files: [part], ...(type && TYPES.includes(type) ? { type } : {}) });
  const d = j.data || {}; const typ = type && TYPES.includes(type) ? type : TYPES.includes(d.type) ? d.type : 'Party';
  const base = freshEvent(typ); const items = docItems(base, { ...d, type: typ }, 'auto');
  if (!items.length && !cleanText(d.title, 80)) throw new Error('Nothing found to fill in. Try another file, or pick a category below.');
  say('Finding the places…');
  const cfg = await docApply(base, items);
  if (!isTrip(cfg) && cfg.start === isoDay(d.start_date) && isoTime(d.start_time)) { // an event keeps its start time (trips run by the day)
    cfg.start += 'T' + d.start_time; if (cfg.end && cfg.end === isoDay(d.end_date) && isoTime(d.end_time)) cfg.end += 'T' + d.end_time; else if (cfg.end && cfg.end.length === 10) cfg.end = cfg.end > cfg.start.slice(0, 10) ? cfg.end : ''; }
  if (!cfg.title.trim()) cfg.title = cleanText(d.title, 80) || cleanText((file.name || '').replace(/\.\w+$/, '').replace(/[_-]+/g, ' '), 80) || 'My trip';
  if (cfg.venue && !cfg.tz) { try { cfg.tz = await lookupTZ(cfg.venue.lat, cfg.venue.lon); } catch { /* floating */ } }
  await aiPinPlaces(cfg).catch(() => {});
  const pid = newPid(); LS.set('draft', cfg); LS.set('draftHosted', null); LS.set('draftId', pid); pageSave(pid, { cfg });
  SU = null; history.replaceState(null, '', siteBase() + '#page=' + pid);
  renderBuilder(cfg, `Filled in from ${cleanText(file.name || 'your document', 80)}. Check every detail before you publish.`, null, pid);
}
async function suDocGo(file) {
  const msg = $('[data-su-doc-msg]'); const drop = $('[data-su-doc-drop]'); if (drop) drop.classList.add('busy');
  try { await startFromDocument(file, msg, SU && SU.aiType); }
  catch (e) {
    if (drop) drop.classList.remove('busy');
    if (e.signin) { LS.set('pendingAiDoc', (SU && SU.aiType) || '-'); LS.set('afterSignIn', '#setup'); msg.textContent = t('Sign in first, so imports stay yours. Then choose the file again.'); $('[data-su-doc-signin]').innerHTML = signInFormHTML(''); return; }
    msg.textContent = e.message || t('Couldn’t read that file.'); toast(t('Couldn’t read that file:') + ' ' + (e.message || t('try again')));
  }
}
function suAIHint() {
  const t = SU && SU.aiType && (SETUP_TYPES.find(x => x[0] === SU.aiType) || [])[1];
  $$('[data-su-ai-type]').forEach(el => { el.innerHTML = t ? `Category: <b>${esc(t)}</b>` : ''; });
}
async function suAIGo() {
  const inp = $('#su-ai-url'); const msg = $('[data-su-ai-msg]'); const url = normSite(inp ? inp.value : '');
  if (!url) { msg.textContent = t('That doesn’t look like a website link.'); return; }
  const btn = $('[data-su="ai-go"]'); btn.disabled = true;
  try { await startFromWebsite(url, msg, SU && SU.aiType); }
  catch (e) {
    btn.disabled = false;
    if (e.signin) { LS.set('pendingAiUrl', url); LS.set('pendingAiType', (SU && SU.aiType) || ''); LS.set('afterSignIn', '#setup'); msg.textContent = t('Sign in first, so imports stay yours.'); $('[data-su-ai-signin]').innerHTML = signInFormHTML(''); return; }
    msg.textContent = e.message || t('Couldn’t read that site.');
  }
}
// "Read with AI" in the guest booking form: every reservation in a pasted confirmation becomes a booking
// the details a confirmation states (ai-import v16 fields, v18 cancellation time + non-refundable) → x.det, only what's there
function aiDet(x) {
  const c = (v, n = 120) => cleanText(v == null ? '' : String(v), n); const d = {};
  const put = (k, v) => { if (bkFilled(v)) d[k] = v; };
  { const [rm, bd] = roomBedSplit(c(x.room_type)); put('room', rm); put('beds', c(x.beds) || bd); } // a bed left in the room name moves to Bed
  put('guests', /^\d{1,2}$/.test(c(x.guests)) ? c(x.guests) : '');
  put('amen', (Array.isArray(x.amenities) ? x.amenities : []).map(a => String(a).toLowerCase()).filter(a => AMENITIES.some(y => y[0] === a)).slice(0, 12));
  const nr = x.non_refundable === true || String(x.non_refundable) === 'true'; // ai-import v18: non-refundable; cancel_by may carry a time
  put('cancelBy', nr ? '' : hfCancelOk(c(x.cancel_by))); put('nonRef', nr ? 1 : ''); put('price', c(x.price, 40));
  put('seat', c(x.seat, 20)); put('cabin', CABINS.some(y => y[0] === x.cabin) ? x.cabin : ''); put('bags', c(x.baggage)); put('carClass', c(x.car_class, 60));
  put('meet', c(x.meeting_point, 200)); put('duration', c(x.duration, 40)); put('incl', c(x.included, 200)); put('party', /^\d{1,2}$/.test(c(x.party_size)) ? c(x.party_size) : '');
  return Object.keys(d).length ? { det: d } : {};
}
const AI_KIND = { flight: 'flight', hotel: 'hotel', stay: 'stay', car: 'car', train: 'train', food: 'food', tour: 'tour', other: 'other' };
function aiItemsToBookings(items) {
  return (items || []).slice(0, 40).map(x => {
    const st = String(x.start || ''), en = String(x.end || '');
    const okDT = (s) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s) ? s : '';
    return { kind: AI_KIND[x.type] || 'other', name: cleanText(x.name || x.provider, 120), start: okDT(st), end: okDT(en), address: cleanText(x.address, 200), confNo: cleanText(x.confirmation, 60),
      ...(() => { const bt = cleanText(x.booked_through || '', 60); const k = viaGuess(bt) || viaGuess(x.link) || (bt && /direct/i.test(bt) ? 'direct' : ''); return k ? { via: k } : bt ? { via: 'other', viaOther: bt } : {}; })(),
      ...aiDet(x), link: httpsUrl(x.link), flight: cleanText(x.flight_number, 12), to: AI_KIND[x.type] === 'flight' ? cleanText(x.to, 60) : '', ...(AI_KIND[x.type] === 'flight' && x.from ? { from: cleanText(x.from, 60) } : {}), note: cleanText([x.from && x.to && AI_KIND[x.type] !== 'flight' ? `${x.from} → ${x.to}` : '', x.note].filter(Boolean).join(' · '), 300) }; // a flight keeps from / to in their own fields
  }).map(flightArriveFix).filter(x => x.name || x.start);
}

// ================= multi-city trips: a route of stops with dates =================
// cfg.stops = [{ name, address, lat, lon, city, region, country, cc, from, to }]. The first stop doubles as the venue
// when none is set. Old pages kept stops as plain lines in x.Trip.stops; those still render.
const stopsOf = (cfg) => Array.isArray(cfg.stops) ? cfg.stops.filter(s => s && s.name) : [];
const stopFor = (cfg, d) => stopsOf(cfg).find(s => s.from && s.to && d >= s.from && d < s.to) || stopsOf(cfg).filter(s => s.from && d >= s.from).slice(-1)[0] || null;
const stopRange = (s) => s.from ? (s.to && s.to !== s.from ? dateRange(s.from, s.to) : dateRange(s.from, s.from)) : '';
const CUR = { jp: '¥', gb: '£', ie: '€', fr: '€', de: '€', it: '€', es: '€', pt: '€', nl: '€', be: '€', at: '€', fi: '€', gr: '€', kr: '₩', in: '₹', cn: '¥', th: '฿', ch: 'CHF ', mx: '$' };
const priceSym = (cfg, p) => { const cc = (cfg.venue && cfg.venue.cc) || ''; const sym = CUR[cc]; return p && sym && sym !== '$' ? p.replace(/\$/g, sym.trim()) : p; };
// ---- route dates: stops stay in date order, insert between stops, nights, move the whole trip ----
// A stop with an Arrive date sits where its dates put it (re-sorted when a stop is added or its dates are set); stops
// without dates keep their place. Every stop has a stable id (st…) so anything tied to a stop follows it, not its position.
const stopDated = (s) => !!(s && isoDay(String(s.from || '').slice(0, 10)));
const newStopId = () => 'st' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6);
const shiftDay = (d, n) => d && isoDay(String(d).slice(0, 10)) ? addDays(d.slice(0, 10), n) + d.slice(10) : d;
const nightsOf = (s) => stopDated(s) && isoDay(s.to || '') ? daysBetween(s.from, s.to) : null;
const nightsTxt = (n) => n === 1 ? t('1 night') : t('{n} nights', { n });
function sortStops(cfg) {
  const ss = Array.isArray(cfg.stops) ? cfg.stops : []; const slots = ss.map((s, i) => stopDated(s) ? i : -1).filter(i => i >= 0);
  const dated = slots.map(i => ss[i]).map((s, k) => [s, k]).sort((a, b) => a[0].from.localeCompare(b[0].from) || String(a[0].to || '').localeCompare(String(b[0].to || '')) || a[1] - b[1]).map(x => x[0]);
  let moved = false; slots.forEach((i, k) => { if (ss[i] !== dated[k]) { moved = true; ss[i] = dated[k]; } }); return moved;
}
// the trip's dates grow to cover its stops (never shrink: Move trip dates does that)
function fitTripToStops(cfg) {
  const ds = (cfg.stops || []).filter(stopDated).flatMap(s => [s.from.slice(0, 10), isoDay(s.to || '') || s.from.slice(0, 10)]).sort(); if (!ds.length || !cfg.start) return;
  if (ds[0] < cfg.start.slice(0, 10)) cfg.start = ds[0] + cfg.start.slice(10);
  const e = (cfg.end || cfg.start).slice(0, 10); if (ds[ds.length - 1] > e) cfg.end = ds[ds.length - 1] + (cfg.end || '').slice(10);
}
// move dates by n days: the whole trip (from = '') or everything from a day on (Make room). Stops, the itinerary and the
// trip's dates move here; each guest's own saved-place days follow on their device (cfg.shifts, applied once each).
// Bookings (flights, hotels with confirmations) never move: they are real reservations — they get flagged instead.
// firstStop (Make room): that stop and every stop after it in the route move; itinerary days from `from` on move.
function shiftDates(cfg, from, n, firstStop = null) {
  if (!n) return; if (!cfg.ek) cfg.ek = eventKey(cfg); // the page keeps its key, so guests' My trip stays with it
  const hit = (d) => !!d && !!isoDay(String(d).slice(0, 10)) && (!from || d.slice(0, 10) >= from);
  const ss = cfg.stops || []; const k0 = firstStop ? ss.indexOf(firstStop) : -1;
  ss.forEach((s, k) => { if (k0 >= 0 ? k >= k0 && stopDated(s) : hit(s.from)) { s.from = shiftDay(s.from, n); if (s.to) s.to = shiftDay(s.to, n); } });
  (cfg.schedule || []).forEach(x => { if (hit(x.date)) x.date = shiftDay(x.date, n); });
  if (cfg.start && (!from || hit(cfg.start))) cfg.start = shiftDay(cfg.start, n);
  if (cfg.end && (!from || hit(cfg.end))) cfg.end = shiftDay(cfg.end, n);
  const id = 'sh' + Date.now().toString(36); cfg.shifts = (cfg.shifts || []).concat([{ id, from: from || '', d: n }]).slice(-20);
  applyShifts(cfg); fitTripToStops(cfg);
}
// this device's saved places (My trip) follow the organizer's date moves, each move once
function applyShifts(cfg) {
  const sh = Array.isArray(cfg.shifts) ? cfg.shifts : []; if (!sh.length) return false;
  const k = 'shifted:' + syncKey(cfg); const done = new Set(LS.get(k, [])); const todo = sh.filter(x => x && x.id && !done.has(x.id)); if (!todo.length) return false;
  const stored = LS.get(planKey(cfg), null);
  if (Array.isArray(stored) && stored.length) { todo.forEach(s => stored.forEach(p => { if (p.day && (!s.from || p.day >= s.from)) p.day = addDays(p.day, s.d); })); LS.set(planKey(cfg), stored); }
  todo.forEach(s => done.add(s.id)); LS.set(k, [...done].slice(-40)); return true;
}
// a booking whose dates fall outside the trip (after the organizer moved it): flagged, never changed
function bkOffTrip(cfg, x) {
  const s = bkDay(x.start); if (!s || !isTrip(cfg)) return false; const e = bkDay(x.end) || s;
  const ds = stopsOf(cfg).filter(stopDated).flatMap(y => [y.from.slice(0, 10), isoDay(y.to || '') || y.from.slice(0, 10)]).sort();
  const a = ds.length ? ds[0] : (cfg.start || '').slice(0, 10), b = ds.length ? ds[ds.length - 1] : (cfg.end || cfg.start || '').slice(0, 10); if (!a) return false;
  return e < addDays(a, -1) || s > addDays(b, 1);
}
const routeSpan = (cfg) => { const ds = stopsOf(cfg).filter(stopDated).flatMap(y => [y.from.slice(0, 10), isoDay(y.to || '') || y.from.slice(0, 10)]).sort(); return ds.length ? [ds[0], ds[ds.length - 1]] : cfg.start ? [cfg.start.slice(0, 10), (cfg.end || cfg.start).slice(0, 10)] : null; };
const tripSpanTxt = (c) => c.start ? dateRange(c.start.slice(0, 10), (c.end || c.start).slice(0, 10)) : '';
// the "Move trip dates" panel: new first day → what moves (old → new), what doesn't (bookings), Move / Cancel
function shiftPanelHTML(c) {
  const to = B.shift && B.shift.start; const n = to && c.start ? daysBetween(c.start.slice(0, 10), to) : 0;
  const arrow = (a, b) => `<span class="sh-old">${esc(a)}</span> → <b>${esc(b)}</b>`;
  const sim = n ? (() => { const x = clone(c); (x.stops || []).forEach(s => { if (stopDated(s)) { s.from = shiftDay(s.from, n); if (s.to) s.to = shiftDay(s.to, n); } }); x.start = shiftDay(x.start, n); if (x.end) x.end = shiftDay(x.end, n); return x; })() : null;
  const items = (c.schedule || []).filter(x => isoDay(x.date || '')).length;
  const bks = n ? itinLoad(c).filter(x => bkDay(x.start)).filter(x => bkOffTrip(sim, x)) : [];
  return `<div class="sh-panel" data-sh-panel><div class="field"><label for="sh-start">${t('New first day')}</label><input id="sh-start" type="date" data-sh-start value="${esc(to || '')}"></div>
    ${n ? `<p class="sh-sum">${arrow(tripSpanTxt(c), tripSpanTxt(sim))} <small>${esc(t(Math.abs(n) === 1 ? (n > 0 ? '1 day later' : '1 day earlier') : (n > 0 ? '{n} days later' : '{n} days earlier'), { n: Math.abs(n) }))}</small></p>
      <ul class="sh-list">${stopsOf(c).filter(stopDated).map(s => { const y = sim.stops[c.stops.indexOf(s)]; return `<li>${esc(s.name)}: ${arrow(stopRange(s), stopRange(y))}</li>`; }).join('')}
        ${items ? `<li>${esc(t(items === 1 ? '1 itinerary item moves with its day' : '{n} itinerary items move with their days', { n: items }))}</li>` : ''}<li>${t('Places guests saved to a day move with it')}</li></ul>
      ${bks.length ? `<p class="sh-warn"><b>${t('Bookings keep their dates.')}</b> ${t('Flights and hotels already booked don’t move — change them with the airline or hotel. These will show “Not on the trip dates”:')} ${bks.map(x => esc(`${x.name || t(ITIN_KINDS[x.kind] || 'Booking')} (${dateRange(bkDay(x.start), bkDay(x.end) || bkDay(x.start)).replace(/, \d{4}$/, '')})`)).join(', ')}.</p>` : `<p class="hint">${t('Guests’ own flight and hotel bookings keep their dates and are flagged if they no longer match.')}</p>`}`
      : to ? '<p class="hint">That’s already the first day.</p>' : '<p class="hint">Pick the trip’s new first day. Every stop and itinerary day moves by the same number of days.</p>'}
    <div class="btns"><button type="button" class="btn primary" data-sh="apply"${n ? '' : ' disabled'}>${t('Move trip')}</button><button type="button" class="btn ghost" data-sh="cancel">${t('Cancel')}</button></div></div>`;
}
function routeHTML(c, only = null) {
  const ss = Array.isArray(c.stops) ? c.stops : []; const note = (s, i) => stopNoteHTML(c, i);
  const row = (s, i) => { const n = nightsOf(s);
    return `<li class="rowed st-row${B && B.flashStop === s ? ' flash' : ''}" data-st-row="${i}">
      ${s.name ? `<div class="venue-sel"><div><b>${esc(s.name)}</b><span>${esc([s.region, s.country].filter(Boolean).join(', '))}</span></div><button type="button" class="btn sm" data-st-clear="${i}">${t('Change')}</button></div>`
        : `<div class="field"><label for="st-q-${i}">${t('City or place')}</label><div class="search"><input id="st-q-${i}" data-st-q="${i}" placeholder="Kyoto" autocomplete="off"><button type="button" class="btn" data-st-find="${i}">${t('Find')}</button></div></div>`}
      <div class="st-dates"><div class="two"><div class="field"><label for="st-from-${i}">${t('Arrive')}</label><input id="st-from-${i}" type="date" data-st="${i}" data-k="from" value="${esc(s.from || '')}"></div><div class="field"><label for="st-to-${i}">${t('Leave')}</label><input id="st-to-${i}" type="date" data-st="${i}" data-k="to" value="${esc(s.to || '')}" min="${esc(s.from || '')}"></div></div>
</div>
      ${note(s, i)}
      <div class="plan-ctl st-foot">${stopDated(s) ? `<div class="st-nights" role="group" aria-label="${t('Nights')}"><button type="button" data-st-n="${i}" data-dir="-1" ${n ? '' : 'disabled'} aria-label="${t('One night fewer')}">−</button><span>${n == null ? t('Set the leave date') : n === 0 ? t('Day trip') : nightsTxt(n)}</span><button type="button" data-st-n="${i}" data-dir="1" aria-label="${t('One more night')}">+</button></div>` : ''}<span class="mv"><button type="button" data-st-mv="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="${t('Move up')}">↑</button><button type="button" data-st-mv="${i}" data-dir="1" ${i === ss.length - 1 ? 'disabled' : ''} aria-label="${t('Move down')}">↓</button></span><button type="button" class="link" data-st-del="${i}">${t('Remove')}</button></div>
    </li>`; };
  if (only != null) return `<ol class="route-ed">${ss[only] ? row(ss[only], only) : ''}</ol>`;
  const nd = ss.filter(stopDated).length;
  return `${c.start && isTrip(c) ? `<div class="rt-sum"><div><span class="lbl-s">${t('Trip dates')}</span><b>${esc(tripSpanTxt(c))}</b>${nd ? `<small>${esc(t(ss.filter(x => x.name).length === 1 ? '1 stop' : '{n} stops', { n: ss.filter(x => x.name).length }))} · ${t('in date order')}</small>` : ''}</div>${B && B.shift ? '' : `<div class="rt-acts">${B && B.shiftUndo ? `<button type="button" class="btn sm ghost" data-sh="undo">${t('Undo move')}</button>` : ''}<button type="button" class="btn sm" data-sh="open">${t('Move trip dates')}</button></div>`}</div>${B && B.shift ? shiftPanelHTML(c) : ''}` : ''}
    <ol class="route-ed">${ss.map((s, i) => row(s, i) + (i < ss.length - 1 ? `<li class="st-ins"><button type="button" data-st-ins="${i}" aria-label="${esc(t('Insert a stop after {s}', { s: s.name || t('this stop') }))}">${t('+ Insert a stop')}</button></li>` : '')).join('')}</ol>
    <button type="button" class="btn sm" data-st-add>${t('+ Add a stop')}</button>`;
}
// gentle notes between stops: an overlap (with Make room) or a gap (with Insert a stop here)
function stopNoteHTML(c, i) {
  const ss = Array.isArray(c.stops) ? c.stops : []; const s = ss[i]; let p = null; for (let j = i - 1; j >= 0 && !p; j--) if (stopDated(ss[j])) p = ss[j];
  if (!p || !stopDated(s) || !isoDay(p.to || '')) return '';
  const d = daysBetween(p.to, s.from.slice(0, 10)); const pn = p.name || 'the stop before';
  if (d < 0) return `<p class="st-note warn">${esc(t('Overlaps {p} by {n}.', { p: pn, n: nightsTxt(-d) }))} <button type="button" class="link" data-st-push="${i}" data-n="${-d}">${esc(t(-d === 1 ? 'Move {s} and later stops 1 day later' : 'Move {s} and later stops {n} days later', { s: s.name || t('this stop'), n: -d }))}</button></p>`;
  if (d > 0) return `<p class="st-note">${esc(t('{n} with no stop after {p}.', { n: nightsTxt(d), p: pn }))} <button type="button" class="link" data-st-ins="${ss.indexOf(p)}">${t('Insert a stop here')}</button></p>`;
  return '';
}
function setStop(cfg, i, v) {
  const prev = cfg.stops[i] || {};
  // a new place: its own point, city and address (nothing kept from the place it replaces but its dates and id)
  cfg.stops[i] = { id: prev.id || newStopId(), name: v.name, address: v.address, lat: v.lat, lon: v.lon, city: v.city || v.name, region: v.region, country: v.country, cc: v.cc, from: prev.from || '', to: prev.to || '' };
  if (!cfg.venue && i === 0) { cfg.venue = { name: v.name, address: v.address, lat: v.lat, lon: v.lon, city: v.city || v.name, region: v.region, country: v.country, cc: v.cc }; lookupTZ(v.lat, v.lon).then(tz => { cfg.tz = tz; changed(); }).catch(() => {}); }
  if (B && onpIdxFix) onpIdxFix(prev, cfg.stops[i]);
  routeSettle(cfg, cfg.stops[i]); changed(true);
}
const onpIdxFix = (a, b) => { if (B && B.focus && B.focus.o === a) B.focus.o = b; };
// after a stop's dates or place changed: date order, the trip's dates cover the route; the moved stop flashes once
function routeSettle(cfg, s) {
  const moved = sortStops(cfg); fitTripToStops(cfg);
  if (moved && s && s.name) { B.flashStop = s; toast(t('{n} moved to its place in the route', { n: s.name })); setTimeout(() => { if (B && B.flashStop === s) B.flashStop = null; }, 2500); }
  return moved;
}
function routeClick(b, cfg) {
  const d = b.dataset; if (!('stAdd' in d || d.stDel || d.stMv || d.stClear || d.stFind || d.stIns != null || d.stN != null || d.stPush != null || d.sh)) return false;
  cfg.stops = Array.isArray(cfg.stops) ? cfg.stops : [];
  const focusNew = (x) => setTimeout(() => { const k = cfg.stops.indexOf(x); $(`#st-q-${k}`)?.focus(); $(`[data-st-row="${k}"]`)?.scrollIntoView({ block: 'nearest' }); }, 40);
  if ('stAdd' in d) { const ds = cfg.stops.filter(stopDated); const last = ds[ds.length - 1]; const from = last && last.to ? last.to : cfg.start.slice(0, 10); const x = { id: newStopId(), name: '', from, to: '' }; cfg.stops.push(x); changed(true); focusNew(x); }
  if (d.stIns != null) { // between stop i and the next: the gap's dates, else one night from where stop i ends
    const i = +d.stIns; const p = cfg.stops[i], nx = cfg.stops.slice(i + 1).find(stopDated);
    const from = p && (isoDay(p.to || '') || isoDay((p.from || '').slice(0, 10))) || (cfg.start || '').slice(0, 10);
    const to = from ? (nx && nx.from.slice(0, 10) > from ? nx.from.slice(0, 10) : addDays(from, 1)) : '';
    const x = { id: newStopId(), name: '', from, to }; cfg.stops.splice(i + 1, 0, x); B.flashStop = x; changed(true); focusNew(x); }
  if (d.stN != null) { const s = cfg.stops[+d.stN]; if (s && stopDated(s)) { const n = Math.max(0, (nightsOf(s) ?? 0) + +d.dir); s.to = addDays(s.from.slice(0, 10), n); routeSettle(cfg, s); changed(true); } }
  if (d.stPush != null) { const s = cfg.stops[+d.stPush]; const n = +d.n; if (s && stopDated(s) && n > 0) { shiftDates(cfg, addDays(s.from.slice(0, 10), n), n, s); /* the overlapped stop keeps its own days */ toast(t(n === 1 ? 'Moved {s} and later stops 1 day later' : 'Moved {s} and later stops {n} days later', { s: s.name || t('the stop'), n })); changed(true); } }
  if (d.stDel) { cfg.stops.splice(+d.stDel, 1); changed(true); }
  if (d.stMv) { const i = +d.stMv, j = i + +d.dir; if (j >= 0 && j < cfg.stops.length) { [cfg.stops[i], cfg.stops[j]] = [cfg.stops[j], cfg.stops[i]]; changed(true); } }
  if (d.stClear) { const s = cfg.stops[+d.stClear]; const x = { id: s.id || newStopId(), name: '', from: s.from, to: s.to }; onpIdxFix(s, x); cfg.stops[+d.stClear] = x; changed(true); }
  if (d.stFind) { const i = +d.stFind; const q = ($(`#st-q-${i}`) || {}).value || ''; if (q.trim().length < 2) return true;
    geocode(q.trim()).then(rs => { const cc = tripCC(cfg); const ok = rs.filter(x => !(x.types || []).some(ty => ty === 'country' || ty === 'continent')); const r = ok.find(x => !cc || !x.cc || x.cc === cc) || ok[0] || rs[0]; if (!r) { toast(t('No match. Try adding the country.')); return; } setStop(cfg, i, r); }).catch(() => toast(t('Search is unavailable right now'))); }
  if (d.sh === 'open') { B.shiftUndo = null; B.shift = { start: '' }; renderSheet(); setTimeout(() => $('#sh-start')?.focus(), 40); }
  if (d.sh === 'cancel') { B.shift = null; renderSheet(); }
  if (d.sh === 'undo' && B.shiftUndo) { B.shiftUndo(); toast(t('Trip dates put back')); }
  if (d.sh === 'apply' && B.shift && B.shift.start && cfg.start) {
    const n = daysBetween(cfg.start.slice(0, 10), B.shift.start); if (!n) return true;
    const snap = clone(cfg); const pk = planKey(cfg), plan0 = LS.get(pk, null), sk = 'shifted:' + syncKey(cfg), done0 = LS.get(sk, null);
    shiftDates(cfg, '', n); B.shift = null; changed(true);
    B.shiftUndo = () => { B.shiftUndo = null; Object.keys(cfg).forEach(k => delete cfg[k]); Object.assign(cfg, snap); if (plan0 == null) LS.del(pk); else LS.set(pk, plan0); if (done0 == null) LS.del(sk); else LS.set(sk, done0); changed(true); };
    renderSheet(); toast(t('Trip moved to {d}', { d: tripSpanTxt(cfg) }));
  }
  return true;
}
function routeInput(i, cfg) {
  if (i.dataset.shStart != null) return true; // read on change
  if (i.dataset.st == null) return false;
  const s = cfg.stops[+i.dataset.st]; if (!s) return true; s[i.dataset.k] = i.value;
  if (i.dataset.k === 'from' && s.to && s.to < s.from) s.to = '';
  changed(); return true;
}
// a date committed (picker closed / field left): date order, trip span, nights + notes repainted
function routeChange(i, cfg) {
  if (i.dataset.shStart != null) { B.shift = { start: isoDay(i.value) }; renderSheet(); setTimeout(() => $('#sh-start')?.focus(), 0); return true; }
  if (i.dataset.st == null || !['from', 'to'].includes(i.dataset.k)) return false;
  const s = cfg.stops[+i.dataset.st]; if (!s) return true;
  if (i.dataset.k === 'from' && stopDated(s) && !s.to) { const x = cfg.stops[+i.dataset.st + 1]; if (!x || !stopDated(x) || x.from.slice(0, 10) > s.from) s.to = addDays(s.from.slice(0, 10), 1); }
  routeSettle(cfg, s); changed(true); return true;
}
function wireRouteAC(cfg) {
  $$('#sheet [data-st-q]').forEach(inp => placeAutocomplete(inp, { bias: () => cfg.venue, onPick: (id, tok) => gpVenue(id, tok).then(v => setStop(cfg, +inp.dataset.stQ, v)).catch(() => toast(t('Couldn’t load that place'))) }));
}
// guest page: the route
function routeGuestHTML(cfg) {
  const ss = stopsOf(cfg);
  if (ss.length < 2) { const lines = String((typeData(cfg) || {}).stops || '').split('\n').map(x => x.trim()).filter(Boolean); return lines.length && !ss.length ? '' : ''; }
  return `<ol class="route">${ss.map((s, i) => `<li><button type="button" class="route-stop" data-route-stop="${i}"${edA('st:' + (cfg.stops || []).indexOf(s))}><span class="route-n">${i + 1}</span><span><b>${esc(s.name)}</b><small>${esc(stopRange(s))}</small></span></button></li>`).join('')}</ol>`;
}
// "Between stops": door to door — from the hotel at the stop being left to the hotel at the next stop (Dylan: "it just opens
// up Google Maps between hotels"). The hotel per city is hotelsNow's: the guest's own (a booking or Set as my hotel) over the
// organizer's itinerary check-in for the same nights. Picked by the travel day: the stay that ends that day at the stop
// being left, the stay that starts that day (or covers it) at the next one. A stop with no hotel stays the stop's point.
const GPID_RE = /^(ChIJ|Ei|Gh|Gk|Eh)[\w-]{10,}$/;
function legHotel(cfg, s, d, hs, cs, leaving) {
  const ci = cs.findIndex(c => c.legs.includes(s)); const xs = (ci >= 0 && hs[ci]) || []; if (!xs.length) return null;
  const end = (h) => h.to && h.to > h.from ? h.to : h.from;
  if (!d) return xs.length === 1 ? xs[0] : null;
  const dated = xs.filter(h => h.from);
  const hit = leaving ? dated.filter(h => h.from < d && end(h) >= d).sort((a, b) => b.from.localeCompare(a.from))[0] // checking out that day
    : dated.filter(h => h.from >= d && h.from <= (s.to && s.to > d ? s.to : d)).sort((a, b) => a.from.localeCompare(b.from))[0] || dated.find(h => h.from <= d && end(h) > d); // checking in that day (or later in that stay)
  return hit || xs.find(h => !h.from) || null;
}
function legEnd(h, s, k) {
  if (!h) return `${k}=${s.lat},${s.lon}`;
  const txt = [h.name, h.addr || s.city || s.name].filter(Boolean).join(', ');
  if (h.ref && GPID_RE.test(h.ref)) return `${k}=${encodeURIComponent(txt)}&${k}_place_id=${encodeURIComponent(h.ref)}`;
  return h.lat != null ? `${k}=${h.lat},${h.lon}` : `${k}=${encodeURIComponent(txt)}`;
}
function legDirURL(cfg, a, b, hs = hotelsNow(cfg), cs = hotelStops(cfg)) {
  const d = (b.from || '').slice(0, 10);
  return `https://www.google.com/maps/dir/?api=1&${legEnd(legHotel(cfg, a, d, hs, cs, true), a, 'origin')}&${legEnd(legHotel(cfg, b, d, hs, cs, false), b, 'destination')}&travelmode=transit`;
}
function routeTrainsHTML(cfg) {
  const ss = stopsOf(cfg); if (ss.length < 2) return '';
  const jp = ss.some(s => s.cc === 'jp');
  const legs = ss.slice(1).map((s, i) => [ss[i], s]);
  const hs = hotelsNow(cfg); const cs = hotelStops(cfg);
  return `<h3 class="sub-h">${t('Between stops')}</h3><div class="row-links">${legs.map(([a, b]) => ext(legDirURL(cfg, a, b, hs, cs), `${esc(a.name)} → ${esc(b.name)}${b.from ? ` <small>${esc(fmt(b.from, { month: 'short', day: 'numeric' }))} · Google Maps</small>` : ' <small>Google Maps</small>'}`, 'row-link')).join('')}
    ${jp ? `${ext('https://smart-ex.jp/en/', `${t('Shinkansen tickets (Tokaido, Sanyo, Kyushu)')} <small>SmartEX</small>`, 'row-link')}${ext('https://japanrailpass.net/en/', `${t('Japan Rail Pass')} <small>JR Group</small>`, 'row-link')}` : ''}</div>`;
}
function routeStaysHTML(cfg) {
  const ss = stopsOf(cfg); if (ss.length < 2) return '';
  const n = tripDates(cfg).guests || 2;
  return `<h3 class="sub-h">${t('Stays along the route')}</h3><div class="row-links">${ss.filter(s => s.from && s.to && s.to > s.from).map(s => { const q = [s.city || s.name, s.country].filter(Boolean).join(', '); const p = { q, d1: s.from, d2: s.to, n };
    return `<div class="row-link sp-row"><span><b>${esc(t('Hotels in {c}', { c: s.name }))}</b> <small>${esc(dateRange(s.from, s.to))}</small></span>${seePricesHTML({ city: s.city || s.name, country: s.country || '', d1: s.from, d2: s.to, n }, 'btn sm')}</div>`; }).join('')}</div>`;
}

// ================= Make it mine: one guest's dates and hotel over the shared page =================
// Everyone opens the same page; a guest's "Make it mine" (or one tap on an organizer's stay option, cfg.presets) keeps
// their arrive/leave days per page on this device ({ a, l, p } in localStorage, synced with My trip when signed in) and
// their hotel as an ordinary hotel booking (grp: 1) in My trip — so the Itinerary, Where to stay, the map and the
// Travel searches all use it. Shared days outside their stay are dimmed; their hotel replaces the room block line.
const mineKey = (cfg) => 'mine:' + syncKey(cfg);
const mineGet = (cfg) => { const m = cfg && cfg.start ? LS.get(mineKey(cfg)) : null; return m && isoDay(m.a) && isoDay(m.l) && m.l >= m.a ? m : null; };
function normPresets(xs) {
  if (!Array.isArray(xs)) return [];
  const num = (v) => typeof v === 'number' && isFinite(v); const seen = new Set();
  return xs.filter(x => x && typeof x === 'object').slice(0, 8).map((x, i) => {
    let id = typeof x.id === 'string' && /^[\w-]{1,24}$/.test(x.id) ? x.id : 'p' + i + Math.random().toString(36).slice(2, 6); if (seen.has(id)) id += i; seen.add(id);
    const h = x.h && typeof x.h === 'object' && String(x.h.name || '').trim() ? { name: String(x.h.name).trim().slice(0, 120), ...(x.h.address ? { address: String(x.h.address).slice(0, 200) } : {}), ...(num(x.h.lat) && num(x.h.lon) ? { lat: x.h.lat, lon: x.h.lon } : {}), ...hfPlain(hfOfEv(x.h)) } : null;
    return { id, a: isoDay(x.a), l: isoDay(x.l), ...(h ? { h } : {}) };
  });
}
// a hotel's fields as plain keys (only the filled ones): { room, cancelBy, nonRef, note }
const hfPlain = (h) => hfToObj({}, { room: String(h.room || '').slice(0, 80), beds: String(h.beds || '').slice(0, 60), cancelBy: hfCancelOk(h.cancelBy), nonRef: !!h.nonRef, note: String(h.note || '').slice(0, 1000) });
const presetsOf = (cfg) => normPresets(cfg.presets).filter(p => p.a && p.l && p.l >= p.a);
// on unless the organizer turned it off; a personal trip (no stay options) starts without it
const mineDefault = (cfg) => !isTrip(cfg) || presetsOf(cfg).length > 0;
const mineShown = (cfg) => cfg.off.mine != null ? !cfg.off.mine : mineDefault(cfg);
const mineOn = (cfg) => !!cfg.start && mineShown(cfg);
const mineRange = (a, l) => { const o = { weekday: 'short', month: 'short', day: 'numeric' }; return a === l ? fmt(a, o) : `${fmt(a, o)} – ${fmt(l, o)}`; };
const LODGE_KINDS = ['hotel', 'stay'];
// the guest's hotel: the one picked here, else their first booked hotel
function mineHotel(cfg) {
  const xs = itinLoad(cfg).filter(x => LODGE_KINDS.includes(x.kind) && String(x.name || '').trim() && !x.ph);
  return xs.find(x => x.grp) || xs.sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'))[0] || null;
}
// what Need to know shows instead of the room block when the guest stays elsewhere
function mineKnow(cfg) {
  if (!mineOn(cfg)) return null; const h = mineHotel(cfg); if (!h) return null;
  const d = typeData(cfg); if (d.blockHotel && nameLike(h.name, d.blockHotel)) return null;
  const a = bkDay(h.start), l = bkDay(h.end);
  return { name: h.name, when: a ? mineRange(a, l && l > a ? l : a) : '' };
}
// the hotels a guest can pick with one tap: the organizer's options, the room block, the one they have
function mineHotels(cfg) {
  const out = []; const add = (h, hf) => { if (h && String(h.name || '').trim() && !out.some(x => nameLike(x.name, h.name))) out.push({ name: h.name.trim(), address: h.address || '', ...(h.lat != null ? { lat: h.lat, lon: h.lon } : {}), ...hfPlain(hf || hfOfEv(h)) }); };
  presetsOf(cfg).forEach(p => add(p.h)); const d = typeData(cfg); if (d.blockHotel) add({ name: d.blockHotel }, hfOfBlock(d)); const mh = mineHotel(cfg); add(mh, mh && hfOfBk(mh));
  return out.slice(0, 6);
}
function mineSave(cfg, m, hotel) { // hotel: undefined keeps it (its dates follow), null drops the one picked here
  if (m) LS.set(mineKey(cfg), m); else LS.del(mineKey(cfg));
  let xs = LS.get(itinKey(cfg), null) ?? itinLoad(cfg); const old = xs.find(x => x.grp);
  if (!m || hotel !== undefined) {
    xs = xs.filter(x => !x.grp);
    if (m && hotel && String(hotel.name || '').trim()) { const h = { id: old && nameLike(old.name, hotel.name) ? old.id : 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: 'hotel', name: hotel.name.trim().slice(0, 120), address: hotel.address || '', ...(hotel.lat != null ? { lat: hotel.lat, lon: hotel.lon } : {}), start: m.a, end: m.l, grp: 1 };
      if (old && old.id === h.id) { if (old.det) h.det = { ...old.det }; ['confNo', 'via', 'viaOther', 'link', 'photos'].forEach(k => { if (old[k] != null) h[k] = old[k]; }); } // the same hotel keeps what was added to it
      { const hf = hfOfEv(hotel); if (hfAny(hf) || old) hfToBk(h, hf); if (!h.note) delete h.note; } // room, cancellation, notes
      xs = xs.filter(x => { const k = x.guess && LODGE.has(x.kind) ? bkMatch(cfg, x, h) : ''; if (k === 'same' && h.lat == null && x.lat != null) { h.lat = x.lat; h.lon = x.lon; if (x.ref) h.ref = x.ref; } return !k; }); xs.push(h); }
  } else if (old) { old.start = m.a; old.end = m.l; }
  itinSave(cfg, xs);
  if (LS.get('signedIn') && !cfg.demoTrip) syncPush(cfg);
}
const MINE_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/></svg>';
const HOTEL_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20V8l9-4 9 4v12"/><path d="M8 20v-5h8v5M8 11h2M14 11h2"/></svg>';
function mineBarHTML(cfg, dr, fresh) { // fresh: as a new guest sees it (the builder's on-page preview)
  const m = fresh ? null : mineGet(cfg); const ps = presetsOf(cfg); const h = mineHotel(cfg);
  const opt = (p, on) => `<button type="button" class="mi-opt${on ? ' on' : ''}" data-mine-pick="${esc(p.id)}" aria-pressed="${!!on}"><b>${esc(mineRange(p.a, p.l))}</b>${p.h ? `<span>${HOTEL_IC}${esc(p.h.name)}</span>` : ''}</button>`;
  if (!dr && m) return `<section class="mi-bar is-set" aria-label="${esc(t('Make it mine'))}"><button type="button" class="mi-sum" data-mine-edit>${MINE_IC}<span class="mi-tx"><span class="lbl">${t('Your stay')}</span><b>${esc(mineRange(m.a, m.l))}</b>${h ? `<span class="mi-h">${HOTEL_IC}${esc(h.name)}</span>` : ''}</span><i>${t('Edit')}</i></button></section>`;
  if (!dr) return `<section class="mi-bar" aria-label="${esc(t('Make it mine'))}">${ps.length ? `<p class="lbl">${t('Make it mine')}</p><div class="mi-opts">${ps.map(p => opt(p)).join('')}</div><button type="button" class="btn sm mi-go" data-mine-edit>${t('Other dates or hotel')}</button>` : `<button type="button" class="btn mi-go" data-mine-edit>${MINE_IC}${t('Make it mine')}</button>`}</section>`;
  const hs = mineHotels(cfg); const hotelOn = (x) => !!dr.h && nameLike(dr.h.name, x.name);
  return `<section class="mi-bar is-ed" aria-label="${esc(t('Make it mine'))}"><div class="mi-head"><b>${t('Make it mine')}</b><button type="button" class="x" data-mine-x aria-label="${esc(t('Close'))}">×</button></div>
    ${ps.length ? `<div class="mi-opts">${ps.map(p => opt(p, dr.p === p.id)).join('')}</div>` : ''}
    <div class="two"><div class="field"><label for="mi-a">${t('Arrive')}</label><input id="mi-a" type="date" data-mine-a value="${esc(dr.a)}"></div><div class="field"><label for="mi-l">${t('Leave')}</label><input id="mi-l" type="date" data-mine-l value="${esc(dr.l)}" min="${esc(dr.a || '')}"></div></div>
    <div class="field"><label for="mi-hq">${t('Hotel')}</label>${hs.length ? `<div class="chips mi-hs">${hs.map((x, i) => `<button type="button" class="chip${hotelOn(x) ? ' on' : ''}" data-mine-h="${i}" aria-pressed="${hotelOn(x)}">${esc(x.name)}</button>`).join('')}</div>` : ''}
      <input id="mi-hq" data-mine-hq value="${esc(dr.h && !hs.some(hotelOn) ? dr.h.name : '')}" placeholder="${esc(t('Other hotel'))}" autocomplete="off" maxlength="120"></div>
    ${dr.h ? hfFoldHTML(hfOfEv(dr.h), 'mi-hf', { note: true, attr: 'data-mine-hf' }) : ''}
    <div class="btns mi-btns"><button type="button" class="btn primary" data-mine-save>${t('Save')}</button>${cfg.tools.mytrip ? `<button type="button" class="btn" data-mine-up>${HOTEL_IC}${t('Upload confirmation')}</button>` : ''}${m ? `<button type="button" class="btn ghost" data-mine-clear>${t('Clear')}</button>` : ''}</div></section>`;
}
function wireMine(cfg, art, opts) {
  const slot = art.querySelector('[data-slot="mine"]'); if (!slot) return;
  if (opts.onpage) { slot.addEventListener('click', (e) => { if (!e.target.closest('button')) return; e.preventDefault(); e.stopPropagation(); if (typeof openCard === 'function') openCard('stays'); }, true); return; } // builder: tap → Stay options
  let dr = null; // the open editor's draft { a, l, p, h }
  const unpick = () => $$('[data-mine-h]', slot).forEach(b => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
  const paint = () => { slot.innerHTML = mineBarHTML(cfg, dr);
    const q = slot.querySelector('[data-mine-hq]'); if (q) placeAutocomplete(q, { bias: () => cfg.venue, onPick: (id, tok) => gpVenue(id, tok).then(r => { if (!dr) return; dr.h = { name: r.name, address: r.address || '', lat: r.lat, lon: r.lon }; dr.p = ''; q.value = r.name; unpick(); }).catch(() => {}) }); };
  const refreshDetails = () => { const det = art.querySelector('#sec-details > .sec-b'); if (det) det.innerHTML = needToKnowHTML(cfg); if (art._cx) art._cx(); };
  // a change to the guest's stay: everything that depends on it follows
  const after = () => { if (art._bkChanged) art._bkChanged(); else if (art._renderSchedule) art._renderSchedule(); refreshDetails(); if (art._refreshTrip) art._refreshTrip(); };
  const fromPreset = (p) => ({ a: p.a, l: p.l, p: p.id, h: p.h ? { ...p.h } : (dr && dr.h) || null });
  const open = () => { const m = mineGet(cfg); const h = mineHotel(cfg); const tr = tripDates(cfg);
    dr = { a: m ? m.a : tr.arrive, l: m ? m.l : tr.leave, p: m ? m.p || '' : '', h: h ? { name: h.name, address: h.address || '', ...(h.lat != null ? { lat: h.lat, lon: h.lon } : {}), ...hfPlain(hfOfBk(h)) } : null }; paint(); };
  const save = (x) => { const a = isoDay(x.a), l = isoDay(x.l); if (!a || !l) { toast(t('Add both dates')); return; }
    const m = { a: a <= l ? a : l, l: a <= l ? l : a, p: x.p || '' }; const had = mineHotel(cfg);
    mineSave(cfg, m, x.h ? x.h : had && had.grp ? null : undefined); dr = null; paint(); after(); };
  art._minePaint = () => { if (!dr) paint(); };
  slot.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.minePick) { const p = presetsOf(cfg).find(x => x.id === d.minePick); if (!p) return; if (dr) { dr = { ...dr, ...fromPreset(p) }; paint(); } else save(fromPreset(p)); }
    else if ('mineEdit' in d) open();
    else if ('mineX' in d) { dr = null; paint(); }
    else if (d.mineH != null && dr) { const x = mineHotels(cfg)[+d.mineH]; if (!x) return; dr.h = dr.h && nameLike(dr.h.name, x.name) ? null : { ...x }; dr.p = ''; paint(); }
    else if ('mineSave' in d && dr) { const q = slot.querySelector('[data-mine-hq]'); const typed = q ? q.value.trim() : ''; if (typed && !(dr.h && dr.h.name === typed)) dr.h = { name: typed, ...(dr.h ? hfPlain(hfOfEv(dr.h)) : {}) }; save(dr); }
    else if ('mineClear' in d) { dr = null; mineSave(cfg, null); paint(); after(); }
    else if ('mineUp' in d && dr) { // their confirmation: the dates now; the hotel (and its nights) once it is read
      const a = isoDay(dr.a), l = isoDay(dr.l); if (a && l) mineSave(cfg, { a: a <= l ? a : l, l: a <= l ? l : a, p: '' });
      art._mineUp = new Set(itinLoad(cfg).map(x => x.id)); dr = null; paint(); after();
      if (art._itinAdd) { showTab(art, 'mytrip', opts); art._itinAdd(); const f = art.querySelector('#sec-itinerary [data-slot="itin-form"]'); if (f) f.scrollIntoView({ block: 'start' }); } }
  });
  slot.addEventListener('input', (e) => { const i = e.target; if (!dr) return;
    if (i.dataset.hk) { const box = i.closest('[data-hfbox]'); if (box && dr.h) hfToObj(dr.h, hfRead(box)); return; } // the hotel's room, cancellation, notes
    if (i.matches('[data-mine-a]')) { dr.a = i.value; dr.p = ''; const l = slot.querySelector('[data-mine-l]'); if (l) { l.min = i.value; if (l.value && i.value && l.value < i.value) { l.value = i.value; dr.l = i.value; } } }
    else if (i.matches('[data-mine-l]')) { dr.l = i.value; dr.p = ''; }
    else if (i.matches('[data-mine-hq]')) { if (i.value.trim()) { unpick(); dr.h = { name: i.value.trim(), ...(dr.h ? hfPlain(hfOfEv(dr.h)) : {}) }; } dr.p = ''; }
    $$('[data-mine-pick]', slot).forEach(b => { b.classList.toggle('on', b.dataset.minePick === dr.p); b.setAttribute('aria-pressed', String(b.dataset.minePick === dr.p)); });
  });
  // a hotel confirmation added after "Upload confirmation" becomes their hotel, and its nights their stay
  const prev = art._renderSchedule;
  art._renderSchedule = () => { if (prev) prev();
    if (art._mineUp) { const nu = itinLoad(cfg).filter(x => LODGE_KINDS.includes(x.kind) && !x.grp && !x.ph && !art._mineUp.has(x.id));
      if (nu.length) { const h = nu[0]; art._mineUp = null; const a = bkDay(h.start), l = bkDay(h.end); const m = mineGet(cfg);
        const xs = LS.get(itinKey(cfg), null); if (xs && xs.some(x => x.grp)) itinSave(cfg, xs.filter(x => !x.grp));
        if (a) LS.set(mineKey(cfg), { a, l: l && l >= a ? l : m && m.l >= a ? m.l : a, p: '' });
        if (LS.get('signedIn') && !cfg.demoTrip) syncPush(cfg);
        const s2 = art.querySelector('#sec-itinerary .sec-b'); if (s2 && !s2.querySelector('.itin-sheet')) s2.innerHTML = bookingsHTML(cfg);
        if (prev) prev(); refreshDetails(); if (art._refreshTrip) art._refreshTrip(); } }
    if (art._minePaint) art._minePaint(); };
  paint();
}
// Builder → Stay options: the arrive/leave days and hotel a guest can take with one tap ("Thu, Jun 4 – Sun, Jun 7 · Hotel A")
COMMON_CARDS.splice(COMMON_CARDS.findIndex(x => x[0] === 'schedule') + 1, 0, ['stays', 'Stay options', 'Dates and hotels to pick']);
CARD_ICONS.stays = '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>';
function presetHotelChoices(c) {
  const out = []; const add = (h) => { if (h && String(h.name || '').trim() && !out.some(x => nameLike(x.name, h.name))) out.push({ ...h, name: h.name.trim() }); };
  const d = typeData(c); if (d.blockHotel) add({ name: d.blockHotel, ...hfPlain(hfOfBlock(d)) }); (c.presets || []).forEach(p => add(p.h));
  return out.slice(0, 6);
}
function presetsCardHTML(c) {
  const ps = c.presets || []; const hs = presetHotelChoices(c);
  return `${ps.map((p, i) => `<div class="rowed pr-row">
    <div class="two"><div class="field"><label for="pr-a-${i}">${t('Arrive')}</label><input id="pr-a-${i}" type="date" data-pr="${i}" data-k="a" value="${esc(p.a || '')}"></div><div class="field"><label for="pr-l-${i}">${t('Leave')}</label><input id="pr-l-${i}" type="date" data-pr="${i}" data-k="l" value="${esc(p.l || '')}" min="${esc(p.a || '')}"></div></div>
    ${hs.length ? `<div class="chips pr-hs">${hs.map((x, j) => `<button type="button" class="chip${p.h && nameLike(p.h.name, x.name) ? ' on' : ''}" data-pr-hotel="${i}" data-h="${j}">${esc(x.name)}</button>`).join('')}</div>` : ''}
    <input data-pr="${i}" data-k="h" value="${esc(p.h ? p.h.name : '')}" placeholder="${t('Hotel (optional)')}" aria-label="${t('Hotel')}" maxlength="120" autocomplete="off">
    ${p.h ? hfFoldHTML(hfOfEv(p.h), 'hf-pr' + i, { en: true, note: true, attr: `data-hf-pr="${i}"` }) : ''}
    <button type="button" class="ic del" data-pr-del="${i}" aria-label="${t('Remove')}">${t('Remove')}</button></div>`).join('')}
    <button type="button" class="btn sm" data-b="add-preset">${t('+ Add option')}</button>`;
}
function presetAdd(c) {
  const ps = (c.presets = Array.isArray(c.presets) ? c.presets : []); if (ps.length >= 8) return;
  const s = (c.start || '').slice(0, 10), e = (c.end || c.start || '').slice(0, 10); const last = ps[ps.length - 1]; const d = typeData(c);
  ps.push({ id: 'p' + Date.now().toString(36).slice(-5), a: s ? addDays(s, -1) : '', l: e ? addDays(e, 1) : '', ...(last && last.h ? { h: { ...last.h } } : d.blockHotel ? { h: { name: d.blockHotel } } : {}) });
}
function presetInput(c, i, k, v) {
  const p = (c.presets || [])[i]; if (!p) return;
  if (k === 'a' || k === 'l') p[k] = isoDay(v);
  else if (k === 'h') { const n = String(v || '').trim().slice(0, 120); if (n) p.h = { name: n, ...(p.h ? hfPlain(hfOfEv(p.h)) : {}) }; else delete p.h; }
}
function wirePresetAC() {
  $$('#sheet [data-pr][data-k="h"]').forEach(inp => placeAutocomplete(inp, { bias: () => B.cfg.venue, onPick: (id, tok) => gpVenue(id, tok).then(r => { const p = (B.cfg.presets || [])[+inp.dataset.pr]; if (!p) return; p.h = { name: r.name, ...(r.address ? { address: r.address } : {}), ...(r.lat != null ? { lat: r.lat, lon: r.lon } : {}), ...(p.h ? hfPlain(hfOfEv(p.h)) : {}) }; changed(true); }).catch(() => toast(t('Couldn’t load that place'))) }));
}

// ================= personal itinerary ↔ account (trip_items; quiet no-op until schema-2 is installed) =================
const syncKey = (cfg) => eventKey(cfg).slice(6);
const syncOff = () => { const o = LS.get('syncOff'); return o && Date.now() - o < 3600e3; };
const tableMissing = (e) => e && (e.code === 'PGRST205' || e.code === '42P01' || /does not exist|schema cache/i.test(e.message || ''));
function withIds(cfg) { // bookings had no ids before sync existed
  const xs = itinLoad(cfg); let ch = false; xs.forEach(x => { if (!x.id) { x.id = 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); ch = true; } }); if (ch) LS.set(itinKey(cfg), xs); return xs;
}
async function syncUser() { if (!SB || !LS.get('signedIn') || syncOff()) return null; try { return await sbUser(); } catch { return null; } }
const syncPush = debounce(async (cfg) => {
  if (cfg.demoTrip) return; // example page: its sample My trip stays out of the visitor's account
  const u = await syncUser(); if (!u) return; const c = await sb(); const key = syncKey(cfg);
  const rows = withIds(cfg).map(x => ({ id: x.id, page_key: key, kind: 'booking', item: x, updated_at: new Date().toISOString() }))
    .concat(planLoad(cfg).map(x => ({ id: x.id, page_key: key, kind: 'place', item: x, updated_at: new Date().toISOString() })))
    .concat(shopLoad(cfg).map(x => ({ id: x.id, page_key: key, kind: 'place', item: { ...x, shop: true }, updated_at: new Date().toISOString() })))
    .concat(LS.get(cxKey(cfg)) ? [{ id: 'ui-' + key, page_key: key, kind: 'place', item: { secui: true, ...LS.get(cxKey(cfg)) }, updated_at: new Date().toISOString() }] : [])
    .concat(mineGet(cfg) ? [{ id: 'mine-' + key, page_key: key, kind: 'place', item: { mine: true, ...mineGet(cfg) }, updated_at: new Date().toISOString() }] : []) // Make it mine: their days
    .concat(Object.keys(ovLoad(cfg).it).length || LS.get('shIn:' + key) ? [{ id: 'ov-' + key, page_key: key, kind: 'place', item: { ov: true, it: ovLoad(cfg).it, t: ovLoad(cfg).t || 0, shIn: LS.get('shIn:' + key) || '' }, updated_at: new Date().toISOString() }] : []); // their personal copy + the shared trip they follow
  if (rows.length) { const { error } = await c.from('trip_items').upsert(rows, { onConflict: 'owner,id' }); if (tableMissing(error)) { LS.set('syncOff', Date.now()); return; } }
  let q = c.from('trip_items').delete().eq('page_key', key); if (rows.length) q = q.not('id', 'in', `(${rows.map(r => '"' + r.id.replace(/"/g, '') + '"').join(',')})`);
  await q;
}, 800);
async function syncPull(cfg, art) {
  if (cfg.demoTrip) return;
  const u = await syncUser(); if (!u) return; const c = await sb(); const key = syncKey(cfg);
  const { data, error } = await c.from('trip_items').select('id,page_key,kind,item,source').in('page_key', [key, 'inbox']);
  if (error) { if (tableMissing(error)) LS.set('syncOff', Date.now()); return; }
  const mine = (data || []).filter(r => r.page_key === key); const inbox = (data || []).filter(r => r.page_key === 'inbox');
  const bk = withIds(cfg), pl = planLoad(cfg), sh = shopLoad(cfg); const have = new Set(bk.map(x => x.id).concat(pl.map(x => x.id), sh.map(x => x.id), LS.get(goneKey(cfg)) || [])); let added = 0; // merged-away / deleted ids stay gone
  const fw = []; // bookings forwarded by email (the inbound function), still as ai-import read them
  let ovNew = false;
  mine.forEach(r => { if (r.item && r.item.ov === true) { const o = ovLoad(cfg); const it = r.item.it && typeof r.item.it === 'object' ? r.item.it : {};
      if ((+r.item.t || 0) > (+o.t || 0)) { LS.set(ovKey(cfg), { it, t: +r.item.t }); ovNew = true; } // the newer copy wins (another device)
      if (/^[a-f0-9]{32}$/.test(r.item.shIn || '') && !LS.get('shIn:' + key) && !(LS.get('shOut:' + key) || {}).tok) LS.set('shIn:' + key, r.item.shIn); return; }
    if (r.item && r.item.mine === true) { if (!LS.get(mineKey(cfg))) { const { mine: _, ...m } = r.item; LS.set(mineKey(cfg), m); added++; } return; }
    if (r.item && r.item.secui) { if (!LS.get(cxKey(cfg))) { const { secui, ...ui } = r.item; LS.set(cxKey(cfg), ui); art._cx && art._cx(); } return; } if (have.has(r.id) || !r.item) return; if (r.item.inbound) { const x = inbItem(r); if (x) fw.push(x); return; } if (r.kind === 'place' && r.item.shop) { const { shop, ...x } = r.item; sh.push({ ...x, id: r.id }); } else if (r.kind === 'place') pl.push({ ...r.item, id: r.id }); else bk.push({ ...r.item, id: r.id }); added++; });
  if (added) { LS.set(shopKey(cfg), sh); art._shop && art._shop(); LS.set(itinKey(cfg), bk); LS.set(planKey(cfg), pl); bkClean(cfg); art._planChanged && art._planChanged(); const s2 = art.querySelector('#sec-itinerary .sec-b'); if (s2) s2.innerHTML = bookingsHTML(cfg); art._renderSchedule && art._renderSchedule(); }
  if (fw.length) { await bkSave(cfg, art, fw, null); const s2 = art.querySelector('#sec-itinerary .sec-b'); if (s2) s2.innerHTML = bookingsHTML(cfg); art._renderSchedule && art._renderSchedule(); }
  const gone = new Set(LS.get(goneKey(cfg)) || []);
  if (added || fw.length || !mine.length || mine.some(r => gone.has(r.id))) syncPush(cfg); // first sync uploads what this device already had; rows merged away here are deleted there
  if (ovNew && art._rerender) setTimeout(() => art._rerender(), 0); // their personal copy changed on another device
  const slot = art.querySelector('#sec-plan .sec-b');
  const adds = inbox.map(inbItem).filter(Boolean);
  if (adds.length && slot) { // Inbox: forwarded bookings no trip's dates matched — one tap puts them in this one
    slot.insertAdjacentHTML('afterbegin', `<div class="inbox-note"><b>${esc(adds.length === 1 ? t('1 forwarded booking') : t('{n} forwarded bookings', { n: adds.length }))}</b><ul class="inbox-l">${adds.slice(0, 6).map(x => `<li>${esc([x.name || t(ITIN_KINDS[x.kind] || 'Booking'), inbWhen(x)].filter(Boolean).join(' · '))}</li>`).join('')}</ul><button type="button" class="btn sm" data-inbox-add>${t('Add to this trip')}</button></div>`);
    const note = slot.querySelector('.inbox-note');
    note.querySelector('[data-inbox-add]').onclick = async (e) => {
      e.target.disabled = true;
      await c.from('trip_items').delete().in('id', inbox.map(r => r.id)); // re-saved under this trip by the push below (merged-away ones stay gone)
      note.remove(); await bkSave(cfg, art, adds, null); syncPush(cfg);
      art._planChanged && art._planChanged(); const s2 = art.querySelector('#sec-itinerary .sec-b'); if (s2) s2.innerHTML = bookingsHTML(cfg); art._renderSchedule && art._renderSchedule();
    };
  }
}

// ================= Personal copy + "Share my trip" (Dylan 11/25) =================
// A guest's view of a page = the organizer's plan + their own overlay (ov:<key>): they can edit an organizer's item (their
// version replaces it, with their confirmation #), hide it, or add their own (My trip). The organizer's adds and changes
// flow through; an item they edited that the organizer changed since keeps their version and asks "Updated — use the new
// one?". Private to them: this device, and their account (a trip_items row, owner-only) when signed in.
// Schedule items carry a stable id (normalize → schedIds); an entry whose item lost its id finds it again by its old title.
const OV_F = ['title', 'date', 'time', 'note'];
const ovKey = (cfg) => 'ov:' + syncKey(cfg);
const ovPick = (x) => { const o = {}; OV_F.forEach(k => { o[k] = String((x && x[k]) || ''); }); return o; };
const ovSame = (a, b) => OV_F.every(k => String((a && a[k]) || '') === String((b && b[k]) || ''));
function ovLoad(cfg) { const o = LS.get(ovKey(cfg)); return o && typeof o === 'object' && o.it && typeof o.it === 'object' ? o : { it: {} }; }
function ovSave(cfg, o) { o.t = Date.now(); if (!Object.keys(o.it).length) LS.del(ovKey(cfg)); else LS.set(ovKey(cfg), o); if (typeof syncPush === 'function' && LS.get('signedIn')) syncPush(cfg); }
// the page's schedule with one guest's overlay on it. src: the same items as written (the guest may read a translation;
// "changed since" compares the organizer's own words). → { sched, hidden, upd }
function ovApply(sched, ov, src) {
  const it = (ov && ov.it) || {}; const ids = new Set(sched.map(x => x.id)); const orig = new Map((src || sched).map(x => [x.id, x]));
  const alias = {}; const taken = new Set();
  Object.entries(it).forEach(([id, o]) => { if (ids.has(id) || !o || !o.b || !o.b.title) return;
    const m = (src || sched).filter(x => !it[x.id] && !taken.has(x.id) && x.title === o.b.title); if (m.length === 1) { alias[id] = m[0].id; taken.add(m[0].id); } });
  const by = {}; Object.entries(it).forEach(([id, o]) => { if (o) by[alias[id] || id] = { ...o, key: id }; });
  const out = [], hidden = []; let upd = 0;
  sched.forEach(x => {
    const o = by[x.id]; if (!o) { out.push(x); return; }
    if (o.h) { hidden.push(x); return; }
    if (!o.e || !Object.keys(o.e).length) { out.push(x); return; }
    const org = ovPick(orig.get(x.id) || x); const mine = OV_F.some(k => k in o.e); const u = mine && !!o.b && !ovSame(o.b, org); if (u) upd++;
    out.push({ ...x, ...o.e, _ov: { id: o.key, upd: u, mine, org } });
  });
  return { sched: out, hidden, upd };
}
// one change to one entry (fn gets a copy, returns the new entry; an empty one is dropped)
function ovSet(cfg, id, fn) {
  const o = ovLoad(cfg); const nx = fn({ ...(o.it[id] || {}) });
  if (nx && nx.e) Object.keys(nx.e).forEach(k => { if (nx.e[k] === undefined) delete nx.e[k]; });
  if (nx && (nx.h || (nx.e && Object.keys(nx.e).length))) o.it[id] = nx; else delete o.it[id];
  ovSave(cfg, o);
}
// the organizer's own bookings written on the plan (a hotel check-in / stay / check-out line, a flight line with airport codes)
const orgBookingLine = (x) => !!x && ((hotelCiLine(x) && /^\s*check[- ]?in\s*([:\-–—·]|at\b)/i.test(x.title || '')) || hotelFreeLine(x) || (!!hotelCoName(x) && /^\s*check[- ]?out\s*[:\-–—·]/i.test(x.title || '')) || !!schedAirport(x));
// What a page shows, before the tabs are drawn. Type rule (Dylan 11/25): a Trip's plan includes the organizer's hotels and
// flights; every other type (wedding, conference, race…) shows the event schedule only: the organizer's own bookings
// stay theirs (their page marks them "Only you") and travel only through Share my trip. A guest also gets their overlay.
function guestView(cfg, opts) {
  const c = { ...cfg, schedule: (cfg.schedule || []).slice() };
  if (!isTrip(c)) c.schedule = c.schedule.filter(x => !orgBookingLine(x));
  // the invite link, any type: the organizer's hotels are suggestions, never the guest's own until they choose one
  // (examples / demo trips keep their sample bookings as they are)
  if (!opts.exampleId && !cfg.demoTrip) c._sug = true;
  if (!opts.preview && !opts.onpage && !opts.exampleId && !cfg.demoTrip) {
    const src = opts.src && Array.isArray(opts.src.schedule) ? opts.src.schedule : null;
    const r = ovApply(c.schedule, ovLoad(c), src); c.schedule = r.sched; c._ovHidden = r.hidden.length; c._gv = true;
  }
  return c;
}
const ovSum = (o) => [o.date ? fmt(o.date, { weekday: 'short', month: 'short', day: 'numeric' }) : '', o.time ? fmtTime(o.time) : '', o.title].filter(Boolean).join(' · ');
function ovTopHTML(x) {
  const o = x && x._ov; if (!o || !o.upd) return '';
  return `<div class="ov-p" role="status"><b>${esc(t('Updated — use the new one?'))}</b><span class="ov-p-n">${esc(ovSum(o.org))}</span><div class="ov-p-b"><button type="button" class="btn sm primary" data-ov-use="${esc(o.id)}">${esc(t('Use new'))}</button><button type="button" class="btn sm ghost" data-ov-keep="${esc(o.id)}">${esc(t('Keep mine'))}</button></div></div>`;
}
function ovActsHTML(x) {
  const o = x._ov; const id = o ? o.id : x.id;
  return `<div class="ds-acts ov-acts">${x.conf ? `<p class="ov-conf"><span>${esc(t('Your confirmation'))}</span><b>${esc(x.conf)}</b></p>` : ''}<button type="button" class="btn sm" data-ov-edit="${esc(id)}">${esc(t('Edit'))}</button><button type="button" class="btn sm ghost" data-ov-hide="${esc(id)}">${esc(t('Hide'))}</button>${o && o.mine && !o.upd ? `<button type="button" class="btn sm ghost" data-ov-use="${esc(id)}">${esc(t('Undo my changes'))}</button>` : ''}</div>`;
}
function ovFormHTML(x) {
  const o = x._ov; const id = o ? o.id : x.id; const f = (k, label, inp) => `<div class="field"><label for="ov-${k}">${esc(t(label))}</label>${inp}</div>`;
  return `<div class="ov-f" data-ov-form="${esc(id)}">
    ${f('title', 'Title', `<input id="ov-title" data-ovk="title" maxlength="120" value="${esc(x.title || '')}">`)}
    <div class="two">${f('date', 'Date', `<input id="ov-date" type="date" data-ovk="date" value="${esc(x.date || '')}">`)}${f('time', 'Time', `<input id="ov-time" type="time" data-ovk="time" value="${esc(x.time || '')}">`)}</div>
    ${f('conf', 'Confirmation', `<input id="ov-conf" data-ovk="conf" maxlength="60" autocomplete="off" value="${esc(x.conf || '')}">`)}
    ${f('note', 'Notes', `<textarea id="ov-note" data-ovk="note" rows="3" maxlength="600">${esc(x.note || '')}</textarea>`)}
    <p class="muted small ov-priv">${esc(t('Only you see your changes.'))}</p>
    <div class="btns"><button type="button" class="btn primary" data-ov-save="${esc(id)}">${esc(t('Save'))}</button><button type="button" class="btn ghost" data-ov-cancel>${esc(t('Cancel'))}</button></div></div>`;
}
// the organizer's item as written, by overlay id (the page's source items; a translated view keeps ids)
const ovOrg = (cfg, src, id) => { const xs = (src && src.schedule) || []; return xs.find(x => x.id === id) || (cfg.schedule || []).find(x => x.id === id || (x._ov && x._ov.id === id)) || null; };
// the sheet's buttons for an organizer's item (guest view)
function ovSheetClick(cfg, art, d, b) {
  const src = art._src || cfg; const rr = () => art._rerender && art._rerender();
  if (b.dataset.ovEdit) { const x = cfg.schedule.find(y => (y._ov ? y._ov.id : y.id) === b.dataset.ovEdit); const body = d.querySelector('.ds-b'); if (!x || !body) return true; body.innerHTML = ovFormHTML(x); body.querySelector('#ov-title')?.focus(); return true; }
  if ('ovCancel' in b.dataset) { dsRefresh(art); return true; }
  if (b.dataset.ovSave) {
    const id = b.dataset.ovSave; const org0 = ovOrg(cfg, src, id); const cur0 = cfg.schedule.find(y => (y._ov ? y._ov.id : y.id) === id);
    const org = cur0 && cur0._ov ? cur0._ov.org : ovPick(org0); const v = {}; $$('[data-ovk]', d).forEach(el => { v[el.dataset.ovk] = String(el.value || '').trim(); });
    ovSet(cfg, id, (e) => { const ed = {}; OV_F.forEach(k => { if (v[k] !== org[k]) ed[k] = k === 'title' ? v[k].slice(0, 120) : k === 'note' ? v[k].slice(0, 600) : v[k]; });
      if (ed.date !== undefined && !isoDay(ed.date)) delete ed.date; if (ed.time !== undefined && ed.time && !isoTime(ed.time)) delete ed.time; if (ed.title === '') delete ed.title;
      if (v.conf) ed.conf = v.conf.slice(0, 60); return { ...e, e: ed, b: org }; });
    rr(); toast(t('Saved')); return true;
  }
  if (b.dataset.ovHide) { const id = b.dataset.ovHide; const org0 = ovOrg(cfg, src, id); ovSet(cfg, id, (e) => ({ ...e, h: 1, b: e.b || ovPick(org0) })); dsClose(art); art._rerender && art._rerender(true);
    toastAction(t('Hidden'), t('Undo'), () => { ovSet(cfg, id, (e) => { delete e.h; return e; }); art._rerender && art._rerender(true); }); return true; }
  if (b.dataset.ovUse) { const id = b.dataset.ovUse; const org0 = ovOrg(cfg, src, id); ovSet(cfg, id, (e) => { const ed = { ...(e.e || {}) }; OV_F.forEach(k => delete ed[k]); return { ...e, e: ed, b: ovPick(org0) }; }); rr(); return true; }
  if (b.dataset.ovKeep) { const id = b.dataset.ovKeep; const cur0 = cfg.schedule.find(y => y._ov && y._ov.id === id); ovSet(cfg, id, (e) => ({ ...e, b: cur0 ? cur0._ov.org : e.b })); rr(); return true; }
  return false;
}
// "Show hidden (N)" under the schedule (one control brings them all back)
const ovHiddenHTML = (cfg) => cfg._gv && cfg._ovHidden ? `<button type="button" class="mini-b ov-show" data-ov-show>${esc(t('Show hidden ({n})', { n: cfg._ovHidden }))}</button>` : '';
function ovShowAll(cfg) { const o = ovLoad(cfg); Object.keys(o.it).forEach(id => { delete o.it[id].h; if (!o.it[id].e || !Object.keys(o.it[id].e).length) delete o.it[id]; }); ovSave(cfg, o); }
// a schedule row's tag: their version, or theirs with a newer one from the organizer
const ovRowTag = (cfg, x) => { const ev = x.ev ? cfg.schedule[x.si] : null; const sh = (x.bk && x.bk.sh) || x.sh;
  if ((ev && ev._ov && ev._ov.upd) || (sh && sh.n)) return ` <em class="ov-upd">${esc(t('Updated'))}</em>`;
  if (ev && ev._ov && ev._ov.mine) return ` <em class="yours">${esc(t('Edited'))}</em>`;
  const hn = ev && hotelStayLine(ev) ? (hotelCiLine(ev) ? hostHotelName(ev.title) : freeHotelName(ev.title)) : ''; // an undecided stay ("ryokan, not chosen yet") suggests nothing
  if (cfg._sug && hn && !x.bk && !bookingForHotel(cfg, hn)) return ` <em class="sug-tag">${esc(t('Suggested'))}</em>`; // the plan's hotel, not the guest's until they choose it
  return ONP && ev && !isTrip(cfg) && orgBookingLine(ev) ? ` <em class="yours ov-only">${esc(t('Only you'))}</em>` : ''; };

// ---- Share my trip: a revocable link to the sharer's own bookings and planned places for this page ----
// trip_shares (schema-5): one row per person per page, data = their My trip, kept current by their app; the link is
// ?e=<slug>&s=<token>. Anyone with it gets the page's plan (live, as every guest) plus those bookings, copied into their own
// My trip as the base of their personal copy: unchanged items follow the sharer's changes; items they changed keep their
// version and ask "Updated — use the new one?"; items they removed stay removed. Stop sharing deletes the row: the link
// reads nothing and copies stop updating.
const SH_DROP = new Set(['sh', 'photos', 'inbound', 'ai']);
const SH_SKIP = new Set(['id', 'sh', 'photos', 'lat', 'lon']); // compared content: what the person sees and edits
const shCanon = (v) => Array.isArray(v) ? `[${v.map(shCanon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined && v[k] !== '' && v[k] !== null).map(k => JSON.stringify(k) + ':' + shCanon(v[k])).join(',')}}` : JSON.stringify(v);
const shSnap = (x) => { const o = {}; Object.keys(x || {}).forEach(k => { if (!SH_DROP.has(k) && k !== 'id' && !k.startsWith('_')) o[k] = x[k]; }); return o; };
const shCmp = (x) => { const o = {}; Object.keys(x || {}).forEach(k => { if (!SH_SKIP.has(k) && !k.startsWith('_')) o[k] = x[k]; }); return shCanon(o); };
const shEq = (a, b) => shCmp(a) === shCmp(b);
const shId = (tok, id) => 'sh' + String(tok).slice(0, 8) + '-' + String(id).replace(/[^\w-]/g, '').slice(0, 40);
// three-way merge of one list (bookings or planned places): own = the recipient's list, shared = the sharer's now
function shareMerge(own, shared, tok, gone) {
  const g = new Set(gone || []); const out = []; let added = 0, updated = 0, pending = 0;
  const src = new Map((shared || []).filter(s => s && s.id != null).map(s => [String(s.id), s])); const seen = new Set();
  (own || []).forEach(x => {
    if (!x || !x.sh || x.sh.t !== tok) { out.push(x); return; }
    const s = src.get(x.sh.id); seen.add(x.sh.id); const edited = !shEq(x, x.sh.b);
    if (!s) { if (edited) { const { sh, ...y } = x; out.push(y); } return; } // the sharer removed it: it goes too, unless they made it theirs
    if (shEq(s, x.sh.b)) { if (x.sh.n) { const y = { ...x, sh: { ...x.sh } }; delete y.sh.n; out.push(y); } else out.push(x); return; }
    if (!edited) { updated++; out.push({ ...shSnap(s), id: x.id, sh: { t: tok, id: x.sh.id, b: shSnap(s) } }); return; }
    if (shEq(s, x)) { out.push({ ...x, sh: { t: tok, id: x.sh.id, b: shSnap(s) } }); return; } // their change is the new version
    pending++; out.push({ ...x, sh: { ...x.sh, n: shSnap(s) } });
  });
  src.forEach((s, id) => { if (seen.has(id)) return; const nid = shId(tok, id); if (g.has(nid) || out.some(y => y && y.id === nid)) return; added++; out.push({ ...shSnap(s), id: nid, sh: { t: tok, id, b: shSnap(s) } }); });
  return { list: out, added, updated, pending };
}
// the recipient's lists after a fetch of the shared trip (d = its data)
function shareApply(cfg, d, tok) {
  const key = syncKey(cfg); const bk = LS.get(itinKey(cfg), null) || []; const pl = LS.get(planKey(cfg), null) || [];
  const present = new Set(bk.concat(pl).map(x => x && x.id)); const had = LS.get('shIds:' + key) || [];
  const gone = new Set((LS.get('shGone:' + key) || []).concat(had.filter(id => !present.has(id)))); // removed here: stays removed
  const ok = (xs) => (Array.isArray(xs) ? xs : []).filter(x => x && typeof x === 'object' && x.id != null).slice(0, 300);
  const a = shareMerge(bk, ok(d && d.bk), tok, gone), b = shareMerge(pl, ok(d && d.pl), tok, gone);
  LS.set(itinKey(cfg), a.list); LS.set(planKey(cfg), b.list);
  LS.set('shGone:' + key, [...gone].slice(-300)); LS.set('shIds:' + key, a.list.concat(b.list).filter(x => x && x.sh).map(x => x.id));
  if (LS.get('signedIn')) syncPush(cfg);
  return { added: a.added + b.added, updated: a.updated + b.updated, pending: a.pending + b.pending };
}
// unfollow (or the link was turned off): copies stay, as the recipient's own
function shareUnfollow(cfg) {
  const key = syncKey(cfg); const strip = (xs) => xs.map(x => { if (!x || !x.sh) return x; const { sh, ...y } = x; return y; });
  LS.set(itinKey(cfg), strip(LS.get(itinKey(cfg), null) || [])); LS.set(planKey(cfg), strip(LS.get(planKey(cfg), null) || []));
  ['shIn:', 'shFrom:', 'shIds:', 'shGone:'].forEach(p => LS.del(p + key)); if (LS.get('signedIn')) syncPush(cfg);
}
const shareFetch = (tok) => rest('rpc/trip_share_get', { method: 'POST', body: { tok } }).then(r => Array.isArray(r) && r[0] ? r[0] : null);
// a guest opening the page: follow the shared trip they came with (or follow before), merged before the page is drawn
async function shareFollow(cfg, hosted, arrived) {
  const key = syncKey(cfg); const tok = LS.get('shIn:' + key); if (!tok || !SB || cfg.demoTrip) return null;
  const out = LS.get('shOut:' + key); if (out && out.tok === tok) { LS.del('shIn:' + key); return null; } // their own link
  let row; try { row = await Promise.race([shareFetch(tok), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))]); } catch { return null; } // offline / slow: last copy stays
  if (!row || (hosted && row.event_id !== hosted.id)) { shareUnfollow(cfg); if (arrived) toast(t('This shared trip link was turned off.')); return null; }
  LS.set('shFrom:' + key, String(row.name || '').slice(0, 60));
  const r = shareApply(cfg, row.data || {}, tok);
  if (arrived && r.added) toast(row.name ? t('Added {n} from {s}’s trip', { n: r.added, s: row.name }) : t('Added {n} from a shared trip', { n: r.added }));
  return r;
}
function shFromHTML(cfg) {
  const key = syncKey(cfg); if (!LS.get('shIn:' + key)) return '';
  const n = LS.get('shFrom:' + key) || '';
  return `<div class="shr-from" data-slot="shr-from"><span class="shr-dot" aria-hidden="true"></span><b>${esc(n ? t('{s}’s trip', { s: n }) : t('Shared trip'))}</b><span class="muted">${esc(t('Live'))}</span><button type="button" class="mini-b" data-shr-unfollow>${esc(t('Unfollow'))}</button></div>`;
}
// the "Updated — use the new one?" prompt on a shared booking / planned place's sheet
function shTopHTML(x, k) {
  if (!x || !x.sh || !x.sh.n) return '';
  const n = x.sh.n; const when = n.start ? dsDay(n.start) + (dsTm(n.start) ? ' · ' + dsTm(n.start) : '') : n.day ? dsDay(n.day) + (n.time ? ' · ' + fmtTime(n.time) : '') : '';
  return `<div class="ov-p" role="status"><b>${esc(t('Updated — use the new one?'))}</b><span class="ov-p-n">${esc([n.name, when, n.confNo ? t('Conf. {n}', { n: n.confNo }) : ''].filter(Boolean).join(' · '))}</span><div class="ov-p-b"><button type="button" class="btn sm primary" data-sh-use="${k}:${esc(x.id)}">${esc(t('Use new'))}</button><button type="button" class="btn sm ghost" data-sh-keep="${k}:${esc(x.id)}">${esc(t('Keep mine'))}</button></div></div>`;
}
const dsInsTop = (html, top) => top ? html.replace('<div class="ds-b">', '<div class="ds-b">' + top) : html;
function shSheetClick(cfg, art, b) {
  const v = b.dataset.shUse || b.dataset.shKeep; if (!v) return false;
  const [k, id] = v.split(/:(.+)/); const lk = k === 'pl' ? planKey(cfg) : itinKey(cfg); const xs = LS.get(lk, null) || []; const i = xs.findIndex(x => x && x.id === id); if (i < 0 || !xs[i].sh || !xs[i].sh.n) return true;
  const x = xs[i]; xs[i] = b.dataset.shUse ? { ...x.sh.n, id: x.id, sh: { t: x.sh.t, id: x.sh.id, b: x.sh.n } } : { ...x, sh: { t: x.sh.t, id: x.sh.id, b: x.sh.n } };
  LS.set(lk, xs); if (LS.get('signedIn')) syncPush(cfg);
  if (k === 'pl') { art._planChanged && art._planChanged(); } else { bkChanged(art); const s2 = art.querySelector('#sec-itinerary .sec-b'); if (s2) s2.innerHTML = bookingsHTML(cfg); }
  art._renderSchedule && art._renderSchedule(); dsRefresh(art); return true;
}
// ---- the sharer's side ----
var SH_CFG = {}; // page key → { cfg, owner }: the page as last shown, for the copy that goes out
// what goes out: their bookings and planned places (photos and their own personal-copy bookkeeping stay home); the organizer
// of a non-Trip page adds the bookings written on their plan (the type rule keeps those off the page itself)
function shareData(cfg, owner) {
  const clean = (x) => { const o = {}; Object.keys(x || {}).forEach(k => { if (!SH_DROP.has(k) && !k.startsWith('_')) o[k] = x[k]; }); return o; };
  const bk = (LS.get(itinKey(cfg), null) || []).filter(x => x && x.id).map(clean);
  const pl = (LS.get(planKey(cfg), null) || []).filter(x => x && x.id && x.day).map(clean);
  // A Trip's plan shows its check-in rows to everyone only as suggestions, so the organizer's hotels travel here too: the
  // recipient gets them pre-selected (their booking folds into the plan's check-in row as theirs). Flights on a Trip's
  // plan are already the shared schedule; an undecided stay line ("ryokan, not chosen yet") names no hotel.
  if (owner) { const sch = cfg.schedule || []; const trip = isTrip(cfg);
    // a stay they also booked themselves (same check-in day, or the same hotel) goes once: their booking
    const booked = (x) => { const n = hotelCiLine(x) ? hostHotelName(x.title) : freeHotelName(x.title) || x.title; return bk.some(b => LODGE.has(b.kind) && (bkDay(b.start) === x.date || (b.name && nameLike(b.name, n)))); };
    sch.filter(x => x.date && x.id && (trip ? hotelStayLine(x) && (!hotelFreeLine(x) || freeHotelName(x.title)) : hotelStayLine(x) || schedAirport(x)) && !(hotelStayLine(x) && booked(x))).forEach(x => bk.push(hotelStayLine(x)
      ? { id: 'ev-' + x.id, kind: 'hotel', name: hotelCiLine(x) ? hostHotelName(x.title) : x.title, start: x.date + (x.time ? 'T' + x.time : ''), end: hostStay(cfg, sch, x)[1], ...(x.note ? { note: x.note } : {}) }
      : { id: 'ev-' + x.id, kind: 'flight', name: x.title, start: x.date + (x.time ? 'T' + x.time : ''), ...(x.note ? { note: x.note } : {}) })); }
  return { v: 1, bk: bk.slice(0, 200), pl: pl.slice(0, 300) };
}
const shName = (u) => { const m = (u && u.user_metadata) || {}; return String(m.full_name || m.name || '').trim().split(/\s+/)[0].slice(0, 60); };
const sharePush = debounce(async (key) => {
  const o = LS.get('shOut:' + key); const s = SH_CFG[key]; if (!o || !o.tok || !s || !LS.get('signedIn') || !SB) return;
  try { const c = await sb(); const { data, error } = await c.from('trip_shares').update({ data: shareData(s.cfg, s.owner) }).eq('token', o.tok).select('token');
    if (!error && Array.isArray(data) && !data.length) LS.del('shOut:' + key); } catch { /* next change tries again */ } // turned off on another device
}, 1500);
const shareNote = (cfg, owner) => { SH_CFG[syncKey(cfg)] = { cfg, owner: !!owner }; };
const shareTouched = (k) => { const m = /^(?:itin|plan):(.+)$/.exec(k); if (m && SH_CFG[m[1]] && LS.get('shOut:' + m[1])) sharePush(m[1]); };
window.__shTouch = shareTouched;
// The Share sheet: two choices, side by side. "Invite guests" = the page's link (the plan; everyone picks their own hotels
// and flights). "Share my trip" = the plan + your bookings, live, revocable. ctx: { cfg, eid, slug, url, owner }
function shrSegHTML(on) {
  return `<div class="shr-seg" role="tablist" aria-label="${esc(t('Share'))}">${[['plan', 'Invite guests'], ['trip', 'Share my trip']].map(([k, l]) => `<button type="button" role="tab" data-shr-tab="${k}" aria-selected="${on === k}">${esc(t(l))}</button>`).join('')}</div>`;
}
const SHR_SUB = { plan: 'The plan. Everyone picks their own hotels and flights.', trip: 'The plan with your bookings. Updates live.' };
function shrTripHTML(st) {
  const sub = `<p class="shr-sub">${esc(t(SHR_SUB.trip))}</p>`;
  if (st.s === 'busy') return `${sub}<p class="shr-st" role="status">${esc(t('Making your link…'))}</p>`;
  if (st.s === 'signin') return `${sub}<div class="bk-signin shr-signin"><p><b>${esc(t('Sign in to share your trip.'))}</b></p>${signInFormHTML('', LS.get('signinEmail') || '')}</div>`;
  if (st.s === 'off') return `${sub}<p class="shr-st">${esc(t('Link turned off.'))}</p><div class="btns"><button type="button" class="btn primary" data-shr-new>${esc(t('New link'))}</button></div>`;
  if (st.s === 'err') return `${sub}<p class="shr-st" role="alert">${esc(t('Couldn’t make a link.'))} ${esc(st.msg || '')}</p><div class="btns"><button type="button" class="btn primary" data-shr-new>${esc(t('Try again'))}</button></div>`;
  const n = st.n || { bk: 0, pl: 0 };
  return `${sub}<p class="shr-count">${esc([n.bk === 1 ? t('1 booking') : t('{n} bookings', { n: n.bk }), n.pl ? (n.pl === 1 ? t('1 plan') : t('{n} plans', { n: n.pl })) : ''].filter(Boolean).join(' · '))}</p>
    <div class="shr-link"><input readonly value="${esc(st.url)}" aria-label="${esc(t('Link'))}" data-shr-url></div>
    <div class="btns"><button type="button" class="btn primary" data-shr-copy>${esc(t('Copy link'))}</button>${navigator.share ? `<button type="button" class="btn" data-shr-native>${esc(t('Share…'))}</button>` : ''}<button type="button" class="btn ghost shr-stop" data-shr-stop>${esc(t('Stop sharing'))}</button></div>`;
}
async function shrTripLoad(box, ctx) {
  const paint = (st) => { ctx.st = st; if (box.isConnected) box.innerHTML = shrTripHTML(st); };
  paint({ s: 'busy' });
  let u = null; try { u = SB ? await sbUser() : null; } catch { /* below */ }
  if (!u) { paint({ s: 'signin' }); return; }
  const key = syncKey(ctx.cfg); shareNote(ctx.cfg, ctx.owner);
  try {
    const c = await sb(); const data = shareData(ctx.cfg, ctx.owner);
    let { data: row } = await c.from('trip_shares').select('token').eq('owner', u.id).eq('event_id', ctx.eid).maybeSingle();
    if (row) { await c.from('trip_shares').update({ data, name: shName(u) }).eq('token', row.token); }
    else { const r = await c.from('trip_shares').insert({ owner: u.id, event_id: ctx.eid, page_key: key, name: shName(u), data }).select('token').single(); row = r.data;
      if (!row) ({ data: row } = await c.from('trip_shares').select('token').eq('owner', u.id).eq('event_id', ctx.eid).maybeSingle()); if (!row) throw r.error || new Error(''); }
    LS.set('shOut:' + key, { tok: row.token, eid: ctx.eid });
    paint({ s: 'link', url: withQ(shortURL(ctx.slug), 's', row.token), n: { bk: data.bk.length, pl: data.pl.length } });
  } catch (e) { paint({ s: 'err', msg: navigator.onLine === false ? t('You’re offline.') : '' }); }
}
function shrTripWire(box, ctx) {
  if (box._w) return; box._w = true;
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button,[data-si-oauth]'); if (!b || !box.contains(b)) return;
    if (b.dataset.siOauth) { LS.set('afterSignIn', ctx.back || location.hash || '#mine'); return; }
    if (b.dataset.si === 'send') { signInSubmit(box, () => LS.set('afterSignIn', ctx.back || location.hash || '#mine')); return; }
    if (b.dataset.si === 'retry') { box.innerHTML = shrTripHTML({ s: 'signin' }); return; }
    if ('shrNew' in b.dataset) { shrTripLoad(box, ctx); return; }
    if ('shrCopy' in b.dataset) { copy(ctx.st.url); return; }
    if ('shrNative' in b.dataset) { navigator.share({ title: ctx.cfg.title, url: ctx.st.url }).catch(() => {}); return; }
    if ('shrStop' in b.dataset) {
      b.disabled = true; const key = syncKey(ctx.cfg); const o = LS.get('shOut:' + key);
      try { const c = await sb(); const u = await sbUser(); const q = c.from('trip_shares').delete().eq('event_id', ctx.eid); const { error } = await (u ? q.eq('owner', u.id) : q); if (error) throw error; LS.del('shOut:' + key); box.innerHTML = shrTripHTML({ s: 'off' }); toast(t('Link turned off')); }
      catch { b.disabled = false; toast(t('Couldn’t turn it off. Try again.')); }
      void o;
    }
  });
  box.addEventListener('keydown', (e) => { if (e.target.id === 'si-email' && e.key === 'Enter') { e.preventDefault(); signInSubmit(box, () => LS.set('afterSignIn', ctx.back || location.hash || '#mine')); } });
}
// tab switch inside a sheet that has both panels ([data-shr-p="plan"|"trip"])
function shrTab(root, k, ctx) {
  $$('[data-shr-tab]', root).forEach(b => b.setAttribute('aria-selected', String(b.dataset.shrTab === k)));
  $$('[data-shr-p]', root).forEach(p => { p.hidden = p.dataset.shrP !== k; });
  const box = root.querySelector('[data-shr-p="trip"] [data-shr-box]') || root.querySelector('[data-shr-p="trip"]');
  if (k === 'trip' && box) { shrTripWire(box, ctx); if (!ctx.st || ctx.st.s === 'signin' || ctx.st.s === 'err') shrTripLoad(box, ctx); }
}
// the guest page's Share button (a page with its short link); long links and examples keep the plain share
function shareSheet(cfg, opts, art) {
  const h = opts.hosted; if (!h || !h.id || !SB) return shareEvent(cfg, opts);
  let d = document.getElementById('shr-dlg'); if (d) d.remove();
  const url = opts.shareUrl || h.url || location.href.split('#')[0];
  document.body.insertAdjacentHTML('beforeend', `<dialog id="shr-dlg" class="shr-dlg" aria-labelledby="shr-h"><div class="shr-in">
    <div class="shr-top"><h2 id="shr-h">${esc(t('Share'))}</h2><button type="button" class="ds-x" data-shr-x aria-label="${esc(t('Close'))}">×</button></div>
    ${shrSegHTML('plan')}
    <div data-shr-p="plan"><p class="shr-sub">${esc(t(SHR_SUB.plan))}</p><div class="shr-link"><input readonly value="${esc(url)}" aria-label="${esc(t('Link'))}"></div>
      <div class="btns"><button type="button" class="btn primary" data-shr-pcopy>${esc(t('Copy link'))}</button>${navigator.share ? `<button type="button" class="btn" data-shr-pnative>${esc(t('Share…'))}</button>` : ''}</div></div>
    <div data-shr-p="trip" hidden></div></div></dialog>`);
  d = document.getElementById('shr-dlg');
  const ctx = { cfg: opts.src && opts.src.schedule ? cfg : cfg, eid: h.id, slug: h.slug, owner: false, back: art ? hostedBack(art) : '' };
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-shr-x]')) { d.close(); return; }
    const tb = e.target.closest('[data-shr-tab]'); if (tb) { shrTab(d, tb.dataset.shrTab, ctx); return; }
    if (e.target.closest('[data-shr-pcopy]')) copy(url);
    if (e.target.closest('[data-shr-pnative]')) navigator.share({ title: cfg.title, text: cfg.tagline || cfg.title, url }).catch(() => {});
  });
  d.addEventListener('close', () => d.remove());
  d.showModal(); return d;
}

// ================= "Forward bookings": each event's own address (inbound function + Resend) =================
// Hidden until the inbound function says it's set up (GET → { enabled, domain }), and only when signed in.
// add-<token>@<domain> per event (inbound_page_tokens: token → this person + the page_key My trip syncs under, made on
// first view): mail to it lands in this event only (Dylan 11/24: events can overlap, so no date guessing). The older
// per-account address and sender-matched trips@ still work on the server but aren't shown.
var FWD = {}, fwdP = {}; // var: bookingsHTML may render before this line runs. page_key → address
function fwdStatus() {
  if (!SB) return Promise.resolve(null);
  const c = LS.get('fwdCfg'); if (c && Date.now() - c.t < (c.on ? 3600e3 : 600e3)) return Promise.resolve(c.on ? c : null);
  return fetchTimeout(`${SB.url}/functions/v1/inbound`, {}, 8000).then(r => r.ok ? r.json() : null).catch(() => null).then(j => {
    const on = !!(j && j.enabled && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(j.domain || '')); const v = { t: Date.now(), on, domain: on ? String(j.domain).toLowerCase() : '' };
    LS.set('fwdCfg', v); return on ? v : null; });
}
function fwdLoad(key) {
  if (!LS.get('signedIn') || !key || key === 'inbox') return Promise.resolve(null);
  fwdP = fwdP || {}; FWD = FWD || {};
  return fwdP[key] || (fwdP[key] = (async () => {
    const st = await fwdStatus(); if (!st) return null;
    const u = await sbUser(); if (!u) return null; const c = await sb();
    const get = () => c.from('inbound_page_tokens').select('token').eq('owner', u.id).eq('page_key', key).maybeSingle();
    let { data } = await get();
    if (!data) { const r = await c.from('inbound_page_tokens').insert({ owner: u.id, page_key: key }).select('token').single(); data = r.data; if (!data) ({ data } = await get()); } // two tabs at once: the other one made it
    if (!data || !/^[a-f0-9]{18}$/.test(data.token || '')) return null;
    return (FWD[key] = `add-${data.token}@${st.domain}`);
  })().catch(() => null).then(v => { if (!v) delete fwdP[key]; return v; }));
}
function fwdHTML(key) { const a = FWD && FWD[key]; return a && LS.get('signedIn') ? `<div class="fwd-row"><p class="fwd-p">${t('Forward any confirmation email to this address and it’s added to this trip.')}</p><div class="fwd-a"><code class="fwd-addr">${esc(a)}</code><button type="button" class="btn sm" data-fwd-copy="${esc(a)}">${t('Copy')}</button></div></div>` : ''; }
function fwdSlot(cfg) { const k = eventKey(cfg).slice(6); return `<div data-slot="fwd" data-fwd-key="${esc(k)}">${fwdHTML(k)}</div>`; }
function fwdFill(root, cfg) { const k = eventKey(cfg).slice(6); return fwdLoad(k).then(v => { if (v) $$('[data-slot="fwd"]', root || document).forEach(el => { if (el.dataset.fwdKey === k && !el.firstElementChild) el.innerHTML = fwdHTML(k); }); }); }
document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-fwd-copy]'); const a = b && b.dataset.fwdCopy; if (!a) return;
  try { await navigator.clipboard.writeText(a); } catch { const ta = document.createElement('textarea'); ta.value = a; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* shown anyway */ } ta.remove(); }
  b.textContent = t('Copied'); setTimeout(() => { b.textContent = t('Copy'); }, 1500); toast(t('Address copied'));
});
// a forwarded row → the booking the app would have made from the same ai-import result (Add a booking → Read with AI)
function inbItem(r) {
  if (!r || !r.item) return null; if (!r.item.inbound) return { ...r.item, id: r.id };
  const x = aiItemsToBookings([r.item.ai || {}])[0]; return x ? { ...x, id: r.id } : null;
}
function inbWhen(x) { return isoDay(String(x.start || '').slice(0, 10)) ? dateRange(x.start.slice(0, 10), isoDay(String(x.end || '').slice(0, 10)) || '') : ''; }
// My pages: the Inbox — forwarded bookings no trip's dates matched; pick the trip (one tap) and it's added when that trip opens
async function mineInbox(c, evs) {
  const el = $('[data-slot="mine-inbox"]'); if (!el) return;
  const { data, error } = await c.from('trip_items').select('id,item').eq('page_key', 'inbox').limit(100); if (error || !data || !data.length) return;
  const rows = data.map(r => [r, inbItem(r)]).filter(([, x]) => x); if (!rows.length) return;
  const trips = new Map(); const addT = (cfg) => { if (!cfg || cfg.demoTrip) return; const k = syncKey(cfg); if (k && !trips.has(k)) trips.set(k, cfg.title || t('Untitled')); };
  evs.forEach(r => addT(normalize(clone(r.config)))); pagesAll().forEach(p => addT(p.cfg));
  const opts = [...trips].map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
  el.innerHTML = `<h2>${esc(rows.length === 1 ? t('1 forwarded booking') : t('{n} forwarded bookings', { n: rows.length }))}</h2><ul class="mine-list inbox-mine">${rows.map(([r, x]) => `<li><div><b>${esc(x.name || t(ITIN_KINDS[x.kind] || 'Booking'))}</b><span>${esc(inbWhen(x))}</span></div>${opts ? `<select data-inbox-to="${esc(r.id)}" aria-label="${esc(t('Add to a trip'))}"><option value="">${t('Add to…')}</option>${opts}</select>` : `<span class="muted small">${t('Open a trip to add it')}</span>`}</li>`).join('')}</ul>`;
  el.addEventListener('change', async (e) => {
    const s = e.target.closest('[data-inbox-to]'); if (!s || !s.value) return; s.disabled = true;
    const { error: er } = await c.from('trip_items').update({ page_key: s.value }).eq('id', s.dataset.inboxTo);
    if (er) { s.disabled = false; toast(t('Couldn’t move it. Try again.')); return; }
    const name = trips.get(s.value) || ''; s.closest('li').remove(); toast(t('Added to {t}', { t: name }));
    if (!el.querySelector('li')) el.innerHTML = '';
  });
}

// ================= book with the company itself: hotel chains, airlines, rental-car brands =================
// Templates verified on WebKit/iPhone (Nov 2026). Brands that only accept their homepage get the homepage.
// Order everywhere: the brand's own deep link → the place's own website → an aggregator as the last resort.
const slug = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const mdy = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
const HOTEL_BRANDS = [
  ['marriott', 'Marriott', /marriott|westin|sheraton|ritz[- ]carlton|st\.? regis|courtyard|fairfield|residence inn|springhill|aloft|moxy|m[eé]ridien|renaissance|four points|\bac hotel|autograph collection|delta hotels|element by|tribute portfolio|luxury collection|\bedition\b|\bw (hotel|[a-z]+$)/i],
  ['hilton', 'Hilton', /hilton|doubletree|hampton|conrad|waldorf|embassy suites|homewood|home2|curio|canopy by|tapestry|signia|\blxr\b|motto by|tempo by/i],
  ['ihg', 'IHG', /intercontinental|holiday inn|crowne plaza|kimpton|hotel indigo|staybridge|candlewood|even hotels?|\bvoco\b|regent|six senses|vignette collection/i],
  ['accor', 'Accor', /novotel|\bibis\b|sofitel|mercure|pullman|fairmont|swiss[oô]tel|m[oö]venpick|mgallery|raffles|adagio|mama shelter|25hours|banyan tree/i],
  ['choice', 'Choice Hotels', /comfort inn|comfort suites|quality inn|clarion|sleep inn|econo lodge|rodeway|cambria|ascend|mainstay|suburban studios|everhome/i],
  ['hyatt', 'Hyatt', /hyatt|andaz|alila|thompson hotel|zoetry|secrets |dreams |breathless|zilara|ziva|miraval/i],
  ['wyndham', 'Wyndham', /wyndham|ramada|days inn|super 8|la quinta|baymont|microtel|tryp|wingate|hawthorn|trademark collection/i],
  ['bestwestern', 'Best Western', /best western|sure hotel|aiden by/i],
];
const hotelBrand = (name) => (HOTEL_BRANDS.find(([, , re]) => re.test(name || '')) || [])[0] || '';
Object.assign(PROVIDERS, {
  marriott: { name: 'Marriott', kinds: ['hotels'], mode: 'link', url: (p) => `https://www.marriott.com/search/findHotels.mi?destinationAddress.destination=${enc(p.q)}&fromDate=${mdy(p.d1)}&toDate=${mdy(p.d2)}&roomCount=1&numAdultsPerRoom=${p.n || 2}` },
  hilton: { name: 'Hilton', kinds: ['hotels'], mode: 'link', url: (p) => `https://www.hilton.com/en/search/?query=${enc(p.q)}&arrivalDate=${p.d1}&departureDate=${p.d2}&flexibleDates=false&numRooms=1&numAdults=${p.n || 2}&numChildren=0` },
  // IHG months are zero-based: March 2027 is 022027
  ihg: { name: 'IHG', kinds: ['hotels'], mode: 'link', url: (p) => { const my = (d) => pad(+d.slice(5, 7) - 1) + d.slice(0, 4); return `https://www.ihg.com/hotels/us/en/find-hotels/hotel/list?qDest=${enc(p.q)}&qCiD=${+p.d1.slice(8, 10)}&qCiMy=${my(p.d1)}&qCoD=${+p.d2.slice(8, 10)}&qCoMy=${my(p.d2)}&qAdlt=${p.n || 2}&qChld=0&qRms=1&qRtP=6CBARC&qSrt=sBR`; } },
  accor: { name: 'Accor', kinds: ['hotels'], mode: 'link', url: (p) => `https://all.accor.com/booking/en/accor/hotels/${slug(p.city)}-${slug(p.country)}?dateIn=${p.d1}&nights=${Math.max(1, daysBetween(p.d1, p.d2))}&compositions=${p.n || 2}&stayplus=false&snu=false` },
  choice: { name: 'Choice Hotels', kinds: ['hotels'], mode: 'link', url: (p) => `https://www.choicehotels.com/${slug(p.country)}/${slug(p.city)}/hotels?checkInDate=${p.d1}&checkOutDate=${p.d2}&adults=${p.n || 2}` },
  hyatt: { name: 'Hyatt', kinds: ['hotels'], mode: 'link', url: () => 'https://www.hyatt.com/' },
  wyndham: { name: 'Wyndham', kinds: ['hotels'], mode: 'link', url: () => 'https://www.wyndhamhotels.com/' },
  bestwestern: { name: 'Best Western', kinds: ['hotels'], mode: 'link', url: () => 'https://www.bestwestern.com/' },
});
// the booking action for a hotel: brand deep link, else the hotel's website, else Booking.com
function hotelBookAction(cfg, h) {
  const tr = tripDates(cfg); const v = cfg.venue || {}; const b = hotelBrand(h.name);
  const p = { q: [h.name, h.city || v.city || '', v.country || ''].filter(Boolean).join(', '), city: h.city || v.city || '', country: v.country || '', d1: tr.arrive, d2: tr.leave, n: tr.guests || 2 };
  if (b && (b !== 'accor' && b !== 'choice' || (p.city && p.country))) return { url: bookingLink('hotels', b, b === 'marriott' || b === 'hilton' || b === 'ihg' ? { ...p, q: p.city ? `${p.city}${p.country ? ', ' + p.country : ''}` : p.q } : p).url, label: t('Book with {b}', { b: PROVIDERS[b].name }) };
  if (h.web || h.website) { const w = h.web || h.website; return { url: w, label: t('Book direct · {h}', { h: hostOf(w) }) }; }
  return { url: bookingLink('hotels', 'booking', { q: p.q, d1: p.d1, d2: p.d2, n: p.n }).url, label: t('Check rates') + ' · Booking.com' };
}
// airlines: route + dates where the airline's site accepts them, otherwise its booking homepage
const AIRLINE_BOOK = {
  UA: ['United', (o, d, a, b, n) => `https://www.united.com/en/us/fsr/choose-flights?f=${o}&t=${d}&d=${a}&r=${b}&tt=RT&sc=7,7&px=${n}&taxng=1&clm=7&st=bestmatches`],
  AS: ['Alaska', (o, d, a, b, n) => `https://www.alaskaair.com/search/results?A=${n}&O=${o}&D=${d}&OD=${a}&DD=${b}&RT=true`],
  BA: ['British Airways', (o, d, a, b, n) => `https://www.britishairways.com/nx/b/airselect/en/usa/book/search?trip=round&departureDate=${a}&arrivalDate=${b}&from=${o}&to=${d}&travelClass=economy&adults=${n}&children=0&infants=0&youngAdults=0`],
  DL: ['Delta', (o, d, a, b, n) => `https://www.delta.com/flight-search/book-a-flight?tripType=ROUND_TRIP&originCity=${o}&destinationCity=${d}&departureDate=${a}&returnDate=${b}&paxCount=${n}`],
  AA: ['American', () => 'https://www.aa.com/homePage.do'], B6: ['JetBlue', () => 'https://www.jetblue.com/'], WN: ['Southwest', () => 'https://www.southwest.com/'],
  AC: ['Air Canada', () => 'https://www.aircanada.com/us/en/aco/home.html'], KL: ['KLM', () => 'https://www.klm.com/'], AF: ['Air France', () => 'https://wwws.airfrance.us/'],
  LH: ['Lufthansa', () => 'https://www.lufthansa.com/us/en/homepage'], JL: ['JAL', () => 'https://www.jal.co.jp/flights/en-us/'], NH: ['ANA', () => 'https://www.ana.co.jp/en/us/'],
  EK: ['Emirates', () => 'https://www.emirates.com/us/english/'], QF: ['Qantas', () => 'https://www.qantas.com/us/en.html'],
};
// carriers serving the arrival airport: the country's own airlines (airlines.js: flag, domestic, low-cost) first, then the
// international majors above; deduped by code and name. Majors with a route template keep their deep link.
function airlinesFor(ap) {
  const reg = ap && ap.cc ? (window.REGIONAL_AIRLINES || {})[String(ap.cc).toUpperCase()] || [] : [];
  const seen = new Set(); const out = [];
  const add = (code, name, url) => { const kn = 'n:' + name.toLowerCase(); if ((code && seen.has(code)) || seen.has(kn)) return; if (code) seen.add(code); seen.add(kn); out.push({ code, name, url, regional: !!url }); };
  reg.forEach(([c, n, u]) => add(c, n, u));
  Object.entries(AIRLINE_BOOK).forEach(([c, [n]]) => add(c, n, ''));
  return out;
}
function airlinePickHTML(cfg, air, ap = chosenAirport(cfg, air)) {
  const o = LS.get('origin'); if (!air.length) return '';
  const tr = tripDates(cfg); const n = tr.guests || 1; const SHOW = 6;
  const list = airlinesFor(ap);
  const href = (a) => AIRLINE_BOOK[a.code] && ap ? AIRLINE_BOOK[a.code][1](o || '', ap.iata, tr.arrive, tr.leave, n) : a.url || (AIRLINE_BOOK[a.code] ? AIRLINE_BOOK[a.code][1]('', '', '', '', n) : '');
  const where = ap ? `${ap.city || ap.name} (${ap.iata})` : '';
  const head = where ? t('Airlines serving {a}', { a: where }) : t('Booking with a specific airline?');
  return `<div class="airline-pick">${thHead('airlines', `<h3 class="sub-h al-h">${esc(head)}</h3>`, head)}
    <ul class="al-chips">${list.map((a, i) => `<li class="${i >= SHOW ? 'more' : ''}">${ext(href(a), esc(a.name), 'chip al-chip')}</li>`).join('')}${list.length > SHOW ? `<li class="more-li"><button type="button" class="chip al-more" data-more>${t('Show {n} more', { n: list.length - SHOW })}</button></li>` : ''}</ul></div>`;
}
// rental counters at the arrival airport (Google), each to its own brand site
const CAR_BRANDS = [['avis', 'Avis', /\bavis\b/i], ['budget', 'Budget', /\bbudget\b/i], ['hertz', 'Hertz', /\bhertz\b/i], ['enterprise', 'Enterprise', /enterprise/i], ['national', 'National', /\bnational\b/i], ['alamo', 'Alamo', /\balamo\b/i], ['sixt', 'Sixt', /\bsixt\b/i], ['thrifty', 'Thrifty', /thrifty/i], ['dollar', 'Dollar', /\bdollar\b/i], ['europcar', 'Europcar', /europcar/i]];
const CAR_HOME = { avis: 'https://www.avis.com/', budget: 'https://www.budget.com/', hertz: 'https://www.hertz.com/', enterprise: 'https://www.enterprise.com/', national: 'https://www.nationalcar.com/', alamo: 'https://www.alamo.com/', sixt: 'https://www.sixt.com/', thrifty: 'https://www.thrifty.com/', dollar: 'https://www.dollar.com/', europcar: 'https://www.europcar.com/' };
function carBrandURL(brand, ap) { // Avis and Budget airport pages prefill the pickup location
  const city = ap && ap.city ? slug(ap.city) : ''; const cc = ap && ap.cc ? String(ap.cc).toLowerCase() : '';
  // verified for airports outside the US (US location pages use a different path), so US airports get the homepage
  if ((brand === 'avis' || brand === 'budget') && city && cc && cc !== 'us' && ap.iata) return `https://www.${brand}.com/en/locations/${cc}/${city}/${ap.iata.toLowerCase()}`;
  return CAR_HOME[brand];
}
function gpCars(cfg, ap) {
  const key = `gcar1:${ap.iata}`; const c = LS.get(key); if (c && Date.now() - c.t < 7 * 864e5) return Promise.resolve(c.d);
  return gFetch('https://places.googleapis.com/v1/places:searchNearby', { includedTypes: ['car_rental'], maxResultCount: 20, locationRestriction: { circle: { center: { latitude: ap.lat, longitude: ap.lon }, radius: 4000 } } }, 'places.id,places.displayName,places.websiteUri,places.rating,places.userRatingCount')
    .then(j => { const seen = new Set(); const d = (j.places || []).map(x => { const name = (x.displayName && x.displayName.text) || ''; const b = (CAR_BRANDS.find(([, , re]) => re.test(name)) || [])[0] || ''; return { id: x.id, name, brand: b, web: cleanWeb(x.websiteUri), rating: x.rating || 0, count: x.userRatingCount || 0 }; })
      .filter(x => { const k = x.brand || x.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8); LS.set(key, { t: Date.now(), d }); return d; });
}
// counters at the arrival airport and in town around the venue, each with rating, open now and distance
const GCAR_MASK = 'places.id,places.displayName,places.websiteUri,places.rating,places.userRatingCount,places.location,places.currentOpeningHours.openNow,places.shortFormattedAddress,places.googleMapsUri';
function gpCarsNear(lat, lon, radius, key) {
  const c = LS.get(key); if (c && Date.now() - c.t < 3 * 864e5) return Promise.resolve(c.d);
  return gFetch('https://places.googleapis.com/v1/places:searchNearby', { includedTypes: ['car_rental'], maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius } } }, GCAR_MASK)
    .then(j => { const d = (j.places || []).filter(x => x.location).map(x => { const name = (x.displayName && x.displayName.text) || ''; return { id: x.id, name, brand: (CAR_BRANDS.find(([, , re]) => re.test(name)) || [])[0] || '', web: cleanWeb(x.websiteUri), rating: x.rating || 0, count: x.userRatingCount || 0,
      open: x.currentOpeningHours ? !!x.currentOpeningHours.openNow : null, addr: x.shortFormattedAddress || '', maps: x.googleMapsUri || '', d: Math.round(distM(lat, lon, x.location.latitude, x.location.longitude)) }; }); LS.set(key, { t: Date.now(), d }); return d; });
}
function gpCarsAll(cfg, ap) {
  const v = cfg.venue; const far = !ap || ap.d > 3000;
  return Promise.all([ap ? gpCarsNear(ap.lat, ap.lon, 4000, `gcar2:${ap.iata}`).then(xs => xs.map(x => ({ ...x, where: 'airport' }))) : Promise.resolve([]),
    far ? gpCarsNear(v.lat, v.lon, 8000, `gcar2:${osmKey(v.lat, v.lon)}`).then(xs => xs.map(x => ({ ...x, where: 'town' }))).catch(() => []) : Promise.resolve([])])
    .then(([a, b]) => { const ids = new Set(a.map(x => x.id)); return a.concat(b.filter(x => !ids.has(x.id))); });
}
function carRowURL(r, ap) { const deep = r.brand && carBrandURL(r.brand, ap); const own = r.web && r.brand && hostOf(r.web).replace(/^www\./, '').endsWith(r.brand + '.com') ? r.web.replace(/[?#].*$/, '') : '';
  return r.brand ? (ap && r.where === 'airport' && deep !== CAR_HOME[r.brand] ? deep : own || deep) : r.web || r.maps; }
function carCountersHTML(cfg, ap, rows, art) {
  if (art) {
    art._lf = art._lf || {}; const prev = art._lf.cars; const hasA = rows.some(r => r.where === 'airport'), hasT = rows.some(r => r.where === 'town');
    const f = prev ? prev.f : { q: '', where: hasA ? 'airport' : 'town', open: false, sort: 'dist' }; if (f.where === 'airport' && !hasA) f.where = 'town'; if (f.where === 'town' && !hasT) f.where = 'airport';
    const v = cfg.venue; const hasRating = rows.some(r => r.rating), hasOpen = rows.some(r => r.open != null);
    const x = art._lf.cars = { f,
      on: (id) => id === 'open' ? f.open : id === f.where,
      chip: (id) => { if (id === 'open') f.open = !f.open; else f.where = id; },
      clear: () => { f.q = ''; f.open = false; f.sort = 'dist'; },
      list: () => {
        const xs = lfSort(rows.filter(r => (!hasA || !hasT || r.where === f.where) && (!f.q || lfMatch(f.q, r.name, r.brand)) && (!f.open || r.open === true)), f.sort);
        const active = !!(f.q || f.open);
        return `${lfCount(xs.length, active)}${xs.length ? `<ul class="plist rich cars">${xs.map(r => { const url = carRowURL(r, ap); const nm = r.brand ? (CAR_BRANDS.find(b => b[0] === r.brand) || [])[1] : r.name;
          return `<li><div><b>${url ? ext(url, esc(nm), '') : esc(nm)}</b>${r.rating ? `<span class="rt">${gRatingHTML(r)}</span>` : ''}${r.brand && nm !== r.name ? `<span>${esc(r.name)}</span>` : r.addr ? `<span>${esc(r.addr)}</span>` : ''}${r.open != null ? `<span class="tags">${r.open ? `<em class="open">${t('Open now')}</em>` : `<em class="closed">${t('Closed now')}</em>`}</span>` : ''}</div>
            <span class="dist">${esc(fmtDist(r.d, v.cc))}<small>${esc(r.where === 'airport' && ap ? t('from {a}', { a: ap.iata }) : t('from the venue'))}</small></span></li>`; }).join('')}</ul>` : `<p class="muted">${t('Nothing matches these filters.')} <button type="button" class="link" data-lf-clear>${t('Clear filters')}</button></p>`}
          <p class="muted small g-attr">${t('Places and ratings from Google')}</p>`;
      } };
    lfWire(art);
    const chips = [...(hasA && hasT ? [['airport', t('At the airport'), f.where === 'airport'], ['town', t('In town'), f.where === 'town']] : []), ...(hasOpen ? [['open', t('Open now'), f.open]] : [])];
    const head = hasA && !hasT && ap ? t('Rental counters at {a}', { a: ap.iata }) : t('Rental counters');
    return `<div class="th-counters">${thHead('counters', `<h3 class="sub-h">${esc(head)}</h3>`, head)}<div data-lf-box="cars">${lfBarHTML('cars', f, { ph: t('Search companies'), chips, sorts: hasRating ? [['dist', t('Distance')], ['rating', t('Rating')]] : [] })}<div data-lf-list>${x.list()}</div></div></div>`;
  }
  rows = rows.filter(r => r.where !== 'town');
  return `<h3 class="sub-h">${esc(t('Rental counters at {a}', { a: ap.iata }))}</h3><div class="row-links">${rows.map(r => { const deep = r.brand && carBrandURL(r.brand, ap); const own = r.web && r.brand && hostOf(r.web).replace(/^www\./, '').endsWith(r.brand + '.com') ? r.web.replace(/[?#].*$/, '') : '';
    const url = r.brand ? (deep !== CAR_HOME[r.brand] ? deep : own || deep) : r.web; if (!url) return ''; // no prefilled page: the counter's own listing page
    return ext(url, `${esc(r.brand ? (CAR_BRANDS.find(b => b[0] === r.brand) || [])[1] : r.name)}${r.rating ? ` <small>★ ${nfix(r.rating, 1)}</small>` : ` <small>${esc(hostOf(url))}</small>`}`, 'row-link'); }).join('')}</div>`;
}

// ================= "Ask AI to edit" (ai-import mode:"edit"; shown only when the deployed function lists it) =================
async function aiModes() {
  const c = LS.get('aiModes'); if (c && c.m && c.m.length && Date.now() - c.t < 3600e3) return c.m; // only cache a non-empty answer, so a fresh redeploy shows up on reload
  if (!SB || !LS.get('signedIn')) return [];
  try {
    const cl = await sb(); const { data } = await cl.auth.getSession(); const tok = data && data.session && data.session.access_token; if (!tok) return [];
    const r = await fetchTimeout(`${SB.url}/functions/v1/ai-import`, { headers: { Authorization: 'Bearer ' + tok, apikey: SB.key } }, 8000);
    const j = r.ok ? await r.json() : null; const m = j && Array.isArray(j.modes) ? j.modes : [];
    LS.set('aiModes', { t: Date.now(), m }); return m;
  } catch { return []; }
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v), isTime = (v) => v === '' || /^\d{2}:\d{2}$/.test(v), isWhen = (v) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v);
const strOk = (n) => (v) => typeof v === 'string' && v.length <= n;
// allowed paths → value check (and normalizer). Anything else is rejected.
function editRule(cfg, path) {
  let m;
  if ((m = path.match(/^(title|tagline|host|bring|cover)$/))) return { ok: strOk(m[1] === 'bring' ? 2000 : m[1] === 'cover' ? 800 : 140), label: m[1] };
  if (path === 'description') return { ok: strOk(5000), label: 'About' };
  if (path === 'start') return { ok: (v) => typeof v === 'string' && isWhen(v), label: 'Starts' };
  if (path === 'end') return { ok: (v) => typeof v === 'string' && (v === '' || isWhen(v)), label: 'Ends' };
  if (path === 'type') return { ok: (v) => TYPES.includes(v), label: 'Event type' };
  if (path === 'venue.name') return { ok: (v) => !!cfg.venue && strOk(140)(v), label: 'Venue name' };
  if (path === 'theme.accent') return { ok: (v) => /^#[0-9a-f]{6}$/i.test(v), label: 'Color' };
  if (path === 'theme.mode') return { ok: (v) => v === 'light' || v === 'dark', label: 'Background' };
  if (path === 'theme.font') return { ok: (v) => !!FONTS[v], label: 'Title font' };
  if ((m = path.match(/^tools\.(\w+)$/)) && TOOLS.some(x => x[0] === m[1])) return { ok: (v) => typeof v === 'boolean', label: 'Show ' + m[1] };
  if ((m = path.match(/^off\.(about|schedule|details|notes|rsvp|access|route|c-[\w-]+)$/))) return { ok: (v) => typeof v === 'boolean', label: 'Hide ' + m[1] };
  if ((m = path.match(/^schedule\[(\d+)\]\.(date|time|title|note|kind)$/)) && cfg.schedule[+m[1]]) return { ok: m[2] === 'date' ? (v) => isDate(v) : m[2] === 'time' ? (v) => typeof v === 'string' && isTime(v) : m[2] === 'kind' ? (v) => ['activity', 'reservation', 'note'].includes(v) : strOk(200), label: `${schedTitle(cfg)} · ${cfg.schedule[+m[1]].title || 'item ' + (+m[1] + 1)} · ${m[2]}` };
  if (path === 'schedule[]') return { add: true, ok: (v) => v && typeof v === 'object' && strOk(200)(v.title || '') && !!v.title && (!v.date || isDate(v.date)) && isTime(v.time || ''), fix: (v) => ({ date: v.date || (isTrip(cfg) ? '' : cfg.start.slice(0, 10)), time: v.time || '', title: cleanText(v.title, 200), note: cleanText(v.note || '', 200), ...(PLAN_KINDS[v.kind] ? { kind: v.kind } : {}) }), label: `${schedTitle(cfg)} · new item` };
  if ((m = path.match(/^schedule\[(\d+)\]$/)) && cfg.schedule[+m[1]]) return { remove: true, label: `${schedTitle(cfg)} · ${cfg.schedule[+m[1]].title}` };
  if ((m = path.match(/^notes\[(\d+)\]\.(label|text|url)$/)) && cfg.notes[+m[1]]) return { ok: m[2] === 'url' ? (v) => v === '' || !!httpsUrl(v) : strOk(600), label: `Notes · ${cfg.notes[+m[1]].label} · ${m[2]}` };
  if (path === 'notes[]') return { add: true, ok: (v) => v && typeof v === 'object' && !!v.label && strOk(120)(v.label), fix: (v) => ({ label: cleanText(v.label, 120), text: cleanText(v.text || '', 600), url: httpsUrl(v.url || '') }), label: 'Notes · new' };
  if ((m = path.match(/^notes\[(\d+)\]$/)) && cfg.notes[+m[1]]) return { remove: true, label: `Notes · ${cfg.notes[+m[1]].label}` };
  if ((m = path.match(/^x\.([A-Za-z ]+)\.(\w+)$/)) && m[1] === cfg.type) {
    const f = (typeSpec(cfg) || { fields: [] }).fields.find(x => x[0] === m[2]); if (!f) return null;
    const kind = f[2]; const ok = kind === 'links' ? (v) => Array.isArray(v) && v.every(l => l && strOk(80)(l.label) && httpsUrl(l.url)) : kind === 'place' ? (v) => v && typeof v === 'object' && strOk(160)(v.q || '') : kind === 'date' ? (v) => isDate(v) : kind === 'time' ? (v) => isTime(v) : kind === 'datetime' ? (v) => isWhen(v) : kind === 'url' ? (v) => v === '' || !!httpsUrl(v) : strOk(1000);
    return { ok: (v) => v === '' || ok(v), clear: true, label: f[1], fix: kind === 'place' ? (v) => v === '' ? '' : { q: cleanText(v.q, 160) } : null };
  }
  if ((m = path.match(/^stops\[(\d+)\]\.(from|to)$/)) && (cfg.stops || [])[+m[1]]) return { ok: (v) => v === '' || isDate(v), label: `Route · ${cfg.stops[+m[1]].name} · ${m[2] === 'from' ? 'arrive' : 'leave'}` };
  // a renamed city loses its map point; the page finds the new one by name
  if ((m = path.match(/^stops\[(\d+)\]\.name$/)) && (cfg.stops || [])[+m[1]]) return { ok: (v) => typeof v === 'string' && !!v.trim() && v.length <= 80, label: `Route · ${cfg.stops[+m[1]].name}`, after: (next, i = +m[1]) => { const s = next.stops[i]; ['lat', 'lon', 'address', 'city', 'region'].forEach(k => delete s[k]); } };
  if (path === 'stops[]') return { add: true, ok: (v) => v && typeof v === 'object' && typeof v.name === 'string' && !!v.name.trim() && (!v.from || isDate(v.from)) && (!v.to || isDate(v.to)), fix: (v) => ({ name: cleanText(v.name, 80), from: v.from || '', to: v.to || '' }), label: 'Route · new city' };
  if ((m = path.match(/^stops\[(\d+)\]$/)) && (cfg.stops || [])[+m[1]]) return { remove: true, label: `Route · ${cfg.stops[+m[1]].name}${stopRange(cfg.stops[+m[1]]) ? ' · ' + stopRange(cfg.stops[+m[1]]) : ''}` };
  if ((m = path.match(/^custom\[(\d+)\]\.(title|text|label|url|img)$/)) && (cfg.custom || [])[+m[1]]) return { ok: m[2] === 'url' || m[2] === 'img' ? (v) => v === '' || !!httpsUrl(v) : m[2] === 'text' ? strOk(3000) : strOk(120), fix: m[2] === 'text' ? (v) => cleanLong(v, 3000) : null, label: `${cfg.custom[+m[1]].title || 'Section'} · ${m[2]}` };
  if (path === 'custom[]') return { add: true, ok: (v) => v && typeof v === 'object' && !!(v.title || '').trim() && strOk(120)(v.title), fix: (v) => ({ ...blankCustom(), title: cleanText(v.title, 80), text: cleanLong(v.text || '', 3000) }), label: 'New section' };
  if ((m = path.match(/^custom\[(\d+)\]$/)) && (cfg.custom || [])[+m[1]]) return { remove: true, label: `Section · ${cfg.custom[+m[1]].title || 'untitled'}` };
  if ((m = path.match(/^files\[(\d+)\]$/)) && (cfg.files || [])[+m[1]]) return { remove: true, label: `Document · ${cfg.files[+m[1]].name}` };
  return null;
}
const showVal = (x) => x == null || x === '' ? '—' : typeof x === 'object' ? (Array.isArray(x) ? x.map(l => l.label).join(', ') : x.q || JSON.stringify(x)) : String(x).slice(0, 300);
function getPath(o, path) { return path.split(/\.|\[|\]/).filter(Boolean).reduce((a, k) => a == null ? undefined : a[k], o); }
function setPath(o, path, v) { const ks = path.split(/\.|\[|\]/).filter(Boolean); let a = o; ks.slice(0, -1).forEach(k => { if (a[k] == null) a[k] = {}; a = a[k]; }); a[ks[ks.length - 1]] = v; }
// validate the model's changes against the page; returns { next, rows, rejected }
function planEdits(cfg, changes) {
  const next = clone(cfg); const rows = [], rejected = []; const removals = [];
  for (const ch of (changes || []).slice(0, 40)) {
    const rule = editRule(cfg, String(ch.path || '')); let v;
    try { v = ch.value_json === '' || ch.value_json == null ? '' : JSON.parse(ch.value_json); } catch { rejected.push(ch.path); continue; }
    if (!rule) { rejected.push(ch.path); continue; }
    if (ch.op === 'remove' && !rule.remove && (rule.clear || /^(tagline|bring|cover|description)$/.test(ch.path))) { const before = getPath(cfg, ch.path); if (before == null || before === '') continue; setPath(next, ch.path, ''); rows.push({ label: rule.label, before: showVal(before), after: '', rm: true }); continue; }
    if (ch.op === 'remove') { if (!rule.remove) { rejected.push(ch.path); continue; } if (removals.includes(ch.path)) continue; removals.push(ch.path); rows.push({ label: rule.label, before: rule.label.split(' · ').slice(1).join(' · ') || rule.label, after: '', rm: true }); continue; }
    if (ch.op === 'add') { if (!rule.add || !rule.ok(v)) { rejected.push(ch.path); continue; } const val = rule.fix(v); const arr = ch.path.slice(0, -2); (next[arr] = next[arr] || []).push(val); rows.push({ label: rule.label, before: '—', after: [val.title, val.label, val.name, val.date, val.time, val.from, val.to, val.text, val.note].filter(Boolean).join(' · ').slice(0, 200) }); continue; }
    if (rule.add || rule.remove || !rule.ok(v)) { rejected.push(ch.path); continue; }
    const val = rule.fix ? rule.fix(v) : typeof v === 'string' ? (ch.path === 'description' || ch.path === 'bring' ? v.replace(/<[^>]*>/g, '') : cleanText(v, 1000)) : v;
    const before = getPath(cfg, ch.path); setPath(next, ch.path, val); if (rule.after) rule.after(next);
    rows.push({ label: rule.label, before: showVal(before), after: showVal(val) });
  }
  // remove from the end so indexes stay valid (per list)
  removals.map(p => p.match(/^(\w+)\[(\d+)\]$/)).sort((a, b) => +b[2] - +a[2]).forEach(m => next[m[1]].splice(+m[2], 1));
  if (next.files && !next.files.length) delete next.files;
  if (next.end && next.start && next.end.slice(0, 10) < next.start.slice(0, 10)) next.end = '';
  return { next: normalize(next), rows, rejected };
}
function aiEditHTML() {
  return `<div class="ai-edit" data-ai-edit hidden><label for="ai-edit-q">${t('✦ Ask AI to edit')}</label>
    <div class="search"><textarea id="ai-edit-q" rows="2" maxlength="1000" placeholder="${t('e.g. move the ceremony to 5pm')}"></textarea><button type="button" class="btn primary" data-ai-edit-go>${t('Preview')}</button></div>
    <p class="hint" data-ai-edit-msg role="status" aria-live="polite"></p><div data-ai-edit-preview></div></div>`;
}
function wireAIEdit() {
  const box = $('[data-ai-edit]'); if (!box || box._wired) return; box._wired = true;
  aiModes().then(m => { if (m.includes('edit')) box.hidden = false; });
  const msg = box.querySelector('[data-ai-edit-msg]'), prev = box.querySelector('[data-ai-edit-preview]'); let pending = null;
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if ('aiEditGo' in b.dataset) {
      const q = box.querySelector('#ai-edit-q').value.trim(); if (!q) { msg.textContent = t('Say what to change.'); return; }
      b.disabled = true; msg.textContent = t('Working out the changes…'); prev.innerHTML = '';
      try {
        const j = await aiImport({ mode: 'edit', page: B.cfg, instruction: q });
        const plan = planEdits(B.cfg, j.data && j.data.changes); pending = plan;
        if (!plan.rows.length) { msg.textContent = plan.rejected.length ? t('Those changes aren’t something the editor can apply. Try rephrasing.') : t('Nothing to change.'); return; }
        msg.textContent = (j.data.summary ? cleanText(j.data.summary, 200) + ' ' : '') + (plan.rejected.length ? '(' + t(plan.rejected.length > 1 ? '{n} changes skipped' : '1 change skipped', { n: plan.rejected.length }) + ')' : '');
        prev.innerHTML = `<ul class="ai-diff">${plan.rows.map(r => r.rm ? `<li class="rm"><b>${esc(r.label.split(' · ')[0])}</b><s class="was">${esc(r.before)}</s><span class="now rm-t">${t('Removed')}</span></li>` : `<li><b>${esc(r.label)}</b><span class="was">${esc(r.before)}</span><span class="arr">→</span><span class="now">${esc(r.after)}</span></li>`).join('')}</ul><div class="btns"><button type="button" class="btn primary" data-ai-edit-apply>${t('Apply')}</button><button type="button" class="btn ghost" data-ai-edit-cancel>${t('Cancel')}</button></div>`;
      } catch (err) { msg.textContent = err.signin ? t('Sign in (My pages) to use AI edits.') : (err.message || t('Couldn’t do that.')); }
      finally { b.disabled = false; }
    }
    if ('aiEditCancel' in b.dataset) { pending = null; prev.innerHTML = ''; msg.textContent = ''; }
    if ('aiEditApply' in b.dataset && pending) {
      const before = clone(B.cfg); B.cfg = pending.next; pending = null; changed(true); renderHostNote();
      box.querySelector('#ai-edit-q').value = ''; msg.textContent = t('Applied.'); prev.innerHTML = '<button type="button" class="btn sm" data-ai-edit-undo>Undo</button>';
      box._undo = before;
    }
    if ('aiEditUndo' in b.dataset && box._undo) { B.cfg = box._undo; box._undo = null; changed(true); msg.textContent = t('Undone.'); prev.innerHTML = ''; }
  });
}

// ================= documents: "Upload a document" (fill a section from a PDF/photo via ai-import mode:"doc", or attach it for guests) =================
// cfg.files = [{ id, sec, name, url, type: 'pdf'|'image', size }]; sec = the card it was attached in ('route', 'schedule', 'notes', 'about',
// 'bring', 'access', a type card id like 'block') or a custom section ('c-<id>'). Files live in the public 'event-files' bucket under <user id>/.
const DOC_BUCKET = 'event-files';
const DOC_ACCEPT = 'application/pdf,.pdf,image/*';
const DOC_CARDS = ['route', 'schedule', 'notes', 'about', 'bring', 'access'];
const docCardOk = (c, id) => DOC_CARDS.includes(id) || (id === 'rsvp' && c.type === 'Wedding') || /^c-/.test(id) || (TYPE_CARDS[c.type] || []).some(x => x[0] === id && id !== 'route');
function normFiles(xs) {
  const seen = new Set();
  return (Array.isArray(xs) ? xs : []).filter(x => x && typeof x === 'object').slice(0, 40).map((x, i) => {
    let id = typeof x.id === 'string' && /^[a-z0-9]{1,12}$/.test(x.id) ? x.id : 'f' + i; while (seen.has(id)) id += 'x'; seen.add(id);
    return { id, sec: typeof x.sec === 'string' && /^[a-z][\w-]{0,30}$/i.test(x.sec) ? x.sec : 'notes', name: cleanText(x.name, 120) || 'Document', url: httpsUrl(x.url), type: x.type === 'image' ? 'image' : 'pdf', size: Math.max(0, Math.round(+x.size || 0)) };
  }).filter(x => x.url);
}
// guest page: the documents attached to these cards, as a list with View / Download
const tl = (key, en) => LANG === 'en' ? en : t(key);
function docsHTML(cfg, secs) {
  const fs = (cfg.files || []).filter(f => secs.includes(f.sec)); if (!fs.length) return '';
  const dl = (f) => f.url + (f.url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(f.name);
  return `<ul class="docs">${fs.map(f => `<li><a class="doc-main" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer"><span class="doc-ic" aria-hidden="true">${f.type === 'pdf' ? 'PDF' : 'IMG'}</span><b>${esc(f.name)}</b></a><span class="doc-a"><a class="mini-b" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(tl('View document', 'View'))}</a><a class="mini-b" href="${esc(dl(f))}" download="${esc(f.name)}">${esc(t('Download'))}</a></span></li>`).join('')}</ul>`;
}
const bringInPacking = (cfg) => !!(cfg.start && cfg.tools.packing);
const detailDocSecs = (cfg) => ['notes', ...(cfg.type === 'Wedding' ? ['rsvp'] : []), ...(TYPE_CARDS[cfg.type] || []).map(x => x[0]).filter(x => x !== 'route'), ...(bringInPacking(cfg) ? [] : ['bring'])];

// uploads: PDFs up to 10 MB as they are; photos re-encoded to a ~300 KB JPEG on the phone first
async function shrinkPhoto(f, max = 300e3, maxSide = 1600) {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Use a PDF or a photo.')); i.src = url; });
    let side = Math.min(maxSide, Math.max(img.naturalWidth, img.naturalHeight)), q = 0.82, blob = null;
    for (let n = 0; n < 8; n++) {
      const k = side / Math.max(img.naturalWidth, img.naturalHeight); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      blob = await new Promise(res => c.toBlob(res, 'image/jpeg', q)); if (blob.size <= max) break;
      if (q > 0.6) q -= 0.11; else side = Math.round(side * 0.8);
    }
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
async function docPrepare(f) {
  if (isPdf(f)) { if (f.size > 10 * 1024 * 1024) throw new Error('That PDF is too large (10 MB max).'); return { blob: f, type: 'application/pdf', name: f.name || 'Document.pdf', kind: 'pdf' }; }
  if (!/^image\//.test(f.type)) throw new Error('Use a PDF or a photo.');
  return { blob: await shrinkPhoto(f), type: 'image/jpeg', name: (f.name || 'Photo').replace(/\.\w+$/, '') + '.jpg', kind: 'image' };
}
async function docUpload(f, prepared) {
  const user = await myGuestUser(); if (!user) { const e = new Error('signin'); e.signin = true; throw e; }
  const p = prepared || await docPrepare(f); const id = Math.random().toString(36).slice(2, 8);
  const safe = p.name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(-80) || 'document';
  const path = `${user.id}/${Date.now().toString(36)}-${id}-${safe}`;
  const c = await sb(); const { error } = await c.storage.from(DOC_BUCKET).upload(path, p.blob, { contentType: p.type, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(error.message || 'Upload failed.');
  return { id, name: cleanText(f.name || p.name, 120), url: c.storage.from(DOC_BUCKET).getPublicUrl(path).data.publicUrl, type: p.kind, size: p.blob.size };
}
async function docRemoteDelete(f) { // best effort: only files under this user's own folder
  try { const user = await myGuestUser(); const pre = `${SB.url}/storage/v1/object/public/${DOC_BUCKET}/`; if (!user || !f.url.startsWith(pre)) return;
    const path = decodeURIComponent(f.url.slice(pre.length).split('?')[0]); if (!path.startsWith(user.id + '/')) return;
    if ((B.cfg.files || []).some(x => x.url === f.url)) return; // still used elsewhere on this page
    const c = await sb(); await c.storage.from(DOC_BUCKET).remove([path]); } catch { /* the page no longer links it */ }
}
const fileEntry = (f, sec) => ({ id: f.id, sec, name: f.name, url: f.url, type: f.type, size: f.size }); // same key order as normFiles
const fmtSize = (n) => n >= 1048576 ? nfix(n / 1048576, 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// ---- photos: cover (Design) and a custom section's photo — Upload / drop / link ----
const PH_LIMIT = { cover: [500e3, 1600], cs: [300e3, 1600] };
let PH = null; // { key, phase: 'busy'|'signin', msg }
function photoCtlHTML(key, url, linkInput) {
  const st = PH && PH.key === key ? PH : null;
  return `<div class="ph-up" data-ph-key="${esc(key)}">${httpsUrl(url) ? `<img class="ph-img" src="${esc(url)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    <div class="ph-drop" data-ph-drop><label class="btn sm file-pick${st && st.phase === 'busy' ? ' busy' : ''}">${t(httpsUrl(url) ? 'Replace photo' : 'Upload photo')}<input type="file" accept="image/*" data-ph-file hidden></label><span class="ph-or muted small">${t('or drop a photo here')}</span>${httpsUrl(url) ? `<button type="button" class="link" data-ph-clear>${t('Remove photo')}</button>` : ''}</div>
    ${linkInput}
    <p class="hint" data-ph-msg role="status" aria-live="polite">${esc(st && st.msg || '')}</p>${st && st.phase === 'signin' ? `<div class="bk-signin"><p><b>${t('Sign in to upload photos.')}</b></p>${signInFormHTML('')}</div>` : ''}</div>`;
}
function phSet(key, url) { const c = B.cfg; if (key === 'cover') c.cover = url; else { const x = c.custom[+key.slice(3)]; if (x) x.img = url; } }
function phPaint(key) { const el = document.querySelector(`[data-ph-key="${CSS.escape(key)}"]`); if (!el) return; if (B.card) renderSheet(); else buildForm(); }
async function phUpload(key, file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { PH = { key, msg: 'Use a photo (JPG, PNG, HEIC).' }; return phPaint(key); }
  if (!LS.get('signedIn')) { PH = { key, phase: 'signin' }; return phPaint(key); }
  PH = { key, phase: 'busy', msg: 'Uploading…' }; phPaint(key);
  try {
    const [max, side] = PH_LIMIT[key === 'cover' ? 'cover' : 'cs'];
    const blob = await shrinkPhoto(file, max, side);
    const f = await docUpload(file, { blob, type: 'image/jpeg', name: (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', kind: 'image' });
    phSet(key, f.url); PH = null; changed(true);
  } catch (e) { PH = e.signin ? { key, phase: 'signin' } : { key, msg: e.message || 'Upload failed.' }; phPaint(key); }
}
function wirePhotos(root) {
  if (!root || root._ph) return; root._ph = true;
  root.addEventListener('change', (e) => { const i = e.target; if (!i.matches || !i.matches('[data-ph-file]')) return; const box = i.closest('[data-ph-key]'); const f = i.files && i.files[0]; i.value = ''; if (box && f) phUpload(box.dataset.phKey, f); });
  root.addEventListener('click', (e) => {
    const box = e.target.closest('[data-ph-key]'); if (!box) return; const key = box.dataset.phKey;
    const sio = e.target.closest('[data-si-oauth]'); if (sio) { oauthSignIn(sio.dataset.siOauth); LS.set('afterSignIn', '#page=' + B.pid); return; }
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.si === 'send') { signInSubmit(box, () => LS.set('afterSignIn', '#page=' + B.pid)); return; }
    if ('phClear' in b.dataset) { phSet(key, ''); PH = null; changed(true); }
  });
  root.addEventListener('dragover', (e) => { const z = e.target.closest && e.target.closest('[data-ph-drop]'); if (!z) return; e.preventDefault(); z.classList.add('over'); });
  root.addEventListener('dragleave', (e) => { const z = e.target.closest && e.target.closest('[data-ph-drop]'); if (z) z.classList.remove('over'); });
  root.addEventListener('drop', (e) => { const z = e.target.closest && e.target.closest('[data-ph-drop]'); if (!z) return; e.preventDefault(); z.classList.remove('over'); const f = [...(e.dataTransfer && e.dataTransfer.files || [])].find(x => /^image\//.test(x.type)) || (e.dataTransfer && e.dataTransfer.files[0]); const box = z.closest('[data-ph-key]'); if (box && f) phUpload(box.dataset.phKey, f); });
}

// ---- reading a document into reviewable items ----
// item = { sec, key, title, text, date, time, end, url, kind, raw, target }; sec decides where it goes and can be changed in the review
const cleanLong = (s, n) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const docScopeSection = (c, scope) => scope === 'auto' ? '' : /^c-|^new-custom$/.test(scope) ? 'custom' : DOC_CARDS.includes(scope) ? scope : 'details';
function docItems(cfg, d, scope) {
  d = d || {}; const out = []; const want = (s) => scope === 'auto' || scope === s;
  const add = (sec, o) => out.push({ sec, key: '', title: '', text: '', date: '', time: '', end: '', url: '', ...o });
  const tripish = isTrip(cfg) || scope === 'route';
  // a trip runs from its first leg / departure to its last leg / return: the model's start/end only count when they
  // agree with that (one misread date, e.g. 6/2 for 2/6, can't shrink the trip to "Jun 2–3")
  const rawStops = (Array.isArray(d.stops) ? d.stops : []).slice(0, 20);
  const legDays = tripish ? rawStops.flatMap(x => [isoDay(x && x.arrive), isoDay(x && x.leave)]).filter(Boolean) : [];
  const itemDays = tripish ? (Array.isArray(d.schedule) ? d.schedule : []).map(x => isoDay(x && x.date)).filter(Boolean) : [];
  // the route sets the span (else the model's dates, else the items'); items just outside it (a flight the day before) widen it
  let span = legDays.length >= 2 ? tripSpan(legDays) : isoDay(d.start_date) ? [isoDay(d.start_date), isoDay(d.end_date) >= isoDay(d.start_date) ? isoDay(d.end_date) : isoDay(d.start_date)] : itemDays.length >= 2 ? tripSpan(itemDays) : null;
  if (span) itemDays.forEach(x => { if (x < span[0] && daysBetween(x, span[0]) <= 3) span = [x, span[1]]; if (x > span[1] && daysBetween(span[1], x) <= 3) span = [span[0], x]; });
  if (span) d = { ...d, start_date: span[0], start_time: '', end_date: span[1], end_time: '' };
  const C = aiEventToCfg({ ...d, type: cfg.type, start_date: isoDay(d.start_date) || cfg.start.slice(0, 10) });
  const stops = rawStops.map(x => ({ title: cleanText(x && x.city, 80), country: cleanText(x && x.country, 60), date: span ? fitTripDate(span[0], span[1], isoDay(x && x.arrive), false) : isoDay(x && x.arrive), end: span ? fitTripDate(span[0], span[1], isoDay(x && x.leave), false) : isoDay(x && x.leave) })).filter(x => x.title);
  if (scope === 'auto' && !cfg.title.trim() && C.title) add('basics', { key: 'title', title: C.title });
  if (want('route') || scope === 'auto') {
    let s = isoDay(d.start_date) ? C.start : (tripish && stops[0] ? stops[0].date : ''); let e = isoDay(d.end_date) ? C.end : (tripish && stops.length ? stops[stops.length - 1].end : '');
    if (tripish) { s = (s || '').slice(0, 10); e = (e || '').slice(0, 10); } // trips run by the day
    if (s && (tripish || s.slice(0, 10) !== cfg.start.slice(0, 10) || (e || '').slice(0, 10) !== (cfg.end || '').slice(0, 10))) add('basics', { key: 'dates', date: s, end: e && e.slice(0, 10) >= s.slice(0, 10) ? e : '' });
  }
  if (tripish && want('route')) stops.forEach(x => add('route', x));
  if (scope === 'auto' && !cfg.venue && !stops.length && cleanText(d.venue_name, 140)) add('basics', { key: 'venue', title: cleanText(d.venue_name, 140), text: cleanText(d.venue_address, 200) });
  if (want('schedule')) C.schedule.forEach(x => isTrip(cfg) && scope === 'auto' && !x.date ? add('notes', { title: x.title, text: x.note }) : add('schedule', { date: x.date, time: x.time, title: x.title, text: x.note, kind: x.kind || '', ...(span ? { span } : {}) }));
  if (want('notes')) C.notes.forEach(x => add('notes', { title: x.label, text: x.text, url: x.url }));
  if (want('about')) { if (C.host) add('about', { key: 'host', text: C.host }); if (C.description) add('about', { text: cleanLong(d.description, 3000) || C.description }); }
  const tc = (TYPE_CARDS[cfg.type] || []).find(x => x[0] === scope); const sp = typeSpec(cfg);
  if (sp && (scope === 'auto' || tc)) {
    const X = C.x[cfg.type] || {};
    sp.fields.filter(f => (tc ? tc[3] : Object.keys(X)).includes(f[0]) && filled(f[2], X[f[0]])).forEach(f => {
      const v = X[f[0]]; add('field:' + f[0], { text: typeof v === 'string' ? v : v && v.q ? v.q : Array.isArray(v) ? v.map(l => `${l.label} ${l.url}`).join('\n') : '', raw: v, kind: f[2] });
    });
  }
  if (want('bring') && d.bring) { const lines = String(d.bring).split('\n').map(x => cleanText(x.replace(/^[-•*]\s*/, ''), 120)).filter(Boolean).slice(0, 40); if (lines.length) add('bring', { text: lines.join('\n') }); }
  if (want('access') && d.access && typeof d.access === 'object') ACCESS_FIELDS.forEach(([k]) => { const v = cleanText(d.access[k], 300); if (v) add('access:' + k, { text: v }); });
  const secs = (Array.isArray(d.sections) ? d.sections : []).map(x => ({ title: cleanText(x && x.title, 80), text: cleanLong(x && x.text, 3000) })).filter(x => x.title || x.text);
  if (/^c-|^new-custom$/.test(scope)) {
    const s0 = secs[0] || { title: cleanText(d.title, 80), text: cleanLong(d.description, 3000) || C.notes.map(n => [n.label, n.text].filter(Boolean).join(': ')).join('\n') };
    if (secs.length > 1) s0.text = secs.map(x => (x === s0 ? '' : x.title + '\n') + x.text).join('\n\n').slice(0, 3000);
    if (s0.title || s0.text) add('custom', { ...s0, target: scope === 'new-custom' ? '' : scope });
  } else if (scope === 'auto') secs.forEach(x => add('custom', x));
  return docTidy(cfg, out.filter(x => x.title || x.text || x.date)).slice(0, 120);
}
// fewer, cleaner items: exact/trivial duplicates merged; on a trip, a day's untimed activities become one item for that day
const normT = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function docTidy(cfg, xs) {
  const seen = new Map(); const out = [];
  xs.forEach(x => {
    const k = [x.sec, x.key, x.target || '', normT(x.title) || normT(x.text), /^(schedule|route)$/.test(x.sec) ? x.date : '', x.sec === 'schedule' ? x.time : ''].join('|'); const y = seen.get(k);
    if (y) { ['text', 'url', 'end', 'country'].forEach(f => { if (!y[f] && x[f]) y[f] = x[f]; }); return; }
    seen.set(k, x); out.push(x);
  });
  if (!isTrip(cfg)) return out;
  const byDay = {}; out.forEach(x => { if (x.sec === 'schedule' && x.date && !x.time && (!x.kind || x.kind === 'activity')) (byDay[x.date] = byDay[x.date] || []).push(x); });
  const gone = new Set();
  Object.values(byDay).forEach(g => {
    if (g.length < 2) return; const titles = g.map(x => x.title || String(x.text || '').split('\n')[0]).filter(Boolean); const all = titles.join(' · ');
    const h = g[0]; const notes = g.map(x => x.title && x.text ? `${x.title}: ${x.text}` : '');
    h.title = all.length <= 110 ? all : `${titles.slice(0, 2).join(' · ')} + ${t('{n} more', { n: titles.length - 2 })}`;
    h.text = [all.length > 110 ? all : '', ...notes].filter(Boolean).join('\n');
    h.kind = g.some(x => x.kind === 'activity') ? 'activity' : ''; g.slice(1).forEach(x => gone.add(x));
  });
  return out.filter(x => !gone.has(x));
}
// where an item can go, and its label
function docSecLabel(c, sec, it) {
  if (sec === 'basics') return 'Basics';
  if (sec === 'route') return 'Route';
  if (sec === 'schedule') return isTrip(c) ? 'Itinerary' : 'Schedule';
  if (sec === 'notes') return 'Notes for guests';
  if (sec === 'about') return 'About';
  if (sec === 'bring') return 'Must-bring items';
  if (sec === 'custom') { const x = it && it.target && c.custom.find(y => customSid(y) === it.target); return x ? (x.title.trim() || 'Custom section') : 'New custom section'; }
  let m;
  if ((m = sec.match(/^field:(\w+)$/))) { const tc = fieldCard(c, m[1]); const f = (typeSpec(c) || { fields: [] }).fields.find(x => x[0] === m[1]); const fl = f ? (EDIT_LABEL[m[1]] || f[1]) : m[1]; return tc && tc[3].length > 1 ? `${tc[1]} · ${fl}` : (tc ? tc[1] : fl); }
  if ((m = sec.match(/^access:(\w+)$/))) return 'Access · ' + ((ACCESS_FIELDS.find(x => x[0] === m[1]) || [])[1] || m[1]);
  return sec;
}
const docMoveTargets = (c, it, home) => {
  const base = [...(isTrip(c) ? ['route'] : []), 'schedule', 'notes', 'custom', 'about', 'bring'];
  return [...new Set([...(home && !base.includes(home) ? [home] : []), ...base])];
};
const docFields = (it) => {
  switch (it.sec) {
    case 'basics': return it.key === 'title' ? [['title', 'Title', 'text']] : it.key === 'dates' ? [['date', 'Starts', 'when'], ['end', 'Ends', 'when']] : [['title', 'Venue', 'text'], ['text', 'Address', 'text']];
    case 'route': return [['title', 'City or place', 'text'], ['date', 'Arrive', 'date'], ['end', 'Leave', 'date']];
    case 'schedule': return [['date', 'Date', 'date'], ['time', 'Time', 'time'], ['title', 'What', 'text'], ['text', 'Note', 'text']];
    case 'notes': return [['title', 'Title', 'text'], ['text', 'Text', 'long'], ['url', 'Link', 'url']];
    case 'custom': return [['title', 'Title', 'text'], ['text', 'Text', 'long']];
    case 'about': return [['text', it.key === 'host' ? 'Hosted by' : 'About', it.key === 'host' ? 'text' : 'long']];
    case 'bring': return [['text', 'One per line', 'long']];
    default: return [['text', '', it.kind === 'links' ? 'ro' : /lines/.test(it.kind || '') || (it.text || '').length > 80 ? 'long' : 'text']];
  }
};
const drGroupKey = (c, it) => it.sec === 'custom' ? 'custom:' + (it.target || '') : it.sec.startsWith('field:') ? 'field:' + ((fieldCard(c, it.sec.slice(6)) || [''])[0]) : it.sec.replace(/:.*$/, '');
const drLive = (c, st) => st.items.filter(x => !x.gone && !(st.off || {})[drGroupKey(c, x)]);
const drKeyLabel = (c, it) => it.key === 'dates' ? (isTrip(c) ? 'Trip dates' : 'Dates') : it.key === 'title' ? 'Title' : 'Venue';
function drGroupName(c, G, items) {
  const it = items[G.idx[0]];
  if (G.sec.startsWith('access:')) return 'Access and arrival';
  if (G.sec.startsWith('field:')) { const tc = fieldCard(c, G.sec.slice(6)); return tc ? tc[1] : docSecLabel(c, G.sec, it); }
  if (G.sec === 'custom' && !it.target && G.idx.length > 1) return 'New custom sections';
  return docSecLabel(c, G.sec, it);
}
function drGroupCount(c, G, items) {
  const n = G.idx.length;
  if (G.sec === 'route') return n === 1 ? '1 city' : `${n} cities`;
  if (G.sec === 'schedule') return n === 1 ? '1 item' : `${n} items`;
  if (G.sec === 'basics') return G.idx.map(i => drKeyLabel(c, items[i]).toLowerCase()).join(', ');
  return String(n);
}
function drLine(c, it) {
  const one = (x) => String(x || '').split('\n')[0].trim().slice(0, 90);
  if (it.sec === 'basics') return `${drKeyLabel(c, it)}: ${it.key === 'dates' ? dateRange(it.date, it.end) : one(it.title)}`;
  if (it.sec === 'route') return [one(it.title), it.date ? dateRange(it.date, it.end || it.date) : ''].filter(Boolean).join(' · ');
  if (it.sec === 'schedule') return [it.date ? fmt(it.date, { month: 'short', day: 'numeric' }) : '', it.time ? fmtTime(it.time) : '', one(it.title || it.text)].filter(Boolean).join(' · ');
  if (it.sec === 'about' && it.key === 'host') return 'Hosted by ' + one(it.text);
  return one(it.title || it.text) || '—';
}
function docReviewHTML(c, items, st = {}) {
  const order = ['basics', 'route', 'schedule', 'notes', 'about', 'bring', 'custom'];
  const rank = (s) => { const i = order.indexOf(s); return i < 0 ? (s.startsWith('field:') ? 6.5 : 6.7) : i; };
  const di = isTrip(c) ? items.findIndex(x => !x.gone && x.key === 'dates') : -1;
  const groups = []; items.forEach((it, i) => { if (it.gone || i === di) return; const g = drGroupKey(c, it); let G = groups.find(x => x.g === g); if (!G) groups.push(G = { g, sec: it.sec, idx: [] }); G.idx.push(i); });
  groups.sort((a, b) => rank(a.sec) - rank(b.sec));
  const off = st.off || {}, open = st.open || {}, ed = st.edit == null ? -1 : st.edit;
  const n = items.filter(x => !x.gone && !off[drGroupKey(c, x)]).length;
  const fld = (it, i, [k, label, kind]) => {
    const id = `dr${i}-${k}`; const v = it[k] || ''; const lab = label ? `<label for="${id}">${esc(label)}</label>` : '';
    if (kind === 'ro') return `<div class="field wide"><p class="dr-ro">${esc(v)}</p></div>`;
    if (kind === 'long') return `<div class="field wide">${lab}<textarea id="${id}" data-dr="${i}" data-dk="${k}" rows="3"${label ? '' : ` aria-label="${esc(docSecLabel(c, it.sec, it))}"`}>${esc(v)}</textarea></div>`;
    const ty = kind === 'when' ? (isDate(v) || !v ? 'date' : 'datetime-local') : kind === 'url' ? 'url' : kind;
    return `<div class="field${kind === 'text' || kind === 'url' ? ' wide' : ''}">${lab}<input id="${id}" type="${ty}" data-dr="${i}" data-dk="${k}" value="${esc(v)}"${label ? '' : ` aria-label="${esc(docSecLabel(c, it.sec, it))}"`}></div>`;
  };
  const editHTML = (i) => { const it = items[i]; const tg = it.sec === 'basics' ? [] : docMoveTargets(c, it, it.home);
    return `<li class="dr-item" data-dr-at="${i}"><div class="dr-top">${tg.length ? `<select data-dr-sec="${i}" aria-label="${t('Put it in')}">${tg.map(s => `<option value="${esc(s)}" ${s === it.sec ? 'selected' : ''}>${esc(docSecLabel(c, s, s === 'custom' && s === it.sec ? it : null))}</option>`).join('')}</select>` : `<span class="dr-k">${esc(drKeyLabel(c, it))}</span>`}<button type="button" class="ic del dr-x" data-dr-del="${i}" aria-label="${t('Remove')}">×</button></div>
      <div class="dr-f">${docFields(it).map(f => fld(it, i, f)).join('')}</div><button type="button" class="link dr-done" data-dr-edit="-1">${t('Done')}</button></li>`; };
  const dates = di < 0 ? '' : ed === di ? `<div class="dr-dates"><ul class="dr-lines">${editHTML(di)}</ul></div>` : `<div class="dr-dates"><span><b>${t('Trip dates')}</b> ${esc(dateRange(items[di].date, items[di].end))}</span><button type="button" class="link" data-dr-edit="${di}">${t('Edit')}</button></div>`;
  return `<div class="dr" data-sheet="doc-review"><p class="dr-lead">${t('Found in your document. Untick anything you don\'t want, or tap a row to see it.')}</p>${dates}
    <div class="dr-gs">${groups.map(G => { const on = !off[G.g], op = !!open[G.g]; const name = drGroupName(c, G, items);
      return `<div class="dr-g${on ? '' : ' off'}${op ? ' open' : ''}" data-dr-g="${esc(G.g)}"><div class="dr-gh"><input type="checkbox" class="dr-on" data-dr-gon="${esc(G.g)}" ${on ? 'checked' : ''} aria-label="${esc(t('Add {n}', { n: name }))}"><button type="button" class="dr-gt" data-dr-open="${esc(G.g)}" aria-expanded="${op}"><span class="dr-gn"><b>${esc(name)}</b> · ${esc(drGroupCount(c, G, items))}${G.sec === 'route' && stopsOf(c).length ? '<small class="muted">Replaces the current route</small>' : ''}${G.sec === 'schedule' && on ? docHotelSwapHTML(c, G.idx.map(i => items[i]).filter(x => !x.gone)) : ''}</span><i class="dr-chev" aria-hidden="true"></i></button></div>
        ${op ? `<ul class="dr-lines">${G.idx.map(i => i === ed ? editHTML(i) : `<li><button type="button" class="dr-line" data-dr-edit="${i}">${esc(drLine(c, items[i]))}</button></li>`).join('')}</ul>` : ''}</div>`; }).join('')}</div>
    <div class="btns"><button type="button" class="btn primary" data-doc-apply ${n ? '' : 'disabled'}>${st.key && st.key !== 'main' ? 'Add' : 'Add to page'}</button><button type="button" class="btn ghost" data-doc-cancel>${t('Cancel')}</button></div></div>`;
}
// the review says which of the organizer's hotels a document's hotel will replace (hostHotelReplace, on a copy)
function docHotelSwapHTML(c, its) {
  const news = its.map(x => ({ date: isoDay(x.date), time: isoTime(x.time), title: cleanText(x.title, 120), kind: x.kind || '' })).filter(x => x.date && x.title);
  const gone = hostHotelReplace({ ...c, schedule: (c.schedule || []).concat(news) }, news).filter(hotelStayLine).map(x => hotelCiLine(x) ? hostHotelName(x.title) : x.title);
  return gone.length ? `<small class="muted dr-swap">${esc(t('Replaces {x}', { x: [...new Set(gone)].join(', ') }))}</small>` : '';
}
// apply the reviewed items to a copy of the page (async: route stops and the venue are looked up on the map)
async function docApply(cfg, items) {
  const next = clone(cfg); const live = items.filter(x => !x.gone); const xd = () => (next.x[next.type] = next.x[next.type] || {});
  const route = live.filter(x => x.sec === 'route' && cleanText(x.title, 80));
  if (route.length) {
    const cc0 = tripCC(next), co0 = (next.venue && next.venue.country) || '';
    next.stops = await Promise.all(route.map(async (x) => { const name = cleanText(x.title, 80); const r = await geocodeCity(name, x.country || co0, x.country ? '' : cc0).catch(() => null) || await aiResolveVenue(name, x.country || co0).catch(() => null);
      const s = { name, from: isoDay(x.date), to: isoDay(x.end) && (!isoDay(x.date) || x.end >= x.date) ? x.end : '' };
      return r && r.lat != null ? { name, address: r.address, lat: r.lat, lon: r.lon, city: r.city || name, region: r.region, country: r.country, cc: r.cc, from: s.from, to: s.to } : s; }));
    const f0 = next.stops.find(s => s.lat != null);
    if (!next.venue && f0) { next.venue = { name: f0.name, address: f0.address, lat: f0.lat, lon: f0.lon, city: f0.city, region: f0.region, country: f0.country, cc: f0.cc }; next.tz = await lookupTZ(f0.lat, f0.lon).catch(() => ''); }
  }
  // a page still on an example's dates (Customize this → Upload a document): the document's own dates are the trip, so its
  // items are fitted to the document's span, not squeezed into the example's ten days (or dropped to Unscheduled)
  const docSpan = (live.find(x => Array.isArray(x.span)) || {}).span; const sp0 = sampleSpan(next);
  const fitTo = isTrip(next) && docSpan && sampleDates(next) && sp0 && (docSpan[1] < addDays(sp0[0], -3) || docSpan[0] > addDays(sp0[1], 3)) ? docSpan : null;
  const fromDoc = []; // the schedule items this document brought (or already on the page)
  for (const x of live) {
    const title = cleanText(x.title, 120), text = cleanLong(x.text, 3000), date = isoDay(x.date), time = isoTime(x.time); let m;
    if (x.sec === 'basics') {
      if (x.key === 'title' && title) next.title = title.slice(0, 80);
      if (x.key === 'dates') { const s = isWhen(x.date || '') ? x.date : ''; if (s) { next.start = s; next.end = isWhen(x.end || '') && x.end.slice(0, 10) >= s.slice(0, 10) ? x.end : ''; } }
      if (x.key === 'venue' && title && !next.venue) { const r = await aiResolveVenue(title, cleanText(x.text, 200)).catch(() => null); if (r) { next.venue = { name: r.name, address: r.address, lat: r.lat, lon: r.lon, city: r.city, region: r.region, country: r.country, cc: r.cc }; next.tz = await lookupTZ(r.lat, r.lon).catch(() => ''); } }
    } else if (x.sec === 'schedule') {
      const it = { date: isTrip(next) ? (fitTo ? fitTripDate(fitTo[0], fitTo[1], date) : fitTripDate(next.start, next.end, date)) : date || next.start.slice(0, 10), time, title: title || cleanText(text, 120), note: title ? cleanText(text, 200) : '', ...(PLAN_KINDS[x.kind] ? { kind: x.kind } : {}) };
      const had = it.title && next.schedule.find(y => y.date === it.date && y.time === it.time && y.title === it.title);
      if (had) fromDoc.push(had); else if (it.title) { next.schedule.push(it); fromDoc.push(it); }
    } else if (x.sec === 'notes') { const label = title || cleanText(text, 60); if (label && !next.notes.some(y => y.label === label && (y.text || '') === (title ? cleanText(text, 600) : ''))) next.notes.push({ label, text: title ? cleanText(text, 600) : '', url: httpsUrl(x.url || '') }); }
    else if (x.sec === 'custom') {
      const tgt = x.target && next.custom.find(y => customSid(y) === x.target);
      if (tgt) { if (title) tgt.title = title.slice(0, 80); if (text) tgt.text = text; }
      else { const cs = { ...blankCustom(), title: (title || cleanText(text, 60) || 'Info').slice(0, 80), text: title ? text : '' }; next.custom.push(cs); x.made = customSid(cs); }
    } else if (x.sec === 'about') {
      if (x.key === 'host') { const h = cleanText(text || title, 120); if (h) next.host = h; }
      else { const body = [title, text].filter(Boolean).join('\n'); if (body && !next.description.includes(body)) next.description = (next.description ? next.description.trim() + '\n\n' : '') + body; next.description = next.description.slice(0, 5000); }
    } else if (x.sec === 'bring') {
      const have = new Set(next.bring.split('\n').map(y => y.trim().toLowerCase()).filter(Boolean));
      const add = [title, text].filter(Boolean).join('\n').split('\n').map(y => cleanText(y, 120)).filter(y => y && !have.has(y.toLowerCase()));
      if (add.length) next.bring = [next.bring.trim(), ...add].filter(Boolean).join('\n');
    } else if ((m = x.sec.match(/^field:(\w+)$/))) {
      const f = (typeSpec(next) || { fields: [] }).fields.find(y => y[0] === m[1]); if (!f) continue; const k = f[2];
      if (k === 'links') { if (Array.isArray(x.raw)) xd()[m[1]] = x.raw; }
      else if (k === 'place') { if (text) xd()[m[1]] = x.raw && x.raw.q === text ? x.raw : { q: cleanText(text, 160) }; }
      else if (k === 'date') { if (isDate(text)) xd()[m[1]] = text; }
      else if (k === 'time') { if (isTime(text)) xd()[m[1]] = text; }
      else if (k === 'datetime') { if (isWhen(text)) xd()[m[1]] = text; }
      else if (k === 'url') { if (httpsUrl(text)) xd()[m[1]] = httpsUrl(text); }
      else if (text) xd()[m[1]] = k === 'lines' ? text : cleanText(text, 1000);
    } else if ((m = x.sec.match(/^access:(\w+)$/))) { if (text) next.access = { ...(next.access || {}), [m[1]]: cleanText(text, 300) }; }
  }
  if (next.end && next.start && next.end.slice(0, 10) < next.start.slice(0, 10)) next.end = '';
  hostHotelReplace(next, fromDoc); // a new hotel's check-in takes the place of the old hotel for those nights
  const out = sampleDropped(next); delete out._ek; // the example's sample itinerary / route, wholly apart from the document's: gone
  return normalize(out);
}

// ---- the control: in each section sheet, and once on the main page ----
let DU = null; // { key, phase: 'pick'|'busy'|'signin'|'review'|'done', file, into, items, msg, undo, scope, attachNew }
let DOC_AI = null; // does the deployed function read documents? (null = not known yet)
function docAIKnown() {
  if (DOC_AI !== null || !SB) return;
  DOC_AI = false;
  (LS.get('signedIn') ? aiModes().then(m => m.includes('doc')) : aiReady()).then(ok => { DOC_AI = !!ok; if (ok) $$('[data-doc-fillbtn]').forEach(b => { b.hidden = false; }); }).catch(() => {});
}
function docIntoOptions(c) {
  const cards = allCards(c);
  const opts = [...cards.type, ...cards.common].filter(x => docCardOk(c, x[0]));
  return `<option value="auto">${t('Sort automatically')}</option>${opts.map(x => `<option value="${x[0]}">${esc(x[1])}</option>`).join('')}${c.custom.filter(x => x.title.trim()).map(x => `<option value="${customSid(x)}">${esc(x.title)}</option>`).join('')}<option value="new-custom">${t('New custom section')}</option>`;
}
function docBlockHTML(key) {
  const c = B.cfg; const main = key === 'main'; const st = DU && DU.key === key ? DU : null;
  if (!SB) return '';
  const files = main ? [] : (c.files || []).filter(f => f.sec === key);
  let inner = '';
  if (st && st.phase === 'review') inner = docReviewHTML(c, st.items, st);
  else if (st && st.phase === 'signin') inner = `<div class="bk-signin"><p><b>${t('Sign in to upload documents.')}</b></p>${signInFormHTML('')}</div>`;
  else if (main && st && (st.phase === 'pick' || st.phase === 'busy')) inner = `<p class="doc-name"><b>${esc(st.file.name || 'Document')}</b> <small class="muted">${esc(fmtSize(st.file.size))}</small></p>
      <div class="field"><label for="doc-into">${t('Put it in')}</label><select id="doc-into" data-doc-into>${docIntoOptions(c)}</select></div>
      <div class="btns"><button type="button" class="btn primary" data-doc-go="fill" data-doc-fillbtn ${DOC_AI ? '' : 'hidden'} ${st.phase === 'busy' ? 'disabled' : ''}>${t('Fill from document')}</button><button type="button" class="btn" data-doc-go="attach" ${st.phase === 'busy' ? 'disabled' : ''}>${t('Attach for guests')}</button><button type="button" class="btn ghost" data-doc-cancel>${t('Cancel')}</button></div>`;
  else if (!main && st && st.phase === 'pick') inner = `<p class="doc-name"><b>${esc(st.file.name || 'Document')}</b> <small class="muted">${esc(fmtSize(st.file.size))}</small></p>
      <div class="btns"><button type="button" class="btn sm primary" data-doc-go="fill" data-doc-fillbtn ${DOC_AI ? '' : 'hidden'}>${t('Fill from document')}</button><button type="button" class="btn sm" data-doc-go="attach">${t('Attach for guests')}</button><button type="button" class="btn sm ghost" data-doc-cancel>${t('Cancel')}</button></div>`;
  const msg = st && st.msg ? st.msg : '';
  const undo = st && st.phase === 'done' && st.undo ? ' <button type="button" class="btn sm" data-doc-undo>Undo</button>' : '';
  const pickers = main
    ? (!st || st.phase === 'done' ? `<div class="doc-drop" data-doc-drop><label class="btn file-pick doc-pick">${t('✦ Upload a document')}<input type="file" accept="${DOC_ACCEPT}" data-doc-pick hidden></label><span class="doc-or muted small">${t('or drop a file here')}</span></div>` : '')
    : (!st || st.phase === 'done' || st.phase === 'busy' ? `<p class="doc-h">${t('Upload a document')}</p><div class="doc-drop" data-doc-drop><div class="doc-btns"><label class="btn sm file-pick${st && st.phase === 'busy' ? ' busy' : ''}" data-doc-fillbtn ${DOC_AI ? '' : 'hidden'}>${t('Fill from document')}<input type="file" accept="${DOC_ACCEPT}" data-doc-fill hidden></label><label class="btn sm file-pick">${t('Attach for guests')}<input type="file" accept="${DOC_ACCEPT}" data-doc-attach hidden></label></div><span class="doc-or muted small">${t('or drop a file here')}</span></div>` : '');
  const list = files.length ? `<ul class="doc-files">${files.map(f => `<li><span class="doc-ic" aria-hidden="true">${f.type === 'pdf' ? 'PDF' : 'IMG'}</span><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a><button type="button" class="link" data-doc-del="${f.id}" aria-label="${esc(t('Remove {n}', { n: f.name }))}">${t('Remove')}</button></li>`).join('')}</ul>` : '';
  return `<div class="doc-up${main ? ' doc-main-up' : ''}" data-doc-key="${esc(key)}">${pickers}${list}${inner}<p class="hint" data-doc-msg role="status" aria-live="polite">${esc(msg)}${undo}</p></div>`;
}
// a file dropped anywhere else on the builder goes to the main "Upload a document"
function wirePageDrop() {
  if (wirePageDrop.on) return; wirePageDrop.on = true;
  const live = () => !!document.querySelector('[data-doc-key="main"]');
  const other = (e) => e.target.closest && e.target.closest('[data-doc-drop],[data-ph-drop]');
  document.addEventListener('dragover', (e) => { if (!dragFiles(e) || !live() || other(e)) { if (other(e)) document.body.classList.remove('doc-dragging'); return; } e.preventDefault(); document.body.classList.add('doc-dragging'); });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget || e.relatedTarget === document.documentElement) document.body.classList.remove('doc-dragging'); });
  document.addEventListener('drop', (e) => {
    document.body.classList.remove('doc-dragging'); if (!dragFiles(e) || !live() || other(e)) return; e.preventDefault();
    const f = e.dataTransfer.files[0]; if (!f) return; pageFile(f);
  });
  // a screenshot pasted (Cmd/Ctrl+V) goes where a dropped one would
  document.addEventListener('paste', (e) => { if (!live()) return; const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(x => /^image\//.test(x.type || '') || x.type === 'application/pdf'); if (!f) return; e.preventDefault(); pageFile(f); });
}
// an open card sheet with its own Upload a document takes the file (e.g. Itinerary → its hotels); else the main block
function pageFile(f) {
  const sh = $('#sheet'); const own = sh && sh.open ? sh.querySelector('[data-doc-key]') : null;
  if (own) { docDropped(own.dataset.docKey, f); const el = sh.querySelector('[data-doc-key]'); if (el) el.scrollIntoView({ block: 'center' }); return; }
  const go = () => { docDropped('main', f); const el = document.querySelector('[data-doc-key="main"]'); if (el) el.scrollIntoView({ block: 'center' }); };
  if (sh && sh.open) { sh.addEventListener('close', () => setTimeout(go, 0), { once: true }); sh.close(); } else go();
}
function docPaint(key) { const el = document.querySelector(`[data-doc-key="${CSS.escape(key)}"]`); if (el) el.outerHTML = docBlockHTML(key); }
const docSignIn = (key) => { DU = { key, phase: 'signin' }; docPaint(key); };
async function docRead(key, scope, file) {
  if (!LS.get('signedIn')) return docSignIn(key);
  const keep = DU && DU.key === key ? DU : {};
  DU = { ...keep, key, phase: 'busy', file, scope, msg: 'Reading…' }; docPaint(key);
  try {
    const part = await bookingFile(file);
    const j = await aiImport({ mode: 'doc', files: [part], type: B.cfg.type, section: docScopeSection(B.cfg, scope), ...(isDate(B.cfg.start.slice(0, 10)) ? { trip_start: B.cfg.start.slice(0, 10), trip_end: (B.cfg.end || '').slice(0, 10) } : {}) });
    const items = docItems(B.cfg, j.data, scope); items.forEach(x => { x.home = x.sec; x.homeTarget = x.target || ''; });
    if (DU.key !== key) return;
    if (!items.length) { DU = { key, phase: key === 'main' ? 'pick' : 'done', file, msg: 'Nothing found to fill in. Try Attach for guests.' }; docPaint(key); return; }
    DU = { key, phase: 'review', file, scope, items, msg: '', attachNew: scope === 'new-custom', off: {}, open: {}, edit: -1 }; docPaint(key);
  } catch (e) {
    if (e.signin) return docSignIn(key);
    DU = { key, phase: key === 'main' ? 'pick' : 'done', file, msg: e.message || 'Couldn’t read it.' }; docPaint(key);
  }
}
async function docAttach(key, sec, file, { newCustom } = {}) {
  if (!LS.get('signedIn')) return docSignIn(key);
  DU = { key, phase: key === 'main' ? 'busy' : 'busy', file, msg: 'Uploading…' }; docPaint(key);
  try {
    const f = await docUpload(file); const cfg = B.cfg; const undo = clone(cfg);
    if (newCustom) { const cs = { ...blankCustom(), title: cleanText((file.name || 'Document').replace(/\.\w+$/, '').replace(/[_-]+/g, ' '), 80) || 'Document' }; cfg.custom.push(cs); sec = customSid(cs); }
    cfg.files = (cfg.files || []).concat(fileEntry(f, sec));
    DU = { key, phase: 'done', msg: key === 'main' ? `Attached to ${docSecLabel(cfg, /^c-/.test(sec) ? 'custom' : sec, { target: sec })}.` : 'Attached.', undo: key === 'main' ? undo : null };
    changed(true);
  } catch (e) {
    if (e.signin) return docSignIn(key);
    DU = { key, phase: key === 'main' ? 'pick' : 'done', file, msg: e.message || 'Upload failed.' }; docPaint(key);
  }
}
// a dropped file starts the same flow as picking one: the main block asks "Put it in", a section asks Fill or Attach
function docDropped(key, file) { if (!file) return; DU = { key, phase: 'pick', file, into: key === 'main' ? 'auto' : key }; docPaint(key); }
const dragFiles = (e) => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
function wireDocs(root) {
  if (!root || root._docs) return; root._docs = true;
  const zone = (e) => e.target.closest && e.target.closest('[data-doc-drop]');
  root.addEventListener('dragover', (e) => { const z = zone(e); if (!z || !dragFiles(e)) return; e.preventDefault(); z.classList.add('over'); });
  root.addEventListener('dragleave', (e) => { const z = zone(e); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
  root.addEventListener('drop', (e) => { const z = zone(e); if (!z) return; e.preventDefault(); z.classList.remove('over'); document.body.classList.remove('doc-dragging'); const box = z.closest('[data-doc-key]'); if (box) docDropped(box.dataset.docKey, e.dataTransfer && e.dataTransfer.files[0]); });
  root.addEventListener('change', (e) => {
    const i = e.target; const box = i.closest && i.closest('[data-doc-key]'); if (!box) return; const key = box.dataset.docKey;
    if (i.matches('[data-doc-pick]') && i.files && i.files[0]) { DU = { key, phase: 'pick', file: i.files[0], into: 'auto' }; docPaint(key); return; }
    if (i.matches('[data-doc-fill]') && i.files && i.files[0]) { const f = i.files[0]; i.value = ''; docRead(key, key, f); return; }
    if (i.matches('[data-doc-attach]') && i.files && i.files[0]) { const f = i.files[0]; i.value = ''; docAttach(key, key, f); return; }
    if (i.matches('[data-doc-into]') && DU) DU.into = i.value;
    if (i.dataset.drSec != null && DU && DU.items) { const it = DU.items[+i.dataset.drSec]; if (!it) return; it.sec = i.value; it.target = it.sec === 'custom' && it.home === 'custom' ? it.homeTarget || '' : ''; DU.open = { ...(DU.open || {}), [drGroupKey(B.cfg, it)]: true }; docPaint(key); }
    if (i.dataset.drGon != null && DU && DU.items) { DU.off = { ...(DU.off || {}), [i.dataset.drGon]: !i.checked }; docPaint(key); }
  });
  root.addEventListener('input', (e) => { const i = e.target; if (i.dataset.dr == null || !DU || !DU.items) return; const it = DU.items[+i.dataset.dr]; if (it) it[i.dataset.dk] = i.value; e.stopPropagation(); }, true);
  root.addEventListener('click', (e) => {
    const box = e.target.closest('[data-doc-key]'); if (!box) return; const key = box.dataset.docKey;
    const sio = e.target.closest('[data-si-oauth]'); if (sio) { oauthSignIn(sio.dataset.siOauth); LS.set('afterSignIn', '#page=' + B.pid); return; }
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.si === 'send') { signInSubmit(box, () => LS.set('afterSignIn', '#page=' + B.pid)); return; }
    if (d.si === 'retry') { docSignIn(key); return; }
    if (d.docGo && DU && DU.file) {
      const into = (box.querySelector('[data-doc-into]') || {}).value || DU.into || 'auto';
      if (d.docGo === 'fill') docRead(key, into, DU.file);
      else docAttach(key, into === 'auto' ? 'notes' : into, DU.file, { newCustom: into === 'new-custom' });
      return;
    }
    if ('docCancel' in d) { DU = null; docPaint(key); return; }
    if (d.drDel != null && DU && DU.items) { DU.items[+d.drDel].gone = true; DU.edit = -1; docPaint(key); return; }
    if (d.drOpen != null && DU && DU.items) { const o = DU.open = DU.open || {}; o[d.drOpen] = !o[d.drOpen]; if (!o[d.drOpen] && DU.edit >= 0 && drGroupKey(B.cfg, DU.items[DU.edit]) === d.drOpen) DU.edit = -1; docPaint(key); return; }
    if (d.drEdit != null && DU && DU.items) { DU.edit = +d.drEdit; docPaint(key); if (DU.edit >= 0) { const f = document.querySelector(`[data-doc-key="${CSS.escape(key)}"] [data-dr-at="${DU.edit}"] :is(input,textarea)`); if (f) f.focus({ preventScroll: true }); } return; }
    if ('docApply' in d && DU && DU.items) {
      const st = DU; const use = drLive(B.cfg, st); if (!use.length) return; b.disabled = true; const m = box.querySelector('[data-doc-msg]'); if (m) m.textContent = use.some(x => x.sec === 'route' || x.key === 'venue') ? t('Finding places…') : t('Adding…');
      (async () => {
        const undo = clone(B.cfg); let next = await docApply(B.cfg, use);
        if (st.attachNew) { const made = use.find(x => x.made); if (made) { try { const f = await docUpload(st.file); next.files = (next.files || []).concat(fileEntry(f, made.made)); } catch { /* the section is still made */ } } }
        if (DU !== st) return;
        B.cfg = next; DU = { key, phase: 'done', msg: 'Added. Everything stays editable in its section.', undo }; changed(true); toast(t('Added to the page')); if (typeof renderHostNote === 'function') renderHostNote();
      })().catch(err => { b.disabled = false; if (m) m.textContent = err.message || t('Couldn’t apply that.'); });
      return;
    }
    if ('docUndo' in d && DU && DU.undo) { B.cfg = DU.undo; DU = { key, phase: 'done', msg: 'Undone.' }; changed(true); return; }
    if (d.docDel) {
      const cfg = B.cfg; const f = (cfg.files || []).find(x => x.id === d.docDel); if (!f) return;
      confirmDlg({ title: t('Remove “{n}”?', { n: f.name }), ok: t('Remove') }).then(yes => { if (!yes) return; cfg.files = cfg.files.filter(x => x !== f); if (!cfg.files.length) delete cfg.files; changed(true); docRemoteDelete(f); });
    }
  });
}

// ================= guest languages: the organizer's own text, translated (ai-import mode:"translate") =================
// cfg.lang = the language the organizer writes in; cfg.langs = guest languages; cfg.tr[lang][path] = { h: hash of the source text, t: translation, o: organizer override }.
// Only fields whose source text changed (hash) are sent again. Names, places, dates, codes and links are left alone by the function.
const GUEST_LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['de', 'Deutsch'], ['it', 'Italiano'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['sv', 'Svenska'], ['el', 'Ελληνικά'],
  ['ru', 'Русский'], ['uk', 'Українська'], ['tr', 'Türkçe'], ['ar', 'العربية'], ['he', 'עברית'], ['hi', 'हिन्दी'], ['ja', '日本語'], ['zh', '中文'], ['ko', '한국어'], ['vi', 'Tiếng Việt'], ['th', 'ไทย'], ['id', 'Bahasa Indonesia'], ['tl', 'Tagalog']];
const langName = (k) => (GUEST_LANGS.find(x => x[0] === k) || [k, k])[1];
const RTL = new Set(['ar', 'he']);
const srcLang = (cfg) => cfg.lang || 'en';
const hashStr = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
// every piece of organizer-written text, by path
function textFields(cfg) {
  const out = {}; const put = (k, v) => { if (typeof v === 'string' && v.trim()) out[k] = v; };
  ['title', 'tagline', 'description', 'bring'].forEach(k => put(k, cfg[k]));
  (cfg.schedule || []).forEach((x, i) => { put(`schedule[${i}].title`, x.title); put(`schedule[${i}].note`, x.note); });
  (cfg.notes || []).forEach((x, i) => { put(`notes[${i}].label`, x.label); put(`notes[${i}].text`, x.text); });
  (cfg.custom || []).forEach((x, i) => { put(`custom[${i}].title`, x.title); put(`custom[${i}].text`, x.text); put(`custom[${i}].label`, x.label); });
  const sp = typeSpec(cfg), td = typeData(cfg);
  if (sp) sp.fields.filter(f => f[2] === 'text' || f[2] === 'lines').forEach(([k]) => put(`x.${cfg.type}.${k}`, td[k]));
  Object.entries(cfg.access || {}).forEach(([k, v]) => put(`access.${k}`, v));
  (cfg.files || []).forEach((x, i) => put(`files[${i}].name`, x.name));
  if (cfg.rsvpq) { if (cfg.rsvpq.meal) (cfg.rsvpq.meals || []).forEach((x, i) => put(`rsvpq.meals[${i}]`, x)); if (cfg.rsvpq.qs) (cfg.rsvpq.q || []).forEach((x, i) => put(`rsvpq.q[${i}]`, x)); } // RSVP form questions that are on
  return out;
}
function staleFields(cfg, lang) {
  const tr = (cfg.tr && cfg.tr[lang]) || {}; const out = {};
  for (const [k, v] of Object.entries(textFields(cfg))) { const e = tr[k]; if (!e || e.h !== hashStr(v)) out[k] = v; }
  return out;
}
async function translateCfg(cfg, say) {
  const langs = (cfg.langs || []).filter(l => l !== srcLang(cfg)); let n = 0;
  cfg.tr = cfg.tr && typeof cfg.tr === 'object' ? cfg.tr : {};
  const live = textFields(cfg);
  for (const lang of langs) {
    const tr = (cfg.tr[lang] = cfg.tr[lang] || {});
    Object.keys(tr).forEach(k => { if (!(k in live) && !k.startsWith('ann.')) delete tr[k]; }); // fields that no longer exist
    const todo = Object.entries(staleFields(cfg, lang)); if (!todo.length) continue;
    if (say) say(t('Translating into {l}…', { l: langName(lang) }));
    for (let i = 0; i < todo.length; i += 120) {
      const part = Object.fromEntries(todo.slice(i, i + 120));
      const j = await aiImport({ mode: 'translate', fields: part, target: lang, source: srcLang(cfg) });
      ((j.data && j.data.translations) || []).forEach(x => { if (x.key in part && typeof x.text === 'string') { tr[x.key] = { h: hashStr(part[x.key]), t: String(x.text).slice(0, 6000) }; n++; } });
    }
  }
  return n;
}
// On demand: a guest who picks a language the host didn't publish gets the page translated by ai-import (signed-out
// guests too, capped server-side), cached on this device per page + language; "Translating…" meanwhile.
const trCacheKey = (cfg, lang) => 'trc:' + hashStr(JSON.stringify([cfg.title, cfg.start, cfg.venue && cfg.venue.name])) + ':' + lang;
function withCachedTr(cfg, lang) {
  const c = LS.get(trCacheKey(cfg, lang)); if (!c || lang === srcLang(cfg)) return cfg;
  return { ...cfg, tr: { ...(cfg.tr || {}), [lang]: { ...c, ...((cfg.tr || {})[lang] || {}) } } };
}
async function translateOnDemand(cfg, lang) {
  const todo = Object.entries(staleFields(cfg, lang)); if (!todo.length) return 0;
  const got = LS.get(trCacheKey(cfg, lang)) || {}; let n = 0;
  for (let i = 0; i < todo.length; i += 120) {
    const part = Object.fromEntries(todo.slice(i, i + 120));
    const j = await aiTranslate({ mode: 'translate', fields: part, target: lang, source: srcLang(cfg) });
    ((j.data && j.data.translations) || []).forEach(x => { if (x.key in part && typeof x.text === 'string') { got[x.key] = { h: hashStr(part[x.key]), t: String(x.text).slice(0, 6000) }; n++; } });
  }
  if (n) LS.set(trCacheKey(cfg, lang), got); return n;
}
// render a guest page in LANG: stored + cached translations now, the rest fetched and the page re-rendered
function guestRender(cfg, root, opts) {
  const lang = LANG; const base = withCachedTr(cfg, lang); renderEvent(translatedView(base, lang), root, { ...opts, src: cfg });
  if (lang === srcLang(cfg) || !Object.keys(staleFields(base, lang)).length || navigator.onLine === false || !SB) return;
  const note = document.createElement('p'); note.className = 'tr-note'; note.setAttribute('role', 'status'); note.textContent = t('Translating…');
  const body = root.querySelector('.ev-panel:not([hidden]) .ev-body'); if (body) body.prepend(note);
  translateOnDemand(base, lang).then(n => { note.remove(); if (n && LANG === lang && document.body.contains(root)) { const p = root.querySelector('.ev-panel:not([hidden])'); renderEvent(translatedView(withCachedTr(cfg, lang), lang), root, { ...opts, src: cfg, tab: p ? p.dataset.panel : opts.tab }); } })
    .catch(() => { note.textContent = t('Couldn’t translate the host’s text right now.'); setTimeout(() => note.remove(), 4000); });
}
// the page as guests in `lang` see it
function translatedView(cfg, lang) {
  const tr = cfg.tr && cfg.tr[lang]; if (!tr || lang === srcLang(cfg)) return cfg;
  const c = clone(cfg);
  for (const [k, v] of Object.entries(textFields(cfg))) { const e = tr[k]; if (e && e.h === hashStr(v) && typeof e.t === 'string') setPath(c, k, e.t); }
  return c;
}
// languages a guest can pick: the page's own, its guest languages, and the interface languages
const pageLangs = (cfg) => [...new Set([srcLang(cfg), ...(cfg.langs || []), ...LANGS.map(x => x[0])])];
function guestLangPick(cfg) {
  const avail = pageLangs(cfg); const ok = (l) => l && avail.includes(l);
  const q = (new URLSearchParams(location.search).get('lang') || '').slice(0, 2).toLowerCase(); if (ok(q)) return q;
  const saved = LS.get('lang'); if (ok(saved)) return saved;
  const nav = (navigator.languages || [navigator.language || 'en']).map(x => String(x).slice(0, 2).toLowerCase());
  return nav.find(l => (cfg.langs || []).includes(l) || l === srcLang(cfg)) || nav.find(ok) || srcLang(cfg);
}
// the viewer bar's edit link: a pencil + label; on narrow phones that show language pills only the pencil (label stays as aria-label)
const vbarEditHTML = (href, label, attrs = '') => `<a class="btn sm vbar-edit" href="${href}" aria-label="${esc(label)}"${attrs}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg><span>${esc(label)}</span></a>`;
// the host's own languages as a switch at the top of the page ("English · 日本語"); other languages stay in the picker
const langPillsHTML = (cfg) => { const ls = [srcLang(cfg), ...(cfg.langs || []).filter(l => l !== srcLang(cfg))]; if (ls.length < 2) return '';
  return `<span class="lang-pills" role="group" aria-label="${t('Language')}">${ls.map(l => `<button type="button" class="lang-pill ${l === LANG ? 'on' : ''}" aria-pressed="${l === LANG}" data-lang-pill="${l}" lang="${l}">${esc(langName(l))}</button>`).join('')}</span>`; };
const pillInView = () => { const on = document.querySelector('.vbar .lang-pill.on'); const box = on && on.parentElement; if (box && box.scrollWidth > box.clientWidth) box.scrollLeft = on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2; };
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('.vbar [data-lang-pill]'); if (b && b.dataset.langPill !== LANG) setGuestLang(b.dataset.langPill); });
const langSelectHTML = (cfg) => `<select class="lang-sel" data-lang aria-label="${t('Language')}">${pageLangs(cfg).map(k => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${esc(langName(k))}${(cfg.langs || []).includes(k) || k === srcLang(cfg) ? '' : ' ·'}</option>`).join('')}</select>`;
// choosing a language also rewrites a ?lang= in the address, so the choice wins over the link it came from
function setGuestLang(v) { LS.set('lang', v); const q = new URLSearchParams(location.search); if (q.has('lang')) { q.set('lang', v); history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash); } route(); }
document.addEventListener('change', (e) => { const s0 = e.target.closest && e.target.closest('.vbar [data-lang]'); if (!s0) return; setGuestLang(s0.value); });
// editor card: each guest language with its state (Translating… / N to translate / Ready ✓ · Edit translation)
const TRB = {}; // lang → true while its translation runs (this tab)
function langStatusHTML(c, l) {
  const missing = Object.keys(staleFields(c, l)).length;
  const st = TRB[l] ? `<span class="tr-st busy">${esc(t('Translating…'))}</span>`
    : !missing ? `<span class="tr-st ok">${t('Ready ✓')}</span>`
    : !canTranslate() ? `<span class="tr-st">${esc(t('{n} to translate', { n: missing }))} · <a href="#mine">${t('Sign in')}</a> ${t('to translate')}</span>`
    : `<span class="tr-st">${esc(t('{n} to translate', { n: missing }))}</span><button type="button" class="btn sm" data-tr-go="${l}">${t('Translate')}</button>`;
  return `<div class="tr-lang" data-tr-status="${l}"><b>${esc(langName(l))}</b>${st}${TRB[l] ? '' : `<button type="button" class="link" data-tr-edit="${l}">${t('Edit translation')}</button>`}</div>`;
}
function langsCardHTML(c) {
  const src = srcLang(c); const sel = new Set(c.langs || []); const on = [...sel].filter(l => l !== src);
  const reviews = on.map(l => { const tr = (c.tr && c.tr[l]) || {}; const f = textFields(c);
    const rows = Object.entries(f).map(([k, v]) => { const e = tr[k]; const fresh = e && e.h === hashStr(v); return `<div class="tr-row"><span class="tr-src">${esc(v.length > 140 ? v.slice(0, 140) + '…' : v)}</span><textarea data-tr-lang="${l}" data-tr-key="${esc(k)}" rows="${v.length > 80 ? 3 : 1}" placeholder="${fresh ? '' : 'Not translated yet'}">${esc(fresh ? e.t : '')}</textarea></div>`; }).join('');
    return `<details class="tr-review" data-tr-lang="${l}"><summary><b>${esc(langName(l))}</b> <small class="muted">${t('edit any line')}</small></summary>${rows || '<p class="hint">Nothing to translate yet.</p>'}</details>`; }).join('');
  return `<p class="hint">${t('Guests see your page in these languages: a switch at the top of the page, and their phone’s language is picked for them. Translated as soon as you add a language; edit any line.')}</p>
    <div class="field"><label for="f-lang">${t('You write in')}</label><select id="f-lang" data-src-lang>${GUEST_LANGS.map(([k, n]) => `<option value="${k}" ${k === src ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="field"><label>${t('Guest languages')}</label><div class="chips tr-langs">${GUEST_LANGS.filter(([k]) => k !== src).map(([k, n]) => `<label class="chip ${sel.has(k) ? 'on' : ''}"><input type="checkbox" data-guest-lang="${k}" ${sel.has(k) ? 'checked' : ''} hidden>${esc(n)}</label>`).join('')}</div></div>
    <div class="tr-status" data-tr-box>${on.map(l => langStatusHTML(c, l)).join('')}</div><p class="hint" data-tr-msg role="status" aria-live="polite"></p>
    ${reviews}`;
}
function paintLangStatus() { const box = $('[data-tr-box]'); if (box && B) box.innerHTML = (B.cfg.langs || []).filter(l => l !== srcLang(B.cfg)).map(l => langStatusHTML(B.cfg, l)).join(''); }
// translate one guest language now, into the page as it is when the answer comes back (only lines whose text didn't change)
async function translateLang(l) {
  if (!B || TRB[l] || !canTranslate()) return; const cfg0 = B.cfg; const todo = staleFields(cfg0, l); if (!Object.keys(todo).length) { paintLangStatus(); return; }
  TRB[l] = true; paintLangStatus();
  try {
    const keys = Object.entries(todo); const got = {};
    for (let i = 0; i < keys.length; i += 120) {
      const part = Object.fromEntries(keys.slice(i, i + 120));
      const j = await aiImport({ mode: 'translate', fields: part, target: l, source: srcLang(cfg0) });
      ((j.data && j.data.translations) || []).forEach(x => { if (x.key in part && typeof x.text === 'string') got[x.key] = { h: hashStr(part[x.key]), t: String(x.text).slice(0, 6000) }; });
    }
    if (!B) return; const c = B.cfg; if (!(c.langs || []).includes(l)) return; const now = textFields(c);
    c.tr = c.tr && typeof c.tr === 'object' ? c.tr : {}; const tr = (c.tr[l] = c.tr[l] || {});
    Object.entries(got).forEach(([k, e]) => { if (now[k] != null && hashStr(now[k]) === e.h && !(tr[k] && tr[k].o && tr[k].h === e.h)) tr[k] = e; });
    TRB[l] = false; changed(); if (B.card === 'langs' && !(document.activeElement && document.activeElement.matches('#sheet textarea'))) renderSheet(); else paintLangStatus();
  } catch (e) { TRB[l] = false; paintLangStatus(); const m = $('[data-tr-msg]'); const why = e.signin ? t('Sign in (My pages) to translate.') : (e.message || t('Translation failed')); if (m) m.textContent = why; toast(t('Couldn’t translate:') + ' ' + why); }
}
// after edits: re-translate changed lines of every guest language (quietly, a few seconds after typing stops)
const autoTranslate = debounce(() => { if (!B || !canTranslate()) return; (B.cfg.langs || []).filter(l => l !== srcLang(B.cfg) && Object.keys(staleFields(B.cfg, l)).length).forEach(l => translateLang(l)); }, 2500);
function langsInput(i, cfg) {
  if (i.dataset.guestLang) { const l = i.dataset.guestLang; const s0 = new Set(cfg.langs || []); i.checked ? s0.add(l) : s0.delete(l); cfg.langs = [...s0]; changed(true); if (i.checked) translateLang(l); return true; }
  if (i.dataset.srcLang != null) { cfg.lang = i.value; cfg.langs = (cfg.langs || []).filter(l => l !== i.value); changed(true); return true; }
  if (i.dataset.trLang) { const l = i.dataset.trLang, k = i.dataset.trKey; const v = textFields(cfg)[k]; if (v == null) return true; cfg.tr = cfg.tr || {}; cfg.tr[l] = cfg.tr[l] || {};
    if (i.value.trim()) cfg.tr[l][k] = { h: hashStr(v), t: i.value, o: true }; else delete cfg.tr[l][k]; changed(); paintLangStatus(); return true; }
  return false;
}
async function langsClick(b, cfg) {
  if (b.dataset.trGo) { translateLang(b.dataset.trGo); return true; }
  if (b.dataset.trEdit) { const d = $(`#sheet details.tr-review[data-tr-lang="${b.dataset.trEdit}"]`) || $(`details.tr-review[data-tr-lang="${b.dataset.trEdit}"]`); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } return true; }
  return false;
}
const canTranslate = () => { const c = LS.get('aiModes'); return !!(c && c.m && c.m.includes('translate')) && !!LS.get('signedIn'); };
// translate a few strings for the host (guest notes) into the host's language, cached
async function translateForHost(map) {
  const host = (navigator.language || 'en').slice(0, 2).toLowerCase(); const out = {}; const todo = {};
  for (const [k, v] of Object.entries(map)) { const c = LS.get('htr:' + host + ':' + hashStr(v)); if (c) out[k] = c; else todo[k] = v; }
  if (Object.keys(todo).length) { const j = await aiImport({ mode: 'translate', fields: todo, target: host }); ((j.data && j.data.translations) || []).forEach(x => { if (todo[x.key] != null) { out[x.key] = x.text; LS.set('htr:' + host + ':' + hashStr(todo[x.key]), x.text); } }); }
  return out;
}

// ================= trips: day-by-day itinerary builder (reuses cfg.schedule: {date, time, title, note, kind}) =================
const PLAN_KINDS = { activity: 'Activity', reservation: 'Reservation', note: 'Note' };
function tripDays(c) {
  const s = c.start.slice(0, 10), e = (c.end || c.start).slice(0, 10); const n = Math.min(60, Math.max(0, daysBetween(s, e)));
  const days = Array.from({ length: n + 1 }, (_, i) => addDays(s, i));
  c.schedule.forEach(x => { if (x.date && !days.includes(x.date)) days.push(x.date); });
  return days.sort();
}
// opt (on-page editing): { day } just that day, { item } just that one item (with its date, to move it)
function tripPlanHTML(c, opt = null) {
  const it = opt && opt.item != null ? c.schedule[opt.item] : null; const days = it ? [it.date] : opt && opt.day ? [opt.day] : tripDays(c);
  return `${days.map((d, di) => {
    const same = c.schedule.map((x, i) => [x, i]).filter(([x]) => x.date === d).map(([, i]) => i); const items = c.schedule.map((x, i) => [x, i]).filter(([x, i]) => it ? i === opt.item : x.date === d);
    return `<div class="plan-day">${it ? fieldWrap('Day', `<input id="tp-date" type="date" data-s="${opt.item}" data-k="date" value="${esc(it.date || '')}">`, 'tp-date') : opt && opt.day ? '' : `<h3>${d >= c.start.slice(0, 10) ? `<span class="dayn">${t('Day {n}', { n: daysBetween(c.start, d) + 1 })}</span> ` : ''}${esc(friendlyDate(d))}</h3>`}
      ${items.map(([x, i], k) => `<div class="rowed plan-item"><div class="plan-top"><select data-s="${i}" data-k="kind" aria-label="${t('Kind')}">${Object.entries(PLAN_KINDS).map(([v, l]) => `<option value="${v}" ${(x.kind || 'activity') === v ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select><input type="time" data-s="${i}" data-k="time" value="${esc(x.time)}" aria-label="${t('Time (optional)')}"><span class="mv"><button type="button" data-tp-mv="${i}" data-dir="-1" ${same.indexOf(i) <= 0 ? 'disabled' : ''} aria-label="${t('Move up')}">↑</button><button type="button" data-tp-mv="${i}" data-dir="1" ${same.indexOf(i) === same.length - 1 ? 'disabled' : ''} aria-label="${t('Move down')}">↓</button></span></div>
        <input data-s="${i}" data-k="title" value="${esc(x.title)}" placeholder="${t((x.kind || 'activity') === 'reservation' ? 'Dinner at…, tour, tickets' : (x.kind === 'note' ? 'Something to remember' : 'What you’re doing'))}" aria-label="${t('Title')}">${(x.kind || 'activity') === 'note' ? '' : schedPlaceHTML(x, i)}${hotelCiLine(x) ? schedHotelHF(x, i) : `<input data-s="${i}" data-k="note" value="${esc(x.note)}" placeholder="${t('Confirmation or a note')}" aria-label="${t('Note')}">`}${hotelCiLine(x) ? `<button type="button" class="ic del bk-rm" data-sdel="${i}" data-sdel-hotel aria-label="${esc(t('Remove hotel'))} ${esc(hostHotelName(x.title))}">${TRASH_IC}${t('Remove hotel')}</button>` : `<button type="button" class="ic del" data-sdel="${i}" aria-label="${t('Remove')}">${t('Remove')}</button>`}</div>`).join('')}
      ${it ? '' : `<button type="button" class="btn sm" data-tp-add="${d}">${t('+ Add to this day')}</button>`}</div>`;
  }).join('')}${opt ? '' : `<div class="btns">${typeof importButtonHTML === 'function' ? importButtonHTML() : ''}</div>`}`;
}
function tripClick(b, cfg) {
  const d = b.dataset;
  if (d.tpAdd) { cfg.schedule.push({ date: d.tpAdd, time: '', title: '', note: '', kind: 'activity' }); const n = cfg.schedule.length - 1; changed(true); setTimeout(() => $(`#sheet [data-s="${n}"][data-k="title"]`)?.focus(), 30); return true; }
  if (d.tpMv != null) {
    const i = +d.tpMv; const x = cfg.schedule[i]; const same = cfg.schedule.map((y, j) => [y, j]).filter(([y]) => y.date === x.date).map(([, j]) => j);
    const k = same.indexOf(i) + +d.dir; if (k >= 0 && k < same.length) { const j = same[k]; [cfg.schedule[i], cfg.schedule[j]] = [cfg.schedule[j], cfg.schedule[i]]; changed(true); }
    return true;
  }
  return false;
}

// builder: a hotel's check-in row — room category + free cancellation (a fold) and multi-line notes
const schedHotelHF = (x, i) => `${hfFoldHTML(hfOfEv(x), 'hf-s' + i, { en: true, attr: `data-hf-s="${i}"` })}<textarea data-s="${i}" data-k="note" rows="2" maxlength="1000" placeholder="${t('Notes: confirmation, late check-in, requests')}" aria-label="${t('Notes')}">${esc(x.note || '')}</textarea>`;
// builder: a schedule item's own place — the chosen place (name + address, Change / Remove), or an optional Places search
function schedPlaceHTML(x, i) {
  const p = x.place;
  if (p && B.spEdit !== i) return `<div class="venue-sel s-place"><div><b>${esc(p.name)}</b>${p.address && p.address !== p.name ? `<span>${esc(p.address)}</span>` : ''}</div><span class="s-place-b"><button type="button" class="btn sm" data-sp-chg="${i}">${t('Change')}</button><button type="button" class="btn sm ghost" data-sp-del="${i}" aria-label="${t('Remove place')}">${t('Remove')}</button></span></div>`;
  return `<div class="search s-place-q"><input id="sp-q-${i}" data-sp-q="${i}" value="${p ? esc(p.name) : ''}" placeholder="${t('Place (optional), e.g. a restaurant or beach club')}" aria-label="${t('Place (optional)')}" autocomplete="off"><button type="button" class="btn sm" data-sp-find="${i}">${t('Find')}</button></div>`;
}
function setSchedPlace(i, v) { const x = B && B.cfg.schedule[i]; const p = normSchedPlace(v); if (!x || !p) return; x.place = p; B.spEdit = null; changed(true); }
function wireSchedPlaceAC() {
  $$('#sheet [data-sp-q]').forEach(inp => { if (inp._ac) return;
    inp.addEventListener('keydown', (e) => { const ul = inp.parentElement.querySelector('.gp-sugg'); if (e.key === 'Enter' && (!ul || ul.hidden)) { e.preventDefault(); schedPlaceFind(+inp.dataset.spQ, inp.value); } }); // no suggestion showing: text search
    placeAutocomplete(inp, { bias: () => B.cfg.venue, onPick: (id, tok) => gpVenue(id, tok).then(v => setSchedPlace(+inp.dataset.spQ, v)).catch(() => toast(t('Couldn’t load that place'))) }); });
}
// Find / Enter without a suggestion: the best text-search match (Google, else OpenStreetMap)
function schedPlaceFind(i, q) {
  q = String(q || '').trim(); if (q.length < 2) return;
  geocode(q).then(rs => { const r = (rs || []).find(x => x.lat != null && !(x.types || []).some(ty => ty === 'country' || ty === 'continent')) || (rs || [])[0]; if (!r) { toast(t('No match. Try adding the city.')); return; } setSchedPlace(i, r); }).catch(() => toast(t('Search is unavailable right now')));
}

// ================= customization: Design section, section order, type defaults =================
const THEME_PRESETS = [
  ['Classic', { accent: LAGOON, font: 'field', mode: 'light' }], ['Garden', { accent: '#0B7A75', font: 'serif', mode: 'light' }],
  ['Romance', { accent: '#C2185B', font: 'classic', mode: 'light' }], ['Sunset', { accent: '#FF6B35', font: 'wide', mode: 'light' }],
  ['Gold', { accent: '#B8860B', font: 'classic', mode: 'dark' }], ['Night', { accent: '#6D28D9', font: 'condensed', mode: 'dark' }],
  ['Stadium', { accent: '#C2185B', font: 'condensed', mode: 'dark' }], ['Trail', { accent: '#2E7D32', font: 'wide', mode: 'light' }],
];
// guest Event tab sections the organizer can reorder and hide
const EVENT_SECTIONS = [['route', 'Route'], ['about', 'About'], ['details', 'Need to know'], ['rsvp', 'RSVP'], ['access', 'Access and arrival'], ['schedule', 'Schedule'], ['weather', 'Weather']];
const schedTitle = (cfg) => isTrip(cfg) ? 'Itinerary' : 'Schedule';
function sectionOrder(cfg) {
  const ids = EVENT_SECTIONS.map(x => x[0]).concat((cfg.custom || []).filter(x => x && (x.title || '').trim()).map(customSid)); const o = (Array.isArray(cfg.order) ? cfg.order : (typeDefaults(cfg.type).order || [])).filter((x, i, a) => ids.includes(x) && a.indexOf(x) === i);
  ids.forEach((x, i) => { if (!o.includes(x)) o.splice(Math.min(i, o.length), 0, x); });
  return o;
}
const sectionShown = (cfg, id) => id === 'weather' ? !!cfg.tools.weather : id === 'mine' ? mineShown(cfg) : !cfg.off[id];
function setSectionShown(cfg, id, on) { if (id === 'weather') cfg.tools.weather = on; else cfg.off[id] = !on; }
const sameTheme = (a, b) => a.accent.toLowerCase() === b.accent.toLowerCase() && a.font === b.font && (a.mode || 'light') === (b.mode || 'light');
// Design: one dropdown per setting, each with a small preview; display names only (stored values unchanged)
const PRESET_LABEL = { Classic: 'Classic', Garden: 'Natural', Romance: 'Romantic', Sunset: 'Bright', Gold: 'Elegant', Night: 'Night', Stadium: 'Bold', Trail: 'Outdoors' };
const COLOR_NAME = { '#0f4a50': 'Dark teal', '#0b7a75': 'Teal', '#ff6b35': 'Orange', '#c2185b': 'Rose', '#6d28d9': 'Purple', '#b8860b': 'Gold', '#1f2937': 'Charcoal', '#2e7d32': 'Green' };
const colorName = (hex) => COLOR_NAME[String(hex || '').toLowerCase()] || 'Custom';
function coverFieldHTML(c) {
  const link = `<input id="f-cover" data-f="cover" type="url" value="${esc(c.cover)}" placeholder="${t(SB ? 'or a photo link, https://…' : 'Photo link, https://…')}" aria-label="${t('Cover photo link')}">`;
  return `<div class="field"><label for="f-cover">${t('Cover photo')}</label>${SB ? photoCtlHTML('cover', c.cover, link) : `<div class="cover-row">${c.cover ? `<img src="${esc(c.cover)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${link}</div>${c.cover ? `<button type="button" class="link" data-b="cover-clear">${t('Remove photo')}</button>` : ''}`}</div>`;
}
function designHTML(c) {
  const th = c.theme; const order = sectionOrder(c);
  const lab = Object.fromEntries(EVENT_SECTIONS);
  Object.keys(lab).forEach(k => { lab[k] = t(lab[k]); }); lab.schedule = t(schedTitle(c)); if (isTrip(c)) lab.route = t('Route (shown in Itinerary)'); (c.custom || []).forEach(x => { lab[customSid(x)] = x.title; });
  const pre = THEME_PRESETS.find(([, p]) => sameTheme(th, p)); const known = !!COLOR_NAME[th.accent.toLowerCase()]; const custom = !known || (B && B.customColor);
  const sel = (id, key, prev, opts) => `<div class="dsel">${prev}<select id="${id}" data-d="${key}">${opts}</select></div>`;
  return `${brandHTML(c)}<div class="dgrid">
    <div class="field"><label for="d-style">${t('Style')}</label>${sel('d-style', 'preset', `<span class="dprev${th.mode === 'dark' ? ' dark' : ''}" style="--pa:${esc(th.accent)};--pc:#fff;font-family:${esc(FONTS[th.font].css)}" aria-hidden="true">Aa</span>`, `${pre ? '' : `<option value="" selected>${t('Custom')}</option>`}${THEME_PRESETS.map(([n]) => `<option value="${esc(n)}" ${pre && pre[0] === n ? 'selected' : ''}>${esc(t(PRESET_LABEL[n] || n))}</option>`).join('')}`)}</div>
    <div class="field"><label for="d-color">${t('Color')}</label>${sel('d-color', 'color', `<span class="ddot" style="background:${esc(th.accent)}" aria-hidden="true"></span>`, `${SWATCHES.map(x => `<option value="${x}" ${!custom && x.toLowerCase() === th.accent.toLowerCase() ? 'selected' : ''}>${esc(t(colorName(x)))}</option>`).join('')}<option value="custom" ${custom ? 'selected' : ''}>${t('Custom…')}</option>`)}</div>
    <div class="field"><label for="d-font">${t('Title font')}</label>${sel('d-font', 'font', `<span class="dprev" style="font-family:${esc(FONTS[th.font].css)}" aria-hidden="true">Aa</span>`, Object.entries(FONTS).map(([k, x]) => `<option value="${k}" ${k === th.font ? 'selected' : ''}>${esc(t(x.label))}</option>`).join(''))}</div>
    <div class="field"><label for="d-mode">${t('Background')}</label>${sel('d-mode', 'mode', `<span class="ddot${th.mode === 'dark' ? ' dk' : ' lt'}" aria-hidden="true"></span>`, `<option value="light" ${th.mode !== 'dark' ? 'selected' : ''}>${t('Light')}</option><option value="dark" ${th.mode === 'dark' ? 'selected' : ''}>${t('Dark')}</option>`)}</div>
  </div>
  ${custom ? `<div class="field"><div class="swatches custom-row"><label class="custom-c"><input type="color" data-t="accent" value="${esc(th.accent)}" aria-label="${t('Pick any color')}"><span>${t('Pick')}</span></label><input id="f-accent-hex" class="hex" data-hex value="${esc(th.accent)}" maxlength="7" spellcheck="false" aria-label="${t('Color code')}"></div></div>` : ''}
    ${coverFieldHTML(c)}
    ${httpsUrl(c.logo) ? `<div class="field"><label>${t('Logo')}</label><div class="logo-row"><img src="${esc(c.logo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><button type="button" class="link" data-b="logo-clear">${t('Remove logo')}</button></div></div>` : ''}
`;
}
// Builder → Sections: every part of the guest page with one on/off switch (Event sections also move up/down)
const SEC_LABEL = { mine: 'Make it mine' };
function sectionsHTML(c) {
  const order = sectionOrder(c); const lab = { ...Object.fromEntries(EVENT_SECTIONS), ...SEC_LABEL };
  Object.keys(lab).forEach(k => { lab[k] = t(lab[k]); }); lab.schedule = t(schedTitle(c)); if (isTrip(c)) lab.route = t('Route (shown in Itinerary)'); (c.custom || []).forEach(x => { lab[customSid(x)] = x.title; });
  const sw = (attr, on, label) => `<label class="tool"><input type="checkbox" ${attr} ${on ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${esc(label)}</label>`;
  const row = (id, mv, i) => `<li class="${sectionShown(c, id) ? '' : 'off'}">${sw(`data-sec-on="${id}"`, sectionShown(c, id), lab[id])}${mv ? `<span class="mv"><button type="button" data-sec-mv="${id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('Move {n} up', { n: lab[id] }))}">↑</button><button type="button" data-sec-mv="${id}" data-dir="1" ${i === order.length - 1 ? 'disabled' : ''} aria-label="${esc(t('Move {n} down', { n: lab[id] }))}">↓</button></span>` : ''}</li>`;
  return `<p class="grp">${t('Event')}</p><ol class="order secs">${row('mine', false)}${order.map((id, i) => row(id, true, i)).join('')}</ol>
    <p class="grp">${t('Tabs')}</p><div class="tools">${TOOLS.filter(([k]) => k !== 'weather').map(([k, l]) => sw(`data-tool="${k}"`, c.tools[k], t(l))).join('')}</div>
    <p class="grp">${t('Just for you')}</p><div class="tools">${sw('data-vn-on', vnOn(c), t('Vendors and payments'))}</div>
    <div class="btns"><button type="button" class="btn sm ghost" data-b="type-defaults">${esc(t('Reset to {t} defaults', { t: t(TYPE_LABEL[c.type] || c.type) }))}</button></div>`;
}
const sectionsSum = (c) => { const ids = ['mine', ...sectionOrder(c)]; const n = ids.filter(id => sectionShown(c, id)).length + TOOLS.filter(([k]) => k !== 'weather' && c.tools[k]).length; return t('{n} of {m} on', { n, m: ids.length + TOOLS.length - 1 }); };
// returns true when it handled the click
function designClick(b, cfg) {
  const d = b.dataset;
  if (d.preset) { const p = THEME_PRESETS.find(x => x[0] === d.preset); if (p) { cfg.theme = { ...cfg.theme, ...p[1] }; loadFont(p[1].font); changed(true); } return true; }
  if (d.secMv) { const o = sectionOrder(cfg); const i = o.indexOf(d.secMv), j = i + +d.dir; if (j >= 0 && j < o.length) { [o[i], o[j]] = [o[j], o[i]]; cfg.order = o; changed(true); } return true; }
  if (d.b === 'cover-clear') { cfg.cover = ''; changed(true); return true; }
  if (d.b === 'logo-clear') { delete cfg.logo; changed(true); return true; }
  if (d.brand) return brandClick(b);
  if (d.b === 'type-defaults') { const td = typeDefaults(cfg.type); cfg.theme = { ...td.theme }; cfg.tools = defaultTools(cfg.type); delete cfg.order; ['about', 'details', 'access', 'rsvp', 'schedule'].forEach(k => { cfg.off[k] = false; }); if (rsvpDefaultOff(cfg.type)) cfg.off.rsvp = true; delete cfg.off.mine; loadFont(cfg.theme.font); changed(true); toast(t('{t} defaults applied', { t: t(TYPE_LABEL[cfg.type] || cfg.type) })); return true; }
  return false;
}
function designInput(i, cfg) {
  const dk = i.dataset.d;
  if (dk) {
    if (dk === 'preset') { const p = THEME_PRESETS.find(x => x[0] === i.value); if (p) { cfg.theme = { ...cfg.theme, ...p[1] }; loadFont(p[1].font); if (B) B.customColor = false; changed(true); } }
    else if (dk === 'color') { if (i.value === 'custom') { if (B) B.customColor = true; } else { cfg.theme.accent = i.value; if (B) B.customColor = false; } changed(true); }
    else if (dk === 'font' && FONTS[i.value]) { cfg.theme.font = i.value; loadFont(i.value); changed(true); }
    else if (dk === 'mode') { cfg.theme.mode = i.value === 'dark' ? 'dark' : 'light'; changed(true); }
    return true;
  }
  if (i.dataset.brandUrl != null) { BR().url = i.value; return true; }
  if (i.dataset.brandLogo != null || i.dataset.brandFile != null) return true;
  if (i.dataset.secOn) { setSectionShown(cfg, i.dataset.secOn, i.checked); changed(true); return true; }
  if (i.dataset.hex != null) { const v = i.value.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) { cfg.theme.accent = v; const cp = i.closest('.swatches')?.querySelector('[data-t="accent"]'); if (cp) cp.value = v; changed(); } return true; }
  return false;
}
// ================= Vendors and payments: the organizer's own tracking, never part of the page guests see =================
// Not in the page config (anyone with the link can read that). Kept on this device per page (ep:priv:<pid>) and, signed
// in with the page on the account, in public.event_private (supabase/schema-4.sql: only the page's owner can read or
// write it). Tracking only: amounts and dates the organizer types in; no money moves here.
const V_CATS = ['Venue', 'Catering', 'Photographer', 'Videographer', 'Florist', 'DJ/Band', 'Officiant', 'Hair & makeup', 'Planner', 'Cake', 'Rentals', 'Transport', 'Other'];
const V_CURS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'MXN', 'JPY', 'CHF', 'INR', 'BRL', 'ZAR', 'SGD', 'HKD', 'AED', 'THB'];
const vnId = () => Math.random().toString(36).slice(2, 10);
const vnStr = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
const vnNum = (v) => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : null; };
const vnBlank = () => ({ id: vnId(), cat: '', name: '', contact: '', phone: '', email: '', web: '', addr: '', total: null, notes: '', sched: '', pays: [] });
function vnNorm(p) {
  p = p && typeof p === 'object' ? p : {};
  const vendors = (Array.isArray(p.vendors) ? p.vendors : []).filter(v => v && typeof v === 'object').slice(0, 200).map(v => ({
    id: vnStr(v.id, 20) || vnId(), cat: V_CATS.includes(v.cat) ? v.cat : v.cat ? 'Other' : '', name: vnStr(v.name, 120), contact: vnStr(v.contact, 120), phone: vnStr(v.phone, 40),
    email: vnStr(v.email, 160), web: vnStr(v.web, 400), addr: vnStr(v.addr, 300), total: vnNum(v.total), notes: vnStr(v.notes, 3000), sched: vnStr(v.sched, 120),
    pays: (Array.isArray(v.pays) ? v.pays : []).filter(x => x && typeof x === 'object').slice(0, 60).map(x => ({ id: vnStr(x.id, 20) || vnId(), amt: vnNum(x.amt),
      due: isDate(x.due) ? x.due : '', paid: isDate(x.paid) ? x.paid : '', note: vnStr(x.note, 300) })) }));
  const o = { cur: V_CURS.includes(p.cur) ? p.cur : 'USD', vendors, t: +p.t || 0 }; if (typeof p.on === 'boolean') o.on = p.on; return o;
}
function vnP() { if (!B) return vnNorm(null); if (!B.priv || B.privPid !== B.pid) { B.priv = vnNorm(LS.get('priv:' + B.pid)); B.privPid = B.pid; } return B.priv; }
const vnHas = (P) => P.vendors.length > 0 || typeof P.on === 'boolean';
function vnSave() { const P = vnP(); P.t = Date.now(); LS.set('priv:' + B.pid, P); vnPushSoon(); }
const vnOn = (c) => { const P = vnP(); return typeof P.on === 'boolean' ? P.on : c.type === 'Wedding' || P.vendors.length > 0; };
const vnSum = (xs) => Math.round(xs.reduce((a, b) => a + (b || 0), 0) * 100) / 100;
function vnCalc(v) {
  const paid = vnSum(v.pays.filter(x => x.paid).map(x => x.amt)); const total = v.total != null ? v.total : vnSum(v.pays.map(x => x.amt));
  const next = v.pays.filter(x => !x.paid && x.due).sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0)[0] || null;
  return { paid, total, left: Math.max(0, Math.round((total - paid) * 100) / 100), next };
}
function vnTotals(P) {
  let total = 0, paid = 0; const due = [];
  P.vendors.forEach((v, vi) => { const k = vnCalc(v); total += k.total; paid += k.paid; v.pays.forEach((x, pi) => { if (!x.paid && x.due) due.push({ v, x, vi, pi }); }); });
  due.sort((a, b) => a.x.due < b.x.due ? -1 : a.x.due > b.x.due ? 1 : 0);
  total = Math.round(total * 100) / 100; paid = Math.round(paid * 100) / 100;
  return { total, paid, left: Math.max(0, Math.round((total - paid) * 100) / 100), due };
}
const vnDueSt = (d, today = todayYMD()) => !d ? '' : d < today ? 'over' : daysBetween(today, d) <= 14 ? 'soon' : '';
const vnMoney = (n, cur) => { n = n || 0; try { return new Intl.NumberFormat(LOCALES[LANG] || 'en-US', { style: 'currency', currency: cur, minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n); } catch { return `${n} ${cur}`; } };
const vnDay = (d) => d ? fmt(d, { month: 'short', day: 'numeric', ...(d.slice(0, 4) !== todayYMD().slice(0, 4) ? { year: 'numeric' } : {}) }) : '';
const vnCur = () => { const P = vnP(); return P.vendors[B.vnIdx] || null; };
const vnEmpty = (v) => !(v.cat || v.name.trim() || v.contact || v.phone || v.email || v.web || v.addr || v.total != null || v.notes.trim() || v.pays.length);
let VN_AI = null; // does the deployed importer read invoices? (null = not asked yet)
function vnAIKnown() { if (VN_AI !== null || !SB || !LS.get('signedIn')) return; VN_AI = false; aiModes().then(m => { VN_AI = m.includes('vendor'); if (VN_AI && B && $('[data-vn-root]')) vnRepaint(); }).catch(() => {}); }
// Builder → Vendors (an accordion like Basics/Design; Weddings have it on, any page can turn it on in Sections)
function vnAccHTML(c, open) {
  if (!vnOn(c)) return '';
  const P = vnP(); if (B.card !== 'vendor' && P.vendors.some(vnEmpty)) { P.vendors = P.vendors.filter(v => !vnEmpty(v)); LS.set('priv:' + B.pid, P); }
  const T = vnTotals(P); const n = P.vendors.length; const over = T.due.some(d => vnDueSt(d.x.due) === 'over');
  const sum = n ? `${n} · ${vnMoney(T.paid, P.cur)} of ${vnMoney(T.total, P.cur)} paid` : '';
  return `<details class="acc vn-acc" data-acc="vendors" ${open ? 'open' : ''}><summary><span class="st ${over ? 'due' : n ? 'ok' : ''}" aria-hidden="true"></span><b>${t('Vendors')}</b><small>${esc(sum)}</small></summary><div class="acc-b" data-vn-root data-vn-zone data-doc-drop>${vnBodyHTML(c, P, T)}</div></details>`;
}
function vnBodyHTML(c, P, T) {
  const cur = P.cur; vnAIKnown();
  const tile = (l, v, cl = '') => `<div class="${cl}"><small>${l}</small><b>${esc(vnMoney(v, cur))}</b></div>`;
  const tiles = P.vendors.length ? `<div class="vn-tot" data-vn-tot>${tile('Committed', T.total)}${tile('Paid', T.paid)}${tile('Remaining', T.left, 'left')}</div>` : '';
  const due = T.due.slice(0, 6);
  const dueHTML = due.length ? `<p class="grp">${t('Next due')}</p><ul class="vn-due">${due.map(d => { const st = vnDueSt(d.x.due);
    return `<li class="${st}"><button type="button" class="vn-due-b" data-vn-open="${d.vi}"><span class="vn-d">${st === 'over' ? 'Overdue · ' : ''}${esc(vnDay(d.x.due))}</span><span class="vn-n">${esc(d.v.name || d.v.cat || 'Vendor')}</span><b>${esc(vnMoney(d.x.amt, cur))}</b></button><button type="button" class="btn sm" data-vn-paid="${d.vi}:${d.pi}">${t('Mark paid')}</button></li>`; }).join('')}</ul>` : '';
  const list = P.vendors.length ? `<p class="grp">${t('All vendors')}</p><ul class="vn-list">${P.vendors.map((v, i) => { const k = vnCalc(v); const pct = k.total ? Math.min(100, Math.round(k.paid / k.total * 100)) : 0;
    const line = [k.total ? `${vnMoney(k.paid, cur)} of ${vnMoney(k.total, cur)} paid` : k.paid ? `${vnMoney(k.paid, cur)} paid` : '', k.next ? `next ${vnDay(k.next.due)}` : ''].filter(Boolean).join(' · ');
    return `<li><button type="button" class="vn-row${k.total && !k.left ? ' done' : ''}" data-vn-open="${i}"><span class="vn-cat">${esc([v.cat, v.sched].filter(Boolean).join(' · ') || 'Vendor')}</span><b>${esc(v.name || 'Unnamed')}</b>${k.total ? `<span class="vn-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>` : ''}${line ? `<small>${esc(line)}</small>` : ''}</button></li>`; }).join('')}</ul>` : '';
  const imp = VN_AI ? `<label class="btn sm file-pick">${t('Fill from invoice')}<input type="file" accept="${DOC_ACCEPT}" data-vn-file hidden></label>` : '';
  return `${tiles}${dueHTML}${list}<div class="btns vn-acts"><button type="button" class="btn sm primary" data-vn-add>${t('+ Add vendor')}</button>${imp}<select class="vn-cursel" data-vn-cursel aria-label="${t('Currency')}">${V_CURS.map(x => `<option ${x === cur ? 'selected' : ''}>${x}</option>`).join('')}</select></div><p class="hint" data-vn-msg role="status" aria-live="polite"></p>`;
}
function vnRepaint() { const r = $('[data-vn-root]'); if (!r || !B) return; const d = r.closest('details'); const h = vnAccHTML(B.cfg, d && d.open); if (h) d.outerHTML = h; else d.remove(); }
const vnKHTML = (v, cur) => { const k = vnCalc(v); return [`Paid ${vnMoney(k.paid, cur)}`, `Remaining ${vnMoney(k.left, cur)}`, k.next ? `Next ${vnMoney(k.next.amt, cur)} ${vnDay(k.next.due)}` : ''].filter(Boolean).join(' · '); };
// the vendor sheet (B.card 'vendor', B.vnIdx)
function vnSheetHTML(c) {
  const P = vnP(); const v = vnCur(); if (!v) return ''; const cur = P.cur;
  const inp = (k, label, type = 'text', more = '') => fieldWrap(label, `<input id="vn-${k}" type="${type}" data-vnf="${k}" value="${esc(v[k] ?? '')}"${more}>`, 'vn-' + k);
  const scheds = [...new Set((c.schedule || []).map(x => (x.title || '').trim()).filter(Boolean))].slice(0, 40);
  const sched = scheds.length ? fieldWrap('For', `<select id="vn-sched" data-vnf="sched"><option value="">—</option>${scheds.concat(v.sched && !scheds.includes(v.sched) ? [v.sched] : []).map(x => `<option ${x === v.sched ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`, 'vn-sched') : '';
  const pays = v.pays.map((x, i) => { const st = x.paid ? 'paid' : vnDueSt(x.due);
    return `<div class="vn-pay ${st}" data-vn-pay="${i}"><div class="vn-pr"><label class="vn-dl"><small>${t('Amount')}</small><input data-vnp="${i}" data-vnk="amt" inputmode="decimal" value="${x.amt ?? ''}" placeholder="0"></label>
      <label class="vn-dl"><small>${st === 'over' ? 'Overdue' : 'Due'}</small><input type="date" data-vnp="${i}" data-vnk="due" value="${esc(x.due)}"></label></div>
      <div class="vn-pr2">${x.paid ? `<div class="vn-dl vn-paid"><small><span>${t('Paid')}</span><button type="button" class="link" data-vn-unpaid="${i}">${t('Unpaid')}</button></small><input type="date" data-vnp="${i}" data-vnk="paid" value="${esc(x.paid)}" aria-label="${t('Paid on')}"></div>` : `<button type="button" class="btn sm" data-vn-mark="${i}">${t('Mark paid')}</button>`}
      <input data-vnp="${i}" data-vnk="note" value="${esc(x.note)}" placeholder="${t('Method or note')}" aria-label="${t('Method or note')}" maxlength="300"><button type="button" class="link vn-x" data-vn-pdel="${i}" aria-label="${t('Remove payment')}">×</button></div></div>`; }).join('');
  const imp = VN_AI ? `<label class="btn sm file-pick">${t('Fill from invoice')}<input type="file" accept="${DOC_ACCEPT}" data-vn-file="${B.vnIdx}" hidden></label>` : '';
  setTimeout(vnWireAC, 0);
  return `<div class="vn-sheet" data-vn-zone data-doc-drop>
    <div class="chips vn-cats" role="group" aria-label="${t('Category')}">${V_CATS.map(x => `<button type="button" class="chip ${v.cat === x ? 'on' : ''}" aria-pressed="${v.cat === x}" data-vn-cat="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    ${fieldWrap('Business', `<input id="vn-name" data-vnf="name" value="${esc(v.name)}" maxlength="120" placeholder="${t('Name')}">`, 'vn-name')}
    <div class="vn-2">${inp('contact', 'Contact person', 'text', ' maxlength="120"')}${inp('phone', 'Phone', 'tel', ' maxlength="40"')}</div>
    <div class="vn-2">${inp('email', 'Email', 'email', ' maxlength="160"')}${inp('web', 'Website', 'url', ' placeholder="https://…" maxlength="400"')}</div>
    ${inp('addr', 'Address', 'text', ' maxlength="300"')}
    <div class="vn-2">${fieldWrap(`Contract total (${cur})`, `<input id="vn-total" data-vnf="total" inputmode="decimal" value="${v.total ?? ''}" placeholder="0">`, 'vn-total')}${sched}</div>
    <h3 class="sub-h">${t('Payments')}</h3><p class="vn-k" data-vn-k>${esc(vnKHTML(v, cur))}</p>
    ${pays}<div class="btns"><button type="button" class="btn sm" data-vn-padd>${t('+ Add payment')}</button>${imp}</div>
    ${fieldWrap('Notes', `<textarea id="vn-notes" data-vnf="notes" rows="3" maxlength="3000">${esc(v.notes)}</textarea>`, 'vn-notes')}
    <p class="hint" data-vn-msg role="status" aria-live="polite"></p>
    <div class="btns"><button type="button" class="btn sm bk-rm" data-vn-del>${TRASH_IC}${t('Delete vendor')}</button></div></div>`;
}
function vnOpen(i) { B.vnIdx = i; openCard('vendor'); }
// business name → Google place: fills the address, phone and website
function vnPlace(id, tok) {
  return gFetch(`https://places.googleapis.com/v1/places/${enc(id)}${tok ? '?sessionToken=' + enc(tok) : ''}`, null, 'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri')
    .then(x => ({ name: (x.displayName && x.displayName.text) || '', addr: x.formattedAddress || '', phone: x.nationalPhoneNumber || x.internationalPhoneNumber || '', web: cleanWeb(x.websiteUri || '') }));
}
function vnWireAC() {
  const inp = $('#sheet #vn-name'); if (!inp) return;
  placeAutocomplete(inp, { bias: () => B && B.cfg.venue, onPick: (id, tok) => vnPlace(id, tok).then(r => { const v = vnCur(); if (!v) return;
    if (r.name) v.name = r.name.slice(0, 120); ['addr', 'phone', 'web'].forEach(k => { if (r[k]) v[k] = r[k].slice(0, k === 'web' ? 400 : 300); }); vnSave(); renderSheet(); }).catch(() => toast(t('Couldn’t load that place'))) });
}
// invoice / contract → a vendor and its payments (ai-import mode "vendor"); only empty fields are filled
function vnMerge(P, v, d) {
  const a = (d && d.vendor) || {}; const s = (x, n) => typeof x === 'string' ? x.trim().slice(0, n) : '';
  const set = (k, val) => { if (val && !(typeof v[k] === 'string' ? v[k].trim() : v[k] != null)) v[k] = val; };
  if (!v.cat && V_CATS.includes(a.category)) v.cat = a.category;
  set('name', s(a.name, 120)); set('contact', s(a.contact, 120)); set('phone', s(a.phone, 40)); set('email', s(a.email, 160)); set('web', s(a.website, 400).replace(/^(?!https?:\/\/)(?=[\w-]+\.)/i, 'https://')); set('addr', s(a.address, 300));
  if (v.total == null && vnNum(a.total) != null) v.total = vnNum(a.total);
  const notes = s(a.notes, 1000); if (notes && !v.notes.includes(notes)) v.notes = (v.notes ? v.notes + '\n' : '') + notes;
  if (V_CURS.includes(a.currency) && a.currency !== P.cur && P.vendors.every(x => x === v || (x.total == null && !x.pays.length))) P.cur = a.currency;
  let n = 0;
  for (const x of (Array.isArray(d && d.payments) ? d.payments : []).slice(0, 30)) {
    const amt = vnNum(x && x.amount); if (amt == null) continue; const due = isDate(x.due) ? x.due : ''; const paid = isDate(x.paid) ? x.paid : '';
    const same = v.pays.find(y => y.amt === amt && (y.due === due || !due || !y.due)); if (same) { if (paid && !same.paid) same.paid = paid; if (due && !same.due) same.due = due; continue; }
    v.pays.push({ id: vnId(), amt, due, paid, note: s(x.note, 300) }); n++;
  }
  v.pays.sort((x, y) => (x.due || '9') < (y.due || '9') ? -1 : (x.due || '9') > (y.due || '9') ? 1 : 0);
  return n;
}
const vnMsg = (s) => $$('[data-vn-msg]').forEach(el => { el.textContent = s; });
async function vnImport(file, vi) {
  if (!file || !B) return;
  if (!LS.get('signedIn')) { vnMsg('Sign in to fill from a document.'); return; }
  vnMsg('Reading…');
  try {
    const part = await bookingFile(file);
    const j = await aiImport({ mode: 'vendor', files: [part], ...(isDate((B.cfg.start || '').slice(0, 10)) ? { event_date: B.cfg.start.slice(0, 10) } : {}) });
    const P = vnP(); const undo = clone(P);
    let v = vi != null ? P.vendors[vi] : null; if (!v) { v = vnBlank(); P.vendors.push(v); vi = P.vendors.length - 1; }
    const n = vnMerge(P, v, j.data); vnSave();
    const pid = B.pid; const back = () => { if (!B || B.pid !== pid) return; B.priv = vnNorm(undo); B.privPid = pid; vnSave(); if (B.card === 'vendor') $('#sheet').close(); else vnRepaint(); };
    if (B.card === 'vendor' && B.vnIdx === vi) renderSheet(); else vnOpen(vi);
    undoToast(t('Filled {v}', { v: v.name || t('vendor') }) + (n ? ' · ' + t(n === 1 ? '1 payment' : '{n} payments', { n }) : ''), back);
  } catch (e) { vnMsg(e.signin ? 'Sign in to fill from a document.' : e.message || 'Couldn’t read it.'); }
}
// account sync: pull once per page open (the newer copy wins), then push each change ~1 s later
async function vnSync() {
  if (!B || !acctOn() || !B.hosted || !B.hosted.id) return;
  const pid = B.pid, eid = B.hosted.id; if (B.vnPulled === eid) return; B.vnPulled = eid;
  try {
    const c = await sb(); const { data, error } = await c.from('event_private').select('data,updated_at').eq('event_id', eid).maybeSingle();
    if (!B || B.pid !== pid) return;
    if (error) { B.vnPulled = null; return; } // not installed yet / offline: stays on this device
    B.vnOk = eid; const P = vnP(); const R = data && data.data ? vnNorm(data.data) : null;
    if (R && R.t > P.t) { B.priv = R; B.privPid = pid; LS.set('priv:' + pid, R); if (B.card === 'vendor') renderSheet(); buildForm(); }
    else if (vnHas(P) && (!R || P.t > R.t)) await vnPushNow();
  } catch { if (B && B.pid === pid) B.vnPulled = null; }
}
function vnPushSoon() { if (!B || !B.hosted || B.vnOk !== B.hosted.id) { if (B && acctOn() && B.hosted && B.hosted.id) vnSync(); return; } clearTimeout(B.vnT); B.vnT = setTimeout(vnPushNow, 1000); }
async function vnPushNow() {
  if (!B) return; clearTimeout(B.vnT); B.vnT = null; if (!acctOn() || !B.hosted || B.vnOk !== B.hosted.id) return;
  const eid = B.hosted.id; const P = vnP();
  try { const c = await sb(); const { error } = await c.from('event_private').upsert({ event_id: eid, data: JSON.parse(JSON.stringify(P)) }, { onConflict: 'event_id' }); if (error) vnMsg('Saved on this device'); } catch { /* offline: next change or open retries */ }
}
addEventListener('pagehide', () => { if (B && B.vnT) vnPushNow(); });
// one set of listeners for the Vendors accordion, the vendor sheet and the Sections switch
function wireVendors() {
  if (wireVendors.on) return; wireVendors.on = true;
  const live = () => B && $('.builder');
  document.addEventListener('click', (e) => {
    if (!live()) return; const b = e.target.closest('button'); if (!b || !b.closest('[data-vn-root], .vn-sheet')) return; const d = b.dataset; const P = vnP();
    if ('vnAdd' in d) { P.vendors.push(vnBlank()); vnSave(); vnOpen(P.vendors.length - 1); setTimeout(() => $('#sheet #vn-name')?.focus(), 30); return; }
    if (d.vnOpen != null) { vnOpen(+d.vnOpen); return; }
    if (d.vnPaid) { const [vi, pi] = d.vnPaid.split(':').map(Number); const x = P.vendors[vi] && P.vendors[vi].pays[pi]; if (!x) return; x.paid = todayYMD(); vnSave(); vnRepaint(); const pid = B.pid;
      undoToast(`Marked ${vnMoney(x.amt, P.cur)} paid`, () => { if (!B || B.pid !== pid) return; x.paid = ''; vnSave(); vnRepaint(); }); return; }
    const v = vnCur(); if (!v || !b.closest('.vn-sheet')) return;
    if (d.vnCat) { v.cat = v.cat === d.vnCat ? '' : d.vnCat; vnSave(); $$('#sheet [data-vn-cat]').forEach(x => { const on = x.dataset.vnCat === v.cat; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }); }
    else if (d.vnMark != null) { const x = v.pays[+d.vnMark]; if (x) { x.paid = todayYMD(); vnSave(); renderSheet(); } }
    else if (d.vnUnpaid != null) { const x = v.pays[+d.vnUnpaid]; if (x) { x.paid = ''; vnSave(); renderSheet(); } }
    else if ('vnPadd' in d) { const rest = v.total != null && v.pays.length ? Math.round((v.total - vnSum(v.pays.map(y => y.amt))) * 100) / 100 : 0; // the next one defaults to what's still unscheduled
      v.pays.push({ id: vnId(), amt: rest > 0 ? rest : null, due: '', paid: '', note: '' }); vnSave(); renderSheet(); setTimeout(() => $$('#sheet [data-vnk="amt"]').pop()?.focus(), 30); }
    else if (d.vnPdel != null) { v.pays.splice(+d.vnPdel, 1); vnSave(); renderSheet(); }
    else if ('vnDel' in d) { const i = P.vendors.indexOf(v); if (i < 0) return; const pid = B.pid; P.vendors.splice(i, 1); vnSave(); $('#sheet').close();
      if (!vnEmpty(v)) undoToast(`Deleted ${v.name || v.cat || 'vendor'}`, () => { if (!B || B.pid !== pid) return; const Q = vnP(); Q.vendors.splice(Math.min(i, Q.vendors.length), 0, v); vnSave(); vnRepaint(); }); }
  });
  document.addEventListener('input', (e) => {
    if (!live()) return; const i = e.target; const d = i.dataset; if (d.vnf == null && d.vnp == null) return; const v = vnCur(); if (!v) return; const P = vnP();
    if (d.vnf) v[d.vnf] = d.vnf === 'total' ? vnNum(i.value) : i.value.slice(0, 3000);
    else { const x = v.pays[+d.vnp]; if (!x) return; x[d.vnk] = d.vnk === 'amt' ? vnNum(i.value) : (d.vnk === 'due' || d.vnk === 'paid') ? (isDate(i.value) ? i.value : '') : i.value.slice(0, 300);
      const row = i.closest('[data-vn-pay]'); if (row) { ['over', 'soon', 'paid'].forEach(k => row.classList.remove(k)); const st = x.paid ? 'paid' : vnDueSt(x.due); if (st) row.classList.add(st); } }
    vnSave(); const k = $('#sheet [data-vn-k]'); if (k) k.textContent = vnKHTML(v, P.cur);
  });
  document.addEventListener('change', (e) => {
    if (!live()) return; const i = e.target; const d = i.dataset;
    if (d.vnOn != null) { const P = vnP(); P.on = i.checked; vnSave(); buildForm(); return; }
    if (d.vnCursel != null) { const P = vnP(); if (V_CURS.includes(i.value)) { P.cur = i.value; vnSave(); vnRepaint(); } return; }
    if (d.vnFile != null && i.files && i.files[0]) { const f = i.files[0]; i.value = ''; vnImport(f, d.vnFile === '' ? null : +d.vnFile); }
    if (d.vnk === 'paid' && !i.value) renderSheet(); // paid date cleared: back to Mark paid
  });
  const zone = (e) => live() && e.target.closest && e.target.closest('[data-vn-zone]');
  document.addEventListener('drop', (e) => { const z = zone(e); if (!z || !dragFiles(e)) return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; if (VN_AI === false) return; vnImport(f, z.closest('.vn-sheet') ? B.vnIdx : null); });
  document.addEventListener('paste', (e) => {
    if (!live()) return; const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(x => /^image\/|pdf$/.test(x.type)); if (!f) return;
    const sh = $('#sheet'); const inSheet = sh && sh.open && B.card === 'vendor'; const inAcc = !inSheet && document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-vn-root]');
    if (!inSheet && !inAcc) return; e.preventDefault(); e.stopPropagation(); vnImport(f, inSheet ? B.vnIdx : null);
  }, true);
}
window.__epv = { vnNorm, vnCalc, vnTotals, vnMerge, vnDueSt, vnP: () => vnP(), V_CATS };
// ================= "Match your brand": a website link or an uploaded logo/screenshot → a proposed theme =================
// Link: ai-import mode "brand" reads the site's theme-color, CSS colors and variables, fonts and logo (server side, no model).
// Upload: the image's own colors, found here in the browser (k-means over a downscaled copy). Either way the accent is
// moved just enough to keep WCAG AA (4.5:1) against the page and its button text, and shown as a preview with Apply / Undo.
const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgbHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function rgbHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h / 6, s, l];
}
function hslHex(h, s, l) {
  if (!s) return rgbHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return rgbHex(f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255);
}
const relLum = (hex) => { const c = hexRgb(hex); if (!c) return 0; const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// the page's own background and card colors per mode (styles.css .ev / .ev.dark) and its text color
const PAGE_BG = { light: ['#F2F3F6', '#FFFFFF'], dark: ['#0F1116', '#181B22'] };
const PAGE_INK = { light: '#12141B', dark: '#EDEFF3' };
const aaOK = (hex, mode) => PAGE_BG[mode].every(bg => contrast(hex, bg) >= 4.5) && contrast(hex, onAccent(hex)) >= 4.5;
// same hue and saturation, lightness moved toward readable (darker on light pages, lighter on dark ones)
function aaAccent(hex, mode) {
  if (aaOK(hex, mode)) return hex.toLowerCase();
  const [h, s, l0] = rgbHsl(hexRgb(hex)); const dir = mode === 'dark' ? 1 : -1;
  for (let i = 1; i <= 100; i++) { const l = l0 + dir * i * 0.01; if (l < 0 || l > 1) break; const x = hslHex(h, s, l); if (aaOK(x, mode)) return x; }
  return mode === 'dark' ? '#e6e8ee' : '#1f2937';
}
// a site's font family → the closest of the page's title fonts
const FONT_HINTS = [
  ['condensed', /condensed|narrow|compressed|oswald|bebas|anton|league gothic|big shoulders|fjalla|teko|antonio|alumni sans|tungsten|knockout|druk(?! ?wide)|barlow semi condensed/i],
  ['wide', /extended|expanded|\bwide\b|unbounded|syncopate|michroma|krona|monument|druk ?wide|archivo black|clash display|lexend (zetta|peta|giga|mega|exa|tera)/i],
  ['classic', /garamond|cormorant|caslon|didot|bodoni|baskerville|playfair|cinzel|trajan|copperplate|nineties|\bogg\b|canela|gt super|italiana|bellefair|marcellus/i],
  ['serif', /fraunces|dm serif|recoleta|cooper|young serif|gloock|abril|tiempos|copernicus|new.?spirit|serif display|editorial|domaine|freight|lora|libre baskerville/i],
  ['field', /newsreader|georgia|merriweather|source serif|pt serif|noto serif|times|charter|crimson|spectral|literata|slab|serif/i],
];
function closestFont(fams, cur) {
  const list = (fams || []).filter(Boolean); if (!list.length) return cur;
  for (const f of list.slice(0, 2)) { const hit = FONT_HINTS.find(([, re]) => re.test(f)); if (hit) return hit[0]; }
  return 'grotesk';
}
const isNeutral = (hex) => { const [, s, l] = rgbHsl(hexRgb(hex)); return s < 0.2 || l < 0.08 || l > 0.94; };
// best brand color from weighted candidates [{ hex, w }]: saturated mid-tones win, a dark neutral (black CTAs) next
function pickAccent(cands, bg) {
  const agg = new Map(); for (const c of cands) { const h = String(c.hex || '').toLowerCase(); if (hexRgb(h)) agg.set(h, (agg.get(h) || 0) + c.w); }
  let best = '', bs = 0;
  for (const [hex, w] of agg) {
    if (bg && contrast(hex, bg) < 1.25) continue; // the background itself
    const [, s, l] = rgbHsl(hexRgb(hex));
    const f = s >= 0.28 && l > 0.12 && l < 0.88 ? 1 + s : l < 0.3 ? 0.4 : 0.03;
    if (w * f > bs) { bs = w * f; best = hex; }
  }
  return best;
}
// (library defaults like Swiper's --swiper-theme-color or Bootstrap's --bs-primary aren't the site's brand)
const SKIP_VAR = /on-|fore|text|background|\bbg\b|-bg|surface|border|shadow|overlay|muted|neutral|gr[ae]y|white|black|swiper|--bs-|bootstrap|--wp--preset|chakra|--mui|--tw-|--rdp|toastify|plyr|fancybox|slick|select2|flatpickr/i;
// ai-import "brand" data → { accent, mode, font, logo, adjusted }
function brandFromSite(d, cur) {
  if (!d) return null;
  const max = Math.max(1, ...(d.colors || []).map(c => c.n));
  const theme = d.themeColor && hexRgb(d.themeColor) ? d.themeColor : '';
  const bg = (d.background && hexRgb(d.background) ? d.background : '') || (theme && isNeutral(theme) ? theme : '') || '#ffffff';
  const mode = relLum(bg) < 0.2 ? 'dark' : 'light';
  const cands = [...(d.colors || []).map(c => ({ hex: c.hex, w: (c.n / max) * 100 })), ...(d.vars || []).filter(v => !SKIP_VAR.test(v.name)).map(v => ({ hex: v.hex, w: 40 })), ...(theme ? [{ hex: theme, w: 60 }] : [])];
  const raw = pickAccent(cands, bg); if (!raw) return null;
  const accent = aaAccent(raw, mode);
  return { accent, raw, mode, font: closestFont(d.fonts, cur.font), logo: httpsUrl(d.logo) ? d.logo : '', adjusted: accent !== raw.toLowerCase(), src: 'site' };
}
// pixels → up to k color clusters [{ hex, n }] (n = share 0..1), plus the border's main color and whether it's see-through
function imagePalette(data, w, h, k = 8) {
  const px = []; let clear = 0; const edge = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (data[i + 3] < 128) { clear++; continue; }
    const p = [data[i], data[i + 1], data[i + 2]]; px.push(p); if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge.push(p);
  }
  if (!px.length) return { clusters: [], edge: '', clear: 1 };
  // seeds: the most common colors on a coarse grid, spread apart
  const grid = new Map(); for (const p of px) { const key = (p[0] >> 5) << 6 | (p[1] >> 5) << 3 | (p[2] >> 5); const g = grid.get(key) || [0, 0, 0, 0]; g[0] += p[0]; g[1] += p[1]; g[2] += p[2]; g[3]++; grid.set(key, g); }
  const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  let cen = [...grid.values()].sort((a, b) => b[3] - a[3]).map(g => [g[0] / g[3], g[1] / g[3], g[2] / g[3]]).reduce((acc, c) => { if (acc.length < k && acc.every(a => dist(a, c) > 900)) acc.push(c); return acc; }, []);
  const lab = new Int16Array(px.length);
  for (let it = 0; it < 10; it++) {
    const sum = cen.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => { let bi = 0, bd = Infinity; cen.forEach((c, j) => { const d2 = dist(p, c); if (d2 < bd) { bd = d2; bi = j; } }); lab[i] = bi; const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    cen = cen.map((c, j) => sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c);
  }
  const n = cen.map(() => 0); lab.forEach(j => { n[j]++; });
  const clusters = cen.map((c, j) => ({ hex: rgbHex(...c), n: n[j] / px.length })).filter(c => c.n > 0).sort((a, b) => b.n - a.n);
  let edgeHex = ''; if (edge.length) { const en = cen.map(() => 0); edge.forEach(p => { let bi = 0, bd = Infinity; cen.forEach((c, j) => { const d2 = dist(p, c); if (d2 < bd) { bd = d2; bi = j; } }); en[bi]++; }); const j = en.indexOf(Math.max(...en)); if (en[j] / edge.length > 0.4) edgeHex = rgbHex(...cen[j]); }
  return { clusters, edge: edgeHex, clear: clear / (w * h) };
}
// palette → { accent, mode, font (unchanged), logoOK }: a logo (see-through) keeps the page light unless it's a light logo;
// a screenshot's border color is its background
function brandFromPalette(pal, cur) {
  if (!pal || !pal.clusters.length) return null;
  const logoLike = pal.clear > 0.05;
  const bg = logoLike ? '' : pal.edge || pal.clusters[0].hex;
  const avgL = pal.clusters.reduce((a, c) => a + relLum(c.hex) * c.n, 0);
  const mode = bg ? (relLum(bg) < 0.2 ? 'dark' : 'light') : avgL > 0.7 ? 'dark' : 'light';
  const raw = pickAccent(pal.clusters.filter(c => c.n >= 0.01).map(c => ({ hex: c.hex, w: c.n * 100 })), bg || PAGE_BG[mode][0]); if (!raw) return null;
  const accent = aaAccent(raw, mode);
  return { accent, raw, mode, font: cur.font, logo: '', logoOK: logoLike, adjusted: accent !== raw.toLowerCase(), src: 'image' };
}
async function fileImage(file) {
  const url = URL.createObjectURL(file);
  // the object URL stays alive: the preview shows the uploaded logo from it until Apply uploads a copy
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Use a photo or screenshot (PNG, JPG).')); }; i.src = url; });
}
function paletteOfImage(img, side = 120) {
  const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight)); const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, c.width, c.height);
  return imagePalette(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}
// a logo keeps its transparency: PNG, at most 600 px on the long side
async function logoBlob(img) {
  const k = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight)); const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/png'));
}
const brandRepaint = () => { if (!B) return; if (B.card) renderSheet(); else buildForm(); };
const BR = () => (B.brand = B.brand || { url: '' });
async function brandFromLink() {
  const st = BR(); const url = normSite(st.url || ''); if (!url) { st.msg = t('That doesn’t look like a website link.'); return brandRepaint(); }
  if (!LS.get('signedIn')) { st.msg = t('Sign in to read a website, or upload your logo or a screenshot instead.'); return brandRepaint(); }
  st.busy = true; st.msg = t('Reading the site’s colors…'); st.prop = null; brandRepaint();
  try {
    if (!(await aiModes()).includes('brand')) throw new Error('Reading a website isn’t available yet. Upload your logo or a screenshot instead.');
    const j = await aiImport({ mode: 'brand', url });
    const p = brandFromSite(j.data, B.cfg.theme);
    st.prop = p; st.msg = p ? '' : t('No clear brand colors on that site. Try uploading your logo or a screenshot.');
  } catch (e) { st.msg = e.signin ? t('Sign in to read a website, or upload your logo or a screenshot instead.') : (e.message || t('Couldn’t read that site.')); }
  st.busy = false; brandRepaint();
}
async function brandFromFile(file) {
  const st = BR(); if (!file) return;
  if (!/^image\//.test(file.type)) { st.msg = t('Use a photo or screenshot (PNG, JPG).'); return brandRepaint(); }
  try {
    const img = await fileImage(file); const p = brandFromPalette(paletteOfImage(img), B.cfg.theme);
    if (!p) { st.prop = null; st.msg = t('Couldn’t find colors in that image.'); return brandRepaint(); }
    if (p.logoOK) { p.logoImg = img; p.logo = img.src; p.useLogo = true; }
    st.prop = p; st.msg = '';
  } catch (e) { st.prop = null; st.msg = e.message || t('Couldn’t read that image.'); }
  brandRepaint();
}
async function brandApply() {
  const st = BR(); const p = st.prop; if (!p) return; const cfg = B.cfg;
  let logo = '';
  if (p.logo && p.useLogo !== false) {
    if (p.logoImg) {
      if (!LS.get('signedIn') || !SB) { st.msg = t('Applied the colors. Sign in to add the logo too.'); }
      else { try { st.msg = t('Uploading the logo…'); brandRepaint(); const blob = await logoBlob(p.logoImg); const f = await docUpload({ name: 'logo.png' }, { blob, type: 'image/png', name: 'logo.png', kind: 'image' }); logo = f.url; } catch (e) { st.msg = t('Applied the colors; the logo didn’t upload ({e}).', { e: e.message || 'error' }); } }
    } else logo = p.logo;
  }
  st.undo = { theme: { ...cfg.theme }, logo: cfg.logo || '' };
  cfg.theme = { ...cfg.theme, accent: p.accent, mode: p.mode, font: p.font }; loadFont(p.font);
  if (logo) cfg.logo = logo;
  B.customColor = !COLOR_NAME[p.accent.toLowerCase()];
  if (!/^Applied/.test(st.msg || '')) st.msg = '';
  st.prop = null; st.applied = true; changed(true);
}
function brandUndo() {
  const st = BR(); if (!st.undo) return; const cfg = B.cfg;
  cfg.theme = { ...st.undo.theme }; if (st.undo.logo) cfg.logo = st.undo.logo; else delete cfg.logo; loadFont(cfg.theme.font);
  B.customColor = !COLOR_NAME[cfg.theme.accent.toLowerCase()]; st.undo = null; st.applied = false; st.msg = t('Back to your previous design.'); changed(true);
}
function brandHTML(c) {
  const st = (B && B.brand) || { url: '' }; const p = st.prop;
  const prev = p ? (() => {
    const ink = PAGE_INK[p.mode]; const fnt = FONTS[p.font] || FONTS.field; loadFont(p.font);
    return `<div class="brand-prev${p.mode === 'dark' ? ' dark' : ''}" style="--pa:${esc(p.accent)};--po:${onAccent(p.accent)};--pi:${ink}">
      ${p.logo && p.useLogo !== false ? `<img class="bp-logo" src="${esc(p.logo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <b class="bp-title" style="font-family:${esc(fnt.css)}">${esc(c.title || t('Your event'))}</b>
      <span class="bp-row"><span class="bp-btn">${t('Get directions')}</span><span class="bp-link">${t('Add to calendar')}</span></span></div>
    <ul class="bp-facts">
      <li><span class="ddot" style="background:${esc(p.accent)}" aria-hidden="true"></span>${t('Color')} <b>${esc(colorName(p.accent) === 'Custom' ? p.accent.toUpperCase() : colorName(p.accent))}</b>${p.adjusted ? ' <small class="muted">(adjusted so text stays readable)</small>' : ''}</li>
      <li><span class="ddot${p.mode === 'dark' ? ' dk' : ' lt'}" aria-hidden="true"></span>${t('Background')} <b>${p.mode === 'dark' ? 'Dark' : 'Light'}</b></li>
      <li><span class="ddot" style="background:${PAGE_INK[p.mode]}" aria-hidden="true"></span>${t('Text')} <b>${p.mode === 'dark' ? 'Light on dark' : 'Dark on light'}</b></li>
      <li><span class="dprev" style="font-family:${esc(fnt.css)}" aria-hidden="true">Aa</span>${t('Title font')} <b>${esc(fnt.label)}</b>${p.font === c.theme.font ? ' <small class="muted">(unchanged)</small>' : ''}</li>
    </ul>
    ${p.logo ? `<label class="chk"><input type="checkbox" data-brand-logo ${p.useLogo !== false ? 'checked' : ''}> ${t('Use the logo')}</label>` : ''}
    <div class="btns"><button type="button" class="btn primary sm" data-brand="apply">${t('Apply')}</button><button type="button" class="btn sm ghost" data-brand="cancel">${t('Cancel')}</button></div>`;
  })() : '';
  return `<div class="field brand-m" data-brand-box><label for="d-brand-url">${t('Match your brand')}</label>
    <p class="hint">${t('Paste your website, or upload your logo or a screenshot. You’ll see the colors and font before anything changes.')}</p>
    ${SB ? `<div class="search"><input id="d-brand-url" type="url" inputmode="url" placeholder="https://yourwebsite.com" autocomplete="off" data-brand-url value="${esc(st.url || '')}"><button type="button" class="btn${st.busy ? ' busy' : ''}" data-brand="go" ${st.busy ? 'disabled' : ''}>${t('Get colors')}</button></div>` : ''}
    <div class="brand-up"><label class="btn sm file-pick">${t('Upload logo or screenshot')}<input type="file" accept="image/*" data-brand-file hidden></label></div>
    <p class="hint" data-brand-msg role="status" aria-live="polite">${esc(st.msg || '')}${st.undo && !p ? `${st.msg ? ' ' : ''}${t('Brand applied.')} <button type="button" class="link" data-brand="undo">${t('Undo')}</button>` : ''}</p>
    ${prev}</div>`;
}
function brandClick(b) {
  const k = b.dataset.brand; const st = BR();
  if (k === 'go') { const i = document.querySelector('[data-brand-url]'); if (i) st.url = i.value; if (!st.busy) brandFromLink(); }
  else if (k === 'apply') brandApply();
  else if (k === 'cancel') { st.prop = null; st.msg = ''; brandRepaint(); }
  else if (k === 'undo') brandUndo();
  return true;
}
if (!document._brandWired) {
  document._brandWired = true;
  document.addEventListener('change', (e) => { const i = e.target; if (!B || !i.matches) return; if (i.matches('[data-brand-file]')) { const f = i.files && i.files[0]; i.value = ''; brandFromFile(f); } else if (i.matches('[data-brand-logo]')) { const p = BR().prop; if (p) { p.useLogo = i.checked; brandRepaint(); } } });
  document.addEventListener('keydown', (e) => { const i = e.target; if (B && i.matches && i.matches('[data-brand-url]') && e.key === 'Enter') { e.preventDefault(); BR().url = i.value; if (!BR().busy) brandFromLink(); } });
}
// friendly date text over the native picker
const friendlyDate = (d) => d ? new Intl.DateTimeFormat(LOCALES[LANG] || 'en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(asUTC(d)) : '';
document.addEventListener('input', (e) => { const i = e.target; if (!i.matches || !i.matches('.datef input')) return; const s = i.parentElement.querySelector('.datef-txt'); if (s) { s.textContent = friendlyDate(i.value) || i.dataset.ph || ''; s.classList.toggle('ph', !i.value); } });
document.addEventListener('click', (e) => { const i = e.target; if (i.matches && i.matches('.datef input') && i.showPicker) { try { i.showPicker(); } catch { /* not allowed here */ } } });

// ================= dates with optional times =================
// start/end are wall-clock in the venue's zone: 'YYYY-MM-DD' (date only, the default) or 'YYYY-MM-DDTHH:MM'.
const hasTime = (s) => !!s && s.length > 10;
// Calendar span. Date-only events are all-day: { allDay, s: 'YYYY-MM-DD', e: day after the last day }. Timed: UTC Dates.
function eventSpan(cfg) {
  const st = cfg.start, en = cfg.end || '';
  if (!hasTime(st)) return { allDay: true, s: st.slice(0, 10), e: addDays((en && en.slice(0, 10) > st.slice(0, 10) ? en : st).slice(0, 10), 1) };
  const s = wallToUTC(st, cfg.tz);
  let e = en ? wallToUTC(hasTime(en) ? en : en.slice(0, 10) + 'T23:59', cfg.tz) : null;
  if (!e || e <= s) e = new Date(s.getTime() + 2 * 3600e3);
  return { allDay: false, s, e };
}
function countdown(cfg) {
  if (!cfg.start) return '';
  const today = todayYMD(), s = cfg.start.slice(0, 10), e = (cfg.end || cfg.start).slice(0, 10);
  const n = daysBetween(today, s);
  if (n > 1) return t('In {n} days', { n });
  if (n === 1) return t('Tomorrow');
  if (n === 0) return t('Today');
  if (today <= e) return t('Happening now');
  return '';
}
function whenFieldsHTML(c, p, blankDate = false, datesOnly = false) {
  const timed = !datesOnly && hasTime(c.start); const sd = blankDate ? '' : c.start.slice(0, 10); const ed = (c.end || '').slice(0, 10);
  const fld = (k, label, type, val, extra = '') => type === 'date'
    ? `<div class="field"><label for="${p}-${k}">${esc(t(label))}</label><div class="datef"><span class="datef-txt ${val ? '' : 'ph'}" aria-hidden="true">${esc(friendlyDate(val) || t(k === 'ed' ? 'Same day' : 'Choose a date'))}</span><input id="${p}-${k}" type="date" data-when="${k}" data-ph="${esc(t(k === 'ed' ? 'Same day' : 'Choose a date'))}" value="${esc(val)}"${extra}></div></div>`
    : `<div class="field"><label for="${p}-${k}">${esc(t(label))}</label><input id="${p}-${k}" type="${type}" data-when="${k}" value="${esc(val)}"${extra}></div>`;
  return `<div class="when ${timed ? 'timed' : ''}">
    <div class="when-row">${fld('sd', 'Starts', 'date', sd)}${timed ? fld('st', 'Time', 'time', c.start.slice(11, 16)) : ''}</div>
    <div class="when-row">${fld('ed', 'Ends', 'date', ed, sd ? ` min="${sd}"` : '')}${timed ? fld('et', 'Time', 'time', hasTime(c.end) ? c.end.slice(11, 16) : '') : ''}</div>
    ${datesOnly ? '' : `<button type="button" class="link when-tg" data-when-tg>${timed ? t('Remove times') : '+ ' + t('Add time')}</button>`}
  </div>`;
}
function whenInput(c, k, v) {
  const sd = c.start.slice(0, 10), st = hasTime(c.start) ? c.start.slice(11, 16) : '';
  const ed = (c.end || '').slice(0, 10), et = hasTime(c.end) ? c.end.slice(11, 16) : '';
  if (k === 'sd' && v) { c.start = v + (st ? 'T' + st : ''); if (ed && ed < v) c.end = ''; }
  if (k === 'st' && v) c.start = sd + 'T' + v;
  if (k === 'ed') c.end = v && v >= sd ? v + (et ? 'T' + et : '') : '';
  if (k === 'et') c.end = v ? (ed || sd) + 'T' + v : ed;
  if (c.end && c.end.slice(0, 10) === sd && !hasTime(c.end) && !hasTime(c.start)) c.end = '';
}
function whenToggle(c) {
  if (hasTime(c.start)) {
    c.start = c.start.slice(0, 10); const ed = (c.end || '').slice(0, 10); c.end = ed && ed > c.start ? ed : '';
  } else {
    c.start = c.start.slice(0, 10) + 'T18:00'; if (c.end) c.end = c.end.slice(0, 10);
  }
}

// ---------- router ----------
// /<name>: ask the server which page it is (bg = the page is already open from this device's memory: only correct it)
async function pathResolve(bg) {
  const P = PATH; if (!P || !P.name) return;
  if (!bg) $('#app').innerHTML = `<div class="viewer"><div class="vbar"><a class="brand sm" href="${esc(siteBase())}">${BRAND}</a></div><div id="ev-root"><div class="skel" role="status"><span></span><span></span><em>${t('Loading…')}</em></div></div></div>`;
  let r = null, ok = false;
  try { const x = await rest('rpc/page_name_resolve', { method: 'POST', body: { nm: P.name } }); ok = Array.isArray(x); r = ok && x[0] && SLUG_RE.test(x[0].slug || '') ? x[0] : null; } catch { /* below */ }
  if (ok && !r && acctOn()) { // the signed-in organizer's own page that isn't shared yet
    try { const c = await sb(); const { data } = await c.rpc('page_name_resolve', { nm: P.name }); if (Array.isArray(data) && data[0] && SLUG_RE.test(data[0].slug || '')) r = data[0]; } catch { /* as anon */ }
  }
  if (PATH !== P) return;
  if (!ok) { if (!bg) hostedProblem(t('Couldn’t load this page. Check your connection and try again.'), true); return; }
  if (!r) { pnForget(P.name); if (bg) { P.slug = ''; P.checked = false; } return bg ? route() : hostedProblem(t('This page isn’t available. It may have been removed or hidden by its organizer.')); }
  const cur = NAME_RE.test(r.name || '') ? r.name : P.name; pnRemember(P.name, r.slug, cur);
  if (cur !== P.name) { P.name = cur; P.path = APP_ROOT + cur; try { history.replaceState(history.state, '', APP_ROOT + cur + location.search + location.hash); } catch { /* keep */ } }
  if (r.slug !== P.slug) { P.slug = r.slug; P.checked = true; route(); } else if (!bg) route();
}
function route() {
  if (B && B.pushT) acctPushNow(); // leaving the builder: save to the account now
  const full = location.hash.slice(1);
  if (/(^|&)(access_token|error_description|error_code)=/.test(full)) return authReturn();
  const [h, tab] = full.split('&t=');
  maps.forEach(m => { try { m.remove(); } catch {} }); maps.clear();
  if (PATH && location.pathname !== PATH.path) PATH = null; // the app moved the address off the page (My pages, the editor…)
  if (PATH && (h === '' || h.startsWith('t='))) { // a /<name> address
    if (PATH.bad) { SU = null; return hostedProblem(t('This page isn’t available. It may have been removed or hidden by its organizer.')); }
    if (!PATH.slug) { SU = null; return pathResolve(false); }
    if (!PATH.fresh && !PATH.checked) { PATH.checked = true; pathResolve(true); } // known on this device: open now, check in the background
  }
  const qs = locQ(); const qe = qs.get('e'), qd = qs.get('demo');
  if (qe && (h === '' || h.startsWith('t='))) { SU = null; return renderHosted(qe.toLowerCase(), h.startsWith('t=') ? h.slice(2) : tab); }
  if (qd && DEMOS[qd] && (h === '' || h.startsWith('t='))) { SU = null; return renderViewer(normalize(clone(window.EXAMPLES[DEMOS[qd]])), { exampleId: DEMOS[qd], tab: h.startsWith('t=') ? h.slice(2) : tab }); }
  if (qe || qd) history.replaceState(null, '', siteBase() + location.hash);
  if (h === 'mine' || h.startsWith('mine/')) { SU = null; return renderMine(h.slice(5)); }
  if (!h.startsWith('new') && !h.startsWith('setup')) SU = null;
  if (h.startsWith('e=')) { const c = unpackEvent(h.slice(2)); if (c) return renderViewer(c, { tab }); return renderBroken(); }
  if (h.startsWith('ex=')) { const e = window.EXAMPLES[h.slice(3)]; if (e) return renderViewer(normalize(clone(e)), { exampleId: h.slice(3), tab }); return renderBroken(); }
  if (h.startsWith('edit=')) { const c = unpackEvent(h.slice(5)); if (c) { delete c.ek; delete c._ek; return renderBuilder(c, t('Editing a copy. The original link won’t change.')); } return renderBroken(); }
  if (h.startsWith('edit-ex=')) { const e = window.EXAMPLES[h.slice(8)]; if (e) return renderBuilder(clone(e), t('Copy of an example. Tap Share to get your own link.')); }
  if (h === 'examples') { SU = null; return renderExamples(); }
  if (h === 'setup') return renderSetup();
  if (h === 'new') { const d = LS.get('draft'); return d && d.title ? renderBuilder(d, null, LS.get('draftHosted'), LS.get('draftId') || undefined) : renderSetup(); }
  if (h.startsWith('page=')) { const x = pagesAll().find(p => p.pid === h.slice(5)); if (x) { window.__ownTab = tab || ''; return renderBuilder(x.cfg, null, x.hosted, x.pid); } }
  if (h.startsWith('dup=')) { const x = pagesAll().find(p => p.pid === h.slice(4)); if (x) { const pid = newPid(); history.replaceState(null, '', siteBase() + '#page=' + pid); return renderBuilder(duplicateCfg(x.cfg), t('This is a copy. Tap Share to get its own link.'), null, pid); } }
  SU = null; renderLanding();
}

window.addEventListener('hashchange', route);
rtWatch();
route();
if (acctOn() && !/(^|&)(access_token|error_description|error_code)=/.test(location.hash)) setTimeout(acctSyncAll, 800); // every open while signed in
window.__ep = { rtHTML, rtPlain, rtParas, rtToTags, rtFromTags, rtToggle, trWrap, trUnwrap, actKind, ACT_KINDS, gpFilter, actChipsHTML, tripCat, ovApply, ovPick, ovLoad, shareMerge, shareApply, shareData, orgBookingLine, guestView, schedIds, ccIcon, tSub, tSubOfText, ccIk, ccTrip, TRIP_CATS, legDirURL, schedFlightFix, schedZone, hfBadge, hfOfBk, hfOfEv, hostHotelHF, itinICS, freshEvent, rsvpOf, TYPES, rqParse, rqPack, airportChoices, airFor, homeCity, spotCity, spotsByCity, bkCity, bkClean, ccCities, sortStops, shiftDates, applyShifts, bkOffTrip, hotelsNow, hotelStops, stopSuspect, normalize, geocode, openDetail, dsHTML, schedEntries, sampleDropped, spanFixed, tripView, ccCatOfTypes, brandFromSite, brandFromPalette, imagePalette, aaAccent, contrast, closestFont, PAGE_BG, airlinesFor, airlinePickHTML, bkMatch, bkMerge, bkUpsert, bkDedupe, bkClean, hotelsNow, nameLike, startFromDocument, itinKeyOf: itinKey, flightArriveFix, flightAirports, apZone, acctSyncAll,  docItems, docApply, docsHTML, normFiles, shrinkPhoto, docPrepare, bookingFile, flightName, pickAirport, flightArrival, rentalHTML, flightsHTML, stayLinks, apKey, textFields, staleFields, translatedView, hashStr, planEdits, editRule, hotelBrand, hotelBookAction, AIRLINE_BOOK, carBrandURL, syncKey, aiEventToCfg, aiItemsToBookings, pagesAll, DEMOS, gNearby, gMerge, gSameName, GKEY, ohOpenAt, filterPlaces, allPlaces, bookingLink, PROVIDERS, sb, makeSlug, parseGuestList, notReplied, SB_JS, parseReservation, osmQuery, classify, osmKey, OVERPASS, packEvent, unpackEvent, icsText, nearestAirports, weatherFor, nearby, L };
})();
