// Detail sheets + a cleaner, more visual page: tap a hotel in the Itinerary → its sheet (room type, confirmation,
// check-in/out, nights, address, small map, Open in Google Maps / Directions — google.com/maps only, photos with an
// Add tile that takes the camera roll); the organizer's "Check in: X" opens the guest's own booking for X; a day opens
// every item on it (tap one → its sheet → Back); a plan place's sheet changes its day / category / booked and removes
// it with Undo; the sheet is in the address bar (?d=) so Back closes it and the link reopens it. The trip Itinerary
// opens on 3 days with "Show all n days"; long About text and notes show "Read more". Saved spots: one folding group per
// category with counts and compact rows. My pages: View + Edit. No overflow at 390 / 320, no page errors.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/detail-sheets.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).length; });
const P = (name, lat, lon, from, to) => ({ name, address: name + ', Japan', lat, lon, city: name, country: 'Japan', cc: 'jp', from, to });
const LONG = 'Cherry blossom season. '.repeat(30).trim();
const CFG = { v: 2, type: 'Trip', title: 'Sheets trip', start: '2027-04-01', end: '2027-04-08', tz: 'Asia/Tokyo', description: LONG,
  venue: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' },
  stops: [P('Tokyo', 35.6764, 139.65, '2027-04-01', '2027-04-05'), P('Kyoto', 35.0116, 135.7681, '2027-04-05', '2027-04-08')],
  schedule: [{ date: '2027-04-01', time: '15:00', title: 'Check in: Hotel Gracery Shinjuku', note: '' }, { date: '2027-04-02', time: '09:00', title: 'Shinjuku Gyoen', note: 'Bring a picnic. ' + 'Lots of space. '.repeat(4) },
    { date: '2027-04-03', time: '10:00', title: 'Asakusa', note: '' }, { date: '2027-04-04', time: '10:00', title: 'teamLab', note: '' }, { date: '2027-04-05', time: '15:00', title: 'Check in: Hotel Granvia Kyoto', note: '' },
    { date: '2027-04-06', time: '07:00', title: 'Fushimi Inari', note: '' }, { date: '2027-04-07', time: '08:00', title: 'Arashiyama', note: '' }],
  notes: [{ label: 'Money', text: 'Cash is handy. '.repeat(20).trim(), url: '' }],
  tools: { nearby: true, weather: false, travel: false, stay: false, tours: false, mytrip: true, packing: false, shopping: false } };
