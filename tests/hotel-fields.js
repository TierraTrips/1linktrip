// Hotel fields (Dylan 11/24: "an option for room category and cancellation date for hotels", "also a notes option",
// room category and bed separate, "drag and drop screenshots", "the address should autofill from Google Maps", "add the
// details right from the screenshot", "show boxes for each optional category").
//  Every hotel has Room category (suggestion chips), Bed (one-tap chips), Free cancellation until (date + optional time)
//  or Non-refundable, and Notes — in the guest's Add / Edit booking form, on each import review card (every field an
//  input, read values highlighted), in the builder's check-in rows, room block card and stay options, and in Make it mine.
//  The hotel sheet shows "Room · Deluxe", "Bed · King", "Free cancellation until · Fri, Apr 10 · 6:00 PM", Notes (long
//  ones fold). One-liners only get a badge: "Cancel by <d>" within 7 days, "Non-refundable" once it can't be cancelled.
//  Screenshots / PDFs dropped or pasted: into an open form they fill that form; otherwise the review cards. Name =
//  Google Places autocomplete (name, address, point); an imported hotel without an address gets Google's match.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/hotel-fields.js
//   SHOTS=/tmp/ep-shots node tests/hotel-fields.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.tagName + '.' + e.className).slice(0, 4); });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/hotelfields-${name}.png` }); };
const ymd = (d) => d.toISOString().slice(0, 10); const inDays = (n) => ymd(new Date(Date.now() + n * 864e5));

const CFG = { v: 2, type: 'Trip', title: 'Hotel fields trip', start: '2027-04-01', end: '2027-04-08', tz: 'Asia/Tokyo',
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  schedule: [{ date: '2027-04-01', time: '15:00', title: 'Check in: Park Hotel Tokyo', note: 'Group booking under Tanaka.\nAsk for a high floor.', kind: 'reservation', room: 'Deluxe', beds: 'Twin', cancelBy: '2027-03-25T18:00' }],
  tools: { nearby: false, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
const K = keyOf(CFG);
const AI_HOTEL = { type: 'hotel', name: 'Hotel Gracery Shinjuku', provider: 'Booking.com', start: '2027-04-01T15:00', end: '2027-04-04T11:00', address: '', confirmation: 'GR-77', flight_number: '', from: '', to: '', note: 'Late arrival after 10pm, breakfast included', link: '', booked_through: 'Booking.com',
  room_type: 'Deluxe', beds: 'King', guests: '2', amenities: ['breakfast'], cancel_by: '2027-03-30T18:00', non_refundable: false, price: '¥64,800', seat: '', cabin: '', baggage: '', car_class: '', meeting_point: '', duration: '', included: '', party_size: '' };
const AI_NR = { ...AI_HOTEL, name: 'Hotel Kanra Kyoto', start: '2027-04-04T15:00', end: '2027-04-08T11:00', confirmation: 'KY-1', room_type: 'Superior', beds: '2 Twins', cancel_by: '', non_refundable: true, note: '' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function fakeSupabase(user) {
  window.supabase = { createClient: () => ({ storage: { from: () => ({}) }, from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }), upsert: () => Promise.resolve({ error: null }), delete: () => ({ eq: () => ({ in: () => Promise.resolve({ error: null }) }) }) }),
    auth: { getSession: async () => ({ data: { session: user ? { user, access_token: 'a.b.c' } : null } }), getUser: async () => ({ data: { user } }), signInWithOtp: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
}
async function setup(browser, { w = 390, user = null, items = [AI_HOTEL] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e))); page._ai = [];
  await page.addInitScript(fakeSupabase, user);
  await page.route(/open-meteo|overpass|nominatim|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru/, r => r.abort());
  await page.route(/supabase\.co\/rest\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/functions/v1/ai-import', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ready: true, modes: ['url', 'text', 'edit', 'translate', 'file', 'doc'] }) });
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, body: 'ok' });
    const b = JSON.parse(r.request().postData() || '{}'); page._ai.push(b.mode || b.kind);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'confirmation', data: { items: page._items || items } }) });
  });
  // Google Places: autocomplete, place details, text search
  await page.route('https://places.googleapis.com/**', async (r) => { const u = r.request().url(); const b = JSON.parse(r.request().postData() || '{}');
    if (/places:autocomplete/.test(u)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ suggestions: /hyatt/i.test(b.input || '') ? [{ placePrediction: { placeId: 'hp-kyoto', types: ['lodging'], structuredFormat: { mainText: { text: 'Hyatt Place Kyoto' }, secondaryText: { text: 'Nakagyo Ward, Kyoto' } } } }] : [] }) });
    if (/places\/hp-kyoto/.test(u)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'hp-kyoto', displayName: { text: 'Hyatt Place Kyoto' }, formattedAddress: '602 Ishifudonocho, Nakagyo Ward, Kyoto', location: { latitude: 35.006, longitude: 135.764 }, types: ['lodging'] }) });
    if (/searchText/.test(u)) { const hit = /gracery/i.test(b.textQuery || ''); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ places: hit ? [{ id: 'gr-1', displayName: { text: 'Hotel Gracery Shinjuku' }, formattedAddress: '1-19-1 Kabukicho, Shinjuku City, Tokyo', location: { latitude: 35.695, longitude: 139.702 }, types: ['lodging'] }] : [] }) }); }
    return r.fulfill({ contentType: 'application/json', body: '{}' }); });
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  await page.evaluate((signed) => { localStorage.clear(); if (signed) localStorage.setItem('ep:signedIn', 'true'); localStorage.setItem('ep:aiModes', JSON.stringify({ t: Date.now(), m: ['url', 'text', 'edit', 'translate', 'file', 'doc'] })); localStorage.setItem('ep:aiReady', JSON.stringify({ t: Date.now(), ok: true })); }, !!user);
  return { ctx, page };
}
const open = async (page, seed, cfg = CFG) => {
  await page.evaluate(([k, s]) => { for (const [n, v] of Object.entries(s || {})) localStorage.setItem('ep:' + n + ':' + k, JSON.stringify(v)); }, [keyOf(cfg), seed]);
  await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), cfg) + '&t=mytrip'); await page.waitForSelector('#sec-itinerary');
};
const itin = (page, k = K) => page.evaluate((k) => JSON.parse(localStorage.getItem('ep:itin:' + k) || '[]'), k);
const sheetText = (page) => page.$eval('dialog.ds-sheet[open]', d => d.innerText.replace(/\s+/g, ' '));
const USER = { id: 'u0000000-0000-4000-8000-0000000000ab', email: 'guest@example.com' };

