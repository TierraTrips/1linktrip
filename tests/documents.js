// "Upload a document": in each "Add to your page" sheet (Fill from document → review → Apply/Undo; Attach for guests →
// Storage upload → shown in that section on the guest page with View / Download), and once on the main page (Put it in:
// Sort automatically / one section / New custom section; the review lets each item move section, be removed or edited).
// Signed out → inline sign-in. Old pages render exactly as before. No horizontal overflow at 390 and 320.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/documents.js
//   OLD_BASE=http://127.0.0.1:18766/ node tests/documents.js   # also compare old pages against a previous build
//   SHOTS=/tmp/ep-shots node tests/documents.js
//
// supabase-js is faked in the page; ai-import answers are canned (shaped like a real mode "doc" answer). Exit 1 on failure.
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const OLD_BASE = process.env.OLD_BASE || '';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => {
  const cw = document.documentElement.clientWidth;
  return [...document.querySelectorAll('body *')].filter(e => {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return false;
    if (e.closest('dialog:not([open])')) return false;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false;
    const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1;
  }).slice(0, 5).map(e => e.tagName.toLowerCase() + '.' + [...e.classList].join('.'));
});
const SBURL = 'https://mljzoujystouqkmmoemn.supabase.co';

// what ai-import mode "doc" returns for a small Japan itinerary (whole document)
const DOC = {
  title: 'Japan in spring', type: 'Trip', tagline: '', host: 'Sam', description: 'Ten days from Tokyo to Osaka.', start_date: '2027-04-01', start_time: '', end_date: '2027-04-10', end_time: '',
  venue_name: '', venue_address: '', rsvp_url: '', rsvp_by: '', dress_code: '', hotel_blocks: [], faqs: [{ question: 'Money', answer: 'Carry some cash; many small places are cash only.' }], links: [], details: {}, extras: [],
  stops: [{ city: 'Tokyo', country: 'Japan', arrive: '2027-04-01', leave: '2027-04-05' }, { city: 'Kyoto', country: 'Japan', arrive: '2027-04-05', leave: '2027-04-08' }, { city: 'Osaka', country: 'Japan', arrive: '2027-04-08', leave: '2027-04-10' }],
  schedule: [{ date: '2027-04-01', time: '15:00', title: 'Check in: Park Hotel Tokyo', note: 'Conf. PH-4417', kind: 'reservation' }, { date: '2027-04-02', time: '09:00', title: 'Tsukiji outer market', note: '', kind: 'activity' },
    { date: '2027-04-05', time: '10:03', title: 'Shinkansen Nozomi 215 to Kyoto', note: 'Car 7, seats 4A-4B', kind: 'reservation' }],
  sections: [{ title: 'Emergency contacts', text: 'Police 110\nAmbulance 119' }], bring: 'Passport\nJR Pass voucher', access: { dropoff: '', entrance: '', parking: '', restrooms: '', notes: '' },
};

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

