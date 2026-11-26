// The formatting editor (WYSIWYG): formattable fields edit the formatted text itself, not **markers**.
//  - each formattable field (RT_FIELDS) keeps its hidden <textarea>/<input> as the value the app reads; a contenteditable
//    box next to it shows bold / italic / highlight. Storage is unchanged: **bold**, *italic*, ==highlight==.
//  - round trip: markers → editor → markers gives back the same text (table below), incl. multi-line, CJK, unmatched
//    markers that stay literal ("5 * 3", "*sold out"), nesting, highlight across bold.
//  - stars / equals typed as text stay text: stored as typed when they can't read as markers, else escaped (\*, \=).
//  - paste / drop are plain text; stored XSS values load as text; IME composition isn't touched mid-way; phones (390px).
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/rt-editor.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOT = process.env.SHOT || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const V = { name: 'Tokyo Station', address: 'Marunouchi, Tokyo', lat: 35.6812, lon: 139.7671, city: 'Tokyo', country: 'Japan', cc: 'jp' };
const BASECFG = { v: 2, type: 'Party', title: 'Editor test', start: '2027-04-02T19:00', end: '2027-04-02T23:00', tz: 'Asia/Tokyo', venue: V, description: '',
  notes: [{ label: 'Parking', text: '', url: '' }], custom: [], schedule: [{ date: '2027-04-02', time: '19:00', title: 'Dinner', note: '' }],
  tools: { weather: false, travel: false, stay: false, nearby: false, tours: false, mytrip: true, packing: false, shopping: false } };
// stored text → what the editor shows (HTML) ; canonical: the editor writes exactly this text back after an edit
const TABLE = [
  ['plain text', 'Just words.', 'Just words.', 1],
  ['bold / italic / highlight', '**b** *i* ==h==', '<strong>b</strong> <em>i</em> <mark>h</mark>', 1],
  ['unmatched stars stay literal', '5 * 3 * 2 and *sold out', '5 * 3 * 2 and *sold out', 1],
  ['star between letters', '2*3*4 and a*b', '2*3*4 and a*b', 1],
  ['spaced markers literal', '** a ** and a == b', '** a ** and a == b', 1],
  ['nested italic in bold', '**a *b* c**', '<strong>a <em>b</em> c</strong>', 1],
  ['bold + italic', '***x***', '<strong><em>x</em></strong>', 1],
  ['highlight inside bold', '**==x==**', '<strong><mark>x</mark></strong>', 1],
  ['highlight around bold', '==**x**==', '<mark><strong>x</strong></mark>', 0],
  ['highlight spanning bold', '==see **this** now==', '<mark>see <strong>this</strong> now</mark>', 1],
  ['crossed markers', '**a ==b** c==', '<strong>a ==b</strong> c==', 1],
  ['CJK, no spaces', 'これは*重要*です。**明日**の==集合==', 'これは<em>重要</em>です。<strong>明日</strong>の<mark>集合</mark>', 1],
  ['multi-line', 'line1\n**line2**\n\nline4', 'line1<br><strong>line2</strong><br><br>line4', 1],
  ['trailing newline', 'a\n', 'a<br><br>', 1],
  ['marker not across lines', '**a\nb**', '**a<br>b**', 1],
  ['escaped stars', '\\*not\\* italic, \\=\\=no\\=\\=', '*not* italic, ==no==', 1],
  ['emoji + accents', 'Café 🎉 **¡olé!**', 'Café 🎉 <strong>¡olé!</strong>', 1],
  ['html-ish text', '<b>x</b> & "q"', '&lt;b&gt;x&lt;/b&gt; &amp; "q"', 1],
  ['bold then italic, no space', '**bold** *it*', '<strong>bold</strong> <em>it</em>', 1],
  ['four stars literal', '****', '****', 1],
];
const XSS = ['<img src=x onerror="window.__pwn=1">', '**<script>window.__pwn=2</script>**', '==<svg onload="window.__pwn=3">==', '*"><iframe src=javascript:window.__pwn=4>*', '<a href="javascript:window.__pwn=5">x</a>', '&lt;img src=x onerror=window.__pwn=6&gt;'];

