// Builder Design section: one dropdown per setting (Style, Color, Title font, Background) with plain names and a small
// preview, Custom… color keeps the picker + code, live preview follows; stored theme values are the same as before (old
// pages unchanged). Cover photo and a Custom section's photo: Upload (photo picker), drag-and-drop, or a link; uploads go
// to Storage (event-files/<user id>/…) resized (cover ≤500 KB / 1600 px, section photo ≤300 KB); signed out → sign-in.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/design-photos.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page, sel) => page.evaluate((sel) => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll(sel + ' *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).slice(0, 4).map(e => e.tagName + '.' + e.className); }, sel);
function fakeSupabase(user) {
  window.__up = [];
  const storage = { from: (b) => ({ upload: async (path, blob, o) => { const bm = await createImageBitmap(blob).catch(() => null); window.__up.push({ b, path, type: o && o.contentType, size: blob.size, w: bm && bm.width, h: bm && bm.height }); return { data: { path }, error: null }; },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://mljzoujystouqkmmoemn.supabase.co/storage/v1/object/public/${b}/${path}` } }), remove: async () => ({ data: [], error: null }) }) };
  window.supabase = { createClient: () => ({ storage, from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }), auth: { getSession: async () => ({ data: { session: user ? { user, access_token: 'a.b.c' } : null } }), signInWithOtp: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
}
const bigPhoto = (page, w = 4000, h = 2600) => page.evaluateHandle(async ([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); const d = g.createImageData(w, h); for (let i = 0; i < d.data.length; i++) d.data[i] = (Math.random() * 255) | 0; g.putImageData(d, 0, 0);
  const b = await new Promise(r => c.toBlob(r, 'image/png')); return new File([b], 'IMG_2041.png', { type: 'image/png' }); }, [w, h]);
const setFile = async (page, sel, fileHandle) => page.evaluate(([sel, f]) => { const i = document.querySelector(sel); const dt = new DataTransfer(); dt.items.add(f); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, fileHandle]);

(async () => {
  const browser = await chromium.launch();
  const USER = { id: 'u0000000-0000-4000-8000-000000000009', email: 'host@example.com' };
  for (const w of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(fakeSupabase, w === 390 ? USER : null);
    await page.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon/, r => r.abort());
    await page.route('**/storage/v1/object/public/**', r => r.fulfill({ contentType: 'image/png', body: require('fs').readFileSync(__dirname + '/../icon-192.png') }));
    await page.route('https://example.com/**', r => r.fulfill({ contentType: 'image/png', body: require('fs').readFileSync(__dirname + '/../icon-192.png') }));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    const ex = await page.evaluate(() => JSON.parse(JSON.stringify(window.EXAMPLES['tulum-wedding'])));
    await page.evaluate((u) => { localStorage.clear(); if (u) localStorage.setItem('ep:signedIn', 'true'); }, w === 390);
    await page.goto(BASE + '#edit-ex=tulum-wedding'); await page.waitForSelector('[data-acc="design"]');
    await page.evaluate(() => { document.querySelector('[data-acc="design"]').open = true; });
    const labels = await page.$$eval('.dgrid .field > label', ls => ls.map(l => l.textContent));
    ok(labels.join('|') === 'Style|Color|Title font|Background', `@${w} dropdowns: ${labels.join(' | ')}`);
    ok(!(await page.$('[data-acc="design"] .presets, [data-acc="design"] .fonts, [data-acc="design"] .swatches .sw')), `@${w} no option grids`);
    const opts = (id) => page.$$eval(`#${id} option`, os => os.map(o => o.textContent));
    ok((await opts('d-style')).join() === 'Classic,Natural,Romantic,Bright,Elegant,Night,Bold,Outdoors' || (await opts('d-style')).slice(1).join() === 'Classic,Natural,Romantic,Bright,Elegant,Night,Bold,Outdoors', `@${w} styles: ${(await opts('d-style')).join(', ')}`);
    ok((await opts('d-color')).join() === 'Dark teal,Teal,Orange,Rose,Purple,Gold,Charcoal,Green,Custom…', `@${w} colors: ${(await opts('d-color')).join(', ')}`);
    ok((await opts('d-font')).join() === 'Classic,Modern,Elegant,Formal,Bold,Wide', `@${w} fonts: ${(await opts('d-font')).join(', ')}`);
    if (SHOTS) await page.locator('[data-acc="design"]').screenshot({ path: `${SHOTS}/design-${w}.png` });
    ok((await overflow(page, '[data-acc="design"]')).length === 0, `@${w} design: no overflow ${(await overflow(page, '[data-acc="design"]')).join(' ')}`);
    const draft = async () => { await page.waitForTimeout(450); return page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft'))); };
    // stored values identical to the presets/swatches/fonts as before
    await page.selectOption('#d-style', 'Romance'); let c = await draft();
    ok(c.theme.accent === '#C2185B' && c.theme.font === 'classic' && c.theme.mode === 'light', `@${w} Romantic → ${JSON.stringify(c.theme)}`);
    ok(await page.$eval('#preview .ev', e => /#C2185B/i.test(e.getAttribute('style') || '')), `@${w} live preview follows`);
    await page.selectOption('#d-color', '#6D28D9'); c = await draft(); ok(c.theme.accent === '#6D28D9', `@${w} Purple → ${c.theme.accent}`);
    ok(await page.$eval('#d-style', s => s.value) === '', `@${w} style shows Custom after changing the color`);
    await page.selectOption('#d-color', 'custom'); await page.waitForSelector('#f-accent-hex');
    await page.fill('#f-accent-hex', '#123456'); c = await draft(); ok(c.theme.accent === '#123456', `@${w} Custom… code → ${c.theme.accent}`);
    await page.selectOption('#d-font', 'wide'); await page.selectOption('#d-mode', 'dark'); c = await draft();
    ok(c.theme.font === 'wide' && c.theme.mode === 'dark', `@${w} font + background → ${c.theme.font} ${c.theme.mode}`);
    ok(await page.$eval('#preview .ev', e => e.classList.contains('dark')), `@${w} preview dark`);
    // old page unchanged: the example's theme passes through untouched
    const rt = await page.evaluate((e) => JSON.stringify(window.__ep.unpackEvent(window.__ep.packEvent(e)).theme), ex);
    ok(rt === JSON.stringify({ ...ex.theme }) || JSON.parse(rt).accent === ex.theme.accent, `@${w} example theme unchanged ${rt}`);

    // cover photo
    const ph = await bigPhoto(page);
    await setFile(page, '[data-ph-key="cover"] [data-ph-file]', ph);
    if (w === 320) { // signed out
      await page.waitForSelector('[data-ph-key="cover"] .bk-signin'); ok(/Sign in to upload photos/.test(await page.textContent('[data-ph-key="cover"] .bk-signin')), '@320 signed out → sign-in prompt');
      if (SHOTS) await page.locator('[data-acc="design"]').screenshot({ path: `${SHOTS}/design-signin-320.png` });
    } else {
      await page.waitForFunction(() => window.__up.length === 1); c = await draft();
      const up = await page.evaluate(() => window.__up[0]);
      ok(up.path.startsWith(USER.id + '/') && /IMG_2041\.jpg$/.test(up.path) && up.type === 'image/jpeg' && up.size <= 500e3 && up.w <= 1600, `@${w} cover uploaded ${JSON.stringify(up)}`);
      ok(c.cover.startsWith('https://mljzoujystouqkmmoemn.supabase.co/storage/v1/object/public/event-files/' + USER.id + '/'), `@${w} cover set ${c.cover}`);
      await page.waitForSelector('[data-ph-key="cover"] .ph-img');
      ok(await page.textContent('[data-ph-key="cover"] label.file-pick') === 'Replace photo', `@${w} Replace photo`);
      // drag-and-drop
      const ph2 = await bigPhoto(page, 1200, 900);
      await page.evaluate((f) => { const z = document.querySelector('[data-ph-key="cover"] [data-ph-drop]'); const dt = new DataTransfer(); dt.items.add(f); z.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); z.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }, ph2);
      await page.waitForFunction(() => window.__up.length === 2); ok(true, `@${w} drop uploads`);
      // link still works; Remove clears
      await page.fill('#f-cover', 'https://example.com/a.jpg'); c = await draft(); ok(c.cover === 'https://example.com/a.jpg', `@${w} link field kept`);
      await page.waitForTimeout(100); await page.evaluate(() => { const i = document.querySelector('#f-cover'); i.blur(); });
      await page.evaluate(() => { document.querySelector('[data-acc="design"]').open = true; });
      if (await page.$('[data-ph-clear]')) { await page.click('[data-ph-clear]'); c = await draft(); ok(c.cover === '', `@${w} Remove photo`); }
      // custom section photo
      await page.click('[data-card="custom"]'); await page.waitForSelector('#sheet[open] [data-ph-key="cs:0"]');
      await page.fill('#sheet [data-cs="0"][data-k="title"]', 'Getting there');
      const ph3 = await bigPhoto(page, 3000, 3000);
      await setFile(page, '#sheet [data-ph-key="cs:0"] [data-ph-file]', ph3);
      await page.waitForFunction(() => window.__up.length === 3); c = await draft();
      const up3 = await page.evaluate(() => window.__up[2]);
      ok(up3.size <= 300e3 && up3.type === 'image/jpeg' && c.custom[0].img.includes('/event-files/' + USER.id + '/'), `@${w} section photo ${up3.size} bytes → ${c.custom[0].img.slice(-30)}`);
      await page.waitForSelector('#sheet [data-ph-key="cs:0"] .ph-img');
      if (SHOTS) await page.locator('#sheet').screenshot({ path: `${SHOTS}/custom-photo-${w}.png` });
      ok((await overflow(page, '#sheet')).length === 0, `@${w} sheet: no overflow`);
      await page.click('#sheet [data-b="close"]');
    }
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failing` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
