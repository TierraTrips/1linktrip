// Bold / italic / highlight (Dylan 11/25: "is it possible to highlight/bold/italic text to make certain things stand out?")
//  - stored as **bold**, *italic*, ==highlight== in the plain text; rtHTML escapes everything and emits only
//    <strong>/<em>/<mark> (XSS payloads stay text); unmatched markers stay as typed ("5 * 3", "*sold out").
//  - rendered in About, Notes, custom sections, schedule notes (Event row + its sheet) and the guest's own notes (My trip);
//    the .ics export carries the text without markers; translation keeps the formatting (<b>/<i>/<mark> on the wire).
//  - editing: formattable fields edit the formatted text itself (WYSIWYG, see tests/rt-editor.js); select text →
//    floating B / I / highlight bar (above on desktop, below on touch); Cmd/Ctrl+B / I; toggling twice gives back the original.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/rich-text.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const XSS = ['<img src=x onerror="window.__pwn=1">', '**<script>window.__pwn=2</script>**', '==<svg onload="window.__pwn=3">==', '*"><iframe src=javascript:window.__pwn=4>*', '**a**<b onmouseover=window.__pwn=5>x</b>', '[x](javascript:window.__pwn=6)'];
const V = { name: 'Tokyo Station', address: 'Marunouchi, Tokyo', lat: 35.6812, lon: 139.7671, city: 'Tokyo', country: 'Japan', cc: 'jp' };
const CFG = { v: 2, type: 'Party', title: 'Format test', start: '2027-04-02T19:00', end: '2027-04-02T23:00', tz: 'Asia/Tokyo', venue: V,
  description: 'We are **so** excited.\n\nPlease *RSVP* by ==March 1==.\n\n' + XSS.join(' '),
  notes: [{ label: 'Parking', text: '**Free** after 6 pm, ==bring your ticket==', url: '' }, { label: 'Math', text: '5 * 3 * 2 and *sold out', url: '' }],
  custom: [{ id: 'c1', title: 'Dress code', text: 'Wear *something* **blue**.\nNo ==white== please.', label: '', url: '', img: '' }],
  schedule: [{ date: '2027-04-02', time: '19:00', title: 'Dinner', note: 'Meet at the **north** gate, ==7 pm sharp==' }, { date: '2027-04-02', time: '21:00', title: 'Karaoke', note: XSS[0] }],
  tools: { weather: false, travel: false, stay: false, nearby: false, tours: false, mytrip: true, packing: false, shopping: false } };