(async () => {
  const browser = await chromium.launch();
  const mk = async (w, { user = null, answer = () => DOC } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(fakeSupabase, user);
    await page.route(/open-meteo|overpass|nominatim|googleapis\.com\/(?!css)|tile\.openstreetmap|timeapi|photon/, r => r.abort());
    await page.route('**/functions/v1/ai-import', async (r) => {
      if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ready: true, modes: ['url', 'text', 'edit', 'translate', 'file', 'doc'] }) });
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, body: 'ok' });
      const body = JSON.parse(r.request().postData() || '{}'); await page.evaluate((b) => window.__ai.push(b), { ...body, files: body.files.map(f => ({ media_type: f.media_type, n: f.data.length })) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'event', data: answer(body) }) });
    });
    await page.route(`${SBURL}/rest/**`, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    return { ctx, page, errors };
  };
  const pdf = (name = 'japan-itinerary.pdf', size = 2000) => ({ name, mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(size, 32)]) });
  // the review is a summary: one row per section; tap a row to list its items, tap an item to edit just that one
  const openRow = async (page, scope, name) => { const b = page.locator(`${scope} .dr-gt`, { hasText: name }).first(); if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click(); await page.waitForTimeout(80); };
  const editLine = async (page, scope, re) => { const i = await page.$$eval(`${scope} .dr-line`, (bs, src) => { const r = new RegExp(src); const b = bs.find(x => r.test(x.textContent)); return b ? b.dataset.drEdit : null; }, re.source); if (i == null) throw new Error('no line ' + re); await page.click(`${scope} [data-dr-edit="${i}"]`); await page.waitForTimeout(80); return i; };
  const rows = (page, scope) => page.$$eval(`${scope} .dr-gt .dr-gn`, xs => xs.map(x => x.childNodes[0].textContent + x.childNodes[1].textContent));
  const draft = async (page) => { await page.waitForTimeout(450); return page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft'))); }; // the builder saves 300 ms after a change

  // ---------- old pages: identical rendering, config unchanged ----------
  {
    const { ctx, page } = await mk(390);
    await page.goto(BASE); await page.waitForFunction(() => window.__ep && window.EXAMPLES);
    const ids = await page.evaluate(() => Object.keys(window.EXAMPLES));
    for (const id of ids) {
      const same = await page.evaluate((id) => { const c = window.EXAMPLES[id]; const u = window.__ep.unpackEvent(window.__ep.packEvent(c)); return !('files' in u); }, id);
      ok(same, `${id}: no files key added by normalize`);
    }
    if (OLD_BASE) {
      const panels = async (b, id) => { await page.goto(b + '#ex=' + id); await page.waitForSelector('.ev-body'); await page.waitForTimeout(400);
        return page.$$eval('.ev-panel', ps => ps.map(p => p.innerHTML.replace(/<div data-slot="(weather|map|food|legend|pack-list|pack-sum|rental|flights|stays|trains)"[\s\S]*?<\/div>/g, '').length)); };
      for (const id of ids) { const a = await panels(OLD_BASE, id), b = await panels(BASE, id); if (await page.evaluate((id) => { const c = window.EXAMPLES[id]; return c.type === 'Trip' && (c.stops || []).some(s => s && s.name); }, id)) { a[0] = b[0]; } // trips with a route: the Event tab now shows the route inside the Itinerary (tests/itinerary-route.js)
        ok(JSON.stringify(a) === JSON.stringify(b), `${id}: panels match the previous build (${a} vs ${b})`); }
    }
    await ctx.close();
  }

  // ---------- signed out: controls present; any upload asks to sign in ----------
  {
    const { ctx, page } = await mk(390);
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ep:aiReady', JSON.stringify({ t: Date.now(), ok: true })); });
    await page.goto(BASE + '#edit-ex=japan-trip'); await page.waitForSelector('[data-card="route"]');
    ok(await page.isVisible('[data-doc-key="main"] [data-doc-pick]') || await page.isVisible('[data-doc-key="main"] .doc-pick'), 'main page: Upload a document');
    await page.click('[data-card="route"]'); await page.waitForSelector('#sheet[open] [data-doc-key="route"]');
    const labels = await page.$$eval('#sheet [data-doc-key="route"] label.file-pick', ls => ls.filter(l => !l.hidden).map(l => l.textContent.trim()));
    ok(labels.join('|') === 'Fill from document|Attach for guests', `route sheet: ${labels.join(' | ')}`);
    ok(await page.textContent('#sheet .doc-h') === 'Upload a document', 'route sheet: "Upload a document" label');
    await page.setInputFiles('#sheet [data-doc-attach]', pdf()); await page.waitForSelector('#sheet .bk-signin');
    ok(/Sign in to upload documents/.test(await page.textContent('#sheet .bk-signin')), 'signed out + Attach → inline sign-in');
    if (SHOTS) await page.locator('#sheet').screenshot({ path: `${SHOTS}/doc-signin-390.png` });
    await page.click('#sheet [data-b="close"]');
    await page.setInputFiles('[data-doc-pick]', pdf()); await page.waitForSelector('[data-doc-go="fill"]');
    await page.click('[data-doc-go="fill"]'); await page.waitForSelector('[data-doc-key="main"] .bk-signin');
    ok(true, 'signed out + main Fill → inline sign-in');
    // each sheet that should have it
    for (const id of ['schedule', 'notes', 'about', 'bring', 'companions']) {
      await page.click(`[data-card="${id}"]`); await page.waitForSelector('#sheet[open]');
      ok(!!(await page.$(`#sheet [data-doc-key="${id}"]`)), `${id} sheet has Upload a document`); await page.click('#sheet [data-b="close"]'); await page.waitForTimeout(100);
    }
    await page.click('[data-card="langs"]').catch(() => {}); await page.waitForTimeout(150);
    ok(!(await page.$('#sheet[open] [data-doc-key]')), 'Guest languages sheet has none');
    await ctx.close();
  }

  // ---------- signed in: section fill (Route), attach, guest page ----------
  const USER = { id: 'u0000000-0000-4000-8000-000000000001', email: 'host@example.com' };
  let cfgAfter = null;
  {
    const { ctx, page, errors } = await mk(390, { user: USER, answer: (b) => b.section === 'route' ? { ...DOC, schedule: [], sections: [], faqs: [], bring: '', host: '', description: '' } : DOC });
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ep:signedIn', 'true'); });
    await page.goto(BASE + '#edit-ex=japan-trip'); await page.waitForSelector('[data-card="route"]');
    await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('ep:draft')); });
    const before = await draft(page);
    await page.click('[data-card="route"]'); await page.waitForSelector('#sheet [data-doc-fillbtn]:not([hidden])');
    await page.setInputFiles('#sheet [data-doc-fill]', pdf()); await page.waitForSelector('#sheet [data-sheet="doc-review"]');
    const req = await page.evaluate(() => window.__ai[0]);
    ok(req.mode === 'doc' && req.section === 'route' && req.type === 'Trip' && req.files[0].media_type === 'application/pdf', `request ${JSON.stringify(req)}`);
    const groups = await rows(page, '#sheet');
    ok(groups.join(' | ') === 'Basics · trip dates | Route · 3 cities', `route review summary: ${groups.join(' | ')}`);
    ok((await page.$$('#sheet .dr-line, #sheet .dr-item, #sheet [data-dr]')).length === 0, 'summary only: no item lines or edit fields until a row is tapped');
    ok(await page.textContent('#sheet [data-doc-apply]') === 'Add' && await page.$$eval('#sheet [data-dr-gon]', xs => xs.every(x => x.checked)), 'one Add button, every row ticked');
    if (SHOTS) await page.locator('#sheet').screenshot({ path: `${SHOTS}/doc-route-review-390.png` });
    ok((await overflow(page)).length === 0, 'route review @390: no overflow');
    // open Route → its cities as plain lines; tap Osaka → only Osaka's fields; remove it; rename Kyoto
    await openRow(page, '#sheet', 'Route');
    ok((await page.$$eval('#sheet .dr-line', bs => bs.map(b => b.textContent))).join('|') === 'Tokyo · Apr 1–5, 2027|Kyoto · Apr 5–8, 2027|Osaka · Apr 8–10, 2027' && !(await page.$('#sheet [data-dr]')), 'Route row lists its cities read-only');
    if (SHOTS) await page.locator('#sheet').screenshot({ path: `${SHOTS}/doc-route-rows-390.png` });
    const osaka = await editLine(page, '#sheet', /Osaka/);
    ok((await page.$$('#sheet .dr-item')).length === 1 && (await page.$$('#sheet [data-dr]')).length === 3, 'tapping a city opens only that city\'s fields');
    await page.click(`#sheet [data-dr-del="${osaka}"]`); await page.waitForTimeout(100);
    const kyoto = await editLine(page, '#sheet', /Kyoto/);
    await page.fill(`#sheet [data-dr="${kyoto}"][data-dk="title"]`, 'Kyoto (Gion)');
    ok((await rows(page, '#sheet')).join(' | ') === 'Basics · trip dates | Route · 2 cities', 'the row count follows the edits');
    await page.click('#sheet [data-doc-apply]'); await page.waitForSelector('#sheet [data-doc-undo]');
    let c = await draft(page);
    ok(c.stops.map(s => s.name).join() === 'Tokyo,Kyoto (Gion)' && c.stops[0].from === '2027-04-01' && c.stops[1].to === '2027-04-08', `route filled: ${JSON.stringify(c.stops.map(s => [s.name, s.from, s.to]))}`);
    ok(c.start.slice(0, 10) === '2027-04-01' && c.end.slice(0, 10) === '2027-04-10', `trip dates set ${c.start}–${c.end}`);
    await page.click('#sheet [data-doc-undo]'); await page.waitForTimeout(200);
    c = await draft(page); ok(JSON.stringify(c.stops) === JSON.stringify(before.stops) && c.start === before.start, 'Undo restores the route and dates');
    // apply again for the rest of the test
    await page.setInputFiles('#sheet [data-doc-fill]', pdf()); await page.waitForSelector('#sheet [data-doc-apply]'); await page.click('#sheet [data-doc-apply]'); await page.waitForSelector('#sheet [data-doc-undo]');

    // attach the PDF for guests
    await page.setInputFiles('#sheet [data-doc-attach]', pdf('Japan itinerary.pdf', 5000)); await page.waitForSelector('#sheet .doc-files li');
    const up = await page.evaluate(() => window.__up[0]);
    ok(up.b === 'event-files' && up.path.startsWith(USER.id + '/') && /Japan-itinerary\.pdf$/.test(up.path) && up.type === 'application/pdf', `uploaded ${JSON.stringify(up)}`);
    c = await draft(page);
    ok(c.files.length === 1 && c.files[0].sec === 'route' && c.files[0].name === 'Japan itinerary.pdf' && c.files[0].type === 'pdf' && c.files[0].url.startsWith(SBURL + '/storage/v1/object/public/event-files/' + USER.id + '/'), `config ${JSON.stringify(c.files)}`);
    // too-large PDF and a non-document are refused before upload
    await page.setInputFiles('#sheet [data-doc-attach]', pdf('big.pdf', 10.5 * 1024 * 1024)); await page.waitForFunction(() => /too large/.test(document.querySelector('#sheet [data-doc-key="route"] [data-doc-msg]').textContent));
    ok(await page.evaluate(() => window.__up.length) === 1, 'PDF over 10 MB refused');
    await page.setInputFiles('#sheet [data-doc-attach]', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }); await page.waitForFunction(() => /PDF or a photo/.test(document.querySelector('#sheet [data-doc-key="route"] [data-doc-msg]').textContent));
    ok(true, 'non-document refused');
    // a big photo is shrunk to ≤300 KB JPEG
    const ph = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; const g = c.getContext('2d'); const d = g.createImageData(4000, 3000); for (let i = 0; i < d.data.length; i++) d.data[i] = (Math.random() * 255) | 0; g.putImageData(d, 0, 0);
      const b = await new Promise(r => c.toBlob(r, 'image/png')); const p = await window.__ep.docPrepare(new File([b], 'IMG_1.png', { type: 'image/png' })); return { inSize: b.size, size: p.blob.size, type: p.type, name: p.name }; });
    ok(ph.size <= 300e3 && ph.type === 'image/jpeg' && ph.name === 'IMG_1.jpg', `photo ${ph.inSize} → ${ph.size} bytes JPEG`);
    if (SHOTS) await page.locator('#sheet').screenshot({ path: `${SHOTS}/doc-route-attached-390.png` });
    await page.click('#sheet [data-b="close"]'); await page.waitForTimeout(300);

    // ---------- main page: Put it in → Sort automatically → move / remove / edit → Apply → Undo ----------
    await page.setInputFiles('[data-doc-pick]', pdf()); await page.waitForSelector('#doc-into');
    const into = await page.$$eval('#doc-into option', os => os.map(o => o.textContent));
    ok(into[0] === 'Sort automatically' && into.includes('Route') && into.includes('Day by day') && into.includes('Notes for guests') && into[into.length - 1] === 'New custom section', `Put it in: ${into.join(' | ')}`);
    if (SHOTS) await page.locator('[data-doc-key="main"]').screenshot({ path: `${SHOTS}/doc-main-pick-390.png` });
    const c0 = await draft(page);
    await page.click('[data-doc-go="fill"]'); await page.waitForSelector('[data-doc-key="main"] [data-sheet="doc-review"]');
    ok((await page.evaluate(() => window.__ai.at(-1).section)) === '', 'Sort automatically asks for the whole document');
    const g2 = await page.$$eval('[data-doc-key="main"] .dr-gt b', hs => hs.map(h => h.textContent));
    ok(!(await page.$('[data-doc-key="main"] [data-dr]')), 'main review starts as a summary (no edit fields)');
    ok(['Route', 'Itinerary', 'Notes for guests', 'About', 'Must-bring items', 'Emergency contacts', 'New custom section'].filter(x => g2.includes(x)).length >= 6, `grouped by section: ${g2.join(' | ')}`);
    ok((await overflow(page)).length === 0, 'main review @390: no overflow');
    if (SHOTS) await page.locator('[data-doc-key="main"]').screenshot({ path: `${SHOTS}/doc-main-review-390.png` });
    // move "Tsukiji outer market" from Itinerary to Notes for guests
    await openRow(page, '[data-doc-key="main"]', 'Itinerary'); const ts = await editLine(page, '[data-doc-key="main"]', /Tsukiji/);
    await page.selectOption(`[data-dr-sec="${ts}"]`, 'notes'); await page.waitForTimeout(100);
    ok(await page.$eval(`[data-dr-sec="${ts}"]`, s => s.value) === 'notes', 'item moved to Notes for guests');
    // remove the hotel, edit the train
    const ht = await editLine(page, '[data-doc-key="main"]', /Park Hotel/);
    await page.click(`[data-dr-del="${ht}"]`); await page.waitForTimeout(100);
    const tr = await editLine(page, '[data-doc-key="main"]', /Shinkansen/);
    ok((await page.$$('[data-doc-key="main"] .dr-item')).length === 1, 'one item open at a time');
    await page.fill(`[data-dr="${tr}"][data-dk="time"]`, '10:33');
    await page.click('[data-doc-key="main"] [data-doc-apply]'); await page.waitForSelector('[data-doc-key="main"] [data-doc-undo]');
    c = await draft(page);
    const sch = c.schedule.filter(x => !c0.schedule.some(y => y.title === x.title && y.date === x.date && y.time === x.time));
    ok(sch.length === 1 && sch[0].title === 'Shinkansen Nozomi 215 to Kyoto' && sch[0].time === '10:33' && sch[0].kind === 'reservation', `schedule got the edited train only: ${JSON.stringify(sch)}`);
    ok(c.notes.some(n => n.label === 'Tsukiji outer market') && c.notes.some(n => n.label === 'Money'), 'notes got the moved item + the FAQ');
    ok(c.custom.some(x => x.title === 'Emergency contacts' && x.text === 'Police 110\nAmbulance 119'), 'custom section made, line breaks kept');
    ok(/JR Pass voucher/.test(c.bring) && /Ten days from Tokyo/.test(c.description), 'bring + about filled');
    await page.click('[data-doc-key="main"] [data-doc-undo]'); await page.waitForTimeout(200);
    c = await draft(page); ok(JSON.stringify(c) === JSON.stringify(c0), 'Undo restores the whole page');

    // Put it in = one section → just that section
    await page.setInputFiles('[data-doc-pick]', pdf()); await page.waitForSelector('#doc-into');
    await page.selectOption('#doc-into', 'schedule'); await page.click('[data-doc-go="fill"]'); await page.waitForSelector('[data-doc-key="main"] [data-sheet="doc-review"]');
    ok((await page.evaluate(() => window.__ai.at(-1).section)) === 'schedule', 'one section → section "schedule" asked');
    const g3 = await page.$$eval('[data-doc-key="main"] .dr-gt b', hs => hs.map(h => h.textContent));
    ok(g3.join() === 'Itinerary', `only Itinerary items: ${g3.join()}`);
    // untick a row → Add applies nothing from it
    const c3 = await draft(page);
    await page.uncheck('[data-doc-key="main"] [data-dr-gon="schedule"]'); await page.waitForTimeout(80);
    ok(await page.$eval('[data-doc-key="main"] [data-doc-apply]', b => b.disabled), 'unticking the only row disables Add');
    await page.check('[data-doc-key="main"] [data-dr-gon="schedule"]'); await page.waitForTimeout(80);
    await page.click('[data-doc-key="main"] [data-doc-apply]'); await page.waitForSelector('[data-doc-key="main"] [data-doc-undo]');
    ok((await draft(page)).schedule.length > c3.schedule.length && /Added/.test(await page.textContent('[data-doc-key="main"] [data-doc-msg]')), 'one tap on Add to page applies the ticked rows');
    await page.click('[data-doc-key="main"] [data-doc-undo]'); await page.waitForTimeout(200);

    // New custom section: Fill → a section from the document, with the file attached
    await page.setInputFiles('[data-doc-pick]', pdf('Visa notes.pdf')); await page.waitForSelector('#doc-into');
    await page.selectOption('#doc-into', 'new-custom'); await page.click('[data-doc-go="fill"]'); await page.waitForSelector('[data-doc-key="main"] [data-doc-apply]');
    ok((await page.evaluate(() => window.__ai.at(-1).section)) === 'custom', 'new custom section → section "custom" asked');
    await page.click('[data-doc-key="main"] [data-doc-apply]'); await page.waitForSelector('[data-doc-key="main"] [data-doc-undo]');
    c = await draft(page); const nc = c.custom[c.custom.length - 1];
    ok(nc.title === 'Emergency contacts' && c.files.some(f => f.sec === 'c-' + nc.id && f.name === 'Visa notes.pdf'), `new custom section with the file: ${nc.title}, ${JSON.stringify(c.files.map(f => f.sec))}`);
    // New custom section: Attach only → section named after the file
    await page.setInputFiles('[data-doc-pick]', pdf('Packing_guide.pdf')); await page.waitForSelector('#doc-into');
    await page.selectOption('#doc-into', 'new-custom'); await page.click('[data-doc-go="attach"]'); await page.waitForFunction(() => /Attached to/.test(document.querySelector('[data-doc-key="main"] [data-doc-msg]').textContent));
    c = await draft(page); const nc2 = c.custom[c.custom.length - 1];
    ok(nc2.title === 'Packing guide' && c.files.some(f => f.sec === 'c-' + nc2.id), `attach-only custom section: ${nc2.title}`);
    // the custom sheet lists the file on its row; Remove asks, then deletes it from storage
    await page.click('[data-card="custom"]'); await page.waitForSelector('#sheet[open]');
    ok(!!(await page.$(`#sheet [data-doc-key="c-${nc2.id}"] .doc-files li`)), 'custom row lists its document');
    const fid = c.files.find(f => f.sec === 'c-' + nc2.id).id;
    await page.click(`#sheet [data-doc-del="${fid}"]`); await page.waitForSelector('#confirmdlg[open]'); await page.click('#confirmdlg button[value="ok"]'); await page.waitForTimeout(400);
    c = await draft(page); ok(!c.files.some(f => f.id === fid), 'Remove takes it off the page');
    ok(await page.evaluate((u) => window.__rm.length === 1 && window.__rm[0].startsWith(u + '/'), USER.id), 'and deletes the stored file');
    await page.click('#sheet [data-b="close"]'); await page.waitForTimeout(200);
    // less noise: duplicates merged; a day-by-day trip plan → one itinerary item per day (timed bookings stay separate)
    const tidy = await page.evaluate((c) => window.__ep.docItems(c, { schedule: [
      { date: '2027-04-02', time: '', title: 'Senso-ji temple', note: '', kind: 'activity' }, { date: '2027-04-02', time: '', title: 'Senso-ji Temple.', note: 'Go early', kind: 'activity' },
      { date: '2027-04-02', time: '', title: 'Nakamise street snacks', note: '', kind: 'activity' }, { date: '2027-04-02', time: '', title: 'Ueno park', note: '', kind: 'activity' },
      { date: '2027-04-02', time: '19:00', title: 'Dinner at Kanda Matsuya', note: '', kind: 'reservation' }, { date: '2027-04-03', time: '', title: 'Ghibli Museum', note: '', kind: 'activity' },
      { date: '2027-04-03', time: '', title: 'Ghibli Museum', note: '', kind: 'activity' } ], faqs: [{ question: 'Money', answer: 'Cash' }, { question: 'money', answer: 'Cash' }] }, 'auto').map(x => [x.sec, x.title, x.time, x.text].join('/')), await draft(page));
    ok(JSON.stringify(tidy) === JSON.stringify(['schedule/Senso-ji temple · Nakamise street snacks · Ueno park//Senso-ji temple: Go early', 'schedule/Dinner at Kanda Matsuya/19:00/', 'schedule/Ghibli Museum//', 'notes/Money//Cash']), `tidy items ${JSON.stringify(tidy)}`);
    ok(errors.length === 0, `no page errors ${errors.join(' ')}`);
    cfgAfter = await draft(page);
    await ctx.close();
  }

  // ---------- guest page: documents in their sections, View / Download, round trip, 390 + 320 ----------
  {
    const { ctx, page } = await mk(390); await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    const rt = await page.evaluate((c) => JSON.stringify(window.__ep.unpackEvent(window.__ep.packEvent(c)).files) === JSON.stringify(c.files), cfgAfter);
    ok(rt, 'share link keeps the documents');
    const evil = await page.evaluate((c) => { c = JSON.parse(JSON.stringify(c)); c.files.push({ id: 'zz', sec: 'route', name: 'bad', url: 'javascript:alert(1)', type: 'pdf' }); return window.__ep.unpackEvent(window.__ep.packEvent(c)).files.some(f => f.id === 'zz'); }, cfgAfter);
    ok(!evil, 'a non-http document link is dropped');
    const packed = await page.evaluate((c) => window.__ep.packEvent(c), cfgAfter);
    await ctx.close();
    for (const w of [390, 320]) {
      const { ctx, page } = await mk(w);
      await page.goto(BASE + '#e=' + packed); await page.waitForSelector('#sec-schedule .route-docs'); await page.waitForTimeout(500);
      const d = await page.$eval('#sec-schedule .route-docs li', li => ({ name: li.querySelector('b').textContent, view: li.querySelectorAll('.doc-a a')[0].textContent, vh: li.querySelectorAll('.doc-a a')[0].href, dl: li.querySelectorAll('.doc-a a')[1].textContent, dh: li.querySelectorAll('.doc-a a')[1].href, tgt: li.querySelector('.doc-main').target }));
      ok(d.name === 'Japan itinerary.pdf' && d.view === 'View' && d.dl === 'Download' && d.tgt === '_blank' && /\?download=Japan%20itinerary\.pdf$/.test(d.dh) && d.vh.startsWith(SBURL), `@${w} route document ${JSON.stringify(d)}`);
      const cs = cfgAfter.custom.find(x => x.title === 'Emergency contacts' && cfgAfter.files.some(f => f.sec === 'c-' + x.id));
      ok(!!(await page.$(`#sec-c-${cs.id} .docs li`)), `@${w} custom section shows its document`);
      const of = await overflow(page); ok(of.length === 0, `@${w} guest page: no overflow ${of.join(' ')}`);
      if (SHOTS) { await page.locator('#sec-schedule').scrollIntoViewIfNeeded(); await page.locator('#sec-schedule').screenshot({ path: `${SHOTS}/doc-guest-route-${w}.png` }); }
      if (w === 320) { // guest language: labels translated, file name as written
        await page.goto(BASE + '?lang=es#e=' + packed); await page.waitForSelector('#sec-schedule .route-docs'); await page.waitForTimeout(300);
        const es = await page.$$eval('#sec-schedule .route-docs .doc-a a', as => as.map(a => a.textContent).join('|'));
        ok(es === 'Ver|Descargar', `es labels ${es}`);
      }
      await ctx.close();
    }
  }
  // the builder sheets at 320
  {
    const { ctx, page } = await mk(320, { user: USER });
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await page.evaluate((c) => { localStorage.clear(); localStorage.setItem('ep:signedIn', 'true'); localStorage.setItem('ep:draft', JSON.stringify(c)); }, cfgAfter);
    await page.goto(BASE + '#new'); await page.waitForSelector('[data-card="route"]');
    await page.setInputFiles('[data-doc-pick]', pdf()); await page.waitForSelector('#doc-into');
    ok((await overflow(page)).length === 0, 'main pick @320: no overflow');
    await page.click('[data-doc-go="fill"]'); await page.waitForSelector('[data-doc-key="main"] [data-sheet="doc-review"]');
    ok((await overflow(page)).length === 0, 'main review @320: no overflow');
    if (SHOTS) await page.locator('[data-doc-key="main"]').screenshot({ path: `${SHOTS}/doc-main-review-320.png` });
    await page.click('[data-doc-key="main"] [data-doc-cancel]');
    await page.click('[data-card="route"]'); await page.waitForSelector('#sheet[open] .doc-files li');
    ok((await overflow(page)).length === 0, 'route sheet with a document @320: no overflow');
    if (SHOTS) await page.locator('#sheet').screenshot({ path: `${SHOTS}/doc-route-sheet-320.png` });
    await ctx.close();
  }

  await browser.close();
  console.log(fails.length ? `\n${fails.length} failing` : '\nall ok');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
