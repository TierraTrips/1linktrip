// "Custom section" card: add several sections (title, text, link, photo link), each shows on the guest page as its own
// section in the normal order, can be reordered/hidden in Design → Sections, survives the share link and a hosted-config
// round trip, is offered for translation, and Delete asks first (in-app dialog). Old pages without it render as before.
// No horizontal overflow at 320 and 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/custom-sections.js
//   OLD_BASE=http://127.0.0.1:18766/ node tests/custom-sections.js   # also compare an old page against a previous build
//   SHOTS=/tmp/ep-shots node tests/custom-sections.js
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

(async () => {
  const browser = await chromium.launch();
  const ctxFor = (w) => browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  let ctx = await ctxFor(390); let page = await ctx.newPage();
  await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES);
  await page.evaluate(() => localStorage.clear());
  const base = { v: 2, type: 'Party', title: 'Lake weekend', start: '2027-06-12T15:00', host: 'Sam', description: 'Bring a towel.', schedule: [{ date: '2027-06-12', time: '16:00', title: 'Swim', note: '' }], notes: [{ label: 'Parking', text: 'Behind the barn', url: '' }] };
  const oldPacked = await page.evaluate((c) => window.__ep.packEvent(c), base);

  // old page (no custom sections) renders exactly as the previous build does
  const bodyOf = async (b) => { await page.goto(b + '#e=' + oldPacked); await page.waitForSelector('.ev-body'); await page.waitForTimeout(300); return page.$eval('.ev-panel[data-panel="event"] .ev-body', e => e.innerHTML.replace(/<div data-slot="weather">[\s\S]*?<\/section>/, '')); };
  const nowBody = await bodyOf(BASE);
  ok(!/class="ev-sec cs/.test(nowBody), 'old page: no custom sections');
  if (OLD_BASE) { const oldBody = await bodyOf(OLD_BASE); ok(oldBody === nowBody, 'old page: Event tab identical to the previous build'); }

  // editor: the card is under "For any event"
  await page.goto(BASE + '#edit=' + oldPacked); await page.waitForSelector('[data-card="custom"]');
  const grp = await page.evaluate(() => { const b = document.querySelector('[data-card="custom"]'); const g = b.closest('.cards').previousElementSibling; return [g.textContent, b.querySelector('b').textContent, b.querySelector('span:not(.aic)').textContent]; });
  ok(grp[0] === 'For any event' && grp[1] === 'Custom section' && grp[2] === 'Your own heading and info', `card: ${grp.join(' | ')}`);
  await page.click('[data-card="custom"]'); await page.waitForSelector('#sheet[open] [data-cs="0"][data-k="title"]');
  ok((await page.$$('#sheet .cs-row')).length === 1, 'opening the card starts one blank section');
  ok(await page.textContent('#sheet h2') === 'Custom section×', 'sheet title');
  const img = BASE + 'icon-192.png';
  await page.fill('[data-cs="0"][data-k="title"]', 'Getting to the dock');
  await page.fill('[data-cs="0"][data-k="text"]', 'Take the gravel road past the gate.\n\nBoats leave at 4.');
  await page.fill('[data-cs="0"][data-k="label"]', 'Ferry times');
  await page.fill('[data-cs="0"][data-k="url"]', 'https://example.com/ferry');
  await page.fill('[data-cs="0"][data-k="img"]', img);
  await page.click('[data-b="add-custom"]'); await page.waitForSelector('[data-cs="1"][data-k="title"]'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => document.activeElement.matches('[data-cs="1"][data-k="title"]')), 'Add section focuses the new title');
  await page.fill('[data-cs="1"][data-k="title"]', 'House rules');
  await page.fill('[data-cs="1"][data-k="text"]', 'Shoes off inside.');
  if (SHOTS) await page.locator('#sheet').screenshot({ path: `${SHOTS}/custom-sheet-390.png` });
  ok((await overflow(page)).length === 0, 'sheet @390: no overflow');
  await page.click('#sheet .btn.primary.big'); await page.waitForTimeout(600);
  ok(await page.$eval('[data-card="custom"] .plus', e => e.textContent) === '✓', 'card shows done');

  const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
  ok(cfg.custom.length === 2 && cfg.custom[0].title === 'Getting to the dock' && cfg.custom[0].url === 'https://example.com/ferry' && cfg.custom[0].img === img && cfg.custom[1].text === 'Shoes off inside.', 'saved in the page config');
  const [s0, s1] = cfg.custom.map(x => 'c-' + x.id);

  // Design → Sections lists them; move the second one up
  const secs = await page.evaluate(() => [...document.querySelectorAll('.order [data-sec-on]')].map(i => i.dataset.secOn));
  ok(secs.slice(-2).join() === [s0, s1].join(), `Sections list ends with the custom ones: ${secs.join()}`);
  await page.evaluate((s) => document.querySelector(`[data-sec-mv="${s}"][data-dir="-1"]`).click(), s1); await page.waitForTimeout(500);
  const cfg2 = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));

  // share link → guest page
  const packed = await page.evaluate((c) => window.__ep.packEvent(c), cfg2);
  for (const w of [390, 320]) {
    await ctx.close(); ctx = await ctxFor(w); page = await ctx.newPage();
    await page.goto(BASE + '#e=' + packed); await page.waitForSelector('.ev-body'); await page.waitForTimeout(800);
    const order = await page.$$eval('.ev-panel[data-panel="event"] .ev-body [data-sec]', es => es.map(e => e.dataset.sec));
    ok(order.indexOf(s1) >= 0 && order.indexOf(s1) < order.indexOf(s0), `@${w} both on the page, moved one first: ${order.join()}`);
    const d = await page.$eval(`#sec-${s0}`, e => ({ h: e.querySelector('h2').textContent, ps: [...e.querySelectorAll('p')].map(p => p.textContent), a: e.querySelector('a')?.href, b: e.querySelector('a b')?.textContent, img: e.querySelector('img.cs-img')?.src, imgW: e.querySelector('img.cs-img')?.getBoundingClientRect().width, secW: e.getBoundingClientRect().width }));
    ok(d.h === 'Getting to the dock' && d.ps.join('|') === 'Take the gravel road past the gate.|Boats leave at 4.' && d.a === 'https://example.com/ferry' && d.b === 'Ferry times' && d.img === img, `@${w} section content ${JSON.stringify(d)}`);
    ok(d.imgW > 0 && d.imgW <= d.secW, `@${w} photo fits the section (${d.imgW} ≤ ${d.secW})`);
    const of = await overflow(page); ok(of.length === 0, `@${w} guest page: no overflow ${of.join(' ')}`);
    if (SHOTS) { await page.locator(`#sec-${s0}`).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/custom-guest-${w}.png` }); }
  }

  // hosted config round trip (JSON through events.config → normalize), unsafe links dropped on the page, hide toggle
  const rt = await page.evaluate((c) => { const u = window.__ep.unpackEvent(window.__ep.packEvent(JSON.parse(JSON.stringify(c)))); return u.custom; }, cfg2);
  ok(JSON.stringify(rt) === JSON.stringify(cfg2.custom), 'config round trip keeps custom sections');
  const evil = await page.evaluate((c) => { c = JSON.parse(JSON.stringify(c)); c.custom[0].url = 'javascript:alert(1)'; c.custom[0].img = 'javascript:x'; c.off = { ['c-' + c.custom[1].id]: true }; return window.__ep.packEvent(c); }, cfg2);
  await page.goto(BASE + '#e=' + evil); await page.waitForSelector('.ev-body'); await page.waitForTimeout(300);
  ok(!(await page.$(`#sec-${s0} a`)) && !(await page.$(`#sec-${s0} img`)), 'non-http link and photo are left off');
  ok(!(await page.$(`#sec-${s1}`)), 'hidden section is off the page');

  // translation covers title, text and link name
  const tf = await page.evaluate((c) => { const u = window.__ep.unpackEvent(window.__ep.packEvent(c)); const f = window.__ep.textFields(u);
    u.tr = { es: { 'custom[0].title': { h: window.__ep.hashStr(f['custom[0].title']), t: 'Cómo llegar al muelle' } } };
    return { keys: Object.keys(f).filter(k => k.startsWith('custom')), tr: window.__ep.translatedView(u, 'es').custom[0].title }; }, cfg2);
  ok(tf.keys.join() === 'custom[0].title,custom[0].text,custom[0].label,custom[1].title,custom[1].text' && tf.tr === 'Cómo llegar al muelle', `translation fields ${tf.keys.join()} → ${tf.tr}`);

  // delete asks first (in-app dialog): Cancel keeps it, Delete removes it and its order/hidden entries
  await ctx.close(); ctx = await ctxFor(320); page = await ctx.newPage();
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  const withOff = await page.evaluate((c) => { c = JSON.parse(JSON.stringify(c)); c.off = { ...(c.off || {}), ['c-' + c.custom[0].id]: true }; return window.__ep.packEvent(c); }, cfg2);
  await page.goto(BASE + '#edit=' + withOff); await page.waitForSelector('[data-card="custom"]');
  await page.click('[data-card="custom"]'); await page.waitForSelector('#sheet[open] [data-cdel="0"]');
  ok((await overflow(page)).length === 0, 'sheet @320: no overflow');
  if (SHOTS) await page.locator('#sheet').screenshot({ path: `${SHOTS}/custom-sheet-320.png` });
  await page.click('[data-cdel="0"]'); await page.waitForSelector('#confirmdlg[open]');
  ok(/Delete “Getting to the dock”\?/.test(await page.textContent('#confirmdlg h2')), 'confirm dialog names the section');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/custom-confirm-320.png` });
  await page.click('#confirmdlg button[value="cancel"]'); await page.waitForTimeout(200);
  ok((await page.$$('#sheet .cs-row')).length === 2, 'Cancel keeps it');
  await page.click('[data-cdel="0"]'); await page.waitForSelector('#confirmdlg[open]');
  await page.click('#confirmdlg button[value="ok"]'); await page.waitForTimeout(600);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
  ok(after.custom.length === 1 && after.custom[0].title === 'House rules' && !(s0 in after.off) && !(after.order || []).includes(s0), 'Delete removes it with its order and hidden entries');
  ok(await page.evaluate(() => document.querySelector('#sheet').open), 'sheet stays open after the dialog');
  // a blank section goes without asking
  await page.click('[data-b="add-custom"]'); await page.waitForSelector('[data-cdel="1"]');
  await page.click('[data-cdel="1"]'); await page.waitForTimeout(300);
  ok(!(await page.evaluate(() => document.querySelector('#confirmdlg')?.open)) && (await page.$$('#sheet .cs-row')).length === 1, 'blank section deletes without the dialog');

  await browser.close();
  console.log(fails.length ? `\n${fails.length} failing` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})();
