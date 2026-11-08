// Outbound link audit: renders sample events, collects every external link the page generates,
// and opens each one in headless WebKit with an iPhone profile to catch bot walls, 404s and empty searches.
//
//   node tests/link-audit.js                 # against a local server on :8765 (python3 -m http.server 8765)
//   BASE=https://bbbot0209.github.io/eventpages/ node tests/link-audit.js
//   ONLY=booking.com node tests/link-audit.js
//
// Needs Playwright (npm i playwright && npx playwright install webkit). Exit code 1 if any link fails.
const { webkit, devices } = require(process.env.PW || 'playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const ONLY = process.env.ONLY || '';
const addDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const START = addDays(100);

const EVENTS = [
  { origin: 'LAX', cfg: { v: 2, type: 'Conference', title: 'Audit Summit NYC', start: START + 'T09:00', end: START + 'T18:00', tz: 'America/New_York',
    venue: { name: 'Javits Center', address: '429 11th Ave, New York, NY 10001', lat: 40.75836, lon: -74.00221, city: 'New York', region: 'New York', country: 'United States', cc: 'us' } }, place: /new york|nyc|manhattan|jfk|lga|ewr|newark/i },
  { origin: 'JFK', cfg: { v: 2, type: 'Wedding', title: 'Audit Wedding Lisbon', start: START, end: '', tz: 'Europe/Lisbon',
    venue: { name: 'Pestana Palace', address: 'R. Jau 54, 1300-314 Lisboa, Portugal', lat: 38.7036, lon: -9.1832, city: 'Lisbon', region: 'Lisbon', country: 'Portugal', cc: 'pt' } }, place: /lisbo|lisboa|lisbon|\bLIS\b|portugal/i },
];

// links whose destination is an app sign-in or a page with no search to check
const LOGIN_OK = /accounts\.google\.com|auth\.uber\.com|m\.uber\.com|lyft\.com/;
const WALL = /access denied|you don.t have permission|request (was )?blocked|are you a (human|robot)|verify (that )?you are (a )?human|captcha|unusual traffic|pardon our interruption|press (&|and) hold|bot (detection|check)|something went wrong.*security|incapsula|perimeterx|datadome/i;
const NOTFOUND = /\b404\b|page (was )?not found|can.t find (that|this) page|no longer available/i;

const PROVIDERS = /(^|\.)(marriott\.com|hilton\.com|ihg\.com|accor\.com|choicehotels\.com|united\.com|alaskaair\.com|britishairways\.com|delta\.com|avis\.com|budget\.com|google\.com|booking\.com|airbnb\.[a-z.]+|expedia\.com|kayak\.com|skyscanner\.[a-z.]+|getyourguide\.com|viator\.com|opentable\.com|rome2rio\.com|amtrak\.com|thetrainline\.com|uber\.com|lyft\.com|flightaware\.com|rentalcars\.com|priceline\.com|tripadvisor\.com|discovercars\.com|omio\.com|trainline\.com)$/;
let thirdParty = 0;
async function collect(browser) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(BASE);
  const out = [];
  for (const ev of EVENTS) {
    await page.evaluate((o) => localStorage.setItem('ep:origin', JSON.stringify(o)), ev.origin);
    const packed = await page.evaluate((c) => LZString.compressToEncodedURIComponent(JSON.stringify(c)), ev.cfg);
    for (const tab of ['event', 'travel', 'nearby']) {
      await page.goto(`${BASE}#e=${packed}${tab === 'event' ? '' : '&t=' + tab}`); await page.waitForSelector('.ev');
      await page.waitForTimeout(tab === 'nearby' ? 6000 : 1500); // let OSM-driven lists fill in
      const links = await page.$$eval('.ev a[href^="http"]', as => as.filter(a => !a.closest('.gm-style, .leaflet-control-container')).map(a => ({ href: a.href, text: a.textContent.replace(/\s+/g, ' ').trim(), rel: a.rel }))); // the map's own attribution links aren't ours
      links.forEach(l => out.push({ ...l, event: ev.cfg.title, place: ev.place }));
    }
  }
  // brand-direct links (hotel chains, airlines, rental brands) built by the app for sample places
  const brand = await page.evaluate(() => { const E = window.__ep; const out = []; const d1 = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10), d2 = new Date(Date.now() + 123 * 864e5).toISOString().slice(0, 10);
    const cfgs = [['Cancún', 'Mexico', 'mx', 21.16, -86.85], ['Kyoto', 'Japan', 'jp', 35.01, 135.77]];
    for (const [city, country, cc, lat, lon] of cfgs) {
      const cfg = { title: 'x', start: d1, end: d2, venue: { name: city, city, country, cc, lat, lon }, tools: {}, off: {} };
      for (const [name, b] of [['Courtyard ' + city, 'marriott'], ['Hilton ' + city, 'hilton'], ['Holiday Inn ' + city, 'ihg'], ['Novotel ' + city, 'accor'], ['Comfort Inn ' + city, 'choice']]) { const a = E.hotelBookAction(cfg, { name, city }); out.push({ href: a.url, text: a.label, rel: 'noopener noreferrer', event: 'Brand ' + city, placeSrc: city.normalize('NFKD').replace(/[\u0300-\u036f]/g, '') }); }
    }
    for (const k of ['UA', 'AS', 'BA', 'DL']) out.push({ href: E.AIRLINE_BOOK[k][1]('LAX', 'CUN', d1, d2, 1), text: 'Book with ' + E.AIRLINE_BOOK[k][0], rel: 'noopener noreferrer', event: 'Brand flights', placeSrc: 'CUN|Cancun|Cancún' });
    for (const b of ['avis', 'budget']) out.push({ href: E.carBrandURL(b, { iata: 'CUN', city: 'Cancun', cc: 'mx' }), text: b + ' CUN', rel: 'noopener noreferrer', event: 'Brand cars', placeSrc: 'CUN|Cancun|Cancún' });
    return out; });
  brand.forEach(l => out.push({ ...l, place: new RegExp(l.placeSrc, 'i') }));
  await ctx.close();
  // one check per distinct URL shape per event (restaurants/hotels repeat the same provider pattern)
  const seen = new Set(); const uniq = [];
  for (const l of out) {
    const u = new URL(l.href);
    // venue websites come from OpenStreetMap data and attribution links from the map library: not links we generate
    if (!PROVIDERS.test(u.hostname)) { thirdParty++; continue; }
    const shape = l.event + ' ' + u.hostname + u.pathname.replace(/[^/]+$/, '') + [...u.searchParams.keys()].sort().join(',') + (u.searchParams.get('travelmode') || '');
    if (seen.has(shape)) continue; seen.add(shape); uniq.push(l);
  }
  return uniq.filter(l => !ONLY || l.href.includes(ONLY));
}

