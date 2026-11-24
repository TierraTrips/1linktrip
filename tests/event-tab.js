// The guest Event tab is an overview (Dylan 12324 + 12330): the schedule plus essential info, everything else on its own tab.
// Trips (?demo=japan): one vertical list of days, only days with plans; a small city heading ("Kyoto · Apr 5–8", tap →
// Nearby) where the city changes; no city tabs / category bar / Everything–Event only switch; hotels and transport are one
// line each ("Check in · Park Hotel Tokyo") that open their sheet — no inline cards. Days start closed except today's
// (during the trip), else the page's start day, else the first; a tap opens / closes a day in place. Info sections (About,
// Need to know, Weather, Access, the organizer's own) start folded to one summary line; the schedule and the RSVP form stay
// open. Wedding (?demo=wedding): hourly schedule open on the wedding day. Race (?demo=race): race-day schedule open,
// race info (start, finish, packet pickup) as Need to know's summary. 390 + 320, no overflow, no page errors.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/event-tab.js
//   SHOTS=/tmp/ep-shots node tests/event-tab.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('[data-panel="event"] *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.tagName + '.' + e.className).slice(0, 4); });
const days = (page) => page.$$eval('#sec-schedule .day', ds => ds.map(d => ({ d: d.dataset.day, t: (d.querySelector('.day-t') || {}).textContent, sum: (d.querySelector('.day-sum') || {}).textContent || '',
  open: d.querySelector('.tl').checkVisibility(), n: d.querySelectorAll('.tl > li').length, tog: !!d.querySelector('[data-day-tog]') })));
const folded = (page) => page.$$eval('.ev-panel[data-panel="event"] .ev-sec[data-sec]', ss => ss.map(s => ({ id: s.dataset.sec, col: s.classList.contains('cx-col'), sum: (s.querySelector(':scope > .cx-sumline') || {}).textContent || '' })));

async function mk(browser, w, time) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e)));
  await page.route(/googleapis\.com\/(?!css)|overpass|maps\.mail\.ru|tile\.openstreetmap|timeapi|nominatim|photon|functions\/v1|supabase/, r => r.abort());
  if (time) await page.clock.setFixedTime(new Date(time));
  return { ctx, page };
}
const go = async (page, demo) => { await page.goto(BASE + '?demo=' + demo); await page.waitForSelector('#sec-schedule .day'); await page.waitForTimeout(1500); };

