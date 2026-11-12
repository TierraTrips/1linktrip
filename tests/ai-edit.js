// "Ask AI to edit" can remove things, not just add or change them: sections (custom[i]), route cities (stops[i]),
// documents (files[i]), schedule items and notes, and a type detail can be cleared. The preview shows removals struck
// through and marked Removed; Apply then Undo restores the page. The model's answer is canned here; the real model is
// exercised by tests/ai-edit-live.ts + tests/ai-edit-check.mjs. 390.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/ai-edit.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const SBURL = 'https://mljzoujystouqkmmoemn.supabase.co';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
function fakeSupabase(user) {
  window.__up = []; window.__rm = []; window.__ai = [];
  const storage = { from: (b) => ({
    upload: async (path, blob, o) => { window.__up.push({ b, path, type: o && o.contentType, size: blob.size }); return { data: { path }, error: null }; },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://mljzoujystouqkmmoemn.supabase.co/storage/v1/object/public/${b}/${path}` } }),
    remove: async (ps) => { window.__rm.push(...ps); return { data: [], error: null }; } }) };
  const client = { storage, from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    auth: { getSession: async () => ({ data: { session: user ? { user, access_token: 'a.b.c' } : null } }), signInWithOtp: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
  window.supabase = { createClient: () => client };
}


const USER = { id: 'u0000000-0000-4000-8000-000000000001', email: 'host@example.com' };
(async () => {
  const { PAGE } = await import('./ai-edit-cases.mjs');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(fakeSupabase, USER);
  await page.route(/open-meteo|overpass|nominatim|googleapis\.com\/(?!css)|tile\.openstreetmap|timeapi|photon/, r => r.abort());
  const changes = [{ op: 'remove', path: 'schedule[5]', value_json: '' }, { op: 'set', path: 'custom[0].text', value_json: JSON.stringify('Tokyo: Park Hotel Tokyo\nOsaka: Cross Hotel Osaka') },
    { op: 'remove', path: 'custom[1]', value_json: '' }, { op: 'remove', path: 'stops[2]', value_json: '' }, { op: 'remove', path: 'x.Trip.companions', value_json: '' }, { op: 'remove', path: 'files[0]', value_json: '' }];
  await page.route('**/functions/v1/ai-import', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ready: true, modes: ['url', 'text', 'edit', 'translate', 'file', 'doc'] }) });
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, body: 'ok' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'edit', data: { summary: 'Removed the Kyoto hotel, the dress code, the Osaka leg, companions and the document.', changes } }) });
  });
  await page.route(`${SBURL}/rest/**`, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  const cfg = { ...PAGE, files: [{ id: 'f1', sec: 'route', name: 'Old plan.pdf', url: SBURL + '/storage/v1/object/public/event-files/u/old.pdf', type: 'pdf', size: 10 }] };
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ep:signedIn', 'true'); });
  await page.goto(BASE + '#edit=' + await page.evaluate((c) => window.__ep.packEvent(c), cfg)); await page.waitForSelector('[data-ai-edit]:not([hidden])', { timeout: 15000 });
  const before = await page.evaluate(() => localStorage.getItem('ep:draft'));
  await page.fill('#ai-edit-q', 'remove the hotel in Kyoto, the dress code, the Osaka leg, the companions and the old document'); await page.click('[data-ai-edit-go]');
  await page.waitForSelector('.ai-diff');
  const rows = await page.$$eval('.ai-diff li', ls => ls.map(l => ({ rm: l.classList.contains('rm'), t: l.textContent.replace(/\s+/g, ' ').trim(), struck: !!l.querySelector('s.was') })));
  ok(rows.length === 6, `6 changes previewed ${JSON.stringify(rows)}`);
  ok(rows.filter(r => r.rm).length === 5 && rows.filter(r => r.rm).every(r => r.struck && /Removed$/.test(r.t)), 'removals struck through and marked Removed');
  ok(rows.some(r => r.rm && /Hotel Granvia Kyoto/.test(r.t)) && rows.some(r => r.rm && /Dress code/.test(r.t)) && rows.some(r => r.rm && /Osaka/.test(r.t)) && rows.some(r => r.rm && /Sam, Alex/.test(r.t)) && rows.some(r => r.rm && /Old plan\.pdf/.test(r.t)), 'each removal names what goes');
  if (SHOTS) await page.locator('[data-ai-edit]').screenshot({ path: `${SHOTS}/ai-edit-remove-390.png` });
  await page.click('[data-ai-edit-apply]'); await page.waitForTimeout(500);
  const c = await page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));
  ok(!c.schedule.some(x => /Granvia/.test(x.title)) && c.schedule.length === 7, 'schedule item removed');
  ok(c.custom.length === 1 && !/Granvia/.test(c.custom[0].text) && /Cross Hotel/.test(c.custom[0].text), 'Hotels section edited, Dress code section removed');
  ok(c.stops.map(s => s.name).join() === 'Tokyo,Kyoto', 'Osaka leg removed');
  ok(!(c.x.Trip || {}).companions && !c.files, 'detail cleared, document removed');
  await page.click('[data-ai-edit-undo]'); await page.waitForTimeout(500);
  const u = await page.evaluate(() => localStorage.getItem('ep:draft'));
  ok(JSON.stringify(JSON.parse(u)) === JSON.stringify(JSON.parse(before)), 'Undo restores the page');
  ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
