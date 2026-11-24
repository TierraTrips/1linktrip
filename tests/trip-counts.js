// My trip's City × Category chips: each chip's number is exactly what My trip lists once that chip is tapped (Dylan 11/24:
// "Under 'My trip' the numbers are off. It shows hotels 9, but then there are 3 in the itinerary"). The organizer's own
// schedule ("Check in: …" / flight lines, shown on the Event tab) was added on top of the guest's bookings and spots.
// A hosted trip (Tokyo → Kanazawa → Kyoto) whose schedule has 3 "Check in:" lines + 2 flight lines, and whose My trip has
// 2 hotel bookings, 1 flight, 3 saved restaurants and 1 ☆ hotel. Checked for every chip: All cities, each city, and with a
// search. Saved spots lists only what the guest ☆-saved: no second Hotels group of the stays (bookings + organizer check-ins,
// already in Your itinerary — Dylan saw "Hotels 6" there under "Hotels 3"), nor a ☆ hotel that is one of those stays.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/trip-counts.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };

const stop = (id, name, lat, lon, from, to) => ({ cc: 'jp', id, name, city: name, lat, lon, from, to, address: name + ', Japan', country: 'Japan' });
const CFG = { v: 2, title: 'Count test trip', type: 'Trip', start: '2027-04-25', end: '2027-05-10', tz: 'Asia/Tokyo', ek: 'modes:cnt1',
  venue: { cc: 'jp', lat: 36.2, lon: 138.25, city: '', name: 'Japan', address: 'Japan', country: 'Japan' },
  tools: { stay: true, tours: true, mytrip: true, nearby: true, travel: true, packing: true, weather: true, shopping: true }, off: { rsvp: true },
  stops: [stop('stA', 'Tokyo', 35.676, 139.650, '2027-04-26', '2027-05-02'), stop('stB', 'Kanazawa', 36.560, 136.652, '2027-05-02', '2027-05-06'), stop('stC', 'Kyoto', 35.012, 135.768, '2027-05-06', '2027-05-10')],
  schedule: [
    { date: '2027-04-25', title: 'Fly out to Japan (land Haneda Apr 26)' },
    { date: '2027-04-26', title: 'Check in: Hotel Metropolitan Tokyo Ikebukuro (Tokyo)' },
    { date: '2027-05-02', title: 'Check in: Hyatt Centric Kanazawa (Kanazawa)' },
    { date: '2027-05-06', title: 'Check in: Hyatt Place Kyoto (Kyoto)' },
    { date: '2027-05-10', title: 'Depart Kyoto, fly home from KIX' }] };
const ITIN = [
  { id: 'bkA', kind: 'hotel', name: 'Hotel Metropolitan Tokyo Ikebukuro', start: '2027-04-26T15:00', end: '2027-05-02T12:00', confNo: '111' },
  { id: 'bkB', kind: 'hotel', name: 'Hyatt Centric Kanazawa', start: '2027-05-02T15:00', end: '2027-05-06T12:00', confNo: '222' },
  { id: 'bkF', kind: 'flight', name: 'UA 7909 JFK → HND', flight: 'UA 7909', from: 'JFK', to: 'HND', start: '2027-04-25T13:30', end: '2027-04-26T16:55' }];
const food = (id, name, lat, lon, day) => ({ id, src: 'g', ref: 'g' + id, name, lat, lon, type: 'food', day, time: '', note: '', addr: '', booked: false, conf: '' });
const PLAN = [food('pl1', 'Tsujita Ramen', 35.70, 139.75, '2027-04-27'), food('pl2', 'Kaiten Sushi', 36.57, 136.65, '2027-05-03'), food('pl3', 'Soba Yakko', 35.01, 135.77, ''),
  { ...food('pl4', 'Hotel Gracery Shinjuku', 35.695, 139.702, ''), type: 'stay' }];
const STAR_BOOKED = { ...food('pl5', 'Hyatt Centric Kanazawa', 36.571, 136.657, ''), type: 'stay' }; // ☆ on a hotel that is already booked