(async () => {
  const browser = require('./_open-settings')(await chromium.launch());
  try {
    // 1 — the badge rule
    { const { ctx, page } = await setup(browser);
      const r = await page.evaluate(() => { const B = (h, end, now) => { const b = window.__ep.hfBadge(h, end, now); return b ? b.text : ''; }; const now = '2027-04-01T12:00';
        return [B({ cancelBy: '2027-04-04' }, '2027-04-10', now), B({ cancelBy: '2027-04-20' }, '2027-04-25', now), B({ cancelBy: '2027-04-01T10:00' }, '2027-04-05', now), B({ cancelBy: '2027-04-01T18:00' }, '2027-04-05', now),
          B({ nonRef: true }, '2027-04-05', now), B({ nonRef: true }, '2027-03-30', now), B({}, '2027-04-05', now)]; });
      ok(r[0] === 'Cancel by Apr 4' && r[1] === '' && r[2] === 'Non-refundable' && r[3] === 'Cancel by Apr 1' && r[4] === 'Non-refundable' && r[5] === '' && r[6] === '', `badge: within 7 days / far off / passed (time) / today later / non-refundable / stay over / none ${JSON.stringify(r)}`);
      await ctx.close(); }

    // 2 — manual entry: every field a box; room + bed chips; cancellation date + time; notes; the sheet; reload
    for (const w of [390, 320]) {
      const { ctx, page } = await setup(browser, { w });
      await open(page);
      await page.click('#sec-itinerary [data-itin-add]'); await page.click('[data-itin-mode="manual"]');
      await page.selectOption('#it-kind', 'hotel'); await page.waitForSelector('.itin-form [data-hk="room"]');
      const boxes = await page.$$eval('.itin-form [data-it],.itin-form [data-det],.itin-form [data-hk]', es => es.map(e => e.dataset.it || e.dataset.det || e.dataset.hk));
      ok(['name', 'address', 'start', 'end', 'room', 'beds', 'cxd', 'cxt', 'nonRef', 'confNo', 'guests', 'price', 'via', 'link', 'note'].every(k => boxes.includes(k)) && !(await page.$('.itin-form .more-f')), `@${w} hotel form: every field is a box, nothing folded (${boxes})`);
      await page.fill('#it-name', 'Hotel Gracery Shinjuku'); await page.fill('#it-start', '2027-04-01T15:00'); await page.fill('#it-end', '2027-04-04T11:00');
      await page.click('.itin-form [data-hf-sug="Deluxe"]'); await page.click('.itin-form [data-hf-bed="King"]');
      ok(await page.inputValue('#it-hf-room') === 'Deluxe' && await page.inputValue('#it-hf-beds') === 'King', `@${w} chips fill Room category and Bed`);
      ok(await page.$eval('.itin-form [data-hk="cxt"]', i => i.disabled), `@${w} time waits for the date`);
      await page.fill('#it-hf-cxd', '2027-03-30'); ok(!(await page.$eval('.itin-form [data-hk="cxt"]', i => i.disabled)), `@${w} time opens once the date is set`);
      await page.fill('.itin-form [data-hk="cxt"]', '18:00');
      const note = 'Late check-in after 10pm.\nAsk for a high floor. ' + 'Breakfast is included for two guests every morning from 7. '.repeat(4);
      await page.fill('#it-note + .rt-ed', note); await page.fill('#it-confNo', 'GR-1');
      ok((await overflow(page)).length === 0, `@${w} form fits ${await overflow(page)}`);
      await shot(page, `form-${w}`);
      await page.click('[data-itin-save]'); await page.waitForTimeout(300);
      let x = (await itin(page))[0];
      ok(x && x.det.room === 'Deluxe' && x.det.beds === 'King' && x.det.cancelBy === '2027-03-30T18:00' && !x.det.nonRef && x.note.trim() === note.trim(), `@${w} stored in the booking ${JSON.stringify(x && x.det)}`);
      const card = (await page.textContent('#sec-itinerary .bookings li')).replace(/\s+/g, ' ');
      ok(/Deluxe/.test(card) && !/high floor/.test(card), `@${w} My trip card: room, no notes (${card.slice(0, 120)})`);
      await page.reload(); await page.waitForSelector('#sec-itinerary .bk-go');
      x = (await itin(page))[0]; ok(x && x.det.cancelBy === '2027-03-30T18:00' && /high floor/.test(x.note), `@${w} kept after reload`);
      await page.click('#sec-itinerary .bk-go'); await page.waitForSelector('dialog.ds-sheet[open]');
      let s = await sheetText(page);
      ok(/Room\s*Deluxe/i.test(s) && /Bed\s*King/i.test(s) && /Free cancellation until\s*Tue, Mar 30 · 6:00 PM/i.test(s), `@${w} sheet: Room · Deluxe, Bed · King, Free cancellation until Tue, Mar 30 · 6:00 PM (${s.slice(0, 260)})`);
      ok(await page.$eval('dialog.ds-sheet .ds-notes .ds-note', p => p.classList.contains('clamp')) && /More/.test(await page.textContent('dialog.ds-sheet [data-ds-nmore]')), `@${w} a long note folds with More`);
      await shot(page, `sheet-${w}`);
      await page.click('dialog.ds-sheet [data-ds-nmore]'); ok(!(await page.$eval('dialog.ds-sheet .ds-notes .ds-note', p => p.classList.contains('clamp'))), `@${w} More opens the note`);
      ok((await overflow(page)).length === 0, `@${w} sheet fits`);
      // Edit booking → Non-refundable
      await page.click('dialog.ds-sheet [data-ds-edit]'); await page.waitForSelector('.itin-form [data-hk="nonRef"]');
      ok(await page.inputValue('#it-hf-cxd') === '2027-03-30' && await page.inputValue('.itin-form [data-hk="cxt"]') === '18:00', `@${w} edit form shows the date and time`);
      await page.check('.itin-form [data-hk="nonRef"]'); ok(await page.$eval('#it-hf-cxd', i => i.disabled), `@${w} Non-refundable turns the date off`);
      await page.click('[data-itin-save]'); await page.waitForTimeout(300);
      x = (await itin(page))[0]; ok(x.det.nonRef === 1 && !x.det.cancelBy, `@${w} saved as non-refundable ${JSON.stringify(x.det)}`);
      ok(page._err.length === 0, `@${w} no page errors ${page._err}`); await ctx.close(); }

    // 3 — badges in one-liners (today-relative) + the .ics deadline event
    { const { ctx, page } = await setup(browser);
      const soon = { id: 'h1', kind: 'hotel', name: 'Soon Hotel', start: inDays(10), end: inDays(12), det: { room: 'Suite', cancelBy: inDays(3) } };
      const far = { id: 'h2', kind: 'hotel', name: 'Far Hotel', start: inDays(40), end: inDays(42), det: { cancelBy: inDays(30) + 'T12:00' } };
      const nr = { id: 'h3', kind: 'hotel', name: 'Strict Hotel', start: inDays(20), end: inDays(22), det: { nonRef: 1 } };
      await open(page, { itin: [soon, far, nr] });
      const rows = await page.$$eval('#sec-itinerary .bookings li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ')));
      const r = (n) => rows.find(x => x.includes(n)) || '';
      ok(/Cancel by/i.test(r('Soon Hotel')) && !/Cancel by|Non-refundable/i.test(r('Far Hotel')) && /Non-refundable/i.test(r('Strict Hotel')), `My trip: badge only when it matters ${JSON.stringify(rows)}`);
      const plan = await page.$$eval('#sec-plan .plan-row', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ')));
      ok(plan.some(x => /Soon Hotel/.test(x) && /Cancel by/i.test(x)), `Your itinerary row has the badge ${JSON.stringify(plan)}`);
      await shot(page, 'badges');
      const ics = await page.evaluate(() => new Promise(res => { const o = URL.createObjectURL; URL.createObjectURL = (b) => { b.text().then(res); URL.createObjectURL = o; return 'blob:x'; }; document.querySelector('[data-itin-ics]').click(); }));
      ok(/SUMMARY:Free cancellation ends · Far Hotel/.test(ics) && /DTEND:\d{8}T120000/.test(ics) && /TRIGGER:-P1D/.test(ics) && !/Strict Hotel\r\nDESCRIPTION/.test(ics.split('Free cancellation ends · Strict')[0] + '') && !/ends · Strict Hotel/.test(ics), '.ics: a cancellation-deadline event with a reminder (none for non-refundable)');
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 4 — upload → review cards: every field a box, read values highlighted, address found on Google, all editable, saved
    { const { ctx, page } = await setup(browser, { user: USER, items: [AI_HOTEL, AI_NR] });
      await open(page);
      await page.click('#sec-itinerary [data-itin-add]'); await page.waitForSelector('[data-itin-mode="file"]:not([hidden])');
      await page.click('[data-itin-mode="file"]'); await page.setInputFiles('[data-itin-file]', { name: 'shot.png', mimeType: 'image/png', buffer: PNG });
      await page.waitForSelector('.rv-card'); await page.waitForTimeout(500);
      const cards = await page.$$eval('.rv-card', cs => cs.map(c => { const o = {}; c.querySelectorAll('[data-it],[data-det],[data-hk]').forEach(el => { const k = el.dataset.it || el.dataset.det || el.dataset.hk; o[k] = el.type === 'checkbox' ? el.checked : el.value; }); o.got = [...c.querySelectorAll('.got')].map(e => e.dataset.it || e.dataset.det || e.dataset.hk || e.dataset.detAmen); return o; }));
      const a = cards[0], b = cards[1];
      ok(a.room === 'Deluxe' && a.beds === 'King' && a.cxd === '2027-03-30' && a.cxt === '18:00' && a.nonRef === false && /Late arrival/.test(a.note) && a.guests === '2' && a.price === '¥64,800' && a.confNo === 'GR-77', `card 1: room, bed, cancellation + time, notes, guests, price, conf ${JSON.stringify(a)}`);
      ok(a.address === '1-19-1 Kabukicho, Shinjuku City, Tokyo', `card 1: address found on Google (${a.address})`);
      ok(['room', 'beds', 'cxd', 'note', 'confNo', 'address'].every(k => a.got.includes(k)) && !a.got.includes('link'), `card 1: read fields highlighted (${a.got})`);
      ok(b.nonRef === true && !b.cxd && b.beds === '2 Twins' && b.room === 'Superior' && b.address === '', `card 2: non-refundable, 2 Twins, no Google match → address left empty ${JSON.stringify(b)}`);
      ok((await overflow(page)).length === 0, `review cards fit ${await overflow(page)}`);
      await shot(page, 'review');
      // every field is editable and saved
      await page.fill('#rv0-name', 'Gracery Shinjuku'); await page.fill('#rv0-hf-room', 'Deluxe Suite'); await page.click('[data-rv-card="0"] [data-hf-bed="Queen"]');
      await page.fill('#rv0-dt-guests', '3'); await page.fill('#rv0-dt-price', '¥70,000'); await page.fill('#rv0-confNo', 'GR-78'); await page.fill('#rv0-link', 'https://example.com/b');
      await page.fill('#rv0-note + .rt-ed', 'Quiet room please'); await page.fill('#rv0-hf-cxd', '2027-03-29'); await page.fill('[data-rv-card="0"] [data-hk="cxt"]', '12:00');
      await page.click('[data-rv-card="0"] [data-det-amen="pool"]'); await page.uncheck('[data-rv-card="1"] [data-hk="nonRef"]'); await page.fill('#rv1-hf-cxd', '2027-04-01');
      ok(!(await page.$eval('#rv0-hf-room', i => i.classList.contains('got'))), 'an edited field loses its highlight');
      await page.click('[data-rv-save]'); await page.waitForTimeout(400);
      const xs = await itin(page); const g = xs.find(x => /Gracery/.test(x.name)), k = xs.find(x => /Kanra/.test(x.name));
      ok(g && g.name === 'Gracery Shinjuku' && g.det.room === 'Deluxe Suite' && g.det.beds === 'Queen' && g.det.guests === '3' && g.det.price === '¥70,000' && g.confNo === 'GR-78' && g.link === 'https://example.com/b' && g.note === 'Quiet room please' && g.det.cancelBy === '2027-03-29T12:00' && g.det.amen.includes('pool') && g.lat === 35.695, `edited card saved ${JSON.stringify(g)}`);
      ok(k && !k.det.nonRef && k.det.cancelBy === '2027-04-01', `card 2 saved with its new cancellation ${JSON.stringify(k && k.det)}`);
      ok(page._ai.includes('file'), 'read through ai-import file mode');
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 5 — a screenshot pasted into an OPEN form fills that form; dropped on the page with no form → review cards
    { const { ctx, page } = await setup(browser, { user: USER, items: [AI_HOTEL] });
      await open(page);
      await page.click('#sec-itinerary [data-itin-add]'); await page.click('[data-itin-mode="manual"]'); await page.selectOption('#it-kind', 'hotel');
      await page.fill('#it-note + .rt-ed', 'my own note');
      await page.evaluate((b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const dt = new DataTransfer(); dt.items.add(new File([u], 'Screenshot.png', { type: 'image/png' })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, PNG.toString('base64'));
      await page.waitForFunction(() => (document.querySelector('#it-name') || {}).value === 'Hotel Gracery Shinjuku', null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
      const f = await page.evaluate(() => ({ name: document.querySelector('#it-name').value, address: document.querySelector('#it-address').value, start: document.querySelector('#it-start').value, room: document.querySelector('#it-hf-room').value, beds: document.querySelector('#it-hf-beds').value, cxd: document.querySelector('#it-hf-cxd').value, conf: document.querySelector('#it-confNo').value, note: document.querySelector('#it-note').value, got: [...document.querySelectorAll('.itin-form .got')].map(e => e.dataset.it || e.dataset.det || e.dataset.hk), review: !!document.querySelector('.rv-card') }));
      ok(f.name === 'Hotel Gracery Shinjuku' && f.start === '2027-04-01T15:00' && f.room === 'Deluxe' && f.beds === 'King' && f.cxd === '2027-03-30' && f.conf === 'GR-77' && !f.review, `paste into the open form fills it, no review step ${JSON.stringify(f)}`);
      ok(f.address === '1-19-1 Kabukicho, Shinjuku City, Tokyo' && ['name', 'room', 'beds', 'confNo', 'address'].every(k => f.got.includes(k)), `address from Google; filled fields highlighted (${f.got})`);
      await shot(page, 'paste-form');
      await page.click('[data-itin-save]'); await page.waitForTimeout(300);
      ok((await itin(page)).length === 1 && (await itin(page))[0].det.room === 'Deluxe', 'one Save stores it');
      // drop with nothing open → review
      await page.evaluate((b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const dt = new DataTransfer(); dt.items.add(new File([u], 'conf.png', { type: 'image/png' })); const s = document.querySelector('#sec-itinerary');
        s.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); window.__hl = s.classList.contains('drop-on'); s.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, PNG.toString('base64'));
      await page.waitForSelector('.rv-card', { timeout: 5000 }).catch(() => {});
      ok(await page.evaluate(() => window.__hl) && !!(await page.$('.rv-card')) && !(await page.$eval('#sec-itinerary', s => s.classList.contains('drop-on'))), 'drop: highlight while dragging, then the review cards');
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 6 — signed out: a pasted screenshot asks to sign in (nothing read)
    { const { ctx, page } = await setup(browser);
      await open(page);
      await page.evaluate((b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const dt = new DataTransfer(); dt.items.add(new File([u], 's.png', { type: 'image/png' })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, PNG.toString('base64'));
      await page.waitForSelector('#sec-itinerary .bk-signin', { timeout: 3000 }).catch(() => {});
      ok(/Sign in to read it automatically/.test(await page.textContent('#sec-itinerary').catch(() => '')) && !page._ai.length, 'signed out: paste → inline sign-in, no read');
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 7 — Name = Google Places autocomplete: pick fills name, address and the point
    { const { ctx, page } = await setup(browser);
      await open(page);
      await page.click('#sec-itinerary [data-itin-add]'); await page.click('[data-itin-mode="manual"]'); await page.selectOption('#it-kind', 'hotel');
      await page.click('#it-name'); await page.type('#it-name', 'Hyatt Place Kyo', { delay: 20 }); await page.waitForSelector('.itin-form [data-ac-pick="hp-kyoto"]', { timeout: 4000 }).catch(() => {});
      await shot(page, 'autocomplete');
      await page.click('.itin-form [data-ac-pick="hp-kyoto"]').catch(() => {}); await page.waitForTimeout(400);
      ok(await page.inputValue('#it-name') === 'Hyatt Place Kyoto' && /Ishifudonocho/.test(await page.inputValue('#it-address')), `pick → name + address (${await page.inputValue('#it-address')})`);
      await page.fill('#it-start', '2027-04-04'); await page.click('[data-itin-save]'); await page.waitForTimeout(300);
      const x = (await itin(page))[0]; ok(x && x.lat === 35.006 && x.ref === 'hp-kyoto', `saved with its map point ${JSON.stringify(x)}`);
      ok(page._err.length === 0, `no page errors ${page._err}`); await ctx.close(); }

    // 8 — quick reader (signed out, pasted text): room category and bed apart, cancellation date + time
    { const { ctx, page } = await setup(browser);
      const r = await page.evaluate(() => window.__ep.parseReservation('Hotel Gracery Shinjuku\nCheck-in: Apr 1, 2027 3:00 PM\nCheck-out: Apr 4, 2027 11:00 AM\nRoom type: Deluxe Room, 1 King Bed\nFree cancellation until Mar 30, 2027 6:00 PM\nConfirmation number: GR12345', '2027-04-01'));
      ok(r.det && r.det.room === 'Deluxe Room' && r.det.beds === '1 King Bed' && r.det.cancelBy === '2027-03-30T18:00', `quick reader: room, bed, cancellation ${JSON.stringify(r.det)}`);
      const n = await page.evaluate(() => window.__ep.parseReservation('Hotel Kanra Kyoto\nCheck-in: Apr 4, 2027\nCheck-out: Apr 8, 2027\nRoom: Superior Twin\nThis rate is non-refundable.', '2027-04-01'));
      ok(n.det && n.det.nonRef === 1 && n.det.room === 'Superior Twin', `quick reader: non-refundable ${JSON.stringify(n.det)}`);
      await ctx.close(); }

    // 9 — the organizer's hotel: builder check-in row, room block, stay option → the guest sees them
    { const { ctx, page } = await setup(browser);
      await open(page);
      const s = await page.evaluate(() => { const cfg = window.__ep.normalize(JSON.parse(JSON.stringify(window.__CFG || {}))); return 1; }).catch(() => 0);
      await page.click('[data-tab-go="event"]').catch(() => {});
      await page.evaluate(() => { const ev = document.querySelector('.ev'); const b = ev.querySelector('[data-ds="ev:0"]'); if (b) b.click(); }); await page.waitForSelector('dialog.ds-sheet[open]', { timeout: 3000 }).catch(() => {});
      const t = await sheetText(page).catch(() => '');
      ok(/Room\s*Deluxe/i.test(t) && /Bed\s*Twin/i.test(t) && /Free cancellation until\s*Thu, Mar 25 · 6:00 PM/i.test(t) && /high floor/.test(t), `guest: organizer's hotel sheet shows room, bed, cancellation, notes (${t.slice(0, 240)})`);
      await shot(page, 'host-sheet');
      await ctx.close();
      // builder rows
      const { ctx: c2, page: p2 } = await setup(browser);
      await p2.goto(BASE + '#edit=' + await p2.evaluate((c) => window.__ep.packEvent(c), { ...CFG, schedule: [{ date: '2027-04-01', time: '15:00', title: 'Check in: Park Hotel Tokyo', note: '', kind: 'reservation' }] }));
      await p2.waitForSelector('[data-card="schedule"]'); await p2.click('[data-card="schedule"]'); await p2.waitForSelector('#sheet[open] .hf-fold');
      await p2.click('#sheet .hf-fold > summary'); await p2.click('#sheet [data-hf-sug="Executive"]'); await p2.click('#sheet [data-hf-bed="2 Queens"]'); await p2.fill('#sheet [data-hk="cxd"]', '2027-03-20');
      await p2.fill('#sheet textarea[data-s="0"][data-k="note"] + .rt-ed', 'Rooms held under Tanaka\nBreakfast included'); await p2.waitForTimeout(500);
      if (SHOTS) await p2.screenshot({ path: `${SHOTS}/hotelfields-builder-row.png` });
      let d = await p2.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).schedule[0]);
      ok(d.room === 'Executive' && d.beds === '2 Queens' && d.cancelBy === '2027-03-20' && /\nBreakfast/.test(d.note), `builder check-in row stores room, bed, cancellation, notes ${JSON.stringify(d)}`);
      await p2.click('#sheet [data-hk="nonRef"]'); await p2.waitForTimeout(300); d = await p2.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).schedule[0]);
      ok(d.nonRef === true && !d.cancelBy, 'builder: Non-refundable');
      await p2.evaluate(() => document.querySelector('#sheet').close());
      // stay option with a hotel gets the fields; the guest's Make it mine booking carries them
      await p2.click('[data-card="stays"]'); await p2.waitForSelector('#sheet [data-b="add-preset"]'); await p2.click('#sheet [data-b="add-preset"]');
      await p2.fill('#sheet [data-pr="0"][data-k="h"]', 'Park Hotel Tokyo'); await p2.evaluate(() => { const s = document.querySelector('#sheet'); s.close(); }); await p2.click('[data-card="stays"]'); await p2.waitForSelector('#sheet [data-hf-pr="0"]', { state: 'attached' });
      await p2.evaluate(() => document.querySelector('#sheet .hf-fold').open = true);
      await p2.fill('#sheet [data-hf-pr="0"] [data-hk="room"]', 'Deluxe'); await p2.fill('#sheet [data-hf-pr="0"] [data-hk="note"] + .rt-ed', 'Code TANAKA at the desk'); await p2.waitForTimeout(400);
      const pr = await p2.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).presets[0]);
      ok(pr.h && pr.h.name === 'Park Hotel Tokyo' && pr.h.room === 'Deluxe' && pr.h.note === 'Code TANAKA at the desk', `stay option hotel stores its fields ${JSON.stringify(pr)}`);
      const norm = await p2.evaluate((p) => window.__ep.normalize({ v: 2, type: 'Trip', title: 'x', start: '2027-04-01', presets: [p] }).presets[0], pr);
      ok(norm.h.room === 'Deluxe' && norm.h.note === 'Code TANAKA at the desk', 'normalize keeps a stay option\'s hotel fields');
      ok(p2._err.length === 0, `builder: no page errors ${p2._err}`); await c2.close();
      // room block (wedding)
      const { ctx: c3, page: p3 } = await setup(browser);
      const wed = { v: 2, type: 'Wedding', title: 'W', start: '2027-06-05T16:00', end: '2027-06-05T23:00', venue: { name: 'Hotel Esencia', address: 'Xpu-Ha', lat: 20.47, lon: -87.26, city: 'Xpu-Ha', country: 'Mexico', cc: 'mx' }, x: { Wedding: { blockHotel: 'Hotel Esencia', blockCode: 'SMITH' } }, tools: { stay: true } };
      await p3.goto(BASE + '#edit=' + await p3.evaluate((c) => window.__ep.packEvent(c), wed)); await p3.waitForSelector('[data-card="block"]'); await p3.click('[data-card="block"]'); await p3.waitForSelector('#sheet [data-hf-block]');
      await p3.click('#sheet [data-hf-sug="Deluxe"]'); await p3.click('#sheet [data-hf-bed="King"]'); await p3.fill('#sheet [data-hk="cxd"]', '2027-05-20'); await p3.fill('#sheet [data-hk="note"] + .rt-ed', 'Mention the Smith wedding'); await p3.waitForTimeout(400);
      if (SHOTS) await p3.screenshot({ path: `${SHOTS}/hotelfields-builder-block.png` });
      const x = await p3.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')).x.Wedding);
      ok(x.blockRoom === 'Deluxe' && x.blockBeds === 'King' && x.blockCancel === '2027-05-20' && x.blockNote === 'Mention the Smith wedding', `room block stores its fields ${JSON.stringify(x)}`);
      ok(p3._err.length === 0, `block: no page errors ${p3._err}`); await c3.close();
      // guest: one tap on a stay option → their hotel booking carries the organizer's room, bed, cancellation, notes
      const { ctx: c4, page: p4 } = await setup(browser);
      const g = { ...CFG, title: 'Mine trip', presets: [{ id: 'p1', a: '2027-04-01', l: '2027-04-05', h: { name: 'Park Hotel Tokyo', room: 'Deluxe', beds: 'Twin', cancelBy: '2027-03-25', note: 'Code TANAKA' } }] };
      await open(p4, {}, g); await p4.click('[data-tab-go="event"]').catch(() => {}); await p4.waitForSelector('[data-mine-pick="p1"]'); await p4.click('[data-mine-pick="p1"]'); await p4.waitForTimeout(300);
      const mb = (await itin(p4, keyOf(g))).find(x => x.grp);
      ok(mb && mb.det && mb.det.room === 'Deluxe' && mb.det.beds === 'Twin' && mb.det.cancelBy === '2027-03-25' && mb.note === 'Code TANAKA', `Make it mine: the picked stay's hotel booking has its fields ${JSON.stringify(mb)}`);
      await p4.click('[data-mine-edit]'); await p4.waitForSelector('[data-mine-hf]', { state: 'attached' });
      ok(await p4.$eval('[data-mine-hf] [data-hk="room"]', i => i.value) === 'Deluxe', 'Make it mine editor shows the hotel fields');
      ok(p4._err.length === 0, `mine: no page errors ${p4._err}`); await c4.close(); }
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
