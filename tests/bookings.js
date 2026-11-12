// "Add a booking" sheet: three choices, quick reader → review card → save, multi-card review, sign-in prompt for the
// AI options when signed out, flight-number shortcut, a saved flight's arrival setting "Flying into", photo shrinking.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/bookings.js
//   SHOTS=/tmp/ep-shots node tests/bookings.js
//
// Needs Playwright. Exit code 1 on any failure.
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  // the AI function counts as deployed; the guest is signed out
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ep:aiReady', JSON.stringify({ t: Date.now(), ok: true })); });
  await page.goto(BASE + '?demo=wedding#t=travel'); await page.waitForSelector('[data-addbooking]');
  const kayak = () => page.$$eval('[data-slot="rental"] a[href*="kayak.com/cars"]', as => as.map(a => a.href.match(/cars\/(\w+)\//)[1]).join());

  await page.click('[data-addbooking]'); await page.waitForTimeout(300);
  const ch = await page.$$eval('[data-sheet="choose"] .add-choice', bs => bs.filter(b => !b.hidden).map(b => b.textContent.trim()));
  ok(await page.evaluate(() => !document.querySelector('[data-panel="mytrip"]').hidden), 'Travel → Add a booking opens My trip');
  ok(ch.join('|') === 'Paste confirmation text or link|Upload a screenshot or PDF|Enter it yourself', `three choices in order: ${ch.join(' | ')}`);
  if (SHOTS) await page.locator('#sec-itinerary').screenshot({ path: `${SHOTS}/add-booking-sheet.png` });

  // paste → quick reader (no sign-in) → one card to check → save
  await page.click('[data-itin-mode="paste"]');
  await page.fill('#it-paste', 'Delta Air Lines\nFlight DL 1873\nThu, Mar 11, 2027 8:05 AM\nConfirmation number: HX7Q2L');
  ok(await page.isVisible('[data-itin-ai]'), 'Read with AI offered when the function is deployed');
  await page.click('[data-itin-ai]'); await page.waitForTimeout(200);
  ok(await page.isVisible('.bk-signin') && /Sign in to read it automatically/.test(await page.textContent('.bk-signin')), 'signed out + Read with AI → inline sign-in prompt');
  if (SHOTS) await page.locator('#sec-itinerary').screenshot({ path: `${SHOTS}/paste-signin.png` });
  await page.click('[data-itin-read]'); await page.waitForTimeout(200);
  const rv = await page.evaluate(() => [...document.querySelectorAll('[data-sheet="review"] [data-rv="0"]')].reduce((o, el) => (o[el.dataset.rk] = el.value, o), {}));
  ok(rv.kind === 'flight' && /DL ?1873/.test(rv.flight) && /^2027-03-11/.test(rv.start), `quick reader → review card ${JSON.stringify(rv)}`);
  await page.fill('#rv0-to', 'CUN'); await page.click('[data-rv-save]'); await page.waitForTimeout(300);
  let saved = await page.$$eval('#sec-itinerary .bookings li', ls => ls.map(l => l.textContent));
  ok(saved.length === 1 && /HX7Q2L/.test(saved[0]) && /Delta/.test(saved[0]), `saved: ${saved}`);
  ok(await page.$eval('[data-slot="ap-mine"] select', s => s.value) === 'CUN', 'saved flight arriving CUN → Flying into CUN');
  ok(await kayak() === 'CUN', 'rentals follow the saved flight');

  // upload while signed out → sign-in prompt right away
  await page.click('[data-itin-add]'); await page.click('[data-itin-mode="file"]'); await page.waitForTimeout(200);
  ok(await page.isVisible('[data-sheet="file"] .bk-signin'), 'signed out + Upload → inline sign-in prompt');
  await page.click('[data-sheet="file"] [data-itin-cancel]');

  // what an AI read returns (items from a real 'file' run on a sample confirmation) lands as several cards
  const items = [{ type: 'flight', name: 'DL 1873 JFK → CZM', provider: 'Delta Air Lines', start: '2027-03-11T08:05', end: '2027-03-11T11:52', address: '', confirmation: 'HX7Q2L', flight_number: 'DL 1873', from: 'JFK', to: 'CZM', note: '', link: '' },
    { type: 'flight', name: 'DL 594 CZM → JFK', provider: 'Delta Air Lines', start: '2027-03-15T13:10', end: '2027-03-15T17:48', address: '', confirmation: 'HX7Q2L', flight_number: 'DL 594', from: 'CZM', to: 'JFK', note: '', link: '' },
    { type: 'car', name: 'Hertz at CZM', provider: 'Hertz', start: '2027-03-11T12:30', end: '2027-03-15T10:30', address: 'Cozumel International Airport', confirmation: 'K48812337', flight_number: '', from: '', to: '', note: 'Compact SUV', link: '' }];
  await page.click('[data-itin-add]');
  await page.evaluate((xs) => document.querySelector('.ev')._itinReview(window.__ep.aiItemsToBookings(xs)), items); await page.waitForTimeout(200);
  ok((await page.$$('.rv-card')).length === 3, 'three cards to review');
  if (SHOTS) await page.locator('#sec-itinerary').screenshot({ path: `${SHOTS}/review-cards.png` });
  await page.click('[data-rv-del="1"]'); await page.waitForTimeout(100);
  ok((await page.$$('.rv-card')).length === 2, 'remove one card before saving');
  await page.click('[data-rv-save]'); await page.waitForTimeout(300);
  saved = await page.$$eval('#sec-itinerary .bookings li', ls => ls.length);
  ok(saved === 3, `3 bookings saved (${saved})`);
  ok(await kayak() === 'CZM', 'flight arriving CZM → Flying into CZM');

  // enter it yourself: airline + flight number names the card
  await page.click('[data-itin-add]'); await page.click('[data-itin-mode="manual"]');
  await page.selectOption('#it-kind', 'flight'); await page.fill('#it-flight', 'ua 837');
  ok(await page.inputValue('#it-name') === 'United UA 837', `flight number fills the name (${await page.inputValue('#it-name')})`);
  await page.fill('#it-start', '2027-03-10T09:00'); await page.fill('#it-to', 'tqo'); await page.click('[data-itin-save]'); await page.waitForTimeout(300);
  ok(await kayak() === 'TQO', 'manual flight to TQO → Flying into TQO');
  if (SHOTS) await page.locator('#sec-itinerary').screenshot({ path: `${SHOTS}/bookings-saved.png` });

  // edit + delete inline
  await page.click('[data-itin-edit="0"]'); await page.fill('#it-confNo', 'ZZ9'); await page.click('[data-itin-save]'); await page.waitForTimeout(200);
  ok(/ZZ9/.test(await page.textContent('#sec-itinerary .bookings li')), 'edit saves');
  await page.click('[data-itin-edit="0"]'); await page.click('[data-itin-del="0"]'); await page.waitForTimeout(200);
  ok((await page.$$('#sec-itinerary .bookings li')).length === 3, 'delete removes one');

  // photos are shrunk to ≤1800px JPEG before upload
  const r = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 3000; c.height = 1200; c.getContext('2d').fillRect(0, 0, 10, 10);
    const b = await new Promise(res => c.toBlob(res, 'image/png')); const f = new File([b], 'shot.png', { type: 'image/png' }); const o = await window.__ep.bookingFile(f);
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + o.data; await img.decode(); return { mt: o.media_type, w: img.naturalWidth, h: img.naturalHeight }; });
  ok(r.mt === 'image/jpeg' && r.w === 1800 && r.h === 720, `photo resized ${JSON.stringify(r)}`);

  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