(async () => {
  const browser = await chromium.launch();
  try {
    const load = async (plan) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const err = []; page.on('pageerror', e => err.push(String(e)));
    await page.route(/googleapis\.com\/(?!css)|overpass|tile\.openstreetmap|timeapi|nominatim|photon|functions\/v1/, r => r.abort());
    await page.route(/supabase\.co/, r => /rest\/v1\/events\?/.test(r.request().url())
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '00000000-0000-4000-8000-00000000c0c1', slug: 'count-test-ab12c', config: CFG, updated_at: '2026-11-24T00:00:00Z' }]) }) : r.abort());
    await page.addInitScript(([i, p]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ep:itin:cnt1', JSON.stringify(i)); localStorage.setItem('ep:plan:cnt1', JSON.stringify(p)); sessionStorage.setItem('seeded', '1'); } }, [ITIN, plan]);
    await page.goto(BASE + '?e=count-test-ab12c');
    await page.waitForSelector('[data-tab-go="mytrip"][role="tab"]'); await page.click('[data-tab-go="mytrip"][role="tab"]');
    await page.waitForSelector('[data-ccb="trip"] .cc-chip'); await page.waitForTimeout(500);
    return { ctx, page, err }; };
    const spots = (page) => page.$$eval('#sec-spots .sp-g', gs => gs.map(g => ({ k: g.dataset.spotG, n: +g.querySelector('.sp-n').textContent, names: [...g.querySelectorAll('li b')].map(b => b.textContent) })));
    let { ctx, page, err } = await load(PLAN);
    const TRIP = '[data-ccb="trip"]';
    const chips = () => page.$$eval(`${TRIP} .cc-chip`, cs => Object.fromEntries(cs.map(c => [c.dataset.ddV, +(c.querySelector('small') || { textContent: 0 }).textContent])));
    const listed = () => page.$$eval('#sec-plan .plan-row', ls => ls.length);
    const booked = (cat) => page.$$eval(`#sec-itinerary ul.bookings > li[data-cc-cat="${cat}"]:not([hidden])`, ls => ls.length);
    const tap = async (sel) => { await page.click(sel); await page.waitForTimeout(250); };
    const checkAll = async (label) => {
      const n = await chips();
      for (const [cat, c] of Object.entries(n)) {
        await tap(`${TRIP} [data-dd="cat"] [data-dd-v="${cat}"]`);
        const l = await listed(); const b = await booked(cat);
        ok(c === l, `${label}: ${cat} chip says ${c}, itinerary lists ${l}`);
        if (cat === 'hotels' || cat === 'transport') ok(b <= c, `${label}: ${cat} bookings shown (${b}) within the chip's ${c}`);
        await tap(`${TRIP} [data-dd="cat"] [data-dd-v="${cat}"]`); // tap again: clear
      }
      return n;
    };
    const n0 = await checkAll('all cities');
    ok(n0.hotels === 3 && n0.transport === 1 && n0.restaurants === 3, `all cities: Hotels 3 (2 booked + 1 ☆) · Transport 1 · Restaurants 3, not the organizer's 3 check-in + 2 flight lines on top ${JSON.stringify(n0)}`);
    let S = await spots(page); let H = S.find(g => g.k === 'hotels');
    ok(H && H.n === 1 && H.names.join() === 'Hotel Gracery Shinjuku', `Saved spots → Hotels: only the ☆ hotel (1), not the stays ${JSON.stringify(S)}`);
    ok(!S.some(g => g.names.some(nm => /Metropolitan|Hyatt/.test(nm))), 'Saved spots: no booked or organizer check-in hotel');
    ok(S.every(g => g.n === g.names.length), `Saved spots: each group's count = its rows ${JSON.stringify(S.map(g => g.k + ':' + g.n))}`);
    const cities = await page.$$eval(`${TRIP} [data-dd="city"] [data-dd-v]`, bs => bs.map(b => b.dataset.ddV).filter(Boolean));
    ok(cities.length === 3, `three city tabs (${cities})`);
    for (const c of cities) { await tap(`${TRIP} [data-dd="city"] [data-dd-v="${c}"]`); await checkAll(`city ${c}`); }
    await tap(`${TRIP} [data-dd="city"] [data-dd-v=""]`);
    await page.fill(`${TRIP} [data-cct-q]`, 'hyatt'); await page.waitForTimeout(400);
    const nq = await checkAll('search "hyatt"');
    ok(nq.hotels === 1 && !nq.restaurants, `search "hyatt": Hotels 1, no Restaurants ${JSON.stringify(nq)}`);
    ok(!err.length, `no page errors ${err.join(' | ')}`);
    await ctx.close();
    // ☆ on a hotel that is already booked: not listed again in Saved spots
    ({ ctx, page, err } = await load(PLAN.concat([STAR_BOOKED])));
    S = await spots(page); H = S.find(g => g.k === 'hotels');
    ok(H && H.n === 1 && H.names.join() === 'Hotel Gracery Shinjuku', `☆ on a booked hotel: Saved spots → Hotels still only Gracery ${JSON.stringify(H)}`);
    await ctx.close();
    // only stays, nothing ☆: no Saved spots list at all
    ({ ctx, page, err } = await load([]));
    ok((await spots(page)).length === 0 && /Tap ☆ on a place in Nearby/.test(await page.textContent('#sec-spots')), 'only stays, nothing ☆: Saved spots has no hotel group, just the hint');
    await ctx.close();
  } finally { await browser.close(); }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