async function open(browser, w, cfg) {
  const mob = w < 600;
  const ctx = await browser.newContext({ viewport: { width: w, height: mob ? 844 : 900 }, deviceScaleFactor: 2, isMobile: mob, hasTouch: mob, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.route(/googleapis|gstatic|overpass|nominatim|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|photon|auth\/v1|rest\/v1/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
  if (cfg) { const packed = await page.evaluate((c) => window.__ep.packEvent(window.__ep.normalize(c)), cfg); await page.goto(BASE + '#edit=' + packed); await page.waitForSelector('[data-card="about"]'); }
  return { ctx, page };
}
// a throwaway formattable field ([data-rt]) on the page; returns nothing, the field is #t-<id>
const mkField = (page, id, value, tag = 'textarea', ph = '') => page.evaluate(([id, v, tag, ph]) => new Promise(r => { const f = document.createElement(tag); f.id = 't-' + id; f.setAttribute('data-rt', ''); if (ph) f.placeholder = ph; f.value = v; document.body.appendChild(f); setTimeout(r, 0); }), [id, value, tag, ph]);

(async () => {
  const browser = await chromium.launch();
  require('./_open-settings')(browser);
  try {
    // ---- round trip: markers → editor → markers ----
    {
      const { ctx, page } = await open(browser, 1280);
      for (const [i, [name, v, html, canon]] of TABLE.entries()) {
        await mkField(page, 'r' + i, v);
        const r = await page.evaluate(async ([id, v]) => { const E = window.__ep; const src = document.querySelector('#t-' + id); const ed = src.nextElementSibling;
          const R = E.rtRead(ed); const m = E.rtModel(v); const out = { html: ed.innerHTML, ser: E.rtSer(R.t, R.f), same: R.t === m.t && R.f.join() === m.f.join(), isEd: ed.classList.contains('rt-ed') && ed.isContentEditable };
          // an edit and its undo-by-hand: type a character at the end, then delete it
          ed.focus(); E.rtSelect(ed, R.t.length, R.t.length); document.execCommand('insertText', false, 'Z'); out.typed = src.value; document.execCommand('delete'); out.back = src.value;
          const m2 = E.rtModel(out.back); out.backSame = m2.t === m.t && m2.f.join() === m.f.join(); return out; }, ['r' + i, v]);
        ok(r.isEd && r.html === html, `${name}: editor shows ${JSON.stringify(r.html)}`);
        ok(r.same, `${name}: editor holds the same text + formats as the stored value`);
        ok(canon ? r.ser === v : true, `${name}: markers → editor → markers ${canon ? 'exact' : 'same rendering'}: ${JSON.stringify(r.ser)}`);
        ok(canon ? r.back === v : r.backSame, `${name}: type + delete gives back ${canon ? 'the same text' : 'the same formatting'}: ${JSON.stringify(r.back)}`);
      }
      // fuzz: any text + formats → markers → back: the text always survives exactly, formats survive or are dropped (never invented)
      const fz = await page.evaluate(() => { const E = window.__ep; const C = ['a', 'b', 'x', ' ', ' ', '*', '*', '=', '=', '\\', '\n', '日', '本', '5', '.']; let seed = 7; const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
        const bad = []; let kept = 0, total = 0;
        for (let k = 0; k < 2000; k++) { const n = 1 + rnd(24); let t = ''; const f = []; let cur = 0;
          for (let i = 0; i < n; i++) { if (!rnd(4)) cur = rnd(8); const c = C[rnd(C.length)]; t += c; f.push(c === '\n' ? 0 : cur); }
          const s = E.rtSer(t, f), m = E.rtModel(s);
          if (m.t !== t || m.f.some((x, i) => x & ~f[i])) bad.push([t, f.join(''), s]);
          f.forEach((x, i) => { if (x && !/\s/.test(t[i])) { total++; if (m.f[i] === x) kept++; } }); }
        return { bad: bad.slice(0, 3), n: bad.length, kept: total ? kept / total : 1 }; });
      ok(!fz.n, `fuzz (2000 random texts with stars, equals, backslashes, CJK, newlines): text exact, no invented format ${JSON.stringify(fz.bad)}`);
      ok(fz.kept > 0.7, `fuzz: most formatting survives (${Math.round(fz.kept * 100)}%)`);
      // a value with no edit stays byte-identical even when it isn't the editor's own spelling
      await mkField(page, 'nc', '==**x**== **a**'); await page.focus('#t-nc + .rt-ed'); await page.evaluate(() => document.querySelector('#t-nc + .rt-ed').blur());
      ok(await page.inputValue('#t-nc') === '==**x**== **a**', 'focus + blur without typing leaves the stored text as it was');
      // the parser's escapes on the page side
      const esc = await page.evaluate(() => [window.__ep.rtHTML('\\*a\\*'), window.__ep.rtHTML('\\\\*a*'), window.__ep.rtHTML('C:\\\\Users\\x'), window.__ep.rtPlain('\\*\\*x\\*\\* 5 * 3'), window.__ep.rtToTags('\\*x\\* **y**')]);
      ok(esc[0] === '*a*' && esc[1] === '\\<em>a</em>' && esc[2] === 'C:\\\\Users\\x' && esc[3] === '**x** 5 * 3', `escapes: \\* literal, \\\\ before a marker, other backslashes untouched: ${JSON.stringify(esc)}`);
      ok(esc[4] === '\\*x\\* <b>y</b>', `escaped stars survive translation: ${esc[4]}`);
      ok(!page._err.length, `round trip: no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
    // ---- typing: literal stars stay text, formatting carries on, Enter, single-line, placeholder ----
    {
      const { ctx, page } = await open(browser, 1280);
      await mkField(page, 'lit', '');
      const ED = '#t-lit + .rt-ed';
      await page.click(ED); await page.keyboard.type('Price: 5 * 3 = 15, **not bold**, ==no==, *nope*');
      let v = await page.inputValue('#t-lit'); const h = await page.evaluate((v) => window.__ep.rtHTML(v), v);
      ok(!/<(strong|em|mark)>/.test(h) && await page.evaluate((v) => window.__ep.rtPlain(v), v) === 'Price: 5 * 3 = 15, **not bold**, ==no==, *nope*', `typed stars / equals stay literal on the page: ${v}`);
      ok(v === 'Price: 5 * 3 = 15, \\*\\*not bold\\*\\*, \\=\\=no\\=\\=, \\*nope\\*', `stored with escapes only where needed: ${v}`);
      await page.fill(ED, ''); await page.keyboard.type('5 * 3 and *sold out');
      ok(await page.inputValue('#t-lit') === '5 * 3 and *sold out', `unambiguous stars stored as typed (no escapes): ${await page.inputValue('#t-lit')}`);
      // bold carries on while typing inside it; Enter makes a new line (multi-line field)
      await page.fill(ED, ''); await page.keyboard.type('Bring water');
      await page.evaluate(() => { const ed = document.querySelector('#t-lit + .rt-ed'); window.__ep.rtSelect(ed, 6, 11); });
      await page.keyboard.press('Control+b'); await page.evaluate(() => { const ed = document.querySelector('#t-lit + .rt-ed'); window.__ep.rtSelect(ed, 11, 11); });
      await page.keyboard.type(' bottles'); v = await page.inputValue('#t-lit');
      ok(v === 'Bring **water bottles**', `typing at the end of bold text continues bold: ${v}`);
      await page.keyboard.press('Enter'); await page.keyboard.type('and snacks'); v = await page.inputValue('#t-lit');
      ok(/^Bring \*\*water bottles\*\*\n/.test(v) && /snacks/.test(v) && !/<div|<br/.test(v), `Enter = a line break: ${JSON.stringify(v)}`);
      ok(await page.$$eval(ED + ' div, ' + ED + ' p', x => x.length) === 0, 'no <div>/<p> blocks in the editor');
      // single-line (an <input> before): Enter does nothing, pasted lines join
      await mkField(page, 'one', 'One line', 'input');
      await page.click('#t-one + .rt-ed'); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type(' still');
      v = await page.inputValue('#t-one'); ok(v === 'One line still', `single-line: Enter adds no line break (${JSON.stringify(v)})`);
      ok(await page.$eval('#t-one + .rt-ed', e => !e.hasAttribute('aria-multiline') && e.getAttribute('role') === 'textbox'), 'single-line: role textbox, not multiline');
      // placeholder
      await mkField(page, 'ph', '', 'textarea', 'Add a note');
      const ph = await page.$eval('#t-ph + .rt-ed', e => [e.classList.contains('rt-empty'), getComputedStyle(e, '::before').content, e.getAttribute('aria-label')]);
      ok(ph[0] && ph[1] === '"Add a note"' && ph[2] === 'Add a note', `placeholder shows when empty: ${ph}`);
      await page.click('#t-ph + .rt-ed'); await page.keyboard.type('x');
      ok(await page.$eval('#t-ph + .rt-ed', e => !e.classList.contains('rt-empty')), 'placeholder hides once there is text');
      await page.keyboard.press('Backspace'); ok(await page.$eval('#t-ph + .rt-ed', e => e.classList.contains('rt-empty')) && await page.inputValue('#t-ph') === '', 'and comes back when emptied');
      // events: input per edit on the hidden field, change on blur (like the old field)
      const ev = await page.evaluate(async () => { const src = document.querySelector('#t-ph'); const ed = src.nextElementSibling; const n = { input: 0, change: 0, bubbledFromBox: 0 };
        src.addEventListener('input', () => n.input++); src.addEventListener('change', () => n.change++); document.body.addEventListener('input', (e) => { if (e.target === ed) n.bubbledFromBox++; });
        ed.focus(); document.execCommand('insertText', false, 'ab'); const mid = n.change; ed.blur(); return { ...n, mid }; });
      ok(ev.input >= 1 && ev.mid === 0 && ev.change === 1 && ev.bubbledFromBox === 0, `input on the hidden field while typing, change on blur, the box's own input stays inside: ${JSON.stringify(ev)}`);
      // the app setting .value shows up in the editor
      await page.evaluate(() => { document.querySelector('#t-ph').value = 'Set **by** app'; });
      ok(await page.$eval('#t-ph + .rt-ed', e => e.innerHTML) === 'Set <strong>by</strong> app', 'a value the app sets shows formatted');
      // undo / redo a toggle (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z)
      await mkField(page, 'u', 'Undo this word');
      await page.click('#t-u + .rt-ed'); await page.evaluate(() => window.__ep.rtSelect(document.querySelector('#t-u + .rt-ed'), 10, 14));
      await page.keyboard.press('Control+b'); const u1 = await page.inputValue('#t-u');
      await page.keyboard.press('Control+z'); const u2 = await page.inputValue('#t-u'); const h2 = await page.$eval('#t-u + .rt-ed', e => e.innerHTML);
      await page.keyboard.press('Control+Shift+z'); const u3 = await page.inputValue('#t-u');
      ok(u1 === 'Undo this **word**' && u2 === 'Undo this word' && h2 === 'Undo this word' && u3 === 'Undo this **word**', `undo / redo a toggle: ${[u1, u2, u3].join(' → ')}`);
      // focusing the hidden field focuses the editor
      ok(await page.evaluate(() => { document.querySelector('#t-one').focus(); return document.activeElement === document.querySelector('#t-one + .rt-ed'); }), 'field.focus() focuses the editor');
      ok(!page._err.length, `typing: no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
    // ---- paste / drop: plain text only; stored XSS loads as text ----
    {
      const { ctx, page } = await open(browser, 1280);
      await mkField(page, 'p', 'Hello ');
      const r = await page.evaluate(async () => {
        const src = document.querySelector('#t-p'), ed = src.nextElementSibling; ed.focus(); window.__ep.rtSelect(ed, 6, 6);
        const paste = (data) => { const dt = new DataTransfer(); Object.entries(data).forEach(([k, v]) => dt.setData(k, v)); ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); };
        paste({ 'text/html': '<b>world</b><script>window.__pwn=1<\/script><img src=x onerror="window.__pwn=2"><a href="javascript:window.__pwn=3">link</a>', 'text/plain': 'world <img src=x onerror="window.__pwn=2"> link' });
        const a = { html: ed.innerHTML, v: src.value };
        paste({ 'text/html': '<i>only html</i><img src=x onerror="window.__pwn=4"><style>body{display:none}</style>' });
        const b = { html: ed.innerHTML, v: src.value };
        paste({ 'text/plain': ' two\nlines' }); const c = { html: ed.innerHTML, v: src.value };
        // drop
        const dt = new DataTransfer(); dt.setData('text/html', '<img src=x onerror="window.__pwn=5">'); dt.setData('text/plain', ' dropped'); const rc = ed.getBoundingClientRect();
        ed.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: rc.right - 4, clientY: rc.bottom - 4 }));
        await new Promise(r => setTimeout(r, 200));
        return { a, b, c, d: { html: ed.innerHTML, v: src.value }, els: [...ed.querySelectorAll('*')].map(n => n.nodeName), pwn: window.__pwn || 0 };
      });
      ok(r.a.v === 'Hello world <img src=x onerror="window.__pwn=2"> link' && !/<img|<script|<a /i.test(r.a.html), `paste of HTML goes in as its plain text: ${r.a.html}`);
      ok(/only html/.test(r.b.v) && !/<i>|<img|<style/i.test(r.b.html), `HTML-only paste: just its text: ${JSON.stringify(r.b.v)}`);
      ok(/two\nlines/.test(r.c.v), `pasted lines become line breaks: ${JSON.stringify(r.c.v)}`);
      ok(/dropped/.test(r.d.v) && !/<img/i.test(r.d.html), `drop: plain text: ${JSON.stringify(r.d.v)}`);
      ok(r.els.every(n => /^(BR|STRONG|EM|MARK|B|I)$/.test(n)) && !r.pwn, `no elements but br/strong/em/mark (${r.els.join(',')}), nothing ran (${r.pwn})`);
      // stored values with payloads load as text
      for (const [i, x] of XSS.entries()) await mkField(page, 'x' + i, x);
      await page.waitForTimeout(300);
      const s = await page.evaluate((n) => [...Array(n).keys()].map(i => { const ed = document.querySelector('#t-x' + i + ' + .rt-ed'); return { els: [...ed.querySelectorAll('*')].map(e => e.nodeName + [...e.attributes].map(a => a.name).join('')), text: ed.textContent }; }), XSS.length);
      ok(s.every(x => x.els.every(n => /^(STRONG|EM|MARK|BR)$/.test(n))), `stored XSS values: only strong/em/mark in the editor, no attributes (${s.map(x => x.els.join('+')).join(' | ')})`);
      ok(s[0].text === XSS[0] && s[1].text === '<script>window.__pwn=2</script>', `…shown as their text: ${s[0].text}`);
      await page.waitForTimeout(300); ok(!(await page.evaluate(() => window.__pwn)), 'no payload ran');
      // the browser slipping in something else (e.g. execCommand insertHTML): rebuilt as text on the next input
      const rb = await page.evaluate(async () => { const ed = document.querySelector('#t-x0 + .rt-ed'); ed.focus(); window.__ep.rtSelect(ed, 0, 0); document.execCommand('insertHTML', false, '<img src=x onerror="window.__pwn=7"><u>u</u>');
        await new Promise(r => setTimeout(r, 200)); return { els: [...ed.querySelectorAll('*')].map(e => e.nodeName), pwn: window.__pwn || 0 }; });
      ok(!rb.els.includes('IMG') && !rb.els.includes('U'), `foreign markup is rebuilt away: ${rb.els.join(',')} (pwn ${rb.pwn})`);
      ok(!page._err.length, `paste: no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
    // ---- IME composition (Japanese): nothing serialized or rebuilt mid-composition ----
    {
      const { ctx, page } = await open(browser, 1280);
      await mkField(page, 'ime', '**東京**で');
      await page.click('#t-ime + .rt-ed'); await page.keyboard.press('End');
      await page.evaluate(() => { const src = document.querySelector('#t-ime'); window.__n = 0; src.addEventListener('input', () => window.__n++); window.__ed0 = src.nextElementSibling.firstChild; });
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
      await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
      const mid = await page.evaluate(() => ({ n: window.__n, v: document.querySelector('#t-ime').value, comp: !!document.querySelector('#t-ime + .rt-ed')._comp, same: document.querySelector('#t-ime + .rt-ed').firstChild === window.__ed0 }));
      ok(mid.comp && mid.n === 0 && mid.v === '**東京**で' && mid.same, `mid-composition: field untouched, editor not rebuilt ${JSON.stringify(mid)}`);
      // the bar / Cmd+B don't act mid-composition
      await page.keyboard.press('Control+b').catch(() => {});
      await cdp.send('Input.insertText', { text: '日本' });
      await page.waitForTimeout(100);
      const end = await page.evaluate(() => ({ n: window.__n, v: document.querySelector('#t-ime').value, comp: !!document.querySelector('#t-ime + .rt-ed')._comp, html: document.querySelector('#t-ime + .rt-ed').innerHTML }));
      ok(!end.comp && end.n >= 1 && end.v === '**東京**で日本', `after commit: saved once composed ${JSON.stringify(end)}`);
      await page.keyboard.type('です'); const v2 = await page.inputValue('#t-ime');
      ok(v2 === '**東京**で日本です', `typing on after composition: ${v2}`);
      ok(!page._err.length, `IME: no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
    // ---- in the app: sheets at 390px on a phone (touch toolbar), notes, schedule note, booking note; screenshot ----
    {
      const cfg = { ...BASECFG, description: 'Ceremony at **4 pm**. Bring *sunscreen* and ==your ticket==.', notes: [{ label: 'Parking', text: '**Free** after 6', url: '' }], schedule: [{ date: '2027-04-02', time: '19:00', title: 'Dinner', note: 'Meet at the ==north gate==' }] };
      const { ctx, page } = await open(browser, 390, cfg);
      await page.click('[data-card="about"]'); await page.waitForSelector('#sheet[open] #f-desc + .rt-ed');
      const ED = '#sheet #f-desc + .rt-ed';
      const look = await page.$eval(ED, e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { html: e.innerHTML, w: r.width, h: r.height, fs: cs.fontSize, bw: cs.borderTopWidth, hidden: getComputedStyle(document.querySelector('#f-desc')).display }; });
      ok(look.html === 'Ceremony at <strong>4 pm</strong>. Bring <em>sunscreen</em> and <mark>your ticket</mark>.', `@390 About editor shows the formatting: ${look.html}`);
      ok(look.w > 250 && look.h >= 100 && look.fs === '16px' && look.bw !== '0px' && look.hidden === 'none', `@390 editor sized like the old field (16px, bordered, rows): ${JSON.stringify(look)}`);
      // select "Bring" by touch-ish: set the selection, tap B on the bar below
      const txt = 'Ceremony at 4 pm. Bring sunscreen and your ticket.'; const a = txt.indexOf('Bring');
      await page.evaluate(([a, b]) => { const ed = document.querySelector('#sheet #f-desc + .rt-ed'); ed.focus(); window.__ep.rtSelect(ed, a, b); document.dispatchEvent(new Event('selectionchange')); }, [a, a + 5]);
      await page.waitForSelector('.rt-bar:not([hidden])', { timeout: 3000 }).catch(() => {});
      const bar = await page.evaluate(() => { const b = document.querySelector('.rt-bar'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); const s = getSelection().getRangeAt(0).getBoundingClientRect(); return { y: r.top, x: r.left, w: r.width, sb: s.bottom }; });
      ok(bar && bar.y > bar.sb && bar.x >= 0 && bar.x + bar.w <= 390, `@390 touch: toolbar below the selection, on screen ${JSON.stringify(bar)}`);
      await page.tap('.rt-bar [data-rt-m="**"]'); await page.waitForTimeout(150);
      let v = await page.inputValue('#sheet #f-desc'); ok(v === 'Ceremony at **4 pm**. **Bring** *sunscreen* and ==your ticket==.', `@390 tap B: ${v}`);
      ok(await page.evaluate(() => String(getSelection())) === 'Bring', '@390 selection stays on the word after the tap');
      await page.tap('.rt-bar [data-rt-m="*"]'); await page.waitForTimeout(150); v = await page.inputValue('#sheet #f-desc');
      ok(v === 'Ceremony at **4 pm**. ***Bring*** *sunscreen* and ==your ticket==.', `@390 tap I adds italic: ${v}`);
      await page.tap('.rt-bar [data-rt-m="*"]'); await page.tap('.rt-bar [data-rt-m="**"]'); await page.waitForTimeout(150);
      ok(await page.inputValue('#sheet #f-desc') === cfg.description, '@390 toggled back to the original');
      await page.evaluate(() => { getSelection().removeAllRanges(); document.activeElement.blur(); }); await page.waitForTimeout(150);
      if (SHOT) { await page.evaluate(() => document.querySelector('#sheet #f-desc + .rt-ed').scrollIntoView({ block: 'center' })); await page.waitForTimeout(200); await page.screenshot({ path: SHOT }); }
      // autosave → the page preview + "Saved"
      await page.focus(ED); await page.keyboard.press('End'); await page.keyboard.type(' See you!'); await page.waitForTimeout(1200);
      const st = await page.evaluate(() => [...document.querySelectorAll('[data-save], #sheet [data-sh-save], #sheet .sh-save')].map(e => e.textContent).join(' | '));
      const prev = await page.evaluate(() => (document.querySelector('#preview #sec-about .rm-box') || {}).innerHTML || '');
      ok(/<strong>4 pm<\/strong>/.test(prev) && /See you!/.test(prev), `@390 the page preview updates as you type: ${prev}`);
      ok(/Saved/.test(st), `@390 "Saved" shows after typing: ${st}`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      ok(!page._err.length, `@390 sheets: no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