async function ctxPage(browser, w, init) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, deviceScaleFactor: 2, isMobile: w < 600, hasTouch: w < 600, serviceWorkers: 'block' });
  if (init) await init(ctx);
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.route(/googleapis|gstatic|overpass|nominatim|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|photon|auth\/v1|rest\/v1/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  await page.evaluate(() => localStorage.clear());
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();
  require('./_open-settings')(browser);
  try {
    // ---- the parser / sanitizer (pure) ----
    {
      const { ctx, page } = await ctxPage(browser, 390);
      const r = await page.evaluate((X) => { const E = window.__ep; return {
        basic: E.rtHTML('**b** *i* ==h=='), nest: E.rtHTML('**a *b* c**'), both: E.rtHTML('***x***'), cross: E.rtHTML('**a ==b** c=='),
        lit: ['5 * 3 * 2', '2*3*4', '*sold out', '** a **', '****', 'a == b', '==='].map(E.rtHTML), cjk: E.rtHTML('これは*重要*です'), line: E.rtHTML('**a\nb**'),
        xss: X.map(E.rtHTML), plain: E.rtPlain('We are **so** *very* ==happy==; 5 * 3'), tags: E.rtToTags('**a** *b* ==c=='),
        back: E.rtFromTags('Estamos <b> muy </b> felices, <i>de verdad</i>, <mark>1 de marzo</mark> <b>sin cierre'),
        paras: E.rtParas('**a**\n\n<b>x</b>\nline'),
      }; }, XSS);
      ok(r.basic === '<strong>b</strong> <em>i</em> <mark>h</mark>', `basic: ${r.basic}`);
      ok(r.nest === '<strong>a <em>b</em> c</strong>' && r.both === '<strong><em>x</em></strong>', `nesting: ${r.nest} · ${r.both}`);
      ok(r.cross === '<strong>a ==b</strong> c==', `crossed markers stay well-formed: ${r.cross}`);
      ok(r.lit.join('|') === '5 * 3 * 2|2*3*4|*sold out|** a **|****|a == b|===', `unmatched / spaced markers stay as typed: ${r.lit.join(' | ')}`);
      ok(r.cjk === 'これは<em>重要</em>です', `CJK without spaces: ${r.cjk}`);
      ok(r.line === '**a\nb**', `a marker doesn't span lines`);
      ok(r.xss.every(h => !/<(?!\/?(strong|em|mark)>)/.test(h)), `XSS payloads: no tag but strong/em/mark → ${r.xss.join(' ‖ ')}`);
      ok(r.xss.every(h => !/[<>]/.test(h.replace(/<\/?(strong|em|mark)>/g, ''))) && r.xss.every(h => !/"/.test(h)), `every < > " in the text is escaped`);
      ok(r.plain === 'We are so very happy; 5 * 3', `plain: ${r.plain}`);
      ok(r.tags === '<b>a</b> <i>b</i> <mark>c</mark>', `to the translator: ${r.tags}`);
      ok(r.back === 'Estamos  **muy**  felices, *de verdad*, ==1 de marzo== sin cierre', `from the translator (spaces out, unmatched tag dropped): ${r.back}`);
      ok(r.paras === '<p><strong>a</strong></p><p>&lt;b&gt;x&lt;/b&gt;<br>line</p>', `paragraphs: ${r.paras}`);
      await ctx.close();
    }
    // ---- rendered on the guest page, no script runs, .ics plain ----
    for (const w of [390, 1280]) {
      const { ctx, page } = await ctxPage(browser, w);
      const BK = [{ id: 'b1', kind: 'food', name: 'Sushi Saito', start: '2027-04-02T18:00', note: 'Ask for the **counter**, ==cash only==' }];
      const packed = await page.evaluate((c) => window.__ep.packEvent(window.__ep.normalize(c)), CFG);
      const K = await page.evaluate((c) => window.__ep.itinKeyOf(window.__ep.normalize(c)), CFG);
      await page.evaluate(([k, b]) => localStorage.setItem('ep:' + k, JSON.stringify(b)), [K, BK]);
      await page.goto(BASE + '#e=' + packed); await page.reload(); await page.waitForSelector('.ev-body'); await page.waitForTimeout(500);
      const h = await page.evaluate(() => ({ about: (document.querySelector('#sec-about .rm-box') || {}).innerHTML || '', notes: [...document.querySelectorAll('.links li.note span')].map(s => s.innerHTML),
        cs: (document.querySelector('[data-sec="c-c1"] .rm-box, #sec-c-c1 .rm-box') || {}).innerHTML || '', sched: [...document.querySelectorAll('#sec-schedule .tl-tx > span')].map(s => s.innerHTML),
        bad: document.querySelectorAll('.ev-body img[src="x"], .ev-body script, .ev-body iframe, .ev-body svg[onload], .ev-body b[onmouseover]').length, pwn: window.__pwn || 0 }));
      ok(/We are <strong>so<\/strong> excited/.test(h.about) && /<em>RSVP<\/em> by <mark>March 1<\/mark>/.test(h.about), `@${w} About: bold / italic / highlight`);
      ok(h.notes[0] === '<strong>Free</strong> after 6 pm, <mark>bring your ticket</mark>' && h.notes[1] === '5 * 3 * 2 and *sold out', `@${w} Notes: ${h.notes.join(' ‖ ')}`);
      ok(h.cs === '<p>Wear <em>something</em> <strong>blue</strong>.<br>No <mark>white</mark> please.</p>', `@${w} custom section: ${h.cs}`);
      ok(h.sched.some(s => s === 'Meet at the <strong>north</strong> gate, <mark>7 pm sharp</mark>'), `@${w} schedule note on the Event row: ${h.sched.join(' ‖ ')}`);
      ok(h.bad === 0 && !h.pwn, `@${w} XSS: no injected elements (${h.bad}), nothing ran (${h.pwn})`);
      // the schedule row's sheet
      await page.click('#sec-schedule .tl-go:has-text("Dinner")'); await page.waitForSelector('dialog.ds-sheet[open]'); await page.waitForTimeout(200);
      const ds = await page.$eval('dialog.ds-sheet[open] .ds-note', e => e.innerHTML); ok(ds === 'Meet at the <strong>north</strong> gate, <mark>7 pm sharp</mark>', `@${w} item sheet note: ${ds}`);
      if (SHOTS && w === 390) await page.screenshot({ path: `${SHOTS}/rich-sheet-390.png` });
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      if (SHOTS) { await page.evaluate(() => document.querySelector('#sec-about').scrollIntoView()); await page.screenshot({ path: `${SHOTS}/rich-about-${w}.png` }); }
      // the guest's own note in My trip
      await page.click('[data-tab-go="mytrip"]'); await page.waitForTimeout(400);
      const mine = await page.$$eval('.pr-note', ss => ss.map(s => s.innerHTML)); ok(mine.includes('Ask for the <strong>counter</strong>, <mark>cash only</mark>'), `@${w} My trip note: ${mine.join(' ‖ ')}`);
      if (SHOTS && w === 390) await page.screenshot({ path: `${SHOTS}/rich-mytrip-390.png` });
      const ics = await page.evaluate((c) => window.__ep.icsText(window.__ep.normalize(c), 'https://x'), CFG);
      ok(/Meet at the north gate\\, 7 pm sharp/.test(ics) && !/\*\*|==/.test(ics), `@${w} .ics without markers`);
      ok(!page._err.length && !(await page.evaluate(() => window.__pwn)), `@${w} no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
    // ---- translation keeps the formatting ----
    {
      const sent = [];
      const { ctx, page } = await ctxPage(browser, 390, async (c) => {
        await c.route('**/functions/v1/ai-import', async (r) => { if (r.request().method() !== 'POST') return r.fulfill({ contentType: 'application/json', body: '{"ok":true,"ready":true,"modes":["translate"]}' });
          const b = JSON.parse(r.request().postData() || '{}'); sent.push(b);
          const tr = Object.entries(b.fields || {}).map(([key, text]) => ({ key, text: text.replace('Free', 'Gratis').replace('bring your ticket', 'trae tu boleto').replace('after 6 pm', 'después de las 6') }));
          r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'translate', data: { translations: tr } }) }); });
      });
      const packed = await page.evaluate((c) => window.__ep.packEvent(window.__ep.normalize(c)), CFG);
      await page.goto(BASE + '?lang=es#e=' + packed); await page.waitForSelector('.ev-body'); await page.waitForFunction(() => /Gratis/.test(document.body.innerHTML), null, { timeout: 15000 }).catch(() => {});
      const f = sent.length ? sent[0].fields : {}; const nk = Object.keys(f).find(k => /notes\[0\]\.text/.test(k));
      ok(nk && f[nk] === '<b>Free</b> after 6 pm, <mark>bring your ticket</mark>', `sent to the translator as tags: ${nk && f[nk]}`);
      const n0 = await page.$$eval('.links li.note span', ss => ss.map(s => s.innerHTML));
      ok(n0[0] === '<strong>Gratis</strong> después de las 6, <mark>trae tu boleto</mark>', `translated page keeps bold + highlight: ${n0[0]}`);
      await ctx.close();
    }
    // ---- editing: the toolbar + shortcuts (organizer's About), in the formatted editor ----
    for (const w of [390, 1280]) {
      const { ctx, page } = await ctxPage(browser, w);
      const base = { ...CFG, description: '', notes: [], custom: [], schedule: [] };
      const packed = await page.evaluate((c) => window.__ep.packEvent(window.__ep.normalize(c)), base);
      await page.goto(BASE + '#edit=' + packed); await page.waitForSelector('[data-card="about"]');
      await page.click('[data-card="about"]'); await page.waitForSelector('#sheet[open] #f-desc + .rt-ed');
      const ED = '#f-desc + .rt-ed';
      await page.fill(ED, 'Ceremony starts at 4 pm sharp. Bring sunscreen.');
      const sel = (a, b) => page.evaluate(([a, b]) => { const ed = document.querySelector('#f-desc + .rt-ed'); ed.focus(); window.__ep.rtSelect(ed, a, b); document.dispatchEvent(new Event('selectionchange')); }, [a, b]);
      const txt = 'Ceremony starts at 4 pm sharp. Bring sunscreen.'; const a = txt.indexOf('4 pm sharp'), b = a + '4 pm sharp'.length;
      ok(await page.inputValue('#f-desc') === txt, `@${w} typing in the editor fills the field`);
      await sel(a, b); await page.waitForSelector('.rt-bar:not([hidden])', { timeout: 3000 }).catch(() => {});
      const bar = await page.evaluate(() => { const b = document.querySelector('.rt-bar'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); const f = document.querySelector('#f-desc + .rt-ed').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, fy: f.top, fb: f.bottom, n: b.querySelectorAll('button').length, labels: [...b.querySelectorAll('button')].map(x => x.getAttribute('aria-label')), inDialog: !!b.closest('dialog') }; });
      ok(bar && bar.n === 3 && bar.labels.join() === 'Bold,Italic,Highlight', `@${w} selecting text shows B / I / highlight ${JSON.stringify(bar)}`);
      ok(bar && bar.x >= 0 && bar.x + bar.w <= w && bar.h >= 36, `@${w} toolbar on screen, tappable (${bar && [bar.x, bar.w, bar.h]})`);
      ok(bar && (w < 600 ? bar.y > bar.fy : bar.y + bar.h <= bar.fy + 40), `@${w} toolbar ${w < 600 ? 'below the selection (clear of the phone bar)' : 'above the selection'} (${bar && [bar.y, bar.fy]})`);
      ok(bar && bar.inDialog, `@${w} toolbar sits in the open sheet (above its backdrop)`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/rich-toolbar-${w}.png` });
      await page.click('.rt-bar [data-rt-m="**"]'); await page.waitForTimeout(150);
      let v = await page.inputValue('#f-desc'); ok(v === 'Ceremony starts at **4 pm sharp**. Bring sunscreen.', `@${w} B wraps: ${v}`);
      const shown = await page.$eval(ED, e => e.innerHTML); ok(shown === 'Ceremony starts at <strong>4 pm sharp</strong>. Bring sunscreen.', `@${w} the editor shows it bold, no markers: ${shown}`);
      const keep = await page.evaluate(() => { const ed = document.querySelector('#f-desc + .rt-ed'); return [document.activeElement === ed, String(getSelection())]; });
      ok(keep[0] && keep[1] === '4 pm sharp', `@${w} focus + selection kept on the text (${keep})`);
      await page.click('.rt-bar [data-rt-m="=="]'); await page.waitForTimeout(150); v = await page.inputValue('#f-desc');
      ok(v === 'Ceremony starts at **==4 pm sharp==**. Bring sunscreen.', `@${w} highlight on top: ${v}`);
      await page.click('.rt-bar [data-rt-m="=="]'); await page.click('.rt-bar [data-rt-m="**"]'); await page.waitForTimeout(150); v = await page.inputValue('#f-desc');
      ok(v === txt, `@${w} toggling again gives back the original: ${v}`);
      // keyboard: Cmd/Ctrl+B and +I on "sunscreen"
      const s0 = txt.indexOf('sunscreen'); await sel(s0, s0 + 9);
      await page.keyboard.press('Control+b'); await page.waitForTimeout(100); v = await page.inputValue('#f-desc'); ok(v === 'Ceremony starts at 4 pm sharp. Bring **sunscreen**.', `@${w} Ctrl+B: ${v}`);
      await page.keyboard.press('Meta+i'); await page.waitForTimeout(100); v = await page.inputValue('#f-desc'); ok(v === 'Ceremony starts at 4 pm sharp. Bring ***sunscreen***.', `@${w} Cmd+I adds italic: ${v}`);
      await page.keyboard.press('Control+b'); await page.waitForTimeout(100); v = await page.inputValue('#f-desc'); ok(v === 'Ceremony starts at 4 pm sharp. Bring *sunscreen*.', `@${w} Ctrl+B again removes bold, italic stays: ${v}`);
      // no selection → no bar; the page preview renders it
      await sel(2, 2); await page.waitForTimeout(150);
      ok(await page.evaluate(() => { const b = document.querySelector('.rt-bar'); return !b || b.hidden; }), `@${w} collapsed selection hides the bar`);
      await page.click('#sheet .btn.primary.big').catch(() => {}); await page.waitForTimeout(600);
      const prev = await page.evaluate(() => { const d = document.querySelector('#preview #sec-about .rm-box, .ev #sec-about .rm-box'); return d ? d.innerHTML : ''; });
      ok(prev === '<p>Ceremony starts at 4 pm sharp. Bring <em>sunscreen</em>.</p>', `@${w} page shows it: ${prev}`);
      // not on unrelated fields (title)
      const tb = await page.evaluate(() => { const el = document.querySelector('[data-f="title"]'); if (!el) return 'none'; el.focus(); el.setSelectionRange(0, 3); document.dispatchEvent(new Event('selectionchange')); return new Promise(r => setTimeout(() => { const b = document.querySelector('.rt-bar'); r(!b || b.hidden ? 'hidden' : 'shown'); }, 120)); });
      ok(tb !== 'shown', `@${w} no toolbar on the title field (${tb})`);
      ok(!(await page.$('[data-f="title"] + .rt-ed')), `@${w} the title stays a plain input`);
      ok(!page._err.length, `@${w} no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