const keyOf = (c) => Math.abs([...(c.title || '') + (c.start || '') + (c.venue ? c.venue.name : '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36);
const K = keyOf(CFG);
const ITIN = [{ id: 'h1', kind: 'hotel', name: 'Hotel Gracery Shinjuku', address: '1-19-1 Kabukicho, Shinjuku City, Tokyo', lat: 35.6956, lon: 139.7016, start: '2027-04-01T15:00', end: '2027-04-05T11:00', confNo: 'GR123', via: 'booking',
  det: { room: 'Superior Double Room', beds: '1 queen', guests: '2', amen: ['breakfast', 'wifi'] } }];
const PLAN = [{ id: 'p1', src: 'osm', ref: 'n1', name: 'Ichiran Shinjuku', lat: 35.69, lon: 139.70, addr: 'Shinjuku, Tokyo', type: 'food', day: '', time: '', note: '', booked: false, conf: '', rating: 4.3, count: 100, hours: '' },
  { id: 'p2', src: 'osm', ref: 'n2', name: 'Blue Bottle Coffee', lat: 35.68, lon: 139.80, addr: 'Koto City, Tokyo', type: 'food', cat: 'cafes', day: '2027-04-02', time: '08:00', note: '', booked: false, conf: '', rating: 4.1, count: 50, hours: '' },
  { id: 'p3', src: 'osm', ref: 'n3', name: 'Nishiki Market', lat: 35.005, lon: 135.765, addr: 'Kyoto', type: 'food', day: '', time: '', note: '', booked: false, conf: '', rating: 0, count: 0, hours: '' },
  { id: 'p4', src: 'osm', ref: 'n4', name: 'Kiyomizu-dera', lat: 34.995, lon: 135.785, addr: 'Kyoto', type: 'activity', cat: 'sights', day: '', time: '', note: '', booked: false, conf: '', rating: 4.6, count: 10, hours: '' }];

async function setup(browser, w) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.route(/googleapis|gstatic|overpass|maps\.mail\.ru|open-meteo|tile\.openstreetmap|timeapi|nominatim|photon|functions\/v1/, r => r.abort());
  await page.goto(BASE); await page.waitForFunction(() => window.__ep);
  return { ctx, page };
}
const open = async (page, tab = 'event', extra = '') => {
  await page.evaluate(([k, it, pl]) => { localStorage.clear(); localStorage.setItem('ep:itin:' + k, JSON.stringify(it)); localStorage.setItem('ep:plan:' + k, JSON.stringify(pl)); }, [K, ITIN, PLAN]);
  const packed = await page.evaluate((c) => window.__ep.packEvent(c), CFG);
  await page.goto(BASE + extra + '#e=' + packed + (tab === 'event' ? '' : '&t=' + tab)); await page.waitForSelector('.ev'); await page.waitForTimeout(300);
};
const sheet = (page) => page.evaluate(() => { const d = document.querySelector('dialog.ds-sheet'); return d && d.open ? { ref: d.dataset.ref, title: d.querySelector('.ds-t').textContent, text: d.textContent.replace(/\s+/g, ' '), links: [...d.querySelectorAll('a[href]')].map(a => a.href), back: !!d.querySelector('[data-ds-back]') } : null; });

(async () => {
  const browser = await chromium.launch();
  try {
    for (const w of [390, 320, 1280]) {
      const { ctx, page } = await setup(browser, w);
      await open(page);
      // ---- Itinerary: every day with plans is one row; only the first is open; tap a day to open it ----
      const openN = () => page.$$eval('#sec-schedule .day', ds => ds.filter(d => d.querySelector('.tl').checkVisibility()).length);
      const nDays = await page.$$eval('#sec-schedule .day', ds => ds.length);
      ok(nDays >= 3 && await openN() === 1 && !(await page.$('#sec-schedule .sched-all')), `@${w} Itinerary: ${nDays} day rows, one open, no Show all`);
      await page.click('#sec-schedule [data-day-tog="2027-04-02"]'); ok(await openN() === 2, `@${w} tapping a day opens it`);
      await page.click('#sec-schedule [data-day-tog="2027-04-02"]'); ok(await openN() === 1, `@${w} tapping it again closes it`);
      // ---- tap the organizer's hotel → the guest's booking for it ----
      await page.click('#sec-schedule [data-ds="ev:0"]'); await page.waitForSelector('dialog.ds-sheet[open]');
      let s = await sheet(page);
      ok(s && s.title === 'Hotel Gracery Shinjuku' && /Room\s*Superior Double Room/.test(s.text) && /Confirmation\s*GR123/.test(s.text) && /Check-in\s*Thu, Apr 1 · 3:00 PM/.test(s.text) && /Check-out\s*Mon, Apr 5 · 11:00 AM/.test(s.text) && /Nights\s*4/.test(s.text) && /Booked through\s*Booking\.com/.test(s.text) && /Kabukicho/.test(s.text) && /Breakfast/.test(s.text),
        `@${w} hotel sheet: room type, confirmation, check-in/out, nights, address, amenities ${s && s.text.slice(0, 160)}`);
      ok(s.links.some(u => /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Hotel%20Gracery/.test(u)) && s.links.some(u => u.startsWith('https://www.google.com/maps/dir/')) && !s.links.some(u => /maps\.apple|apple\.com\/maps/.test(u)), `@${w} Open in Google Maps + Directions (google.com/maps)`);
      ok(await page.$eval('dialog.ds-sheet [data-ds-map]', m => !!m.dataset.lat && !m.classList.contains('empty')), `@${w} small map at the hotel's point`);
      ok(await page.$eval('dialog.ds-sheet [data-ph-add="bk:h1"]', i => i.type === 'file' && /image/.test(i.accept)), `@${w} Add photo takes images from the device`);
      ok(new URL(page.url()).searchParams.get('d') === 'ev:0', `@${w} the sheet is in the address bar (${page.url().slice(0, 60)})`);
      ok(await overflow(page) === 0, `@${w} hotel sheet: no overflow`);
      if (SHOTS) await page.waitForTimeout(400); if (SHOTS && w === 390) await page.screenshot({ path: `${SHOTS}/sheet-hotel-390.png` });
      if (SHOTS && w === 1280) await page.screenshot({ path: `${SHOTS}/sheet-hotel-1280.png` });
      // photo from the device (signed out → a small copy on this device), shown in the sheet
      await page.setInputFiles('dialog.ds-sheet [data-ph-add="bk:h1"]', { name: 'room.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
      await page.waitForFunction((k) => ((JSON.parse(localStorage.getItem('ep:itin:' + k)) || [])[0].photos || []).length === 1, K, { timeout: 8000 }).catch(() => {});
      ok(await page.$$eval('dialog.ds-sheet .gal figure img', is => is.length) === 1 && await page.evaluate(() => document.querySelector('dialog.ds-sheet').open), `@${w} photo added from the device, sheet stays open`);
      // Back closes it
      await page.goBack(); await page.waitForTimeout(200);
      ok(!(await sheet(page)) && !new URL(page.url()).searchParams.get('d'), `@${w} Back closes the sheet`);
      // ---- a day → its items → one → Back → the day ----
      await open(page, 'event', '?d=day:2027-04-02'); s = await sheet(page);
      ok(s && /Day 2/.test(s.text) && /Shinjuku Gyoen/.test(s.text) && /Blue Bottle Coffee/.test(s.text) && /Staying at Hotel Gracery/.test(s.text), `@${w} day sheet lists the day's plans, saved spot and stay ${s && s.text.slice(0, 140)}`);
      await page.click('dialog.ds-sheet [data-ds="ev:1"]'); s = await sheet(page);
      ok(s && s.title === 'Shinjuku Gyoen' && /Bring a picnic/.test(s.text) && s.back && s.links.some(u => u.startsWith('https://www.google.com/maps/search/')), `@${w} item from the day: its sheet with Back + Find it on Google Maps`);
      await page.click('dialog.ds-sheet [data-ds-back]'); s = await sheet(page); ok(s && s.ref === 'day:2027-04-02' && !s.back, `@${w} Back → the day`);
      await page.click('dialog.ds-sheet [data-ds-close]'); await page.waitForTimeout(200); ok(!(await sheet(page)), `@${w} × closes`);
      // ---- deep link ----
      await open(page, 'event', '?d=bk:h1'); await page.waitForTimeout(300); s = await sheet(page);
      ok(s && s.title === 'Hotel Gracery Shinjuku', `@${w} ?d=bk:h1 opens the hotel's sheet`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(200); ok(!(await sheet(page)), `@${w} Escape closes`);
      // ---- Read more (info sections start folded to one line on the Event tab: open them) ----
      ok(await page.$eval('#sec-about', e => e.classList.contains('cx-col')) && (await page.textContent('#sec-about .cx-sumline')).length > 10, `@${w} About starts folded to its first sentence`);
      await page.click('#sec-about .sec-h'); await page.click('#sec-details .sec-h'); await page.waitForTimeout(150);
      const rm = await page.$$eval('[data-panel="event"] .rm-b', bs => bs.map(b => b.closest('section').id));
      ok(rm.includes('sec-about') && rm.includes('sec-details'), `@${w} long About + note show Read more (${rm})`);
      const h0 = await page.$eval('#sec-about .rm-box', e => e.clientHeight); await page.click('#sec-about .rm-b');
      ok(await page.$eval('#sec-about .rm-box', e => e.clientHeight) > h0 + 20 && await page.textContent('#sec-about .rm-b') === 'Show less', `@${w} Read more opens the whole text`);
      ok(await overflow(page) === 0, `@${w} event tab: no overflow`);
      // ---- My trip: saved spots by category ----
      await page.click('[data-tab-go="mytrip"]'); await page.waitForSelector('#sec-spots');
      const gs = await page.$$eval('#sec-spots .sp-g', ds => ds.map(d => `${d.querySelector('.sp-h').textContent}:${d.querySelector('.sp-n').textContent}`));
      ok(gs.join() === 'Restaurants:2,Cafés:1,Sights:1', `@${w} saved spots grouped by category with counts (stay hotel not repeated) ${gs}`);
      await page.click('#sec-spots .sp-g[data-spot-g="restaurants"] > summary');
      ok(!(await page.$eval('#sec-spots .sp-g[data-spot-g="restaurants"]', d => d.open)) && !(await page.isVisible('#sec-spots [data-ds="pl:p1"]')), `@${w} a group folds`);
      await page.click('#sec-spots .sp-g[data-spot-g="restaurants"] > summary');
      ok(await page.$$eval('#sec-spots .sp-map', as => as.every(a => a.href.startsWith('https://www.google.com/maps/search/'))), `@${w} each spot: Google Maps`);
      // a spot → its sheet → change the day; category; booked; remove + Undo
      await page.click('#sec-spots [data-ds="pl:p1"]'); s = await sheet(page);
      ok(s && s.title === 'Ichiran Shinjuku' && /Saved for later/.test(s.text) && /Your plan/.test(s.text), `@${w} spot sheet`);
      await page.selectOption('dialog.ds-sheet [data-dsp="day"]', '2027-04-03'); await page.waitForTimeout(150);
      const pl = () => page.evaluate((k) => JSON.parse(localStorage.getItem('ep:plan:' + k)), K);
      ok((await pl()).find(x => x.id === 'p1').day === '2027-04-03' && /Day 3/.test((await sheet(page)).text) && /Ichiran/.test(await page.textContent('#sec-plan')), `@${w} day changed from the sheet, list follows`);
      await page.selectOption('dialog.ds-sheet [data-dsp="cat"]', 'bars'); await page.waitForTimeout(150);
      ok((await pl()).find(x => x.id === 'p1').cat === 'bars' && (await page.$$eval('#sec-spots .sp-h', hs => hs.map(h => h.textContent))).includes('Bars'), `@${w} category changed → its own group`);
      await page.check('dialog.ds-sheet [data-dsp="booked"]'); await page.waitForTimeout(150);
      ok((await pl()).find(x => x.id === 'p1').booked === true && await page.isVisible('dialog.ds-sheet [data-dsp="conf"]'), `@${w} booked + confirmation field`);
      await page.click('dialog.ds-sheet [data-ds-del]'); await page.waitForTimeout(200);
      ok(!(await pl()).some(x => x.id === 'p1') && !(await sheet(page)), `@${w} removed from the sheet`);
      await page.click('#toast .toast-act'); await page.waitForTimeout(150); ok((await pl()).some(x => x.id === 'p1'), `@${w} Undo brings it back`);
      // Your itinerary + bookings: compact rows open the sheet
      await page.click('#sec-plan [data-ds="pl:p2"]'); s = await sheet(page); ok(s && s.title === 'Blue Bottle Coffee', `@${w} itinerary row → sheet`);
      await page.click('dialog.ds-sheet [data-ds-close]'); await page.waitForTimeout(150);
      ok(/Superior Double Room/.test(await page.textContent('#sec-itinerary .bookings')), `@${w} booking card shows the room type`);
      await page.click('#sec-itinerary .bookings [data-ds="bk:h1"]'); s = await sheet(page); ok(s && /Superior Double Room/.test(s.text), `@${w} booking card → sheet`);
      await page.click('dialog.ds-sheet [data-ds-edit]'); await page.waitForSelector('#it-name', { timeout: 3000 }).catch(() => {});
      ok(await page.isVisible('#it-name') && await page.inputValue('#it-name') === 'Hotel Gracery Shinjuku', `@${w} Edit booking from the sheet opens its form`);
      ok(await overflow(page) === 0, `@${w} My trip: no overflow`);
      if (SHOTS && w === 390) { await page.goto(page.url()); await page.waitForSelector('#sec-spots'); await page.locator('#sec-spots').screenshot({ path: `${SHOTS}/saved-spots-390.png` }); }
      ok(!page._err.length, `@${w} no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
    // ---- My pages: View + Edit ----
    const { ctx, page } = await setup(browser, 390);
    await page.evaluate((c) => { localStorage.clear(); localStorage.setItem('ep:pages', JSON.stringify([{ pid: 'pa', cfg: c, url: '', hosted: null, edited: 1 }, { pid: 'pb', cfg: { ...c, title: 'Shared one' }, url: '', hosted: { id: 'r1', slug: 'abc123', owner: 'u', pub: true }, edited: 2 }])); }, CFG);
    await page.goto(BASE + '#'); await page.waitForSelector('#my-pages');
    const mp = await page.$$eval('#my-pages .mp-list li', ls => ls.map(l => ({ t: l.querySelector('b').textContent, b: [...l.querySelectorAll('.mp-b a, .mp-b button')].map(x => x.textContent), view: l.querySelector('.mp-b a').href })));
    ok(mp.length === 2 && mp.every(x => x.b.slice(0, 2).join() === 'View,Edit' && x.b.includes('Delete') && !x.b.includes('Open')), `My pages: View + Edit (+ Duplicate, Delete) ${JSON.stringify(mp.map(x => x.b))}`);
    ok(mp.find(x => x.t === 'Shared one').view.endsWith('?e=abc123') && /#e=/.test(mp.find(x => x.t === 'Sheets trip').view), 'View: the short link, or the page itself when not shared');
    await page.click('#my-pages li:has-text("Sheets trip") .mp-b a:has-text("View")'); await page.waitForSelector('.ev');
    ok(!!(await page.$('.ev-title')) && !(await page.$('.b-head, .builder')), 'View opens the guest page');
    ok(!page._err.length, `no page errors ${page._err.join(' | ')}`);
    await ctx.close();
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
