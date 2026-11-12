// "Upload a document" accepts a dropped file on desktop: every upload block (main page + each section sheet) is a drop
// zone that highlights on dragover and starts the same flow as picking the file (main → "Put it in"; a section → Fill
// from document / Attach for guests). A file dropped anywhere else on the builder goes to the main flow (an open sheet
// closes first). On phones the hint is hidden and nothing overflows.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/doc-drop.js
//   SHOTS=/tmp/ep-shots node tests/doc-drop.js
//
// Needs Playwright. Exit code 1 on any failure.
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
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
// fire a real DragEvent sequence carrying a PDF at an element
const drag = (page, sel, steps = ['dragenter', 'dragover', 'drop'], name = 'Japan plan.pdf') => page.evaluate(({ sel, steps, name }) => {
  const el = document.querySelector(sel); if (!el) return 'missing ' + sel;
  const dt = new DataTransfer(); dt.items.add(new File(['%PDF-1.4\n' + ' '.repeat(2000)], name, { type: 'application/pdf' }));
  const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 5, clientY: r.top + 5 };
  return steps.map(t => { const ev = new DragEvent(t, o); el.dispatchEvent(ev); return ev.defaultPrevented; });
}, { sel, steps, name });

(async () => {
  const browser = await chromium.launch();
  const mk = async (w, mobile) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2, isMobile: !!mobile, hasTouch: !!mobile, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route(/open-meteo|overpass|nominatim|googleapis\.com\/(?!css)|tile\.openstreetmap|timeapi|photon|ai-import/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '#edit-ex=japan-trip'); await page.waitForSelector('[data-doc-key="main"] [data-doc-drop]');
    return { ctx, page, errors };
  };
  {
    const { ctx, page, errors } = await mk(1280);
    ok(await page.isVisible('[data-doc-key="main"] .doc-or'), 'desktop: main block says "or drop a file here"');
    const ov = await drag(page, '[data-doc-key="main"] [data-doc-drop]', ['dragenter', 'dragover']);
    ok(ov[1] === true && await page.$eval('[data-doc-key="main"] [data-doc-drop]', z => z.classList.contains('over')), 'dragover highlights the main drop zone');
    if (SHOTS) await page.locator('[data-doc-key="main"]').screenshot({ path: `${SHOTS}/doc-drop-over-1280.png` });
    await drag(page, '[data-doc-key="main"] [data-doc-drop]', ['drop']); await page.waitForSelector('#doc-into');
    ok(/Japan plan\.pdf/.test(await page.textContent('[data-doc-key="main"] .doc-name')), 'drop on main → same "Put it in" step with the file');
    await page.click('[data-doc-key="main"] [data-doc-cancel]');

    // a section sheet
    await page.click('[data-card="route"]'); await page.waitForSelector('#sheet[open] [data-doc-key="route"] [data-doc-drop]');
    ok(await page.isVisible('#sheet [data-doc-key="route"] .doc-or'), 'route sheet: drop hint');
    await drag(page, '#sheet [data-doc-key="route"] [data-doc-drop]', ['dragenter', 'dragover']);
    ok(await page.$eval('#sheet [data-doc-key="route"] [data-doc-drop]', z => z.classList.contains('over')), 'route sheet: dragover highlights');
    await drag(page, '#sheet [data-doc-key="route"] [data-doc-drop]', ['drop']); await page.waitForSelector('#sheet [data-doc-key="route"] [data-doc-go="attach"]');
    ok(/Japan plan\.pdf/.test(await page.textContent('#sheet [data-doc-key="route"] .doc-name')), 'drop on a section → its file with Fill / Attach');
    if (SHOTS) await page.locator('#sheet [data-doc-key="route"]').screenshot({ path: `${SHOTS}/doc-drop-section-1280.png` });
    await page.click('#sheet [data-doc-key="route"] [data-doc-go="attach"]'); await page.waitForSelector('#sheet [data-doc-key="route"] .bk-signin');
    ok(true, 'then Attach goes through the normal flow (signed out → inline sign-in)');

    // anywhere else while a sheet is open → the sheet closes, the main flow takes the file
    await drag(page, '#sheet h2', ['dragenter', 'dragover']);
    ok(await page.evaluate(() => document.body.classList.contains('doc-dragging')), 'page-wide dragover shows the drop overlay');
    await drag(page, '#sheet h2', ['drop'], 'Hotel list.pdf'); await page.waitForSelector('#doc-into');
    ok(!(await page.$('#sheet[open]')) && /Hotel list\.pdf/.test(await page.textContent('[data-doc-key="main"] .doc-name')) && !(await page.evaluate(() => document.body.classList.contains('doc-dragging'))), 'drop on the open sheet → sheet closes, main "Put it in" with the file');
    await page.click('[data-doc-key="main"] [data-doc-cancel]');
    // anywhere on the builder page
    await drag(page, '.b-form', ['dragenter', 'dragover', 'drop'], 'Visa notes.pdf'); await page.waitForSelector('#doc-into');
    ok(/Visa notes\.pdf/.test(await page.textContent('[data-doc-key="main"] .doc-name')), 'drop anywhere on the builder → main flow');
    // a dragged non-file (text) is ignored
    const t = await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'hi'); const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }); document.querySelector('.b-form').dispatchEvent(ev); return ev.defaultPrevented; });
    ok(t === false, 'dragging text is left alone');
    ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  for (const w of [390, 320]) {
    const { ctx, page, errors } = await mk(w, true);
    ok(!(await page.isVisible('[data-doc-key="main"] .doc-or')), `@${w} phone: no drop hint`);
    const of = await overflow(page); ok(of.length === 0, `@${w} no overflow ${of.join(' ')}`);
    if (SHOTS && w === 390) await page.locator('[data-doc-key="main"]').screenshot({ path: `${SHOTS}/doc-drop-main-390.png` });
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
