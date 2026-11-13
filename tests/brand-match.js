// Design → "Match your brand": a website link (ai-import mode "brand") or an uploaded logo/screenshot (colors found in the
// browser) proposes accent, light/dark background, text, the closest title font and a logo, as a preview with Apply /
// Cancel, then Undo. The accent always keeps WCAG AA (4.5:1) against the page and its button text. "Start from a
// website" picks the site's colors up too (box on by default). Live part (LIVE=1, needs the Supabase PAT): the deployed
// function on real brand sites through a throwaway user, deleted after.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/brand-match.js
//   LIVE=1 SHOTS=/tmp/ep-shots node tests/brand-match.js
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const FIX = __dirname + '/fixtures/';
const overflow = (page, sel) => page.evaluate((sel) => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll(sel + ' *')].filter(e => e.offsetParent && e.getBoundingClientRect().right > cw + 1).map(e => e.className || e.tagName); }, sel);
// a recorded mode "brand" answer (shape of the deployed function's reply for a purple brand with a serif display face)
const SITE = { url: 'https://acme.example/', themeColor: '', vars: [{ name: '--brand-primary', hex: '#5b2a86' }], colors: [{ hex: '#ffffff', n: 40, bg: 20, fg: 4 }, { hex: '#111111', n: 30, bg: 2, fg: 20 }, { hex: '#5b2a86', n: 18, bg: 6, fg: 2 }, { hex: '#ffcc00', n: 3, bg: 1, fg: 0 }],
  background: '#ffffff', text: '#111111', fonts: ['Playfair Display', 'Inter'], logo: 'https://acme.example/logo.svg', icon: '', image: '' };