(async () => {
  const browser = await chromium.launch();
  try {
    for (const w of [390, 320]) {
      // ---------- trip ----------
      let { ctx, page } = await mk(browser, w);
      await go(page, 'japan');
      ok(!(await page.$('#sec-schedule [data-ccb], #sec-schedule .ccb-wrap, #sec-schedule [data-sched], #sec-schedule .sched-all')), `@${w} trip: no city tabs, category bar, view switch or Show all`);
      const heads = await page.$$eval('#sec-schedule .city-h', hs => hs.map(h => [h.querySelector('b').textContent, h.querySelector('small').textContent, h.tagName]));
      ok(heads.map(h => h[0]).join() === 'Tokyo,Kyoto,Osaka,Tokyo' && heads.every(h => /^[A-Z][a-z]{2} \d+(–\d+)?$/.test(h[1]) && h[2] === 'BUTTON'), `@${w} trip: city headings with short ranges ${JSON.stringify(heads)}`);
      let D = await days(page);
      ok(D.length >= 5 && D.every(x => x.n > 0 && x.tog && x.sum.length > 0), `@${w} trip: ${D.length} day rows, each with plans and a one-line summary`);
      ok(new Set(D.map(x => x.d)).size === D.length && D.map(x => x.d).join() === D.map(x => x.d).sort().join(), `@${w} trip: one row per day, in date order`);
      ok(D.filter(x => x.open).map(x => x.d).join() === '2027-04-02', `@${w} trip: only the start day is open (${D.filter(x => x.open).map(x => x.d)})`);
      ok(D.every(x => /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d+$/.test(x.t)), `@${w} trip: day rows read "Fri, Apr 2" (${D[1].t})`);
      const ci = await page.$$eval('#sec-schedule .day[data-day="2027-04-02"] .tl > li', ls => ls.map(l => ({ b: l.querySelector('b').firstChild.textContent.trim(), ds: (l.querySelector('[data-ds]') || { dataset: {} }).dataset.ds, extra: l.querySelectorAll('.tl-tx > span, .map, .plist, img, details').length, bg: getComputedStyle(l).backgroundColor })));
      const hotel = ci.find(x => /Park Hotel/.test(x.b));
      ok(hotel && hotel.b === 'Check in · Park Hotel Tokyo' && /^(ev|bk):/.test(hotel.ds) && !hotel.extra && /rgba\(0, 0, 0, 0\)|transparent/.test(hotel.bg), `@${w} trip: the hotel is one plain line that opens its sheet ${JSON.stringify(hotel)}`);
      ok(await page.$$eval('#sec-schedule .tl > li', ls => ls.every(l => l.querySelectorAll('.tl-tx > span, .map, .plist, img, details, .mini').length === 0 && !!l.querySelector('[data-ds]'))), `@${w} trip: every row is one line with a sheet behind it`);
      // tap a day: opens in place; again: closes
      await page.click('#sec-schedule [data-day-tog="2027-04-05"]');
      D = await days(page); ok(D.find(x => x.d === '2027-04-05').open && D.filter(x => x.open).length === 2 && await page.getAttribute('#sec-schedule [data-day-tog="2027-04-05"]', 'aria-expanded') === 'true', `@${w} trip: tapping Apr 5 opens it`);
      await page.click('#sec-schedule [data-day-tog="2027-04-05"]'); D = await days(page); ok(!D.find(x => x.d === '2027-04-05').open, `@${w} trip: tapping again closes it`);
      // a transport line opens its sheet
      await page.click('#sec-schedule [data-day-tog="2027-04-05"]');
      const tr = await page.$('#sec-schedule .day[data-day="2027-04-05"] .tl-go'); const trT = await tr.evaluate(b => b.querySelector('b').firstChild.textContent.trim());
      await tr.click(); await page.waitForSelector('dialog.ds-sheet[open]');
      ok(/Kyoto|Shinkansen/.test(trT) && await page.$eval('dialog.ds-sheet .ds-t', e => e.textContent.length > 0), `@${w} trip: "${trT}" opens its sheet`);
      await page.click('dialog.ds-sheet [data-ds-close]'); await page.waitForTimeout(200);
      // info sections fold to one line; the itinerary stays open
      const F = await folded(page);
      ok(F.find(x => x.id === 'schedule') && !F.find(x => x.id === 'schedule').col, `@${w} trip: the Itinerary is open`);
      const info = F.filter(x => x.id !== 'schedule');
      ok(info.length >= 4 && info.every(x => x.col && x.sum.trim().length > 3), `@${w} trip: info sections folded with a summary ${JSON.stringify(info.map(x => x.id + ': ' + x.sum.slice(0, 30)))}`);
      ok(/Money/.test(F.find(x => x.id === 'details').sum) && !/\d{4}/.test(F.find(x => x.id === 'weather').sum || 'x') && /°/.test(F.find(x => x.id === 'weather').sum), `@${w} trip: Need to know → its labels, Weather → a temperature range`);
      await page.click('#sec-details .cx-sumline'); ok(!(await page.$eval('#sec-details', s => s.classList.contains('cx-col'))), `@${w} trip: tapping the summary opens the section`);
      ok((await overflow(page)).length === 0, `@${w} trip: no overflow ${await overflow(page)}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/eventtab-japan-${w}.png`, fullPage: true });
      // a city heading → Nearby on that city
      await page.click('#sec-schedule .city-h >> nth=1'); await page.waitForTimeout(300);
      ok(await page.$eval('.ev-panel[data-panel="nearby"]', p => !p.hidden), `@${w} trip: tapping Kyoto opens Nearby`);
      ok(!page._err.length, `@${w} trip: no page errors ${page._err.join(' | ')}`);
      await ctx.close();

      // during the trip: today's day is the open one
      ({ ctx, page } = await mk(browser, w, '2027-04-06T10:00:00'));
      await go(page, 'japan'); D = await days(page);
      ok(D.filter(x => x.open).map(x => x.d).join() === '2027-04-06', `@${w} during the trip: today (Apr 6) is open (${D.filter(x => x.open).map(x => x.d)})`);
      await ctx.close();

      // ---------- wedding ----------
      ({ ctx, page } = await mk(browser, w));
      await go(page, 'wedding'); D = await days(page);
      ok(D.length >= 3 && D.filter(x => x.open).map(x => x.d).join() === '2027-03-13' && D.every(x => x.n > 0), `@${w} wedding: the wedding day is open, other days one line (${D.map(x => x.d + (x.open ? '*' : '')).join()})`);
      const wd = await page.$$eval('#sec-schedule .day[data-day="2027-03-13"] .tl > li', ls => ls.map(l => [l.querySelector('time').textContent.trim(), l.querySelector('b').firstChild.textContent.trim()]));
      ok(wd.length >= 3 && wd.every(x => /\d:\d\d/.test(x[0])) && /Ceremony/.test(wd[0][1]), `@${w} wedding: an hourly schedule ${JSON.stringify(wd)}`);
      ok(await page.$$eval('#sec-schedule li.mine', ls => ls.length > 0 && ls.every(l => !l.querySelector('.tl-tx > span'))), `@${w} wedding: the guest's bookings are one line each`);
      let Fw = await folded(page);
      ok(/Dress code/.test((Fw.find(x => x.id === 'details') || {}).sum || '') && Fw.find(x => x.id === 'details').col, `@${w} wedding: Need to know folded to "${(Fw.find(x => x.id === 'details') || {}).sum}"`);
      ok(!Fw.find(x => x.id === 'schedule').col && (!Fw.find(x => x.id === 'rsvp') || !Fw.find(x => x.id === 'rsvp').col), `@${w} wedding: schedule and RSVP form open`);
      ok(!(await page.$('#sec-schedule [data-sched]')), `@${w} wedding: no Everything / Event only switch`);
      ok((await overflow(page)).length === 0, `@${w} wedding: no overflow ${await overflow(page)}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/eventtab-wedding-${w}.png`, fullPage: true });
      ok(!page._err.length, `@${w} wedding: no page errors ${page._err.join(' | ')}`);
      await ctx.close();

      // ---------- race ----------
      ({ ctx, page } = await mk(browser, w));
      await go(page, 'race'); D = await days(page);
      ok(D.filter(x => x.open).map(x => x.d).join() === '2027-05-16', `@${w} race: race day open (${D.map(x => x.d + (x.open ? '*' : '')).join()})`);
      const rd = await page.$$eval('#sec-schedule .day[data-day="2027-05-16"] .tl > li b', bs => bs.map(b => b.firstChild.textContent.trim()));
      ok(rd.some(x => /wave|start/i.test(x)), `@${w} race: race-day schedule ${rd.join(' | ')}`);
      Fw = await folded(page);
      ok(/Start/.test(Fw.find(x => x.id === 'details').sum) && /Packet pickup/.test(Fw.find(x => x.id === 'details').sum), `@${w} race: race info summary "${Fw.find(x => x.id === 'details').sum}"`);
      ok((await overflow(page)).length === 0, `@${w} race: no overflow ${await overflow(page)}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/eventtab-race-${w}.png`, fullPage: true });
      ok(!page._err.length, `@${w} race: no page errors ${page._err.join(' | ')}`);
      await ctx.close();
    }
  } catch (e) { ok(false, 'threw: ' + (e && e.stack || e)); }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
