// My trip bookings: "Booked through" (Airline/hotel direct, Expedia, Booking.com, Hotels.com, Airbnb, Agoda, Kayak,
// Priceline, Trip.com, Google, Chase Travel, Amex Travel, Costco Travel, Travel agent, Other → free text) next to the
// confirmation number; the card reads "via Booking.com · Conf. ABC123" and links Manage booking to that site's trips
// page only for checked links; pasted confirmations and AI-read ones fill it when the text says where. 390 + 320.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/booked-via.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).length; });
const CFG = { v: 2, type: 'Trip', title: 'Japan in spring', start: '2027-04-01', end: '2027-04-10', venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  tools: { nearby: false, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
(async () => {
  const browser = await chromium.launch();
  for (const w of [390, 320]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route(/open-meteo|overpass|nominatim|googleapis|tile\.openstreetmap|timeapi|photon|maps\.mail\.ru|functions\/v1/, r => r.abort());
    await page.goto(BASE); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '#e=' + await page.evaluate((c) => window.__ep.packEvent(c), CFG) + '&t=mytrip'); await page.waitForSelector('[data-itin-add]');
    const add = async (o) => {
      await page.click('[data-itin-add]'); await page.click('[data-itin-mode="manual"]'); await page.waitForSelector('#it-via');
      await page.selectOption('#it-kind', o.kind); await page.fill('#it-name', o.name); await page.fill('#it-confNo', o.conf || '');
      await page.selectOption('#it-via', o.via); if (o.other) { await page.waitForSelector('#it-viaOther:visible'); await page.fill('#it-viaOther', o.other); }
      await page.click('[data-itin-save]'); await page.waitForTimeout(200);
    };
    const opts = await page.evaluate(() => { document.querySelector('[data-itin-add]').click(); document.querySelector('[data-itin-mode="manual"]').click(); const o = [...document.querySelectorAll('#it-via option')].map(x => x.textContent); document.querySelector('[data-itin-cancel]').click(); return o; });
    ok(opts.join('|') === 'Choose|Airline / hotel direct|Expedia|Booking.com|Hotels.com|Airbnb|Agoda|Kayak|Priceline|Trip.com|Google|Chase Travel|Amex Travel|Costco Travel|Travel agent|Other', `@${w} sources: ${opts.join('|')}`);
    await add({ kind: 'hotel', name: 'Park Hotel Tokyo', conf: 'ABC123', via: 'booking' });
    await add({ kind: 'flight', name: 'JAL 61', conf: 'XY7Q2', via: 'expedia' });
    await add({ kind: 'car', name: 'Toyota Rent a Car', conf: '', via: 'other', other: 'Klook' });
    const cards = await page.$$eval('.bookings li', ls => ls.map(l => ({ name: l.querySelector('b').textContent, via: (l.querySelector('.bk-via') || {}).textContent || '', manage: [...l.querySelectorAll('a')].filter(a => /Manage booking/.test(a.textContent)).map(a => a.textContent + ' ' + a.href) })));
    const c = (n) => cards.find(x => x.name === n) || {};
    ok(c('Park Hotel Tokyo').via === 'via Booking.com · Conf. ABC123' && c('Park Hotel Tokyo').manage.join() === 'Manage booking · Booking.com https://secure.booking.com/mytrips.html', `@${w} hotel card ${JSON.stringify(c('Park Hotel Tokyo'))}`);
    ok(c('JAL 61').via === 'via Expedia · Conf. XY7Q2' && !c('JAL 61').manage.some(x => /expedia/i.test(x)), `@${w} Expedia: shown, no unchecked link ${JSON.stringify(c('JAL 61'))}`);
    ok(c('Toyota Rent a Car').via === 'via Klook', `@${w} Other → free text ${JSON.stringify(c('Toyota Rent a Car'))}`);
    ok((await overflow(page)) === 0, `@${w} no overflow`);
    if (SHOTS && w === 390) await page.locator('#sec-itinerary').screenshot({ path: `${SHOTS}/booked-via-390.png` });
    // pasted text and AI answers
    const p1 = await page.evaluate(() => window.__ep.parseReservation('Your Expedia itinerary # 7351234567890\nHotel Granvia Kyoto\nCheck-in: Apr 4, 2027', '2027-04-01').via);
    ok(p1 === 'expedia', `@${w} pasted Expedia confirmation → Expedia (${p1})`);
    const p2 = await page.evaluate(() => window.__ep.parseReservation('Thank you for staying with us. Paid with American Express ending 1001. Hotel Granvia Kyoto', '2027-04-01').via || '');
    ok(p2 === '', `@${w} a card brand alone isn't a booking site (${p2})`);
    const ai = await page.evaluate(() => window.__ep.aiItemsToBookings([{ type: 'hotel', name: 'Cross Hotel Osaka', start: '2027-04-08', booked_through: 'Hotels.com' }, { type: 'flight', name: 'JL 60', start: '2027-04-10', booked_through: 'direct' }, { type: 'tour', name: 'Tea ceremony', start: '2027-04-06', booked_through: 'Klook' }, { type: 'car', name: 'Hertz', start: '2027-04-02', booked_through: '' }]).map(x => [x.via || '', x.viaOther || '']));
    ok(JSON.stringify(ai) === JSON.stringify([['hotels', ''], ['direct', ''], ['other', 'Klook'], ['', '']]), `@${w} AI-read bookings ${JSON.stringify(ai)}`);
    ok(errors.length === 0, `@${w} no page errors ${errors.join(' ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
