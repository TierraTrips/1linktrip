// Host-added guest languages, made obvious: in the builder's Guest languages card each language shows its state
// (Translating… → Ready ✓ · Edit translation) and is translated the moment it's added (not only at Share); the builder
// preview has "Preview in: English | 日本語"; the guest page shows the host's languages as a pill switch at the top
// ("English · 日本語"), auto-picking the guest's browser language when the host offers it; the shared link (long or
// short) carries the stored translations, so guests see them at once with no translate request.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/guest-langs.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const CFG = { v: 2, type: 'Trip', title: 'Spring in Kyoto', tagline: 'Temples and tea', description: 'A week of gardens and food.', start: '2027-04-01', end: '2027-04-07',
  venue: { name: 'Kyoto', address: 'Kyoto', lat: 35.0116, lon: 135.7681, city: 'Kyoto', country: 'Japan', cc: 'jp' }, notes: [{ label: 'Money', text: 'Bring cash.', url: '' }], tools: { mytrip: true } };
const JA = (s) => '【JA】' + s;

function fakeSupabase(user) {
  window.supabase = { createClient: () => ({ storage: { from: () => ({}) }, from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    auth: { getSession: async () => ({ data: { session: user ? { user, access_token: 'a.b.c' } : null } }), signInWithOtp: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
}
(async () => {
  const browser = await chromium.launch();
  const USER = { id: 'u0000000-0000-4000-8000-0000000000cc', email: 'host@example.com' };
  const mk = async ({ user = USER, locale = 'en-US', slow = 0 } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale });
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e))); page._tr = [];
    await page.addInitScript(fakeSupabase, user);
    await page.route(/open-meteo|overpass|nominatim|googleapis\.com\/(?!css)|tile\.openstreetmap|timeapi|photon/, r => r.abort());
    await page.route('**/functions/v1/ai-import', async (r) => {
      if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ready: true, modes: ['url', 'text', 'edit', 'translate', 'file', 'doc'] }) });
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, body: 'ok' });
      const body = JSON.parse(r.request().postData() || '{}'); page._tr.push(body);
      if (slow) await new Promise(res => setTimeout(res, slow));
      const tag = body.target === 'ja' ? JA : (s) => `[${body.target}] ${s}`;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'translate', data: { translations: Object.entries(body.fields || {}).map(([key, text]) => ({ key, text: tag(text) })) } }) });
    });
    await page.route(/supabase\.co\/rest\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await page.evaluate(([cfg, signed]) => { localStorage.clear(); if (signed) localStorage.setItem('ep:signedIn', 'true'); localStorage.setItem('ep:aiModes', JSON.stringify({ t: Date.now(), m: ['url', 'text', 'edit', 'translate', 'file', 'doc'] }));
      localStorage.setItem('ep:pages', JSON.stringify([{ pid: 'p1', cfg, url: '', hosted: null, updated: 1 }])); }, [CFG, !!user]);
    return { ctx, page };
  };

  let longUrl = '';
  // ---- builder: add Japanese → translated right away, status rows, preview switch; Share carries the translations ----
  {
    const { ctx, page } = await mk({ slow: 600 });
    await page.goto(BASE + '#page=p1'); await page.waitForSelector('.b-form');
    await page.waitForSelector('[data-card="langs"]', { timeout: 10000 }); await page.click('[data-card="langs"]'); await page.waitForSelector('#sheet[open] [data-guest-lang="ja"]', { state: 'attached' });
    await page.click('#sheet label:has([data-guest-lang="ja"])');
    await page.waitForSelector('#sheet [data-tr-status="ja"]');
    ok(/Translating/.test(await page.textContent('#sheet [data-tr-status="ja"]')), 'adding 日本語: "Translating…" at once');
    await page.waitForFunction(() => /Ready/.test(document.querySelector('#sheet [data-tr-status="ja"]')?.textContent || ''), null, { timeout: 10000 });
    ok(page._tr.length === 1 && page._tr[0].target === 'ja' && Object.keys(page._tr[0].fields).includes('title'), 'one translate request for ja when added (not waiting for Share)');
    ok(/Ready ✓/.test(await page.textContent('#sheet [data-tr-status="ja"]')) && !!(await page.$('#sheet [data-tr-edit="ja"]')), 'status: Ready ✓ · Edit translation');
    await page.waitForTimeout(500); const c = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
    ok(c.tr && c.tr.ja && c.tr.ja.title && c.tr.ja.title.t === JA('Spring in Kyoto'), 'translations stored in the page');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/langs-card-390.png' });
    await page.click('#sheet [data-tr-edit="ja"]'); ok(await page.$eval('#sheet details.tr-review[data-tr-lang="ja"]', d => d.open), 'Edit translation opens the lines to edit');
    await page.evaluate(() => document.querySelector('#sheet').close());
    // preview switch
    await page.click('.seg [data-tab="preview"]').catch(() => {});
    await page.waitForSelector('.onp-bar [data-pv-lang]');
    ok((await page.$$eval('.onp-bar [data-pv-lang]', bs => bs.map(b => b.textContent).join('|'))) === 'English|日本語', 'Preview in: English | 日本語');
    await page.click('.onp-bar [data-pv-lang="ja"]'); await page.waitForTimeout(600);
    ok((await page.textContent('#preview .ev-hero')).includes(JA('Spring in Kyoto')), 'preview shows the Japanese page');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/langs-preview-ja-390.png' });
    await page.click('.onp-bar [data-pv-lang="en"]'); await page.waitForTimeout(600);
    ok((await page.textContent('#preview .ev-hero')).includes('Spring in Kyoto') && !(await page.textContent('#preview .ev-hero')).includes('【JA】'), 'back to English');
    // edit the title → ja goes stale and is re-translated
    await page.evaluate(() => { const i = document.querySelector('#f-title'); i.value = 'Spring in Kyoto and Nara'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => { const c = JSON.parse(localStorage.getItem('ep:draft')); return c.tr.ja.title && c.tr.ja.title.t.includes('Nara'); }, null, { timeout: 15000 });
    ok(true, 'edited text is re-translated on its own');
    // Share signed in → short link; here: the long link (Share without signing in path is covered in share-hosted.js)
    longUrl = await page.evaluate(() => location.origin + location.pathname + '#e=' + window.__ep.packEvent(JSON.parse(localStorage.getItem('ep:draft'))));
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }
  // ---- guest with an English browser: pills English · 日本語 at the top; Japanese is instant (no request) ----
  {
    const { ctx, page } = await mk({ user: null });
    await page.evaluate(() => localStorage.clear());
    await page.goto(longUrl); await page.waitForSelector('.ev-hero');
    ok(!!(await page.$('.vbar .lang-pills')), 'guest page: language pills in the top bar');
    ok((await page.$$eval('.vbar .lang-pills [data-lang-pill]', bs => bs.map(b => b.textContent).join('|'))) === 'English|日本語', 'pills: English | 日本語');
    ok(await page.$eval('.lang-pills [data-lang-pill="en"]', b => b.getAttribute('aria-pressed') === 'true'), 'English browser → English');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/langs-guest-pills-390.png' });
    await page.click('.lang-pills [data-lang-pill="ja"]'); await page.waitForSelector('.ev-hero');
    ok((await page.textContent('.ev-hero')).includes(JA('Spring in Kyoto and Nara')), 'tap 日本語 → the host\'s Japanese, at once');
    ok(page._tr.length === 0, 'no translate request (the link carries the translations)');
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }
  // ---- guest with a Japanese browser: auto-picks 日本語 ----
  {
    const { ctx, page } = await mk({ user: null, locale: 'ja-JP' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(longUrl); await page.waitForSelector('.ev-hero');
    ok((await page.textContent('.ev-hero')).includes('【JA】') && await page.$eval('.lang-pills [data-lang-pill="ja"]', b => b.getAttribute('aria-pressed') === 'true'), 'Japanese browser → 日本語 picked');
    ok(page._tr.length === 0, 'no translate request');
    await ctx.close();
  }
  // ---- a page with no guest languages: no pills (the picker stays as before) ----
  {
    const { ctx, page } = await mk({ user: null });
    const url = await page.evaluate((c) => location.origin + location.pathname + '#e=' + window.__ep.packEvent(c), CFG);
    await page.evaluate(() => localStorage.clear()); await page.goto(url); await page.waitForSelector('.ev-hero');
    ok(!(await page.$('.lang-pills')) && !!(await page.$('.vbar .lang-sel')), 'no host languages: no pills, picker as before');
    await ctx.close();
  }
  // ---- signed out host: the card says to sign in to translate ----
  {
    const { ctx, page } = await mk({ user: null });
    await page.evaluate((c) => { const xs = JSON.parse(localStorage.getItem('ep:pages')); xs[0].cfg = { ...c, langs: ['ja'] }; localStorage.setItem('ep:pages', JSON.stringify(xs)); }, CFG);
    await page.goto(BASE + '#page=p1'); await page.waitForSelector('[data-card="langs"]'); await page.click('[data-card="langs"]');
    await page.waitForSelector('#sheet [data-tr-status="ja"]');
    ok(/Sign in/.test(await page.textContent('#sheet [data-tr-status="ja"]')), 'signed out: "Sign in to translate"');
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