async function check(browser, l) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
  const page = await ctx.newPage(); let status = 0;
  if (/m\.uber\.com\/ul|lyft\.com\/ride/.test(l.href)) {
    try { const r = await fetch(l.href, { redirect: 'manual' }); await ctx.close(); return { ...l, status: r.status, verdict: r.status < 500 ? 'ok' : 'BROKEN', why: 'app deep link, host answered ' + r.status }; }
    catch (e) { await ctx.close(); return { ...l, verdict: 'ERROR', why: e.message }; }
  }
  try {
    const r = await page.goto(l.href, { waitUntil: 'domcontentloaded', timeout: 30000 }); status = r ? r.status() : 0;
    await page.waitForTimeout(5000);
    const final = page.url(); const title = (await page.title()) || '';
    const body = (await page.evaluate(() => document.body ? document.body.innerText : '')).replace(/\s+/g, ' ');
    let verdict = 'ok', why = '';
    if (LOGIN_OK.test(final) || LOGIN_OK.test(l.href)) verdict = 'ok', why = 'app/sign-in destination';
    else if (/google\.com\/maps/.test(final) && status < 400 && /Google Maps/i.test(title)) verdict = 'ok', why = 'Google Maps';
    else if (WALL.test(title) || WALL.test(body.slice(0, 1500))) verdict = 'BLOCKED', why = (title + ' | ' + body.slice(0, 120));
    else if (status >= 400 && status !== 403) verdict = 'BROKEN', why = 'HTTP ' + status;
    else if (status === 403) verdict = 'BLOCKED', why = 'HTTP 403 ' + title;
    else if (NOTFOUND.test(title)) verdict = 'BROKEN', why = title;
    else if (body.length < 200) verdict = 'EMPTY', why = 'body ' + body.length + ' chars';
    else if ((/calendar\.google\.com|accounts\.google\.com/.test(final) || (/calendar\.google\.com/.test(l.href) && /Google Calendar/.test(title))) && status < 400) verdict = 'ok', why = 'Google Calendar (sign-in to save)';
    else {
      // the search should mention the venue city or the airport the link was built for
      const codes = (new URL(l.href).pathname.match(/\b[A-Z]{3}\b/g) || []);
      const place = codes.length ? new RegExp(l.place.source + '|\\b(' + codes.join('|') + ')\\b', 'i') : l.place;
      if (!/google\.com\/maps|amtrak|thetrainline|uber|lyft/.test(final) && !place.test(final + ' ' + title + ' ' + body.slice(0, 6000))) verdict = 'NO-PLACE', why = 'destination never mentions the venue city/airport: ' + title;
    }
    return { ...l, status, final, title: title.slice(0, 80), verdict, why: why.slice(0, 160) };
  } catch (e) { return { ...l, status, verdict: 'ERROR', why: e.message.split('\n')[0].slice(0, 140) }; }
  finally { await ctx.close(); }
}

(async () => {
  const browser = await webkit.launch();
  const links = await collect(browser);
  console.log(`checking ${links.length} links on WebKit / iPhone 13\n`);
  const res = [];
  for (const l of links) {
    let r = await check(browser, l);
    if (r.verdict !== 'ok') { await new Promise(z => setTimeout(z, 8000)); const r2 = await check(browser, l); if (r2.verdict === 'ok') r = { ...r2, why: 'ok on retry (first: ' + r.verdict + ')' }; }
    res.push(r);
    const relOk = /noopener/.test(r.rel) && /noreferrer/.test(r.rel);
    if (!relOk) { r.verdict = r.verdict === 'ok' ? 'REL' : r.verdict; r.why = (r.why ? r.why + '; ' : '') + 'rel=' + r.rel; }
    console.log(`${r.verdict.padEnd(8)} ${r.event.slice(6, 16).padEnd(10)} ${r.text.slice(0, 38).padEnd(38)} ${r.href.slice(0, 110)}${r.why ? '\n         ↳ ' + r.why : ''}`);
  }
  await browser.close();
  const bad = res.filter(r => r.verdict !== 'ok');
  console.log(`\n${res.length - bad.length}/${res.length} generated links ok (${thirdParty} venue-website/attribution links from map data not checked)`);
  process.exit(bad.length ? 1 : 0);
})();