const EVENT = { title: 'Acme Summit 2027', type: 'Conference', tagline: '', host: '', description: 'Our yearly summit.', start_date: '2027-05-04', start_time: '', end_date: '', end_time: '', venue_name: '', venue_address: '', rsvp_url: '', rsvp_by: '', dress_code: '', schedule: [], hotel_blocks: [], faqs: [], links: [], details: {}, extras: [] };
function fakeSupabase(user) {
  window.__up = [];
  const storage = { from: (b) => ({ upload: async (path, blob, o) => { window.__up.push({ b, path, type: o && o.contentType, size: blob.size }); return { data: { path }, error: null }; },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://mljzoujystouqkmmoemn.supabase.co/storage/v1/object/public/${b}/${path}` } }), remove: async () => ({ data: [], error: null }) }) };
  window.supabase = { createClient: () => ({ storage, from: () => { const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, then: (f, r) => Promise.resolve({ data: [], error: null }).then(f, r) }; return q; },
    auth: { getSession: async () => ({ data: { session: user ? { user, access_token: 'a.b.c' } : null } }), getUser: async () => ({ data: { user } }), signInWithOtp: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
}
const setFile = (page, sel, path, type = 'image/png') => page.evaluate(([sel, b64, name, type]) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const f = new File([u], name, { type }); const i = document.querySelector(sel); const dt = new DataTransfer(); dt.items.add(f); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, fs.readFileSync(path).toString('base64'), path.split('/').pop(), type]);

(async () => {
  const browser = await chromium.launch();
  const USER = { id: 'u0000000-0000-4000-8000-0000000000b7', email: 'host@example.com' };
  const mk = async (w, user) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e))); page._ai = [];
    await page.addInitScript(fakeSupabase, user);
    await page.route(/open-meteo|overpass|nominatim|googleapis\.com\/(?!css)|tile\.openstreetmap|timeapi|photon/, r => r.abort());
    await page.route(/acme\.example|storage\/v1\/object\/public/, r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(FIX + 'brand-logo.png') }));
    await page.route('**/functions/v1/ai-import', async (r) => {
      if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ready: true, modes: ['url', 'text', 'edit', 'translate', 'file', 'doc', 'brand'] }) });
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, body: 'ok' });
      const body = JSON.parse(r.request().postData() || '{}'); page._ai.push(body);
      if (body.mode === 'brand') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'brand', data: SITE }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'event', data: EVENT }) });
    });
    await page.route(/supabase\.co\/rest\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.__ep.brandFromSite);
    await page.evaluate((u) => { localStorage.clear(); if (u) localStorage.setItem('ep:signedIn', 'true'); }, !!user);
    return { ctx, page };
  };
  const draft = async (page) => { await page.waitForTimeout(450); return page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft'))); };
  const openDesign = async (page) => { await page.goto(BASE + '#edit-ex=tulum-wedding'); await page.waitForSelector('[data-acc="design"]'); await page.evaluate(() => { document.querySelector('[data-acc="design"]').open = true; }); await page.waitForSelector('[data-brand-box]'); };
  const hue = (hex) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };

  // ---- pure: AA in both modes, font matching, site answer → theme ----
  {
    const { ctx, page } = await mk(390, USER);
    const r = await page.evaluate(() => { const E = window.__ep; const out = [];
      for (const hex of ['#FFD100', '#1ED760', '#7B61FF', '#0F4A50', '#000080', '#FF6B35', '#E4572E', '#F5F5FF']) for (const mode of ['light', 'dark']) {
        const a = E.aaAccent(hex, mode); out.push({ hex, mode, a, min: Math.min(...E.PAGE_BG[mode].map(bg => E.contrast(a, bg))), btn: E.contrast(a, a && (E.contrast(a, '#ffffff') >= E.contrast(a, '#111318') ? '#ffffff' : '#111318')) }); }
      return { out, fonts: [['Playfair Display'], ['Oswald', 'Inter'], ['Inter'], ['Unbounded'], ['Merriweather'], ['Fraunces'], ['circular', 'new-spirit'], []].map(f => E.closestFont(f, 'field')),
        site: E.brandFromSite({ themeColor: '', vars: [{ name: '--brand-primary', hex: '#5b2a86' }], colors: [{ hex: '#ffffff', n: 40 }, { hex: '#111111', n: 30 }, { hex: '#5b2a86', n: 18 }], background: '#ffffff', fonts: ['Playfair Display'], logo: 'https://acme.example/logo.svg' }, { font: 'field' }),
        dark: E.brandFromSite({ themeColor: '#000000', vars: [], colors: [{ hex: '#000000', n: 50 }, { hex: '#ffed00', n: 20 }], background: '', fonts: [], logo: '' }, { font: 'wide' }),
        none: E.brandFromSite({ themeColor: '', vars: [], colors: [{ hex: '#ffffff', n: 5 }], background: '', fonts: [], logo: '' }, { font: 'field' }) }; });
    ok(r.out.every(x => x.min >= 4.5 && x.btn >= 4.5), `AA accent vs page + button text in light and dark (${r.out.filter(x => !(x.min >= 4.5 && x.btn >= 4.5)).map(x => x.hex + '/' + x.mode + '→' + x.a + ' ' + x.min.toFixed(2)).join(', ') || 'all ≥ 4.5'})`);
    ok(r.out.find(x => x.hex === '#0F4A50' && x.mode === 'light').a === '#0f4a50', 'an accent that already passes is left alone');
    ok(r.fonts.join() === 'classic,condensed,grotesk,wide,field,serif,serif,field', `closest title font: ${r.fonts.join(', ')}`);
    ok(r.site && r.site.accent === '#5b2a86' && r.site.mode === 'light' && r.site.font === 'classic' && r.site.logo === 'https://acme.example/logo.svg', `site answer → ${JSON.stringify(r.site)}`);
    ok(r.dark && r.dark.mode === 'dark' && Math.abs(hue(r.dark.accent) - 56) < 8, `black theme-color + yellow → dark page, yellow accent (${JSON.stringify(r.dark)})`);
    ok(r.none === null, 'a site with no colors proposes nothing');
    await ctx.close();
  }

  for (const w of [390, 320]) {
    const signed = w === 390; const { ctx, page } = await mk(w, signed ? USER : null);
    await openDesign(page);
    const before = (await draft(page)) || {}; const th0 = await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('ep:draft')) || {}; return c.theme; });
    ok(/Match your brand/.test(await page.textContent('[data-brand-box]')), `@${w} Match your brand in Design`);
    // screenshot → coral accent on a light page
    await setFile(page, '[data-brand-file]', FIX + 'brand-screenshot.png'); await page.waitForSelector('.brand-prev');
    let p = await page.evaluate(() => B.brand.prop).catch(() => null);
    p = p || await page.evaluate(() => ({ accent: getComputedStyle(document.querySelector('.brand-prev')).getPropertyValue('--pa').trim(), dark: document.querySelector('.brand-prev').classList.contains('dark') }));
    const acc = (p.accent || '').toLowerCase(); const dark = p.mode ? p.mode === 'dark' : p.dark;
    ok(Math.abs(hue(acc) - hue('#e4572e')) < 12 && !dark, `@${w} screenshot → coral accent ${acc}, light background`);
    const facts = await page.$$eval('.bp-facts li', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim()));
    ok(facts.length === 4 && /^Color/.test(facts[0]) && /Background Light/.test(facts[1]) && /^Text/.test(facts[2]) && /Title font .*unchanged/.test(facts[3]), `@${w} preview lists color, background, text, font: ${facts.join(' | ')}`);
    ok(!(await page.$('[data-brand-logo]')), `@${w} a screenshot isn't offered as a logo`);
    if (SHOTS) await page.locator('[data-brand-box]').screenshot({ path: `${SHOTS}/brand-shot-${w}.png` });
    ok((await overflow(page, '[data-acc="design"]')).length === 0, `@${w} no overflow in Design`);
    await page.click('[data-brand="apply"]'); let c = await draft(page);
    ok(c.theme.accent.toLowerCase() === acc && c.theme.mode === 'light', `@${w} Apply → ${JSON.stringify(c.theme)}`);
    ok(await page.$eval('#preview .ev', (e, a) => (e.getAttribute('style') || '').toLowerCase().includes(a), acc), `@${w} live preview uses it`);
    ok(/Brand applied/.test(await page.textContent('[data-brand-msg]')), `@${w} Undo offered`);
    await page.click('[data-brand="undo"]'); c = await draft(page);
    ok(JSON.stringify(c.theme) === JSON.stringify(th0), `@${w} Undo restores ${JSON.stringify(c.theme)}`);

    // transparent logo → its colors, offered as the logo; Cancel changes nothing
    await setFile(page, '[data-brand-file]', FIX + 'brand-logo.png'); await page.waitForSelector('.brand-prev');
    ok(await page.$eval('[data-brand-logo]', i => i.checked) && !!(await page.$('.brand-prev .bp-logo')), `@${w} logo offered (checked) and previewed`);
    const lacc = await page.evaluate(() => getComputedStyle(document.querySelector('.brand-prev')).getPropertyValue('--pa').trim());
    ok([hue('#c9a227'), hue('#1b2a4a')].some(h => Math.abs(hue(lacc) - h) < 15), `@${w} logo colors → accent ${lacc}`);
    await page.click('[data-brand="cancel"]'); c = await draft(page); ok(!(await page.$('.brand-prev')) && JSON.stringify(c.theme) === JSON.stringify(th0), `@${w} Cancel keeps the design`);
    await setFile(page, '[data-brand-file]', FIX + 'brand-logo.png'); await page.waitForSelector('.brand-prev');
    await page.click('[data-brand="apply"]'); c = await draft(page);
    if (signed) {
      const up = await page.evaluate(() => window.__up);
      ok(up.length === 1 && up[0].type === 'image/png' && up[0].path.startsWith(USER.id + '/'), `@${w} logo uploaded as PNG to the host's folder ${JSON.stringify(up)}`);
      ok(/^https:\/\/.*\/storage\/v1\/object\/public\/event-files\//.test(c.logo || ''), `@${w} page logo = ${c.logo}`);
      await page.waitForSelector('#preview .ev-logo', { state: 'attached' }); ok(await page.$eval('#preview .ev-logo', i => i.complete && i.naturalWidth > 0), `@${w} logo shows in the page header`);
      ok(!!(await page.$('.logo-row img')), `@${w} Design shows the logo with Remove`);
      if (SHOTS) { await page.click('.seg button[data-tab="preview"]').catch(() => {}); await page.waitForTimeout(300); await page.locator('#preview .ev-hero').screenshot({ path: `${SHOTS}/brand-hero-${w}.png` }).catch(e => console.log('shot', e.message)); await page.click('.seg button[data-tab="edit"]').catch(() => {}); }
      await page.click('[data-b="logo-clear"]'); c = await draft(page); ok(!c.logo && !(await page.$('#preview .ev-logo')), `@${w} Remove logo`);
    } else {
      ok(!c.logo && /Sign in to add the logo/.test(await page.textContent('[data-brand-msg]')), `@${w} signed out: colors applied, asked to sign in for the logo`);
    }

    // website link
    await page.fill('[data-brand-url]', 'acme.example'); await page.click('[data-brand="go"]');
    if (signed) {
      await page.waitForSelector('.brand-prev'); const sent = page._ai.filter(x => x.mode === 'brand');
      ok(sent.length === 1 && sent[0].url === 'https://acme.example/', `@${w} link → ai-import brand ${JSON.stringify(sent)}`);
      ok(/Formal/.test(await page.textContent('.bp-facts')) && !!(await page.$('.brand-prev .bp-logo')), `@${w} site font (Playfair → Formal) and logo previewed`);
      const thSite = (await draft(page)).theme; await page.click('[data-brand="apply"]'); c = await draft(page);
      ok(c.theme.accent === '#5b2a86' && c.theme.font === 'classic' && c.logo === 'https://acme.example/logo.svg', `@${w} site brand applied ${JSON.stringify(c.theme)} ${c.logo}`);
      await page.click('[data-brand="undo"]'); c = await draft(page); ok(!c.logo && JSON.stringify(c.theme) === JSON.stringify(thSite), `@${w} Undo removes the site logo too (${c.logo} ${JSON.stringify(c.theme)})`);
    } else {
      await page.waitForTimeout(300); ok(/Sign in to read a website/.test(await page.textContent('[data-brand-msg]')) && !page._ai.some(x => x.mode === 'brand'), `@${w} signed out: link asks to sign in, nothing sent`);
    }
    ok(!page._err.length, `@${w} no page errors ${page._err.join(' ')}`);
    await ctx.close();
  }

  // ---- Start from a website: box on by default, the site's colors land on the new page ----
  {
    const { ctx, page } = await mk(390, USER);
    await page.goto(BASE + '#setup'); await page.waitForSelector('[data-su-ai]:not([hidden])');
    await page.click('[data-su="ai-open"]'); await page.waitForSelector('.su-ai-form:not([hidden])');
    ok(await page.$eval('[data-su-brand]', i => i.checked), 'Start from a website: "Use the site’s colors and logo" on by default');
    await page.fill('#su-ai-url', 'acme.example'); await page.click('[data-su="ai-go"]'); await page.waitForSelector('.b-form', { timeout: 20000 });
    const c = await draft(page);
    ok(c.title === 'Acme Summit 2027' && c.theme.accent === '#5b2a86' && c.theme.font === 'classic' && c.logo === 'https://acme.example/logo.svg', `imported page in the site's colors ${JSON.stringify(c.theme)} ${c.logo}`);
    ok(page._ai.some(x => x.mode === 'brand') && page._ai.some(x => x.url && !x.mode), 'brand read alongside the import');
    // box off → no brand call, type defaults kept
    await page.evaluate(() => localStorage.removeItem('ep:draft')); page._ai = [];
    await page.goto(BASE + '#mine'); await page.goto(BASE + '#setup'); await page.waitForSelector('[data-su-ai]:not([hidden])');
    await page.click('[data-su="ai-open"]'); await page.uncheck('[data-su-brand]'); await page.fill('#su-ai-url', 'acme.example'); await page.click('[data-su="ai-go"]'); await page.waitForSelector('.b-form', { timeout: 20000 });
    const c2 = await draft(page); ok(!page._ai.some(x => x.mode === 'brand') && c2.theme.accent !== '#5b2a86' && !c2.logo, `box off → no brand (${c2.theme.accent})`);
    ok(!page._err.length, `setup: no page errors ${page._err.join(' ')}`);
    await ctx.close();
  }

  // ---- live: the deployed function on real brand sites (throwaway user, deleted after) ----
  if (process.env.LIVE) {
    const PAT = fs.readFileSync('/Users/bot/bbbot/secrets/supabase-pat', 'utf8').trim();
    const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
    const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
    const SR = keys.find(k => k.name === 'service_role').api_key;
    const admin = (path, init = {}) => fetch(SBURL + path, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    const EMAIL = `ep-brand-${Date.now().toString(36)}@example.com`; const PASS = 'T' + Math.random().toString(36).slice(2) + 'x9!';
    const u = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true }) })).json(); const UID = u.id;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' }); const page = await ctx.newPage();
    try {
      await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.__ep.sb);
      ok(await page.evaluate(async ([e, p]) => { const c = await window.__ep.sb(); const r = await c.auth.signInWithPassword({ email: e, password: p }); localStorage.setItem('ep:signedIn', 'true'); return !!(r.data && r.data.session); }, [EMAIL, PASS]), 'live: throwaway user signed in');
      const SITES = [['https://stripe.com/', 250, 'Stripe purple'], ['https://www.spotify.com/us/', 141, 'Spotify green'], ['https://www.zola.com/', 181, 'Zola teal']];
      for (const [url, h, what] of SITES) {
        // called from here (not the page): the function only answers the site's own origins, not this local server
        const tok = await page.evaluate(async () => { const c = await window.__ep.sb(); const { data } = await c.auth.getSession(); return data.session.access_token; });
        const res = await fetch(`${SBURL}/functions/v1/ai-import`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, apikey: await page.evaluate(() => window.EP_SUPABASE.key), 'Content-Type': 'application/json', Origin: 'https://1linktrip.com' }, body: JSON.stringify({ mode: 'brand', url }) });
        const j = await res.json(); const r = { status: res.status, cors: res.headers.get('access-control-allow-origin'), p: j.ok ? await page.evaluate((d) => window.__ep.brandFromSite(d, { font: 'field' }), j.data) : null };
        ok(r.cors === 'https://1linktrip.com', `live ${url}: CORS answers the site (${r.cors})`);
        const p = r.p || {}; const E = await page.evaluate((a) => a ? Math.min(...['#F2F3F6', '#FFFFFF'].map(bg => window.__ep.contrast(a, bg))) : 0, p.accent);
        ok(r.status === 200 && p.accent && Math.abs(hue(p.accent) - h) < 20 && E >= 4.5, `live ${url}: ${what} → ${p.accent} (raw ${p.raw}, ${p.mode}, font ${p.font}, contrast ${E.toFixed(2)}${p.logo ? ', logo ' + p.logo.slice(0, 60) : ''})`);
      }
    } finally {
      await ctx.close();
      if (UID) { await admin(`/auth/v1/admin/users/${UID}`, { method: 'DELETE' }); ok((await admin(`/auth/v1/admin/users/${UID}`)).status === 404, 'live: throwaway user deleted'); }
    }
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
